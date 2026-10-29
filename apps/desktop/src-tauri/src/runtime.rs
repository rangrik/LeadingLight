// The project runtime (DECISIONS.md, 18): our own berthd, started from here. Quit leaves it
// running while a turn or a run is going, so they carry on, and stops it otherwise. The webview
// reaches it only through these commands, which speak HTTP to its socket.
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

#[derive(Clone, Serialize)]
pub struct Status {
    state: &'static str,
    version: Option<String>,
    error: Option<String>,
    home: String,
}

#[derive(Default)]
pub struct Runtime {
    status: Mutex<Option<Status>>,
    // One start at a time; the others wait for its answer.
    starting: Mutex<()>,
    // A stream's connection once open; None while it starts the runtime and connects.
    streams: Mutex<HashMap<u64, Option<UnixStream>>>,
    next: AtomicU64,
}

fn home(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap_or_default().join("runtime")
}

fn socket(home: &Path) -> PathBuf {
    home.join("box").join("berthd.sock")
}

// berthd and tmux sit beside the app's own executable (externalBin in tauri.conf.json).
fn bundled(name: &str) -> Option<PathBuf> {
    let p = std::env::current_exe().ok()?.parent()?.join(name);
    p.is_file().then_some(p)
}

// "berthd v0.3.30-ll.5+94aedec3 (build dbbf20a1e075, darwin/arm64)": the version names the patch
// set and the build the exact binary. A running berthd says its build from its file, so both count.
fn build_of(bin: &Path) -> Option<(String, String)> {
    let out = Command::new(bin).arg("version").output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    let version = text.split_whitespace().nth(1)?.to_string();
    let build = text.split("build ").nth(1)?.split([',', ')']).next()?.trim().to_string();
    Some((version, build))
}

// A name and a block of ports of this app's own, so the real app, a dev app and the person's
// Shipyard never share a tmux server or a port.
fn instance(home: &Path) -> (String, u32) {
    let h = home.to_string_lossy().bytes().fold(0xcbf29ce484222325u64, |h, b| (h ^ b as u64).wrapping_mul(0x100000001b3));
    let dev = !home.to_string_lossy().contains("/com.leadinglight.app/");
    (format!("leadinglight-{:08x}", h as u32), if dev { 46100 + 100 * (h % 19) as u32 } else { 46000 })
}

pub fn request(sock: &Path, method: &str, path: &str, body: Option<&[u8]>, timeout: Duration) -> Result<(u16, Vec<u8>), String> {
    let mut s = UnixStream::connect(sock).map_err(|e| e.to_string())?;
    s.set_read_timeout(Some(timeout)).map_err(|e| e.to_string())?;
    let body = body.unwrap_or(&[]);
    let head = format!("{method} {path} HTTP/1.1\r\nHost: box\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
    s.write_all(head.as_bytes()).and_then(|_| s.write_all(body)).map_err(|e| e.to_string())?;
    let mut r = BufReader::new(s);
    let (status, chunked) = read_head(&mut r)?;
    let mut out = Vec::new();
    if chunked {
        read_chunks(&mut r, |data| {
            out.extend_from_slice(data);
            true
        })?;
    } else {
        r.read_to_end(&mut out).map_err(|e| e.to_string())?;
    }
    Ok((status, out))
}

fn read_head(r: &mut impl BufRead) -> Result<(u16, bool), String> {
    let mut line = String::new();
    r.read_line(&mut line).map_err(|e| e.to_string())?;
    let status = line.split_whitespace().nth(1).and_then(|s| s.parse().ok()).ok_or("no answer from the runtime")?;
    let mut chunked = false;
    loop {
        line.clear();
        if r.read_line(&mut line).map_err(|e| e.to_string())? == 0 || line == "\r\n" {
            return Ok((status, chunked));
        }
        let l = line.to_ascii_lowercase();
        chunked |= l.starts_with("transfer-encoding:") && l.contains("chunked");
    }
}

// Each chunk as it comes; on returns false to stop.
fn read_chunks(r: &mut impl BufRead, mut on: impl FnMut(&[u8]) -> bool) -> Result<(), String> {
    let mut line = String::new();
    loop {
        line.clear();
        r.read_line(&mut line).map_err(|e| e.to_string())?;
        let n = usize::from_str_radix(line.trim(), 16).map_err(|_| "bad chunk from the runtime")?;
        if n == 0 {
            return Ok(());
        }
        let mut data = vec![0; n + 2];
        r.read_exact(&mut data).map_err(|e| e.to_string())?;
        if !on(&data[..n]) {
            return Ok(());
        }
    }
}

fn get(sock: &Path, path: &str, wait: Duration) -> Option<Value> {
    let (code, body) = request(sock, "GET", path, None, wait).ok()?;
    (code == 200).then(|| serde_json::from_slice(&body).ok()).flatten()
}

fn info(sock: &Path) -> Option<Value> {
    get(sock, "/v1/info", Duration::from_secs(3))
}

fn set(rt: &Runtime, home: &Path, state: &'static str, version: Option<String>, error: Option<String>) -> Status {
    let s = Status { state, version, error, home: home.to_string_lossy().into() };
    *rt.status.lock().unwrap() = Some(s.clone());
    s
}

// The runtime running this app's build: the one already there, or a new one in place of an
// older build. Its agents run under tmux and outlive both.
fn ensure(app: &AppHandle, rt: &Runtime, restart: bool) -> Status {
    let _one = rt.starting.lock().unwrap();
    let home = home(app);
    let sock = socket(&home);
    let Some(bin) = bundled("berthd") else {
        return set(rt, &home, "failed", None, Some("This build has no runtime; run pnpm runtime:build.".into()));
    };
    let Some((want_version, want)) = build_of(&bin) else {
        return set(rt, &home, "failed", None, Some(format!("{} doesn't run", bin.display())));
    };
    let version = |i: &Value| i["version"].as_str().map(String::from);
    if let Some(i) = info(&sock) {
        if !restart && i["build"].as_str() == Some(want.as_str()) && i["version"].as_str() == Some(want_version.as_str()) {
            return set(rt, &home, "ready", version(&i), None);
        }
        if i["build"].as_str() != Some(want.as_str()) {
            backup(&home, i["build"].as_str().unwrap_or("unknown"));
        }
        stop(&home, &sock, Duration::from_secs(10));
    }
    let dir = match install(&home, &want, &bin) {
        Ok(dir) => dir,
        Err(e) => return set(rt, &home, "failed", None, Some(e)),
    };
    let mut path = vec![dir.clone()];
    path.extend(crate::clis::shell_path().iter().cloned());
    let (tmux_name, ports) = instance(&home);
    let _ = std::fs::create_dir_all(home.join("user"));
    let log = std::fs::OpenOptions::new().create(true).append(true).open(home.join("berthd.log"));
    let mut c = Command::new(dir.join("berthd"));
    c.args(["serve", "--listen", "127.0.0.1:0"]).env_clear();
    // SSH_AUTH_SOCK: git clones and pushes reach the person's SSH agent.
    for key in ["HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "SSH_AUTH_SOCK"] {
        if let Some(v) = std::env::var_os(key) {
            c.env(key, v);
        }
    }
    c.env("LANG", "en_US.UTF-8")
        .env("PATH", std::env::join_paths(path).unwrap_or_default())
        .env("BERTH_HOME", &home)
        .env("BERTH_USER_DIR", home.join("user"))
        .env("BERTH_TMUX_SOCKET", &tmux_name)
        .env("BERTH_PORT_BASE", ports.to_string())
        .env("BERTH_EMBEDDED", "1")
        .stdin(Stdio::null())
        // Its own process group: quitting the app doesn't end it.
        .process_group(0);
    if let Ok(f) = log {
        if let Ok(g) = f.try_clone() {
            c.stdout(f).stderr(g);
        }
    }
    let child = match c.spawn() {
        Ok(child) => child,
        Err(e) => return set(rt, &home, "failed", None, Some(e.to_string())),
    };
    let _ = std::fs::write(home.join("berthd.pid"), child.id().to_string());
    // What scripts/install-dev-app.sh --remove stops before it takes the data away.
    let _ = std::fs::write(home.join("instance"), format!("tmux={tmux_name}\nports={ports}\n"));
    let until = Instant::now() + Duration::from_secs(20);
    while Instant::now() < until {
        if let Some(i) = info(&sock) {
            return set(rt, &home, "ready", version(&i), None);
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    let tail = std::fs::read_to_string(home.join("berthd.log")).unwrap_or_default();
    let last = tail.lines().last().unwrap_or("it didn't answer").to_string();
    set(rt, &home, "failed", None, Some(last))
}

// The build's berthd and tmux, copied out of the app: an update replaces the app while they
// run, and a tmux client must match its server. The last two builds stay, for rolling back.
fn install(home: &Path, build: &str, bin: &Path) -> Result<PathBuf, String> {
    let root = home.join("bin");
    let dir = root.join(build);
    if !dir.join("berthd").is_file() {
        let tmp = root.join(format!(".{build}.tmp"));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
        std::fs::copy(bin, tmp.join("berthd")).map_err(|e| e.to_string())?;
        if let Some(tmux) = bundled("tmux") {
            std::fs::copy(tmux, tmp.join("tmux")).map_err(|e| e.to_string())?;
        }
        std::fs::rename(&tmp, &dir).map_err(|e| e.to_string())?;
    }
    let mut old: Vec<_> = std::fs::read_dir(&root).map_err(|e| e.to_string())?.flatten().filter(|e| e.file_name() != build && !e.file_name().to_string_lossy().starts_with('.')).collect();
    old.sort_by_key(|e| std::cmp::Reverse(e.metadata().and_then(|m| m.modified()).ok()));
    for e in old.iter().skip(1) {
        let _ = std::fs::remove_dir_all(e.path());
    }
    Ok(dir)
}

// The state files as an older build left them, before a newer one reads and may change them.
fn backup(home: &Path, build: &str) {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let to = home.join("backups").join(format!("{secs}-{build}"));
    let Ok(files) = std::fs::read_dir(home.join("box")) else { return };
    if std::fs::create_dir_all(&to).is_err() {
        return;
    }
    for f in files.flatten().filter(|f| f.path().extension().is_some_and(|x| x == "json")) {
        let _ = std::fs::copy(f.path(), to.join(f.file_name()));
    }
}

// It ends, waited for up to `wait`; its agents keep running in tmux and the next one follows them.
fn stop(home: &Path, sock: &Path, wait: Duration) {
    let Some(pid) = std::fs::read_to_string(home.join("berthd.pid")).ok().and_then(|s| s.trim().parse::<i32>().ok()) else {
        return;
    };
    let _ = Command::new("/bin/kill").args(["-TERM", &pid.to_string()]).status();
    let until = Instant::now() + wait;
    while Instant::now() < until && info(sock).is_some() {
        std::thread::sleep(Duration::from_millis(100));
    }
}

// Nothing going: no agent mid-turn and no run berthd still has to finish. An unread answer keeps it.
fn idle(sessions: Option<Value>, runs: Option<Value>) -> bool {
    let (Some(Value::Array(s)), Some(Value::Array(r))) = (sessions, runs) else { return false };
    let turn = s.iter().any(|s| s["agent_state"] == "running" && s["exited"] != true);
    let run = r.iter().any(|r| !matches!(r["status"].as_str(), Some("succeeded" | "failed" | "cancelled" | "interrupted")));
    !turn && !run
}

// On Quit, after the windows saved: an idle runtime stops without a wait, so the quit never hangs.
pub fn quit(app: &AppHandle) {
    let home = home(app);
    let sock = socket(&home);
    let read = |path: &str| get(&sock, path, Duration::from_secs(1));
    if idle(read("/v1/sessions"), read("/v1/runs?status=active")) {
        stop(&home, &sock, Duration::ZERO);
    }
}

// Started with the app once the person has used projects, so runs left going carry on.
pub fn setup(app: &AppHandle) {
    if !home(app).join("box").exists() {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let rt = app.state::<Runtime>();
        ensure(&app, &rt, false);
    });
}

#[tauri::command]
pub async fn runtime_status(app: AppHandle, start: bool, restart: bool) -> Status {
    tauri::async_runtime::spawn_blocking(move || {
        let rt = app.state::<Runtime>();
        let known = rt.status.lock().unwrap().clone();
        match known {
            Some(s) if !start && !restart => s,
            Some(s) if s.state == "ready" && !restart => s,
            _ if start || restart => ensure(&app, &rt, restart),
            _ => Status { state: "stopped", version: None, error: None, home: home(&app).to_string_lossy().into() },
        }
    })
    .await
    .unwrap_or_else(|e| Status { state: "failed", version: None, error: Some(e.to_string()), home: String::new() })
}

#[derive(Serialize)]
pub struct Reply {
    status: u16,
    body: Value,
}

#[tauri::command]
pub async fn runtime_call(app: AppHandle, method: String, path: String, body: Option<Value>) -> Result<Reply, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let rt = app.state::<Runtime>();
        let ready = matches!(rt.status.lock().unwrap().as_ref(), Some(s) if s.state == "ready");
        if !ready && ensure(&app, &rt, false).state != "ready" {
            return Err("The project runtime isn't running.".to_string());
        }
        let bytes = body.map(|b| b.to_string().into_bytes());
        let sock = socket(&home(&app));
        let (status, out) = match request(&sock, &method, &path, bytes.as_deref(), Duration::from_secs(120)) {
            Ok(r) => r,
            // Gone since it was last seen: started again once, then asked again.
            Err(_) => {
                ensure(&app, &rt, false);
                request(&sock, &method, &path, bytes.as_deref(), Duration::from_secs(120))?
            }
        };
        let body = serde_json::from_slice(&out).unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&out).into()));
        Ok(Reply { status, body })
    })
    .await
    .map_err(|e| e.to_string())?
}

// A streamed answer, one line each, until runtime_stream_stop or it ends: the runtime's events, or
// a clone's progress. Stopping closes the connection, so berthd stops the work as well.
#[tauri::command]
pub fn runtime_stream(app: AppHandle, rt: State<'_, Runtime>, method: String, path: String, body: Option<Value>, quiet: u64, on: Channel<String>) -> u64 {
    let id = rt.next.fetch_add(1, Ordering::Relaxed);
    rt.streams.lock().unwrap().insert(id, None);
    std::thread::spawn(move || {
        // The runtime starts first if it isn't running, as a call would; a stop meanwhile wins.
        let connect = || -> Result<UnixStream, String> {
            let rt = app.state::<Runtime>();
            let ready = matches!(rt.status.lock().unwrap().as_ref(), Some(s) if s.state == "ready");
            if !ready && ensure(&app, &rt, false).state != "ready" {
                return Err("The project runtime isn't running.".into());
            }
            let s = UnixStream::connect(socket(&home(&app))).map_err(|e| e.to_string())?;
            match rt.streams.lock().unwrap().get_mut(&id) {
                Some(slot) => *slot = Some(s.try_clone().map_err(|e| e.to_string())?),
                None => return Err("stopped".into()),
            }
            Ok(s)
        };
        let run = |mut s: UnixStream| -> Result<(), String> {
            // Silence past quiet seconds is a lost stream (berthd's events say something every 25 s).
            s.set_read_timeout(Some(Duration::from_secs(quiet))).map_err(|e| e.to_string())?;
            let bytes = body.map(|b| b.to_string().into_bytes()).unwrap_or_default();
            let head = format!("{method} {path} HTTP/1.1\r\nHost: box\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", bytes.len());
            s.write_all(head.as_bytes()).and_then(|_| s.write_all(&bytes)).map_err(|e| e.to_string())?;
            let mut r = BufReader::new(s);
            let (_, chunked) = read_head(&mut r)?;
            let mut pending = Vec::new();
            let mut lines = |data: &[u8]| {
                pending.extend_from_slice(data);
                while let Some(i) = pending.iter().position(|&b| b == b'\n') {
                    let line: Vec<u8> = pending.drain(..=i).collect();
                    let line = String::from_utf8_lossy(&line).trim().to_string();
                    if !line.is_empty() && on.send(line).is_err() {
                        return false;
                    }
                }
                true
            };
            if chunked {
                return read_chunks(&mut r, lines);
            }
            // A refusal comes whole, not streamed: one line.
            let mut all = Vec::new();
            r.read_to_end(&mut all).map_err(|e| e.to_string())?;
            all.push(b'\n');
            lines(&all);
            Ok(())
        };
        let _ = connect().and_then(run);
        // An empty line is the end; the webview asks again from its last event.
        let _ = on.send(String::new());
        app.state::<Runtime>().streams.lock().unwrap().remove(&id);
    });
    id
}

#[tauri::command]
pub fn runtime_stream_stop(rt: State<'_, Runtime>, id: u64) {
    if let Some(Some(s)) = rt.streams.lock().unwrap().remove(&id) {
        let _ = s.shutdown(std::net::Shutdown::Both);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // berthd answers short replies with a length and long ones and its events in chunks.
    #[test]
    fn reads_chunked_and_plain_answers() {
        let chunked = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n6\r\n{\"a\":1\r\n2\r\n}\n\r\n0\r\n\r\n";
        let mut r = BufReader::new(&chunked[..]);
        assert_eq!(read_head(&mut r).unwrap(), (200, true));
        let mut out = Vec::new();
        read_chunks(&mut r, |d| {
            out.extend_from_slice(d);
            true
        })
        .unwrap();
        assert_eq!(out, b"{\"a\":1}\n");
        let plain = b"HTTP/1.1 409 Conflict\r\nContent-Length: 2\r\n\r\n{}";
        let mut r = BufReader::new(&plain[..]);
        assert_eq!(read_head(&mut r).unwrap(), (409, false));
    }

    // Quit must never stop a runtime with a turn or a run going; shapes as berthd answers them.
    #[test]
    fn idle_only_when_nothing_is_going() {
        let j = |s: &str| serde_json::from_str::<Value>(s).ok();
        let shell = r#"[{"name":"shell1","command":"sleep 900","attached":0,"exited":false}]"#;
        let settled = r#"[{"name":"a","agent_state":"waiting","exited":false},{"name":"b","agent_state":"running","exited":true}]"#;
        assert!(idle(j("[]"), j("[]")));
        assert!(idle(j(shell), j(r#"[{"id":"r_1","status":"cancelled"}]"#)));
        assert!(idle(j(settled), j("[]")));
        assert!(!idle(j(r#"[{"name":"a","agent_state":"running","exited":false}]"#), j("[]")));
        assert!(!idle(j("[]"), j(r#"[{"id":"r_1","template":"exec","status":"running"}]"#)));
        assert!(!idle(None, j("[]")));
    }
}
