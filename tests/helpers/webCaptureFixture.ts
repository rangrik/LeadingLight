import type { Page } from '@playwright/test'
import type { WebCaptureFixtureControl, WebCaptureFixturePage } from '../../src/mock-tauri/mock-web-capture'

// The explicit website fetch for browser tests: synthetic pages under one reserved `.invalid`
// origin, answered in the page by src/mock-tauri/mock-web-capture.ts. Without it the browser has no
// website fetch at all. The app reads it once per page load, on the dev server and outside native
// only; it never opens a connection. These names repeat mock-web-capture.ts so this file stays
// free of app imports at run time; mock-web-capture.test.ts keeps them equal.

export type { WebCaptureFixturePage } from '../../src/mock-tauri/mock-web-capture'

export const WEB_CAPTURE_FIXTURE_FORMAT = 'leadinglight.web-capture-fixture/1'
export const WEB_CAPTURE_FIXTURE_KEY = 'leadinglight.webCaptureFixture'
export const WEB_CAPTURE_FIXTURE_ORIGIN = 'https://fixtures.leadinglight.invalid'

/** Installs `pages` for this tab. Call before the first navigation, which then loads the app with them. */
export async function installWebCaptureFixture(page: Page, pages: readonly WebCaptureFixturePage[]): Promise<void> {
  await page.addInitScript(({ key, text }) => {
    if (sessionStorage.getItem(key) === null) sessionStorage.setItem(key, text)
  }, { key: WEB_CAPTURE_FIXTURE_KEY, text: JSON.stringify({ fixture: WEB_CAPTURE_FIXTURE_FORMAT, pages }) })
}

type FixtureWindow = Window & { __leadinglightWebCaptureFixture?: WebCaptureFixtureControl }

/** Every address this page load asked the fixture for, in order. */
export function webCaptureFixtureRequests(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const control = (window as FixtureWindow).__leadinglightWebCaptureFixture
    if (!control) throw new Error('No website fixture is active in this page')
    return control.requests()
  })
}
