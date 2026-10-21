//! The checks around every provider process: a preflight over the private folders before it is
//! started, and a gate over what the started runtime reports before any thread exists.
//!
//! Both are ports of the qualification harness's guard and gate, which were proven against
//! contaminated fixtures. Nothing here reads a file outside LeadingLight's private provider folders
//! except to see whether an instruction source exists in the working folder's ancestry, and the
//! person's own home and everything above it are never looked at: the qualification shows those are
//! not consulted under `project_root_markers = []`.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use regex::Regex;
use serde_json::Value;

use super::super::store::read_bounded;
use super::controls;
use super::process::{self, FileId, Layout};

/// Instruction, skill and project-config sources the runtime looks for in its working folder's
/// ancestry.
pub(crate) const DISCOVERY_NAMES: &[&str] =
    &["AGENTS.md", "AGENTS.override.md", ".agents", ".codex"];
/// Machine-wide configuration the runtime reads if present.
pub(crate) const MANAGED_CONFIG: &[&str] = &[
    "/etc/codex/config.toml",
    "/etc/codex/requirements.toml",
    "/etc/codex/managed_config.toml",
];
/// Path segments of anything that could instruct, extend or configure the runtime.
const DISCOVERY_SEGMENTS: &[&str] = &[
    "AGENTS.md",
    "AGENTS.override.md",
    ".agents",
    ".codex",
    "hooks.json",
    "plugins",
    "memories",
    "prompts",
    "rules",
];
/// Entries of the private home looked at; a home with more is refused.
const MAX_HOME_ENTRIES: usize = 20_000;
const MAX_CONFIG_BYTES: usize = 64 * 1024;

/// What one provider process must find.
pub(crate) struct Expected<'a> {
    pub(crate) layout: &'a Layout,
    /// The whole `config.toml`, byte for byte.
    pub(crate) config: &'a str,
    /// The verified binary the process is started from, as its helper links must name it.
    pub(crate) binary: &'a Path,
    pub(crate) binary_id: FileId,
    /// The first ancestor of the working folder that is not checked: the person's own home.
    pub(crate) boundary: Option<&'a Path>,
    pub(crate) managed: &'a [PathBuf],
}

fn pattern(cell: &'static OnceLock<Regex>, text: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(text).expect("a fixed pattern"))
}

/// Files the runtime keeps in its own home. Never read here.
fn runtime_artifact(rel: &str) -> bool {
    static CELL: OnceLock<Regex> = OnceLock::new();
    pattern(
        &CELL,
        r"^codex/(installation_id|\.sandbox_migration|auth\.json|[a-z]+_\d+\.sqlite(-shm|-wal)?|tmp(/.*)?|skills|skills/\.system(/.*)?)$",
    )
    .is_match(rel)
}

fn helper_dir(rel: &str) -> bool {
    static CELL: OnceLock<Regex> = OnceLock::new();
    pattern(&CELL, r"^codex/tmp/arg0/codex-arg0[A-Za-z0-9]{6}$").is_match(rel)
}

fn helper_lock(rel: &str) -> bool {
    static CELL: OnceLock<Regex> = OnceLock::new();
    pattern(&CELL, r"^codex/tmp/arg0/codex-arg0[A-Za-z0-9]{6}/\.lock$").is_match(rel)
}

fn helper_link_name(rel: &str) -> bool {
    rel.rsplit_once('/')
        .is_some_and(|(dir, name)| helper_dir(dir) && controls::HELPER_LINKS.contains(&name))
}

/// An instruction, skill, hook, plugin, memory, prompt, rule or configuration source.
pub(crate) fn discovery_like(rel: &str) -> bool {
    let parts: Vec<&str> = rel.split('/').collect();
    parts.iter().any(|part| DISCOVERY_SEGMENTS.contains(part))
        || rel.ends_with(".toml")
        || rel.ends_with("SKILL.md")
        || (parts.len() >= 3
            && parts[0] == "codex"
            && parts[1] == "skills"
            && parts[2] != ".system")
}

/// One of the runtime's own helper links: exact place and name, link text exactly the verified
/// binary's path, and the file it reaches that very binary.
fn verified_helper(rel: &str, path: &Path, expected: &Expected<'_>) -> bool {
    helper_link_name(rel)
        && fs::read_link(path).is_ok_and(|text| text == expected.binary)
        && process::file_id(path) == Some(expected.binary_id)
}

fn helper_layout(rel: &str, meta: &fs::Metadata) -> bool {
    (rel == "codex/tmp/arg0" && meta.is_dir())
        || (helper_dir(rel) && meta.is_dir())
        || (helper_lock(rel) && meta.is_file() && meta.len() == 0)
}

fn real_dir(path: &Path) -> bool {
    let plain = fs::symlink_metadata(path).is_ok_and(|meta| meta.is_dir());
    plain && path.canonicalize().is_ok_and(|resolved| resolved == path)
}

/// Problems that must keep a provider process from starting. Empty means it may start.
pub(crate) fn preflight(expected: &Expected<'_>) -> Vec<String> {
    let layout = expected.layout;
    let mut problems = Vec::new();
    for dir in [
        layout.root().to_path_buf(),
        layout.home(),
        layout.codex_home(),
        layout.tmp(),
        layout.run(),
    ] {
        if !real_dir(&dir) {
            problems.push(format!("not a private folder: {}", dir.display()));
        }
    }
    let run = layout.run();
    let empty = fs::read_dir(&run).is_ok_and(|mut entries| entries.next().is_none());
    if !empty {
        problems.push("the working folder is not empty".to_string());
    }
    for ancestor in run.ancestors() {
        if expected.boundary == Some(ancestor) {
            break;
        }
        for name in DISCOVERY_NAMES {
            let source = ancestor.join(name);
            if fs::symlink_metadata(&source).is_ok() {
                problems.push(format!(
                    "instruction source above the working folder: {}",
                    source.display()
                ));
            }
        }
    }
    problems.extend(home_problems(expected));
    let config = layout.config_file();
    let plain = fs::symlink_metadata(&config).is_ok_and(|meta| meta.is_file());
    let bytes = read_bounded(&config, MAX_CONFIG_BYTES);
    if !plain || bytes.as_deref() != Some(expected.config.as_bytes()) {
        problems.push("config.toml is not LeadingLight's configuration".to_string());
    }
    for path in expected.managed {
        if fs::symlink_metadata(path).is_ok() {
            problems.push(format!(
                "machine-wide configuration present: {}",
                path.display()
            ));
        }
    }
    problems
}

/// Everything in the private home, without following links: only the runtime's own files, its
/// verified helper links and LeadingLight's configuration.
fn home_problems(expected: &Expected<'_>) -> Vec<String> {
    let home = expected.layout.home();
    let mut problems = Vec::new();
    let mut pending = vec![home.clone()];
    let mut seen = 0_usize;
    while let Some(dir) = pending.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            problems.push(format!(
                "unreadable folder in the private home: {}",
                dir.display()
            ));
            continue;
        };
        for entry in entries {
            seen += 1;
            if seen > MAX_HOME_ENTRIES {
                problems.push("the private home holds too many files".to_string());
                return problems;
            }
            let Ok(entry) = entry else {
                problems.push("unreadable entry in the private home".to_string());
                continue;
            };
            let path = entry.path();
            let Ok(meta) = fs::symlink_metadata(&path) else {
                problems.push(format!("unreadable entry: {}", path.display()));
                continue;
            };
            let Some(rel) = path
                .strip_prefix(&home)
                .ok()
                .and_then(Path::to_str)
                .map(str::to_string)
            else {
                problems.push(format!(
                    "unexpected name in the private home: {}",
                    path.display()
                ));
                continue;
            };
            let descend = if meta.file_type().is_symlink() {
                if !verified_helper(&rel, &path, expected) {
                    problems.push(format!("link in the private home: {rel}"));
                }
                false
            } else if rel == "codex/tmp/arg0" || rel.starts_with("codex/tmp/arg0/") {
                let fits = helper_layout(&rel, &meta);
                if !fits {
                    problems.push(format!(
                        "unexpected entry among the runtime's helpers: {rel}"
                    ));
                }
                fits && meta.is_dir()
            } else {
                // Discovery-like names under the runtime's temporary folder are never its own.
                let source_in_tmp = rel.starts_with("codex/tmp/") && discovery_like(&rel);
                let own = rel == "codex"
                    || rel == "codex/config.toml"
                    || (runtime_artifact(&rel) && !source_in_tmp);
                if !own && discovery_like(&rel) {
                    problems.push(format!(
                        "instruction or extension source in the private home: {rel}"
                    ));
                    false
                } else {
                    meta.is_dir()
                }
            };
            if descend {
                pending.push(path);
            }
        }
    }
    problems
}

// --- The runtime gate --------------------------------------------------------------------------

/// What the started runtime reports about itself before any thread exists.
#[derive(Debug, Clone, Default)]
pub(crate) struct Reported {
    pub(crate) requirements: Value,
    pub(crate) config: Value,
    pub(crate) skills: Value,
    pub(crate) hooks: Value,
    pub(crate) plugins: Value,
    pub(crate) mcp_servers: Value,
    /// Warning notifications seen so far, by method.
    pub(crate) warnings: Vec<String>,
}

fn items<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

fn is_empty_value(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => true,
        Some(Value::Object(map)) => map.is_empty(),
        Some(Value::Array(list)) => list.is_empty(),
        Some(_) => false,
    }
}

/// Problems with what the runtime reports. Empty means a thread may be started.
pub(crate) fn gate(reported: &Reported, layout: &Layout, model_provider: &str) -> Vec<String> {
    let mut problems = Vec::new();
    if !reported.warnings.is_empty() {
        problems.push(format!(
            "warnings before any thread: {:?}",
            reported.warnings
        ));
    }
    if !is_empty_value(reported.requirements.get("requirements")) {
        problems.push("machine-wide requirements are in force".to_string());
    }

    let layers = items(&reported.config, "layers");
    let kind = |layer: &Value| {
        layer
            .pointer("/name/type")
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    let user_file = layers
        .first()
        .and_then(|layer| layer.pointer("/name/file"))
        .and_then(Value::as_str)
        .map(PathBuf::from);
    let layers_fit = layers.len() == 2
        && kind(&layers[0]).as_deref() == Some("user")
        && user_file == Some(layout.config_file())
        && kind(&layers[1]).as_deref() == Some("system")
        && is_empty_value(layers[1].get("config"));
    if !layers_fit {
        let kinds: Vec<Option<String>> = layers.iter().map(kind).collect();
        problems.push(format!(
            "configuration layers are not exactly LeadingLight's: {kinds:?}"
        ));
    }

    let effective = reported.config.get("config").unwrap_or(&Value::Null);
    let text = |key: &str| effective.get(key).and_then(Value::as_str);
    let provider_fits = match text("model_provider") {
        Some(provider) => provider == model_provider,
        None => model_provider == controls::MODEL_PROVIDER,
    };
    let fits = text("model") == Some(controls::MODEL)
        && provider_fits
        && text("default_permissions") == Some(controls::PROFILE)
        && is_empty_value(effective.get("sandbox_mode"))
        && is_empty_value(effective.get("sandbox_workspace_write"))
        && text("approval_policy") == Some("on-request")
        && text("approvals_reviewer") == Some("user")
        && text("web_search") == Some("disabled")
        && text("cli_auth_credentials_store") == Some("file")
        && effective.get("project_root_markers") == Some(&Value::Array(Vec::new()))
        && effective
            .get("project_doc_max_bytes")
            .and_then(Value::as_u64)
            == Some(0);
    if !fits {
        problems.push("the effective configuration is not LeadingLight's".to_string());
    }
    let features = effective.get("features");
    let still_on: Vec<&str> = controls::DISABLED_FEATURES
        .iter()
        .copied()
        .filter(|name| features.and_then(|all| all.get(*name)) != Some(&Value::Bool(false)))
        .collect();
    if !still_on.is_empty() {
        problems.push(format!("features not turned off: {still_on:?}"));
    }

    for group in items(&reported.skills, "data") {
        for skill in items(group, "skills") {
            let name = skill.get("name").and_then(Value::as_str).unwrap_or("");
            let off = skill.get("enabled") == Some(&Value::Bool(false))
                && skill.get("scope").and_then(Value::as_str) == Some("system")
                && controls::SYSTEM_SKILLS.contains(&name);
            if !off {
                problems.push(format!("skill not turned off or not a bundled one: {name}"));
            }
        }
    }
    if items(&reported.hooks, "data")
        .iter()
        .any(|group| !items(group, "hooks").is_empty())
    {
        problems.push("hooks were found".to_string());
    }
    if !items(&reported.plugins, "marketplaces").is_empty()
        || !items(&reported.plugins, "featuredPluginIds").is_empty()
    {
        problems.push("plugins were found".to_string());
    }
    if !items(&reported.mcp_servers, "data").is_empty() {
        problems.push("MCP servers were found".to_string());
    }
    problems
}
