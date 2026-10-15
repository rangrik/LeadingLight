import type { Settings } from '../types'
import { REMOTE_FEATURES_ENABLED } from '../leadinglight/localPolicy'

export function areGitFeaturesEnabled(settings: Pick<Settings, 'git_enabled'>): boolean {
  return REMOTE_FEATURES_ENABLED && settings.git_enabled !== false
}
