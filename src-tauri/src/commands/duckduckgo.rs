//! DuckDuckGo web and image search, used when no Brave key is saved (growth/phases/image-viewing.md).
//! DuckDuckGo has no official search API: this reads its HTML results page and its image endpoint
//! the way a browser does. Either can change or refuse without notice, so failures say so plainly.
use super::web_search::SearchResult;
use serde::{Deserialize, Serialize};

const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const REFUSED: &str = "DuckDuckGo refused the search. Try again in a little while.";
const MAX_RESPONSE: usize = 2 * 1024 * 1024;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImageResult {
    pub title: String,
    /// The full-size image.
    pub image: String,
    /// A small preview, usually served by Bing for DuckDuckGo.
    pub thumbnail: String,
    /// The page the image appears on.
    pub page: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Deserialize)]
struct ImagesResponse { #[serde(default)] results: Vec<RawImage> }
#[derive(Deserialize)]
struct RawImage {
    #[serde(default)] title: String,
    #[serde(default)] image: String,
    #[serde(default)] thumbnail: String,
    #[serde(default)] url: String,
    #[serde(default)] width: u32,
    #[serde(default)] height: u32,
}

pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().user_agent(USER_AGENT).timeout(std::time::Duration::from_secs(20))
        .connect_timeout(std::time::Duration::from_secs(8)).redirect(reqwest::redirect::Policy::limited(3))
        .build().map_err(|_| "Could not initialize web search.".into())
}

pub(crate) fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('&') {
        out.push_str(&rest[..start]);
        rest = &rest[start..];
        let Some(end) = rest[..rest.len().min(12)].find(';') else { out.push('&'); rest = &rest[1..]; continue };
        let entity = &rest[1..end];
        let decoded = match entity {
            "amp" => Some('&'), "lt" => Some('<'), "gt" => Some('>'), "quot" => Some('"'), "apos" | "#39" | "#x27" => Some('\''), "nbsp" => Some(' '),
            _ if entity.starts_with("#x") => u32::from_str_radix(&entity[2..], 16).ok().and_then(char::from_u32),
            _ if entity.starts_with('#') => entity[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match decoded { Some(c) => { out.push(c); rest = &rest[end + 1..]; } None => { out.push('&'); rest = &rest[1..]; } }
    }
    out.push_str(rest);
    out
}

/// Visible text of an HTML fragment: tags removed, entities decoded, whitespace collapsed.
fn text_of(fragment: &str) -> String {
    let mut plain = String::with_capacity(fragment.len());
    let mut in_tag = false;
    for c in fragment.chars() {
        match c { '<' => in_tag = true, '>' => in_tag = false, _ if !in_tag => plain.push(c), _ => {} }
    }
    decode_entities(&plain).split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The anchor's href and inner HTML, starting just after `class="..."` of that anchor.
fn anchor(after_class: &str) -> Option<(String, &str)> {
    let open_end = after_class.find('>')?;
    let attributes = &after_class[..open_end];
    let href = attributes.split("href=\"").nth(1)?.split('"').next()?;
    let inner = &after_class[open_end + 1..];
    Some((decode_entities(href), &inner[..inner.find("</a>")?]))
}

/// Result links may go through DuckDuckGo's redirect (`//duckduckgo.com/l/?uddg=<target>`); keep the target.
fn unwrap_link(href: &str) -> Option<url::Url> {
    let absolute = if href.starts_with("//") { format!("https:{href}") } else { href.to_string() };
    let url = url::Url::parse(&absolute).ok()?;
    if url.host_str().is_some_and(|h| h.ends_with("duckduckgo.com")) {
        let target = url.query_pairs().find(|(k, _)| k == "uddg")?.1.into_owned();
        return url::Url::parse(&target).ok();
    }
    Some(url)
}

fn safe_link(url: &url::Url) -> bool {
    matches!(url.scheme(), "http" | "https") && url.host_str().is_some_and(|h| !h.ends_with("duckduckgo.com"))
        && url.username().is_empty() && url.password().is_none()
}

pub fn parse_web(html: &str, count: u8) -> Result<Vec<SearchResult>, String> {
    if !html.contains("result__") && !html.contains("No  results.") && !html.contains("No results.") {
        return Err(REFUSED.into());
    }
    let mut seen = std::collections::HashSet::new();
    let mut results = Vec::new();
    for block in html.split("class=\"result__a\"").skip(1) {
        let Some((href, title_html)) = anchor(block) else { continue };
        let Some(url) = unwrap_link(&href).filter(safe_link) else { continue };
        if !seen.insert(url.to_string()) { continue; }
        let snippet = block.split("class=\"result__snippet\"").nth(1).and_then(anchor).map(|(_, inner)| text_of(inner)).unwrap_or_default();
        results.push(SearchResult::new(text_of(title_html), url.to_string(), snippet));
        if results.len() == count as usize { break; }
    }
    Ok(results)
}

/// The per-query token DuckDuckGo's image endpoint requires, from its search page.
pub fn find_vqd(html: &str) -> Option<String> {
    let start = html.find("vqd=")? + 4;
    let token: String = html[start..].trim_start_matches(['"', '\'']).chars().take_while(|c| c.is_ascii_digit() || *c == '-').collect();
    (token.len() > 4).then_some(token)
}

pub fn parse_images(bytes: &[u8], count: u8) -> Result<Vec<ImageResult>, String> {
    let response: ImagesResponse = serde_json::from_slice(bytes).map_err(|_| REFUSED.to_string())?;
    let mut seen = std::collections::HashSet::new();
    Ok(response.results.into_iter().filter_map(|r| {
        let image = url::Url::parse(&r.image).ok().filter(safe_link)?;
        let thumbnail = url::Url::parse(&r.thumbnail).ok().filter(|u| u.scheme() == "https")?;
        let page = url::Url::parse(&r.url).ok().filter(safe_link).map(|u| u.to_string()).unwrap_or_default();
        seen.insert(image.to_string()).then(|| ImageResult { title: text_of(&r.title).chars().take(300).collect(), image: image.to_string(),
            thumbnail: thumbnail.to_string(), page, width: r.width, height: r.height })
    }).take(count as usize).collect())
}

async fn body(response: reqwest::Response) -> Result<Vec<u8>, String> {
    match response.status().as_u16() {
        200 => (),
        202 | 403 | 418 | 429 => return Err(REFUSED.into()),
        status => return Err(format!("DuckDuckGo answered HTTP {status}. Try again later.")),
    }
    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "The search response was interrupted.")? {
        if bytes.len() + chunk.len() > MAX_RESPONSE { return Err("The search response was too large.".into()); }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub async fn web(client: &reqwest::Client, query: &str, count: u8) -> Result<Vec<SearchResult>, String> {
    let response = client.post("https://html.duckduckgo.com/html/").form(&[("q", query)])
        .send().await.map_err(|_| "Could not reach DuckDuckGo. Check your connection and try again.")?;
    parse_web(&String::from_utf8_lossy(&body(response).await?), count)
}

pub async fn images(client: &reqwest::Client, query: &str, count: u8) -> Result<Vec<ImageResult>, String> {
    let page = client.get("https://duckduckgo.com/").query(&[("q", query), ("iax", "images"), ("ia", "images")])
        .send().await.map_err(|_| "Could not reach DuckDuckGo. Check your connection and try again.")?;
    let vqd = find_vqd(&String::from_utf8_lossy(&body(page).await?)).ok_or(REFUSED)?;
    let response = client.get("https://duckduckgo.com/i.js").header("Referer", "https://duckduckgo.com/")
        .query(&[("l", "us-en"), ("o", "json"), ("q", query), ("vqd", vqd.as_str()), ("f", ",,,,,"), ("p", "1")])
        .send().await.map_err(|_| "Could not reach DuckDuckGo. Check your connection and try again.")?;
    parse_images(&body(response).await?, count)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Trimmed from html.duckduckgo.com on 2026-10-17, with a redirect link and a duplicate added.
    const WEB: &str = r#"<div id="links" class="results">
      <div class="result results_links web-result"><h2 class="result__title">
        <a rel="nofollow" class="result__a" href="https://www.youtube.com/watch?v=P1jXmJmmj3o">Blade Runner - Opening Scene (HDR - 4K - 5.1) - YouTube</a></h2>
        <a class="result__snippet" href="https://www.youtube.com/watch?v=P1jXmJmmj3o">ALL THE COPYRIGHTS OF THIS VIDEO IS OWNED BY &quot;Warner Bros.&quot;. <b>Opening</b> sequence</a></div>
      <div class="result"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FBlade_Runner&amp;rut=abc">Blade Runner &#x27;82 - Wikipedia</a>
        <a class="result__snippet" href="x">A 1982 film.</a></div>
      <div class="result"><a class="result__a" href="https://www.youtube.com/watch?v=P1jXmJmmj3o">Duplicate</a></div>
      <div class="result"><a class="result__a" href="javascript:alert(1)">Bad</a></div>
      <div class="result result--ad"><a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a></div>
    </div>"#;

    #[test]
    fn reads_results_from_the_html_page() {
        let results = parse_web(WEB, 10).unwrap();
        assert_eq!(results.len(), 2, "{results:?}");
        assert_eq!(results[0].url(), "https://www.youtube.com/watch?v=P1jXmJmmj3o");
        assert_eq!(results[0].snippet(), r#"ALL THE COPYRIGHTS OF THIS VIDEO IS OWNED BY "Warner Bros.". Opening sequence"#);
        assert_eq!((results[1].title(), results[1].url()), ("Blade Runner '82 - Wikipedia", "https://en.wikipedia.org/wiki/Blade_Runner"));
        assert_eq!(parse_web(WEB, 1).unwrap().len(), 1);
        assert!(parse_web("<html>Please complete the challenge</html>", 5).is_err());
    }

    #[test]
    fn finds_the_image_token() {
        assert_eq!(find_vqd(r#"x vqd="4-246736788931361837996532815047932567904",safe_ddg=0"#).as_deref(), Some("4-246736788931361837996532815047932567904"));
        assert_eq!(find_vqd("vqd=4-2467367889&bing_market=en-US").as_deref(), Some("4-2467367889"));
        assert_eq!(find_vqd("no token here"), None);
    }

    #[test]
    fn reads_image_results_and_drops_unsafe_ones() {
        let json = br#"{"results":[
          {"title":"The Skeptical Probe: <b>Blade</b> Runner","image":"https://blogger.googleusercontent.com/img/a.jpg","thumbnail":"https://tse4.mm.bing.net/th/id/OIP.r","url":"https://probe.example/blade","width":1280,"height":720},
          {"title":"Dup","image":"https://blogger.googleusercontent.com/img/a.jpg","thumbnail":"https://tse4.mm.bing.net/th/id/OIP.s","url":"","width":1,"height":1},
          {"title":"Local","image":"http://duckduckgo.com/a.png","thumbnail":"https://tse.example/t","url":"","width":1,"height":1},
          {"title":"No thumb","image":"https://a.example/b.png","thumbnail":"http://plain/t","url":"","width":1,"height":1}]}"#;
        let results = parse_images(json, 6).unwrap();
        assert_eq!(results, vec![ImageResult { title: "The Skeptical Probe: Blade Runner".into(), image: "https://blogger.googleusercontent.com/img/a.jpg".into(),
            thumbnail: "https://tse4.mm.bing.net/th/id/OIP.r".into(), page: "https://probe.example/blade".into(), width: 1280, height: 720 }]);
        assert!(parse_images(b"<html>", 6).is_err());
    }

    /// Live check against DuckDuckGo: `cargo test duckduckgo -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn live_web_and_image_search() {
        let client = client().unwrap();
        let web = web(&client, "Blade Runner 1982 opening shot", 5).await.unwrap();
        assert!(!web.is_empty(), "no web results");
        let images = images(&client, "Starry Night Van Gogh", 6).await.unwrap();
        assert!(!images.is_empty(), "no image results");
        println!("web: {:?}\nimage: {:?}", web[0], images[0]);
    }

    #[test]
    fn decodes_entities_and_strips_tags() {
        assert_eq!(text_of("<b>Tom</b> &amp; Jerry&#39;s &lt;3 &unknown; &#x263A;"), "Tom & Jerry's <3 &unknown; \u{263A}");
    }
}
