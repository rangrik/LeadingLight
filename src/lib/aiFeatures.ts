import type { Settings } from '../types'
import { REMOTE_FEATURES_ENABLED } from '../leadinglight/localPolicy'

export function areAiFeaturesEnabled(settings: Pick<Settings, 'ai_features_enabled'> | null | undefined): boolean {
  return REMOTE_FEATURES_ENABLED && settings?.ai_features_enabled !== false
}
