import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect, type Locator, type Page, type Request, type Route } from '@playwright/test'
import { APP_COMMAND_IDS } from '../../src/hooks/appCommandCatalog'
import type { FolderNode } from '../../src/types'
import { createFixtureVaultCopy, openFixtureVaultDesktopHarness, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { triggerMenuCommand, triggerShortcutCommand } from './testBridge'

// Recovery of unsaved words, on real disposable files through the dev vault's S0 routes.
// Every outcome is the real disk answer, except the one lost reply, which is injected and says so.

const LANTERN = 'harbor/lantern.md'
const TIDE = 'drafts/tide-table.md'
const FERRY = 'drafts/ferry-schedule.md'
const PAGES: Record<string, string> = {
  [LANTERN]: '# Lantern\n\nThe harbor lantern faces the breakwater.\n',
  [TIDE]: '# Tide table\n\nLow water at the north jetty.\n',
  [FERRY]: '# Ferry schedule\n\nThe first ferry leaves at seven.\n',
}
const LINE = {
  [LANTERN]: 'The harbor lantern faces the breakwater.',
  [TIDE]: 'Low water at the north jetty.',
  [FERRY]: 'The first ferry leaves at seven.',
}
const FOLDERS: FolderNode[] = ['drafts', 'harbor'].map(name => ({ name, path: name, children: [] }))

let vault: string
const abs = (relative: string) => path.join(vault, relative)
const read = (relative: string) => fs.readFileSync(abs(relative), 'utf8')
const exists = (relative: string) => fs.existsSync(abs(relative))
const topPages = () => fs.readdirSync(vault).filter(name => name.endsWith('.md')).sort()
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

// --- What the page sent to the dev vault, and what came back ---------------------------------

const COMMANDS = ['save-page-content', 'check-save-outcome', 'save-draft-as-new-page', 'release-hold-with-copy', 'discard-hold', 'save'] as const
type Command = typeof COMMANDS[number]
interface Body {
  path?: string
  content?: string
  folder?: string | null
  operationId?: string
  actionId?: string
  request?: { path?: string, requestId?: string, seq?: number, submittedSha256?: string }
  draft?: { seq: number, content: string }
  confirmed?: { seq: number, contentSha256: string }
}
type Reply = Record<string, unknown>
interface Call { command: Command, path: string, body: Body, reply?: Reply | null, failed?: boolean }

let calls: Call[] = []
// Vault requests still on their way; cleanup waits for each answer before the files go.
let inflight = new Set<Request>()
// Admitted route handlers, and the way to abort a request a test still holds.
let handlers: Promise<unknown>[] = []
let aborts: Array<() => void> = []
let readOnlyFiles: string[] = []
let outsideDirs: string[] = []

const isVaultRequest = (request: Request) => new URL(request.url()).pathname.startsWith('/api/vault/')
function bodyOf(request: Request): Body {
  try {
    return (request.postDataJSON() ?? {}) as Body
  } catch {
    return {}
  }
}
const pathOf = (body: Body) => body.request?.path ?? body.path ?? ''
// The fixture's read handlers send GET with the arguments in the query; other reads POST a body.
function readArgs(request: Request): Record<string, unknown> {
  if (request.method() !== 'GET') return { ...bodyOf(request) }
  return Object.fromEntries(new URL(request.url()).searchParams)
}
const carries = (call: Call, text: string) => !!(call.body.content?.includes(text) || call.body.draft?.content.includes(text))

function watch(page: Page) {
  const byRequest = new Map<Request, Call>()
  page.on('request', request => {
    if (!isVaultRequest(request)) return
    inflight.add(request)
    const command = new URL(request.url()).pathname.replace('/api/vault/', '') as Command
    if (request.method() !== 'POST' || !COMMANDS.includes(command)) return
    const body = bodyOf(request)
    const call: Call = { command, path: pathOf(body), body }
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

const callsFor = (command: Command, relative: string) => calls.filter(call => call.command === command && call.path === abs(relative))

/** The first call of this command for the page, from `from` on, that matches and has been answered or failed. */
async function answered(command: Command, relative: string, options: { from?: number, match?: (call: Call) => boolean } = {}): Promise<Call> {
  const find = () => callsFor(command, relative).slice(options.from ?? 0)
    .find(call => (call.reply !== undefined || call.failed) && (options.match?.(call) ?? true))
  await expect.poll(() => !!find(), { message: `no answered ${command} for ${relative}` }).toBe(true)
  return find()!
}

// --- Routes a test controls; each handler is joined at cleanup ---------------------------------

const tracked = (handle: (route: Route) => Promise<unknown>) => (route: Route) => {
  const run = handle(route)
  handlers.push(run)
  return run
}

// Settles only once the request is answered, so cleanup can join it before the vault goes.
async function forward(route: Route): Promise<void> {
  await route.continue()
  await route.request().response().catch(() => null)
}

/** Holds the first such request for the page until `release`; cleanup aborts it if still held. */
async function holdNext(page: Page, command: Command, relative: string) {
  let decide: (choice: 'continue' | 'abort') => void = () => {}
  const choice = new Promise<'continue' | 'abort'>(resolve => { decide = resolve })
  const gate = { fired: 0, release: () => decide('continue') }
  aborts.push(() => decide('abort'))
  await page.route(`**/api/vault/${command}`, tracked(async route => {
    if (gate.fired > 0 || pathOf(bodyOf(route.request())) !== abs(relative)) return forward(route)
    gate.fired += 1
    if ((await choice) === 'abort') return route.abort().catch(() => undefined)
    return forward(route)
  }))
  return gate
}

/** Injected: the real save of `marker` runs on disk, then its reply is dropped before the page sees it. */
async function loseNextSaveReply(page: Page, relative: string, marker: string) {
  const gate: { fired: number, submitted: string, requestId: string, realReply: Reply | null } =
    { fired: 0, submitted: '', requestId: '', realReply: null }
  await page.route('**/api/vault/save-page-content', tracked(async route => {
    const body = bodyOf(route.request())
    if (gate.fired > 0 || pathOf(body) !== abs(relative) || !body.content?.includes(marker)) return forward(route)
    gate.fired += 1
    gate.submitted = body.content
    gate.requestId = body.request?.requestId ?? ''
    const response = await route.fetch()
    gate.realReply = await response.json() as Reply
    return route.abort()
  }))
  return gate
}

// --- The app, through its public controls ------------------------------------------------------

const pane = (page: Page, n: 1 | 2) => page.getByRole('region', { name: `Page pane ${n}`, exact: true })
// A modal dialog hides the panes from role queries, so behind or during it find a pane by its label.
const paneSection = (page: Page, n: 1 | 2) => page.locator(`section[aria-label="Page pane ${n}"]`)
const showing = (page: Page, relative: string) => page.locator(`section[data-note-path="${abs(relative)}"]`)
const panePaths = (page: Page) => page.locator('section[data-pane-id]')
  .evaluateAll(sections => sections.map(section => section.getAttribute('data-note-path') ?? ''))
const banner = (owner: Locator) => owner.getByTestId('save-hold-banner')
const action = (owner: Locator, name: string) => banner(owner).getByRole('button', { name, exact: true })
const saveState = (owner: Locator) => owner.getByRole('status').filter({ hasText: /^(Saved|Unsaved)$/ })
const rawText = (owner: Locator) => owner.getByTestId('raw-editor-codemirror').locator('.cm-content')
const finder = (page: Page) => page.getByRole('dialog', { name: 'Find a page' })
const discardDialog = (page: Page) => page.getByRole('dialog', { name: 'Discard unsaved changes?' })
const save = (page: Page) => triggerMenuCommand(page, APP_COMMAND_IDS.fileSave)
const toggleRaw = (page: Page) => triggerShortcutCommand(page, APP_COMMAND_IDS.editToggleRawEditor)

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

/** Real typing at the end of one source line of the raw page. */
async function typeRaw(page: Page, owner: Locator, line: string, text: string) {
  await rawText(owner).getByText(line).click()
  await page.keyboard.press('End')
  await page.keyboard.type(text)
}

/** A real permission refusal; restored at cleanup even if the test fails. */
function makeReadOnly(relative: string) {
  fs.chmodSync(abs(relative), 0o444)
  readOnlyFiles.push(abs(relative))
}

/** Runs in the page: logs each "Saved" or "Nothing to save" that appears, as a pane state or a notice. */
export function installSuccessRecorder(): void {
  const log: string[] = []
  const SUCCESS = /^(Saved|Nothing to save)$/
  const TEXT_NODE = 3
  const SHOW_TEXT = 4
  const note = (text: Node) => {
    const value = text.textContent?.trim() ?? ''
    if (SUCCESS.test(value)) log.push(`${text.parentElement?.closest('.ll-save-state') ? 'pane' : 'notice'}: ${value}`)
  }
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData') note(record.target)
      record.addedNodes.forEach(added => {
        if (added.nodeType === TEXT_NODE) note(added)
        const walker = added.ownerDocument?.createTreeWalker(added, SHOW_TEXT)
        for (let text = walker?.nextNode(); text; text = walker?.nextNode()) note(text)
      })
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true })
  Reflect.set(window, '__llSuccess', log)
}
const successes = (page: Page) => page.evaluate(() => [...(Reflect.get(window, '__llSuccess') as string[])])

test.use({ viewport: { width: 1600, height: 1000 } })
test.describe.configure({ retries: 0, timeout: 60_000 })

test.beforeEach(({ page }) => {
  vault = createFixtureVaultCopy()
  for (const [relative, content] of Object.entries(PAGES)) {
    fs.mkdirSync(path.dirname(abs(relative)), { recursive: true })
    fs.writeFileSync(abs(relative), content)
  }
  calls = []
  inflight = new Set()
  handlers = []
  aborts = []
  readOnlyFiles = []
  outsideDirs = []
  watch(page)
})

// No new vault work is admitted, held requests are aborted, every admitted one is answered, the
// page closes, then permissions, outside link targets and the vault are cleaned up.
test.afterEach(async ({ page }) => {
  try {
    // Registered last, so it runs before every test route for any later request.
    if (!page.isClosed()) await page.route('**/api/vault/**', route => route.abort().catch(() => undefined))
    for (const abort of aborts.splice(0)) abort()
    await Promise.allSettled(handlers.splice(0))
    await Promise.allSettled([...inflight].map(request => request.response()))
    await page.close({ runBeforeUnload: false })
  } finally {
    for (const file of readOnlyFiles.splice(0)) {
      try { fs.chmodSync(file, 0o644) } catch { /* already gone */ }
    }
    for (const dir of outsideDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
    removeFixtureVaultCopy(vault)
  }
})

test('ordinary rich and raw writing reach disk exactly through the page save route, and each pane keeps its own page', async ({ page }) => {
  const richWords = 'Rich words kept exactly — ✓ ü.'
  const rawWords = 'Raw words kept exactly — ✓ ü.'
  await openVault(page)
  await openByTitle(page, 'Lantern', LANTERN, 1)
  await splitWith(page, 'Tide table', TIDE)

  await typeRich(page, pane(page, 1), LANTERN, LINE[LANTERN], ` ${richWords}`)
  await save(page)
  const rich = await answered('save-page-content', LANTERN, { match: call => carries(call, richWords) })
  expect(rich.reply).toMatchObject({ status: 'committed', written: true })
  await expect.poll(() => read(LANTERN)).toBe(rich.body.content)
  expect(read(LANTERN)).toContain(`${LINE[LANTERN]} ${richWords}`)
  await expect(saveState(pane(page, 1))).toHaveText('Saved')
  expect(read(TIDE), 'the other pane was not written').toBe(PAGES[TIDE])

  await pane(page, 2).locator('.bn-editor').getByText(LINE[TIDE]).click()
  await toggleRaw(page)
  await typeRaw(page, pane(page, 2), LINE[TIDE], ` ${rawWords}`)
  await save(page)
  const raw = await answered('save-page-content', TIDE, { match: call => carries(call, rawWords) })
  expect(raw.reply).toMatchObject({ status: 'committed', written: true })
  // Raw keeps every other source byte, newlines included.
  expect(raw.body.content).toBe(PAGES[TIDE].replace(LINE[TIDE], `${LINE[TIDE]} ${rawWords}`))
  await expect.poll(() => read(TIDE)).toBe(raw.body.content)
  expect(read(LANTERN)).toBe(rich.body.content)
  await expect(pane(page, 1).getByText(richWords)).toBeVisible()

  await openByTitle(page, 'Ferry schedule', FERRY, 2)
  await openByTitle(page, 'Tide table', TIDE, 2)
  await expect(pane(page, 2)).toContainText(rawWords)
  // The fixture clears renderer storage on load, so what shows after reload came from disk.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('note-list-container').getByText('Alpha Project', { exact: true })).toBeVisible({ timeout: 30_000 })
  await openByTitle(page, 'Lantern', LANTERN, 1)
  await expect(pane(page, 1).getByText(richWords)).toBeVisible()
  await openByTitle(page, 'Tide table', TIDE, 1)
  await expect(pane(page, 1).getByText(rawWords)).toBeVisible()
  expect([read(LANTERN), read(TIDE), read(FERRY)]).toEqual([rich.body.content, raw.body.content, PAGES[FERRY]])
  expect(calls.filter(call => call.command === 'save'), 'ordinary text never used the legacy writer').toEqual([])
})

test('a real read-only page refuses without any success notice, keeps the words, then saves after repair', async ({ page }) => {
  const words = 'Words kept while the file is read-only.'
  await openVault(page)
  await openByTitle(page, 'Lantern', LANTERN, 1)
  makeReadOnly(LANTERN)
  await page.evaluate(installSuccessRecorder)
  const owner = pane(page, 1)

  await typeRich(page, owner, LANTERN, LINE[LANTERN], ` ${words}`)
  await save(page)
  const refused = await answered('save-page-content', LANTERN, { match: call => carries(call, words) })
  expect(refused.reply, 'a real disk refusal').toEqual({ status: 'refused', reason: 'readOnly' })
  await expect(banner(owner)).toContainText('The file is read-only.')
  await expect(banner(owner)).toContainText('Your words are kept')
  await expect(owner.getByText(words)).toBeVisible()
  await expect(saveState(owner)).toHaveText('Unsaved')
  expect(read(LANTERN)).toBe(PAGES[LANTERN])
  expect(await successes(page), 'success was shown for refused words').toEqual([])

  fs.chmodSync(abs(LANTERN), 0o644)
  await save(page)
  const committed = await answered('save-page-content', LANTERN, { match: call => call.reply?.status === 'committed' })
  expect(committed.body.request?.requestId, 'the repaired save is a new request').not.toBe(refused.body.request?.requestId)
  expect(committed.body.content).toContain(words)
  await expect.poll(() => read(LANTERN)).toBe(committed.body.content)
  await expect(banner(owner)).toHaveCount(0)
  await expect(saveState(owner)).toHaveText('Saved')
})

test('a missing page keeps its words without being recreated; a new page copy keeps them, and Keep the copy opens it', async ({ page }) => {
  const words = 'Words kept after the file vanished.'
  const copyPage = 'harbor/lantern-2.md'
  await openVault(page)
  await openByTitle(page, 'Lantern', LANTERN, 1)
  fs.unlinkSync(abs(LANTERN))
  const owner = pane(page, 1)

  await typeRich(page, owner, LANTERN, LINE[LANTERN], ` ${words}`)
  await save(page)
  const held = await answered('save-page-content', LANTERN, { match: call => carries(call, words) })
  expect(held.reply, 'a real missing-page hold').toMatchObject({ status: 'refused', reason: 'missing' })
  await expect(banner(owner)).toContainText("This page's file or folder is missing")
  await expect(owner.getByText(words)).toBeVisible()
  expect(exists(LANTERN), 'saving never recreates a missing page').toBe(false)

  const beforeCopy = calls.length
  await action(owner, 'Save as a new page').click()
  const copy = await answered('save-draft-as-new-page', LANTERN)
  expect(copy.reply).toMatchObject({ status: 'created', relativePath: copyPage })
  expect(copy.body.draft?.content).toContain(words)
  expect(read(copyPage)).toBe(copy.body.draft?.content)
  expect(exists(LANTERN)).toBe(false)
  await expect(banner(owner)).toContainText(`Your words are also saved as a new page: ${copyPage}.`)
  // A copy is not a final choice: the original's words stay here.
  await expect(owner.getByText(words)).toBeVisible()
  await expect(owner).toHaveAttribute('data-note-path', abs(LANTERN))

  await action(owner, 'Keep the copy and close').click()
  const kept = await answered('release-hold-with-copy', LANTERN)
  expect(kept.reply).toMatchObject({ status: 'resolved', holdRetired: true })
  expect(kept.body.operationId).toBe(copy.body.operationId)
  expect(kept.body.confirmed).toEqual({ seq: copy.body.draft?.seq, contentSha256: sha(copy.body.draft?.content ?? '') })
  await expect(showing(page, copyPage)).toHaveCount(1)
  await expect(showing(page, LANTERN)).toHaveCount(0)
  await expect(showing(page, copyPage).getByText(words)).toBeVisible()
  expect(read(copyPage)).toBe(copy.body.draft?.content)
  expect(exists(LANTERN)).toBe(false)
  expect(calls.slice(beforeCopy).filter(call => call.command === 'save-page-content' && call.path === abs(LANTERN)), 'nothing saved the original again').toEqual([])
})

test('newer words block keeping an older copy; a new copy of them can be kept, exactly that draft', async ({ page }) => {
  const first = 'First words.'
  const newer = 'Newer words.'
  await openVault(page)
  await openByTitle(page, 'Lantern', LANTERN, 1)
  fs.unlinkSync(abs(LANTERN))
  const owner = pane(page, 1)
  await typeRich(page, owner, LANTERN, LINE[LANTERN], ` ${first}`)
  await save(page)
  await answered('save-page-content', LANTERN, { match: call => carries(call, first) })
  await expect(banner(owner)).toContainText("This page's file or folder is missing")

  await action(owner, 'Save as a new page').click()
  const older = await answered('save-draft-as-new-page', LANTERN)
  expect(older.reply).toMatchObject({ status: 'created', relativePath: 'harbor/lantern-2.md' })
  await expect(action(owner, 'Keep the copy and close')).toBeVisible()

  // Writing goes on after a copy; the older copy no longer holds everything.
  await typeRich(page, owner, LANTERN, first, ` ${newer}`)
  await expect(banner(owner)).toContainText("You've written more since the copy. Save a new copy to keep everything.")
  await expect(action(owner, 'Keep the copy and close')).toHaveCount(0)
  expect(callsFor('release-hold-with-copy', LANTERN)).toEqual([])

  await action(owner, 'Save as a new page').click()
  const updated = await answered('save-draft-as-new-page', LANTERN, { from: 1 })
  expect(updated.reply).toMatchObject({ status: 'created', relativePath: 'harbor/lantern-3.md' })
  expect(updated.body.draft?.content).toContain(`${first} ${newer}`)
  expect(updated.body.draft?.seq).toBeGreaterThan(older.body.draft?.seq ?? Infinity)
  expect(read('harbor/lantern-3.md')).toBe(updated.body.draft?.content)
  expect(read('harbor/lantern-2.md'), 'the older copy is left as it was').toBe(older.body.draft?.content)

  await action(owner, 'Keep the copy and close').click()
  const kept = await answered('release-hold-with-copy', LANTERN)
  expect(kept.reply).toMatchObject({ status: 'resolved', holdRetired: true })
  expect(kept.body.operationId).toBe(updated.body.operationId)
  expect(kept.body.confirmed).toEqual({ seq: updated.body.draft?.seq, contentSha256: sha(updated.body.draft?.content ?? '') })
  await expect(showing(page, 'harbor/lantern-3.md').getByText(`${first} ${newer}`)).toBeVisible()
  await expect(showing(page, LANTERN)).toHaveCount(0)
  expect(exists(LANTERN)).toBe(false)
})

test('a copy edited after it was saved cannot be kept; the words and the hold stay', async ({ page }) => {
  const words = 'Words whose copy is edited elsewhere.'
  const copyPage = 'harbor/lantern-2.md'
  const edited = '# Lantern\n\nSomeone else edited this copy.\n'
  await openVault(page)
  await openByTitle(page, 'Lantern', LANTERN, 1)
  fs.unlinkSync(abs(LANTERN))
  const owner = pane(page, 1)
  await typeRich(page, owner, LANTERN, LINE[LANTERN], ` ${words}`)
  await save(page)
  await answered('save-page-content', LANTERN, { match: call => carries(call, words) })
  await action(owner, 'Save as a new page').click()
  const copy = await answered('save-draft-as-new-page', LANTERN)
  expect(copy.reply).toMatchObject({ status: 'created', relativePath: copyPage })

  // The same file changed in place, as another program would.
  fs.writeFileSync(abs(copyPage), edited)
  await action(owner, 'Keep the copy and close').click()
  const refused = await answered('release-hold-with-copy', LANTERN)
  expect(refused.reply, 'a real copy-proof refusal').toEqual({ status: 'refused', reason: 'copyChanged' })
  await expect(banner(owner)).toContainText('The copy changed after it was saved. Save a new copy, or discard.')
  await expect(owner).toHaveAttribute('data-note-path', abs(LANTERN))
  await expect(owner.getByText(words)).toBeVisible()
  expect(read(copyPage), 'the edited copy is left alone').toBe(edited)
  expect(exists(LANTERN)).toBe(false)
})

test('Check again after a lost reply queries without saving again, and settles the exact text already on disk', async ({ page }) => {
  const words = 'Saved on disk while its reply was lost.'
  await openVault(page)
  await openByTitle(page, 'Lantern', LANTERN, 1)
  const owner = pane(page, 1)
  const lost = await loseNextSaveReply(page, LANTERN, words)

  await typeRich(page, owner, LANTERN, LINE[LANTERN], ` ${words}`)
  await save(page)
  await expect.poll(() => lost.fired, { message: 'the lost-reply route never fired' }).toBe(1)
  await expect.poll(() => lost.realReply).toMatchObject({ status: 'committed', written: true })
  // The disk already holds exactly the submitted text; only the page's answer was lost.
  expect(read(LANTERN)).toBe(lost.submitted)
  await expect(banner(owner)).toContainText("We couldn't confirm whether this page saved.")
  await expect(saveState(owner)).toHaveText('Unsaved')

  const saves = callsFor('save-page-content', LANTERN).length
  const checks = callsFor('check-save-outcome', LANTERN).length
  await action(owner, 'Check again').click()
  const check = await answered('check-save-outcome', LANTERN, { from: checks })
  expect(check.body.request?.requestId, 'Check asks about the lost request itself').toBe(lost.requestId)
  expect(check.reply).toMatchObject({ state: 'done', outcome: { status: 'committed', written: true } })
  await expect(banner(owner)).toHaveCount(0)
  await expect(saveState(owner)).toHaveText('Saved')
  expect(callsFor('save-page-content', LANTERN), 'Check never saved again').toHaveLength(saves)
  expect(callsFor('check-save-outcome', LANTERN)).toHaveLength(checks + 1)
  expect(read(LANTERN)).toBe(lost.submitted)
})

test('Discard asks first; Escape and Cancel change nothing, and discarded rich words never come back', async ({ page }) => {
  const words = 'Rich words that will be discarded.'
  await openVault(page)
  await openByTitle(page, 'Ferry schedule', FERRY, 1)
  makeReadOnly(FERRY)
  const owner = pane(page, 1)
  await typeRich(page, owner, FERRY, LINE[FERRY], ` ${words}`)
  await save(page)
  const refused = await answered('save-page-content', FERRY, { match: call => carries(call, words) })
  expect(refused.reply).toEqual({ status: 'refused', reason: 'readOnly' })
  const discard = action(owner, 'Discard changes…')

  await discard.click()
  await expect(discardDialog(page)).toContainText('Your unsaved changes to “Ferry schedule” will be lost')
  await page.keyboard.press('Escape')
  await expect(discardDialog(page)).toBeHidden()
  await expect(discard).toBeFocused()
  await discard.click()
  await discardDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(discardDialog(page)).toBeHidden()
  expect(callsFor('discard-hold', FERRY), 'Escape and Cancel sent nothing').toEqual([])
  await expect(owner.getByText(words)).toBeVisible()
  expect(read(FERRY)).toBe(PAGES[FERRY])

  await discard.click()
  await discardDialog(page).getByRole('button', { name: 'Discard changes', exact: true }).click()
  const discarded = await answered('discard-hold', FERRY)
  expect(discarded.reply).toMatchObject({ status: 'resolved' })
  await expect.poll(() => panePaths(page)).not.toContain(abs(FERRY))
  const afterDiscard = calls.length
  // Writable again, so any write of the discarded words would really land.
  fs.chmodSync(abs(FERRY), 0o644)

  // Straight away: Save, reopen, raw toggle, Save, switch away and back.
  await save(page)
  await openByTitle(page, 'Ferry schedule', FERRY, 1)
  await expect(pane(page, 1).getByText(LINE[FERRY])).toBeVisible()
  await toggleRaw(page)
  await expect(rawText(pane(page, 1))).toContainText(LINE[FERRY])
  await save(page)
  await toggleRaw(page)
  await save(page)
  await openByTitle(page, 'Tide table', TIDE, 1)
  await openByTitle(page, 'Ferry schedule', FERRY, 1)
  await expect(pane(page, 1)).toContainText(LINE[FERRY])
  await expect(pane(page, 1)).not.toContainText(words)
  expect(read(FERRY)).toBe(PAGES[FERRY])
  expect(calls.slice(afterDiscard).filter(call => carries(call, words)), 'the discarded words were sent again').toEqual([])
})

test('discarded raw words never come back after reopen, raw toggle or Save', async ({ page }) => {
  const words = 'Raw words that will be discarded.'
  await openVault(page)
  await openByTitle(page, 'Tide table', TIDE, 1)
  const owner = pane(page, 1)
  await owner.locator('.bn-editor').getByText(LINE[TIDE]).click()
  await toggleRaw(page)
  await expect(rawText(owner)).toContainText(LINE[TIDE])
  makeReadOnly(TIDE)
  await typeRaw(page, owner, LINE[TIDE], ` ${words}`)
  await save(page)
  const refused = await answered('save-page-content', TIDE, { match: call => carries(call, words) })
  expect(refused.reply).toEqual({ status: 'refused', reason: 'readOnly' })
  expect(refused.body.content).toBe(PAGES[TIDE].replace(LINE[TIDE], `${LINE[TIDE]} ${words}`))

  await action(owner, 'Discard changes…').click()
  await discardDialog(page).getByRole('button', { name: 'Discard changes', exact: true }).click()
  expect((await answered('discard-hold', TIDE)).reply).toMatchObject({ status: 'resolved' })
  await expect.poll(() => panePaths(page)).not.toContain(abs(TIDE))
  const afterDiscard = calls.length
  fs.chmodSync(abs(TIDE), 0o644)

  await save(page)
  await openByTitle(page, 'Tide table', TIDE, 1)
  await expect(pane(page, 1)).toContainText(LINE[TIDE])
  await expect(pane(page, 1)).not.toContainText(words)
  await save(page)
  await toggleRaw(page)
  await save(page)
  await expect(pane(page, 1)).toContainText(LINE[TIDE])
  await expect(pane(page, 1)).not.toContainText(words)
  expect(read(TIDE)).toBe(PAGES[TIDE])
  expect(calls.slice(afterDiscard).filter(call => carries(call, words)), 'the discarded words were sent again').toEqual([])
})

test('a missing folder needs an explicit top-of-vault choice and warns about links; that copy never overwrites', async ({ page }) => {
  const words = 'Words whose folder is gone.'
  const collision = '# Lighthouse\n\nA page already at the top of the vault.\n'
  fs.writeFileSync(abs('lantern-2.md'), collision)
  await openVault(page)
  await openByTitle(page, 'Lantern', LANTERN, 1)
  fs.rmSync(abs('harbor'), { recursive: true })
  const owner = pane(page, 1)
  await typeRich(page, owner, LANTERN, LINE[LANTERN], ` ${words}`)
  await save(page)
  const held = await answered('save-page-content', LANTERN, { match: call => carries(call, words) })
  expect(held.reply).toMatchObject({ status: 'refused', reason: 'parentMissing' })

  await action(owner, 'Save as a new page').click()
  const asked = await answered('save-draft-as-new-page', LANTERN)
  expect(asked.body.folder).toBeNull()
  expect(asked.reply).toEqual({ status: 'folderUnavailable', recordedFolder: abs('harbor') })
  await expect(banner(owner)).toContainText("This page's folder is gone. You can save the copy at the top of the vault instead, but its links to other pages may not work there.")
  await expect(action(owner, 'Save as a new page')).toHaveCount(0)
  expect(exists('harbor'), 'the missing folder is not recreated').toBe(false)
  expect(topPages(), 'nothing was copied without a choice').toEqual(['lantern-2.md'])

  await action(owner, 'Save at the top of the vault').click()
  const copy = await answered('save-draft-as-new-page', LANTERN, { from: 1 })
  expect(copy.body.folder).toBe(vault)
  expect(copy.reply).toMatchObject({ status: 'created', relativePath: 'lantern-3.md' })
  expect(read('lantern-3.md')).toBe(copy.body.draft?.content)
  expect(copy.body.draft?.content).toContain(words)
  expect(read('lantern-2.md'), 'the existing page is not overwritten').toBe(collision)
  expect(topPages()).toEqual(['lantern-2.md', 'lantern-3.md'])
  expect(exists('harbor')).toBe(false)
  await expect(banner(owner)).toContainText('Your words are also saved as a new page: lantern-3.md.')
  await expect(action(owner, 'Keep the copy and close')).toBeVisible()
})

test('while a final choice waits on disk, its page takes no typing or raw toggle, and the other page still saves', async ({ page }) => {
  const words = 'Words waiting for a choice.'
  const blockedWords = 'Typed while the choice was pending.'
  const otherWords = 'The other page saves meanwhile.'
  await openVault(page)
  await openByTitle(page, 'Ferry schedule', FERRY, 1)
  await splitWith(page, 'Tide table', TIDE)
  makeReadOnly(FERRY)
  await typeRich(page, pane(page, 1), FERRY, LINE[FERRY], ` ${words}`)
  await save(page)
  await answered('save-page-content', FERRY, { match: call => carries(call, words) })
  const held = await holdNext(page, 'discard-hold', FERRY)

  await action(pane(page, 1), 'Discard changes…').click()
  await discardDialog(page).getByRole('button', { name: 'Discard changes', exact: true }).click()
  await expect.poll(() => held.fired, { message: 'the discard never reached the disk route' }).toBe(1)
  const target = paneSection(page, 1)
  await expect(target.locator('[data-recovery-blocked]')).toHaveCount(1)
  await expect(paneSection(page, 2).locator('[data-recovery-blocked]')).toHaveCount(0)
  await expect(banner(target)).toContainText('Working…')

  // The page is inert while native decides: a click cannot focus it and keys cannot reach it.
  await target.locator('.bn-editor').getByText(LINE[FERRY]).click({ force: true })
  await page.keyboard.type(blockedWords)
  await toggleRaw(page)
  await expect(target.getByTestId('raw-editor-codemirror')).toHaveCount(0)
  await expect(target).not.toContainText(blockedWords)

  await typeRich(page, pane(page, 2), TIDE, LINE[TIDE], ` ${otherWords}`)
  await save(page)
  const other = await answered('save-page-content', TIDE, { match: call => carries(call, otherWords) })
  expect(other.reply).toMatchObject({ status: 'committed', written: true })
  await expect.poll(() => read(TIDE)).toBe(other.body.content)
  expect(callsFor('discard-hold', FERRY).every(call => call.reply === undefined), 'the discard was still waiting').toBe(true)

  held.release()
  expect((await answered('discard-hold', FERRY)).reply).toMatchObject({ status: 'resolved' })
  await expect.poll(() => panePaths(page)).toEqual(['', abs(TIDE)])
  fs.chmodSync(abs(FERRY), 0o644)
  expect(calls.filter(call => carries(call, blockedWords)), 'blocked typing reached a save').toEqual([])
  expect(read(FERRY)).toBe(PAGES[FERRY])
  expect(read(TIDE)).toBe(other.body.content)
})

test('a page that links outside the vault holds its words, never writes through the link, and can be discarded', async ({ page }) => {
  const words = 'Words that must not go through the link.'
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'll-outside-'))
  outsideDirs.push(outside)
  const target = path.join(outside, 'beacon.md')
  const targetText = '# Beacon\n\nThe beacon text lives outside the vault.\n'
  fs.writeFileSync(target, targetText)
  fs.symlinkSync(target, abs('harbor/beacon.md'))
  await openVault(page)
  await openByTitle(page, 'Beacon', 'harbor/beacon.md', 1)
  const owner = pane(page, 1)

  await typeRich(page, owner, 'harbor/beacon.md', 'The beacon text lives outside the vault.', ` ${words}`)
  await save(page)
  const held = await answered('save-page-content', 'harbor/beacon.md', { match: call => carries(call, words) })
  expect(held.reply, 'a real link hold').toMatchObject({ status: 'refused', reason: 'symlink' })
  await expect(banner(owner)).toContainText('This page is a link to another file')
  await expect(owner.getByText(words)).toBeVisible()
  expect(fs.readFileSync(target, 'utf8')).toBe(targetText)

  await action(owner, 'Discard changes…').click()
  await discardDialog(page).getByRole('button', { name: 'Discard changes', exact: true }).click()
  expect((await answered('discard-hold', 'harbor/beacon.md')).reply).toMatchObject({ status: 'resolved' })
  await expect(showing(page, 'harbor/beacon.md')).toHaveCount(0)
  expect(fs.readFileSync(target, 'utf8'), 'the link target is untouched').toBe(targetText)
  expect(fs.lstatSync(abs('harbor/beacon.md')).isSymbolicLink()).toBe(true)
  expect(calls.filter(call => carries(call, words) && call.reply?.status === 'committed')).toEqual([])
})

test('after a discard, reopening shows the newer file on disk, not the text remembered from the first open', async ({ page }) => {
  const words = 'Draft words that will be discarded.'
  const fresh = 'Fresh words after reopening.'
  const newerLine = 'The winter ferry now leaves at eight.'
  const newer = `# Ferry schedule\n\n${newerLine}\n`
  const reads: Array<{ method: string, path: unknown }> = []
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/vault/content') reads.push({ method: request.method(), path: readArgs(request).path })
  })
  await openVault(page)
  // A normal open remembers the text along with the list's size and time for the file.
  await openByTitle(page, 'Ferry schedule', FERRY, 1)
  const owner = pane(page, 1)
  await expect(owner.getByText(LINE[FERRY])).toBeVisible()
  makeReadOnly(FERRY)
  await typeRich(page, owner, FERRY, LINE[FERRY], ` ${words}`)
  await save(page)
  const refused = await answered('save-page-content', FERRY, { match: call => carries(call, words) })
  expect(refused.reply).toEqual({ status: 'refused', reason: 'readOnly' })

  // Changed outside the app; nothing reloads the page list, so its size and time stay old.
  fs.chmodSync(abs(FERRY), 0o644)
  fs.writeFileSync(abs(FERRY), newer)
  fs.chmodSync(abs(FERRY), 0o444)

  await action(owner, 'Discard changes…').click()
  await discardDialog(page).getByRole('button', { name: 'Discard changes', exact: true }).click()
  expect((await answered('discard-hold', FERRY)).reply).toMatchObject({ status: 'resolved' })
  await expect.poll(() => panePaths(page)).not.toContain(abs(FERRY))
  expect(read(FERRY), 'the discard left the newer file alone').toBe(newer)
  const afterDiscard = calls.length
  const readsBefore = reads.length
  fs.chmodSync(abs(FERRY), 0o644)

  await openByTitle(page, 'Ferry schedule', FERRY, 1)
  await expect(pane(page, 1).getByText(newerLine)).toBeVisible()
  await expect(pane(page, 1).getByText(LINE[FERRY])).toHaveCount(0)
  await expect(pane(page, 1).getByText(words)).toHaveCount(0)
  expect(reads.slice(readsBefore), 'the reopen read the file again').toContainEqual({ method: 'GET', path: abs(FERRY) })

  await pane(page, 1).locator('.bn-editor').getByText(newerLine).click()
  await toggleRaw(page)
  await typeRaw(page, pane(page, 1), newerLine, ` ${fresh}`)
  await save(page)
  const committed = await answered('save-page-content', FERRY, { match: call => carries(call, fresh) })
  expect(committed.reply).toMatchObject({ status: 'committed', written: true })
  expect(committed.body.content).toBe(newer.replace(newerLine, `${newerLine} ${fresh}`))
  await expect.poll(() => read(FERRY)).toBe(committed.body.content)
  expect(calls.slice(afterDiscard).filter(call => carries(call, words)), 'nothing after the discard carried its words').toEqual([])
})

/** Injected timing: holds every whole-vault list request until `release`; cleanup aborts any still held. */
async function holdListRefreshes(page: Page) {
  let decide: (choice: 'continue' | 'abort') => void = () => {}
  const choice = new Promise<'continue' | 'abort'>(resolve => { decide = resolve })
  const gate = { seen: [] as Array<{ method: string } & Record<string, unknown>>, answered: 0, release: () => decide('continue') }
  aborts.push(() => decide('abort'))
  // Matched by path, since the list read carries its arguments in the query.
  await page.route(url => url.pathname === '/api/vault/list', tracked(async route => {
    gate.seen.push({ ...readArgs(route.request()), method: route.request().method() })
    if ((await choice) === 'abort') return route.abort().catch(() => undefined)
    await forward(route)
    gate.answered += 1
  }))
  return gate
}

test('Keep opens the copy in its own pane from fresh reads while the page list is still loading, and leaves the other pane alone', async ({ page }) => {
  const words = 'Words kept in a copy of a read-only page.'
  const tideWords = 'Other pane words typed while Keep waits.'
  const copyPage = 'harbor/lantern-2.md'
  const reads: Array<{ read: string, path: unknown, request: Request }> = []
  page.on('request', request => {
    const route = new URL(request.url()).pathname
    if (route !== '/api/vault/entry' && route !== '/api/vault/content') return
    reads.push({ read: `${request.method()} ${route}`, path: readArgs(request).path, request })
  })
  await openVault(page)
  await openByTitle(page, 'Lantern', LANTERN, 1)
  await splitWith(page, 'Tide table', TIDE)
  makeReadOnly(LANTERN)
  const owner = pane(page, 1)
  await typeRich(page, owner, LANTERN, LINE[LANTERN], ` ${words}`)
  await save(page)
  const refused = await answered('save-page-content', LANTERN, { match: call => carries(call, words) })
  expect(refused.reply).toEqual({ status: 'refused', reason: 'readOnly' })

  // The list refresh a new copy starts stays held until the end, so the copy must open without it.
  const lists = await holdListRefreshes(page)
  await action(owner, 'Save as a new page').click()
  const copy = await answered('save-draft-as-new-page', LANTERN)
  expect(copy.reply).toMatchObject({ status: 'created', relativePath: copyPage })
  expect(read(copyPage)).toBe(copy.body.draft?.content)
  await expect.poll(() => lists.seen.length, 'the copy started a whole-vault list refresh').toBeGreaterThan(0)
  expect(lists.seen[0], 'the real refresh: GET with the vault root in the query').toMatchObject({ method: 'GET', path: vault, reload: '1' })
  const keep = action(owner, 'Keep the copy and close')
  await expect(keep).toBeEnabled()

  // Injected timing: the final proof waits at its route while the other pane is used.
  const proof = await holdNext(page, 'release-hold-with-copy', LANTERN)
  const readsBefore = reads.length
  await keep.click()
  await expect.poll(() => proof.fired).toBe(1)
  await typeRich(page, pane(page, 2), TIDE, LINE[TIDE], ` ${tideWords}`)
  await save(page)
  const tide = await answered('save-page-content', TIDE, { match: call => carries(call, tideWords) })
  expect(tide.reply).toMatchObject({ status: 'committed', written: true })
  expect(await focusedPagePath(page)).toBe(abs(TIDE))

  proof.release()
  const kept = await answered('release-hold-with-copy', LANTERN)
  // A read-only refusal records no native hold (its reply above carries none), so Keep retires nothing.
  expect(kept.reply).toMatchObject({ status: 'resolved', holdRetired: false })
  expect(kept.body.confirmed).toEqual({ seq: copy.body.draft?.seq, contentSha256: sha(copy.body.draft?.content ?? '') })
  await expect(pane(page, 1), 'the copy opens in the pane it came from').toHaveAttribute('data-note-path', abs(copyPage))
  await expect(pane(page, 1).getByText(words)).toBeVisible()
  await expect(showing(page, LANTERN)).toHaveCount(0)
  await expect(pane(page, 2)).toHaveAttribute('data-note-path', abs(TIDE))
  await expect(pane(page, 2).getByText(tideWords)).toBeVisible()
  await expect(pane(page, 2).getByText(words)).toHaveCount(0)
  expect(await focusedPagePath(page), 'focus stayed in the other pane').toBe(abs(TIDE))
  expect(lists.answered, 'the copy opened while the list was still held').toBe(0)

  const copyReads = reads.slice(readsBefore).filter(seen => seen.path === abs(copyPage))
  expect(copyReads.map(seen => seen.read), 'fresh reads of the exact copy path').toEqual(expect.arrayContaining(['GET /api/vault/entry', 'GET /api/vault/content']))
  const served = await copyReads.find(seen => seen.read === 'GET /api/vault/content')?.request.response()
    .then(response => response?.json()) as { content?: string } | undefined
  expect(served?.content, 'the copy opened from its exact bytes on disk').toBe(copy.body.draft?.content)
  expect(read(copyPage)).toBe(copy.body.draft?.content)
  expect(proof.fired).toBe(1)
  expect(callsFor('release-hold-with-copy', LANTERN)).toHaveLength(1)

  lists.release()
  await expect.poll(() => lists.answered).toBe(lists.seen.length)
  await expect(pane(page, 1)).toHaveAttribute('data-note-path', abs(copyPage))
  await expect(pane(page, 2)).toHaveAttribute('data-note-path', abs(TIDE))
  expect(read(TIDE)).toBe(tide.body.content)
  expect(read(LANTERN)).toBe(PAGES[LANTERN])
  expect(calls.filter(call => call.path === abs(TIDE) && carries(call, words)), 'no copied words reached the other page').toEqual([])
})
