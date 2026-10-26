use std::time::Duration;
use reqwest::{Client, Url};
use serde::Serialize;
use tauri::Manager;

fn address(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "Enter a valid web address.")?;
    if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() {
        return Err("Use an http or https address without a username or password.".into());
    }
    Ok(url)
}

async fn fetch(value: &str, limit: usize) -> Result<(String, String, Vec<u8>), String> {
    let client = Client::builder().timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 { return attempt.error("Too many redirects"); }
            if address(attempt.url().as_str()).is_err() { return attempt.error("Unsafe redirect address"); }
            attempt.follow()
        })).user_agent("LeadingLight/0.1 (Save webpage)")
        .build().map_err(|e| e.to_string())?;
    let mut response = client.get(address(value)?).send().await.map_err(|e| format!("Could not fetch the website: {e}"))?
        .error_for_status().map_err(|e| format!("The website refused the download: {e}"))?;
    let url = address(response.url().as_str())?.to_string();
    let mime = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    if response.content_length().is_some_and(|size| size > limit as u64) { return Err("This download is too large. Save the link instead.".into()); }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > limit { return Err("This download is too large. Save the link instead.".into()); }
        bytes.extend_from_slice(&chunk);
    }
    Ok((url, mime, bytes))
}

#[derive(Debug, Serialize)]
pub struct WebPage { url: String, html: String }

#[tauri::command]
pub async fn web_fetch(url: String) -> Result<WebPage, String> {
    let (url, mime, bytes) = fetch(&url, 8 * 1024 * 1024).await?;
    if !mime.contains("text/html") && !mime.contains("application/xhtml+xml") {
        return Err("This address is not a webpage. Save the link instead.".into());
    }
    let charset = mime.split(';').find_map(|part| part.trim().strip_prefix("charset="));
    let encoding = charset.and_then(|name| encoding_rs::Encoding::for_label(name.trim_matches('"').as_bytes())).unwrap_or(encoding_rs::UTF_8);
    Ok(WebPage { url, html: encoding.decode(&bytes).0.into_owned() })
}

#[derive(Serialize)]
pub struct WebMedia { url: String, name: String, size: usize, mime: String }

#[tauri::command]
pub async fn web_save_media(app: tauri::AppHandle, url: String) -> Result<WebMedia, String> {
    let (url, mime, bytes) = fetch(&url, 20 * 1024 * 1024).await?;
    let mime = mime.split(';').next().unwrap_or("").to_string();
    if !["image/", "audio/", "video/"].iter().any(|kind| mime.starts_with(kind)) || mime == "image/svg+xml" {
        return Err("This file cannot be copied as media.".into());
    }
    let ext = match mime.as_str() {
        "image/png" => "png", "image/jpeg" => "jpg", "image/gif" => "gif", "image/webp" => "webp", "image/avif" => "avif",
        "audio/mpeg" => "mp3", "audio/wav" | "audio/x-wav" => "wav", "audio/mp4" => "m4a", "audio/ogg" => "ogg", "audio/webm" | "video/webm" => "webm", "video/mp4" => "mp4", _ => "bin",
    };
    let name = address(&url)?.path_segments().and_then(|mut segments| segments.next_back()).filter(|s| !s.is_empty()).unwrap_or("media").to_string();
    let folder = app.path().app_data_dir().map_err(|e| e.to_string())?.join("assets");
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let path = folder.join(format!("{}.{}", uuid::Uuid::new_v4(), ext));
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(WebMedia { url: path.to_string_lossy().into_owned(), name, size: bytes.len(), mime })
}

#[cfg(test)]
mod tests {
    use super::*;
    // URL validation is the boundary between pasted text and a network request.
    #[test]
    fn accepts_only_web_addresses_without_credentials() {
        assert!(address("https://example.com/article?q=1").is_ok());
        for url in ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,hi", "https://user:pass@example.com"] {
            assert!(address(url).is_err());
        }
    }

    // The fetch boundary must follow redirects, decode text, and reject oversized or non-HTML bodies.
    #[test]
    fn checks_real_http_responses() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let responses: Vec<Vec<u8>> = vec![
            b"HTTP/1.1 302 Found\r\nLocation: /article\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec(),
            b"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=windows-1252\r\nContent-Length: 11\r\nConnection: close\r\n\r\n<p>caf\xe9</p>".to_vec(),
            b"HTTP/1.1 200 OK\r\nContent-Type: application/pdf\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec(),
            b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 9000000\r\nConnection: close\r\n\r\n".to_vec(),
        ];
        let server = std::thread::spawn(move || {
            for response in responses {
                let (mut socket, _) = listener.accept().unwrap();
                socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let _ = socket.read(&mut [0u8; 4096]);
                socket.write_all(&response).unwrap();
            }
        });
        tauri::async_runtime::block_on(async {
            let page = web_fetch(url.clone()).await.unwrap();
            assert_eq!(page.url, format!("{url}/article"));
            assert_eq!(page.html, "<p>café</p>");
            assert!(web_fetch(url.clone()).await.unwrap_err().contains("not a webpage"));
            assert!(web_fetch(url).await.unwrap_err().contains("too large"));
        });
        server.join().unwrap();
    }
}
