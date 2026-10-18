use crate::db::{AppResult, Metadata};
use image::{imageops::FilterType, ImageFormat, ImageReader, Limits};
use reqwest::{
    dns::{Addrs, Name, Resolve, Resolving},
    Client, Response,
};
use scraper::{Html, Selector};
use std::{
    io::Cursor,
    net::IpAddr,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use url::{Host, Url};

const HTML_LIMIT: usize = 2 * 1024 * 1024;
const IMAGE_LIMIT: usize = 8 * 1024 * 1024;

fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, _, _] = ip.octets();
            !ip.is_private()
                && !ip.is_loopback()
                && !ip.is_link_local()
                && !ip.is_unspecified()
                && !ip.is_broadcast()
                && !ip.is_documentation()
                && a != 0
                && a < 224
                && !(a == 100 && (64..=127).contains(&b))
                && !(a == 198 && (b == 18 || b == 19))
        }
        IpAddr::V6(ip) => {
            if let Some(ip) = ip.to_ipv4_mapped() {
                return public_ip(IpAddr::V4(ip));
            }
            let seg = ip.segments();
            !ip.is_loopback()
                && !ip.is_unspecified()
                && !ip.is_multicast()
                && seg[0] & 0xfe00 != 0xfc00
                && seg[0] & 0xffc0 != 0xfe80
                && !(seg[0] == 0x2001 && seg[1] == 0xdb8)
                && seg[0] & 0xe000 == 0x2000
        }
    }
}

pub fn fetchable(url: &Url) -> bool {
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return false;
    }
    match url.host() {
        Some(Host::Ipv4(ip)) => public_ip(IpAddr::V4(ip)),
        Some(Host::Ipv6(ip)) => public_ip(IpAddr::V6(ip)),
        Some(Host::Domain(host)) => {
            host.contains('.')
                && host != "localhost"
                && !host.ends_with(".localhost")
                && !host.ends_with(".local")
        }
        None => false,
    }
}

#[derive(Debug)]
struct PublicResolver;

impl Resolve for PublicResolver {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            let addresses: Vec<_> = tokio::net::lookup_host((name.as_str(), 0)).await?.collect();
            if addresses.is_empty() || addresses.iter().any(|a| !public_ip(a.ip())) {
                return Err(std::io::Error::other("Endereço privado sem prévia automática").into());
            }
            Ok(Box::new(addresses.into_iter()) as Addrs)
        })
    }
}

pub fn client() -> AppResult<Client> {
    Client::builder()
        .user_agent(concat!(
            "Mozilla/5.0 (compatible; Untab/",
            env!("CARGO_PKG_VERSION"),
            "; local bookmark preview)"
        ))
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .no_proxy()
        .dns_resolver(Arc::new(PublicResolver))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !fetchable(attempt.url()) {
                attempt.error("Redirecionamento sem prévia")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| e.to_string())
}

async fn limited_body(mut response: Response, max: usize) -> AppResult<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|size| size > max as u64)
    {
        return Err("Prévia muito grande".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > max {
            return Err("Prévia muito grande".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn clean(value: &str, limit: usize) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(limit)
        .collect()
}

pub fn parse_page(html: &str, base: &Url) -> (Metadata, Option<Url>) {
    let document = Html::parse_document(html);
    let meta_selector = Selector::parse("meta").unwrap();
    let title_selector = Selector::parse("title").unwrap();
    let mut properties = std::collections::HashMap::new();
    for node in document.select(&meta_selector) {
        let name = node
            .value()
            .attr("property")
            .or_else(|| node.value().attr("name"));
        if let (Some(name), Some(value)) = (name, node.value().attr("content")) {
            if !value.trim().is_empty() {
                properties.entry(name.to_lowercase()).or_insert(value);
            }
        }
    }
    let title = properties
        .get("og:title")
        .or_else(|| properties.get("twitter:title"))
        .map(|v| clean(v, 500))
        .or_else(|| {
            document
                .select(&title_selector)
                .next()
                .map(|el| clean(&el.text().collect::<Vec<_>>().join(" "), 500))
        })
        .filter(|v| !v.is_empty());
    let description = properties
        .get("og:description")
        .or_else(|| properties.get("description"))
        .or_else(|| properties.get("twitter:description"))
        .map(|v| clean(v, 3000))
        .unwrap_or_default();
    let kind = properties.get("og:type").and_then(|v| {
        if *v == "article" {
            Some("article".into())
        } else if v.starts_with("video") {
            Some("video".into())
        } else {
            None
        }
    });
    let image = properties
        .get("og:image:secure_url")
        .or_else(|| properties.get("og:image"))
        .or_else(|| properties.get("twitter:image"))
        .or_else(|| properties.get("twitter:image:src"))
        .and_then(|value| base.join(value.trim()).ok())
        .filter(fetchable);
    (
        Metadata {
            title,
            description,
            kind,
            image_path: None,
        },
        image,
    )
}

async fn save_image(bytes: Vec<u8>, cache: PathBuf, id: String) -> AppResult<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut reader = ImageReader::new(Cursor::new(bytes))
            .with_guessed_format()
            .map_err(|e| e.to_string())?;
        let mut limits = Limits::default();
        limits.max_alloc = Some(64 * 1024 * 1024);
        limits.max_image_width = Some(8192);
        limits.max_image_height = Some(8192);
        reader.limits(limits);
        let image = reader.decode().map_err(|e| e.to_string())?;
        let name = format!("{id}-{}.jpg", uuid::Uuid::new_v4());
        let destination = cache.join(&name);
        let temporary = cache.join(format!("{name}.tmp"));
        image
            .resize(960, 600, FilterType::Triangle)
            .to_rgb8()
            .save_with_format(&temporary, ImageFormat::Jpeg)
            .map_err(|e| e.to_string())?;
        std::fs::rename(temporary, destination).map_err(|e| e.to_string())?;
        Ok(name)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub async fn fetch(client: &Client, input: &str, cache: &Path, id: &str) -> AppResult<Metadata> {
    let url = Url::parse(input).map_err(|e| e.to_string())?;
    if !fetchable(&url) {
        return Err("Link salvo sem prévia automática".into());
    }
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let final_url = response.url().clone();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    if content_type.starts_with("image/") {
        let data = limited_body(response, IMAGE_LIMIT).await?;
        let image_path = save_image(data, cache.to_owned(), id.into()).await.ok();
        return Ok(Metadata {
            kind: Some("image".into()),
            image_path,
            ..Default::default()
        });
    }
    if content_type.contains("application/pdf") {
        return Ok(Metadata {
            kind: Some("document".into()),
            ..Default::default()
        });
    }
    if !content_type.is_empty()
        && !content_type.contains("html")
        && !content_type.starts_with("text/")
    {
        return Err("Conteúdo sem prévia".into());
    }
    let bytes = limited_body(response, HTML_LIMIT).await?;
    let (mut metadata, image_url) = parse_page(&String::from_utf8_lossy(&bytes), &final_url);
    if let Some(image_url) = image_url {
        if let Ok(response) = client
            .get(image_url)
            .send()
            .await
            .and_then(Response::error_for_status)
        {
            if let Ok(data) = limited_body(response, IMAGE_LIMIT).await {
                metadata.image_path = save_image(data, cache.to_owned(), id.into()).await.ok();
            }
        }
    }
    Ok(metadata)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_metadata_and_resolves_relative_images_without_executing_markup() {
        let html = r#"<title>Fallback</title><meta property="og:title" content="Design &amp; Rust">
            <meta name="description" content=" A useful   page "><meta property="og:image" content="../cover.jpg">
            <meta property="og:type" content="article"><script>throw new Error('never execute')</script>"#;
        let (meta, image) =
            parse_page(html, &Url::parse("https://example.com/posts/page").unwrap());
        assert_eq!(meta.title.as_deref(), Some("Design & Rust"));
        assert_eq!(meta.description, "A useful page");
        assert_eq!(meta.kind.as_deref(), Some("article"));
        assert_eq!(image.unwrap().as_str(), "https://example.com/cover.jpg");
    }

    #[test]
    fn disallows_private_and_non_http_preview_targets() {
        for value in [
            "http://127.0.0.1/a",
            "http://10.0.0.2",
            "http://169.254.169.254",
            "http://[::1]",
            "http://[::ffff:127.0.0.1]",
            "http://100.64.0.1",
            "http://machine.local",
            "file:///etc/passwd",
            "https://user:pass@example.com",
        ] {
            assert!(!fetchable(&Url::parse(value).unwrap()), "{value}");
        }
        assert!(fetchable(&Url::parse("https://example.com").unwrap()));
    }
}
