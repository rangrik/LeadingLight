import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect, type Locator, type Page, type Request } from '@playwright/test'
import type { FolderNode } from '../../src/types'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'

// Ordinary capture files are named by the app, never by the user.
const CAPTURE = /^untitled-page-\d+(?:-\d+)?\.md$/
const FAVORITE_PAGES = {
  'harbor/lantern.md': '---\n_favorite: true\n_favorite_index: 1\n---\n# Lantern\n\nThe harbor lantern faces the breakwater.\n',
  'garden/lantern.md': '---\n_favorite: true\n_favorite_index: 2\n---\n# Lantern\n\nThe garden lantern hangs from the pear tree.\n',
  'drafts/tide-table.md': '# Tide table\n\nLow water at the north jetty.\n',
}
const FOLDERS: FolderNode[] = ['drafts', 'garden', 'harbor'].map(name => ({ name, path: name, children: [] }))

let vault: string
const abs = (relative: string) => path.join(vault, relative)
const read = (relative: string) => fs.readFileSync(abs(relative), 'utf8')
const captures = () => fs.readdirSync(vault).filter(name => CAPTURE.test(name))
const markdownFiles = () => fs.readdirSync(vault).filter(name => name.endsWith('.md'))

const noteList = (page: Page) => page.getByTestId('note-list-container')
const noteRow = (page: Page, relative: string) => noteList(page).locator(`[role="option"][data-note-path="${abs(relative)}"]`)
const pane = (page: Page, n: 1 | 2) => page.getByRole('region', { name: `Page pane ${n}`, exact: true })
// A modal dialog hides the panes from role queries, so behind it find the pane by its label.
const paneBehindDialog = (page: Page, n: 1 | 2) => page.locator(`section[aria-label="Page pane ${n}"]`)
const panePaths = (page: Page) => page.getByRole('region', { name: /^Page pane \d$/ })
  .evaluateAll(sections => sections.map(section => section.getAttribute('data-note-path') ?? ''))
// The pane's page picker shows the page's display label.
const paneLabel = (owner: Locator) => owner.getByRole('button', { name: 'Choose a page' })
// Text button only; the pane header's icon button has the same name and no text.
const emptyPaneNewPage = (owner: Locator) => owner.getByRole('button', { name: 'New page' }).filter({ hasText: 'New page' })
const sidebarNav = (page: Page) => page.getByTestId('sidebar-top-nav')
const sidebar = (page: Page) => page.locator('aside').first()
// The real row button, not dnd-kit's sortable wrapper around it.
const favoriteRow = (page: Page, label: RegExp, cue?: string) => {
  const rows = sidebar(page).locator('button').filter({ hasText: label })
  return cue ? rows.filter({ hasText: cue }) : rows
}
const finder = (page: Page) => page.getByRole('dialog', { name: 'Find a page' })
const finderPages = (page: Page) => finder(page).getByRole('group', { name: 'Pages', exact: true }).getByRole('option')

// Where keyboard input goes now: the focused page and the kind of block holding the caret.
const caret = (page: Page) => page.evaluate(() => {
  const active = document.activeElement
  if (!active?.closest('[contenteditable="true"]')) return null
  const anchor = window.getSelection()?.anchorNode ?? null
  const element = anchor instanceof Element ? anchor : anchor?.parentElement ?? null
  return {
    path: active.closest('section[data-note-path]')?.getAttribute('data-note-path') ?? null,
    block: element?.closest('.bn-block-content')?.getAttribute('data-content-type') ?? null,
  }
})
const focusedPagePath = async (page: Page) => (await caret(page))?.path ?? null

async function expectOneNewCapture(before: string[]): Promise<string> {
  await expect.poll(() => captures().filter(name => !before.includes(name))).toHaveLength(1)
  return captures().find(name => !before.includes(name))!
}

function seed(pages: Record<string, string>) {
  for (const [relative, content] of Object.entries(pages)) {
    fs.mkdirSync(path.dirname(abs(relative)), { recursive: true })
    fs.writeFileSync(abs(relative), content)
  }
}

// The fixture bridge clears renderer storage on every load, so anything shown again came from disk.
async function reloadApp(page: Page, ready: Locator) {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(ready).toBeVisible({ timeout: 30_000 })
}

// Both ways the fixture bridge sends a read: JSON POST first, then a GET with a query string.
function contentReadPath(request: Request): string | null {
  if (new URL(request.url()).pathname !== '/api/vault/content') return null
  const fromQuery = new URL(request.url()).searchParams.get('path')
  if (fromQuery !== null) return fromQuery
  try {
    const body = request.postDataJSON() as { path?: unknown } | null
    return typeof body?.path === 'string' ? body.path : null
  } catch {
    return null
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

test.use({ viewport: { width: 1600, height: 1000 } })
test.describe.configure({ timeout: 60_000 })

test.afterEach(() => {
  removeFixtureVaultCopy(vault)
})

test.describe('Capture in an empty workspace', () => {
  test.beforeEach(async ({ page }) => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), 'leadinglight-capture-'))
    await openFixtureVault(page, vault, { isGitRepo: false, expectedReadyTitle: 'Start with a thought.' })
  })

  test('New page and Cmd+N capture body text into untyped pages labelled by their saved text @smoke', async ({ page }) => {
    const first = 'Lantern oil smells faintly of pine.'
    const second = 'The ferry leaves at seven from the north jetty.'

    // An empty workspace leads with creation and creates nothing on its own.
    await expect(pane(page, 1).getByText('Create a page and begin writing.')).toBeVisible()
    await expect(pane(page, 1).getByRole('button', { name: /^Resume/ })).toHaveCount(0)
    expect(markdownFiles()).toEqual([])

    // Mouse: one blank untyped file, caret in body text, nothing asked first.
    await emptyPaneNewPage(pane(page, 1)).click()
    const one = await expectOneNewCapture([])
    expect(read(one)).toBe('')
    await expect.poll(() => caret(page)).toEqual({ path: abs(one), block: 'paragraph' })
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(paneLabel(pane(page, 1))).toHaveText('Untitled')

    // Keyboard straight after typing: the first words reach disk before the next page opens.
    await page.keyboard.type(first)
    await page.keyboard.press('ControlOrMeta+KeyN')
    const two = await expectOneNewCapture([one])
    await expect.poll(() => caret(page)).toEqual({ path: abs(two), block: 'paragraph' })
    expect(read(two)).toBe('')
    await expect.poll(() => read(one).trim()).toBe(first)

    // Body text never becomes a stored title; the label is the last saved text.
    await page.keyboard.type(second)
    await expect.poll(() => read(two).trim()).toBe(second)
    await expect(paneLabel(pane(page, 1))).toHaveText(second)
    await expect(paneLabel(pane(page, 1))).not.toContainText('untitled-page')
    await expect(noteRow(page, one)).toContainText(first)
    await expect(noteRow(page, one)).not.toContainText('untitled-page')

    await sidebarNav(page).getByRole('button', { name: 'New page', exact: true }).click()
    const three = await expectOneNewCapture([one, two])
    await expect.poll(() => caret(page)).toEqual({ path: abs(three), block: 'paragraph' })
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await reloadApp(page, noteRow(page, one))
    expect(captures().sort()).toEqual([one, two, three].sort())
    expect(read(one).trim()).toBe(first)
    expect(read(two).trim()).toBe(second)
    expect(read(three)).toBe('')
    await expect(noteRow(page, one)).toContainText(first)
    await expect(noteRow(page, two)).toContainText(second)
    await expect(noteRow(page, three)).toContainText('Untitled')
    for (const name of [one, two, three]) await expect(noteRow(page, name)).not.toContainText('untitled-page')
  })
})

test.describe('Favorites and duplicate pages', () => {
  test.beforeEach(async ({ page }) => {
    vault = createFixtureVaultCopy()
    seed(FAVORITE_PAGES)
    await openFixtureVault(page, vault, { isGitRepo: false, folders: FOLDERS })
  })

  test('a Favorite opens its exact page, keeps the list filter and reuses an open page @smoke', async ({ page }) => {
    const harbor = abs('harbor/lantern.md')
    const garden = abs('garden/lantern.md')
    const marker = ' A repeated click keeps this.'

    // A non-default list: only the drafts folder.
    await page.getByTestId('folder-row:drafts').click()
    await expect(noteRow(page, 'drafts/tide-table.md')).toBeVisible()
    const listUnchanged = async () => {
      await expect(noteRow(page, 'drafts/tide-table.md')).toBeVisible()
      await expect(noteRow(page, 'harbor/lantern.md')).toHaveCount(0)
      await expect(noteRow(page, 'project/alpha-project.md')).toHaveCount(0)
    }

    // Same titles, told apart by their folder path.
    await expect(favoriteRow(page, /^Lantern/)).toHaveCount(2)
    await expect(favoriteRow(page, /^Lantern/, 'harbor/lantern')).toHaveCount(1)
    await expect(favoriteRow(page, /^Lantern/, 'garden/lantern')).toHaveCount(1)

    await favoriteRow(page, /^Lantern/, 'harbor/lantern').click()
    await expect.poll(() => panePaths(page)).toEqual([harbor])
    await expect.poll(() => focusedPagePath(page)).toBe(harbor)
    await expect(favoriteRow(page, /^Lantern/, 'harbor/lantern')).toHaveAttribute('aria-current', 'page')
    await listUnchanged()

    // Clicking it again while words are unsaved neither reloads the page nor loses them.
    await pane(page, 1).getByText('The harbor lantern faces the breakwater.').click()
    await page.keyboard.press('End')
    await page.keyboard.type(marker)
    await favoriteRow(page, /^Lantern/, 'harbor/lantern').click()
    await expect(pane(page, 1).getByText(`The harbor lantern faces the breakwater.${marker}`)).toBeVisible()
    await expect.poll(() => focusedPagePath(page)).toBe(harbor)
    expect(await panePaths(page)).toEqual([harbor])
    await listUnchanged()
    await expect.poll(() => read('harbor/lantern.md')).toContain(marker.trim())

    // The other Lantern opens in the active pane; clicking it again reveals that pane.
    await page.getByRole('button', { name: 'Split right', exact: true }).click()
    await favoriteRow(page, /^Lantern/, 'garden/lantern').click()
    await expect.poll(() => panePaths(page)).toEqual([harbor, garden])
    await pane(page, 1).getByText('The harbor lantern faces the breakwater.').click()
    await expect(pane(page, 1)).toHaveAttribute('data-pane-active', 'true')
    await favoriteRow(page, /^Lantern/, 'garden/lantern').click()
    await expect(pane(page, 2)).toHaveAttribute('data-pane-active', 'true')
    await expect.poll(() => focusedPagePath(page)).toBe(garden)
    expect(await panePaths(page)).toEqual([harbor, garden])
    await expect(page.locator('section[data-note-path] [contenteditable="true"]')).toHaveCount(2)
    await listUnchanged()
  })

  test('Search shows a path cue for duplicate titles and finds a page by its relative path', async ({ page }) => {
    const searchFor = async (query: string) => {
      if (!await finder(page).isVisible()) {
        await sidebarNav(page).getByRole('button', { name: 'Search', exact: true }).click()
      }
      await finder(page).getByRole('combobox').fill(query)
    }

    await searchFor('Lantern')
    const lanterns = finderPages(page).filter({ hasText: /^Lantern/ })
    await expect(lanterns).toHaveCount(2)
    await expect(lanterns.filter({ hasText: 'harbor/lantern' })).toHaveCount(1)
    await expect(lanterns.filter({ hasText: 'garden/lantern' })).toHaveCount(1)
    // A unique title needs no cue.
    await searchFor('Tide table')
    await expect(finderPages(page).filter({ hasText: /^Tide table/ })).toHaveCount(1)
    await expect(finderPages(page).filter({ hasText: 'drafts/tide-table' })).toHaveCount(0)

    for (const query of ['harbor/lantern.md', 'harbor/lantern', './Harbor/Lantern.md']) {
      await searchFor(query)
      await expect(finderPages(page)).toHaveCount(1)
      await expect(finderPages(page)).toContainText('harbor/lantern')
    }
    await finderPages(page).click()
    await expect(finder(page)).toBeHidden()
    await expect.poll(() => panePaths(page)).toEqual([abs('harbor/lantern.md')])
  })

  test('an empty pane offers Resume with real recent pages, and Escape returns to it', async ({ page }) => {
    const noteB = abs('note/note-b.md')

    await noteRow(page, 'note/note-b.md').click()
    await expect.poll(() => panePaths(page)).toEqual([noteB])
    await page.getByRole('button', { name: 'Split right', exact: true }).click()
    const resume = pane(page, 2).getByRole('button', { name: /^Resume/ })
    await expect(pane(page, 2).getByText('Open a page here')).toBeVisible()
    await expect(emptyPaneNewPage(pane(page, 2))).toBeVisible()

    await resume.click()
    await expect(finder(page)).toBeVisible()
    await expect(paneBehindDialog(page, 2)).toHaveAttribute('data-pane-active', 'true')
    await expect(finder(page).getByRole('group', { name: 'Recent', exact: true }).getByRole('option'))
      .toContainText(['Note B'])
    await page.keyboard.press('Escape')
    await expect(finder(page)).toBeHidden()
    await expect(resume).toBeFocused()
    await expect(pane(page, 2)).toHaveAttribute('data-pane-active', 'true')

    await resume.click()
    await finder(page).getByRole('combobox').fill('Alpha')
    await finderPages(page).filter({ hasText: /^Alpha Project/ }).click()
    await expect.poll(() => panePaths(page)).toEqual([noteB, abs('project/alpha-project.md')])
  })
})

test.describe('A Favorite that loads late', () => {
  // Every read of the garden page waits for this; released after each test, pass or fail.
  let gardenReads = 0
  let releaseGarden = deferred()

  test.beforeEach(async ({ page }) => {
    vault = createFixtureVaultCopy()
    seed(FAVORITE_PAGES)
    gardenReads = 0
    releaseGarden = deferred()
    const garden = abs('garden/lantern.md')
    // Installed before the vault opens: the list preloads pages near the selection, so a later
    // gate would find the page already cached and never see its read.
    await page.route('**/api/vault/content*', async route => {
      if (contentReadPath(route.request()) !== garden) return route.continue()
      gardenReads += 1
      await releaseGarden.promise
      await route.continue().catch(() => undefined)
    })
    await openFixtureVault(page, vault, { isGitRepo: false, folders: FOLDERS })
  })

  test.afterEach(() => {
    releaseGarden.resolve()
  })

  test('a Favorite that finishes loading late does not take focus from the pane chosen meanwhile', async ({ page }) => {
    const tide = abs('drafts/tide-table.md')
    const harbor = abs('harbor/lantern.md')
    const garden = abs('garden/lantern.md')
    const tideBefore = read('drafts/tide-table.md')
    const gardenBefore = read('garden/lantern.md')

    await noteRow(page, 'drafts/tide-table.md').click()
    await expect.poll(() => panePaths(page)).toEqual([tide])
    await page.getByRole('button', { name: 'Split right', exact: true }).click()
    await favoriteRow(page, /^Lantern/, 'harbor/lantern').click()
    await expect.poll(() => panePaths(page)).toEqual([tide, harbor])
    await pane(page, 1).getByText('Low water at the north jetty.').click()
    await expect(pane(page, 1)).toHaveAttribute('data-pane-active', 'true')

    // The garden page cannot load until released; the user moves to the other pane meanwhile.
    await favoriteRow(page, /^Lantern/, 'garden/lantern').click()
    await expect.poll(() => gardenReads, { message: 'the garden page was never read from disk' }).toBeGreaterThan(0)
    await pane(page, 2).getByText('The harbor lantern faces the breakwater.').click()
    await expect.poll(() => focusedPagePath(page)).toBe(harbor)
    // Still loading: the requested pane has not changed yet.
    expect(await panePaths(page)).toEqual([tide, harbor])
    releaseGarden.resolve()

    // The late page lands where it was requested; the user's pane keeps the caret.
    await expect.poll(() => panePaths(page)).toEqual([garden, harbor])
    await expect(pane(page, 2)).toHaveAttribute('data-pane-active', 'true')
    await expect.poll(() => focusedPagePath(page)).toBe(harbor)
    await page.keyboard.press('End')
    await page.keyboard.type(' Typed after the late load.')
    await expect.poll(() => read('harbor/lantern.md')).toContain('Typed after the late load.')
    expect(read('garden/lantern.md')).toBe(gardenBefore)
    expect(read('drafts/tide-table.md')).toBe(tideBefore)
  })
})

test.describe('First Favorite', () => {
  test.beforeEach(async ({ page }) => {
    vault = createFixtureVaultCopy()
    await openFixtureVault(page, vault, { isGitRepo: false })
  })

  test('starring the first page replaces the quiet hint and survives a reload', async ({ page }) => {
    const hint = sidebar(page).getByText('Star a page to keep it here.')
    const before = read('note/note-b.md')

    await expect(hint).toHaveCount(0)
    await noteRow(page, 'note/note-b.md').click()
    await expect(hint).toBeVisible()
    await pane(page, 1).getByRole('button', { name: 'Add to favorites' }).click()

    await expect(favoriteRow(page, /^Note B/)).toHaveAttribute('aria-current', 'page')
    await expect(hint).toHaveCount(0)
    const frontmatter = () => read('note/note-b.md').match(/^---\n([\s\S]*?)\n---\n/)?.[1].split('\n') ?? []
    await expect.poll(frontmatter).toContain('_favorite: true')
    // Only the two keys change: other properties and the body stay as they were.
    expect(frontmatter().filter(line => /^_favorite_index: \d+$/.test(line))).toHaveLength(1)
    expect(frontmatter()).toEqual(expect.arrayContaining(['Is A: Note', 'Status: Active']))
    const after = read('note/note-b.md')
    expect(after.slice(after.indexOf('# Note B'))).toBe(before.slice(before.indexOf('# Note B')))

    await reloadApp(page, noteRow(page, 'note/note-b.md'))
    await expect(favoriteRow(page, /^Note B/)).toBeVisible()
    await expect(hint).toHaveCount(0)
    await favoriteRow(page, /^Note B/).click()
    await expect.poll(() => panePaths(page)).toEqual([abs('note/note-b.md')])
    await expect(pane(page, 1).getByRole('button', { name: 'Remove from favorites' })).toBeVisible()
  })
})
