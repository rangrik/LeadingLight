import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type Locator, type Page } from '@playwright/test'
import type { FolderNode } from '../../src/types'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { findCommand, openCommandPalette } from './helpers'

// Synthetic pages added to each disposable copy of the public fixture vault.
const PAGES = {
  'field-notes.md': '# Field notes\n\nCheck [[harbor/lantern]] before dusk.\n',
  'harbor/lantern.md': '# Lantern\n\nThe harbor lantern faces the breakwater.\n',
  'garden/lantern.md': '# Lantern\n\nThe garden lantern hangs from the pear tree. It copies [[harbor/lantern]].\n',
  'drafts/tide-table.md': '# Tide table\n\nLow water at the north jetty.\n',
  'drafts/ferry-schedule.md': '# Ferry schedule\n\nThe first ferry leaves at seven.\n',
}
const FOLDERS: FolderNode[] = ['drafts', 'garden', 'harbor'].map(name => ({ name, path: name, children: [] }))
// 23:30 on 15 Oct in Los Angeles is already 16 Oct in UTC, so only a local-date page passes.
const LATE_EVENING = new Date('2026-10-16T06:30:00Z')
const TODAY = 'Daily/2026-10-15.md'

let vault: string
const abs = (relative: string) => path.join(vault, relative)
const read = (relative: string) => fs.readFileSync(abs(relative), 'utf8')
const exists = (relative: string) => fs.existsSync(abs(relative))
const dailyFiles = () => (exists('Daily') ? fs.readdirSync(abs('Daily')).sort() : [])

const noteList = (page: Page) => page.getByTestId('note-list-container')
const noteRow = (page: Page, relative: string) => noteList(page).locator(`[role="option"][data-note-path="${abs(relative)}"]`)
const pane = (page: Page, n: 1 | 2) => page.getByRole('region', { name: `Page pane ${n}`, exact: true })
const panePaths = (page: Page) => page.getByRole('region', { name: /^Page pane \d$/ })
  .evaluateAll(sections => sections.map(section => section.getAttribute('data-note-path') ?? ''))
const saveState = (owner: Locator) => owner.getByRole('status').filter({ hasText: /^(Saved|Unsaved)$/ })
const todayButton = (page: Page) => page.getByTestId('sidebar-top-nav').getByRole('button', { name: 'Today', exact: true })
const trashButton = (page: Page) => page.getByTestId('sidebar-top-nav').getByRole('button', { name: 'Trash', exact: true })
const finder = (page: Page) => page.getByRole('dialog', { name: 'Find a page' })
const trashDialog = (page: Page) => page.getByRole('dialog', { name: 'Trash' })
const trashItem = (page: Page, title: string) => trashDialog(page).getByRole('listitem').filter({ hasText: title })
// A restore's outcome stays in the dialog, outside the list, with its own Open action.
const restoredStatus = (page: Page, text: string) => trashDialog(page).getByRole('status').filter({ hasText: text })
const openRestored = (page: Page) => trashDialog(page).getByRole('button', { name: 'Open', exact: true })
// The pane header's backlinks button; its name carries the count, zero included.
const backlinksControl = (owner: Locator) => owner.getByRole('button', { name: /^Backlinks \(\d+\)$/ })
const backlinksList = (owner: Locator) => owner.getByTestId('backlinks-list')

// Path of the page whose editor holds keyboard focus, or null when focus is elsewhere.
const focusedPagePath = (page: Page) => page.evaluate(() => {
  const active = document.activeElement
  if (!active?.closest('[contenteditable="true"]')) return null
  return active.closest('section[data-note-path]')?.getAttribute('data-note-path') ?? null
})

async function openVault(page: Page) {
  await openFixtureVault(page, vault, { isGitRepo: false, folders: FOLDERS })
}

// The fixture bridge clears renderer storage on every load, so anything found again came from disk.
async function reloadApp(page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(noteList(page).getByText('Alpha Project', { exact: true })).toBeVisible({ timeout: 30_000 })
}

async function openPage(page: Page, relative: string, n: 1 | 2 = 1) {
  await noteRow(page, relative).click()
  await expect(pane(page, n)).toHaveAttribute('data-note-path', abs(relative))
}

async function splitWith(page: Page, relative: string) {
  await page.getByRole('button', { name: 'Split right', exact: true }).click()
  await pane(page, 2).getByText('Open a page here').click()
  await openPage(page, relative, 2)
}

async function search(page: Page, query: string) {
  await page.getByTestId('sidebar-top-nav').getByRole('button', { name: 'Search', exact: true }).click()
  await finder(page).getByRole('combobox').fill(query)
}

async function closeSearch(page: Page) {
  await finder(page).getByRole('combobox').press('Escape')
  await expect(finder(page)).toBeHidden()
}

async function openTrash(page: Page) {
  await trashButton(page).click()
  await expect(trashDialog(page)).toBeVisible()
}

// Observation only: the content of every write the page sends for one file, in send order.
function recordWrites(page: Page, relative: string) {
  const target = abs(relative)
  const contents: string[] = []
  page.on('request', request => {
    if (request.method() !== 'POST' || !/\/api\/vault\/(save|create)$/.test(new URL(request.url()).pathname)) return
    let body: { path?: unknown, content?: unknown } | null = null
    try { body = request.postDataJSON() } catch { return }
    if (body?.path === target && typeof body.content === 'string') contents.push(body.content)
  })
  return contents
}

test.use({ viewport: { width: 1600, height: 1000 } })
test.describe.configure({ timeout: 45_000 })

test.beforeEach(() => {
  vault = createFixtureVaultCopy()
  for (const [relative, content] of Object.entries(PAGES)) {
    fs.mkdirSync(path.dirname(abs(relative)), { recursive: true })
    fs.writeFileSync(abs(relative), content)
  }
})

test.afterEach(() => {
  removeFixtureVaultCopy(vault)
})

test.describe('Today', () => {
  test.use({ timezoneId: 'America/Los_Angeles' })

  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: LATE_EVENING })
    await page.clock.resume()
    await openVault(page)
  })

  test('Today opens one local-date page ready to type and reuses it after repeat clicks and reload @smoke', async ({ page }) => {
    // An impatient double click still makes exactly one page.
    await todayButton(page).dblclick()
    await expect.poll(() => focusedPagePath(page)).toBe(abs(TODAY))
    expect(await panePaths(page)).toEqual([abs(TODAY)])
    expect(dailyFiles()).toEqual(['2026-10-15.md'])
    const [title] = read(TODAY).split('\n')
    expect(title).toMatch(/^# \S/)

    // Typing straight away goes into the body; the title line stays as created.
    await page.keyboard.type('Morning tide at the north jetty.')
    await expect.poll(() => read(TODAY)).toContain('Morning tide at the north jetty.')
    expect(read(TODAY).split('\n')[0]).toBe(title)
    await expect(saveState(pane(page, 1))).toHaveText('Saved')

    await todayButton(page).click()
    await expect.poll(() => focusedPagePath(page)).toBe(abs(TODAY))
    expect(await panePaths(page)).toEqual([abs(TODAY)])
    expect(read(TODAY)).toContain('Morning tide at the north jetty.')

    await reloadApp(page)
    await todayButton(page).click()
    await expect.poll(() => focusedPagePath(page)).toBe(abs(TODAY))
    await expect(pane(page, 1).getByText('Morning tide at the north jetty.')).toBeVisible()
    expect(dailyFiles()).toEqual(['2026-10-15.md'])
    expect(read(TODAY)).toContain('Morning tide at the north jetty.')
  })

  test('the Today shortcut opens the same page and types nothing into the page that had focus', async ({ page }) => {
    const alpha = 'project/alpha-project.md'
    const alphaBefore = read(alpha)
    await openPage(page, alpha)
    await pane(page, 1).getByText('This is a test project that references other notes.').click()

    await page.keyboard.press('ControlOrMeta+Shift+KeyD')
    await expect.poll(() => focusedPagePath(page)).toBe(abs(TODAY))
    await page.keyboard.press('ControlOrMeta+Shift+KeyD')
    await expect.poll(() => focusedPagePath(page)).toBe(abs(TODAY))

    expect(await panePaths(page)).toEqual([abs(TODAY)])
    expect(dailyFiles()).toEqual(['2026-10-15.md'])
    expect(read(alpha)).toBe(alphaBefore)
  })
})

test.describe('Backlinks', () => {
  test.beforeEach(async ({ page }) => { await openVault(page) })

  test('backlinks count qualified links exactly and open the exact source in the active pane', async ({ page }) => {
    await openPage(page, 'field-notes.md')
    await splitWith(page, 'harbor/lantern.md')
    const right = pane(page, 2)

    // Field notes and the garden Lantern link [[harbor/lantern]]; a page never counts itself.
    await expect(backlinksControl(right)).toHaveAccessibleName('Backlinks (2)')
    await backlinksControl(right).click()
    await expect(backlinksList(right).getByRole('button')).toHaveCount(2)

    // The source shares the open page's title; only that exact file may open, and only here.
    await backlinksList(right).getByRole('button', { name: /^Lantern/ }).click()
    await expect.poll(() => panePaths(page)).toEqual([abs('field-notes.md'), abs('garden/lantern.md')])
    // Same file name as the target, but [[harbor/lantern]] is qualified, so nothing links here.
    await expect(right.getByText('No other pages link here yet.')).toBeVisible()
    await expect(backlinksControl(right)).toHaveAccessibleName('Backlinks (0)')

    // A source already open in the other pane is reused there, not opened twice.
    await openPage(page, 'harbor/lantern.md', 2)
    await backlinksControl(right).click()
    await backlinksList(right).getByRole('button', { name: /^Field notes/ }).click()
    await expect(pane(page, 1)).toHaveAttribute('data-pane-active', 'true')
    expect(await panePaths(page)).toEqual([abs('field-notes.md'), abs('harbor/lantern.md')])
  })
})

test.describe('Trash', () => {
  test.beforeEach(async ({ page }) => { await openVault(page) })

  test('Move to Trash keeps fresh writing, removes only that page, and Restore returns the same bytes @smoke', async ({ page }) => {
    const tide = 'drafts/tide-table.md'
    const fieldBefore = read('field-notes.md')
    const tideWrites = recordWrites(page, tide)
    await openPage(page, 'field-notes.md')
    await splitWith(page, tide)
    const right = pane(page, 2)

    await right.getByText('Low water at the north jetty.').click()
    await page.keyboard.press('End')
    await page.keyboard.type(' Kelpwhistle checked twice.')
    await expect(saveState(right)).toHaveText('Unsaved')
    await right.getByRole('button', { name: 'More note actions' }).click()
    await page.getByRole('menuitem', { name: /^Move to Trash/ }).click()

    await expect(page.getByRole('status').filter({ hasText: 'Moved “Tide table” to Trash.' })).toBeVisible()
    await expect(noteRow(page, tide)).toHaveCount(0)
    await expect.poll(() => exists(tide)).toBe(false)
    // Only the moved page's slot empties; the split and the other page stay as they were.
    await expect.poll(() => panePaths(page)).toEqual([abs('field-notes.md'), ''])
    await expect(pane(page, 2).getByText('Open a page here')).toBeVisible()
    await expect(pane(page, 1).getByText('before dusk')).toBeVisible()
    const moved = tideWrites.at(-1) ?? ''
    expect(moved, 'the unsaved words reached disk before the page moved').toContain('Kelpwhistle checked twice.')

    await search(page, 'Kelpwhistle')
    await expect(finder(page).getByText(/No pages match/)).toBeVisible()
    await finder(page).getByRole('combobox').fill('north jetty')
    await expect(finder(page).getByText(/No pages match/)).toBeVisible()
    await closeSearch(page)

    await reloadApp(page)
    await expect(noteRow(page, tide)).toHaveCount(0)
    expect(exists(tide), 'no late write recreated the trashed page').toBe(false)

    await openTrash(page)
    const item = trashItem(page, 'Tide table')
    await expect(item).toContainText(`From ${tide}`)
    await item.getByRole('button', { name: /^Restore/ }).click()
    await expect(restoredStatus(page, `Restored to ${tide}.`)).toBeVisible()
    // Restored once: the item leaves the list, so it cannot be restored again.
    await expect(item).toHaveCount(0)
    await expect(openRestored(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(trashDialog(page)).toBeHidden()

    await expect.poll(() => exists(tide)).toBe(true)
    expect(read(tide)).toBe(moved)
    expect(exists('drafts/tide-table-2.md')).toBe(false)
    await expect(noteRow(page, tide)).toBeVisible()
    await search(page, 'Kelpwhistle')
    await expect(finder(page).getByRole('group', { name: 'In page text' }).getByRole('option', { name: /Tide table/ })).toBeVisible()
    await closeSearch(page)
    expect(read('field-notes.md')).toBe(fieldBefore)
  })

  test('Restore never replaces a newer page at the old path and shows where the safe copy went', async ({ page }) => {
    const ferry = 'drafts/ferry-schedule.md'
    const copy = 'drafts/ferry-schedule-2.md'
    await noteRow(page, ferry).click({ button: 'right' })
    await page.getByTestId('note-list-context-menu').getByRole('button', { name: /^Move to Trash/ }).click()
    await expect(noteRow(page, ferry)).toHaveCount(0)
    await expect.poll(() => exists(ferry)).toBe(false)

    // A different page now occupies the old path.
    const occupant = '# Ferry schedule\n\nA newer timetable written after the move.\n'
    fs.writeFileSync(abs(ferry), occupant)
    await reloadApp(page)

    await openTrash(page)
    const item = trashItem(page, 'Ferry schedule')
    await expect(item).toContainText(`From ${ferry}`)
    await item.getByRole('button', { name: /^Restore/ }).click()
    await expect(restoredStatus(page, `Restored as ${copy}`)).toBeVisible()
    await expect(item).toHaveCount(0)

    expect(read(ferry)).toBe(occupant)
    await expect.poll(() => exists(copy)).toBe(true)
    expect(read(copy)).toBe(PAGES[ferry])
    expect(exists('drafts/ferry-schedule-3.md')).toBe(false)
    // The dialog's Open shows the safe copy with its original text.
    await openRestored(page).click()
    await expect(trashDialog(page)).toBeHidden()
    await expect(pane(page, 1)).toHaveAttribute('data-note-path', abs(copy))
    await expect(pane(page, 1).getByText('The first ferry leaves at seven.')).toBeVisible()
    expect(read(ferry)).toBe(occupant)
  })

  test('folders offer no permanent delete action', async ({ page }) => {
    const folder = page.getByTestId('folder-row:drafts')
    await folder.click({ button: 'right' })
    const menu = page.getByTestId('folder-context-menu')
    // Rename proves the menu is the real folder menu; nothing in it may delete.
    await expect(menu.getByRole('button', { name: /^Rename folder/ })).toBeVisible()
    await expect(menu.getByRole('button', { name: /delete/i })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()

    await folder.click()
    await openCommandPalette(page)
    expect(await findCommand(page, 'Rename Folder')).toBe(true)
    expect(await findCommand(page, 'Delete Folder')).toBe(false)
  })
})
