import fs from 'node:fs'
import path from 'node:path'
import { expect, type Locator, type Page, type Request, type Route, test } from '@playwright/test'
import { APP_COMMAND_IDS } from '../../src/hooks/appCommandCatalog'
import type { FolderNode } from '../../src/types'
import { createFixtureVaultCopy, openFixtureVaultDesktopHarness, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { executeCommand, openCommandPalette } from './helpers'
import { blockStore, corruptPayload, keptVersions, seedVersion, unblockStore } from './pageHistoryStore'
import { triggerMenuCommand } from './testBridge'

// Earlier versions, on real disposable files through the dev vault's history routes.
// Every answer is the real disk answer; a held or lost reply is injected and says so.

const LANTERN = 'harbor/lantern.md'
const TIDE = 'drafts/tide-table.md'
const LEDGER = 'harbor/harbor-ledger.md'
const PAGES: Record<string, string> = {
  [LANTERN]: '# Lantern\n\nThe harbor lantern faces the breakwater.\n',
  [TIDE]: '# Tide table\n\nLow water at the north jetty.\n',
}
const LINE = {
  [LANTERN]: 'The harbor lantern faces the breakwater.',
  [TIDE]: 'Low water at the north jetty.',
}
const FOLDERS: FolderNode[] = ['drafts', 'harbor'].map(name => ({ name, path: name, children: [] }))
const SAVE_STATUS_LINE = 'This is only about earlier versions. Check the page’s save status for your latest changes.'

let vault: string
const abs = (relative: string) => path.join(vault, relative)
const read = (relative: string) => fs.readFileSync(abs(relative), 'utf8')
const bytesOf = (relative: string) => fs.readFileSync(abs(relative))
const exists = (relative: string) => fs.existsSync(abs(relative))
const pagesIn = (dir: string) => (exists(dir) ? fs.readdirSync(abs(dir)).filter(name => name.endsWith('.md')).sort() : [])

// --- What the page sent to the dev vault, and what came back ---------------------------------

const COMMANDS = ['save-page-content', 'list-page-versions', 'list-saved-locations', 'read-page-version', 'save-page-version-as-copy', 'page-history-health'] as const
type Command = typeof COMMANDS[number]
interface Body { path?: string; id?: string; folder?: string | null; operationId?: string; content?: string; request?: { path?: string } }
type Reply = Record<string, unknown>
interface Call { command: Command; body: Body; reply?: Reply | null; failed?: boolean }

let calls: Call[] = []
// Vault requests still on their way; cleanup waits for each answer before the files go.
let inflight = new Set<Request>()
// Admitted route handlers, and the way to release a request a test still holds.
let handlers: Promise<unknown>[] = []
let aborts: Array<() => void> = []
// Any request for the synthetic outside host; a passive preview must make none.
let external: string[] = []

const isVaultRequest = (request: Request) => new URL(request.url()).pathname.startsWith('/api/vault/')
function bodyOf(request: Request): Body {
  try {
    return (request.postDataJSON() ?? {}) as Body
  } catch {
    return {}
  }
}
const onPage = (relative: string) => (call: Call) => (call.body.request?.path ?? call.body.path) === abs(relative)
const carries = (text: string) => (call: Call) => !!call.body.content?.includes(text)
const field = (reply: Reply | null | undefined, name: string) => (reply?.[name] ?? null) as Reply | null

function watch(page: Page) {
  const byRequest = new Map<Request, Call>()
  page.on('request', request => {
    if (new URL(request.url()).hostname === 'example.invalid') external.push(request.url())
    if (!isVaultRequest(request)) return
    inflight.add(request)
    const command = new URL(request.url()).pathname.replace('/api/vault/', '') as Command
    if (request.method() !== 'POST' || !COMMANDS.includes(command)) return
    const call: Call = { command, body: bodyOf(request) }
    calls.push(call)
    byRequest.set(request, call)
  })
  page.on('requestfinished', async request => {
    const call = byRequest.get(request)
    if (call) call.reply = await request.response().then(response => response?.json()).catch(() => null) as Reply | null
    inflight.delete(request)
  })
  page.on('requestfailed', request => {
    const call = byRequest.get(request)
    if (call) call.failed = true
    inflight.delete(request)
  })
}

/** The first call of this command, from `from` on, that matches and has been answered or failed. */
async function answered(command: Command, match: (call: Call) => boolean = () => true, from = 0): Promise<Call> {
  let found: Call | undefined
  await expect.poll(() => {
    found = calls.slice(from).find(call => call.command === command && (call.reply !== undefined || call.failed) && match(call))
    return !!found
  }, { message: `no answered ${command}` }).toBe(true)
  return found as Call
}
const callsOf = (command: Command) => calls.filter(call => call.command === command)

// --- Routes a test controls; each handler is joined at cleanup ---------------------------------

const tracked = (handle: (route: Route) => Promise<unknown>) => (route: Route) => {
  const run = handle(route)
  handlers.push(run)
  return run
}

async function forward(route: Route): Promise<void> {
  await route.continue()
  await route.request().response().catch(() => null)
}

/** Holds the first matching request until `release`; `early` asks the dev vault now and delivers the answer late. */
async function holdNext(page: Page, command: Command, match: (body: Body) => boolean, early = false) {
  let decide: (choice: 'continue' | 'abort') => void = () => {}
  const choice = new Promise<'continue' | 'abort'>(resolve => { decide = resolve })
  const gate = { fired: 0, early: null as Reply | null, release: () => decide('continue') }
  aborts.push(() => decide('abort'))
  await page.route(`**/api/vault/${command}`, tracked(async route => {
    if (gate.fired > 0 || !match(bodyOf(route.request()))) return forward(route)
    gate.fired += 1
    const response = early ? await route.fetch() : null
    if (response) gate.early = await response.json() as Reply
    if ((await choice) === 'abort') return route.abort().catch(() => undefined)
    return response ? route.fulfill({ response }) : forward(route)
  }))
  return gate
}

/** Injected: the real copy of this version runs on disk, then its reply is dropped before the page sees it. */
async function loseNextCopyReply(page: Page, versionId: string) {
  const gate = { fired: 0, operationId: '' }
  await page.route('**/api/vault/save-page-version-as-copy', tracked(async route => {
    const body = bodyOf(route.request())
    if (gate.fired > 0 || body.id !== versionId) return forward(route)
    gate.fired += 1
    gate.operationId = body.operationId ?? ''
    await route.fetch()
    return route.abort()
  }))
  return gate
}

// --- The app, through its public controls ------------------------------------------------------

const pane = (page: Page, n: 1 | 2) => page.getByRole('region', { name: `Page pane ${n}`, exact: true })
// A modal dialog hides the panes from role queries, so behind it find a pane by its label.
const paneSection = (page: Page, n: 1 | 2) => page.locator(`section[aria-label="Page pane ${n}"]`)
const saveState = (owner: Locator) => owner.getByRole('status').filter({ hasText: /^(Saved|Unsaved)$/ })
const finder = (page: Page) => page.getByRole('dialog', { name: 'Find a page' })
const save = (page: Page) => triggerMenuCommand(page, APP_COMMAND_IDS.fileSave)
const moreActions = (owner: Locator) => owner.getByRole('button', { name: 'More note actions', exact: true })

const dialog = (page: Page) => page.getByTestId('page-history-dialog')
const versionRow = (page: Page, id: string) => dialog(page).locator(`[data-testid="page-history-version"][data-version-id="${id}"]`)
const locationRow = (page: Page, relative: string) => dialog(page).getByTestId('page-history-location')
  .filter({ has: page.locator('.ll-history-row-title', { hasText: new RegExp(`^${relative.replace(/[.]/g, '\\.')}$`) }) })
const copyResult = (page: Page) => dialog(page).getByTestId('page-history-copy-result')
const sourceText = (page: Page) => dialog(page).getByTestId('page-history-preview-source').evaluate(element => element.textContent ?? '')
const nextFrame = (page: Page) => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(null))))

const focusedPagePath = (page: Page) => page.evaluate(() => {
  const active = document.activeElement
  if (!active?.closest('[contenteditable="true"]')) return null
  return active.closest('section[data-note-path]')?.getAttribute('data-note-path') ?? null
})

async function openVault(page: Page) {
  await openFixtureVaultDesktopHarness(page, vault, { isGitRepo: false, folders: FOLDERS })
}

/** Opens a page by its title through the finder, into the active pane. */
async function openByTitle(page: Page, title: string, relative: string, n: 1 | 2) {
  await page.getByTestId('sidebar-top-nav').getByRole('button', { name: 'Search', exact: true }).click()
  await finder(page).getByRole('combobox').fill(title)
  await finder(page).getByRole('group', { name: 'Pages', exact: true }).getByRole('option')
    .filter({ hasText: new RegExp(`^${title}`) }).first().click()
  await expect(finder(page)).toBeHidden()
  await expect(pane(page, n)).toHaveAttribute('data-note-path', abs(relative))
}

async function splitWith(page: Page, title: string, relative: string) {
  await page.getByRole('button', { name: 'Split right', exact: true }).click()
  await pane(page, 2).getByText('Open a page here').click()
  await openByTitle(page, title, relative, 2)
}

/** Real typing at the end of one line of the rich page. */
async function typeRich(page: Page, owner: Locator, relative: string, line: string, text: string) {
  await owner.locator('.bn-editor').getByText(line).click()
  await expect.poll(() => focusedPagePath(page)).toBe(abs(relative))
  await page.keyboard.press('End')
  await page.keyboard.type(text)
}

/** Earlier versions from this pane's own `More note actions` menu. */
async function openFromMenu(page: Page, n: 1 | 2) {
  await moreActions(pane(page, n)).click()
  await page.getByTestId('page-history-menu-item').click()
  await expect(dialog(page)).toBeVisible()
}

/** Chooses a version and waits for its verified preview. */
async function choose(page: Page, id: string) {
  await versionRow(page, id).click()
  await expect(versionRow(page, id)).toHaveAttribute('aria-current', 'true')
  await expect(dialog(page).getByTestId('page-history-preview')).toBeVisible()
}

test.use({ viewport: { width: 1600, height: 1000 } })
test.describe.configure({ retries: 0, timeout: 60_000 })

test.beforeEach(async ({ page }) => {
  vault = createFixtureVaultCopy()
  for (const [relative, content] of Object.entries(PAGES)) {
    fs.mkdirSync(path.dirname(abs(relative)), { recursive: true })
    fs.writeFileSync(abs(relative), content)
  }
  calls = []
  inflight = new Set()
  handlers = []
  aborts = []
  external = []
  // Nothing in a preview may reach out; should anything try, it is refused here and recorded.
  await page.route(url => url.hostname === 'example.invalid', route => route.abort())
  watch(page)
})

// No new vault work is admitted, held requests are released as aborts, every admitted one is
// answered, the page closes, then the vault goes.
test.afterEach(async ({ page }) => {
  try {
    if (!page.isClosed()) await page.route('**/api/vault/**', route => route.abort().catch(() => undefined))
    for (const abort of aborts.splice(0)) abort()
    await Promise.allSettled(handlers.splice(0))
    await Promise.allSettled([...inflight].map(request => request.response()))
    await page.close({ runBeforeUnload: false })
  } finally {
    removeFixtureVaultCopy(vault)
  }
})

test('a saved change keeps the earlier text, which is previewed, copied byte for byte and opened only when asked, in the asking pane', async ({ page }) => {
  const tideWords = ' Tide words kept.'
  const words = ' Lit at dusk.'
  const copyPage = 'harbor/lantern-2.md'
  await openVault(page)
  await openByTitle(page, 'Lantern', LANTERN, 1)
  await splitWith(page, 'Tide table', TIDE)

  await typeRich(page, pane(page, 2), TIDE, LINE[TIDE], tideWords)
  await save(page)
  const tideSave = await answered('save-page-content', call => onPage(TIDE)(call) && carries(tideWords)(call) && call.reply?.status === 'committed')
  await typeRich(page, pane(page, 1), LANTERN, LINE[LANTERN], words)
  await save(page)
  const saved = await answered('save-page-content', call => onPage(LANTERN)(call) && carries(words)(call) && call.reply?.status === 'committed')
  expect(saved.reply?.history, 'keeping the earlier text is quiet').toBeNull()
  await expect.poll(() => read(LANTERN)).toBe(saved.body.content)
  await expect(saveState(pane(page, 1))).toHaveText('Saved')
  expect(keptVersions(vault, LANTERN), 'the text before the first save was kept').toHaveLength(1)

  await openFromMenu(page, 1)
  await expect(dialog(page)).toContainText('“Lantern”')
  const listed = await answered('list-page-versions', onPage(LANTERN))
  const rows = (listed.reply?.versions ?? []) as Array<{ id: string; recordedPath: string; reason: string }>
  expect(rows.map(row => [row.recordedPath, row.reason])).toEqual([[LANTERN, 'firstSave']])
  await expect(versionRow(page, rows[0].id)).toContainText('First save')

  await choose(page, rows[0].id)
  const formatted = dialog(page).getByTestId('page-history-preview-formatted')
  await expect(formatted).toContainText(LINE[LANTERN])
  await expect(formatted).not.toContainText(words.trim())
  await dialog(page).getByTestId('page-history-view-source').click()
  await expect(dialog(page).getByTestId('page-history-view-source')).toHaveAttribute('aria-pressed', 'true')
  expect(await sourceText(page), 'Source shows the exact earlier text').toBe(PAGES[LANTERN])
  await dialog(page).getByTestId('page-history-view-formatted').click()
  await expect(formatted).toBeVisible()

  await dialog(page).getByTestId('page-history-save-copy').click()
  const copy = await answered('save-page-version-as-copy')
  expect(copy.body).toMatchObject({ id: rows[0].id, folder: null })
  expect(copy.reply).toMatchObject({ status: 'created', relativePath: copyPage })
  await expect(copyResult(page)).toHaveAttribute('data-outcome', 'created')
  await expect(copyResult(page)).toContainText(`Saved as a new page: ${copyPage}.`)
  expect(bytesOf(copyPage).equals(Buffer.from(PAGES[LANTERN], 'utf8')), 'the copy holds the earlier bytes exactly').toBe(true)
  expect(read(LANTERN), 'the original is not changed').toBe(saved.body.content)
  // Creation never swaps the page: the asking pane still shows the original until the person opens the copy.
  await expect(paneSection(page, 1)).toHaveAttribute('data-note-path', abs(LANTERN))
  await expect(dialog(page)).toBeVisible()

  await dialog(page).getByTestId('page-history-open-copy').click()
  await expect(dialog(page)).toBeHidden()
  await expect(pane(page, 1)).toHaveAttribute('data-note-path', abs(copyPage))
  await expect(pane(page, 1).getByText(LINE[LANTERN])).toBeVisible()
  await expect.poll(() => focusedPagePath(page), { message: 'the copy takes focus in the asking pane' }).toBe(abs(copyPage))
  await expect(pane(page, 2)).toHaveAttribute('data-note-path', abs(TIDE))
  await expect(pane(page, 2).getByText(tideWords.trim())).toBeVisible()
  expect([read(LANTERN), read(TIDE)]).toEqual([saved.body.content, tideSave.body.content])
})

test('each pane and the palette open their own page, focus returns to the trigger, and a narrow window keeps every action reachable', async ({ page }, testInfo) => {
  const earlier = seedVersion(vault, LANTERN, '# Lantern\n\nAn earlier lantern note.\n', 5)
  await openVault(page)
  await openByTitle(page, 'Lantern', LANTERN, 1)
  await splitWith(page, 'Tide table', TIDE)

  await openFromMenu(page, 2)
  await expect(dialog(page)).toContainText('“Tide table”')
  await answered('list-page-versions', onPage(TIDE))
  await expect(dialog(page).getByTestId('page-history-empty')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeHidden()
  await expect(moreActions(pane(page, 2)), 'Escape returns to the menu that opened it').toBeFocused()

  await openFromMenu(page, 1)
  await expect(dialog(page)).toContainText('“Lantern”')
  await answered('list-page-versions', onPage(LANTERN))
  await expect(versionRow(page, earlier.id)).toBeVisible()
  await dialog(page).getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog(page)).toBeHidden()
  await expect(moreActions(pane(page, 1)), 'Close returns to the menu that opened it').toBeFocused()

  // The palette follows the active pane, which is the one last worked in.
  await pane(page, 2).locator('.bn-editor').getByText(LINE[TIDE]).click()
  const beforePalette = calls.length
  await openCommandPalette(page)
  await executeCommand(page, 'Earlier versions')
  await expect(dialog(page)).toContainText('“Tide table”')
  const fromPalette = await answered('list-page-versions', () => true, beforePalette)
  expect(onPage(TIDE)(fromPalette), 'the palette asked for the active pane’s page').toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeHidden()

  await openFromMenu(page, 1)
  await choose(page, earlier.id)
  const width = 560
  await page.setViewportSize({ width, height: 720 })
  const controls = [
    dialog(page).getByRole('button', { name: 'Close', exact: true }),
    versionRow(page, earlier.id),
    dialog(page).getByTestId('page-history-view-source'),
    dialog(page).getByTestId('page-history-save-copy'),
  ]
  for (const control of controls) {
    await control.scrollIntoViewIfNeeded()
    await expect(control).toBeInViewport({ ratio: 1 })
  }
  const preview = dialog(page).getByTestId('page-history-preview')
  await preview.scrollIntoViewIfNeeded()
  const box = await preview.boundingBox()
  expect(box && box.x >= 0 && box.x + box.width <= width, 'the preview is not cut at the sides').toBe(true)
  expect(await dialog(page).evaluate(element => element.scrollWidth <= element.clientWidth), 'nothing scrolls sideways').toBe(true)
  await testInfo.attach('earlier-versions-narrow', { body: await page.screenshot(), contentType: 'image/png' })
})

test('a preview is passive and exact: no request, link, image, markup or editor; truncation is said and the copy keeps every byte', async ({ page }) => {
  const filler = Array.from({ length: 8000 }, (_, i) => `Tide log line ${String(i).padStart(5, '0')}, calm water.\r\n`).join('')
  const text = [
    '﻿---\r\ntitle: Passive sample\r\n---\r\n',
    '# Passive sample\r\n\r\n',
    'A [harbor link](https://example.invalid/track) and ![Lighthouse](https://example.invalid/pixel.png).\r\n\r\n',
    '<img src="https://example.invalid/raw.png" onerror="window.__llRan = 1">\r\n\r\n',
    '<script>window.__llRan = 2</script>\r\n\r\n',
    '<a href="https://example.invalid/anchor">raw anchor</a>\r\n\r\n',
    filler,
    'TAIL MARKER beyond the preview.\r\n',
  ].join('')
  const sample = seedVersion(vault, LANTERN, text, 3)
  expect(sample.bytes.length, 'the fixture is past the 256 KiB preview cap').toBeGreaterThan(256 * 1024)
  await openVault(page)
  await openByTitle(page, 'Lantern', LANTERN, 1)
  await openFromMenu(page, 1)
  await choose(page, sample.id)

  const shown = (await answered('read-page-version', call => call.body.id === sample.id)).reply ?? {}
  expect(shown).toMatchObject({ status: 'ok', length: sample.bytes.length, truncated: true, bom: true, crlf: true })
  const shownBytes = shown.shownBytes as number
  expect(shownBytes).toBeLessThanOrEqual(256 * 1024)
  const notes = dialog(page).getByTestId('page-history-preview-notes')
  await expect(notes).toContainText('A copy keeps all of it.')
  await expect(notes).toContainText('Starts with a byte order mark.')
  await expect(notes).toContainText('Uses Windows line endings (CRLF).')

  const preview = dialog(page).getByTestId('page-history-preview')
  const active = 'a, img, script, iframe, object, embed, input, textarea, [href], [src], [onerror], [contenteditable]'
  const formatted = dialog(page).getByTestId('page-history-preview-formatted')
  await expect(formatted).toContainText('harbor link')
  await expect(formatted).toContainText('Image: Lighthouse')
  await expect(preview.locator(active)).toHaveCount(0)

  await dialog(page).getByTestId('page-history-view-source').click()
  const source = await sourceText(page)
  expect(source, 'Source is the exact decoded text up to the cut, BOM and CRLF included').toBe(sample.bytes.subarray(0, shownBytes).toString('utf8'))
  expect(source.startsWith('﻿---\r\n')).toBe(true)
  expect(source).not.toContain('TAIL MARKER')
  await expect(preview.locator(active)).toHaveCount(0)

  await dialog(page).getByTestId('page-history-save-copy').click()
  const copy = await answered('save-page-version-as-copy')
  expect(copy.reply).toMatchObject({ status: 'created', relativePath: 'harbor/lantern-2.md' })
  expect(bytesOf('harbor/lantern-2.md').equals(sample.bytes), 'the copy is the whole version, past the cap').toBe(true)
  expect(read(LANTERN)).toBe(PAGES[LANTERN])
  expect(await page.evaluate(() => Reflect.get(window, '__llRan') ?? null), 'no markup in the version ran').toBeNull()
  expect(external, 'the preview asked nothing of any outside address').toEqual([])
})

test('a gone folder asks where to copy, with a link warning and no fallback; saved locations find moved and deleted pages without claiming identity', async ({ page }) => {
  const oldPath = 'archive/harbor-ledger.md'
  const goneText = '# Harbor ledger\n\nThe ledger entry from the old archive.\n'
  fs.writeFileSync(abs(LEDGER), '# Harbor ledger\n\nThe ledger now lives in the harbor.\n')
  const moved = seedVersion(vault, oldPath, goneText, 20)
  seedVersion(vault, 'drafts/buoy.md', '# Buoy\n\nThe red buoy marks the shoal.\n', 10)
  seedVersion(vault, LANTERN, '# Lantern\n\nAn earlier lantern note.\n', 5)
  const rootPages = fs.readdirSync(vault).filter(name => name.endsWith('.md')).sort()
  await openVault(page)
  await openByTitle(page, 'Harbor ledger', LEDGER, 1)
  await openFromMenu(page, 1)
  await expect(dialog(page)).toContainText('“Harbor ledger”')

  // Versions stay under the name they were saved with; the moved page is not linked to them.
  await answered('list-page-versions', onPage(LEDGER))
  await expect(dialog(page).getByTestId('page-history-empty')).toBeVisible()
  await expect(dialog(page)).toContainText('After a rename or move, earlier versions stay under the name they were saved with.')

  await dialog(page).getByTestId('page-history-tab-locations').click()
  const listed = await answered('list-saved-locations')
  const locations = (listed.reply?.locations ?? []) as Array<{ path: string; exists: boolean }>
  expect(locations.map(row => [row.path, row.exists]))
    .toEqual([[LANTERN, true], ['drafts/buoy.md', false], [oldPath, false]])
  await expect(locationRow(page, oldPath)).toContainText('1 kept')
  await expect(locationRow(page, oldPath)).toContainText('no page there now')
  await expect(locationRow(page, 'drafts/buoy.md')).toContainText('no page there now')
  await expect(locationRow(page, LANTERN)).not.toContainText('no page there now')
  await expect(locationRow(page, LEDGER)).toHaveCount(0)

  await locationRow(page, oldPath).click()
  await expect(dialog(page)).toContainText(`Versions saved as ${oldPath}`)
  await answered('list-page-versions', onPage(oldPath))
  await choose(page, moved.id)
  await expect(dialog(page).getByTestId('page-history-preview-formatted')).toContainText('The ledger entry from the old archive.')

  await dialog(page).getByTestId('page-history-save-copy').click()
  const refused = await answered('save-page-version-as-copy')
  expect(refused.body.folder).toBeNull()
  // Named in the vault's own spelling, so the message shows the short folder even under a linked temp root.
  expect(refused.reply).toEqual({ status: 'folderUnavailable', recordedFolder: abs('archive') })
  await expect(copyResult(page)).toHaveAttribute('data-outcome', 'folderUnavailable')
  await expect(copyResult(page)).toContainText('The folder this version was saved in (archive) is gone. Choose a folder for the copy.')
  await expect(copyResult(page)).not.toContainText(path.dirname(vault))
  await expect(copyResult(page)).toContainText('links to other pages may not work')
  expect([exists('archive'), pagesIn('drafts'), pagesIn('harbor')], 'nothing was made anywhere')
    .toEqual([false, ['tide-table.md'], ['harbor-ledger.md', 'lantern.md']])
  expect(fs.readdirSync(vault).filter(name => name.endsWith('.md')).sort(), 'no fallback to the workspace root').toEqual(rootPages)

  await dialog(page).getByTestId('page-history-choose-folder').click()
  const picker = page.getByRole('dialog', { name: 'Save the copy in…' })
  await expect(picker).toBeVisible()
  await picker.getByTestId(/^page-history-folder-option:/).filter({ hasText: 'drafts' }).click()
  const created = await answered('save-page-version-as-copy', call => call.body.folder !== null)
  expect(created.body.folder).toBe(abs('drafts'))
  expect(created.body.operationId, 'a new choice is a new copy').not.toBe(refused.body.operationId)
  const relativePath = String(created.reply?.relativePath)
  expect(created.reply?.status).toBe('created')
  expect(relativePath).toMatch(/^drafts\/harbor-ledger-\d+\.md$/)
  await expect(copyResult(page)).toHaveAttribute('data-outcome', 'created')
  await expect(copyResult(page)).toContainText('different folder from the original')
  expect(read(relativePath)).toBe(goneText)
  expect([exists('archive'), read(LEDGER)]).toEqual([false, '# Harbor ledger\n\nThe ledger now lives in the harbor.\n'])
  expect(fs.readdirSync(vault).filter(name => name.endsWith('.md')).sort()).toEqual(rootPages)
})

test('a damaged or vanished version is refused for preview and copy, and nothing on disk is changed', async ({ page }) => {
  const damaged = seedVersion(vault, LANTERN, '# Lantern\n\nThe keeper wrote this on Monday.\n', 9)
  const vanished = seedVersion(vault, LANTERN, '# Lantern\n\nA version that will be pruned.\n', 8)
  const tampered = corruptPayload(damaged, 'Monday', 'Tamper')
  await openVault(page)
  await openByTitle(page, 'Lantern', LANTERN, 1)
  await openFromMenu(page, 1)
  await expect(versionRow(page, damaged.id)).toBeVisible()
  await expect(versionRow(page, vanished.id)).toBeVisible()
  fs.rmSync(vanished.dir, { recursive: true })

  const unavailable = dialog(page).getByTestId('page-history-preview-unavailable')
  await versionRow(page, damaged.id).click()
  expect((await answered('read-page-version', call => call.body.id === damaged.id)).reply).toEqual({ status: 'damaged' })
  await expect(unavailable).toHaveText('This version is damaged, so it isn’t shown or copied.')
  await versionRow(page, vanished.id).click()
  expect((await answered('read-page-version', call => call.body.id === vanished.id)).reply).toEqual({ status: 'missing' })
  await expect(unavailable).toHaveText('This version is no longer kept.')

  await expect(dialog(page).getByTestId('page-history-preview')).toHaveCount(0)
  await expect(dialog(page).getByTestId('page-history-save-copy')).toHaveCount(0)
  await expect(dialog(page)).not.toContainText('Tamper')
  expect(callsOf('save-page-version-as-copy')).toEqual([])
  expect(fs.readFileSync(damaged.payload).equals(tampered), 'the damaged bytes are left as found').toBe(true)
  expect([read(LANTERN), pagesIn('harbor')]).toEqual([PAGES[LANTERN], ['lantern.md']])
})

test('a lost copy reply is checked with the same operation, making one copy; a version damaged before the check is refused and the copy stays', async ({ page }) => {
  const first = seedVersion(vault, LANTERN, '# Lantern\n\nThe first kept lantern text.\n', 6)
  const second = seedVersion(vault, LANTERN, '# Lantern\n\nThe second kept lantern text, about Tuesday.\n', 4)
  await openVault(page)
  await openByTitle(page, 'Lantern', LANTERN, 1)
  await openFromMenu(page, 1)
  const formatted = dialog(page).getByTestId('page-history-preview-formatted')

  // A slow answer for an earlier choice never lands on a later one.
  const slow = await holdNext(page, 'read-page-version', body => body.id === first.id)
  await versionRow(page, first.id).click()
  await choose(page, second.id)
  await expect(formatted).toContainText('The second kept lantern text')
  slow.release()
  await answered('read-page-version', call => call.body.id === first.id)
  await nextFrame(page)
  await expect(formatted).toContainText('The second kept lantern text')
  await expect(versionRow(page, first.id)).not.toHaveAttribute('aria-current', 'true')

  await choose(page, first.id)
  const lostFirst = await loseNextCopyReply(page, first.id)
  await dialog(page).getByTestId('page-history-save-copy').click()
  await expect(copyResult(page)).toHaveAttribute('data-outcome', 'noReply')
  expect(lostFirst.fired).toBe(1)
  expect(bytesOf('harbor/lantern-2.md').equals(first.bytes), 'the lost reply hid a real copy').toBe(true)
  const beforeCheck = calls.length
  await dialog(page).getByTestId('page-history-copy-retry').click()
  const checked = await answered('save-page-version-as-copy', () => true, beforeCheck)
  expect(checked.body.operationId, 'Check again repeats the same operation').toBe(lostFirst.operationId)
  expect(checked.reply).toMatchObject({ status: 'created', relativePath: 'harbor/lantern-2.md' })
  await expect(copyResult(page)).toHaveAttribute('data-outcome', 'created')
  expect(pagesIn('harbor'), 'exactly one copy').toEqual(['lantern-2.md', 'lantern.md'])

  await choose(page, second.id)
  const lostSecond = await loseNextCopyReply(page, second.id)
  await dialog(page).getByTestId('page-history-save-copy').click()
  await expect(copyResult(page)).toHaveAttribute('data-outcome', 'noReply')
  expect(bytesOf('harbor/lantern-3.md').equals(second.bytes)).toBe(true)
  corruptPayload(second, 'Tuesday', 'Fridays')
  const beforeDamagedCheck = calls.length
  await dialog(page).getByTestId('page-history-copy-retry').click()
  const damaged = await answered('save-page-version-as-copy', () => true, beforeDamagedCheck)
  expect(damaged.body.operationId).toBe(lostSecond.operationId)
  expect(damaged.reply).toEqual({ status: 'refused', reason: 'damaged' })
  await expect(copyResult(page)).toHaveAttribute('data-outcome', 'refused')
  await expect(copyResult(page)).toContainText('This version is damaged')
  expect(pagesIn('harbor'), 'the earlier copy stays and no second one is made').toEqual(['lantern-2.md', 'lantern-3.md', 'lantern.md'])
  expect([bytesOf('harbor/lantern-2.md').equals(first.bytes), bytesOf('harbor/lantern-3.md').equals(second.bytes)]).toEqual([true, true])
  expect(read(LANTERN)).toBe(PAGES[LANTERN])
})

test('a save settles as Saved when versions cannot be kept; the quiet warning outlasts a null note and only a newer healthy answer clears it', async ({ page }) => {
  blockStore(vault)
  await openVault(page)
  await openByTitle(page, 'Lantern', LANTERN, 1)
  const owner = pane(page, 1)
  const chip = owner.getByTestId('page-history-warning')

  await typeRich(page, owner, LANTERN, LINE[LANTERN], ' Paused words.')
  await save(page)
  const paused = await answered('save-page-content', call => onPage(LANTERN)(call) && carries('Paused words.')(call) && call.reply?.status === 'committed')
  expect(paused.reply).toMatchObject({ status: 'committed', written: true, history: { status: 'notKept', reason: 'unavailable' } })
  await expect.poll(() => read(LANTERN)).toBe(paused.body.content)
  await expect(saveState(owner), 'the page save status is its own').toHaveText('Saved')
  await expect(chip).toHaveText('Versions paused')

  await chip.click()
  await expect(dialog(page)).toBeVisible()
  const health = dialog(page).getByTestId('page-history-health')
  await expect(health).toContainText(SAVE_STATUS_LINE)
  expect(field((await answered('list-page-versions', onPage(LANTERN))).reply, 'health')).toMatchObject({ state: 'notKeeping', reason: 'unavailable' })
  // This check is asked now, while still paused, and its answer is delivered after a newer one.
  const stale = await holdNext(page, 'page-history-health', () => true, true)
  await dialog(page).getByTestId('page-history-health-check').click()
  await expect.poll(() => stale.early?.state).toBe('notKeeping')
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeHidden()
  await expect(chip, 'Escape returns to the warning that opened it').toBeFocused()

  unblockStore(vault)
  await typeRich(page, owner, LANTERN, LINE[LANTERN], ' Kept words.')
  await save(page)
  const kept = await answered('save-page-content', call => onPage(LANTERN)(call) && carries('Kept words.')(call) && call.reply?.status === 'committed')
  expect(kept.reply?.history, 'a kept version says nothing').toBeNull()
  expect(keptVersions(vault, LANTERN)).toHaveLength(1)
  await expect(saveState(owner)).toHaveText('Saved')
  await expect(chip, 'a null note does not clear the warning').toBeVisible()

  const beforeHealthy = calls.length
  await chip.click()
  const healthy = await answered('list-page-versions', onPage(LANTERN), beforeHealthy)
  expect(field(healthy.reply, 'health')).toMatchObject({ state: 'on', reason: null })
  await expect(dialog(page).getByTestId('page-history-health')).toHaveCount(0)
  await expect(paneSection(page, 1).getByTestId('page-history-warning')).toHaveCount(0)

  stale.release()
  const late = await answered('page-history-health')
  expect(late.reply).toMatchObject({ state: 'notKeeping' })
  await nextFrame(page)
  await expect(dialog(page).getByTestId('page-history-health'), 'the older answer does not raise it again').toHaveCount(0)
  await expect(paneSection(page, 1).getByTestId('page-history-warning')).toHaveCount(0)
})
