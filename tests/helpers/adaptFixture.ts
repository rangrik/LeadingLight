import type { Page } from '@playwright/test'
import type { AdaptFixtureControl, AdaptFixtureEnvelope, AdaptFixtureScript } from '../../src/mock-tauri/mock-adapt'

// The explicit, deterministic Adapt provider for browser tests (docs/leadinglight/adapt-browser.md).
// Without it the browser provider is unavailable. The app reads the script once per page load, on
// the dev server only; it never sends anything anywhere, writes a note or activates an extension.
// These names repeat src/mock-tauri/mock-adapt.ts so this file stays free of app imports at run
// time; mock-adapt.test.ts keeps them equal.

export type { AdaptFixtureConnect, AdaptFixtureEnvelope, AdaptFixtureScript, AdaptFixtureTurn } from '../../src/mock-tauri/mock-adapt'

export const ADAPT_FIXTURE_FORMAT = 'leadinglight.adapt-fixture/1'
export const ADAPT_FIXTURE_KEY = 'leadinglight.adaptFixture'

/**
 * Installs `script` for this tab. Call before the first navigation (openFixtureVault…), which then
 * loads the app with it; a reload keeps the same script and the fixture's state.
 */
export async function installAdaptFixture(page: Page, script: AdaptFixtureScript): Promise<void> {
  await page.addInitScript(({ key, text }) => {
    if (sessionStorage.getItem(key) === null) sessionStorage.setItem(key, text)
  }, { key: ADAPT_FIXTURE_KEY, text: JSON.stringify(script) })
}

type FixtureWindow = Window & { __leadinglightAdaptFixture?: AdaptFixtureControl }

/** Lets every held Connect and every held or stopping turn finish; answers how many. */
export function releaseAdaptFixture(page: Page): Promise<number> {
  return page.evaluate(() => {
    const control = (window as FixtureWindow).__leadinglightAdaptFixture
    if (!control) throw new Error('No Adapt fixture is active in this page')
    return control.release()
  })
}

/** Exactly what each admitted Send of this page load gave the fixture provider, oldest first. */
export function adaptFixtureSent(page: Page): Promise<AdaptFixtureEnvelope[]> {
  return page.evaluate(() => {
    const control = (window as FixtureWindow).__leadinglightAdaptFixture
    if (!control) throw new Error('No Adapt fixture is active in this page')
    return control.sent()
  })
}

/**
 * Valid E1 package text: one form field, then one new note in a folder the person chooses. A
 * revision keeps `id`, raises `version` and may switch `variant`. Use a `local.` id.
 */
export function adaptSamplePackage(id: string, version = '1.0.0', variant: 'quote' | 'heading' = 'quote'): string {
  const read = { step: 'form', field: 'read' }
  return JSON.stringify({
    schema: 'leadinglight.extension/1', id, version, name: 'Reading log',
    description: 'Note one thing you read and why it mattered.', capabilities: ['document.create', 'document.open'],
    commands: [{ id: 'log-reading', title: 'Log a reading', steps: [
      { id: 'form', op: 'collectForm', fields: [{ id: 'read', kind: 'text', label: 'What did you read?', required: true }] },
      { id: 'where', op: 'resolveDestination', policy: 'newInChosenFolder' },
      { id: 'note', op: 'composeDocument', title: ['Reading: ', read],
        blocks: variant === 'quote' ? [{ type: 'quote', text: [read] }] : [{ type: 'heading', level: 2, text: ['Read'] }, { type: 'paragraph', text: [read] }] },
      { id: 'save', op: 'proposeDocument' },
      { id: 'open', op: 'openCommittedResult' },
    ] }],
  }, null, 2)
}
