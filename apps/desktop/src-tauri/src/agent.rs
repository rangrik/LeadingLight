// Claude, through the Claude Code the person installed and signed into: one `claude -p` per
// turn, speaking stream-json both ways, resumed for follow-ups. The app holds no key; keys in
// our environment are dropped so the sign-in wins (what synara does). The page tools are an
// MCP server the webview answers over the same control protocol, as the Agent SDK does, so
// this file only pipes lines: Claude Code's out to the webview, the webview's replies in.
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

// The turns running, by id: the process, and its input until the turn's result.
#[derive(Default)]
pub struct Agents(Mutex<HashMap<String, Turn>>);

pub struct Turn {
    child: Child,
    stdin: Option<ChildStdin>,
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

#[derive(Deserialize)]
pub struct Ask {
    id: String,
    prompt: String,
    system: String,
    model: String,
    effort: String,
    access: String,
    resume: Option<String>,
    // "codex" for GPT models; Claude otherwise.
    #[serde(default)]
    provider: String,
    // A tail turn (lib/tail.ts): no tools at all, since the app acts on a nod, never the model.
    #[serde(default)]
    tail: bool,
}

// Reading needs no asking; the rest follows the access the person chose. Anything unknown asks.
const READS: &str = "mcp__notes__read_page,mcp__notes__search_pages";
fn access(mode: &str) -> &'static [&'static str] {
    match mode {
        "auto" => &["--permission-mode", "auto", "--tools", "WebSearch,WebFetch"],
        "full" => &["--permission-mode", "bypassPermissions", "--allow-dangerously-skip-permissions", "--tools", "WebSearch,WebFetch"],
        "plan" => &["--permission-mode", "plan", "--tools", "WebSearch,WebFetch,ExitPlanMode"],
        _ => &["--permission-mode", "default", "--tools", "WebSearch,WebFetch"],
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
    Status { installed: false, logged_in: false, email: None, plan: None, version: None, error: None }
}

fn status() -> Status {
    let Some(bin) = binary() else { return not_installed() };
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
                    error: Some(format!("{text} {}", String::from_utf8_lossy(&out.stderr).trim())),
                },
            }
        }
        Err(e) => Status { installed: true, logged_in: false, email: None, plan: None, version, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub async fn agent_status() -> Status {
    tauri::async_runtime::spawn_blocking(status).await.unwrap_or_else(|e| Status { error: Some(e.to_string()), ..not_installed() })
}

// One line of the protocol into a running turn; a turn already over takes nothing.
fn write_line(agents: &Agents, id: &str, line: &Value) -> Result<(), String> {
    let mut map = agents.0.lock().map_err(|e| e.to_string())?;
    let Some(stdin) = map.get_mut(id).and_then(|t| t.stdin.as_mut()) else { return Ok(()) };
    writeln!(stdin, "{line}").map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_ask(app: AppHandle, agents: State<'_, Agents>, ask: Ask, on_event: Channel<Event>) -> Result<(), String> {
    // Its own folder and no settings, so the note's question never loads a project's hooks or memory.
    let cwd = app.path().app_data_dir().map_err(|e| e.to_string())?.join("agent");
    std::fs::create_dir_all(&cwd).map_err(|e| e.to_string())?;
    // GPT goes through Codex's app server, which the webview drives from its initialize on
    // (lib/turn.ts); its turn ends with turn/completed rather than a result.
    let codex = ask.provider == "codex";
    let name = if codex { "Codex" } else { "Claude Code" };
    let mut c = if codex {
        let mut c = crate::clis::codex_server(&crate::clis::find("codex").ok_or("Codex is not installed")?);
        // The app passes a tail thread no tools; this takes web search away too.
        if ask.tail {
            c.args(["-c", "web_search=\"disabled\""]);
        }
        c
    } else {
        let bin = binary().ok_or("Claude Code is not installed")?;
        let mcp = json!({ "mcpServers": { "notes": { "type": "sdk", "name": "notes" } } }).to_string();
        let mut c = command(&bin);
        if ask.tail {
            c.args(["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--setting-sources", "", "--strict-mcp-config", "--tools", ""]);
        } else {
            c.args(["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages"])
                .args(["--setting-sources", "", "--permission-prompt-tool", "stdio", "--strict-mcp-config", "--mcp-config", &mcp, "--allowedTools", READS])
                .args(access(&ask.access));
        }
        c.args(["--system-prompt", &ask.system, "--model", &ask.model, "--effort", &ask.effort]);
        if let Some(session) = &ask.resume {
            c.args(["--resume", session]);
        }
        c
    };
    c.current_dir(&cwd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = c.spawn().map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let mut stderr = child.stderr.take().ok_or("no stderr")?;
    let stdin = child.stdin.take();
    let id = ask.id.clone();
    agents.0.lock().map_err(|e| e.to_string())?.insert(id.clone(), Turn { child, stdin });

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
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
            if codex {
                let done = v["method"] == "turn/completed";
                let _ = on_event.send(Event::Line { line: v });
                // The turn is over; the app server would wait for the next one.
                if done {
                    finished = true;
                    if let Some(t) = app.state::<Agents>().0.lock().ok().as_mut().and_then(|m| m.get_mut(&id)) {
                        t.stdin = None;
                        let _ = t.child.kill();
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
                    if let Some(t) = app.state::<Agents>().0.lock().ok().as_mut().and_then(|m| m.get_mut(&id)) {
                        t.stdin = None;
                    }
                }
                _ => {}
            }
            let _ = on_event.send(Event::Line { line: v });
        }
        let err = errors.join().unwrap_or_default();
        // Gone from the map: stopped on purpose, nothing more to say.
        let Some(mut turn) = app.state::<Agents>().0.lock().ok().and_then(|mut m| m.remove(&id)) else { return };
        let exit = turn.child.wait().ok();
        if !finished {
            let message = match (err.trim(), exit) {
                ("", Some(s)) if !s.success() => format!("{name} ended with {s}"),
                ("", _) => format!("{name} ended without answering"),
                (e, _) => e.to_string(),
            };
            let _ = on_event.send(Event::Error { message });
        }
    });
    if codex {
        write_line(&agents, &id, &crate::clis::codex_hello())?;
        return write_line(&agents, &id, &json!({ "method": "initialized" }));
    }
    // The page tools are served from the webview; the question goes in as a message, never a flag.
    let servers = if ask.tail { json!([]) } else { json!(["notes"]) };
    let init = json!({ "type": "control_request", "request_id": "init", "request": { "subtype": "initialize", "sdkMcpServers": servers } });
    let user = json!({ "type": "user", "session_id": "", "parent_tool_use_id": null, "message": { "role": "user", "content": ask.prompt } });
    write_line(&agents, &id, &init)?;
    write_line(&agents, &id, &user)
}

// The plan's limits from Claude Code's own /usage, so the app never reads its sign-in.
#[tauri::command]
pub async fn agent_usage(app: AppHandle) -> Result<Value, String> {
    let cwd = app.path().app_data_dir().map_err(|e| e.to_string())?.join("agent");
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
    v.strip_prefix('"').and_then(|s| s.strip_suffix('"')).or_else(|| v.strip_prefix('\'').and_then(|s| s.strip_suffix('\''))).unwrap_or(v).to_string()
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
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("agents");
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
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        let mut files: Vec<PathBuf> = entries.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.extension().is_some_and(|x| x == "md")).collect();
        files.sort();
        out.extend(files.iter().filter_map(|p| parse_agent(p)));
    }
    out
}

#[tauri::command]
pub fn agent_cancel(agents: State<'_, Agents>, id: String) {
    if let Some(mut turn) = agents.0.lock().ok().and_then(|mut m| m.remove(&id)) {
        let _ = turn.child.kill();
        let _ = turn.child.wait();
    }
}

// The seam the browser QA cannot reach: a person's agent file into the @ menu. A nameless
// file must be left out, and the prompt must be the body alone.
#[cfg(test)]
mod tests {
    use super::parse_agent;

    #[test]
    fn reads_front_matter_and_skips_a_nameless_file() {
        let dir = std::env::temp_dir().join(format!("ll-agents-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let good = dir.join("reviewer.md");
        std::fs::write(&good, "---\nname: Reviewer\ndescription: \"Reads: closely\"\nmodel: inherit\n---\n\nBe strict.\n").unwrap();
        let bad = dir.join("notes.md");
        std::fs::write(&bad, "---\ndescription: no name here\n---\nnothing").unwrap();
        let a = parse_agent(&good).unwrap();
        assert_eq!((a.name.as_str(), a.description.as_deref(), a.model.as_deref(), a.prompt.as_str()), ("Reviewer", Some("Reads: closely"), None, "Be strict."));
        assert!(parse_agent(&bad).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
