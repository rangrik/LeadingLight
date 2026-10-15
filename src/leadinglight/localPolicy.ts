import type { Settings } from '../types'

/** Product policy, independent of persisted preferences or build-time credentials. */
export const REMOTE_FEATURES_ENABLED = false

/** Deferred local features need safe ownership across changing scopes and windows. */
export const MULTI_WORKSPACE_ENABLED = false
export const SEPARATE_WINDOWS_ENABLED = false

export function applyLocalOnlySettings(settings: Settings): Settings {
  return {
    ...settings,
    git_enabled: false,
    autogit_enabled: false,
    autogit_use_ai_commit_messages: false,
    telemetry_consent: false,
    crash_reporting_enabled: false,
    analytics_enabled: false,
    anonymous_id: null,
    automatic_update_checks_enabled: false,
    ai_features_enabled: false,
    multi_workspace_enabled: MULTI_WORKSPACE_ENABLED && settings.multi_workspace_enabled === true,
  }
}
