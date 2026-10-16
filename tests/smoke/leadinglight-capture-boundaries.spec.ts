import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type Page, type Request, type Route } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVaultDesktopHarness, removeFixtureVaultCopy } from '../helpers/fixtureVault'

// Save must never announce success while typed words exist only on screen or only in a failed write.
// Every app-wide notice is recorded from before Save, so a later warning cannot hide an earlier "Saved".

const CAPTURE = /^untitled-page-\d+(?:-\d+)?\.md$/
const HARBOR = 'harbor/lantern.md'
const HARBOR_SENTENCE = 'The harbor lantern faces the breakwater.'
const SUCCESS = /^(Saved|Nothing to save)$/

let vault: string
const abs = (relative: string) => path.join(vault, relative)
const read = (relative: string) => fs.readFileSync(abs(relative), 'utf8')
const captures = () => fs.readdirSync(vault).filter(name => CAPTURE.test(name)).sort()

const sidebarNav = (page: Page) => page.getByTestId('sidebar-top-nav')
const pane = (page: Page) => page.getByRole('region', { name: 'Page pane 1', exact: true })
const finder = (page: Page) => page.getByRole('dialog', { name: 'Find a page' })
const draftField = (page: Page) => page.getByRole('textbox', { name: 'Your draft' })
const tryAgain = (page: Page) => page.getByRole('button', { name: 'Try again', exact: true })
const saveState = (page: Page) => pane(page).getByRole('status').filter({ hasText: /^(Saved|Unsaved)$/ })
const save = (page: Page) => page.keyboard.press('ControlOrMeta+KeyS')

const focusedPagePath = (page: Page) => page.evaluate(() => {
  const active = document.activeElement
  if (!active?.closest('[contenteditable="true"]')) return null
  return active.closest('section[data-note-path]')?.getAttribute('data-note-path') ?? null
})

interface Notice { kind: 'notice' | 'mark' | 'persisted', text: string, batch?: number, how?: 'shown' | 'changed' }

/**
 * Read-only, runs in the page: logs every notice text outside the pages and the draft card that appeared
 * since the last delivery, even if it was replaced or removed before delivery. Exported for its private check.
 */
export function installNoticeRecorder(): void {
  const log: Array<{ kind: string, text: string, batch?: number, how?: string }> = []
  // Each page's own Saved/Unsaved, the draft card and the note list are page state, not app-wide notices.
  const pageState = '[data-pane-id], [data-pending-capture="true"], [data-testid="note-list-container"], [role="status"]'
  const relevant = (text: string) => text.length > 0 && text.length <= 200 && /\b(save|saved|draft)\b/i.test(text)
  // Node types and the text filter by number, and each node's own document, so no DOM globals are needed.
  const TEXT_NODE = 3
  const ELEMENT_NODE = 1
  const SHOW_TEXT = 4
  const isText = (node: Node): node is Text => node.nodeType === TEXT_NODE
  let batch = 0
  const take = (records: MutationRecord[]) => {
    if (records.length === 0) return
    batch += 1
    const roots = new Set<Node>()
    const removedFrom = new Map<Node, Node>()
    const olds = new Map<Text, string[]>()
    for (const record of records) {
      record.addedNodes.forEach(node => roots.add(node))
      record.removedNodes.forEach(node => removedFrom.set(node, record.target))
      if (record.type === 'characterData' && isText(record.target)) {
        olds.set(record.target, [...(olds.get(record.target) ?? []), record.oldValue ?? ''])
      }
    }
    // Up the tree; a subtree removed in this delivery continues from where it was removed.
    const ancestry = (node: Node) => {
      const chain: Node[] = []
      for (let at: Node | undefined = node; at && chain.length < 500; at = at.parentNode ?? removedFrom.get(at)) chain.push(at)
      return chain
    }
    const candidates = new Set<Text>(olds.keys())
    for (const node of [...roots, ...removedFrom.keys()]) {
      if (isText(node)) {
        candidates.add(node)
        continue
      }
      const walker = node.ownerDocument?.createTreeWalker(node, SHOW_TEXT)
      for (let text = walker?.nextNode(); text; text = walker?.nextNode()) candidates.add(text as Text)
    }
    for (const text of candidates) {
      const before = olds.get(text) ?? []
      if (![...before, text.data].some(value => relevant(value.trim()))) continue
      const chain = ancestry(text)
      if (chain.some(node => node.nodeType === ELEMENT_NODE && (node as Element).matches(pageState))) continue
      // Each change set the next change's old value, and the last change set the current one.
      const changed = before.length > 0 ? [...before.slice(1), text.data] : []
      // A node that arrived in this delivery also counts the value it arrived with; an older node does not.
      const shown = chain.some(node => roots.has(node)) ? [before[0] ?? text.data] : []
      const found = [...shown.map(value => ({ value, how: 'shown' })), ...changed.map(value => ({ value, how: 'changed' }))]
      for (const { value, how } of found) if (relevant(value.trim())) log.push({ kind: 'notice', text: value.trim(), batch, how })
    }
  }
  const observer = new MutationObserver(take)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, characterDataOldValue: true })
  // Changes made before an entry are drained first, so marks split deliveries exactly.
  Reflect.set(window, '__llNoteEntry', (kind: string, text: string) => {
    take(observer.takeRecords())
    log.push({ kind, text })
  })
  Reflect.set(window, '__llNotices', log)
}

const recordNotices = (page: Page) => page.evaluate(installNoticeRecorder)

const addEntry = (page: Page, kind: Notice['kind'], text: string) =>
  page.evaluate(([entryKind, entryText]) => (Reflect.get(window, '__llNoteEntry') as (kind: string, text: string) => void)(entryKind, entryText), [kind, text])

const allNotices = (page: Page) => page.evaluate(() => [...(Reflect.get(window, '__llNotices') as Notice[])])

// Notices between two marks; `to` absent means up to now.
async function noticesBetween(page: Page, from: string, to?: string): Promise<string[]> {
  const log = await allNotices(page)
  const start = log.findIndex(entry => entry.kind === 'mark' && entry.text === from)
  const end = to ? log.findIndex(entry => entry.kind === 'mark' && entry.text === to) : log.length
  return log.slice(start + 1, end).filter(entry => entry.kind === 'notice').map(entry => entry.text)
}

// The first success after the mark must come after a finished disk write of exactly this text.
async function expectSuccessOnlyAfterWrite(page: Page, from: string, text: string) {
  await expect.poll(async () => (await noticesBetween(page, from)).filter(notice => SUCCESS.test(notice)), {
    message: 'Save never announced success after the backend accepted the text',
  }).not.toEqual([])
  const log = await allNotices(page)
  const start = log.findIndex(entry => entry.kind === 'mark' && entry.text === from)
  const success = log.findIndex((entry, index) => index > start && entry.kind === 'notice' && SUCCESS.test(entry.text))
  const written = log.slice(0, success).filter(entry => entry.kind === 'persisted').map(entry => entry.text.trim())
  expect(written, 'success was announced before the text reached disk').toContain(text)
}

function savedBody(request: Request): { path: string, content: string } {
  try {
    const body = request.postDataJSON() as { path?: unknown, content?: unknown } | null
    return { path: typeof body?.path === 'string' ? body.path : '', content: typeof body?.content === 'string' ? body.content : '' }
  } catch {
    return { path: '', content: '' }
  }
}

interface CaptureWrites {
  /** The first write of a new page file: held, refused or passed. */
  create: 'hold' | 'fail' | 'pass'
  /** Later writes of that page's text: refused, or passed and logged once on disk. */
  write: 'fail' | 'pass'
  heldCreate: string | null
  failedCreates: string[]
  failedWrites: string[]
  releaseCreate: () => void
  /** Cleanup: a still-held create is aborted, and every handler has finished on return. */
  dispose: () => Promise<void>
}

let activeWrites: CaptureWrites | null = null

// Installed before New page, so no write of the new page can slip past the intended outcome.
async function controlCaptureWrites(page: Page, modes: Pick<CaptureWrites, 'create' | 'write'>): Promise<CaptureWrites> {
  let decide: (decision: 'continue' | 'abort') => void = () => {}
  const decision = new Promise<'continue' | 'abort'>((resolve) => { decide = resolve })
  const gate: CaptureWrites = {
    ...modes,
    heldCreate: null,
    failedCreates: [],
    failedWrites: [],
    releaseCreate: () => decide('continue'),
    dispose: async () => {
      decide('abort')
      await page.unrouteAll({ behavior: 'wait' })
    },
  }
  const refuse = (route: Route, error: string) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error }) })
  await page.route('**/api/vault/save', async (route) => {
    const { path: target, content } = savedBody(route.request())
    if (!CAPTURE.test(path.basename(target))) return route.continue()
    if (!fs.existsSync(target)) {
      if (gate.create === 'fail') {
        gate.failedCreates.push(target)
        return refuse(route, 'The disk refused the page.')
      }
      if (gate.create === 'hold' && gate.heldCreate === null) {
        gate.heldCreate = target
        if ((await decision) === 'abort') return route.abort()
      }
      return route.continue()
    }
    if (gate.write === 'fail') {
      gate.failedWrites.push(target)
      // Numbered, so each refusal shows a notice of its own.
      return refuse(route, `The disk refused write ${gate.failedWrites.length}.`)
    }
    const response = await route.fetch()
    if (response.ok()) await addEntry(page, 'persisted', content)
    return route.fulfill({ response })
  })
  activeWrites = gate
  return gate
}

test.use({ viewport: { width: 1600, height: 1000 } })
test.describe.configure({ timeout: 60_000 })

test.afterEach(() => {
  removeFixtureVaultCopy(vault)
})

test.describe('Save while typed words are not yet safely on disk', () => {
  test.beforeEach(async ({ page }) => {
    vault = createFixtureVaultCopy()
    fs.mkdirSync(abs('harbor'), { recursive: true })
    fs.writeFileSync(abs(HARBOR), `# Lantern\n\n${HARBOR_SENTENCE}\n`)
    await openFixtureVaultDesktopHarness(page, vault, { isGitRepo: false })
    await sidebarNav(page).getByRole('button', { name: 'Search', exact: true }).click()
    await finder(page).getByRole('combobox').fill('Lantern')
    await finder(page).getByRole('group', { name: 'Pages', exact: true }).getByRole('option')
      .filter({ hasText: /^Lantern/ }).click()
    await expect(finder(page)).toBeHidden()
    await expect(pane(page)).toHaveAttribute('data-note-path', abs(HARBOR))
    await pane(page).getByText(HARBOR_SENTENCE).click()
    await expect.poll(() => focusedPagePath(page)).toBe(abs(HARBOR))
    await recordNotices(page)
    expect(captures()).toEqual([])
  })

  // Inner hooks finish before the file-level one deletes the vault.
  test.afterEach(async () => {
    await activeWrites?.dispose()
    activeWrites = null
  })

  test('Save with a draft whose page could not be created refuses without any success notice, then Try again saves it once', async ({ page }) => {
    const text = 'Notes kept through a refusal — ✓ ü.'
    const harborBefore = read(HARBOR)
    const writes = await controlCaptureWrites(page, { create: 'fail', write: 'pass' })

    await sidebarNav(page).getByRole('button', { name: 'New page', exact: true }).click()
    await page.keyboard.type(text)
    await expect.poll(() => writes.failedCreates.length, { message: 'the create never reached the bridge' }).toBeGreaterThan(0)
    await expect(tryAgain(page)).toBeVisible()
    await expect(draftField(page)).toHaveValue(text)

    await addEntry(page, 'mark', 'save-refused')
    await save(page)
    // Save has finished once it tells the person why it did not save.
    await expect.poll(async () => (await noticesBetween(page, 'save-refused')).filter(notice => !SUCCESS.test(notice)), {
      message: 'Save never said that the draft is not saved',
    }).not.toEqual([])
    expect(await noticesBetween(page, 'save-refused'), 'success was announced for a draft with no page')
      .not.toContainEqual(expect.stringMatching(SUCCESS))
    await expect(draftField(page)).toHaveValue(text)
    await expect(tryAgain(page)).toBeVisible()
    expect(captures(), 'a refused Save writes no page').toEqual([])
    for (const failed of writes.failedCreates) expect(fs.existsSync(failed)).toBe(false)
    expect(read(HARBOR)).toBe(harborBefore)

    // An ordinary next step keeps the record running, so a late success from the refused Save shows too.
    writes.create = 'pass'
    await tryAgain(page).click()
    await expect(draftField(page)).toHaveCount(0)
    await expect.poll(() => captures().length).toBe(1)
    const [created] = captures()
    await expect(pane(page)).toHaveAttribute('data-note-path', abs(created))

    await addEntry(page, 'mark', 'save-after-retry')
    await save(page)
    await expectSuccessOnlyAfterWrite(page, 'save-after-retry', text)
    expect(await noticesBetween(page, 'save-refused', 'save-after-retry'), 'success was announced while the draft had no page')
      .not.toContainEqual(expect.stringMatching(SUCCESS))
    expect(read(created).trim()).toBe(text)
    expect(captures(), 'one page in the end').toEqual([created])
    expect(read(HARBOR)).toBe(harborBefore)
  })

  test('Save after the draft reached its page reports failure while the disk refuses the text, then saves it once', async ({ page }) => {
    const text = 'Written once the disk accepts it — ✓ ü.'
    const harborBefore = read(HARBOR)
    const writes = await controlCaptureWrites(page, { create: 'hold', write: 'fail' })

    // The whole text is typed while the create waits, so the hand-over moves all of it at once.
    await sidebarNav(page).getByRole('button', { name: 'New page', exact: true }).click()
    await page.keyboard.type(text)
    await expect.poll(() => writes.heldCreate, { message: 'the new page was never created through the bridge' }).not.toBeNull()
    await expect(draftField(page)).toHaveValue(text)
    writes.releaseCreate()

    const created = path.basename(writes.heldCreate ?? '')
    await expect(draftField(page)).toHaveCount(0)
    await expect(pane(page)).toHaveAttribute('data-note-path', abs(created))
    await expect(pane(page).locator('.bn-editor')).toContainText(text)
    // The page's own first write is refused and reported before Save, so Save meets nothing in flight.
    await expect.poll(async () => (await allNotices(page)).some(entry => entry.kind === 'notice' && /refused write 1\b/.test(entry.text)), {
      message: 'the page text was never written, or its failure was never reported',
    }).toBe(true)
    expect(read(created), 'the refused write left the new file empty').toBe('')
    const refusedBefore = writes.failedWrites.length
    const earlierRefusal = (notice: string) => Number(/refused write (\d+)\b/.exec(notice)?.[1] ?? Infinity) <= refusedBefore

    await addEntry(page, 'mark', 'save-refused-write')
    await save(page)
    // Save has finished once it reports a failure of its own, not one from before it was pressed.
    await expect.poll(async () => (await noticesBetween(page, 'save-refused-write'))
      .filter(notice => !SUCCESS.test(notice) && !earlierRefusal(notice)), {
      message: 'Save never reported that the page text was not saved',
    }).not.toEqual([])
    expect(await noticesBetween(page, 'save-refused-write'), 'success was announced while the disk refused the text')
      .not.toContainEqual(expect.stringMatching(SUCCESS))
    await expect(saveState(page)).toHaveText('Unsaved')
    expect(read(created), 'nothing reached disk').toBe('')
    expect(captures()).toEqual([created])

    writes.write = 'pass'
    await addEntry(page, 'mark', 'save-accepted')
    await save(page)
    await expectSuccessOnlyAfterWrite(page, 'save-accepted', text)
    expect(await noticesBetween(page, 'save-refused-write', 'save-accepted'), 'success was announced while the disk refused the text')
      .not.toContainEqual(expect.stringMatching(SUCCESS))
    expect(read(created).trim()).toBe(text)
    await expect(saveState(page)).toHaveText('Saved')
    expect(captures(), 'one page in the end').toEqual([created])
    expect(read(HARBOR)).toBe(harborBefore)
  })
})
