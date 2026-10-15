import type { Settings } from '../types'
import { REMOTE_FEATURES_ENABLED } from '../leadinglight/localPolicy'

export function areAutomaticUpdateChecksEnabled(
  settings: Pick<Settings, 'automatic_update_checks_enabled'> | null | undefined,
): boolean {
  return REMOTE_FEATURES_ENABLED && settings?.automatic_update_checks_enabled !== false
}
