// Claude, through the Claude Code the person installed and signed into: one `claude -p` per
// turn, speaking stream-json both ways, resumed for follow-ups. The app holds no key; keys in
// our environment are dropped so the sign-in wins (what synara does). The page tools are an
// MCP server the webview answers over the same control protocol, as the Agent SDK does, so
// this file only pipes lines: Claude Code's out to the webview, the webview's replies in.
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

// The turns running, by id: the process, and its input until the turn's result.
#[derive(Default)]
pub struct Agents(Mutex<HashMap<String, Turn>>);

pub struct Turn {
    child: Child,
    stdin: Option<Arc<Mutex<ChildStdin>>>,
}

#[derive(Serialize)]
pub struct Status {
    installed: bool,
    logged_in: bool,
    email: Option<String>,
    plan: Option<String>,
    version: Option<String>,
    error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    Line { line: Value },
    Error { message: String },
}

#[derive(Deserialize, Clone)]
pub struct Ask {
    pub id: String,
    pub prompt: String,
    pub system: String,
    pub model: String,
    pub effort: String,
    pub access: String,
    pub resume: Option<String>,
    // "codex" for GPT models; Claude otherwise.
    #[serde(default)]
    pub provider: String,
    // A tail turn (lib/tail.ts): no tools at all, since the app acts on a nod, never the model.
    #[serde(default)]
    pub tail: bool,
}

pub type Sink = Arc<dyn Fn(Event) + Send + Sync>;

// Reading needs no asking; the rest follows the access the person chose. Anything unknown asks.
const READS: &str = "mcp__notes__read_page,mcp__notes__search_pages";
fn access(mode: &str) -> &'static [&'static str] {
    match mode {
        "auto" => &["--permission-mode", "auto", "--tools", "WebSearch,WebFetch"],
        "full" => &[
            "--permission-mode",
            "bypassPermissions",
            "--allow-dangerously-skip-permissions",
            "--tools",
            "WebSearch,WebFetch",
        ],
        "plan" => &[
            "--permission-mode",
            "plan",
            "--tools",
            "WebSearch,WebFetch,ExitPlanMode",
        ],
        _ => &[
            "--permission-mode",
            "default",
            "--tools",
            "WebSearch,WebFetch",
        ],
    }
}

// Where Claude Code is, found as Terminal finds it (clis.rs), and run with no API key so the sign-in wins.
fn binary() -> Option<PathBuf> {
    crate::clis::find("claude")
}

fn command(bin: &PathBuf) -> Command {
    crate::clis::tool_command(bin)
}

fn not_installed() -> Status {
    Status {
        installed: false,
        logged_in: false,
        email: None,
        plan: None,
        version: None,
        error: None,
    }
}

fn status() -> Status {
    let Some(bin) = binary() else {
        return not_installed();
    };
    let version = command(&bin)
        .arg("--version")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    match command(&bin).args(["auth", "status"]).output() {
        Ok(out) => {
            let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
            match serde_json::from_str::<serde_json::Value>(&text) {
                Ok(v) => Status {
                    installed: true,
                    logged_in: v["loggedIn"].as_bool().unwrap_or(false),
                    email: v["email"].as_str().map(String::from),
                    plan: v["subscriptionType"].as_str().map(String::from),
                    version,
                    error: None,
                },
                Err(_) => Status {
                    installed: true,
                    logged_in: false,
                    email: None,
                    plan: None,
                    version,
                    error: Some(format!(
                        "{text} {}",
                        String::from_utf8_lossy(&out.stderr).trim()
                    )),
                },
            }
        }
        Err(e) => Status {
            installed: true,
            logged_in: false,
            email: None,
            plan: None,
            version,
            error: Some(e.to_string()),
        },
    }
}

#[tauri::command]
pub async fn agent_status() -> Status {
    tauri::async_runtime::spawn_blocking(status)
        .await
        .unwrap_or_else(|e| Status {
            error: Some(e.to_string()),
            ..not_installed()
        })
}

// One line of the protocol into a running turn; a turn already over takes nothing.
fn write_line(agents: &Agents, id: &str, line: &Value) -> Result<(), String> {
    let pipe = agents
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(id)
        .and_then(|t| t.stdin.clone())
        .ok_or("This agent turn has ended.")?;
    // A full stdin pipe must never hold the process map needed to cancel its child.
    let mut stdin = pipe
        .lock()
        .map_err(|_| "This agent input is unavailable.")?;
    writeln!(stdin, "{line}").map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_ask(app: AppHandle, ask: Ask, on_event: Channel<Event>) -> Result<(), String> {
    start(
        app,
        ask,
        Arc::new(move |e| {
            let _ = on_event.send(e);
        }),
    )
}

pub fn start(app: AppHandle, ask: Ask, sink: Sink) -> Result<(), String> {
    start_in(app, ask, sink, None)
}

pub fn start_remote(
    app: AppHandle,
    ask: Ask,
    sink: Sink,
    allowed: impl Fn() -> bool,
) -> Result<(), String> {
    start_in(app, ask, sink, Some(&allowed))
}

fn start_in(
    app: AppHandle,
    ask: Ask,
    sink: Sink,
    allowed: Option<&dyn Fn() -> bool>,
) -> Result<(), String> {
    // Its own folder and no settings, so the note's question never loads a project's hooks or memory.
    let cwd = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("agent");
    std::fs::create_dir_all(&cwd).map_err(|e| e.to_string())?;
    // GPT goes through Codex's app server, which the webview drives from its initialize on
    // (lib/turn.ts); its turn ends with turn/completed rather than a result.
    let codex = ask.provider == "codex";
    let scoped_codex = codex && allowed.is_some();
    let mut scoped_flags = Vec::new();
    let name = if codex { "Codex" } else { "Claude Code" };
    let mut c = if codex {
        let bin = crate::clis::find("codex").ok_or("Codex is not installed")?;
        let mut c = crate::clis::codex_server(&bin);
        if scoped_codex {
            let child = crate::clis::tool_command(&bin)
                .args(["features", "list"])
                .current_dir(&cwd)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|_| "Could not inspect Codex's tools.")?;
            let timeout = crate::clis::watchdog(child.id(), 8);
            let out = child
                .wait_with_output()
                .map_err(|_| "Could not inspect Codex's tools.")?;
            drop(timeout);
            if !out.status.success() {
                return Err("Update Codex on this Mac before connecting a browser.".into());
            }
            scoped_flags = crate::agent_guard::codex_flags(&String::from_utf8_lossy(&out.stdout))?;
            for (flag, name) in &scoped_flags {
                c.args([*flag, name]);
            }
            let child = crate::clis::tool_command(&bin)
                .args([
                    "mcp",
                    "list",
                    "--json",
                    "--disable",
                    "plugins",
                    "--disable",
                    "apps",
                    "--disable",
                    "hooks",
                ])
                .current_dir(&cwd)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|_| "Could not inspect Codex's integrations.")?;
            let timeout = crate::clis::watchdog(child.id(), 8);
            let out = child
                .wait_with_output()
                .map_err(|_| "Could not inspect Codex's integrations.")?;
            drop(timeout);
            if !out.status.success() {
                return Err("Could not safely disable Codex's configured integrations.".into());
            }
            let list: Value = serde_json::from_slice(&out.stdout)
                .map_err(|_| "Could not inspect Codex's integrations.")?;
            c.args([
                "-c",
                &crate::agent_guard::codex_mcp_override(&list)?,
                "-c",
                "notify=[]",
            ]);
        }
        // The app passes a tail thread no tools; this takes web search away too.
        if ask.tail {
            c.args(["-c", "web_search=\"disabled\""]);
        }
        c
    } else {
        let bin = binary().ok_or("Claude Code is not installed")?;
        let mcp =
            json!({ "mcpServers": { "notes": { "type": "sdk", "name": "notes" } } }).to_string();
        let mut c = command(&bin);
        if ask.tail {
            c.args([
                "-p",
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--verbose",
                "--setting-sources",
                "",
                "--strict-mcp-config",
                "--tools",
                "",
            ]);
        } else {
            c.args([
                "-p",
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages",
            ])
            .args([
                "--setting-sources",
                "",
                "--permission-prompt-tool",
                "stdio",
                "--strict-mcp-config",
                "--mcp-config",
                &mcp,
                "--allowedTools",
                READS,
            ])
            .args(access(&ask.access));
        }
        c.args([
            "--system-prompt",
            &ask.system,
            "--model",
            &ask.model,
            "--effort",
            &ask.effort,
        ]);
        if let Some(session) = &ask.resume {
            c.args(["--resume", session]);
        }
        c
    };
    c.current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0);
    if allowed.is_some_and(|check| !check()) {
        return Err("The browser connection expired before the agent could start.".into());
    }
    let agents = app.state::<Agents>();
    let mut running = agents.0.lock().map_err(|e| e.to_string())?;
    if running.contains_key(&ask.id) {
        return Err("This agent turn has already started.".into());
    }
    let mut child = c.spawn().map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let mut stderr = child.stderr.take().ok_or("no stderr")?;
    let stdin = child.stdin.take().map(|s| Arc::new(Mutex::new(s)));
    let id = ask.id.clone();
    running.insert(id.clone(), Turn { child, stdin });
    drop(running);
    if allowed.is_some_and(|check| !check()) {
        stop(&app, &id)?;
        return Err("The browser connection ended while the agent was starting.".into());
    }
    let mut bootstrap_timeout = scoped_codex.then(|| {
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        let (app, id, sink) = (app.clone(), id.clone(), sink.clone());
        std::thread::spawn(move || {
            if matches!(rx.recv_timeout(std::time::Duration::from_secs(12)), Err(std::sync::mpsc::RecvTimeoutError::Timeout)) {
                let _ = stop(&app, &id);
                sink(Event::Error { message: "Codex could not verify its note-only configuration before the startup deadline.".into() });
            }
        });
        tx
    });

    // Read before writing: Claude Code's first lines can fill the pipe before it reads ours.
    let reader = app.clone();
    let turn = id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (app, id) = (reader, turn);
        // Read as it comes, so a chatty tool never stalls on a full pipe.
        let errors = std::thread::spawn(move || {
            let mut s = String::new();
            let _ = stderr.read_to_string(&mut s);
            s
        });
        let mut finished = false;
        let mut initialized = None;
        let mut verified = !scoped_codex;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Ok(v) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if !verified {
                if v["id"] == 0 && v["result"].is_object() {
                    initialized = Some(v);
                    if write_line(&app.state::<Agents>(), &id, &json!({"id":"leadinglight_config_check","method":"config/read","params":{"includeLayers":false}})).is_err() {
                        let _ = stop(&app, &id);
                        sink(Event::Error { message:"Could not verify Codex's note-only configuration.".into() });
                        return;
                    }
                } else if v["id"] == "leadinglight_config_check" {
                    if initialized.is_none()
                        || crate::agent_guard::codex_config_safe(&v["result"], &scoped_flags)
                            .is_err()
                    {
                        let _ = stop(&app, &id);
                        sink(Event::Error { message:"Codex could not isolate this note conversation from configured tools. No thread was started.".into() });
                        return;
                    }
                    verified = true;
                    bootstrap_timeout.take();
                    sink(Event::Line {
                        line: initialized.take().unwrap(),
                    });
                }
                continue;
            }
            if codex {
                let done = v["method"] == "turn/completed";
                sink(Event::Line { line: v });
                // The turn is over; the app server would wait for the next one.
                if done {
                    finished = true;
                    if let Some(t) = app
                        .state::<Agents>()
                        .0
                        .lock()
                        .ok()
                        .as_mut()
                        .and_then(|m| m.get_mut(&id))
                    {
                        t.stdin = None;
                        let _ = kill_group(&mut t.child);
                    }
                }
                continue;
            }
            match v["type"].as_str() {
                // The answer to our initialize (commands, models): nothing the panel shows.
                Some("control_response") => continue,
                Some("result") => {
                    finished = true;
                    // The turn is over: closing its input lets Claude Code exit.
                    if let Some(t) = app
                        .state::<Agents>()
                        .0
                        .lock()
                        .ok()
                        .as_mut()
                        .and_then(|m| m.get_mut(&id))
                    {
                        t.stdin = None;
                    }
                }
                _ => {}
            }
            sink(Event::Line { line: v });
        }
        let err = errors.join().unwrap_or_default();
        // Gone from the map: stopped on purpose, nothing more to say.
        let Some(mut turn) = app
            .state::<Agents>()
            .0
            .lock()
            .ok()
            .and_then(|mut m| m.remove(&id))
        else {
            return;
        };
        let exit = turn.child.wait().ok();
        if !finished {
            let message = if !verified {
                "Codex could not verify its note-only configuration before the startup deadline."
                    .into()
            } else {
                match (err.trim(), exit) {
                    ("", Some(s)) if !s.success() => format!("{name} ended with {s}"),
                    ("", _) => format!("{name} ended without answering"),
                    (e, _) => e.to_string(),
                }
            };
            sink(Event::Error { message });
        }
    });
    if codex {
        write_line(&agents, &id, &crate::clis::codex_hello())?;
        return write_line(&agents, &id, &json!({ "method": "initialized" }));
    }
    // The page tools are served from the webview; the question goes in as a message, never a flag.
    let servers = if ask.tail {
        json!([])
    } else {
        json!(["notes"])
    };
    let init = json!({ "type": "control_request", "request_id": "init", "request": { "subtype": "initialize", "sdkMcpServers": servers } });
    let user = json!({ "type": "user", "session_id": "", "parent_tool_use_id": null, "message": { "role": "user", "content": ask.prompt } });
    write_line(&agents, &id, &init)?;
    write_line(&agents, &id, &user)
}

pub fn send(app: &AppHandle, id: &str, message: &Value) -> Result<(), String> {
    write_line(&app.state::<Agents>(), id, message)
}

fn kill_group(child: &mut Child) -> Result<(), String> {
    if child
        .try_wait()
        .map_err(|_| "Could not inspect this agent process.")?
        .is_some()
    {
        return Ok(());
    }
    // Every note turn owns a process group, so cancellation also stops its helper processes.
    let result = unsafe { libc::kill(-(child.id() as i32), libc::SIGKILL) };
    if result != 0 && std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH) {
        return Err("Could not stop this agent process.".into());
    }
    child
        .wait()
        .map(|_| ())
        .map_err(|_| "Could not confirm that the agent stopped.".into())
}

pub fn stop(app: &AppHandle, id: &str) -> Result<(), String> {
    stop_in(&app.state::<Agents>(), id)
}

fn stop_in(agents: &Agents, id: &str) -> Result<(), String> {
    let mut turns = agents.0.lock().map_err(|e| e.to_string())?;
    if let Some(turn) = turns.get_mut(id) {
        kill_group(&mut turn.child)?;
    }
    turns.remove(id);
    Ok(())
}

pub fn stop_all(app: &AppHandle) {
    let ids = app
        .state::<Agents>()
        .0
        .lock()
        .map(|m| m.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    for id in ids {
        let _ = stop(app, &id);
    }
}

// The plan's limits from Claude Code's own /usage, so the app never reads its sign-in.
#[tauri::command]
pub async fn agent_usage(app: AppHandle) -> Result<Value, String> {
    let cwd = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("agent");
    std::fs::create_dir_all(&cwd).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let bin = binary().ok_or("Claude Code is not installed")?;
        let mut c = command(&bin);
        c.current_dir(&cwd).args(["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--setting-sources", "", "--tools", ""]);
        let send = [
            json!({ "type": "control_request", "request_id": "init", "request": { "subtype": "initialize" } }),
            json!({ "type": "control_request", "request_id": "usage", "request": { "subtype": "get_usage", "skip_behaviors": true } }),
        ];
        let got = crate::clis::exchange(c, &send, 20, |v| v["type"] == "control_response" && v["response"]["request_id"] == "usage", 1)?;
        let r = got.into_iter().next().ok_or("Claude Code didn't answer")?;
        match r["response"]["subtype"].as_str() {
            Some("success") => Ok(r["response"]["response"].clone()),
            _ => Err(r["response"]["error"].as_str().unwrap_or("Claude Code couldn't read the plan's usage").to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// The webview's answer to a control request: a tool's result, or the person's approval.
#[tauri::command]
pub fn agent_reply(agents: State<'_, Agents>, id: String, message: Value) -> Result<(), String> {
    write_line(&agents, &id, &message)
}

// An agent as Claude Code keeps them: a Markdown file with name, description and model in
// its front matter and the prompt below. Read from ~/.claude/agents and the app's own folder.
#[derive(Serialize)]
pub struct Agent {
    id: String,
    name: String,
    description: Option<String>,
    model: Option<String>,
    prompt: String,
    source: String,
}

fn unquote(v: &str) -> String {
    let v = v.trim();
    v.strip_prefix('"')
        .and_then(|s| s.strip_suffix('"'))
        .or_else(|| v.strip_prefix('\'').and_then(|s| s.strip_suffix('\'')))
        .unwrap_or(v)
        .to_string()
}

fn parse_agent(path: &std::path::Path) -> Option<Agent> {
    let text = std::fs::read_to_string(path).ok()?;
    let (front, body) = match text.strip_prefix("---") {
        Some(rest) => {
            let end = rest.find("\n---")?;
            (rest[..end].to_string(), rest[end + 4..].trim().to_string())
        }
        None => (String::new(), text.trim().to_string()),
    };
    let (mut name, mut description, mut model) = (None, None, None);
    for line in front.lines() {
        if let Some((key, value)) = line.split_once(':') {
            match key.trim() {
                "name" => name = Some(unquote(value)),
                "description" => description = Some(unquote(value)),
                "model" => model = Some(unquote(value)),
                _ => {}
            }
        }
    }
    // A file with no name is not an agent Claude Code would load either.
    let name = name.filter(|n| !n.is_empty())?;
    let source = path.display().to_string();
    Some(Agent {
        id: format!("file:{source}"),
        name,
        description: description.filter(|d| !d.is_empty()),
        model: model.filter(|m| !m.is_empty() && m != "inherit"),
        prompt: body,
        source,
    })
}

fn agents_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("agents");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub fn agent_folder(app: AppHandle) -> Result<String, String> {
    Ok(agents_dir(&app)?.display().to_string())
}

#[tauri::command]
pub fn agent_list(app: AppHandle) -> Vec<Agent> {
    let mut dirs = Vec::new();
    if let Ok(own) = agents_dir(&app) {
        dirs.push(own);
    }
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        dirs.push(home.join(".claude/agents"));
    }
    let mut out = Vec::new();
    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut files: Vec<PathBuf> = entries
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().is_some_and(|x| x == "md"))
            .collect();
        files.sort();
        out.extend(files.iter().filter_map(|p| parse_agent(p)));
    }
    out
}

#[tauri::command]
pub fn agent_cancel(agents: State<'_, Agents>, id: String) -> Result<(), String> {
    stop_in(&agents, &id)
}

// The seam the browser QA cannot reach: a person's agent file into the @ menu. A nameless
// file must be left out, and the prompt must be the body alone.
#[cfg(test)]
mod tests {
    use super::parse_agent;

    #[test]
    fn a_full_input_pipe_does_not_block_cancellation() {
        use std::{
            os::unix::process::CommandExt,
            process::{Command, Stdio},
            sync::{mpsc, Arc, Mutex},
            time::Duration,
        };
        let mut child = Command::new("/bin/sleep")
            .arg("30")
            .stdin(Stdio::piped())
            .process_group(0)
            .spawn()
            .unwrap();
        let pid = child.id();
        let stdin = child.stdin.take().map(|s| Arc::new(Mutex::new(s)));
        let agents = Arc::new(super::Agents::default());
        agents
            .0
            .lock()
            .unwrap()
            .insert("blocked".into(), super::Turn { child, stdin });
        let (ready, started) = mpsc::channel();
        let writer_agents = agents.clone();
        let writer = std::thread::spawn(move || {
            ready.send(()).unwrap();
            super::write_line(
                &writer_agents,
                "blocked",
                &serde_json::json!({"text":"x".repeat(1_000_000)}),
            )
        });
        started.recv().unwrap();
        std::thread::sleep(Duration::from_millis(25));
        let (done, stopped) = mpsc::channel();
        let stopper = std::thread::spawn(move || {
            done.send(super::stop_in(&agents, "blocked")).unwrap();
        });
        let result = stopped.recv_timeout(Duration::from_secs(2));
        if result.is_err() {
            unsafe {
                libc::kill(-(pid as i32), libc::SIGKILL);
            }
        }
        stopper.join().unwrap();
        assert!(writer.join().unwrap().is_err());
        assert!(result.unwrap().is_ok());
    }

    #[test]
    fn cancellation_stops_its_process_group_without_touching_another_turn() {
        use std::io::{BufRead, BufReader};
        use std::os::unix::process::CommandExt;
        let mut target = std::process::Command::new("/bin/sh")
            .args(["-c", "/bin/sleep 30 & echo $!; wait"])
            .stdout(std::process::Stdio::piped())
            .process_group(0)
            .spawn()
            .unwrap();
        let mut child = String::new();
        BufReader::new(target.stdout.take().unwrap())
            .read_line(&mut child)
            .unwrap();
        let helper: i32 = child.trim().parse().unwrap();
        assert_eq!(unsafe { libc::getpgid(helper) }, target.id() as i32);
        let mut other = std::process::Command::new("/bin/sleep")
            .arg("30")
            .process_group(0)
            .spawn()
            .unwrap();
        super::kill_group(&mut target).unwrap();
        let unaffected = other.try_wait().unwrap().is_none();
        super::kill_group(&mut other).unwrap();
        let until = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while unsafe { libc::kill(helper, 0) } == 0 && std::time::Instant::now() < until {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let helper_stopped = unsafe { libc::kill(helper, 0) } != 0;
        if !helper_stopped {
            unsafe {
                libc::kill(helper, libc::SIGKILL);
            }
        }
        assert!(unaffected);
        assert!(helper_stopped);
        assert!(!target.wait().unwrap().success());
    }

    #[test]
    fn reads_front_matter_and_skips_a_nameless_file() {
        let dir = std::env::temp_dir().join(format!("ll-agents-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let good = dir.join("reviewer.md");
        std::fs::write(&good, "---\nname: Reviewer\ndescription: \"Reads: closely\"\nmodel: inherit\n---\n\nBe strict.\n").unwrap();
        let bad = dir.join("notes.md");
        std::fs::write(&bad, "---\ndescription: no name here\n---\nnothing").unwrap();
        let a = parse_agent(&good).unwrap();
        assert_eq!(
            (
                a.name.as_str(),
                a.description.as_deref(),
                a.model.as_deref(),
                a.prompt.as_str()
            ),
            ("Reviewer", Some("Reads: closely"), None, "Be strict.")
        );
        assert!(parse_agent(&bad).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
