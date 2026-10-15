//! LeadingLight's local-only boundary. Stored settings cannot relax this policy.

pub const REMOTE_FEATURES_ENABLED: bool = false;
// These local features are deferred until document ownership spans scopes/windows.
pub const MULTI_WORKSPACE_ENABLED: bool = false;
pub const SEPARATE_WINDOWS_ENABLED: bool = false;
pub const DISABLED_FEATURE_MESSAGE: &str =
    "This feature is unavailable in LeadingLight's local-only mode.";

pub fn is_disabled_menu_command(command: &str) -> bool {
    if !SEPARATE_WINDOWS_ENABLED && command == "note-open-in-new-window" {
        return true;
    }
    matches!(
        command,
        "app-check-for-updates"
            | "view-toggle-ai-chat"
            | "vault-restore-getting-started"
            | "vault-add-remote"
            | "vault-commit-push"
            | "vault-pull"
            | "vault-install-mcp"
    )
}

/// Reject before dispatch, including commands invoked outside the visible UI.
pub fn is_disabled_command(command: &str) -> bool {
    if !SEPARATE_WINDOWS_ENABLED && command == "open_vault_in_new_window" {
        return true;
    }
    matches!(
        command,
        "git_pull"
            | "git_push"
            | "git_remote_status"
            | "git_add_remote"
            | "clone_git_repo"
            | "check_claude_cli"
            | "get_ai_agents_status"
            | "get_ai_agent_model_catalog"
            | "get_agent_docs_path"
            | "get_vault_ai_guidance_status"
            | "restore_vault_ai_guidance"
            | "stream_claude_chat"
            | "stream_ai_agent"
            | "stream_ai_model"
            | "save_ai_model_provider_api_key"
            | "delete_ai_model_provider_api_key"
            | "test_ai_model_provider"
            | "download_remote_image_to_vault"
            | "check_for_app_update"
            | "download_and_install_app_update"
            | "create_getting_started_vault"
            | "register_mcp_tools"
            | "remove_mcp_tools"
            | "check_mcp_status"
            | "get_mcp_config_snippet"
            | "get_opencode_mcp_config_snippet"
            | "sync_mcp_bridge_vault"
    )
}

pub fn disabled_feature_message(command: &str) -> &'static str {
    if command == "open_vault_in_new_window" {
        "Separate windows are unavailable in this version of LeadingLight. Open another pane instead."
    } else {
        DISABLED_FEATURE_MESSAGE
    }
}

pub fn apply_local_only_settings(
    mut settings: crate::settings::Settings,
) -> crate::settings::Settings {
    settings.git_enabled = Some(false);
    settings.autogit_enabled = Some(false);
    settings.autogit_use_ai_commit_messages = Some(false);
    settings.telemetry_consent = Some(false);
    settings.crash_reporting_enabled = Some(false);
    settings.analytics_enabled = Some(false);
    settings.anonymous_id = None;
    settings.automatic_update_checks_enabled = Some(false);
    settings.ai_features_enabled = Some(false);
    settings.multi_workspace_enabled =
        Some(MULTI_WORKSPACE_ENABLED && settings.multi_workspace_enabled == Some(true));
    settings
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_network_and_bridge_commands_but_preserves_local_editing() {
        for command in [
            "git_pull",
            "git_push",
            "clone_git_repo",
            "stream_ai_agent",
            "stream_ai_model",
            "test_ai_model_provider",
            "download_remote_image_to_vault",
            "check_for_app_update",
            "create_getting_started_vault",
            "sync_mcp_bridge_vault",
        ] {
            assert!(is_disabled_command(command), "{command}");
        }
        for command in [
            "get_note_content",
            "save_note_content",
            "create_empty_vault",
            "save_image",
            "get_file_history",
        ] {
            assert!(!is_disabled_command(command), "{command}");
        }
    }

    #[test]
    fn persisted_opt_ins_cannot_enable_remote_features() {
        let settings = apply_local_only_settings(crate::settings::Settings {
            git_enabled: Some(true),
            autogit_enabled: Some(true),
            crash_reporting_enabled: Some(true),
            analytics_enabled: Some(true),
            automatic_update_checks_enabled: Some(true),
            ai_features_enabled: Some(true),
            ..Default::default()
        });
        assert_eq!(settings.git_enabled, Some(false));
        assert_eq!(settings.autogit_enabled, Some(false));
        assert_eq!(settings.crash_reporting_enabled, Some(false));
        assert_eq!(settings.analytics_enabled, Some(false));
        assert_eq!(settings.automatic_update_checks_enabled, Some(false));
        assert_eq!(settings.ai_features_enabled, Some(false));
    }

    #[test]
    fn first_release_defers_multi_workspace_and_separate_windows() {
        let settings = apply_local_only_settings(crate::settings::Settings {
            multi_workspace_enabled: Some(true),
            ..Default::default()
        });
        assert_eq!(settings.multi_workspace_enabled, Some(false));
        assert!(is_disabled_command("open_vault_in_new_window"));
        assert!(is_disabled_menu_command("note-open-in-new-window"));
        assert!(!is_disabled_command("list_vault"));
        assert!(!is_disabled_command("create_empty_vault"));
        assert!(!is_disabled_menu_command("vault-open"));
    }
}
