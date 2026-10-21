// What the window offers for website commands. Website saving needs the native fetch, the page
// conversion and the dialog together; this flag and native's `WEBSITE_SERVICES_QUALIFIED` switch together.
import type { Capability } from '../extensions/extensionContract'
import { isTauri } from '../../mock-tauri'

/** Set with native's flag: this build has the whole website path. */
export const WEBSITE_FRONTEND_QUALIFIED = true

/**
 * Whether this window performs `web.capture`. The desktop window does when the website path is
 * qualified. A browser has no native fetch, so only a dev browser whose test installed the synthetic
 * fetch fixture does; the fixture never counts in the desktop window.
 */
export function offersWebCapture(native: boolean, fixtureInstalled: boolean, qualified: boolean = WEBSITE_FRONTEND_QUALIFIED): boolean {
  return native ? qualified : fixtureInstalled
}

/**
 * The host list for this window: `base` plus `web.capture` where `offersWebCapture` allows it. Never
 * more: other capabilities stay as `base` has them. `native` defaults to the app's own check.
 */
export function websiteHostCapabilities(base: readonly Capability[], fixtureInstalled = false, native: boolean = isTauri()): readonly Capability[] {
  if (base.includes('web.capture') || !offersWebCapture(native, fixtureInstalled)) return base
  return [...base, 'web.capture']
}
