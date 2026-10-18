//! Keyless places to find pictures (growth/phases/image-viewing.md): Wikimedia Commons search, an
//! official API used when DuckDuckGo's image search refuses, and `page images`, which lists the
//! pictures on a page the model found (its preview image first), fetched under the same network
//! rules as `image view`.
use super::duckduckgo::ImageResult;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const COMMONS_API: &str = "https://commons.wikimedia.org/w/api.php";
/// Commons renders a copy at this width, so a huge original never has to be downloaded.
const COMMONS_WIDTH: &str = "1280";
const MAX_PAGE_BYTES: usize = 3 * 1024 * 1024;
const MAX_PAGE_IMAGES: usize = 20;

#[derive(Deserialize)]
struct CommonsResponse { #[serde(default)] query: Option<CommonsQuery> }
#[derive(Deserialize)]
struct CommonsQuery { #[serde(default)] pages: HashMap<String, CommonsPage> }
#[derive(Deserialize)]
struct CommonsPage { #[serde(default)] index: u32, #[serde(default)] title: String, #[serde(default)] imageinfo: Vec<CommonsInfo> }
#[derive(Deserialize)]
struct CommonsInfo {
    #[serde(default)] thumburl: String,
    #[serde(default)] thumbwidth: u32,
    #[serde(default)] thumbheight: u32,
    #[serde(default)] descriptionurl: String,
    #[serde(default)] mime: String,
}

pub fn parse_commons(bytes: &[u8], count: u8) -> Result<Vec<ImageResult>, String> {
    let response: CommonsResponse = serde_json::from_slice(bytes).map_err(|_| "Wikimedia Commons returned an invalid response.".to_string())?;
    let mut pages: Vec<CommonsPage> = response.query.map(|q| q.pages.into_values().collect()).unwrap_or_default();
    pages.sort_by_key(|p| p.index);
    Ok(pages.into_iter().filter_map(|page| {
        let info = page.imageinfo.into_iter().next()?;
        if !matches!(info.mime.as_str(), "image/png" | "image/jpeg" | "image/gif" | "image/webp") { return None; }
        let image = url::Url::parse(&info.thumburl).ok().filter(|u| u.scheme() == "https")?;
        let title = page.title.trim_start_matches("File:");
        let title = title.rsplit_once('.').map_or(title, |(name, _)| name);
        Some(ImageResult { title: title.chars().take(300).collect(), image: image.to_string(), thumbnail: image.to_string(),
            page: info.descriptionurl, width: info.thumbwidth, height: info.thumbheight })
    }).take(count as usize).collect())
}

pub async fn commons(client: &reqwest::Client, query: &str, count: u8) -> Result<Vec<ImageResult>, String> {
    let limit = (count as u32 * 2).to_string();
    let response = client.get(COMMONS_API).query(&[
        ("action", "query"), ("format", "json"), ("generator", "search"), ("gsrnamespace", "6"), ("gsrsearch", query),
        ("gsrlimit", limit.as_str()), ("prop", "imageinfo"), ("iiprop", "url|size|mime"), ("iiurlwidth", COMMONS_WIDTH),
    ]).send().await.map_err(|_| "Could not reach Wikimedia Commons. Check your connection and try again.")?;
    if !response.status().is_success() { return Err(format!("Wikimedia Commons answered HTTP {}.", response.status().as_u16())); }
    let bytes = response.bytes().await.map_err(|_| "The Wikimedia Commons response was interrupted.")?;
    parse_commons(&bytes, count)
}

#[derive(Debug, Serialize, PartialEq)]
pub struct PageImage { pub url: String, pub alt: String }
#[derive(Debug, Serialize, PartialEq)]
pub struct PageImages { pub page: String, pub title: String, pub images: Vec<PageImage> }

/// The value of `name="..."` inside one tag's attributes (case-insensitive name, either quote).
fn attribute(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let mut from = 0;
    while let Some(found) = lower[from..].find(name) {
        let at = from + found;
        from = at + name.len();
        let before = lower[..at].chars().last();
        if !matches!(before, Some(' ' | '\t' | '\n' | '\r')) { continue; }
        let rest = tag[at + name.len()..].trim_start();
        let Some(rest) = rest.strip_prefix('=') else { continue };
        let rest = rest.trim_start();
        let quote = rest.chars().next()?;
        let value = if quote == '"' || quote == '\'' { rest[1..].split(quote).next()? } else { rest.split([' ', '>']).next()? };
        return Some(super::duckduckgo::decode_entities(value));
    }
    None
}

/// Every opening tag with this name, as the text between `<` and `>`.
fn tags<'a>(html: &'a str, name: &str) -> Vec<&'a str> {
    let lower = html.to_ascii_lowercase();
    let open = format!("<{name}");
    let mut found = Vec::new();
    let mut from = 0;
    while let Some(at) = lower[from..].find(&open) {
        let start = from + at;
        let Some(end) = html[start..].find('>') else { break };
        let tag = &html[start..start + end];
        if tag[open.len()..].starts_with([' ', '\t', '\n', '\r', '/']) { found.push(tag); }
        from = start + end;
    }
    found
}

fn small(tag: &str) -> bool {
    ["width", "height"].iter().any(|name| attribute(tag, name).and_then(|v| v.trim_end_matches("px").parse::<u32>().ok()).is_some_and(|n| n < 100))
}

pub fn parse_page(html: &str, page: &url::Url) -> PageImages {
    let resolve = |raw: &str| page.join(raw.trim()).ok()
        .filter(|u| matches!(u.scheme(), "http" | "https") && !u.path().to_ascii_lowercase().ends_with(".svg"));
    let mut seen = std::collections::HashSet::new();
    let mut images = Vec::new();
    let mut push = |url: url::Url, alt: String, images: &mut Vec<PageImage>| {
        if images.len() < MAX_PAGE_IMAGES && seen.insert(url.to_string()) { images.push(PageImage { url: url.to_string(), alt: alt.chars().take(200).collect() }); }
    };
    let meta = tags(html, "meta");
    let meta_value = |key: &str| meta.iter().find(|t| attribute(t, "property").or_else(|| attribute(t, "name")).is_some_and(|v| v.eq_ignore_ascii_case(key)))
        .and_then(|t| attribute(t, "content"));
    for key in ["og:image", "og:image:url", "twitter:image"] {
        if let Some(url) = meta_value(key).as_deref().and_then(resolve) { push(url, "Preview image".into(), &mut images); }
    }
    for tag in tags(html, "img") {
        if small(tag) { continue; }
        let source = attribute(tag, "src").filter(|s| !s.starts_with("data:"))
            .or_else(|| attribute(tag, "data-src"))
            .or_else(|| attribute(tag, "srcset").and_then(|s| s.split(',').next().and_then(|c| c.split_whitespace().next()).map(str::to_string)));
        if let Some(url) = source.as_deref().and_then(resolve) { push(url, attribute(tag, "alt").unwrap_or_default(), &mut images); }
    }
    let title = meta_value("og:title").or_else(|| {
        let lower = html.to_ascii_lowercase();
        let start = lower.find("<title")?;
        let open_end = start + html[start..].find('>')? + 1;
        let close = open_end + lower[open_end..].find("</title>")?;
        Some(super::duckduckgo::decode_entities(html[open_end..close].trim()))
    }).unwrap_or_default();
    PageImages { page: page.to_string(), title: title.chars().take(300).collect(), images }
}

/// The pictures on a web page: its preview image, then its larger images.
#[tauri::command]
pub async fn page_images(url: String) -> Result<PageImages, String> {
    let (bytes, final_url, content_type) = super::images::download(&url, "text/html,application/xhtml+xml", MAX_PAGE_BYTES).await?;
    if !content_type.is_empty() && !content_type.contains("html") { return Err("That address is not a web page.".into()); }
    Ok(parse_page(&String::from_utf8_lossy(&bytes), &final_url))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_commons_search_results_in_order() {
        let json = br#"{"query":{"pages":{
          "2":{"index":2,"title":"File:Vincent van Gogh - Starry Night.jpg","imageinfo":[{"thumburl":"https://upload.wikimedia.org/thumb/b.jpg","thumbwidth":1280,"thumbheight":989,"descriptionurl":"https://commons.wikimedia.org/wiki/File:B.jpg","mime":"image/jpeg"}]},
          "1":{"index":1,"title":"File:VanGogh-starry night.jpg","imageinfo":[{"thumburl":"https://upload.wikimedia.org/thumb/a.jpg","thumbwidth":1280,"thumbheight":1023,"descriptionurl":"https://commons.wikimedia.org/wiki/File:A.jpg","mime":"image/jpeg"}]},
          "3":{"index":3,"title":"File:Scan.tif","imageinfo":[{"thumburl":"https://upload.wikimedia.org/thumb/c.jpg","mime":"image/tiff"}]}}}}"#;
        let results = parse_commons(json, 6).unwrap();
        assert_eq!(results.iter().map(|r| r.title.as_str()).collect::<Vec<_>>(), ["VanGogh-starry night", "Vincent van Gogh - Starry Night"]);
        assert_eq!((results[0].width, results[0].height, results[0].page.as_str()), (1280, 1023, "https://commons.wikimedia.org/wiki/File:A.jpg"));
        assert!(parse_commons(br#"{"batchcomplete":""}"#, 6).unwrap().is_empty());
        assert!(parse_commons(b"<html>", 6).is_err());
    }

    #[test]
    fn lists_a_pages_preview_and_main_images() {
        let page = url::Url::parse("https://en.wikipedia.org/wiki/Blade_Runner").unwrap();
        let html = r#"<html><head><title>Blade Runner - Wikipedia</title>
          <meta property="og:image" content="https://upload.wikimedia.org/en/9/9f/Blade_Runner_poster.png?utm=a&amp;b=c">
          <meta name="twitter:image" content="https://upload.wikimedia.org/en/9/9f/Blade_Runner_poster.png?utm=a&b=c"></head>
          <body><img src="/static/logo.svg" alt="logo"><img src="data:image/gif;base64,R0l" data-src="//upload.wikimedia.org/still.jpg" alt="The opening shot">
          <img src="pixel.gif" width="1" height="1"><img srcset="https://cdn.example/a-800.jpg 800w, https://cdn.example/a-1600.jpg 1600w" alt='Tyrell pyramid'>
          <IMG SRC="javascript:alert(1)"><img class="x" src='relative/b.jpg'></body></html>"#;
        let found = parse_page(html, &page);
        assert_eq!(found.title, "Blade Runner - Wikipedia");
        assert_eq!(found.images, vec![
            PageImage { url: "https://upload.wikimedia.org/en/9/9f/Blade_Runner_poster.png?utm=a&b=c".into(), alt: "Preview image".into() },
            PageImage { url: "https://upload.wikimedia.org/still.jpg".into(), alt: "The opening shot".into() },
            PageImage { url: "https://cdn.example/a-800.jpg".into(), alt: "Tyrell pyramid".into() },
            PageImage { url: "https://en.wikipedia.org/wiki/relative/b.jpg".into(), alt: "".into() },
        ]);
    }

    #[test]
    fn prefers_the_open_graph_title() {
        let page = url::Url::parse("https://example.org/").unwrap();
        assert_eq!(parse_page(r#"<meta content="Opening shot" property="og:title"><title>Site</title>"#, &page).title, "Opening shot");
    }

    /// Live check: `cargo test image_sources -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn live_commons_page_images_and_fallback() {
        let found = commons(&super::super::duckduckgo::client().unwrap(), "Starry Night Van Gogh", 3).await.unwrap();
        assert!(!found.is_empty());
        let page = page_images("https://en.wikipedia.org/wiki/Blade_Runner".into()).await.unwrap();
        assert!(page.images.iter().any(|i| i.url.contains("upload.wikimedia.org")), "{page:?}");
        let search = super::super::web_search::web_image_search("Starry Night Van Gogh".into(), Some(3)).await.unwrap();
        println!("commons: {:?}\npage: {} images, first {:?}\nweb images: {}", found[0], page.images.len(), page.images[0], serde_json::to_string(&search).unwrap());
    }

    #[tokio::test]
    async fn refuses_local_pages() {
        assert!(page_images("http://127.0.0.1:1420/".into()).await.unwrap_err().contains("private network"));
    }
}
