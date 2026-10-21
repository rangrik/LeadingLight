//! The one Codex build and model Adapt runs, and the exact controls it starts them with.
//!
//! Qualified offline for exactly this native build and model (see
//! `docs/leadinglight/adapt-provider.md` and the qualification in `codex_tests.rs`). With these
//! controls the model is offered only `request_user_input`, which is inert in Default mode, and
//! freeform `apply_patch`. Under the `adapt` permission profile an existing file outside the empty
//! run folder cannot be read even to prepare a patch, and any write first needs a grant Adapt never
//! gives: the turn is interrupted, the request declined only once the turn is over, and the process
//! group killed. That composition is the boundary; "Codex has no tools" would not be true.
//!
//! Anything else, another build, another model or another configuration, is reported unsupported
//! or unqualified and is never started. Nothing is ever installed or updated for you.

use std::path::Path;

use serde_json::{json, Value};

/// The `codex-cli` version of the qualified build, as it reports itself.
pub(crate) const PINNED_VERSION: &str = "0.162.1";
/// SHA-256 of the qualified native binary (the npm `@openai/codex-darwin-arm64` payload).
pub(crate) const PINNED_SHA256: &str =
    "74c6a6d263f40d65f99c27a815275f5b4ed0bcc2baecc396b4cf3255498bdfc0";
/// Its size, checked before hashing so an obviously different file is never read whole.
pub(crate) const PINNED_BYTES: u64 = 246_642_624;
/// The only model Adapt asks for. No other model is ever substituted.
pub(crate) const MODEL: &str = "gpt-5.5";
/// The provider id a ChatGPT sign-in runs under.
pub(crate) const MODEL_PROVIDER: &str = "openai";
/// The permission profile every Adapt process runs under.
pub(crate) const PROFILE: &str = "adapt";

/// Where the pinned build's native payload sits under a Node installation prefix. Only a file whose
/// hash is `PINNED_SHA256` is ever run from any of these.
pub(crate) const NPM_PAYLOADS: &[&str] = &[
    "lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex",
    "lib/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex",
];
/// Native Codex installs that are looked at only to report an unsupported version; never run.
pub(crate) const OTHER_INSTALLS: &[&str] = &[
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    "/usr/bin/codex",
];

/// The bundled skills this build installs into its own home on start. Each is turned off below.
pub(crate) const SYSTEM_SKILLS: &[&str] = &[
    "imagegen",
    "openai-docs",
    "review-agent",
    "skill-creator",
    "skill-installer",
];

/// The links this build creates for itself in `CODEX_HOME/tmp/arg0/codex-arg0XXXXXX/`, each to its
/// own executable. No other link is ever accepted in the private home.
pub(crate) const HELPER_LINKS: &[&str] = &["apply_patch", "applypatch", "codex-execve-wrapper"];

/// Every feature this build reports on by default that is not marked removed, as listed by its own
/// `codex features list`. All are turned off; removed flags are not controls and are not named.
/// `unified_exec` stays reported on (its opt-out is documented as ignored) and adds no tool here.
pub(crate) const DISABLED_FEATURES: &[&str] = &[
    "api_key_model_discovery",
    "apps",
    "auth_elicitation",
    "browser_annotation_api",
    "browser_use",
    "browser_use_external",
    "browser_use_full_cdp_access",
    "code_mode_host",
    "compaction_image_budget",
    "computer_use",
    "content_item_kinds",
    "daemon_auto_start",
    "enable_request_compression",
    "fast_mode",
    "goals",
    "guardian_approval",
    "guardian_reuse_parent_compaction",
    "hooks",
    "image_generation",
    "in_app_browser",
    "in_app_chat",
    "in_app_dictation",
    "in_app_local_automation",
    "in_app_updates",
    "in_app_voice",
    "instant_interrupt",
    "mentions_v2",
    "multi_agent",
    "plugin_sharing",
    "plugins",
    "realtime_conversation",
    "remote_plugin",
    "shell_snapshot",
    "shell_tool",
    "skill_mcp_dependency_install",
    "skill_search",
    "sleep_tool",
    "system_proxy_fallback",
    "tool_call_mcp_elicitation",
    "tool_suggest",
    "ultrafast_mode",
    "unbounded_connection_retries",
    "unified_exec",
    "unified_exec_tty",
    "view_image",
    "workspace_dependencies",
    "worktrees",
    "write_stdin_approval",
];

/// A TOML basic string: quotes, backslashes and control characters escaped.
pub(crate) fn toml_string(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for character in text.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            '\r' => out.push_str("\\r"),
            control if control.is_control() => {
                out.push_str(&format!("\\u{:04X}", u32::from(control)));
            }
            other => out.push(other),
        }
    }
    out.push('"');
    out
}

/// The private home's whole `config.toml`, byte for byte, for `model` (always `MODEL` outside
/// tests). `provider` names a model provider other than the default ChatGPT one as (id, base URL,
/// environment key); only the offline qualification passes one, for its loopback fixture.
pub(crate) fn config_toml(
    model: &str,
    codex_home: &Path,
    run_dir: &Path,
    provider: Option<(&str, &str, &str)>,
) -> String {
    let mut text = String::new();
    text.push_str(&format!("model = {}\n", toml_string(model)));
    if let Some((id, _, _)) = provider {
        text.push_str(&format!("model_provider = {}\n", toml_string(id)));
    }
    for line in [
        "approval_policy = \"on-request\"",
        "approvals_reviewer = \"user\"",
        "default_permissions = \"adapt\"",
        "web_search = \"disabled\"",
        "project_doc_max_bytes = 0",
        "project_doc_fallback_filenames = []",
        "project_root_markers = []",
        "include_permissions_instructions = false",
        "include_apps_instructions = false",
        "include_collaboration_mode_instructions = false",
        "include_environment_context = false",
        "check_for_update_on_startup = false",
        "cli_auth_credentials_store = \"file\"",
    ] {
        text.push_str(line);
        text.push('\n');
    }
    if let Some((id, base_url, env_key)) = provider {
        text.push_str(&format!("\n[model_providers.{}]\n", toml_string(id)));
        text.push_str("name = \"LeadingLight offline qualification\"\n");
        text.push_str(&format!("base_url = {}\n", toml_string(base_url)));
        text.push_str("wire_api = \"responses\"\n");
        text.push_str(&format!("env_key = {}\n", toml_string(env_key)));
    }
    text.push_str("\n[permissions.adapt]\n");
    text.push_str("description = \"Adapt: read only the empty run folder; no network.\"\n");
    text.push_str("\n[permissions.adapt.filesystem]\n");
    text.push_str("\":root\" = \"deny\"\n");
    text.push_str(&format!(
        "{} = \"read\"\n",
        toml_string(&run_dir.to_string_lossy())
    ));
    text.push_str("\n[permissions.adapt.network]\nenabled = false\n");
    text.push_str("\n[history]\npersistence = \"none\"\n");
    text.push_str("\n[analytics]\nenabled = false\n");
    text.push_str("\n[features]\n");
    for feature in DISABLED_FEATURES {
        text.push_str(&format!("{feature} = false\n"));
    }
    for skill in SYSTEM_SKILLS {
        let path = codex_home
            .join("skills")
            .join(".system")
            .join(skill)
            .join("SKILL.md");
        text.push_str("\n[[skills.config]]\n");
        text.push_str(&format!(
            "path = {}\n",
            toml_string(&path.to_string_lossy())
        ));
        text.push_str("enabled = false\n");
    }
    text
}

/// `codex app-server` over stdio, exactly as qualified. No flag is added: an unrecognized setting
/// would show as a `configWarning`, which refuses the turn, and the gate reads the effective
/// configuration back before any thread exists.
pub(crate) fn app_server_args() -> Vec<String> {
    vec!["app-server".to_string()]
}

/// Thread items a turn may contain without stopping.
pub(crate) const ALLOWED_ITEMS: &[&str] = &["userMessage", "agentMessage", "reasoning"];
/// The item an `apply_patch` attempt produces. It stops the turn; it is an attempt this build is
/// known to make, not a crossing of the boundary.
pub(crate) const PATCH_ITEM: &str = "fileChange";

/// Notifications only an executed command, an applied change, a hook, a process or MCP traffic can
/// cause. Any of them stops the turn and marks the provider as having crossed the boundary.
pub(crate) const EFFECT_NOTIFICATIONS: &[&str] = &[
    "hook/started",
    "hook/completed",
    "item/commandExecution/outputDelta",
    "item/commandExecution/terminalInteraction",
    "item/fileChange/outputDelta",
    "item/mcpToolCall/progress",
    "command/exec/outputDelta",
    "process/outputDelta",
    "process/exited",
    "mcpServer/event/stream/notification",
    "fs/changed",
];
/// Notifications a proposed patch causes before any grant. They stop the turn like the patch item.
pub(crate) const PATCH_NOTIFICATIONS: &[&str] =
    &["turn/diff/updated", "item/fileChange/patchUpdated"];

/// Requests a proposed patch causes: the provider asking for write authority it never gets.
pub(crate) const PATCH_REQUESTS: &[&str] =
    &["item/fileChange/requestApproval", "applyPatchApproval"];

/// The schema-valid refusal for each request the provider can make, or `None` for a JSON-RPC error.
/// Nothing is ever approved, answered, run or provided.
pub(crate) fn refusal(method: &str) -> Option<Value> {
    match method {
        "item/fileChange/requestApproval" | "item/commandExecution/requestApproval" => {
            Some(json!({ "decision": "decline" }))
        }
        "applyPatchApproval" | "execCommandApproval" => Some(json!({ "decision": "denied" })),
        "mcpServer/elicitation/request" => Some(json!({ "action": "decline" })),
        _ => None,
    }
}

/// The only sign-in page LeadingLight opens in the browser.
pub(crate) const SIGN_IN_ORIGIN: &str = "https://auth.openai.com/";
