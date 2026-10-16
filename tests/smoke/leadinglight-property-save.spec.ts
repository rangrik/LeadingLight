import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type Locator, type Page, type Request, type Route } from '@playwright/test'
import { APP_COMMAND_IDS } from '../../src/hooks/appCommandCatalog'
import { createFixtureVaultCopy, openFixtureVaultTauri, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { triggerMenuCommand, triggerShortcutCommand } from './testBridge'

// A property write has read the page and is held before it reaches disk while newer text is
// typed and saved. When it lands, disk and editor must keep both the newer text and the property.

const NOTE_FILE = path.join('note', 'note-b.md')
const NOTE_PATH_SUFFIX = '/note/note-b.md'
const ORIGINAL_SENTENCE = 'This is Note B, referenced by Alpha Project.'
const NEW_STATUS = 'Racewatch'
const RICH_TEXT = 'Rich text typed while the property write waits'
const RAW_TEXT = 'Raw text saved while the property write waits'
const RAW_TAIL = 'and raw text typed just before it lands'
// Rich change debounce plus autosave debounce is 3 s; leave room for that save to be tried.
const AUTOSAVE_WINDOW_MS = 4_000
const SETTLED_AFTER_MS = 3_500

interface PropertyWriteGate {
  heldContent: string | null
  overlapping: string[]
  /** Ordinary saves of this page seen at the page save route, so its watch is shown to be live. */
  pageSaves: number
  lastNoteSaveAt: number
  /** During the test: the held write continues to the real backend. */
  release: () => void
  /** Cleanup: a still-held write is aborted, and every admitted request is answered on return. */
  dispose: () => Promise<void>
}

let vault: string
let activeGate: PropertyWriteGate | null = null

test.beforeEach(() => {
  vault = createFixtureVaultCopy()
})

// No new vault work is admitted, every admitted write is answered, the page closes, then the vault goes.
test.afterEach(async ({ page }) => {
  try {
    // Registered last, so it runs before the gate's routes for every later request.
    if (!page.isClosed()) await page.route('**/api/vault/**', route => route.abort().catch(() => undefined))
    await activeGate?.dispose()
    activeGate = null
    await page.close({ runBeforeUnload: false })
  } finally {
    removeFixtureVaultCopy(vault)
  }
})

// The legacy writer sends {path, content}; the page save route sends {request: {path, …}, content}.
function readSaveBody(request: Request): { notePath: string, content: string } {
  try {
    const body = request.postDataJSON() as { path?: unknown, content?: unknown, request?: { path?: unknown } } | null
    const notePath = body?.request?.path ?? body?.path
    return {
      notePath: typeof notePath === 'string' ? notePath : '',
      content: typeof body?.content === 'string' ? body.content : '',
    }
  } catch {
    return { notePath: '', content: '' }
  }
}

// Settles only once the request is answered, so cleanup can join it before the vault goes.
async function forward(route: Route): Promise<void> {
  await route.continue()
  await route.request().response().catch(() => null)
}

// Holds only the property command's own write, the first legacy save of this page carrying the new
// value. Ordinary saves now use the page save route, so overlap is watched at both writers.
async function holdPropertyWrite(page: Page): Promise<PropertyWriteGate> {
  // The first decision wins: a release in the test continues, so a later dispose only waits.
  let decide: (decision: 'continue' | 'abort') => void = () => {}
  const decision = new Promise<'continue' | 'abort'>((resolve) => { decide = resolve })
  // Every admitted handler, so cleanup can join them while later requests are refused.
  const handlers: Promise<unknown>[] = []
  const tracked = (handle: (route: Route) => Promise<unknown>) => (route: Route) => {
    const run = handle(route)
    handlers.push(run)
    return run
  }
  const gate: PropertyWriteGate = {
    heldContent: null,
    overlapping: [],
    pageSaves: 0,
    lastNoteSaveAt: Date.now(),
    release: () => decide('continue'),
    dispose: async () => {
      decide('abort')
      await Promise.allSettled(handlers)
    },
  }
  let holding = false
  await page.route('**/api/vault/save-page-content', tracked(async (route) => {
    const { notePath, content } = readSaveBody(route.request())
    if (!notePath.endsWith(NOTE_PATH_SUFFIX)) return forward(route)
    gate.lastNoteSaveAt = Date.now()
    gate.pageSaves += 1
    if (holding) gate.overlapping.push(content)
    return forward(route)
  }))
  await page.route('**/api/vault/save', tracked(async (route) => {
    const { notePath, content } = readSaveBody(route.request())
    if (!notePath.endsWith(NOTE_PATH_SUFFIX)) return forward(route)
    gate.lastNoteSaveAt = Date.now()
    if (gate.heldContent === null && content.includes(NEW_STATUS)) {
      gate.heldContent = content
      holding = true
      const decided = await decision
      holding = false
      gate.lastNoteSaveAt = Date.now()
      // A write still held at cleanup is aborted, so it never reaches a removed vault.
      if (decided === 'abort') return route.abort().catch(() => undefined)
      return forward(route).catch(() => undefined)
    }
    if (holding) gate.overlapping.push(content)
    return forward(route)
  }))
  activeGate = gate
  return gate
}

async function openNoteB(page: Page): Promise<string> {
  await openFixtureVaultTauri(page, vault)
  await page.getByTestId('note-list-container').getByText('Note B', { exact: true }).first().click()
  await expect(page.locator('.bn-editor')).toContainText(ORIGINAL_SENTENCE, { timeout: 5_000 })
  return path.join(vault, NOTE_FILE)
}

async function openStatusBadge(page: Page): Promise<Locator> {
  const statusRow = page.getByTestId('editable-property').filter({ hasText: 'Status' })
  // Shown only while the Inspector is collapsed.
  const opener = page.getByTestId('breadcrumb-properties-button')
  if (!(await statusRow.isVisible()) && (await opener.count()) > 0) await opener.first().click()
  const badge = statusRow.getByTestId('status-badge')
  await expect(badge).toHaveText('Active', { timeout: 5_000 })
  return badge
}

async function chooseNewStatus(page: Page, badge: Locator): Promise<void> {
  await badge.click()
  const search = page.getByTestId('status-search-input')
  await search.fill(NEW_STATUS)
  await search.press('Enter')
}

async function heldPropertyWrite(gate: PropertyWriteGate): Promise<string> {
  await expect.poll(() => gate.heldContent, {
    message: 'the property command never reached its disk write',
    timeout: 10_000,
  }).not.toBeNull()
  return gate.heldContent ?? ''
}

async function waitForSavesToSettle(gate: PropertyWriteGate): Promise<void> {
  await expect.poll(() => Date.now() - gate.lastNoteSaveAt, {
    message: 'saves of the page never settled',
    timeout: 20_000,
  }).toBeGreaterThanOrEqual(SETTLED_AFTER_MS)
}

function pageState(text: string, newerText: string[]) {
  return {
    original: text.includes(ORIGINAL_SENTENCE),
    newerText: newerText.filter((part) => text.includes(part)),
    status: text.split(/\r?\n/)
      .filter((line) => /^status\s*:/i.test(line))
      .map((line) => line.replace(/"/g, '').replace(/^status\s*:\s*/i, 'Status: ').trim()),
  }
}

function expectedState(newerText: string[]) {
  return { original: true, newerText, status: [`Status: ${NEW_STATUS}`] }
}

test('a property change that read the old page keeps rich text saved while it was pending', async ({ page }) => {
  test.setTimeout(60_000)
  const notePath = await openNoteB(page)
  const badge = await openStatusBadge(page)
  const gate = await holdPropertyWrite(page)
  await chooseNewStatus(page, badge)
  expect(await heldPropertyWrite(gate)).toContain(ORIGINAL_SENTENCE)

  const trailingBlock = page.locator('.bn-editor .bn-block-content').last()
  await expect(trailingBlock).toHaveText('')
  await trailingBlock.click()
  await page.keyboard.type(RICH_TEXT)
  await page.waitForTimeout(AUTOSAVE_WINDOW_MS)
  await triggerMenuCommand(page, APP_COMMAND_IDS.fileSave)
  await page.waitForTimeout(500)
  gate.release()

  await waitForSavesToSettle(gate)
  expect(pageState(fs.readFileSync(notePath, 'utf8'), [RICH_TEXT])).toEqual(expectedState([RICH_TEXT]))
  await expect(page.locator('.bn-editor')).toContainText(RICH_TEXT)
  await expect(page.locator('.bn-editor')).toContainText(ORIGINAL_SENTENCE)
  await expect(badge).toHaveText(NEW_STATUS)
  expect(gate.overlapping, 'saves written while the property write was in progress').toEqual([])
  expect(gate.pageSaves, 'the newer text never reached the page save route, so overlap there went unseen').toBeGreaterThan(0)
})

test('a property change that read the old page keeps raw Markdown, saved and still unsaved', async ({ page }) => {
  test.setTimeout(60_000)
  const notePath = await openNoteB(page)
  const badge = await openStatusBadge(page)
  await triggerShortcutCommand(page, APP_COMMAND_IDS.editToggleRawEditor)
  const rawContent = page.getByTestId('raw-editor-codemirror').locator('.cm-content')
  await expect(rawContent).toContainText(ORIGINAL_SENTENCE, { timeout: 5_000 })
  const gate = await holdPropertyWrite(page)
  await chooseNewStatus(page, badge)
  expect(await heldPropertyWrite(gate)).toContain(ORIGINAL_SENTENCE)

  await rawContent.click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type(RAW_TEXT)
  await triggerMenuCommand(page, APP_COMMAND_IDS.fileSave)
  await page.waitForTimeout(1_000)
  // Released inside the raw editor's 500 ms debounce, so the tail is still only in the editor.
  await page.keyboard.type(` ${RAW_TAIL}`)
  gate.release()

  const newerText = [RAW_TEXT, RAW_TAIL]
  await waitForSavesToSettle(gate)
  expect(pageState(fs.readFileSync(notePath, 'utf8'), newerText)).toEqual(expectedState(newerText))
  await expect.poll(async () => pageState(await rawContent.innerText(), newerText)).toEqual(expectedState(newerText))
  await expect(badge).toHaveText(NEW_STATUS)
  expect(gate.overlapping, 'saves written while the property write was in progress').toEqual([])
  expect(gate.pageSaves, 'the newer text never reached the page save route, so overlap there went unseen').toBeGreaterThan(0)
})
