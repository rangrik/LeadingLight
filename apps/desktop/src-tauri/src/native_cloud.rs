use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use ring::{
    digest,
    rand::{SecureRandom, SystemRandom},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::{Duration, Instant};
use tauri::{AppHandle, State};

const ORIGIN: &str = "https://leadinglight-web.vercel.app";
const LIMIT: usize = 4_500_000;

#[derive(Default)]
pub struct NativeCloud(tauri::async_runtime::Mutex<Connection>);
#[derive(Default)]
struct Connection {
    pending: Option<Pending>,
    provisional: Option<Session>,
}
impl Connection {
    fn confirm(&mut self, persist: impl FnOnce(&str) -> Result<(), String>) -> Result<(), String> {
        let session = self
            .provisional
            .as_ref()
            .ok_or("No verified connection is waiting.")?;
        persist(&session.token)?;
        self.provisional = None;
        Ok(())
    }
}
struct Pending {
    id: String,
    verifier: String,
    started: Instant,
}
#[derive(Serialize)]
pub struct CloudResponse {
    status: u16,
    body: Value,
}
#[derive(Clone, Serialize, Deserialize)]
struct Session {
    token: String,
}

fn service(app: &AppHandle) -> String {
    format!("{}.cloud-session", app.config().identifier)
}

fn saved(app: &AppHandle) -> Result<Option<Session>, String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        match security_framework::passwords::get_generic_password(&service(app), "workspace") {
            Ok(value) => serde_json::from_slice(&value)
                .map(Some)
                .map_err(|_| "Reconnect this device: its saved connection is invalid.".into()),
            Err(error) if error.code() == -25300 => Ok(None),
            Err(_) => Err(
                "Keychain could not open your cloud connection. Unlock the device and try again."
                    .into(),
            ),
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        let _ = app;
        Err("Native cloud accounts require an Apple device.".into())
    }
}

fn save(app: &AppHandle, token: &str) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        let value = serde_json::to_vec(&Session {
            token: token.into(),
        })
        .map_err(|_| "Invalid connection.")?;
        security_framework::passwords::set_generic_password(&service(app), "workspace", &value)
            .map_err(|_| {
                "Keychain could not save your cloud connection. Unlock the device and reconnect."
                    .into()
            })
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        let _ = (app, token);
        Err("Native cloud accounts require an Apple device.".into())
    }
}

fn remove(app: &AppHandle) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        match security_framework::passwords::delete_generic_password(&service(app), "workspace") {
            Ok(()) => Ok(()),
            Err(error) if error.code() == -25300 => Ok(()),
            Err(_) => Err(
                "Keychain could not remove your cloud connection. Try signing out again.".into(),
            ),
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        let _ = app;
        Err("Native cloud accounts require an Apple device.".into())
    }
}

fn endpoint(path: &str, method: &str) -> Result<reqwest::Url, String> {
    let (route, _) = path.split_once('?').unwrap_or((path, ""));
    let url =
        reqwest::Url::parse(&format!("{ORIGIN}/api/{path}")).map_err(|_| "Invalid cloud route.")?;
    let params: Vec<_> = url.query_pairs().collect();
    let valid_query = match (route, method) {
        ("sync", "GET") => {
            params.is_empty()
                || params.len() == 1
                    && params[0].0 == "after"
                    && !params[0].1.is_empty()
                    && params[0].1.len() <= 18
                    && params[0].1.bytes().all(|c| c.is_ascii_digit())
        }
        ("sync-part", "GET") => {
            params.len() == 1
                && params[0].0 == "id"
                && !params[0].1.is_empty()
                && params[0].1.len() <= 200
        }
        _ => params.is_empty(),
    };
    let allowed = matches!(
        (route, method),
        ("config" | "me" | "sync" | "sync-part", "GET")
            | (
                "sync" | "native/start" | "native/poll" | "native/revoke",
                "POST"
            )
    );
    if !allowed || !valid_query || url.fragment().is_some() || url.path() != format!("/api/{route}")
    {
        return Err("This cloud route is not available to the installed app.".into());
    }
    Ok(url)
}

async fn request(
    url: reqwest::Url,
    method: &str,
    body: Option<&Value>,
    token: Option<&str>,
    expected_owner: Option<&str>,
) -> Result<CloudResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Could not prepare the cloud connection.")?;
    let mut request = client.request(
        method
            .parse::<reqwest::Method>()
            .map_err(|_| "Invalid cloud method.")?,
        url,
    );
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }
    if let Some(owner) = expected_owner {
        request = request.header("X-LeadingLight-Owner", owner);
    }
    if let Some(body) = body {
        if serde_json::to_vec(body)
            .map_err(|_| "Invalid cloud request.")?
            .len()
            > LIMIT
        {
            return Err("This sync request is too large.".into());
        }
        request = request.json(body);
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| "Cloud could not be reached. Your local notes are safe.")?;
    let status = response.status().as_u16();
    if !response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|h| h.to_str().ok())
        .is_some_and(|v| v.contains("application/json"))
    {
        return Err(
            "Cloud accounts are not available right now. Your local notes are safe.".into(),
        );
    }
    let mut data = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The cloud response was interrupted. Try again.")?
    {
        if data.len() + chunk.len() > LIMIT {
            return Err("The cloud response was too large.".into());
        }
        data.extend_from_slice(&chunk);
    }
    Ok(CloudResponse {
        status,
        body: serde_json::from_slice(&data).map_err(|_| "Cloud returned an invalid response.")?,
    })
}

async fn abort(connection: &mut Connection) -> bool {
    connection.pending = None;
    let Some(session) = connection.provisional.take() else {
        return true;
    };
    let Ok(url) = endpoint("native/revoke", "POST") else {
        return false;
    };
    request(url, "POST", Some(&json!({})), Some(&session.token), None)
        .await
        .is_ok_and(|r| (200..300).contains(&r.status) || r.status == 401)
}

#[tauri::command]
pub async fn cloud_request(
    app: AppHandle,
    state: State<'_, NativeCloud>,
    path: String,
    body: Option<Value>,
    method: Option<String>,
    expected_owner: Option<String>,
) -> Result<CloudResponse, String> {
    let method = method.unwrap_or_else(|| if body.is_some() { "POST" } else { "GET" }.into());
    let mut connection = state.0.lock().await;
    if path == "native/abort" && method == "POST" {
        let revoked = abort(&mut connection).await;
        return Ok(CloudResponse {
            status: 200,
            body: json!({ "ok": true, "revoked": revoked }),
        });
    }
    if path == "native/confirm" && method == "POST" {
        let previous = saved(&app)?;
        if let Err(error) = connection.confirm(|token| save(&app, token)) {
            abort(&mut connection).await;
            return Err(error);
        }
        if let Some(previous) = previous {
            let _ = request(
                endpoint("native/revoke", "POST")?,
                "POST",
                Some(&json!({})),
                Some(&previous.token),
                None,
            )
            .await;
        }
        return Ok(CloudResponse {
            status: 200,
            body: json!({ "ok": true }),
        });
    }
    let url = endpoint(&path, &method)?;
    if path == "native/start" {
        abort(&mut connection).await;
        let body = body.ok_or("Missing device key.")?;
        let mut entropy = [0u8; 32];
        SystemRandom::new()
            .fill(&mut entropy)
            .map_err(|_| "Could not create a secure connection.")?;
        let verifier = URL_SAFE_NO_PAD.encode(entropy);
        let challenge = digest::digest(&digest::SHA256, verifier.as_bytes())
            .as_ref()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        let mut result = request(url, &method, Some(&json!({ "publicKey": body["publicKey"], "deviceName": body["deviceName"], "challenge": challenge })), None, None).await?;
        if (200..300).contains(&result.status) {
            let id = result.body["id"]
                .as_str()
                .filter(|id| uuid::Uuid::parse_str(id).is_ok())
                .ok_or("Cloud returned an invalid connection.")?
                .to_string();
            result.body["approvalUrl"] = json!(format!("{ORIGIN}/?connect={id}"));
            connection.pending = Some(Pending {
                id,
                verifier,
                started: Instant::now(),
            });
        }
        return Ok(result);
    }
    if path == "native/poll" {
        let id = body
            .as_ref()
            .and_then(|b| b["id"].as_str())
            .ok_or("Missing connection.")?;
        let active = connection
            .pending
            .as_ref()
            .filter(|p| p.id == id && p.started.elapsed() < Duration::from_secs(600))
            .ok_or("This connection expired. Start again.")?;
        let mut result = request(
            url,
            &method,
            Some(&json!({ "id": id, "verifier": active.verifier })),
            None,
            None,
        )
        .await?;
        let token = result
            .body
            .as_object_mut()
            .and_then(|body| body.remove("token"))
            .and_then(|v| v.as_str().map(str::to_owned));
        if result.status == 200 && result.body["status"] == "approved" {
            let token = token
                .filter(|t| {
                    t.len() == 43
                        && t.bytes()
                            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
                })
                .ok_or("Cloud returned an invalid connection.")?;
            connection.provisional = Some(Session { token });
            connection.pending = None;
        } else if result.status == 410 {
            connection.pending = None;
        }
        return Ok(result);
    }
    if path == "native/revoke" && connection.provisional.is_some() {
        return Ok(CloudResponse {
            status: 409,
            body: json!({ "error": "Finish or cancel the pending connection before signing out." }),
        });
    }
    let session = match &connection.provisional {
        Some(session) => Some(session.clone()),
        None => saved(&app)?,
    };
    if session.is_none() && path != "config" {
        return Ok(CloudResponse {
            status: 401,
            body: json!({ "error": "Connect this device to your account first." }),
        });
    }
    let result = request(
        url,
        &method,
        body.as_ref(),
        session.as_ref().map(|s| s.token.as_str()),
        if path == "config" {
            None
        } else {
            expected_owner.as_deref()
        },
    )
    .await?;
    if path == "config" && result.status == 401 {
        return request(endpoint("config", "GET")?, "GET", None, None, None).await;
    }
    if path == "native/revoke" && ((200..300).contains(&result.status) || result.status == 401) {
        remove(&app)?;
        connection.pending = None;
        return Ok(CloudResponse {
            status: 200,
            body: json!({ "ok": true }),
        });
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::{Connection, Session, endpoint};

    // A failed recovery-key check must not replace the previous Keychain session.
    #[test]
    fn credentials_persist_only_after_confirmation() {
        let mut connection = Connection {
            provisional: Some(Session {
                token: "new".into(),
            }),
            ..Default::default()
        };
        let mut stored = "previous".to_string();
        assert!(
            connection
                .confirm(|_| Err("Keychain unavailable".into()))
                .is_err()
        );
        assert_eq!(stored, "previous");
        assert!(connection.provisional.take().is_some());
        assert!(
            connection
                .confirm(|token| {
                    stored = token.into();
                    Ok(())
                })
                .is_err()
        );
        assert_eq!(stored, "previous");
        connection.provisional = Some(Session {
            token: "verified".into(),
        });
        connection
            .confirm(|token| {
                stored = token.into();
                Ok(())
            })
            .unwrap();
        assert_eq!(stored, "verified");
        assert!(connection.provisional.is_none());
    }

    // The webview cannot forward a saved credential to another host or privilege.
    #[test]
    fn credentials_are_limited_to_workspace_routes() {
        for path in [
            "me",
            "config",
            "sync?after=123",
            "sync-part?id=a%3Apart%3A1",
        ] {
            assert!(endpoint(path, "GET").is_ok());
        }
        for (path, method) in [
            ("https://evil.test", "GET"),
            ("../me", "GET"),
            ("me#x", "GET"),
            ("me?other=1", "GET"),
            ("relay/pairs", "POST"),
            ("native/approve", "POST"),
            ("sync?after=1&after=2", "GET"),
            ("sync", "DELETE"),
        ] {
            assert!(endpoint(path, method).is_err(), "{path}");
        }
    }
}
