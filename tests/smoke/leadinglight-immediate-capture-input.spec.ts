import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type Page, type Request } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVault,
  openFixtureVaultDesktopHarness,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'

// Typing that starts right after a deliberate "write here" command must reach that page in full,
// never the page that had the keyboard before. Nothing waits between the command and the typing.

const CAPTURE = /^untitled-page-\d+(?:-\d+)?\.md$/
const HARBOR = 'harbor/lantern.md'
const HARBOR_SENTENCE = 'The harbor lantern faces the breakwater.'
// 23:30 on 15 Oct in Los Angeles is already 16 Oct in UTC, so only the local-date page is Today.
const LATE_EVENING = new Date('2026-10-16T06:30:00Z')
const TODAY = 'Daily/2026-10-15.md'

let vault: string
const abs = (relative: string) => path.join(vault, relative)
const read = (relative: string) => fs.readFileSync(abs(relative), 'utf8')
const exists = (relative: string) => fs.existsSync(abs(relative))
const captures = () => fs.readdirSync(vault).filter(name => CAPTURE.test(name)).sort()
const dailyFiles = () => (exists('Daily') ? fs.readdirSync(abs('Daily')).sort() : [])

const sidebarNav = (page: Page) => page.getByTestId('sidebar-top-nav')
const pane = (page: Page, n: 1 | 2) => page.getByRole('region', { name: `Page pane ${n}`, exact: true })
const panePaths = (page: Page) => page.getByRole('region', { name: /^Page pane \d$/ })
  .evaluateAll(sections => sections.map(section => section.getAttribute('data-note-path') ?? ''))
const finder = (page: Page) => page.getByRole('dialog', { name: 'Find a page' })

// Path of the page whose editor holds keyboard focus, or null when focus is elsewhere.
const focusedPagePath = (page: Page) => page.evaluate(() => {
  const active = document.activeElement
  if (!active?.closest('[contenteditable="true"]')) return null
  return active.closest('section[data-note-path]')?.getAttribute('data-note-path') ?? null
})

async function openVaultWithHarbor(page: Page) {
  vault = createFixtureVaultCopy()
  fs.mkdirSync(abs('harbor'), { recursive: true })
  fs.writeFileSync(abs(HARBOR), `# Lantern\n\n${HARBOR_SENTENCE}\n`)
  await openFixtureVault(page, vault, { isGitRepo: false })
}

// Opened through the finder into the active pane, so list order and virtual rows do not matter.
async function openHarbor(page: Page, n: 1 | 2) {
  await sidebarNav(page).getByRole('button', { name: 'Search', exact: true }).click()
  await finder(page).getByRole('combobox').fill('Lantern')
  await finder(page).getByRole('group', { name: 'Pages', exact: true }).getByRole('option')
    .filter({ hasText: /^Lantern/ }).click()
  await expect(finder(page)).toBeHidden()
  await expect(pane(page, n)).toHaveAttribute('data-note-path', abs(HARBOR))
}

// The deterministic starting point: the harbor page's editor holds the keyboard.
async function focusHarbor(page: Page, n: 1 | 2) {
  await pane(page, n).getByText(HARBOR_SENTENCE).click()
  await expect.poll(() => focusedPagePath(page)).toBe(abs(HARBOR))
}

async function expectWholeTextInOneNewCapture(page: Page, text: string, harborBefore: string) {
  // On failure this shows what every new page holds, so a lost prefix or an extra page is visible.
  await expect.poll(() => captures().map(name => read(name).trim()), {
    message: 'no new page holds the whole typed text',
    timeout: 10_000,
  }).toContain(text)
  expect(captures(), 'typed spaces must not create more pages').toHaveLength(1)
  const [created] = captures()
  await expect(pane(page, 1)).toHaveAttribute('data-note-path', abs(created))
  await expect(pane(page, 1).locator('.bn-editor')).toContainText(text)
  expect(read(HARBOR)).toBe(harborBefore)
}

test.use({ viewport: { width: 1600, height: 1000 } })
test.describe.configure({ timeout: 60_000 })

test.afterEach(() => {
  removeFixtureVaultCopy(vault)
})

test.describe('New page', () => {
  test.beforeEach(async ({ page }) => {
    await openVaultWithHarbor(page)
    await openHarbor(page, 1)
    await focusHarbor(page, 1)
    expect(captures()).toEqual([])
  })

  test('Cmd+N followed at once by typing keeps every word in the new page', async ({ page }) => {
    const text = 'A second thought, captured with the keyboard.'
    const harborBefore = read(HARBOR)

    await page.keyboard.press('ControlOrMeta+KeyN')
    await page.keyboard.type(text)

    await expectWholeTextInOneNewCapture(page, text, harborBefore)
  })

  test('a New page click followed at once by typing keeps every word in one new page', async ({ page }) => {
    const text = 'Mouse capture should keep every word.'
    const harborBefore = read(HARBOR)

    await sidebarNav(page).getByRole('button', { name: 'New page', exact: true }).click()
    await page.keyboard.type(text)

    await expectWholeTextInOneNewCapture(page, text, harborBefore)
  })
})

test.describe('Today in the other pane', () => {
  test.use({ timezoneId: 'America/Los_Angeles' })

  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: LATE_EVENING })
    await page.clock.resume()
    await openVaultWithHarbor(page)
    // Today in pane one, the harbor page in pane two, and the keyboard in the harbor page.
    await sidebarNav(page).getByRole('button', { name: 'Today', exact: true }).click()
    await expect.poll(() => panePaths(page)).toEqual([abs(TODAY)])
    await expect.poll(() => exists(TODAY)).toBe(true)
    await page.getByRole('button', { name: 'Split right', exact: true }).click()
    await pane(page, 2).getByText('Open a page here').click()
    await openHarbor(page, 2)
    await focusHarbor(page, 2)
    expect(await panePaths(page)).toEqual([abs(TODAY), abs(HARBOR)])
  })

  test('the Today shortcut followed at once by typing puts every word in Today', async ({ page }) => {
    const text = 'Today owns this keyboard sentence.'
    const harborBefore = read(HARBOR)
    const [titleLine] = read(TODAY).split('\n')

    await page.keyboard.press('ControlOrMeta+Shift+KeyD')
    await page.keyboard.type(text)

    // The whole sentence is Today's body, after its unchanged title line.
    const body = () => read(TODAY).split('\n').slice(1).join('\n').trim()
    await expect.poll(body, { timeout: 10_000 }).toBe(text)
    expect(read(TODAY).split('\n')[0]).toBe(titleLine)
    await expect(pane(page, 1).locator('.bn-editor')).toContainText(text)
    expect(read(HARBOR)).toBe(harborBefore)
    expect(await panePaths(page)).toEqual([abs(TODAY), abs(HARBOR)])
    expect(dailyFiles()).toEqual(['2026-10-15.md'])
  })
})

// Pending capture: the New page file is slow, or fails, to be created. The desktop harness creates
// a page with one save of a file that does not exist yet, so only that request is held or failed.

const NOTE_B = 'note/note-b.md'
const NOTE_B_SENTENCE = 'This is Note B, referenced by Alpha Project.'
const draftField = (page: Page) => page.getByRole('textbox', { name: 'Your draft' })
const rawContent = (page: Page) => pane(page, 1).getByTestId('raw-editor-codemirror').locator('.cm-content')

interface CreateGate {
  mode: 'hold' | 'fail' | 'pass'
  held: string | null
  failed: string[]
  /** During the test: the held create continues to the real backend. */
  release: () => void
  /** Cleanup: a still-held create is aborted, and every gate handler has finished on return. */
  dispose: () => Promise<void>
}

let activeCreateGate: CreateGate | null = null

function savedPath(request: Request): string {
  try {
    const body = request.postDataJSON() as { path?: unknown } | null
    return typeof body?.path === 'string' ? body.path : ''
  } catch {
    return ''
  }
}

// Installed before the action. "hold" keeps the first create until release; "fail" refuses every
// create until the mode changes. Other saves pass untouched.
async function gateCreates(page: Page, mode: 'hold' | 'fail'): Promise<CreateGate> {
  // The first decision wins: a live release continues, so a later dispose only waits.
  let decide: (decision: 'continue' | 'abort') => void = () => {}
  const decision = new Promise<'continue' | 'abort'>((resolve) => { decide = resolve })
  const gate: CreateGate = {
    mode,
    held: null,
    failed: [],
    release: () => decide('continue'),
    dispose: async () => {
      decide('abort')
      await page.unrouteAll({ behavior: 'wait' })
    },
  }
  await page.route('**/api/vault/save', async (route) => {
    const target = savedPath(route.request())
    if (!CAPTURE.test(path.basename(target)) || fs.existsSync(target)) return route.continue()
    if (gate.mode === 'fail') {
      gate.failed.push(target)
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'The disk refused the write.' }) })
    }
    if (gate.mode === 'hold' && gate.held === null) {
      gate.held = target
      if ((await decision) === 'abort') return route.abort()
      return route.continue()
    }
    return route.continue()
  })
  activeCreateGate = gate
  return gate
}

async function typeLines(page: Page, lines: string[]) {
  for (const [index, line] of lines.entries()) {
    if (index > 0) await page.keyboard.press('Enter')
    await page.keyboard.type(line)
  }
}

test.describe('New page while its file is slow or fails to be created', () => {
  test.beforeEach(async ({ page }) => {
    vault = createFixtureVaultCopy()
    fs.mkdirSync(abs('harbor'), { recursive: true })
    fs.writeFileSync(abs(HARBOR), `# Lantern\n\n${HARBOR_SENTENCE}\n`)
    await openFixtureVaultDesktopHarness(page, vault, { isGitRepo: false })
    await openHarbor(page, 1)
    await focusHarbor(page, 1)
    expect(captures()).toEqual([])
  })

  // Inner afterEach hooks finish before the file-level one deletes the vault.
  test.afterEach(async () => {
    await activeCreateGate?.dispose()
    activeCreateGate = null
  })

  test('a slow New page keeps multiline Unicode text visible and delivers it once', async ({ page }) => {
    const lines = ['Harbor fog at dawn — café crème.', 'Ålesund 港 ✓ naïve résumé.']
    const tail = ' Then the ferry left.'
    const harborBefore = read(HARBOR)
    const gate = await gateCreates(page, 'hold')

    await sidebarNav(page).getByRole('button', { name: 'New page', exact: true }).click()
    await typeLines(page, lines)

    await expect.poll(() => gate.held, { message: 'the new page was never created through the bridge' }).not.toBeNull()
    await expect(draftField(page)).toHaveValue(lines.join('\n'))
    await expect(page.getByText('Opening page…', { exact: true })).toBeVisible()
    expect(captures(), 'nothing is on disk while the create waits').toEqual([])
    expect(read(HARBOR)).toBe(harborBefore)
    gate.release()

    const created = path.basename(gate.held ?? '')
    await expect(draftField(page)).toHaveCount(0)
    await expect(pane(page, 1)).toHaveAttribute('data-note-path', abs(created))
    await expect(pane(page, 1).locator('.bn-editor')).toContainText(lines[1])
    // Later typing continues right after the delivered text.
    await expect.poll(() => focusedPagePath(page)).toBe(abs(created))
    await page.keyboard.type(tail)
    await expect.poll(() => read(created).trim(), { timeout: 10_000 }).toBe(`${lines[0]}\n\n${lines[1]}${tail}`)
    expect(captures(), 'delivered once into one page').toEqual([created])
    expect(read(HARBOR)).toBe(harborBefore)
  })

  test('a failed New page keeps the whole draft without a file, then Try again creates one usable page', async ({ page }) => {
    const lines = ['Notes from the breakwater — ünïcödé ✓.', 'The second line stays too.']
    const tail = ' Typed after Try again.'
    const harborBefore = read(HARBOR)
    const gate = await gateCreates(page, 'fail')

    await sidebarNav(page).getByRole('button', { name: 'New page', exact: true }).click()
    await typeLines(page, lines)

    await expect.poll(() => gate.failed.length, { message: 'the create never reached the bridge' }).toBeGreaterThan(0)
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Discard draft', exact: true })).toBeVisible()
    await expect(draftField(page)).toHaveValue(lines.join('\n'))
    expect(captures(), 'a failed create leaves no file').toEqual([])
    for (const failed of gate.failed) expect(fs.existsSync(failed)).toBe(false)
    // No pane shows, and so labels Saved, a page that has no file.
    expect((await panePaths(page)).filter(shown => CAPTURE.test(path.basename(shown)))).toEqual([])
    expect(read(HARBOR)).toBe(harborBefore)

    gate.mode = 'pass'
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(draftField(page)).toHaveCount(0)
    await expect.poll(() => captures().length).toBe(1)
    const [created] = captures()
    expect(gate.failed).not.toContain(abs(created))
    await expect(pane(page, 1)).toHaveAttribute('data-note-path', abs(created))
    await expect.poll(() => focusedPagePath(page)).toBe(abs(created))
    await page.keyboard.type(tail)
    await expect.poll(() => read(created).trim(), { timeout: 10_000 }).toBe(`${lines[0]}\n\n${lines[1]}${tail}`)
    expect(captures(), 'Try again made exactly one page').toEqual([created])
    expect(read(HARBOR)).toBe(harborBefore)
  })

  test('leaving for another page while New page is still opening keeps the draft and never delivers it', async ({ page }) => {
    const text = 'Kept while I looked at another page.'
    const marker = 'Typed in Note B after leaving.'
    const harborBefore = read(HARBOR)
    const noteBBefore = read(NOTE_B)
    const gate = await gateCreates(page, 'hold')

    await sidebarNav(page).getByRole('button', { name: 'New page', exact: true }).click()
    await page.keyboard.type(text)
    await expect.poll(() => gate.held, { message: 'the new page was never created through the bridge' }).not.toBeNull()
    await expect(draftField(page)).toHaveValue(text)

    // The person deliberately opens another page before the new one is ready.
    await page.getByTestId('note-list-container').locator(`[role="option"][data-note-path="${abs(NOTE_B)}"]`).click()
    await expect(pane(page, 1)).toHaveAttribute('data-note-path', abs(NOTE_B))
    gate.release()
    await expect.poll(() => fs.existsSync(gate.held ?? ''), { message: 'the held create never completed' }).toBe(true)

    // They keep writing where they went; that save also gives any stale delivery time to show.
    await pane(page, 1).getByText(NOTE_B_SENTENCE).click()
    await expect.poll(() => focusedPagePath(page)).toBe(abs(NOTE_B))
    await page.keyboard.type(` ${marker}`)
    await expect.poll(() => read(NOTE_B), { timeout: 10_000 }).toContain(marker)

    await expect(draftField(page)).toHaveValue(text)
    await expect(pane(page, 1)).toHaveAttribute('data-note-path', abs(NOTE_B))
    expect(read(NOTE_B)).not.toContain(text)
    expect(read(NOTE_B).replace(` ${marker}`, '')).toBe(noteBBefore)
    expect(fs.readFileSync(gate.held ?? '', 'utf8')).not.toContain(text)
    expect(read(HARBOR)).toBe(harborBefore)
  })

  test('with the raw editor chosen, a slow New page delivers multiline Unicode into its raw text once', async ({ page }) => {
    const lines = ['Raw notes at dawn — café crème.', 'Ålesund 港 ✓ naïve résumé.']
    const tail = ' Then the tide turned.'
    // The raw choice is a saved preference, so the new page should open in the raw editor too.
    await pane(page, 1).getByRole('button', { name: 'Open the raw editor', exact: true }).click()
    await expect(rawContent(page)).toContainText(HARBOR_SENTENCE)
    await rawContent(page).click()
    await expect(rawContent(page)).toBeFocused()
    const harborBefore = read(HARBOR)
    const gate = await gateCreates(page, 'hold')

    await sidebarNav(page).getByRole('button', { name: 'New page', exact: true }).click()
    await typeLines(page, lines)

    await expect.poll(() => gate.held, { message: 'the new page was never created through the bridge' }).not.toBeNull()
    await expect(draftField(page)).toHaveValue(lines.join('\n'))
    expect(captures(), 'nothing is on disk while the create waits').toEqual([])
    expect(read(HARBOR)).toBe(harborBefore)
    gate.release()

    const created = path.basename(gate.held ?? '')
    await expect(draftField(page)).toHaveCount(0)
    await expect(pane(page, 1)).toHaveAttribute('data-note-path', abs(created))
    await expect(pane(page, 1).getByRole('button', { name: 'Return to the editor', exact: true })).toBeVisible()
    await expect(rawContent(page)).toContainText(lines[0])
    await expect(rawContent(page)).toContainText(lines[1])
    await expect(rawContent(page)).toBeFocused()
    await page.keyboard.type(tail)
    // Raw Markdown keeps the typed line break exactly; it does not become a paragraph gap.
    await expect.poll(() => read(created).trim(), { timeout: 10_000 }).toBe(`${lines.join('\n')}${tail}`)
    expect(captures(), 'delivered once into one page').toEqual([created])
    expect(read(HARBOR)).toBe(harborBefore)
  })

  test('Save while New page is still opening keeps the draft, then the page gets the text once', async ({ page }) => {
    const text = 'Saved before the page opened — ✓ ü.'
    const tail = ' Typed after Save.'
    const harborBefore = read(HARBOR)
    const gate = await gateCreates(page, 'hold')

    await sidebarNav(page).getByRole('button', { name: 'New page', exact: true }).click()
    await page.keyboard.type(text)
    await expect.poll(() => gate.held, { message: 'the new page was never created through the bridge' }).not.toBeNull()
    await expect(draftField(page)).toBeFocused()
    await page.keyboard.press('ControlOrMeta+KeyS')

    // The page has no file yet, so Save must not drop the draft or call it saved.
    await expect(draftField(page)).toHaveValue(text)
    await expect(page.getByText('Opening page…', { exact: true })).toBeVisible()
    expect(captures(), 'nothing is on disk while the create waits').toEqual([])
    expect((await panePaths(page)).filter(shown => CAPTURE.test(path.basename(shown)))).toEqual([])
    expect(read(HARBOR)).toBe(harborBefore)
    await expect(page.getByText('Nothing to save', { exact: true })).toHaveCount(0)
    gate.release()

    const created = path.basename(gate.held ?? '')
    await expect(draftField(page)).toHaveCount(0)
    await expect(pane(page, 1)).toHaveAttribute('data-note-path', abs(created))
    await expect.poll(() => read(created).trim(), { timeout: 10_000 }).toBe(text)
    await expect.poll(() => focusedPagePath(page)).toBe(abs(created))
    await page.keyboard.type(tail)
    await expect.poll(() => read(created).trim(), { timeout: 10_000 }).toBe(`${text}${tail}`)
    await expect(pane(page, 1).getByRole('status').filter({ hasText: /^(Saved|Unsaved)$/ })).toHaveText('Saved', { timeout: 10_000 })
    expect(captures(), 'delivered once into one page').toEqual([created])
    expect(read(HARBOR)).toBe(harborBefore)
  })
})
