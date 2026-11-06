use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use ring::{
    aead, digest,
    rand::{SecureRandom, SystemRandom},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use serde_json::json;
use std::{
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::AppHandle;

const REQUEST_LIMIT: usize = 1024 * 1024;
const RESPONSE_LIMIT: usize = 3_000_000;
const ORIGIN: &str = "https://leadinglight.app";
static GENERATION: Mutex<u64> = Mutex::new(0);
static NOTIFICATION_ID: Mutex<()> = Mutex::new(());
static NOTIFICATION_BACKLOG: Mutex<()> = Mutex::new(());
static NOTIFICATION_HTTP: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Connection {
    version: u8,
    name: String,
    channel: String,
    token: String,
    key: String,
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

#[derive(Serialize, Deserialize)]
pub struct Reply {
    status: u16,
    body: Value,
}

fn service(app: &AppHandle) -> String {
    format!("{}.mobile-agents", app.config().identifier)
}

fn validate(connection: &Connection) -> Result<(), String> {
    let uuid = uuid::Uuid::parse_str(&connection.channel).ok();
    if connection.version != 2
        || uuid.is_none_or(|id| id.to_string() != connection.channel)
        || connection.name.trim().is_empty()
        || connection.name.len() > 160
        || connection.token.len() != 43
        || !connection
            .token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        || connection.key.len() != 48
        || !connection
            .key
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
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
            code.strip_prefix("llmac2:")
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
        connection.channel, connection.token, connection.key
    );
    let digest = ring::digest::digest(&ring::digest::SHA256, identity.as_bytes());
    Metadata {
        id: digest.as_ref().iter().map(|b| format!("{b:02x}")).collect(),
        name: connection.name.clone(),
        url: ORIGIN.into(),
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
    validate(connection)?;
    let base = reqwest::Url::parse("https://mobile.local").map_err(|_| "Invalid agent route.")?;
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
        ("GET", ["v1", "conversations", _, "outputs" | "transcript"]) => true,
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

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    v: u8,
    iv: String,
    data: String,
}

fn cipher(connection: &Connection) -> Result<aead::LessSafeKey, String> {
    let raw = digest::digest(
        &digest::SHA256,
        format!("LeadingLight mobile v2\n{}", connection.key).as_bytes(),
    );
    let key = aead::UnboundKey::new(&aead::AES_256_GCM, raw.as_ref())
        .map_err(|_| "Invalid connection key.")?;
    Ok(aead::LessSafeKey::new(key))
}
fn aad(connection: &Connection, id: &str, direction: &str) -> Vec<u8> {
    format!(
        "LeadingLight mobile v2\n{}\n{id}\n{direction}",
        connection.channel
    )
    .into_bytes()
}
fn seal(
    connection: &Connection,
    id: &str,
    direction: &str,
    value: &Value,
) -> Result<Envelope, String> {
    let mut bytes = serde_json::to_vec(value).map_err(|_| "Invalid agent request.")?;
    if bytes.len() > REQUEST_LIMIT {
        return Err("This message is too large. Send less than 1 MB at a time.".into());
    }
    let mut nonce = [0; 12];
    SystemRandom::new()
        .fill(&mut nonce)
        .map_err(|_| "Could not secure this request.")?;
    cipher(connection)?
        .seal_in_place_append_tag(
            aead::Nonce::assume_unique_for_key(nonce),
            aead::Aad::from(aad(connection, id, direction)),
            &mut bytes,
        )
        .map_err(|_| "Could not secure this request.")?;
    Ok(Envelope {
        v: 2,
        iv: STANDARD.encode(nonce),
        data: STANDARD.encode(bytes),
    })
}
fn open(
    connection: &Connection,
    id: &str,
    direction: &str,
    envelope: Envelope,
) -> Result<Value, String> {
    if envelope.v != 2 || envelope.data.len() > RESPONSE_LIMIT {
        return Err("Invalid encrypted Mac reply.".into());
    }
    let nonce: [u8; 12] = STANDARD
        .decode(envelope.iv)
        .map_err(|_| "Invalid encrypted Mac reply.")?
        .try_into()
        .map_err(|_| "Invalid encrypted Mac reply.")?;
    let mut bytes = STANDARD
        .decode(envelope.data)
        .map_err(|_| "Invalid encrypted Mac reply.")?;
    let raw = cipher(connection)?
        .open_in_place(
            aead::Nonce::assume_unique_for_key(nonce),
            aead::Aad::from(aad(connection, id, direction)),
            &mut bytes,
        )
        .map_err(
            |_| "The Mac reply could not be verified. Nothing will be resent automatically.",
        )?;
    serde_json::from_slice(raw).map_err(|_| "The Mac returned an invalid reply.".into())
}
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| "Could not prepare the connection.".into())
}
async fn relay(
    client: &reqwest::Client,
    connection: &Connection,
    action: &str,
    body: Value,
) -> Result<Value, String> {
    let mut response = client.post(format!("{ORIGIN}/api/mobile-relay/native/{action}"))
        .bearer_auth(&connection.token).json(&body).send().await.map_err(|_| "The Mac connection is unavailable. Keep your Mac awake and both devices online. Nothing will be sent automatically.")?;
    let status = response.status();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The Mac reply was interrupted. Check the conversation before retrying.")?
    {
        if bytes.len() + chunk.len() > RESPONSE_LIMIT {
            return Err("The Mac reply is too large.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|_| "The connection service returned an invalid reply.")?;
    if !status.is_success() {
        return Err(value["error"]
            .as_str()
            .unwrap_or("The Mac connection is unavailable.")
            .to_string());
    }
    Ok(value)
}
async fn request(
    connection: &Connection,
    method: &str,
    path: &str,
    body: Option<&Value>,
) -> Result<Reply, String> {
    endpoint(connection, method, path)?;
    let client = client()?;
    let id = uuid::Uuid::new_v4().to_string();
    let envelope = seal(
        connection,
        &id,
        "request",
        &json!({ "deadline": SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "Check this device clock.")?.as_millis() as u64 + 30_000, "method": method, "path": path, "body": body }),
    )?;
    relay(
        &client,
        connection,
        "send",
        json!({ "channel": connection.channel, "id": id, "envelope": envelope }),
    )
    .await?;
    let until = Instant::now() + Duration::from_secs(32);
    while Instant::now() < until {
        let value = relay(
            &client,
            connection,
            "reply",
            json!({ "channel": connection.channel, "id": id }),
        )
        .await?;
        if let Some(envelope) = value.get("envelope") {
            let envelope = serde_json::from_value(envelope.clone())
                .map_err(|_| "Invalid encrypted Mac reply.")?;
            let reply = serde_json::from_value(open(connection, &id, "response", envelope)?)
                .map_err(|_| "Invalid Mac reply.")?;
            let client = client.clone();
            let connection = connection.clone();
            tauri::async_runtime::spawn(async move {
                let _ = relay(
                    &client,
                    &connection,
                    "ack",
                    json!({ "channel": connection.channel, "id": id }),
                )
                .await;
            });
            return Ok(reply);
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    Err("The Mac did not confirm this request. Reconnect and check the conversation before retrying.".into())
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
    let previous = saved(&app)?.filter(|old| old.channel != connection.channel);
    if let Some(previous) = &previous { queue_notification_cleanup(&app, previous)?; }
    persist(&app, Some(&connection))?;
    if previous.is_some() { retry_notification_cleanup(&app); }
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
    let previous = saved(&app)?;
    if let Some(previous) = &previous { queue_notification_cleanup(&app, previous)?; }
    persist(&app, None)?;
    if previous.is_some() { retry_notification_cleanup(&app); }
    Ok(())
}

fn notification_device(app: &AppHandle) -> Result<String, String> {
    let _guard = NOTIFICATION_ID.lock().map_err(|_| "Notification identity unavailable.")?;
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        match security_framework::passwords::get_generic_password(&service(app), "notification-device") {
            Ok(bytes) => {
                let id = String::from_utf8(bytes).map_err(|_| "Invalid notification identity.")?;
                uuid::Uuid::parse_str(&id).map_err(|_| "Invalid notification identity.")?;
                Ok(id)
            },
            Err(error) if error.code() == -25300 => {
                let id = uuid::Uuid::new_v4().to_string();
                security_framework::passwords::set_generic_password(&service(app), "notification-device", id.as_bytes()).map_err(|_| "Could not save notification identity.")?;
                Ok(id)
            },
            Err(_) => Err("Unlock this device to configure notifications.".into()),
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    { let _ = app; Err("Notifications require an Apple device.".into()) }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct NotificationCleanup { channel: String, token: String, device: String }

fn append_cleanup(entries: &mut Vec<NotificationCleanup>, entry: NotificationCleanup) -> Result<bool, String> {
    if entries.contains(&entry) { return Ok(false); }
    if entries.len() >= 16 { return Err("Reconnect to the internet and check notifications before disconnecting another Mac. Old notification removals are still pending.".into()); }
    entries.push(entry);
    Ok(true)
}

fn notification_backlog(app: &AppHandle, change: impl FnOnce(&mut Vec<NotificationCleanup>) -> Result<bool, String>) -> Result<Vec<NotificationCleanup>, String> {
    let _guard = NOTIFICATION_BACKLOG.lock().map_err(|_| "Notification cleanup unavailable.")?;
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        use security_framework::passwords::{get_generic_password, set_generic_password, delete_generic_password};
        let mut entries: Vec<NotificationCleanup> = match get_generic_password(&service(app), "notification-cleanup") {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "Saved notification cleanup is invalid.")?,
            Err(error) if error.code() == -25300 => Vec::new(),
            Err(_) => return Err("Unlock this device to finish notification cleanup.".into()),
        };
        if entries.len() > 16 { return Err("Saved notification cleanup is invalid.".into()); }
        if change(&mut entries)? {
            if entries.is_empty() {
                match delete_generic_password(&service(app), "notification-cleanup") {
                    Ok(()) => {},
                    Err(error) if error.code() == -25300 => {},
                    Err(_) => return Err("Could not save notification cleanup. Try again.".into()),
                }
            } else {
                let bytes = serde_json::to_vec(&entries).map_err(|_| "Invalid notification cleanup.")?;
                set_generic_password(&service(app), "notification-cleanup", &bytes).map_err(|_| "Could not save notification cleanup. Try again.")?;
            }
        }
        Ok(entries)
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    { let _ = (app, change); Err("Notifications require an Apple device.".into()) }
}

fn queue_notification_cleanup(app: &AppHandle, connection: &Connection) -> Result<(), String> {
    let entry = NotificationCleanup { channel: connection.channel.clone(), token: connection.token.clone(), device: notification_device(app)? };
    notification_backlog(app, |entries| append_cleanup(entries, entry)).map(|_| ())
}

fn remove_notification_cleanup(app: &AppHandle, entry: &NotificationCleanup) -> Result<(), String> {
    notification_backlog(app, |entries| {
        let count = entries.len();
        entries.retain(|pending| pending != entry);
        Ok(entries.len() != count)
    }).map(|_| ())
}

fn retry_notification_cleanup(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move { let _ = mobile_agents_cleanup_notifications(app).await; });
}

#[tauri::command]
pub async fn mobile_agents_cleanup_notifications(app: AppHandle) -> Result<Value, String> {
    let _guard = NOTIFICATION_HTTP.lock().await;
    let pending = notification_backlog(&app, |_| Ok(false))?;
    if pending.is_empty() { return Ok(json!({"pending":0,"error":null})); }
    let client = client()?;
    let mut error: Option<&str> = None;
    for entry in pending {
        // Pairing and this removal share a lock so reconnecting cannot lose fresh cleanup work.
        let repaired = {
            let _generation = GENERATION.lock().map_err(|_| "Connection unavailable.")?;
            if saved(&app)?.is_some_and(|current| current.channel == entry.channel) {
                remove_notification_cleanup(&app, &entry)?;
                true
            } else { false }
        };
        if repaired { continue; }
        let response = client.post(format!("{ORIGIN}/api/mobile-relay/native/unregister-notifications"))
            .bearer_auth(&entry.token).json(&json!({"channel":entry.channel,"device":entry.device})).send().await;
        match response {
            Ok(response) if response.status().is_success() || matches!(response.status().as_u16(), 403 | 410) => remove_notification_cleanup(&app, &entry)?,
            _ => {
                error = Some("Some old agent alerts may still arrive. Open LeadingLight online to finish removing them.");
                break;
            }
        }
    }
    let pending = notification_backlog(&app, |_| Ok(false))?.len();
    Ok(json!({"pending":pending,"error":error}))
}

#[tauri::command]
pub async fn mobile_agents_notifications(app: AppHandle, action: String, token: Option<String>, environment: Option<String>, expected_connection: String) -> Result<Value, String> {
    let _guard = NOTIFICATION_HTTP.lock().await;
    let connection = saved(&app)?.ok_or("Connect your Mac first.")?;
    if metadata(&connection).id != expected_connection { return Err("The Mac connection changed.".into()); }
    let path = match action.as_str() {
        "status" => "notification-status", "register" => "register-notifications", "unregister" => "unregister-notifications",
        _ => return Err("Invalid notification action.".into()),
    };
    relay(&client()?, &connection, path, json!({"channel":connection.channel,"device":notification_device(&app)?,"token":token,"environment":environment})).await
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NotificationTarget { project: String, conversation: String, request: String, generation: u64 }

fn notification_target(connection: &Connection, payload: Value) -> Result<NotificationTarget, String> {
    let channel = payload["channel"].as_str().ok_or("Invalid notification.")?;
    let id = payload["id"].as_str().ok_or("Invalid notification.")?;
    if channel != connection.channel || uuid::Uuid::parse_str(id).is_err() { return Err("This notification is for a different Mac connection.".into()); }
    let envelope = serde_json::from_value(payload["envelope"].clone()).map_err(|_| "Invalid notification.")?;
    let target: NotificationTarget = serde_json::from_value(open(connection, id, "notification", envelope)?).map_err(|_| "Invalid notification target.")?;
    if [&target.project, &target.conversation, &target.request].iter().any(|s| s.is_empty() || s.len() > 1024) || target.generation > 9_007_199_254_740_991 { return Err("Invalid notification target.".into()); }
    Ok(target)
}

#[tauri::command]
pub fn mobile_agents_notification(app: AppHandle, payload: Value) -> Result<Option<Value>, String> {
    let Some(connection) = saved(&app)? else { return Ok(None); };
    let Ok(target) = notification_target(&connection, payload) else { return Ok(None); };
    Ok(Some(json!({"connection":metadata(&connection).id,"project":target.project,"conversation":target.conversation,"request":target.request,"generation":target.generation})))
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
            version: 2,
            name: "Mac".into(),
            channel: "00000000-0000-4000-8000-000000000001".into(),
            token: "a".repeat(43),
            key: "a".repeat(48),
        }
    }

    // The same vector guards the Rust controller and Go runtime's wire format.
    #[test]
    fn mobile_relay_shared_crypto_vector() {
        let vector: Value =
            serde_json::from_str(include_str!("../tests/fixtures/mobile-relay-v2.json")).unwrap();
        let mut c = connection();
        c.key = vector["key"].as_str().unwrap().into();
        c.channel = vector["channel"].as_str().unwrap().into();
        for case in vector["cases"].as_array().unwrap() {
            let envelope = serde_json::from_value(case["envelope"].clone()).unwrap();
            assert_eq!(
                open(
                    &c,
                    vector["id"].as_str().unwrap(),
                    case["direction"].as_str().unwrap(),
                    envelope,
                ).unwrap(),
                case["plaintext"],
            );
        }
    }

    // A push can open only a target authenticated for this connection and notification direction.
    #[test]
    fn notification_targets_bind_connection_id_and_direction() {
        let c = connection();
        let id = "00000000-0000-4000-8000-000000000002";
        let target = json!({"project":"repo","conversation":"chat","request":"host:approval","generation":3});
        let payload = json!({"channel":c.channel,"id":id,"envelope":seal(&c,id,"notification",&target).unwrap()});
        assert_eq!(serde_json::to_value(notification_target(&c, payload.clone()).unwrap()).unwrap(), target);
        let mut other = c.clone();
        other.channel = "00000000-0000-4000-8000-000000000003".into();
        assert!(notification_target(&other, payload.clone()).is_err());
        let mut switched = payload.clone();
        switched["channel"] = json!(other.channel);
        assert!(notification_target(&other, switched).is_err());
        other = c.clone();
        other.key = "b".repeat(48);
        assert!(notification_target(&other, payload.clone()).is_err());
        let mut switched = payload.clone();
        switched["id"] = json!("00000000-0000-4000-8000-000000000004");
        assert!(notification_target(&c, switched).is_err());
        let request = json!({"channel":c.channel,"id":id,"envelope":seal(&c,id,"request",&target).unwrap()});
        assert!(notification_target(&c, request).is_err());
        let mut tampered = payload;
        let mut bytes = STANDARD.decode(tampered["envelope"]["data"].as_str().unwrap()).unwrap();
        bytes[0] ^= 1;
        tampered["envelope"]["data"] = json!(STANDARD.encode(bytes));
        assert!(notification_target(&c, tampered).is_err());
    }

    // Reaching the cleanup limit must preserve every removal before forgetting another Mac.
    #[test]
    fn notification_cleanup_capacity_preserves_pending_credentials() {
        let entry = |n: u64| NotificationCleanup { channel: uuid::Uuid::from_u128(n.into()).to_string(), token: "a".repeat(43), device: uuid::Uuid::nil().to_string() };
        let mut pending = (0..16).map(entry).collect::<Vec<_>>();
        let original = pending.clone();
        assert!(append_cleanup(&mut pending, entry(16)).is_err());
        assert!(pending == original);
        assert!(!append_cleanup(&mut pending, entry(0)).unwrap());
        assert!(pending == original);
    }

    // A connection code cannot redirect secrets, and replies are tied to this exact request.
    #[test]
    fn pairing_and_encryption_bind_the_connection_and_request() {
        let c = connection();
        let code = format!(
            "llmac2:{}",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&c).unwrap())
        );
        assert!(decode(&code).is_ok());
        let mut value = serde_json::to_value(&c).unwrap();
        value["url"] = json!("https://evil.example");
        assert!(
            decode(&format!(
                "llmac2:{}",
                URL_SAFE_NO_PAD.encode(serde_json::to_vec(&value).unwrap())
            ))
            .is_err()
        );
        let id = "00000000-0000-4000-8000-000000000002";
        assert_eq!(
            open(
                &c,
                id,
                "response",
                seal(&c, id, "response", &json!({"ok":true})).unwrap()
            )
            .unwrap(),
            json!({"ok":true})
        );
        assert!(
            open(
                &c,
                id,
                "request",
                seal(&c, id, "response", &json!({"ok":true})).unwrap()
            )
            .is_err()
        );
        assert!(
            open(
                &c,
                "other",
                "response",
                seal(&c, id, "response", &json!({"ok":true})).unwrap()
            )
            .is_err()
        );
        let mut other = connection();
        other.channel = "00000000-0000-4000-8000-000000000003".into();
        assert!(
            open(
                &other,
                id,
                "response",
                seal(&c, id, "response", &json!({"ok":true})).unwrap()
            )
            .is_err()
        );
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
        assert!(client().is_ok());
        let old = metadata(&c).id;
        let mut changed = c;
        changed.token = "b".repeat(48);
        assert_ne!(old, metadata(&changed).id);
        assert!(
            !serde_json::to_string(&metadata(&changed))
                .unwrap()
                .contains(&changed.token)
        );
        changed.key = "invalid".into();
        assert!(validate(&changed).is_err());
    }
}
