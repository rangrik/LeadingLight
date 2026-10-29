use crate::{agent, agent_guard};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use ring::{
    aead, digest,
    rand::{SecureRandom, SystemRandom},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Manager, State};

const ORIGIN: &str = "https://leadinglight-web.vercel.app";
const LEASE: u64 = 60;
const QUEUE_LIMIT: usize = 4 * 1024 * 1024;

#[derive(Default)]
pub struct Relay(Mutex<Inner>);
struct Inner {
    grants: HashMap<String, Grant>,
    status: Value,
}
impl Default for Inner {
    fn default() -> Self {
        Self {
            grants: HashMap::new(),
            status: json!({"claude":{"installed":false,"logged_in":false,"error":"Checking Claude Code on your Mac…"},"codex":{"error":"Checking Codex on your Mac…"}}),
        }
    }
}
struct Grant {
    secret: Secret,
    view: Value,
    state: Saved,
    pending: VecDeque<Delivery>,
    pending_bytes: usize,
    turns: HashMap<String, Remote>,
    checked: Option<ServerClock>,
    error: Option<String>,
    revoked: bool,
    pumping: bool,
}
#[derive(Clone, Serialize, Deserialize)]
struct Secret {
    key: String,
    token: String,
    #[serde(default)]
    revoked: bool,
}
#[derive(Default, Clone, Serialize, Deserialize)]
struct Saved {
    after: u64,
    #[serde(default)]
    sessions: HashSet<String>,
    #[serde(default)]
    revoked: bool,
}
struct Remote {
    controller: String,
    guard: agent_guard::Guard,
    terminal: bool,
}
#[derive(Clone, Serialize, Deserialize)]
struct Delivery {
    event: Value,
    run: Option<Value>,
}
#[derive(Serialize, Deserialize)]
struct Started {
    controller: String,
    turn: String,
    terminal: bool,
}

struct ServerClock {
    server_ms: i64,
    received: SystemTime,
    monotonic: Instant,
}
impl ServerClock {
    fn capture(view: &Value) -> Result<Self, String> {
        Ok(Self {
            server_ms: timestamp(&view["serverTime"])
                .ok_or("The relay returned an invalid clock.")?,
            received: SystemTime::now(),
            monotonic: Instant::now(),
        })
    }
    fn elapsed_at(&self, wall: SystemTime, monotonic: Instant) -> Option<Duration> {
        let wall = wall.duration_since(self.received).ok()?;
        let monotonic = monotonic.checked_duration_since(self.monotonic)?;
        // Wall time counts Mac sleep; monotonic time prevents clock rollback extending a lease.
        if wall.saturating_add(Duration::from_secs(1)) < monotonic {
            return None;
        }
        Some(wall.max(monotonic))
    }
    fn elapsed(&self) -> Option<Duration> {
        self.elapsed_at(SystemTime::now(), Instant::now())
    }
    fn server_now_at(&self, wall: SystemTime, monotonic: Instant) -> Option<i64> {
        let elapsed = self.elapsed_at(wall, monotonic)?;
        if elapsed >= Duration::from_secs(LEASE) {
            return None;
        }
        self.server_ms
            .checked_add(elapsed.as_millis().try_into().ok()?)
    }
    fn server_now(&self) -> Option<i64> {
        self.server_now_at(SystemTime::now(), Instant::now())
    }
}

fn uid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value)
}
fn random() -> Result<[u8; 32], String> {
    let mut b = [0; 32];
    SystemRandom::new()
        .fill(&mut b)
        .map_err(|_| "Could not create a secure connection.".to_string())?;
    Ok(b)
}
fn hash(value: &str) -> String {
    digest::digest(&digest::SHA256, value.as_bytes())
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn timestamp(value: &Value) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value.as_str()?)
        .ok()
        .map(|d| d.timestamp_millis())
}
fn root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("relay"))
        .map_err(|_| "Could not find the connection folder.".into())
}
fn service(app: &AppHandle) -> String {
    format!("{}.relay", app.config().identifier)
}
fn disk(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !uid(id) {
        return Err("Invalid connection.".into());
    }
    Ok(root(app)?.join(id))
}
fn native_id(pair: &str, turn: &str) -> String {
    format!("remote:{pair}:{turn}")
}

fn atomic(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid connection storage.")?;
    std::fs::create_dir_all(parent).map_err(|_| "Could not save the connection.")?;
    let temp = parent.join(format!(".{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(&serde_json::to_vec(value)?)?;
        file.sync_all()?;
        std::fs::rename(&temp, path)?;
        std::fs::File::open(parent)?.sync_all()
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temp);
    }
    result.map_err(|_: std::io::Error| "Could not durably save the connection.".into())
}

fn key_save(app: &AppHandle, id: &str, secret: &Secret) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        security_framework::passwords::set_generic_password(
            &service(app),
            id,
            &serde_json::to_vec(secret).map_err(|_| "Invalid connection.")?,
        )
        .map_err(|_| "Keychain could not save this connection. Allow access and retry.".into())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, id, secret);
        Err("Pairing requires the Mac app.".into())
    }
}
fn key_read(app: &AppHandle, id: &str) -> Result<Secret, String> {
    #[cfg(target_os = "macos")]
    {
        let b = security_framework::passwords::get_generic_password(&service(app), id)
            .map_err(|_| "Keychain could not open this connection.")?;
        serde_json::from_slice(&b).map_err(|_| "Invalid connection in Keychain.".into())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, id);
        Err("Pairing requires the Mac app.".into())
    }
}
fn key_remove(app: &AppHandle, id: &str) {
    #[cfg(target_os = "macos")]
    {
        let _ = security_framework::passwords::delete_generic_password(&service(app), id);
    }
}

fn revoke_local(app: &AppHandle, id: &str, g: &mut Grant) {
    g.revoked = true;
    g.state.revoked = true;
    g.secret.revoked = true;
    g.view["state"] = json!("revoked");
    if key_save(app, id, &g.secret).is_err() {
        key_remove(app, id);
    }
    if let Err(e) = disk(app, id).and_then(|d| atomic(&d.join("state.json"), &g.state)) {
        g.error = Some(e);
    }
}

fn delivery_failed(g: &mut Grant, error: String) {
    g.error = Some(error);
    g.revoked = true;
    g.state.revoked = true;
    g.secret.revoked = true;
}
fn fail_closed(app: &AppHandle, id: &str, g: &mut Grant, error: String) {
    delivery_failed(g, error);
    revoke_local(app, id, g);
}

fn aad(pair: &str, controller: &str, turn: &str, direction: &str, id: &str, kind: &str) -> Vec<u8> {
    serde_json::to_vec(&json!([1, pair, controller, turn, direction, id, kind])).unwrap()
}
fn cipher(secret: &Secret) -> Result<aead::LessSafeKey, String> {
    let raw = URL_SAFE_NO_PAD
        .decode(&secret.key)
        .map_err(|_| "Invalid pairing key.")?;
    Ok(aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_256_GCM, &raw).map_err(|_| "Invalid pairing key.")?,
    ))
}
fn encrypt(secret: &Secret, context: &[u8], payload: &Value) -> Result<Value, String> {
    let mut iv = [0; 12];
    SystemRandom::new()
        .fill(&mut iv)
        .map_err(|_| "Could not encrypt the message.")?;
    let mut data = serde_json::to_vec(payload).map_err(|_| "Invalid message.")?;
    cipher(secret)?
        .seal_in_place_append_tag(
            aead::Nonce::assume_unique_for_key(iv),
            aead::Aad::from(context),
            &mut data,
        )
        .map_err(|_| "Could not encrypt the message.")?;
    Ok(json!({"v":1,"iv":STANDARD.encode(iv),"data":STANDARD.encode(data)}))
}
fn decrypt(secret: &Secret, context: &[u8], envelope: &Value) -> Result<Value, String> {
    if envelope["v"] != 1 || envelope.to_string().len() > 262_144 {
        return Err("Invalid encrypted message.".into());
    }
    let iv: [u8; 12] = STANDARD
        .decode(envelope["iv"].as_str().ok_or("Missing nonce.")?)
        .map_err(|_| "Invalid nonce.")?
        .try_into()
        .map_err(|_| "Invalid nonce.")?;
    let mut data = STANDARD
        .decode(envelope["data"].as_str().ok_or("Missing message.")?)
        .map_err(|_| "Invalid message.")?;
    let key = cipher(secret)?;
    let plain = key
        .open_in_place(
            aead::Nonce::assume_unique_for_key(iv),
            aead::Aad::from(context),
            &mut data,
        )
        .map_err(|_| "This message does not belong to this connection.")?;
    serde_json::from_slice(plain).map_err(|_| "Invalid message contents.".into())
}

async fn request(path: &str, token: Option<&str>, body: Value) -> Result<Value, (u16, String)> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|_| (0, "Could not connect to the relay.".into()))?;
    let mut req = client
        .post(format!("{ORIGIN}/api/relay/device/{path}"))
        .json(&body);
    if let Some(token) = token {
        req = req.bearer_auth(token);
    }
    let mut res = req.send().await.map_err(|_| {
        (
            0,
            "The relay is unreachable. Your notes stay on this device.".into(),
        )
    })?;
    let code = res.status().as_u16();
    let mut bytes = Vec::new();
    while let Some(chunk) = res
        .chunk()
        .await
        .map_err(|_| (code, "The relay reply was interrupted.".into()))?
    {
        if bytes.len() + chunk.len() > 1_500_000 {
            return Err((code, "The relay reply is too large.".into()));
        }
        bytes.extend(chunk);
    }
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|_| (code, "The relay returned an invalid reply.".into()))?;
    if !(200..300).contains(&code) {
        return Err((
            code,
            value["error"]
                .as_str()
                .unwrap_or("The relay refused this request.")
                .chars()
                .take(300)
                .collect(),
        ));
    }
    Ok(value)
}

fn public(g: &Grant) -> Value {
    let mut view = g.view.clone();
    if !view.is_object() {
        view = json!({});
    }
    view["error"] = json!(g.error);
    view["online"] = json!(
        g.checked
            .as_ref()
            .and_then(ServerClock::elapsed)
            .is_some_and(|t| t < Duration::from_secs(25))
            && !g.revoked
    );
    if g.revoked {
        view["state"] = json!("revoked");
    }
    view
}

fn authorized(g: &Grant, controller: &str) -> bool {
    let Some(server_now) = g.checked.as_ref().and_then(ServerClock::server_now) else {
        return false;
    };
    !g.revoked
        && g.view["state"] == "active"
        && g.view["controller"] == controller
        && recent(&g.view["lastSeen"], server_now)
        && recent(&g.view["browserSeen"], server_now)
}

fn recent(value: &Value, server_now: i64) -> bool {
    timestamp(value)
        .and_then(|t| server_now.checked_sub(t))
        .is_some_and(|age| (-1_000..LEASE as i64 * 1_000).contains(&age))
}

fn start_fresh(g: &Grant, message: &Value) -> bool {
    g.checked
        .as_ref()
        .and_then(ServerClock::server_now)
        .is_some_and(|now| timestamp(&message["expiresAt"]).is_some_and(|expires| expires > now))
}

#[tauri::command]
pub fn relay_list(relay: State<'_, Relay>) -> Vec<Value> {
    relay
        .0
        .lock()
        .map(|r| r.grants.values().map(public).collect())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn relay_preview(
    app: AppHandle,
    code: String,
    mac_name: String,
) -> Result<Value, String> {
    let parts: Vec<_> = code.trim().split(':').collect();
    if parts.len() != 3
        || parts[0] != "llpair1"
        || !uid(parts[1])
        || parts[2].len() != 43
        || URL_SAFE_NO_PAD
            .decode(parts[2])
            .map(|b| b.len())
            .unwrap_or(0)
            != 32
    {
        return Err("Paste the complete pairing code from the web app.".into());
    }
    if mac_name.trim().is_empty() || mac_name.chars().count() > 80 {
        return Err("Give this Mac a name up to 80 characters.".into());
    }
    let id = parts[1].to_string();
    if app
        .state::<Relay>()
        .0
        .lock()
        .map_err(|_| "Connection unavailable.")?
        .grants
        .contains_key(&id)
    {
        return Err("This connection is already on this Mac.".into());
    }
    let secret = Secret {
        key: parts[2].into(),
        token: URL_SAFE_NO_PAD.encode(random()?),
        revoked: false,
    };
    let out = request("claim",None,json!({"pairId":id,"inviteHash":hash(&format!("LeadingLight pairing v1:{}:{}",id,parts[2])),"credentialHash":hash(&secret.token),"macName":mac_name.trim()})).await.map_err(|(_,e)|e)?;
    let view = checked_pair(&id, &out)?;
    // Saving before approval lets a failed or interrupted review still be revoked safely.
    if let Err(error) = key_save(&app, &id, &secret) {
        let _ = request("revoke", Some(&secret.token), json!({"pairId":id})).await;
        return Err(error);
    }
    let dir = disk(&app, &id)?;
    if let Err(e) = atomic(&dir.join("state.json"), &Saved::default())
        .and_then(|_| atomic(&dir.join("view.json"), &view))
    {
        let _ = request("revoke", Some(&secret.token), json!({"pairId":id})).await;
        key_remove(&app, &id);
        return Err(e);
    }
    app.state::<Relay>()
        .0
        .lock()
        .map_err(|_| "Connection unavailable.")?
        .grants
        .insert(
            id,
            Grant {
                secret,
                view: view.clone(),
                state: Saved::default(),
                pending: VecDeque::new(),
                pending_bytes: 0,
                turns: HashMap::new(),
                checked: None,
                error: None,
                revoked: false,
                pumping: false,
            },
        );
    Ok(view)
}

fn checked_pair(id: &str, out: &Value) -> Result<Value, String> {
    let p = &out["pair"];
    if p["id"] != id || !p.is_object() {
        return Err("The relay returned the wrong connection.".into());
    }
    if timestamp(&p["serverTime"]).is_none() {
        return Err("The relay returned an invalid clock.".into());
    }
    let mut view = json!({});
    for key in [
        "id",
        "accountName",
        "browserName",
        "macName",
        "state",
        "expiresAt",
        "lastSeen",
        "browserSeen",
        "controller",
        "serverTime",
    ] {
        view[key] = p[key].clone();
    }
    Ok(view)
}

#[tauri::command]
pub async fn relay_approve(app: AppHandle, id: String) -> Result<(), String> {
    let secret = {
        let relay = app.state::<Relay>();
        let r = relay.0.lock().map_err(|_| "Connection unavailable.")?;
        let g = r.grants.get(&id).ok_or("Review this connection first.")?;
        if g.revoked || g.view["state"] != "review" {
            return Err("This connection is not waiting for approval.".into());
        }
        g.secret.clone()
    };
    key_save(&app, &id, &secret)?;
    let out = request("approve", Some(&secret.token), json!({"pairId":id}))
        .await
        .map_err(|(_, e)| e)?;
    let view = checked_pair(&id, &out)?;
    if let Err(error) = atomic(&disk(&app, &id)?.join("view.json"), &view) {
        let _ = request("revoke", Some(&secret.token), json!({"pairId":id})).await;
        return Err(error);
    }
    {
        let relay = app.state::<Relay>();
        let mut r = relay.0.lock().map_err(|_| "Connection unavailable.")?;
        let g = r.grants.get_mut(&id).ok_or("Connection removed.")?;
        if g.revoked {
            return Err("Connection removed.".into());
        }
        g.view = view;
    }
    launch_pump(&app, &id);
    Ok(())
}

#[tauri::command]
pub async fn relay_revoke(app: AppHandle, id: String) -> Result<(), String> {
    let secret = {
        let relay = app.state::<Relay>();
        let mut r = relay.0.lock().map_err(|_| "Connection unavailable.")?;
        let g = r.grants.get_mut(&id).ok_or("Connection not found.")?;
        revoke_local(&app, &id, g);
        g.secret.clone()
    };
    interrupt(&app, &id, "This connection was removed.");
    launch_pump(&app, &id);
    match request("revoke", Some(&secret.token), json!({"pairId":id})).await {
        Ok(_) | Err((403 | 410, _)) => {
            key_remove(&app, &id);
            Ok(())
        }
        Err((_, e)) => Err(format!(
            "Stopped on this Mac. Cloud removal will retry: {e}"
        )),
    }
}

fn queue(
    app: &AppHandle,
    pair: &str,
    g: &mut Grant,
    controller: &str,
    turn: &str,
    payload: Value,
    state: Option<&str>,
) -> Result<(), String> {
    let id = uuid::Uuid::new_v4().to_string();
    if payload.to_string().len() > 500_000 {
        return Err("An agent message exceeded the connection limit.".into());
    }
    let envelope = encrypt(
        &g.secret,
        &aad(pair, controller, turn, "mac", &id, "event"),
        &payload,
    )?;
    let event =
        json!({"id":id,"controller":controller,"turn":turn,"kind":"event","envelope":envelope});
    let bytes = event.to_string().len();
    if g.pending_bytes + bytes > QUEUE_LIMIT {
        return Err("The connection output queue is full. The agent was stopped.".into());
    }
    g.pending.push_back(Delivery {
        event,
        run: state.map(|s| json!({"id":turn,"state":s})),
    });
    g.pending_bytes += bytes;
    if state.is_some() {
        atomic(&disk(app, pair)?.join("outbox.json"), &g.pending)
    } else {
        Ok(())
    }
}

fn start_once(dir: &Path, controller: &str, turn: &str) -> Result<bool, String> {
    std::fs::create_dir_all(dir).map_err(|_| "Could not save the start record.")?;
    let path = dir.join(format!("{turn}.json"));
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
    {
        Ok(mut f) => {
            f.write_all(
                &serde_json::to_vec(&Started {
                    controller: controller.into(),
                    turn: turn.into(),
                    terminal: false,
                })
                .unwrap(),
            )
            .and_then(|_| f.sync_all())
            .and_then(|_| std::fs::File::open(dir)?.sync_all())
            .map_err(|_| "Could not durably record the start.")?;
            Ok(true)
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        Err(_) => Err("Could not save the start record.".into()),
    }
}

fn ended(
    app: &AppHandle,
    pair: &str,
    g: &mut Grant,
    controller: &str,
    turn: &str,
    how: &str,
    message: &str,
) {
    if !uid(pair) || !uid(controller) || !uid(turn) {
        return;
    }
    if let Err(error) = queue(
        app,
        pair,
        g,
        controller,
        turn,
        json!({"type":"ended","how":how,"message":message}),
        Some(how),
    ) {
        fail_closed(app, pair, g, error);
        return;
    }
    let _ = atomic(
        &disk(app, pair)
            .unwrap_or_default()
            .join("starts")
            .join(format!("{turn}.json")),
        &Started {
            controller: controller.into(),
            turn: turn.into(),
            terminal: true,
        },
    );
}

fn interrupt(app: &AppHandle, pair: &str, message: &str) {
    let turns = app
        .state::<Relay>()
        .0
        .lock()
        .map(|r| {
            r.grants
                .get(pair)
                .map(|g| {
                    g.turns
                        .iter()
                        .filter(|(_, v)| !v.terminal)
                        .map(|(id, t)| (id.clone(), t.controller.clone()))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default()
        })
        .unwrap_or_default();
    for (turn, controller) in turns {
        let result = agent::stop(app, &native_id(pair, &turn));
        let relay = app.state::<Relay>();
        let Ok(mut r) = relay.0.lock() else { return };
        let Some(g) = r.grants.get_mut(pair) else {
            return;
        };
        if let Err(e) = result {
            g.error = Some(e);
            continue;
        }
        if g.turns.get(&turn).is_none_or(|t| t.terminal) {
            continue;
        }
        if let Some(t) = g.turns.get_mut(&turn) {
            t.terminal = true;
        }
        ended(app, pair, g, &controller, &turn, "interrupted", message);
    }
}

fn event(app: &AppHandle, pair: &str, turn: &str, e: agent::Event) {
    let relay = app.state::<Relay>();
    let Ok(mut r) = relay.0.lock() else { return };
    let Some(g) = r.grants.get_mut(pair) else {
        return;
    };
    let Some(t) = g.turns.get_mut(turn).filter(|t| !t.terminal) else {
        return;
    };
    let controller = t.controller.clone();
    let state = match &e {
        agent::Event::Error { .. } => Some("failed"),
        agent::Event::Line { line } => {
            if let Some(session) = t
                .guard
                .observe(line)
                .filter(|s| s.len() <= 120 && !s.is_empty())
            {
                let provider = if line["type"] == "result" {
                    "claude"
                } else {
                    "codex"
                };
                g.state.sessions.insert(format!("{provider}:{session}"));
                if let Err(error) = atomic(
                    &disk(app, pair).unwrap_or_default().join("state.json"),
                    &g.state,
                ) {
                    fail_closed(app, pair, g, error);
                    drop(r);
                    let _ = agent::stop(app, &native_id(pair, turn));
                    return;
                }
            }
            if line["type"] == "result" {
                Some(if line["is_error"].as_bool().unwrap_or(false) {
                    "failed"
                } else {
                    "done"
                })
            } else if line["method"] == "turn/completed" {
                Some(match line["params"]["turn"]["status"].as_str() {
                    Some("completed") => "done",
                    Some("interrupted") => "stopped",
                    _ => "failed",
                })
            } else {
                None
            }
        }
    };
    if let Err(error) = queue(
        app,
        pair,
        g,
        &controller,
        turn,
        serde_json::to_value(e).unwrap(),
        state,
    ) {
        fail_closed(app, pair, g, error);
        drop(r);
        let _ = agent::stop(app, &native_id(pair, turn));
        return;
    }
    if let Some(t) = g.turns.get_mut(turn) {
        t.terminal = state.is_some();
    }
    if state.is_some() {
        let _ = atomic(
            &disk(app, pair)
                .unwrap_or_default()
                .join("starts")
                .join(format!("{turn}.json")),
            &Started {
                controller,
                turn: turn.into(),
                terminal: true,
            },
        );
    }
}

fn command(app: &AppHandle, pair: &str, message: &Value) -> Result<(), String> {
    let id = message["id"]
        .as_str()
        .filter(|s| uid(s))
        .ok_or("Invalid command id.")?;
    let turn = message["turn"]
        .as_str()
        .filter(|s| uid(s))
        .ok_or("Invalid turn id.")?;
    let controller = message["controller"]
        .as_str()
        .filter(|s| uid(s))
        .ok_or("Invalid controller.")?;
    let kind = message["kind"].as_str().ok_or("Invalid command kind.")?;
    let payload = {
        let relay = app.state::<Relay>();
        let r = relay.0.lock().map_err(|_| "Connection unavailable.")?;
        let g = r.grants.get(pair).ok_or("Connection removed.")?;
        if !authorized(g, controller) {
            return Err("This browser no longer controls the connection.".into());
        }
        if kind == "start" && !start_fresh(g, message) {
            return Err("This start expired. Send the question again.".into());
        }
        decrypt(
            &g.secret,
            &aad(pair, controller, turn, "browser", id, kind),
            &message["envelope"],
        )?
    };
    match kind {
        "start" => {
            if payload["type"] != "ask" {
                return Err("Invalid note request.".into());
            }
            let mut ask: agent::Ask = serde_json::from_value(payload["ask"].clone())
                .map_err(|_| "Invalid note request.")?;
            if ask.id != turn {
                return Err("The note request has the wrong turn id.".into());
            }
            agent_guard::validate(&ask)?;
            {
                let relay = app.state::<Relay>();
                let mut r = relay.0.lock().map_err(|_| "Connection unavailable.")?;
                let g = r.grants.get_mut(pair).ok_or("Connection removed.")?;
                if !authorized(g, controller) {
                    return Err("This connection is no longer authorized.".into());
                }
                if g.turns
                    .get(turn)
                    .is_some_and(|t| !t.terminal && t.controller == controller)
                {
                    queue(
                        app,
                        pair,
                        g,
                        controller,
                        turn,
                        json!({"type":"receipt","messageId":id,"ok":true}),
                        None,
                    )?;
                    return Ok(());
                }
                if g.turns.values().any(|t| !t.terminal) {
                    return Err("A note conversation is already running on this connection.".into());
                }
                if ask
                    .resume
                    .as_ref()
                    .is_some_and(|s| !g.state.sessions.contains(&format!("{}:{s}", ask.provider)))
                {
                    return Err(
                        "This session belongs to another connection. Start a new conversation."
                            .into(),
                    );
                }
                if !start_once(&disk(app, pair)?.join("starts"), controller, turn)? {
                    queue(
                        app,
                        pair,
                        g,
                        controller,
                        turn,
                        json!({"type":"receipt","messageId":id,"ok":false,"error":"This start was already accepted and will not run twice."}),
                        None,
                    )?;
                    ended(
                        app,
                        pair,
                        g,
                        controller,
                        turn,
                        "interrupted",
                        "This start was already accepted and will not run twice.",
                    );
                    return Ok(());
                }
                g.turns.retain(|_, t| !t.terminal);
                g.turns.insert(
                    turn.into(),
                    Remote {
                        controller: controller.into(),
                        guard: agent_guard::Guard::new(ask.clone()),
                        terminal: false,
                    },
                );
                queue(
                    app,
                    pair,
                    g,
                    controller,
                    turn,
                    json!({"type":"receipt","messageId":id,"ok":true}),
                    Some("running"),
                )?;
            }
            ask.id = native_id(pair, turn);
            let (a, p, t) = (app.clone(), pair.to_string(), turn.to_string());
            let launched = agent::start_remote(
                app.clone(),
                ask,
                Arc::new(move |e| event(&a, &p, &t, e)),
                || {
                    app.state::<Relay>().0.lock().is_ok_and(|r| {
                        r.grants.get(pair).is_some_and(|g| {
                            authorized(g, controller)
                                && start_fresh(g, message)
                                && g.turns
                                    .get(turn)
                                    .is_some_and(|t| !t.terminal && t.controller == controller)
                        })
                    })
                },
            );
            if let Err(error) = launched {
                let _ = agent::stop(app, &native_id(pair, turn));
                event(app, pair, turn, agent::Event::Error { message: error });
            }
        }
        "reply" => {
            if payload["type"] != "reply" {
                return Err("Invalid note response.".into());
            }
            let safe = {
                let relay = app.state::<Relay>();
                let mut r = relay.0.lock().map_err(|_| "Connection unavailable.")?;
                let g = r.grants.get_mut(pair).ok_or("Connection removed.")?;
                if !authorized(g, controller) {
                    return Err("This connection is no longer authorized.".into());
                }
                let t = g
                    .turns
                    .get_mut(turn)
                    .filter(|t| !t.terminal && t.controller == controller)
                    .ok_or("This turn has ended.")?;
                t.guard.reply(&payload["message"])?
            };
            agent::send(app, &native_id(pair, turn), &safe)?;
            receipt(app, pair, controller, turn, id, Ok(()))?;
        }
        "cancel" => {
            if payload["type"] != "cancel" {
                return Err("Invalid stop request.".into());
            }
            // A stop can overtake a queued start; its durable tombstone prevents later execution.
            start_once(&disk(app, pair)?.join("starts"), controller, turn)?;
            agent::stop(app, &native_id(pair, turn))?;
            let relay = app.state::<Relay>();
            let mut r = relay.0.lock().map_err(|_| "Connection unavailable.")?;
            let g = r.grants.get_mut(pair).ok_or("Connection removed.")?;
            let already_done = g.turns.get(turn).is_some_and(|t| t.terminal);
            if let Some(t) = g.turns.get_mut(turn) {
                t.terminal = true;
            }
            queue(
                app,
                pair,
                g,
                controller,
                turn,
                json!({"type":"receipt","messageId":id,"ok":true}),
                None,
            )?;
            if !already_done {
                ended(
                    app,
                    pair,
                    g,
                    controller,
                    turn,
                    "stopped",
                    "Stopped on your Mac.",
                );
            }
        }
        _ => return Err("This connection only supports note conversations.".into()),
    }
    Ok(())
}

fn receipt(
    app: &AppHandle,
    pair: &str,
    controller: &str,
    turn: &str,
    id: &str,
    result: Result<(), String>,
) -> Result<(), String> {
    if !uid(pair) || !uid(controller) || !uid(turn) || !uid(id) {
        return Err("Invalid command metadata.".into());
    }
    let relay = app.state::<Relay>();
    let mut r = relay.0.lock().map_err(|_| "Connection unavailable.")?;
    let g = r.grants.get_mut(pair).ok_or("Connection removed.")?;
    let payload = match result {
        Ok(()) => json!({"type":"receipt","messageId":id,"ok":true}),
        Err(e) => json!({"type":"receipt","messageId":id,"ok":false,"error":e}),
    };
    queue(app, pair, g, controller, turn, payload, None)
}

fn launch_pump(app: &AppHandle, id: &str) {
    {
        let relay = app.state::<Relay>();
        let Ok(mut r) = relay.0.lock() else { return };
        let Some(g) = r.grants.get_mut(id) else {
            return;
        };
        if g.pumping {
            return;
        }
        g.pumping = true;
    }
    let (app, id) = (app.clone(), id.to_string());
    tauri::async_runtime::spawn(async move {
        pump(app, id).await;
    });
}

async fn pump(app: AppHandle, id: String) {
    loop {
        let snapshot = {
            let relay = app.state::<Relay>();
            let Ok(r) = relay.0.lock() else { return };
            let Some(g) = r.grants.get(&id) else { return };
            let sid = uuid::Uuid::new_v4().to_string();
            let status = encrypt(
                &g.secret,
                &aad(&id, "", "", "mac", &sid, "status"),
                &r.status,
            )
            .ok()
            .map(|envelope| json!({"id":sid,"envelope":envelope}));
            (
                g.secret.token.clone(),
                g.state.after,
                g.revoked,
                status,
                g.checked.as_ref().is_some_and(|t| {
                    t.server_now()
                        .is_none_or(|now| !recent(&g.view["lastSeen"], now))
                }),
            )
        };
        let (token, after, revoked, status, expired) = snapshot;
        if revoked {
            interrupt(&app, &id, "This connection was removed.");
            match request("revoke", Some(&token), json!({"pairId":id})).await {
                Ok(_) | Err((403 | 410, _)) => {
                    key_remove(&app, &id);
                    break;
                }
                Err(_) => {}
            }
            tokio::time::sleep(Duration::from_secs(10)).await;
            continue;
        }
        if expired {
            interrupt(
                &app,
                &id,
                "The connection was lost. Send the question again when both devices are online.",
            );
        }
        let sent = SystemTime::now();
        match request(
            "poll",
            Some(&token),
            json!({"pairId":id,"after":after.to_string(),"status":status}),
        )
        .await
        {
            Ok(out) => {
                if sent
                    .elapsed()
                    .ok()
                    .is_none_or(|elapsed| elapsed >= Duration::from_secs(12))
                {
                    let error = "The relay response expired. Reconnecting…";
                    set_error(&app, &id, error);
                    interrupt(&app, &id, error);
                    continue;
                }
                let view = match checked_pair(&id, &out) {
                    Ok(v) => v,
                    Err(e) => {
                        set_error(&app, &id, &e);
                        interrupt(&app, &id, &e);
                        break;
                    }
                };
                let checked = match ServerClock::capture(&view) {
                    Ok(clock) => clock,
                    Err(error) => {
                        set_error(&app, &id, &error);
                        interrupt(&app, &id, &error);
                        break;
                    }
                };
                let stale = checked.server_now().is_none_or(|now| {
                    !recent(&view["browserSeen"], now) || !recent(&view["lastSeen"], now)
                });
                let changed = {
                    let relay = app.state::<Relay>();
                    let Ok(mut r) = relay.0.lock() else { return };
                    let Some(g) = r.grants.get_mut(&id) else {
                        return;
                    };
                    let changed = g.view["controller"] != view["controller"]
                        || g.checked.as_ref().is_some_and(|t| t.server_now().is_none());
                    g.view = view.clone();
                    g.checked = Some(checked);
                    if !g.revoked {
                        g.error = None;
                    }
                    changed
                };
                if stale || changed || view["state"] != "active" {
                    interrupt(
                        &app,
                        &id,
                        "The browser disconnected or another tab took control.",
                    );
                }
                if view["state"] != "active" {
                    let relay = app.state::<Relay>();
                    if let Ok(mut r) = relay.0.lock() {
                        if let Some(g) = r.grants.get_mut(&id) {
                            revoke_local(&app, &id, g);
                        }
                    }
                    continue;
                }
                if !stale {
                    for m in out["commands"].as_array().into_iter().flatten() {
                        let seq = m["seq"]
                            .as_str()
                            .and_then(|v| v.parse::<u64>().ok())
                            .or_else(|| m["seq"].as_u64())
                            .unwrap_or(0);
                        let current = app
                            .state::<Relay>()
                            .0
                            .lock()
                            .ok()
                            .and_then(|r| r.grants.get(&id).map(|g| g.state.after))
                            .unwrap_or(0);
                        if seq <= current {
                            continue;
                        }
                        let (a, p, packet) = (app.clone(), id.clone(), m.clone());
                        let outcome =
                            tauri::async_runtime::spawn_blocking(move || command(&a, &p, &packet))
                                .await
                                .unwrap_or_else(|_| {
                                    Err("The Mac could not finish this command.".into())
                                });
                        if let Err(e) = outcome {
                            let _ = receipt(
                                &app,
                                &id,
                                m["controller"].as_str().unwrap_or(""),
                                m["turn"].as_str().unwrap_or(""),
                                m["id"].as_str().unwrap_or(""),
                                Err(e.clone()),
                            );
                            if m["kind"] == "start" {
                                let relay = app.state::<Relay>();
                                if let Ok(mut r) = relay.0.lock() {
                                    if let Some(g) = r.grants.get_mut(&id) {
                                        ended(
                                            &app,
                                            &id,
                                            g,
                                            m["controller"].as_str().unwrap_or(""),
                                            m["turn"].as_str().unwrap_or(""),
                                            "interrupted",
                                            &e,
                                        );
                                    }
                                }
                            }
                        }
                        let saved = {
                            let relay = app.state::<Relay>();
                            let Ok(mut r) = relay.0.lock() else { return };
                            let Some(g) = r.grants.get_mut(&id) else {
                                return;
                            };
                            let mut next = g.state.clone();
                            next.after = seq;
                            let result = atomic(
                                &disk(&app, &id).unwrap_or_default().join("state.json"),
                                &next,
                            );
                            if result.is_ok() {
                                g.state = next;
                            }
                            result
                        };
                        if let Err(e) = saved {
                            set_error(&app, &id, &e);
                            interrupt(&app, &id, &e);
                            break;
                        }
                    }
                }
                for _ in 0..4 {
                    match flush(&app, &id, &token).await {
                        Ok(0) => break,
                        Ok(_) => {}
                        Err((code, e)) => {
                            set_error(&app, &id, &e);
                            if matches!(code, 400 | 403 | 409 | 410 | 413 | 429) {
                                interrupt(&app, &id, &e);
                                let relay = app.state::<Relay>();
                                if let Ok(mut r) = relay.0.lock() {
                                    if let Some(g) = r.grants.get_mut(&id) {
                                        revoke_local(&app, &id, g);
                                    }
                                }
                            }
                            break;
                        }
                    }
                }
            }
            Err((403 | 410, e)) => {
                set_error(&app, &id, &e);
                interrupt(&app, &id, &e);
                let relay = app.state::<Relay>();
                if let Ok(mut r) = relay.0.lock() {
                    if let Some(g) = r.grants.get_mut(&id) {
                        revoke_local(&app, &id, g);
                    }
                }
                key_remove(&app, &id);
                break;
            }
            Err((_, e)) => set_error(&app, &id, &e),
        }
        let error = app
            .state::<Relay>()
            .0
            .lock()
            .ok()
            .and_then(|r| r.grants.get(&id).and_then(|g| g.error.clone()));
        if error
            .as_ref()
            .is_some_and(|e| e.contains("queue") || e.contains("durably") || e.contains("exceeded"))
        {
            interrupt(&app, &id, error.as_deref().unwrap());
        }
        let busy = app.state::<Relay>().0.lock().is_ok_and(|r| {
            r.grants
                .get(&id)
                .is_some_and(|g| !g.pending.is_empty() || g.turns.values().any(|t| !t.terminal))
        });
        tokio::time::sleep(Duration::from_millis(if busy { 250 } else { 2000 })).await;
    }
    let relay = app.state::<Relay>();
    if let Ok(mut r) = relay.0.lock() {
        if let Some(g) = r.grants.get_mut(&id) {
            g.pumping = false;
        }
    }
}

fn set_error(app: &AppHandle, id: &str, error: &str) {
    let relay = app.state::<Relay>();
    if let Ok(mut r) = relay.0.lock() {
        if let Some(g) = r.grants.get_mut(id) {
            g.error = Some(error.into());
        }
    }
}
async fn flush(app: &AppHandle, id: &str, token: &str) -> Result<usize, (u16, String)> {
    let batch = {
        let relay = app.state::<Relay>();
        let r = relay
            .0
            .lock()
            .map_err(|_| (0, "Connection unavailable.".into()))?;
        let g = r.grants.get(id).ok_or((0, "Connection removed.".into()))?;
        if g.pending.is_empty() {
            return Ok(0);
        }
        atomic(
            &disk(app, id).map_err(|e| (0, e))?.join("outbox.json"),
            &g.pending,
        )
        .map_err(|e| (0, e))?;
        let mut bytes = 0;
        g.pending
            .iter()
            .take(50)
            .take_while(|d| {
                bytes += d.event.to_string().len();
                bytes <= 900_000
            })
            .cloned()
            .collect::<Vec<_>>()
    };
    if batch.is_empty() {
        return Ok(0);
    }
    request("events",Some(token),json!({"pairId":id,"events":batch.iter().map(|d|&d.event).collect::<Vec<_>>(),"runs":batch.iter().filter_map(|d|d.run.as_ref()).collect::<Vec<_>>()})).await?;
    let relay = app.state::<Relay>();
    let mut r = relay
        .0
        .lock()
        .map_err(|_| (0, "Connection unavailable.".into()))?;
    let g = r
        .grants
        .get_mut(id)
        .ok_or((0, "Connection removed.".into()))?;
    for _ in 0..batch.len() {
        if let Some(delivery) = g.pending.pop_front() {
            g.pending_bytes -= delivery.event.to_string().len();
        }
    }
    atomic(
        &disk(app, id).map_err(|e| (0, e))?.join("outbox.json"),
        &g.pending,
    )
    .map_err(|e| (0, e))?;
    Ok(batch.len())
}

pub fn setup(app: &AppHandle) {
    let watcher = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let expired = watcher
                .state::<Relay>()
                .0
                .lock()
                .map(|r| {
                    r.grants
                        .iter()
                        .filter(|(_, g)| {
                            g.turns
                                .values()
                                .any(|t| !t.terminal && !authorized(g, &t.controller))
                        })
                        .map(|(id, _)| id.clone())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            for id in expired {
                interrupt(
                    &watcher,
                    &id,
                    "The connection lease ended. Send the question again when both devices are online.",
                );
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Ok(dir) = root(&app) {
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let id = entry.file_name().to_string_lossy().into_owned();
                    if !uid(&id) {
                        continue;
                    }
                    let state: Saved = std::fs::read(entry.path().join("state.json"))
                        .ok()
                        .and_then(|b| serde_json::from_slice(&b).ok())
                        .unwrap_or_default();
                    let view: Value = std::fs::read(entry.path().join("view.json"))
                        .ok()
                        .and_then(|b| serde_json::from_slice(&b).ok())
                        .unwrap_or(json!({"id":id,"state":"revoked"}));
                    let secret = match key_read(&app, &id) {
                        Ok(s) => s,
                        Err(_) => continue,
                    };
                    let pending: VecDeque<Delivery> =
                        std::fs::read(entry.path().join("outbox.json"))
                            .ok()
                            .and_then(|b| serde_json::from_slice(&b).ok())
                            .unwrap_or_default();
                    let pending_bytes = pending.iter().map(|d| d.event.to_string().len()).sum();
                    let revoked = state.revoked || secret.revoked;
                    let mut g = Grant {
                        secret,
                        view,
                        state: state.clone(),
                        pending,
                        pending_bytes,
                        turns: HashMap::new(),
                        checked: None,
                        error: None,
                        revoked,
                        pumping: false,
                    };
                    if let Ok(starts) = std::fs::read_dir(entry.path().join("starts")) {
                        for start in starts.flatten() {
                            if let Ok(bytes) = std::fs::read(start.path()) {
                                if let Ok(s) = serde_json::from_slice::<Started>(&bytes) {
                                    if !s.terminal {
                                        ended(
                                            &app,
                                            &id,
                                            &mut g,
                                            &s.controller,
                                            &s.turn,
                                            "interrupted",
                                            "LeadingLight restarted; this question was not run again.",
                                        );
                                    }
                                }
                            }
                        }
                    }
                    let run = g.revoked || g.view["state"] == "active";
                    if let Ok(mut r) = app.state::<Relay>().0.lock() {
                        r.grants.insert(id.clone(), g);
                    }
                    if run {
                        launch_pump(&app, &id);
                    }
                }
            }
        }
        loop {
            let enabled = app.state::<Relay>().0.lock().is_ok_and(|r| {
                r.grants
                    .values()
                    .any(|g| !g.revoked && g.view["state"] == "active")
            });
            if enabled {
                let mut claude=tokio::time::timeout(Duration::from_secs(12),agent::agent_status()).await.ok().and_then(|s|serde_json::to_value(s).ok()).unwrap_or(json!({"installed":false,"logged_in":false,"error":"Claude Code did not answer."}));
                if !claude["error"].is_null() {
                    claude["error"] =
                        json!("Claude Code is not ready. Check its sign-in on this Mac.");
                }
                let codex =
                    tokio::time::timeout(Duration::from_secs(20), crate::clis::codex_status())
                        .await
                        .ok()
                        .and_then(Result::ok)
                        .unwrap_or(json!({"error":"Codex did not answer."}));
                if let Ok(mut r) = app.state::<Relay>().0.lock() {
                    let status = json!({"claude":claude,"codex":codex});
                    r.status = if status.to_string().len() <= 40_000 {
                        status
                    } else {
                        json!({"claude":status["claude"],"codex":{"error":"Codex returned too many model details. Check its configuration on this Mac."}})
                    };
                }
            }
            tokio::time::sleep(Duration::from_secs(if enabled { 30 } else { 2 })).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ciphertext_is_bound_to_every_routing_field() {
        let secret = Secret {
            key: URL_SAFE_NO_PAD.encode([7; 32]),
            token: "unused".into(),
            revoked: false,
        };
        let context = aad("pair", "browser", "turn", "mac", "event", "event");
        // This fixture was encrypted by Node's AES-GCM, with the browser's JSON AAD and tag layout.
        let web = json!({"v":1,"iv":"CQkJCQkJCQkJCQkJ","data":"XKf05teGoBXFQPEaiIXXuvbNUbS9J1anYJXp0W/tHWHsLQ=="});
        assert_eq!(decrypt(&secret, &context, &web).unwrap()["private"], "note");
        let e = encrypt(&secret, &context, &json!({"private":"note"})).unwrap();
        assert_eq!(decrypt(&secret, &context, &e).unwrap()["private"], "note");
        for altered in [
            aad("other", "browser", "turn", "mac", "event", "event"),
            aad("pair", "other", "turn", "mac", "event", "event"),
            aad("pair", "browser", "other", "mac", "event", "event"),
            aad("pair", "browser", "turn", "browser", "event", "event"),
            aad("pair", "browser", "turn", "mac", "other", "event"),
            aad("pair", "browser", "turn", "mac", "event", "reply"),
        ] {
            assert!(decrypt(&secret, &altered, &e).is_err());
        }
    }
    #[test]
    fn durable_start_marker_never_relaunches_an_uncertain_turn() {
        let dir =
            std::env::temp_dir().join(format!("leadinglight-relay-test-{}", uuid::Uuid::new_v4()));
        assert!(start_once(&dir, "controller", "turn").unwrap());
        assert!(!start_once(&dir, "controller", "turn").unwrap());
        let record: Started =
            serde_json::from_slice(&std::fs::read(dir.join("turn.json")).unwrap()).unwrap();
        assert!(!record.terminal);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn server_clock_ignores_offset_but_expires_after_sleep_or_rollback() {
        let server_ms = 1_800_000_000_000;
        for offset in [-86_400, 86_400] {
            let clock = ServerClock {
                server_ms,
                received: std::time::UNIX_EPOCH
                    + Duration::from_secs((server_ms / 1_000 + offset) as u64),
                monotonic: Instant::now(),
            };
            assert_eq!(
                clock.server_now_at(
                    clock.received + Duration::from_secs(10),
                    clock.monotonic + Duration::from_secs(10)
                ),
                Some(server_ms + 10_000)
            );
            assert!(clock
                .server_now_at(
                    clock.received + Duration::from_secs(60),
                    clock.monotonic + Duration::from_secs(1)
                )
                .is_none());
            assert!(clock
                .server_now_at(clock.received - Duration::from_secs(1), clock.monotonic)
                .is_none());
            assert!(clock
                .server_now_at(
                    clock.received + Duration::from_secs(10),
                    clock.monotonic + Duration::from_secs(20)
                )
                .is_none());
        }
        assert!(ServerClock::capture(&json!({"serverTime":"invalid"})).is_err());
    }

    #[test]
    fn revoked_expired_and_taken_over_connections_cannot_run_commands() {
        let stamp = "2026-10-29T00:00:00.000Z";
        let view = json!({"state":"active","controller":"browser","lastSeen":stamp,"browserSeen":stamp,"serverTime":stamp});
        let checked = ServerClock::capture(&view).unwrap();
        let mut g = Grant {
            secret: Secret {
                key: String::new(),
                token: String::new(),
                revoked: false,
            },
            view,
            state: Saved::default(),
            pending: VecDeque::new(),
            pending_bytes: 0,
            turns: HashMap::new(),
            checked: Some(checked),
            error: None,
            revoked: false,
            pumping: false,
        };
        assert!(authorized(&g, "browser"));
        assert!(start_fresh(
            &g,
            &json!({"expiresAt":"2026-10-29T00:00:30.000Z"})
        ));
        assert!(!start_fresh(&g, &json!({"expiresAt":stamp})));
        delivery_failed(&mut g, "The connection output queue is full.".into());
        assert!(!authorized(&g, "browser"));
        assert!(g.state.revoked && g.secret.revoked);
        assert!(g.error.as_deref().unwrap().contains("queue"));
        g.revoked = false;
        g.state.revoked = false;
        g.secret.revoked = false;
        assert!(!authorized(&g, "other"));
        g.revoked = true;
        assert!(!authorized(&g, "browser"));
        g.revoked = false;
        g.checked.as_mut().unwrap().received -= Duration::from_secs(LEASE);
        assert!(!authorized(&g, "browser"));
        assert!(!start_fresh(
            &g,
            &json!({"expiresAt":"2026-10-29T00:00:30.000Z"})
        ));
        g.checked = Some(ServerClock::capture(&g.view).unwrap());
        g.view["lastSeen"] = json!("2026-10-28T23:59:00.000Z");
        assert!(!authorized(&g, "browser"));
        g.view["lastSeen"] = json!(stamp);
        g.view["browserSeen"] = json!("2026-10-28T23:59:00.000Z");
        assert!(!authorized(&g, "browser"));
    }
}
