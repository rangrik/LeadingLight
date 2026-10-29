use crate::agent::Ask;
use serde_json::{json, Value};
use std::collections::HashMap;

const TOOLS: [&str; 6] = [
    "read_page",
    "search_pages",
    "edit_page",
    "insert_text",
    "write_page",
    "create_page",
];
const DENIED: &str = "This message is outside the paired note conversation.";

pub fn codex_flags(list: &str) -> Result<Vec<(&'static str, String)>, String> {
    let names: std::collections::HashSet<_> = list
        .lines()
        .filter_map(|line| line.split_whitespace().next())
        .collect();
    if !names.contains("shell_tool")
        || !names.contains("view_image") && !names.contains("view_image_tool")
    {
        return Err("Update Codex on this Mac before connecting a browser.".into());
    }
    let mut flags = Vec::new();
    for name in [
        "view_image",
        "view_image_tool",
        "browser_use",
        "browser_use_external",
        "browser_use_full_cdp_access",
        "computer_use",
        "in_app_browser",
        "in_app_local_automation",
        "code_mode",
        "js_repl",
        "remote_plugin",
        "recommended_plugins",
        "enable_mcp_apps",
        "multi_agent_v2",
        "memories",
        "skill_search",
        "skill_mcp_dependency_install",
        "shell_snapshot",
        "workspace_dependencies",
    ] {
        if names.contains(name) {
            flags.push(("--disable", name.into()));
        }
    }
    if names.contains("skip_host_skill_discovery") {
        flags.push(("--enable", "skip_host_skill_discovery".into()));
    }
    if names.contains("code_mode_host") {
        flags.push(("--enable", "code_mode_host".into()));
    }
    Ok(flags)
}

pub fn codex_mcp_override(list: &Value) -> Result<String, String> {
    let servers = list.as_array().filter(|v| v.len() <= 200).ok_or(DENIED)?;
    let mut names = std::collections::BTreeSet::new();
    for server in servers {
        let name = server["name"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 200 && !s.chars().any(char::is_control))
            .ok_or(DENIED)?;
        names.insert(name);
    }
    // Empty tables merge with user configuration; disable each inherited entry explicitly.
    Ok(format!(
        "mcp_servers={{{}}}",
        names
            .into_iter()
            .map(|name| format!("{}={{enabled=false,required=false}}", json!(name)))
            .collect::<Vec<_>>()
            .join(",")
    ))
}

pub fn codex_config_safe(result: &Value, flags: &[(&str, String)]) -> Result<(), String> {
    let config = result
        .get("config")
        .filter(|v| v.is_object())
        .ok_or(DENIED)?;
    let servers = config["mcp_servers"].as_object().ok_or(DENIED)?;
    if servers.values().any(|v| v["enabled"] != false)
        || !config["notify"].as_array().is_some_and(Vec::is_empty)
        || [
            "shell_tool",
            "hooks",
            "apps",
            "plugins",
            "multi_agent",
            "image_generation",
            "goals",
        ]
        .iter()
        .any(|name| config["features"][name] != false)
        || flags
            .iter()
            .any(|(flag, name)| config["features"][name] != (*flag == "--enable"))
    {
        return Err("Codex could not isolate this note conversation from your configured tools. No thread was started.".into());
    }
    Ok(())
}

pub fn validate(ask: &Ask) -> Result<(), String> {
    let safe = |s: &str| {
        !s.is_empty()
            && s.len() <= 120
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_.:".contains(c))
    };
    if !matches!(ask.provider.as_str(), "claude" | "codex")
        || ask.tail
        || !safe(&ask.model)
        || !matches!(
            ask.effort.as_str(),
            "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra"
        )
        || !matches!(ask.access.as_str(), "ask" | "auto" | "full" | "plan")
        || ask.prompt.len() > 180_000
        || ask.system.len() > 40_000
        || ask.resume.as_ref().is_some_and(|s| !safe(s))
    {
        return Err("Only bounded note conversations can run through this connection.".into());
    }
    Ok(())
}

// The Mac fixes every executable setting; browser messages carry only note data and decisions.
pub struct Guard {
    ask: Ask,
    pending: HashMap<String, Value>,
    opening: bool,
    thread: Option<String>,
    turn: Option<String>,
    started: bool,
    ready: bool,
}

impl Guard {
    pub fn new(ask: Ask) -> Self {
        Self {
            ask,
            pending: HashMap::new(),
            opening: false,
            thread: None,
            turn: None,
            started: false,
            ready: false,
        }
    }

    pub fn observe(&mut self, line: &Value) -> Option<String> {
        if self.ask.provider == "claude" {
            if line["type"] == "control_request" {
                if let Some(id) = line["request_id"].as_str().filter(|s| s.len() <= 200) {
                    if self.pending.len() < 32 {
                        self.pending.insert(id.into(), line["request"].clone());
                    }
                }
            }
            return (line["type"] == "result")
                .then(|| line["session_id"].as_str().map(String::from))
                .flatten();
        }
        if line.get("method").is_none() {
            if line["id"] == 0 && line["result"].is_object() {
                self.ready = true;
            }
            if line["id"] == 1 && self.opening {
                self.opening = false;
                self.thread = line["result"]["thread"]["id"].as_str().map(String::from);
                return self.thread.clone();
            }
            if line["id"] == 2 && self.started {
                self.turn = line["result"]["turn"]["id"].as_str().map(String::from);
            }
        } else if line.get("id").is_some() && self.pending.len() < 32 {
            self.pending.insert(line["id"].to_string(), line.clone());
        }
        None
    }

    pub fn reply(&mut self, value: &Value) -> Result<Value, String> {
        if value.to_string().len() > 240_000 {
            return Err(DENIED.into());
        }
        if self.ask.provider == "claude" {
            return self.claude(value);
        }
        let p = &value["params"];
        match value["method"].as_str() {
            Some("thread/start" | "thread/resume")
                if value["id"] == 1
                    && self.ready
                    && !self.opening
                    && self.thread.is_none()
                    && !self.started =>
            {
                let resume = value["method"] == "thread/resume";
                let mut params = json!({ "model": self.ask.model, "approvalPolicy": "never", "sandbox": "read-only" });
                if resume {
                    let owned = self.ask.resume.as_deref().ok_or(DENIED)?;
                    if p["threadId"] != owned {
                        return Err(DENIED.into());
                    }
                    params["threadId"] = json!(owned);
                } else {
                    params["developerInstructions"] = json!(self.ask.system);
                    params["dynamicTools"] = Value::Array(tools().into_iter().map(|t| json!({"type":"function","name":t["name"],"description":t["description"],"inputSchema":t["inputSchema"]})).collect());
                }
                self.opening = true;
                Ok(json!({"method":value["method"],"id":1,"params":params}))
            }
            Some("turn/start") if value["id"] == 2 && !self.started => {
                let thread = self.thread.as_deref().ok_or(DENIED)?;
                if p["threadId"] != thread {
                    return Err(DENIED.into());
                }
                let input = p["input"]
                    .as_array()
                    .filter(|v| v.len() == 1)
                    .ok_or(DENIED)?;
                let text = input[0]["text"]
                    .as_str()
                    .filter(|v| v.len() <= 220_000)
                    .ok_or(DENIED)?;
                self.started = true;
                Ok(
                    json!({"method":"turn/start","id":2,"params":{"threadId":thread,"input":[{"type":"text","text":text,"text_elements":[]}],"model":self.ask.model,"effort":self.ask.effort,"summary":"auto","approvalPolicy":"never","sandboxPolicy":{"type":"readOnly","networkAccess":false}}}),
                )
            }
            Some("turn/interrupt") if value["id"] == 3 => {
                let thread = self.thread.as_deref().ok_or(DENIED)?;
                let turn = self.turn.as_deref().ok_or(DENIED)?;
                if p["threadId"] != thread || p["turnId"] != turn {
                    return Err(DENIED.into());
                }
                Ok(
                    json!({"method":"turn/interrupt","id":3,"params":{"threadId":thread,"turnId":turn}}),
                )
            }
            None => {
                let key = value["id"].to_string();
                let request = self.pending.get(&key).ok_or(DENIED)?;
                let out = if request["method"] == "item/tool/call"
                    && TOOLS.contains(&request["params"]["tool"].as_str().unwrap_or(""))
                {
                    let contents = value["result"]["contentItems"].as_array().ok_or(DENIED)?;
                    if contents.len() > 50
                        || contents
                            .iter()
                            .any(|v| v["type"] != "inputText" || v["text"].as_str().is_none())
                    {
                        return Err(DENIED.into());
                    }
                    json!({"id":request["id"],"result":{"contentItems":contents.iter().map(|c|json!({"type":"inputText","text":c["text"]})).collect::<Vec<_>>(),"success":value["result"]["success"].as_bool().ok_or(DENIED)?}})
                } else {
                    json!({"id":request["id"],"error":{"code":-32601,"message":"Not supported in a note conversation"}})
                };
                self.pending.remove(&key);
                Ok(out)
            }
            _ => Err(DENIED.into()),
        }
    }

    fn claude(&mut self, value: &Value) -> Result<Value, String> {
        if value["type"] != "control_response" {
            return Err(DENIED.into());
        }
        let response = &value["response"];
        let id = response["request_id"].as_str().ok_or(DENIED)?;
        let r = self.pending.get(id).ok_or(DENIED)?;
        let result = match r["subtype"].as_str() {
            Some("can_use_tool") => {
                let name = r["tool_name"].as_str().unwrap_or("");
                let known = matches!(name, "WebFetch" | "WebSearch" | "ExitPlanMode")
                    || name
                        .strip_prefix("mcp__notes__")
                        .is_some_and(|n| TOOLS.contains(&n));
                if !known {
                    return Err(DENIED.into());
                }
                match response["response"]["behavior"].as_str() {
                    Some("allow") => json!({"behavior":"allow","updatedInput":r["input"]}),
                    Some("deny") => {
                        json!({"behavior":"deny","message":response["response"]["message"].as_str().unwrap_or("Declined").chars().take(1000).collect::<String>(),"interrupt":response["response"]["interrupt"].as_bool().unwrap_or(false)})
                    }
                    _ => return Err(DENIED.into()),
                }
            }
            Some("mcp_message") => {
                let m = &r["message"];
                let supplied = &response["response"]["mcp_response"];
                let result = if m.get("id").is_none() {
                    json!({})
                } else {
                    match m["method"].as_str() {
                        Some("initialize") => {
                            json!({"protocolVersion":m["params"]["protocolVersion"],"capabilities":{"tools":{}},"serverInfo":{"name":"notes","version":"1"}})
                        }
                        Some("tools/list") => json!({"tools":tools()}),
                        Some("ping") | None => json!({}),
                        Some("tools/call")
                            if TOOLS.contains(&m["params"]["name"].as_str().unwrap_or("")) =>
                        {
                            let content = supplied["result"]["content"].as_array().ok_or(DENIED)?;
                            if content.len() > 50
                                || content
                                    .iter()
                                    .any(|c| c["type"] != "text" || c["text"].as_str().is_none())
                            {
                                return Err(DENIED.into());
                            }
                            json!({"content":content.iter().map(|c|json!({"type":"text","text":c["text"]})).collect::<Vec<_>>(),"isError":supplied["result"]["isError"].as_bool().unwrap_or(false)})
                        }
                        _ => return Err(DENIED.into()),
                    }
                };
                json!({"mcp_response":{"jsonrpc":"2.0","id":m.get("id").cloned().unwrap_or(json!(0)),"result":result}})
            }
            _ => return Err(DENIED.into()),
        };
        self.pending.remove(id);
        Ok(
            json!({"type":"control_response","response":{"subtype":"success","request_id":id,"response":result}}),
        )
    }
}

fn tools() -> Vec<Value> {
    let fields: [(&str, &str, &[&str], &[&str]); 6] = [
        (
            "read_page",
            "Read a page as Markdown; omit page for the current page.",
            &["page"],
            &[],
        ),
        (
            "search_pages",
            "Search page titles and text.",
            &["query"],
            &["query"],
        ),
        (
            "edit_page",
            "Replace words occurring exactly once in the current page; replacement is Markdown.",
            &["find", "replace"],
            &["find", "replace"],
        ),
        (
            "insert_text",
            "Insert Markdown after a matching block or at the end of the current page.",
            &["markdown", "after"],
            &["markdown"],
        ),
        (
            "write_page",
            "Replace the current page body with Markdown.",
            &["markdown"],
            &["markdown"],
        ),
        (
            "create_page",
            "Create a page with a title and Markdown body.",
            &["title", "markdown"],
            &["title"],
        ),
    ];
    fields.into_iter().map(|(name, description, fields, required)| {
        let properties = fields.iter().map(|key| (key.to_string(), json!({"type":"string"}))).collect::<serde_json::Map<_,_>>();
        json!({"name":name,"description":description,"inputSchema":{"type":"object","properties":properties,"required":required}})
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn ask(provider: &str) -> Ask {
        serde_json::from_value(json!({"id":"test","provider":provider,"model":"gpt-6","effort":"high","access":"ask","prompt":"note","system":"notes"})).unwrap()
    }

    #[test]
    fn remote_features_are_disabled_only_when_the_cli_supports_the_flags() {
        assert!(codex_flags("shell_tool stable true").is_err());
        let flags=codex_flags("shell_tool stable true\nview_image stable true\nbrowser_use stable true\nskip_host_skill_discovery stable false\ncode_mode_host stable true\nremote_plugin stable true").unwrap();
        assert!(flags.contains(&("--disable", "view_image".into())));
        assert!(flags.contains(&("--disable", "browser_use".into())));
        assert!(!flags.iter().any(|(_, n)| n == "computer_use"));
        assert!(flags.contains(&("--enable", "skip_host_skill_discovery".into())));
        assert!(flags.contains(&("--enable", "code_mode_host".into())));
        assert!(flags.contains(&("--disable", "remote_plugin".into())));
    }

    #[test]
    fn inherited_executable_config_fails_closed_before_thread_start() {
        let override_ = codex_mcp_override(&json!([{"name":"user.server","env":{"secret":"must-not-copy"}}, {"name":"quoted\"name"}])).unwrap();
        assert!(override_.contains("\"user.server\"={enabled=false,required=false}"));
        assert!(!override_.contains("secret"));
        assert!(codex_mcp_override(&json!([{"name":"bad\nname"}])).is_err());
        let mut result = json!({"config":{"mcp_servers":{"user.server":{"enabled":false}},"notify":[],"features":{"shell_tool":false,"hooks":false,"apps":false,"plugins":false,"multi_agent":false,"image_generation":false,"goals":false,"code_mode_host":true}}});
        let flags = vec![("--enable", "code_mode_host".into())];
        assert!(codex_config_safe(&result, &flags).is_ok());
        result["config"]["mcp_servers"]["new-server"] = json!({"command":"must-not-run"});
        assert!(codex_config_safe(&result, &flags).is_err());
        result["config"]["mcp_servers"]["new-server"]["enabled"] = json!(false);
        result["config"]["notify"] = json!(["must-not-run"]);
        assert!(codex_config_safe(&result, &flags).is_err());
        result["config"]["notify"] = json!([]);
        result["config"]["features"]["plugins"] = json!(true);
        assert!(codex_config_safe(&result, &flags).is_err());
        assert!(codex_config_safe(&json!({}), &flags).is_err());
    }

    #[test]
    fn remote_codex_cannot_escalate_or_resume_another_thread() {
        let mut no_reasoning = ask("codex");
        no_reasoning.effort = "none".into();
        assert!(validate(&no_reasoning).is_ok());
        let mut g = Guard::new(ask("codex"));
        assert!(g
            .reply(&json!({"method":"account/login/start","id":1}))
            .is_err());
        assert!(g
            .reply(&json!({"method":"thread/resume","id":1,"params":{"threadId":"other"}}))
            .is_err());
        assert!(g
            .reply(&json!({"method":"thread/start","id":1,"params":{}}))
            .is_err());
        g.observe(&json!({"id":0,"result":{}}));
        let out = g.reply(&json!({"method":"thread/start","id":1,"params":{"sandbox":"danger-full-access","cwd":"/","dynamicTools":[]}})).unwrap();
        assert_eq!(out["params"]["sandbox"], "read-only");
        assert!(out["params"].get("cwd").is_none());
        assert_eq!(out["params"]["dynamicTools"].as_array().unwrap().len(), 6);
        g.observe(&json!({"id":1,"result":{"thread":{"id":"owned"}}}));
        assert!(g.reply(&json!({"method":"turn/start","id":2,"params":{"threadId":"other","input":[{"text":"go"}]}})).is_err());
        assert!(g.reply(&json!({"id":"unknown","result":{}})).is_err());
    }

    #[test]
    fn claude_approval_is_correlated_and_cannot_change_input_or_permissions() {
        let mut g = Guard::new(ask("claude"));
        let reply = json!({"type":"control_response","response":{"request_id":"a","response":{"behavior":"allow","updatedInput":{"command":"rm"},"updatedPermissions":[{}]}}});
        assert!(g.reply(&reply).is_err());
        g.observe(&json!({"type":"control_request","request_id":"a","request":{"subtype":"can_use_tool","tool_name":"WebFetch","input":{"url":"https://example.com"}}}));
        let out = g.reply(&reply).unwrap();
        assert_eq!(
            out["response"]["response"]["updatedInput"]["url"],
            "https://example.com"
        );
        assert!(out["response"]["response"]
            .get("updatedPermissions")
            .is_none());
        assert!(g.reply(&reply).is_err());
    }
}
