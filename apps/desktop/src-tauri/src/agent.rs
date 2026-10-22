// Claude, through the Claude Code the person installed and signed into: `claude -p`
// speaking stream-json, with no tools and our own system prompt. The app holds no
// key; the sign-in in the Keychain is the CLI's own. Keys in our environment are
// dropped so that sign-in wins (what synara does). The same protocol the Agent SDK
// speaks, without a JavaScript runtime in the app.
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

// The questions being answered, by id, so one can be stopped.
#[derive(Default)]
pub struct Agents(Mutex<HashMap<String, Child>>);

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
    Delta { text: String },
    Done { session_id: Option<String> },
    Error { message: String },
}

#[derive(Deserialize)]
pub struct Ask {
    id: String,
    prompt: String,
    system: String,
    model: String,
    effort: String,
    resume: Option<String>,
}

// Where Claude Code is. A Mac app's PATH is short, so the usual places come first.
fn binary() -> Option<PathBuf> {
    let mut places = Vec::new();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        places.push(home.join(".local/bin/claude"));
        places.push(home.join(".claude/local/claude"));
    }
    places.push(PathBuf::from("/opt/homebrew/bin/claude"));
    places.push(PathBuf::from("/usr/local/bin/claude"));
    if let Some(path) = std::env::var_os("PATH") {
        places.extend(std::env::split_paths(&path).map(|d| d.join("claude")));
    }
    places.into_iter().find(|p| p.is_file())
}

fn command(bin: &PathBuf) -> Command {
    let mut c = Command::new(bin);
    for key in ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"] {
        c.env_remove(key);
    }
    c
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

#[tauri::command]
pub async fn agent_ask(app: AppHandle, agents: State<'_, Agents>, ask: Ask, on_event: Channel<Event>) -> Result<(), String> {
    let Some(bin) = binary() else { return Err("Claude Code is not installed".into()) };
    // Its own folder, so the note's question never loads a project's hooks or memory.
    let cwd = app.path().app_data_dir().map_err(|e| e.to_string())?.join("agent");
    std::fs::create_dir_all(&cwd).map_err(|e| e.to_string())?;
    let mut c = command(&bin);
    c.current_dir(&cwd)
        .args(["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"])
        .args(["--tools", "", "--setting-sources", ""])
        .args(["--system-prompt", &ask.system, "--model", &ask.model, "--effort", &ask.effort])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(session) = &ask.resume {
        c.args(["--resume", session]);
    }
    let mut child = c.spawn().map_err(|e| e.to_string())?;
    // The prompt goes in on stdin, so its first character is never read as a flag.
    if let Some(mut stdin) = child.stdin.take() {
        let prompt = ask.prompt.clone();
        std::thread::spawn(move || {
            let _ = stdin.write_all(prompt.as_bytes());
        });
    }
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let mut stderr = child.stderr.take().ok_or("no stderr")?;
    let id = ask.id.clone();
    agents.0.lock().map_err(|e| e.to_string())?.insert(id.clone(), child);

    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut session: Option<String> = None;
        let mut finished = false;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
            if let Some(s) = v["session_id"].as_str() {
                session = Some(s.to_string());
            }
            match v["type"].as_str() {
                Some("stream_event") => {
                    if v["event"]["delta"]["type"] == "text_delta" {
                        if let Some(text) = v["event"]["delta"]["text"].as_str() {
                            let _ = on_event.send(Event::Delta { text: text.to_string() });
                        }
                    }
                }
                Some("result") => {
                    finished = true;
                    if v["is_error"].as_bool() == Some(true) {
                        let message = v["result"].as_str().unwrap_or("Claude Code reported an error").to_string();
                        let _ = on_event.send(Event::Error { message });
                    } else {
                        let _ = on_event.send(Event::Done { session_id: session.clone() });
                    }
                }
                _ => {}
            }
        }
        let mut err = String::new();
        let _ = stderr.read_to_string(&mut err);
        // Gone from the map: stopped on purpose, nothing more to say.
        let Some(mut child) = app.state::<Agents>().0.lock().ok().and_then(|mut m| m.remove(&id)) else { return };
        let exit = child.wait().ok();
        if !finished {
            let message = match (err.trim(), exit) {
                ("", Some(s)) if !s.success() => format!("Claude Code ended with {s}"),
                ("", _) => "Claude Code ended without answering".to_string(),
                (e, _) => e.to_string(),
            };
            let _ = on_event.send(Event::Error { message });
        }
    });
    Ok(())
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
    if let Some(mut child) = agents.0.lock().ok().and_then(|mut m| m.remove(&id)) {
        let _ = child.kill();
        let _ = child.wait();
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
