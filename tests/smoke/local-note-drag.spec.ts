import fs from 'node:fs'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { parse } from 'yaml'
import { LocalTemplatesFixture } from './localTemplatesFixture'

let fixture: LocalTemplatesFixture
const panes = (page: Page) => page.locator('.ll-pane')
const row = (page: Page, relative: string) => page.locator(`[role="option"][data-note-path="${fixture.file(relative)}"]`)
const paths = (page: Page) => panes(page).evaluateAll(elements => elements.map(element => element.getAttribute('data-note-path')))
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/
// Metadata by meaning, not by the writer's quoting style.
function frontmatter(text: string): Record<string, unknown> {
  const data: unknown = parse(FRONTMATTER.exec(text)?.[1] ?? '')
  return data && typeof data === 'object' ? data as Record<string, unknown> : {}
}
const body = (text: string) => text.replace(FRONTMATTER, '').trim()
// Writes at the end of a paragraph chosen by its text, never an empty trailing one.
async function appendTo(page: Page, pane: Locator, existing: string, words: string) {
  await pane.locator('.bn-editor p', { hasText: existing }).click()
  await page.keyboard.press('End')
  await page.keyboard.type(words)
}

async function point(locator: Locator, across = 0.5) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('Gesture target has no visible bounds')
  return { x: box.x + box.width * across, y: box.y + box.height / 2 }
}
async function begin(page: Page, source: Locator, destination: { x: number; y: number }) {
  const start = await point(source)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 8, start.y, { steps: 3 })
  await page.mouse.move(destination.x, destination.y, { steps: 16 })
}
async function edge(page: Page, relative: string, side: 'left' | 'right' | 'top' | 'bottom') {
  const area = await page.locator('.ll-panes').boundingBox()
  if (!area) throw new Error('Page area absent')
  await begin(page, row(page, relative), {
    x: side === 'left' ? area.x + 16 : side === 'right' ? area.x + area.width - 16 : area.x + area.width / 2,
    y: side === 'top' ? area.y + 16 : side === 'bottom' ? area.y + area.height - 16 : area.y + area.height / 2,
  })
  await expect(page.locator(`.ll-drop-zone[data-edge="${side}"][data-active="true"]`)).toBeVisible()
  await expect(page.locator('.ll-drag-chip')).toHaveText(/Garden note|Harbor note|Cedar note/)
}
async function release(page: Page) {
  await page.mouse.up()
  await expect(page.locator('.ll-drop-overlay')).toHaveCount(0)
  await expect(page.locator('.ll-drag-chip')).toHaveCount(0)
}

test.use({ viewport: { width: 1600, height: 1000 } })
test.describe.configure({ timeout: 60_000, retries: 0 })
test.beforeEach(async ({ page }) => {
  fixture = new LocalTemplatesFixture(page, false)
  fixture.write('cedar-note.md', '# Cedar note\n\nCedar branches shade the path.\n')
  fixture.write('journal-type.md', '---\ntype: Type\ntitle: Journal\n---\n# Journal\n')
  await fixture.open()
  await page.getByRole('button', { name: /^All Notes/ }).click()
  await row(page, 'harbor-note.md').click()
  await expect(panes(page)).toHaveCount(1)
  await expect(panes(page).locator('.bn-editor')).toContainText('The harbor lantern is ready.')
})
test.afterEach(async () => { await fixture?.dispose() })

for (const side of ['left', 'right', 'top', 'bottom'] as const) {
  test(`@smoke pointer row to ${side} previews before opening and preserves both pages`, async ({ page }) => {
    const initial = ['harbor-note.md', 'garden-note.md'].map(file => fixture.read(file))
    await edge(page, 'garden-note.md', side)
    expect(await paths(page)).toEqual([fixture.file('harbor-note.md')])
    await release(page)
    await expect(panes(page)).toHaveCount(2)
    const order = side === 'left' || side === 'top' ? ['garden-note.md', 'harbor-note.md'] : ['harbor-note.md', 'garden-note.md']
    await expect.poll(() => paths(page)).toEqual(order.map(file => fixture.file(file)))
    await expect(page.locator('.ll-panes')).toHaveClass(new RegExp(side === 'left' || side === 'right' ? 'll-panes--horizontal' : 'll-panes--vertical'))
    await expect(panes(page).locator('.bn-editor')).toHaveCount(2)
    expect(['harbor-note.md', 'garden-note.md'].map(file => fixture.read(file))).toEqual(initial)
    expect(fixture.remoteRequests).toEqual([])
  })
}

test('@smoke centre placement and existing-page reuse preserve continued writing in both panes', async ({ page }) => {
  await edge(page, 'garden-note.md', 'right')
  await release(page)
  const harbor = panes(page).filter({ has: page.locator('.bn-editor', { hasText: 'The harbor lantern is ready.' }) })
  await appendTo(page, harbor, 'The harbor lantern is ready.', ' Harbor latest words.')
  // A quarter into the right pane: its middle lies inside the page area's right-edge band.
  await begin(page, row(page, 'cedar-note.md'), await point(panes(page).nth(1), 0.25))
  await expect(page.locator('.ll-drop-zone[data-edge="center"][data-active="true"]')).toBeVisible()
  await release(page)
  await expect.poll(() => paths(page)).toEqual(['harbor-note.md', 'cedar-note.md'].map(file => fixture.file(file)))
  await appendTo(page, panes(page).nth(1), 'Cedar branches shade the path.', ' Cedar latest words.')
  // The open page moves; it is not opened a second time.
  await edge(page, 'harbor-note.md', 'right')
  await release(page)
  await expect.poll(() => paths(page)).toEqual(['cedar-note.md', 'harbor-note.md'].map(file => fixture.file(file)))
  await expect(panes(page).locator('.bn-editor')).toHaveCount(2)
  await appendTo(page, panes(page).nth(1), 'Harbor latest words.', ' Continued after moving.')
  // Words may land in one paragraph or several; each must be saved with the original text.
  for (const words of ['The harbor lantern is ready.', 'Harbor latest words.', 'Continued after moving.']) {
    await expect.poll(() => fixture.read('harbor-note.md')).toContain(words)
  }
  for (const words of ['Cedar branches shade the path.', 'Cedar latest words.']) {
    await expect.poll(() => fixture.read('cedar-note.md')).toContain(words)
  }
  await expect(panes(page).locator('.bn-editor')).toHaveCount(2)
  expect(fixture.remoteRequests).toEqual([])
})

test('@smoke Escape and outside release cancel without opening the row; next click still works', async ({ page }) => {
  await edge(page, 'garden-note.md', 'right')
  await page.keyboard.press('Escape')
  await release(page)
  expect(await paths(page)).toEqual([fixture.file('harbor-note.md')])
  await edge(page, 'garden-note.md', 'bottom')
  await page.mouse.move(950, 20, { steps: 12 })
  await release(page)
  expect(await paths(page)).toEqual([fixture.file('harbor-note.md')])
  // Released over another row: the release click is swallowed, so neither row opens.
  await begin(page, row(page, 'garden-note.md'), await point(row(page, 'cedar-note.md')))
  await expect(page.locator('.ll-drag-chip')).toHaveText('Garden note')
  await expect(page.locator('.ll-drop-overlay')).toHaveCount(0)
  await release(page)
  expect(await paths(page)).toEqual([fixture.file('harbor-note.md')])
  await row(page, 'cedar-note.md').click()
  await expect.poll(() => paths(page)).toEqual([fixture.file('cedar-note.md')])
  await expect(panes(page).locator('.bn-editor')).not.toContainText(fixture.vault)
})

// Click routing is the list's own (note-list/noteListUtils.ts routeNoteClick); the gesture must not change it.
test('short clicks, modifier presses and context menus keep their list behavior and never drag', async ({ page }) => {
  const harbor = fixture.file('harbor-note.md')
  const area = await page.locator('.ll-panes').boundingBox()
  if (!area) throw new Error('Page area absent')
  // A modified press moved over a drop edge previews nothing and opens nothing.
  const start = await point(row(page, 'garden-note.md'))
  await page.keyboard.down('Shift')
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(area.x + area.width - 16, area.y + area.height / 2, { steps: 12 })
  await expect(page.locator('.ll-drag-chip')).toHaveCount(0)
  await expect(page.locator('.ll-drop-overlay')).toHaveCount(0)
  await page.mouse.up()
  await page.keyboard.up('Shift')
  expect(await paths(page)).toEqual([harbor])
  // Shift-click selects the range from the row last opened, and the open page stays.
  await row(page, 'garden-note.md').click({ modifiers: ['Shift'] })
  await expect(row(page, 'garden-note.md')).toHaveAttribute('data-testid', 'multi-selected-item')
  await expect(row(page, 'harbor-note.md')).toHaveAttribute('data-testid', 'multi-selected-item')
  expect(await paths(page)).toEqual([harbor])
  await expect(page.locator('.ll-drag-chip')).toHaveCount(0)
  // Cmd-click opens the row in the active pane and shows its neighborhood; selection clears.
  await row(page, 'cedar-note.md').click({ modifiers: ['Meta'] })
  await expect.poll(() => paths(page)).toEqual([fixture.file('cedar-note.md')])
  await expect(page.locator('[data-testid="multi-selected-item"]')).toHaveCount(0)
  await expect(page.locator('.ll-drag-chip')).toHaveCount(0)
  // Secondary click opens the row menu; a plain click opens the row.
  await page.getByRole('button', { name: /^All Notes/ }).click()
  const menu = page.getByTestId('note-list-context-menu')
  await row(page, 'garden-note.md').click({ button: 'right' })
  await expect(menu.getByText('Copy file path', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await row(page, 'harbor-note.md').click()
  await expect.poll(() => paths(page)).toEqual([harbor])
  await expect(page.locator('.ll-drag-chip')).toHaveCount(0)
})

test('sidebar folder drop admits once and preserves the active page', async ({ page }) => {
  let moves = 0
  const original = fixture.read('garden-note.md')
  fs.mkdirSync(fixture.file('garden'), { recursive: true })
  await page.exposeFunction('rowFolderFixture', (args: { oldPath: string; folderPath: string; vaultPath: string }) => {
    expect(args.vaultPath).toBe(fixture.vault)
    expect(args.oldPath).toBe(fixture.file('garden-note.md'))
    expect(args.folderPath).toBe('garden')
    moves++
    const content = fixture.read('garden-note.md')
    const destination = fixture.file('garden/garden-note.md')
    fs.renameSync(args.oldPath, destination)
    return { new_path: destination, updated_files: 0, failed_updates: 0,
      source_before_content: content, source_content: content, updated_open_pages: [], unrefreshed_open_paths: [] }
  })
  await page.evaluate(() => {
    const handler = Reflect.get(window, 'rowFolderFixture') as (args: unknown) => Promise<unknown>
    if (!window.__mockHandlers) throw new Error('Fixture handlers absent')
    // The desktop bridge passes the native command shape, `{ args: { vaultPath, oldPath, folderPath } }`.
    window.__mockHandlers.move_note_to_folder = (args?: unknown) => handler((args as { args?: unknown } | undefined)?.args ?? args)
  })
  // This controlled receipt qualifies gesture dispatch, not the native filesystem mover.
  const target = page.getByTestId('folder-row:garden')
  await target.scrollIntoViewIfNeeded()
  await begin(page, row(page, 'garden-note.md'), await point(target))
  await expect(target).toHaveAttribute('data-note-drop-state', 'valid')
  await release(page)
  await expect(target).not.toHaveAttribute('data-note-drop-state')
  await expect.poll(() => moves).toBe(1)
  await expect(row(page, 'garden/garden-note.md')).toBeVisible()
  expect(fixture.read('garden/garden-note.md')).toBe(original)
  expect(fs.existsSync(fixture.file('garden-note.md'))).toBe(false)
  expect(await paths(page)).toEqual([fixture.file('harbor-note.md')])
})

test('sidebar type drop updates local metadata and leaves the open page alone', async ({ page }) => {
  const original = fixture.read('garden-note.md')
  const target = page.locator('[data-note-drop-type="Journal"]')
  await target.scrollIntoViewIfNeeded()
  await begin(page, row(page, 'garden-note.md'), await point(target))
  await expect(target).toHaveAttribute('data-note-drop-state', 'valid')
  await release(page)
  await expect(target).not.toHaveAttribute('data-note-drop-state')
  await expect.poll(() => frontmatter(fixture.read('garden-note.md')).type).toBe('Journal')
  expect(body(fixture.read('garden-note.md'))).toBe(body(original))
  expect(await paths(page)).toEqual([fixture.file('harbor-note.md')])
})
