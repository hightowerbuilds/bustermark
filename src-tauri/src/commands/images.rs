//! Images for the Assistant (`image view`, growth/phases/image-viewing.md). The model chooses the
//! URL or path, so this side enforces the rules: web addresses only, no private or local hosts
//! (the connection is pinned to the checked address, and redirects are checked the same way),
//! at most 8 MB, and only PNG, JPEG, GIF, or WebP by their bytes. Local images must be inside
//! the Notes folder or the open workspace. The frontend shrinks what it gets before sending it.
use base64::Engine;
use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr},
    time::Duration,
};
use tauri::command;
use crate::workspace::{self, WorkspaceState};

pub const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;
const MAX_REDIRECTS: usize = 3;

#[derive(serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FetchedImage {
    pub mime_type: String,
    pub data: String,
    pub bytes: usize,
    /// Where the image came from after redirects, or the file path.
    pub source: String,
}

/// The image type from its first bytes; anything else is refused.
pub fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    match bytes {
        [0x89, b'P', b'N', b'G', ..] => Some("image/png"),
        [0xFF, 0xD8, 0xFF, ..] => Some("image/jpeg"),
        [b'G', b'I', b'F', b'8', ..] => Some("image/gif"),
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => Some("image/webp"),
        _ => None,
    }
}

fn public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    !(ip.is_private() || ip.is_loopback() || ip.is_link_local() || ip.is_unspecified() || ip.is_broadcast()
        || ip.is_multicast() || ip.is_documentation()
        || a == 0                              // "this network"
        || (a == 100 && (64..128).contains(&b)) // carrier-grade NAT
        || (a == 192 && b == 0 && ip.octets()[2] == 0) // IETF protocol assignments
        || (a == 198 && (b == 18 || b == 19))  // benchmarking
        || a >= 240)                            // reserved
}

/// Whether an address is on the public internet (not this machine, the local network, or reserved).
pub fn public_address(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => public_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() { return public_v4(v4); }
            let s = v6.segments();
            // NAT64 (64:ff9b::/96) carries an IPv4 address: judge that address.
            if s[0] == 0x64 && s[1] == 0xff9b && s[2..6] == [0, 0, 0, 0] {
                return public_v4(Ipv4Addr::new((s[6] >> 8) as u8, s[6] as u8, (s[7] >> 8) as u8, s[7] as u8));
            }
            !(v6.is_loopback() || v6.is_unspecified() || v6.is_multicast()
                || (s[0] & 0xfe00) == 0xfc00         // unique local
                || (s[0] & 0xffc0) == 0xfe80         // link-local
                || (s[0] == 0x2001 && s[1] == 0x0db8)) // documentation
        }
    }
}

/// Parse and check a URL the model chose; returns it with its host and port.
fn checked_url(raw: &str) -> Result<(url::Url, String, u16), String> {
    let url = url::Url::parse(raw.trim()).map_err(|_| "That is not a valid web address.".to_string())?;
    if !matches!(url.scheme(), "http" | "https") { return Err("Only http and https images can be viewed.".into()); }
    if !url.username().is_empty() || url.password().is_some() { return Err("Image addresses cannot contain a user name or password.".into()); }
    let host = url.host_str().ok_or("That web address has no host.")?.trim_matches(['[', ']']).to_string();
    let port = url.port_or_known_default().ok_or("That web address has no port.")?;
    Ok((url, host, port))
}

/// Resolve a host and refuse it if any address is not public, so a name cannot point inward.
async fn public_socket(host: &str, port: u16) -> Result<SocketAddr, String> {
    let addrs: Vec<SocketAddr> = tokio::time::timeout(Duration::from_secs(8), tokio::net::lookup_host((host, port))).await
        .map_err(|_| "Looking up that site took too long.".to_string())?
        .map_err(|_| "That site could not be found.".to_string())?
        .collect();
    if addrs.is_empty() { return Err("That site could not be found.".into()); }
    if addrs.iter().any(|a| !public_address(a.ip())) {
        return Err("That address points to this computer or a private network, which images cannot be fetched from.".into());
    }
    Ok(addrs[0])
}

/// Download from a public address under the rules above: returns the body, the final address,
/// and its content type. Used for images and for the pages `page images` reads.
pub(crate) async fn download(raw: &str, accept: &str, max_bytes: usize) -> Result<(Vec<u8>, url::Url, String), String> {
    let mut current = raw.to_string();
    for _ in 0..=MAX_REDIRECTS {
        let (url, host, port) = checked_url(&current)?;
        let addr = public_socket(&host, port).await?;
        // Pin the connection to the address just checked; no proxies, no automatic redirects.
        let client = reqwest::Client::builder().no_proxy().resolve(&host, addr)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(8)).timeout(Duration::from_secs(20))
            .user_agent("BusterMark image viewer").build().map_err(|_| "Could not start the download.".to_string())?;
        let mut response = client.get(url.clone()).header("Accept", accept)
            .send().await.map_err(|e| if e.is_timeout() { "The image took too long to download.".to_string() } else { "Could not download the image.".to_string() })?;
        if response.status().is_redirection() {
            let location = response.headers().get(reqwest::header::LOCATION).and_then(|v| v.to_str().ok())
                .ok_or("The site redirected without saying where.")?;
            current = url.join(location).map_err(|_| "The site redirected to an invalid address.".to_string())?.to_string();
            continue;
        }
        if !response.status().is_success() { return Err(format!("The site answered {}.", response.status().as_u16())); }
        let too_large = || format!("It is larger than {} MB.", max_bytes / (1024 * 1024));
        if response.content_length().is_some_and(|len| len as usize > max_bytes) { return Err(too_large()); }
        let content_type = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_ascii_lowercase();
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| "The download was interrupted.".to_string())? {
            bytes.extend_from_slice(&chunk);
            if bytes.len() > max_bytes { return Err(too_large()); }
        }
        return Ok((bytes, url, content_type));
    }
    Err("The site redirected too many times.".into())
}

fn encoded(bytes: Vec<u8>, source: String) -> Result<FetchedImage, String> {
    let mime = image_mime(&bytes).ok_or("That is not a PNG, JPEG, GIF, or WebP image.")?;
    Ok(FetchedImage { mime_type: mime.into(), bytes: bytes.len(), data: base64::engine::general_purpose::STANDARD.encode(&bytes), source })
}

#[command]
pub async fn image_fetch(url: String) -> Result<FetchedImage, String> {
    let (bytes, source, _) = download(&url, "image/png,image/jpeg,image/gif,image/webp", MAX_IMAGE_BYTES).await?;
    encoded(bytes, source.to_string())
}

/// Only the Notes folder or the open workspace; unlike the editor's file reads, never anywhere else.
fn readable(path: &str, state: &WorkspaceState) -> Result<(), String> {
    if state.is_notes_path(path) { return Ok(()); }
    match state.get() {
        Some(root) => workspace::validate_path(path, &root).map(|_| ()),
        None => Err("Only images in your Notes folder or the open folder can be viewed.".into()),
    }
}

#[command]
pub fn image_read(path: String, state: tauri::State<WorkspaceState>) -> Result<FetchedImage, String> {
    readable(&path, &state)?;
    let size = std::fs::metadata(&path).map_err(|_| "That image file was not found.".to_string())?.len();
    if size as usize > MAX_IMAGE_BYTES { return Err("The image is larger than 8 MB.".into()); }
    let bytes = std::fs::read(&path).map_err(|_| "That image file could not be read.".to_string())?;
    encoded(bytes, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_images_by_their_bytes() {
        assert_eq!(image_mime(b"\x89PNG\r\n\x1a\n"), Some("image/png"));
        assert_eq!(image_mime(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(image_mime(b"GIF89a"), Some("image/gif"));
        assert_eq!(image_mime(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(image_mime(b"<svg xmlns="), None);
        assert_eq!(image_mime(b"RIFF\0\0\0\0WAVE"), None);
    }

    #[test]
    fn refuses_this_computer_and_private_networks() {
        for ip in ["127.0.0.1", "10.0.0.5", "172.16.3.4", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1",
            "255.255.255.255", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:192.168.0.1", "2001:db8::1", "64:ff9b::7f00:1"] {
            assert!(!public_address(ip.parse().unwrap()), "{ip} must be refused");
        }
        for ip in ["93.184.216.34", "8.8.8.8", "2606:4700::6810:84e5"] {
            assert!(public_address(ip.parse().unwrap()), "{ip} is public");
        }
    }

    #[test]
    fn checks_the_address_before_connecting() {
        assert!(checked_url("file:///etc/passwd").unwrap_err().contains("http"));
        assert!(checked_url("ftp://example.org/a.png").is_err());
        assert!(checked_url("https://user:pass@example.org/a.png").unwrap_err().contains("user name"));
        assert!(checked_url("not a url").is_err());
        let (_, host, port) = checked_url("https://upload.wikimedia.org/a.jpg").unwrap();
        assert_eq!((host.as_str(), port), ("upload.wikimedia.org", 443));
        let (_, host, _) = checked_url("http://[::1]:8080/a.png").unwrap();
        assert_eq!(host, "::1");
    }

    #[tokio::test]
    async fn refuses_local_hosts_before_any_request() {
        for url in ["http://127.0.0.1:1420/a.png", "http://localhost/a.png", "http://[::1]/a.png", "http://192.168.1.10/a.png"] {
            let error = image_fetch(url.into()).await.unwrap_err();
            assert!(error.contains("private network"), "{url}: {error}");
        }
    }

    #[test]
    fn encodes_only_real_images() {
        let png = b"\x89PNG\r\n\x1a\nrest".to_vec();
        let image = encoded(png.clone(), "a.png".into()).unwrap();
        assert_eq!((image.mime_type.as_str(), image.bytes), ("image/png", png.len()));
        assert!(encoded(b"<html>".to_vec(), "a".into()).is_err());
    }
}
