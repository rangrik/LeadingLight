// The Claude Code and Codex command-line tools: found as the person's Terminal finds them, with
// their version, how they were installed and how to update them (after synara), and how much of
// the Codex plan is left. Claude's plan is read through agent.rs, which owns its process.
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{mpsc, OnceLock};
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

// Kills the process if it is still running after secs; dropping the sender calls it off.
pub fn watchdog(pid: u32, secs: u64) -> mpsc::Sender<()> {
    let (tx, rx) = mpsc::channel::<()>();
    std::thread::spawn(move || {
        if let Err(mpsc::RecvTimeoutError::Timeout) = rx.recv_timeout(Duration::from_secs(secs)) {
            let _ = Command::new("/bin/kill").args(["-9", &pid.to_string()]).status();
        }
    });
    tx
}

// Output and whether it succeeded, given up after secs. Its pipes close when it ends, unless
// something it started keeps them open (a shell's rc can), so reading stops a second after.
fn run(mut c: Command, secs: u64) -> Result<(bool, String), String> {
    let mut child = c.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    let stop = watchdog(child.id(), secs);
    let (tx, rx) = mpsc::channel::<(bool, Vec<u8>)>();
    let pipes: [(bool, Box<dyn Read + Send>); 2] = [(false, Box::new(child.stdout.take().ok_or("no stdout")?)), (true, Box::new(child.stderr.take().ok_or("no stderr")?))];
    for (is_err, mut pipe) in pipes {
        let tx = tx.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            while let Ok(n @ 1..) = pipe.read(&mut buf) {
                if tx.send((is_err, buf[..n].to_vec())).is_err() {
                    break;
                }
            }
        });
    }
    drop(tx);
    let status = child.wait().map_err(|e| e.to_string())?;
    drop(stop);
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let until = std::time::Instant::now() + Duration::from_secs(1);
    while let Ok((is_err, chunk)) = rx.recv_timeout(until.saturating_duration_since(std::time::Instant::now())) {
        if is_err { err.extend(chunk) } else { out.extend(chunk) }
    }
    Ok((status.success(), format!("{}{}", String::from_utf8_lossy(&out), String::from_utf8_lossy(&err))))
}

// The PATH a login shell has: a Mac app starts with a short one, without Homebrew, nvm or fnm.
// An fnm or nvm shell's own folder is a link that goes away; its target stays.
pub fn shell_path() -> &'static [PathBuf] {
    static PATH: OnceLock<Vec<PathBuf>> = OnceLock::new();
    PATH.get_or_init(|| {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let mut c = Command::new(shell);
        c.args(["-ilc", "printf __LL_PATH__; printenv PATH"]);
        let text = run(c, 5).map(|(_, out)| out).unwrap_or_default();
        let path = text.split("__LL_PATH__").nth(1).map(|s| s.lines().next().unwrap_or("").trim().to_string()).unwrap_or_default();
        let path = if path.is_empty() { std::env::var("PATH").unwrap_or_default() } else { path };
        std::env::split_paths(&path).map(|d| std::fs::canonicalize(&d).unwrap_or(d)).collect()
    })
}

// Where a tool is: the usual installers' places first, then the login shell's PATH.
pub fn find(name: &str) -> Option<PathBuf> {
    let home = home();
    let mut dirs = vec![home.join(".local/bin")];
    if name == "claude" {
        dirs.push(home.join(".claude/local"));
    }
    dirs.extend(shell_path().iter().cloned());
    dirs.extend([PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/usr/local/bin"), home.join(".bun/bin")]);
    dirs.into_iter().map(|d| d.join(name)).find(|p| p.is_file())
}

// A tool's own folder first on PATH, then the shell's, so an npm install finds its node.
fn path_for(bin: &Path) -> Option<std::ffi::OsString> {
    let mut dirs: Vec<PathBuf> = bin.parent().map(Path::to_path_buf).into_iter().collect();
    dirs.extend(shell_path().iter().cloned());
    std::env::join_paths(dirs).ok()
}

// A program run as from the tool's folder, with no API keys, so the sign-in wins.
fn command_near(program: impl AsRef<std::ffi::OsStr>, bin: &Path) -> Command {
    let mut c = Command::new(program);
    if let Some(path) = path_for(bin) {
        c.env("PATH", path);
    }
    for key in ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "OPENAI_API_KEY"] {
        c.env_remove(key);
    }
    c
}

pub fn tool_command(bin: &Path) -> Command {
    command_near(bin, bin)
}

// The first word that reads as a version: "2.1.308 (Claude Code)", "codex-cli 0.164.0".
fn version_in(text: &str) -> Option<String> {
    text.split_whitespace().map(|w| w.trim_start_matches('v')).find(|w| {
        let parts: Vec<&str> = w.split(['.', '-']).collect();
        parts.len() >= 2 && parts[..2].iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
    }).map(String::from)
}

#[derive(Serialize)]
pub struct Cli {
    id: &'static str,
    name: &'static str,
    path: Option<String>,
    version: Option<String>,
    // native, npm, bun, pnpm, brew-cask, brew or other: where its updates come from.
    source: Option<&'static str>,
    npm: &'static str,
    brew: String,
    command: Option<Vec<String>>,
}

const TOOLS: [(&str, &str, &str); 2] = [("claude", "Claude Code", "@anthropic-ai/claude-code"), ("codex", "Codex", "@openai/codex")];

fn brew_bin() -> String {
    ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"].into_iter().find(|p| Path::new(p).is_file()).unwrap_or("brew").to_string()
}

// How it was installed, read from where its file really is, and the command that updates it.
fn source(id: &str, bin: &Path, npm: &str, brew: &str) -> (&'static str, Option<Vec<String>>) {
    let given = bin.to_string_lossy().to_lowercase();
    let real = std::fs::canonicalize(bin).map(|p| p.to_string_lossy().to_lowercase()).unwrap_or_else(|_| given.clone());
    let has = |s: &str| real.contains(s) || given.contains(s);
    let latest = format!("{npm}@latest");
    if id == "claude" && (given.ends_with("/.local/bin/claude") || has("/.local/share/claude/")) {
        return ("native", Some(vec![bin.display().to_string(), "update".into()]));
    }
    if has("/.bun/bin/") {
        return ("bun", Some(vec!["bun".into(), "i".into(), "-g".into(), latest]));
    }
    if has("/library/pnpm/") || has("/.local/share/pnpm/") {
        return ("pnpm", Some(vec!["pnpm".into(), "add".into(), "-g".into(), latest]));
    }
    // npm installs into whichever node runs it, so the prefix is pinned to this install's.
    let real_case = std::fs::canonicalize(bin).unwrap_or_else(|_| bin.to_path_buf()).display().to_string();
    if let Some(at) = real_case.find("/lib/node_modules/") {
        let prefix = &real_case[..at];
        let npm_bin = Path::new(prefix).join("bin/npm");
        let npm_bin = if npm_bin.is_file() { npm_bin.display().to_string() } else { "npm".into() };
        return ("npm", Some(vec![npm_bin, "install".into(), "-g".into(), "--prefix".into(), prefix.into(), latest]));
    }
    if has("/caskroom/") {
        return ("brew-cask", Some(vec![brew_bin(), "upgrade".into(), "--cask".into(), brew.into()]));
    }
    if has("/cellar/") || given.starts_with("/opt/homebrew/bin/") || given.starts_with("/usr/local/bin/") {
        return ("brew", Some(vec![brew_bin(), "upgrade".into(), brew.into()]));
    }
    ("other", None)
}

fn info(id: &'static str, name: &'static str, npm: &'static str) -> Cli {
    let Some(bin) = find(id) else { return Cli { id, name, path: None, version: None, source: None, npm, brew: id.into(), command: None } };
    let real = std::fs::canonicalize(&bin).map(|p| p.to_string_lossy().to_lowercase()).unwrap_or_default();
    let brew = if id == "claude" { if real.contains("/caskroom/claude-code@latest/") { "claude-code@latest" } else { "claude-code" } } else { "codex" }.to_string();
    let mut c = tool_command(&bin);
    c.arg("--version");
    let version = run(c, 20).ok().and_then(|(_, out)| version_in(&out));
    let (src, command) = source(id, &bin, npm, &brew);
    Cli { id, name, path: Some(bin.display().to_string()), version, source: Some(src), npm, brew, command }
}

#[tauri::command]
pub async fn cli_info() -> Vec<Cli> {
    tauri::async_runtime::spawn_blocking(|| TOOLS.iter().map(|(id, name, npm)| info(id, name, npm)).collect()).await.unwrap_or_default()
}

// Runs the tool's update command; the output's last lines come back either way.
#[tauri::command]
pub async fn cli_update(id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (id, name, npm) = TOOLS.into_iter().find(|t| t.0 == id).ok_or("No such tool")?;
        let cli = info(id, name, npm);
        let argv = cli.command.ok_or(format!("{name} can't be updated from here"))?;
        let mut c = command_near(&argv[0], Path::new(&cli.path.unwrap_or_default()));
        c.args(&argv[1..]).current_dir(home());
        let (ok, out) = run(c, 120)?;
        let tail: String = out.lines().rev().take(12).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
        if ok { Ok(tail) } else { Err(format!("{} didn't finish.\n{tail}", argv.join(" "))) }
    })
    .await
    .map_err(|e| e.to_string())?
}

// Common note-thread flags. Paired threads also disable and verify each inherited MCP server
// in agent.rs; an empty MCP table alone does not clear the user's configured servers.
pub fn codex_server(bin: &Path) -> Command {
    let mut c = tool_command(bin);
    c.arg("app-server");
    for feature in ["shell_tool", "hooks", "apps", "plugins", "multi_agent", "image_generation", "goals"] {
        c.args(["--disable", feature]);
    }
    c.args(["-c", "mcp_servers={}", "-c", "web_search=\"live\""]);
    c
}

pub fn codex_hello() -> Value {
    json!({ "method": "initialize", "id": 0, "params": { "clientInfo": { "name": "leadinglight", "title": "LeadingLight", "version": env!("CARGO_PKG_VERSION") }, "capabilities": { "experimentalApi": true } } })
}

// Lines from a tool speaking JSON on stdin and stdout, kept by keep until count of them came.
pub fn exchange(mut c: Command, send: &[Value], secs: u64, keep: impl Fn(&Value) -> bool, count: usize) -> Result<Vec<Value>, String> {
    let mut child = c.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e| e.to_string())?;
    let stop = watchdog(child.id(), secs);
    let stdout = child.stdout.take().ok_or("no stdout")?;
    // Kept open until the answers are in: closing it ends the tool before it answers.
    let mut stdin = child.stdin.take().ok_or("no stdin")?;
    for line in send {
        writeln!(stdin, "{line}").map_err(|e| e.to_string())?;
    }
    let mut got = Vec::new();
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        if keep(&v) {
            got.push(v);
            if got.len() == count {
                break;
            }
        }
    }
    drop(stdin);
    let _ = child.kill();
    let _ = child.wait();
    drop(stop);
    Ok(got)
}

// Codex's plan, from its app server: the account (plan type) and its rate limits.
#[tauri::command]
pub async fn codex_usage() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let bin = find("codex").ok_or("Codex is not installed")?;
        let c = codex_server(&bin);
        let send = [
            codex_hello(),
            json!({ "method": "initialized" }),
            json!({ "method": "account/read", "id": 1, "params": {} }),
            json!({ "method": "account/rateLimits/read", "id": 2 }),
        ];
        let got = exchange(c, &send, 15, |v| matches!(v["id"].as_i64(), Some(1 | 2)), 2)?;
        let by = |id: i64| got.iter().find(|v| v["id"].as_i64() == Some(id)).cloned().unwrap_or(Value::Null);
        Ok(json!({ "account": by(1), "limits": by(2) }))
    })
    .await
    .map_err(|e| e.to_string())?
}

// Whether Codex is there and signed in, and the GPT models it offers.
#[tauri::command]
pub async fn codex_status() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let bin = find("codex").ok_or("Codex is not installed")?;
        let send = [codex_hello(), json!({ "method": "initialized" }), json!({ "method": "account/read", "id": 1, "params": {} }), json!({ "method": "model/list", "id": 2, "params": {} })];
        let got = exchange(codex_server(&bin), &send, 15, |v| matches!(v["id"].as_i64(), Some(1 | 2)), 2)?;
        let by = |id: i64| got.iter().find(|v| v["id"].as_i64() == Some(id)).cloned().unwrap_or(Value::Null);
        Ok(json!({ "account": by(1), "models": by(2) }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{source, version_in};
    use std::path::Path;

    // The seam an update crosses: where a tool sits decides the command that updates it, and
    // npm must keep to this install's prefix, or it installs into whichever node runs it.
    #[test]
    fn picks_the_update_command_by_where_it_is() {
        let (s, c) = source("claude", Path::new("/Users/x/.local/bin/claude"), "@anthropic-ai/claude-code", "claude-code");
        assert_eq!((s, c.unwrap()[1].as_str()), ("native", "update"));
        let (s, c) = source("codex", Path::new("/opt/homebrew/Caskroom/codex/0.1.0/bin/codex"), "@openai/codex", "codex");
        assert_eq!((s, c.unwrap()[1..].join(" ")), ("brew-cask", "upgrade --cask codex".into()));
        let (s, c) = source("codex", Path::new("/n/v22/lib/node_modules/@openai/codex/bin/codex.js"), "@openai/codex", "codex");
        assert_eq!((s, c.unwrap()[1..].join(" ")), ("npm", "install -g --prefix /n/v22 @openai/codex@latest".into()));
    }

    // The seam: each tool's --version wording into a version the app compares.
    #[test]
    fn reads_versions() {
        assert_eq!(version_in("2.1.308 (Claude Code)").as_deref(), Some("2.1.308"));
        assert_eq!(version_in("codex-cli 0.164.0").as_deref(), Some("0.164.0"));
        assert_eq!(version_in("nothing here"), None);
    }
}
