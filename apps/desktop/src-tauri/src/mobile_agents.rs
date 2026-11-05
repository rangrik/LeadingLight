use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{net::IpAddr, sync::Mutex, time::Duration};
use tauri::AppHandle;

const REQUEST_LIMIT: usize = 1024 * 1024;
const RESPONSE_LIMIT: usize = 16 * 1024 * 1024;
static GENERATION: Mutex<u64> = Mutex::new(0);

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Connection {
    version: u8,
    name: String,
    url: String,
    token: String,
    certificate: String,
}

#[derive(Serialize)]
pub struct Metadata {
    id: String,
    name: String,
    url: String,
}

#[derive(Serialize)]
pub struct Status {
    connection: Option<Metadata>,
    online: bool,
    error: Option<String>,
}

#[derive(Serialize)]
pub struct Reply {
    status: u16,
    body: Value,
}

fn service(app: &AppHandle) -> String {
    format!("{}.mobile-agents", app.config().identifier)
}

fn address(value: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(value).map_err(|_| "The Mac address is invalid.")?;
    let host = url.host_str().unwrap_or("").trim_matches(['[', ']']);
    let private = match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => ip.octets()[0] == 100 && (64..=127).contains(&ip.octets()[1]),
        Ok(IpAddr::V6(ip)) => ip.segments()[..3] == [0xfd7a, 0x115c, 0xa1e0],
        _ => false,
    };
    if !private
        || url.scheme() != "https"
        || !url
            .port()
            .is_some_and(|port| port == 1380 || (48000..=48999).contains(&port))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Use the connection code from your Mac's Devices settings. It must use the Mac's private Tailscale address.".into());
    }
    Ok(url)
}

fn validate(connection: &Connection) -> Result<(), String> {
    address(&connection.url)?;
    client(connection)?;
    if connection.version != 1
        || connection.name.trim().is_empty()
        || connection.name.len() > 160
        || !(32..=256).contains(&connection.token.len())
        || !connection
            .token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("This Mac connection code is invalid. Copy a new code from your Mac.".into());
    }
    Ok(())
}

fn decode(code: &str) -> Result<Connection, String> {
    let code = code.trim();
    if code.len() > 16384 {
        return Err("This Mac connection code is too long.".into());
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(
            code.strip_prefix("llmac1:")
                .ok_or("Paste the Mac connection code from Devices settings.")?,
        )
        .map_err(|_| "This Mac connection code is invalid.")?;
    let connection: Connection =
        serde_json::from_slice(&bytes).map_err(|_| "This Mac connection code is invalid.")?;
    validate(&connection)?;
    Ok(connection)
}

fn metadata(connection: &Connection) -> Metadata {
    let identity = format!(
        "{}\n{}\n{}",
        connection.url.trim_end_matches('/'),
        connection.token,
        connection.certificate
    );
    let digest = ring::digest::digest(&ring::digest::SHA256, identity.as_bytes());
    Metadata {
        id: digest.as_ref().iter().map(|b| format!("{b:02x}")).collect(),
        name: connection.name.clone(),
        url: connection.url.clone(),
    }
}

fn saved(app: &AppHandle) -> Result<Option<Connection>, String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        match security_framework::passwords::get_generic_password(&service(app), "mac") {
            Ok(bytes) => {
                let connection = serde_json::from_slice(&bytes)
                    .map_err(|_| "The saved Mac connection is invalid. Connect again.")?;
                validate(&connection)?;
                Ok(Some(connection))
            }
            Err(error) if error.code() == -25300 => Ok(None),
            Err(_) => Err("Unlock this device so Keychain can open the Mac connection.".into()),
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        let _ = app;
        Err("Mac connections require an Apple device.".into())
    }
}

fn persist(app: &AppHandle, connection: Option<&Connection>) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        if let Some(connection) = connection {
            let bytes = serde_json::to_vec(connection).map_err(|_| "Invalid Mac connection.")?;
            security_framework::passwords::set_generic_password(&service(app), "mac", &bytes)
                .map_err(|_| {
                    "Keychain could not save the Mac connection. Unlock this device and try again."
                        .into()
                })
        } else {
            match security_framework::passwords::delete_generic_password(&service(app), "mac") {
                Ok(()) => Ok(()),
                Err(error) if error.code() == -25300 => Ok(()),
                Err(_) => Err("Keychain could not remove this connection. Try again.".into()),
            }
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        let _ = (app, connection);
        Err("Mac connections require an Apple device.".into())
    }
}

fn endpoint(connection: &Connection, method: &str, path: &str) -> Result<reqwest::Url, String> {
    let base = address(&connection.url)?;
    let lower = path.to_ascii_lowercase();
    if path.len() > 4096
        || !path.starts_with("/v1/")
        || path.contains(['\\', '#'])
        || ["%2e", "%2f", "%5c"]
            .iter()
            .any(|part| lower.contains(part))
    {
        return Err("This agent route is not available on a mobile device.".into());
    }
    let route = path.split('?').next().unwrap_or("");
    let parts: Vec<_> = route.trim_start_matches('/').split('/').collect();
    if parts
        .iter()
        .any(|part| part.is_empty() || *part == "." || *part == "..")
    {
        return Err("Invalid agent route.".into());
    }
    let allowed = match (method, parts.as_slice()) {
        ("GET", ["v1", "info" | "locations" | "conversations" | "sessions"]) => true,
        ("POST", ["v1", "sessions"]) => true,
        ("GET", ["v1", "conversations", _, "outputs"]) => true,
        ("POST", ["v1", "conversations", _, "resume"]) => true,
        (
            "GET",
            [
                "v1",
                "sessions",
                _,
                "transcript" | "turns" | "requests" | "controls" | "draft" | "queue" | "commands",
            ],
        ) => true,
        ("GET", ["v1", "sessions", _, "commands", _]) => true,
        ("POST", ["v1", "sessions", _, "send" | "interrupt" | "controls"]) => true,
        ("POST", ["v1", "sessions", _, "requests", _, "respond"]) => true,
        ("POST", ["v1", "sessions", _, "queue", _, "send"]) => true,
        ("DELETE", ["v1", "sessions", _, "queue", _]) => true,
        _ => false,
    };
    if !allowed {
        return Err("This agent route is not available on a mobile device.".into());
    }
    let url = base.join(path).map_err(|_| "Invalid agent route.")?;
    if url.origin() != base.origin() || url.path() != route {
        return Err("Invalid agent route.".into());
    }
    Ok(url)
}

async fn request(
    connection: &Connection,
    method: &str,
    path: &str,
    body: Option<&Value>,
) -> Result<Reply, String> {
    let url = endpoint(connection, method, path)?;
    let client = client(connection)?;
    let mut request = client
        .request(
            method
                .parse::<reqwest::Method>()
                .map_err(|_| "Invalid method.")?,
            url,
        )
        .bearer_auth(&connection.token);
    if let Some(body) = body {
        let bytes = serde_json::to_vec(body).map_err(|_| "Invalid agent request.")?;
        if bytes.len() > REQUEST_LIMIT {
            return Err("This message is too large. Send less than 1 MB at a time.".into());
        }
        request = request
            .header("Content-Type", "application/json")
            .body(bytes);
    }
    let mut response = request.send().await.map_err(|_| "Your Mac could not be verified or reached. Copy a new code if its address changed, keep it awake with LeadingLight running, and connect both devices to Tailscale. Nothing will be sent automatically.".to_string())?;
    let status = response.status().as_u16();
    if response
        .content_length()
        .is_some_and(|length| length > RESPONSE_LIMIT as u64)
    {
        return Err("The Mac's reply is too large.".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(
        |_| "The Mac's reply was interrupted. Check the conversation before sending again.",
    )? {
        if bytes.len() + chunk.len() > RESPONSE_LIMIT {
            return Err("The Mac's reply is too large.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).map_err(|_| "The Mac returned an invalid reply.")?
    };
    Ok(Reply { status, body })
}

fn certificate(connection: &Connection) -> Result<reqwest::Certificate, String> {
    if connection.certificate.len() > 8192 {
        return Err("The Mac certificate is too large.".into());
    }
    let bytes = STANDARD
        .decode(&connection.certificate)
        .map_err(|_| "The Mac certificate is invalid. Copy a new connection code.")?;
    reqwest::Certificate::from_der(&bytes)
        .map_err(|_| "The Mac certificate is invalid. Copy a new connection code.".into())
}

fn client(connection: &Connection) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .tls_built_in_root_certs(false)
        .add_root_certificate(certificate(connection)?)
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "The Mac certificate is invalid. Copy a new connection code.".into())
}

async fn check(connection: &Connection) -> Result<(), String> {
    let reply = request(connection, "GET", "/v1/info", None).await?;
    if reply.status == 401 || reply.status == 403 {
        return Err(
            "This Mac connection is no longer allowed. Copy a new code from your Mac.".into(),
        );
    }
    if !(200..300).contains(&reply.status)
        || reply.body["mobile"] != true
        || reply.body["version"] != 1
    {
        return Err("The Mac is not offering a compatible agent connection. Check Devices settings on your Mac.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn mobile_agents_status(app: AppHandle) -> Result<Status, String> {
    let Some(connection) = saved(&app)? else {
        return Ok(Status {
            connection: None,
            online: false,
            error: None,
        });
    };
    let error = check(&connection).await.err();
    Ok(Status {
        connection: Some(metadata(&connection)),
        online: error.is_none(),
        error,
    })
}

#[tauri::command]
pub async fn mobile_agents_connect(app: AppHandle, code: String) -> Result<Status, String> {
    let connection = decode(&code)?;
    let generation = {
        let mut current = GENERATION.lock().map_err(|_| "Connection unavailable.")?;
        *current += 1;
        *current
    };
    check(&connection).await?;
    let current = GENERATION.lock().map_err(|_| "Connection unavailable.")?;
    if *current != generation {
        return Err("The Mac connection changed. Try again.".into());
    }
    persist(&app, Some(&connection))?;
    Ok(Status {
        connection: Some(metadata(&connection)),
        online: true,
        error: None,
    })
}

#[tauri::command]
pub fn mobile_agents_disconnect(app: AppHandle) -> Result<(), String> {
    let mut current = GENERATION.lock().map_err(|_| "Connection unavailable.")?;
    *current += 1;
    persist(&app, None)
}

#[tauri::command]
pub async fn mobile_agents_request(
    app: AppHandle,
    method: String,
    path: String,
    body: Option<Value>,
    expected_connection: String,
) -> Result<Reply, String> {
    let connection = saved(&app)?.ok_or("Connect your Mac in Settings > Devices first.")?;
    if metadata(&connection).id != expected_connection {
        return Err(
            "The Mac connection changed. Reopen the conversation before continuing.".into(),
        );
    }
    request(&connection, &method, &path, body.as_ref()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection() -> Connection {
        Connection {
            version: 1,
            name: "Mac".into(),
            url: "https://100.64.0.1:1380".into(),
            token: "a".repeat(48),
            certificate: STANDARD.encode(include_bytes!("../tests/fixtures/mobile-agent.der")),
        }
    }

    // A pasted code must never send the saved secret outside Tailscale.
    #[test]
    fn only_literal_tailnet_addresses_are_accepted() {
        let code = |value: &Connection| {
            format!(
                "llmac1:{}",
                URL_SAFE_NO_PAD.encode(serde_json::to_vec(value).unwrap())
            )
        };
        let mut c = connection();
        assert!(decode(&code(&c)).is_ok());
        c.token.push('\n');
        assert!(decode(&code(&c)).is_err());
        c = connection();
        c.version = 2;
        assert!(decode(&code(&c)).is_err());
        for url in [
            "https://100.64.0.1:1380",
            "https://100.127.255.255:1380/",
            "https://[fd7a:115c:a1e0::1]:1380",
            "https://100.64.0.1:48000",
            "https://100.64.0.1:48999",
        ] {
            assert!(address(url).is_ok(), "{url}");
        }
        for url in [
            "https://100.63.255.255:1380",
            "https://100.128.0.1:1380",
            "https://127.0.0.1:1380",
            "https://mac.ts.net:1380",
            "https://100.64.0.1:1381",
            "https://100.64.0.1:47999",
            "https://100.64.0.1:49000",
            "https://user@100.64.0.1:1380",
            "https://100.64.0.1:1380/?x",
            "https://100.64.0.1:1380/#x",
            "https://[fd7a:115c:a1e1::1]:1380",
            "http://100.64.0.1:1380",
        ] {
            assert!(address(url).is_err(), "{url}");
        }
    }

    // Opaque request IDs are allowed without exposing runtime administration or files.
    #[test]
    fn client_routes_preserve_the_gateway_boundary() {
        let c = connection();
        assert!(
            endpoint(
                &c,
                "POST",
                "/v1/sessions/test/requests/host%3Arequest/respond"
            )
            .is_ok()
        );
        assert!(endpoint(&c, "GET", "/v1/sessions/test/transcript?since=12&gen=2").is_ok());
        for path in [
            "//evil.test/v1/info",
            "/v1/mobile",
            "/v1/ll/calls",
            "/v1/sessions/test/terminal",
            "/v1/sessions/../info",
            "/v1/sessions/%2e%2e/requests",
            "/v1/sessions/a%2fb/requests",
            "/v1/info#x",
        ] {
            assert!(endpoint(&c, "GET", path).is_err(), "{path}");
        }
        assert!(endpoint(&c, "DELETE", "/v1/sessions/test").is_err());
        assert!(client(&c).is_ok());
        let old = metadata(&c).id;
        let mut changed = c;
        changed.token = "b".repeat(48);
        assert_ne!(old, metadata(&changed).id);
        assert!(
            !serde_json::to_string(&metadata(&changed))
                .unwrap()
                .contains(&changed.token)
        );
        changed.certificate = STANDARD.encode(b"not a certificate");
        assert!(validate(&changed).is_err());
    }
}
