import fs from 'node:fs'
import { expect, type Page, test } from '@playwright/test'
import { LocalTemplatesFixture } from './localTemplatesFixture'

let fixture: LocalTemplatesFixture
const pane = (page: Page, number: number) => page.locator(`section[aria-label="Page pane ${number}"]`)
let mode: 'commit' | 'collision' | 'lost-reply' = 'commit'
let calls = 0
const peerText = '# Garden note\n\nThe pear tree links to [[harbor-note]].\n'

async function openPage(page: Page, title: string, relative: string, number = 1) {
  await page.getByTestId('sidebar-top-nav').getByRole('button', { name: 'Search', exact: true }).click()
  const finder = page.getByRole('dialog', { name: 'Find a page' })
  await finder.getByRole('combobox').fill(title)
  await finder.getByRole('group', { name: 'Pages', exact: true }).getByRole('option').first().click()
  await expect(pane(page, number)).toHaveAttribute('data-note-path', fixture.file(relative))
}

async function picker(page: Page, number = 1) {
  await pane(page, number).getByRole('button', { name: 'More note actions', exact: true }).click()
  await page.getByTestId('page-move-folder-menu-item').click()
  await expect(page.getByRole('dialog', { name: 'Move to folder', exact: true })).toBeVisible()
}

test.use({ viewport: { width: 1600, height: 1000 } })
test.describe.configure({ timeout: 60_000, retries: 0 })
test.beforeEach(async ({ page }) => {
  mode = 'commit'
  calls = 0
  fixture = new LocalTemplatesFixture(page, false)
  fixture.write('garden-note.md', peerText)
  fs.mkdirSync(fixture.file('harbor'), { recursive: true })
  fs.mkdirSync(fixture.file('garden'), { recursive: true })
  await fixture.open()
  // Controlled native receipt transport: this suite qualifies editor lifecycle,
  // not Markdown transformation or native transaction behavior.
  await page.exposeFunction('relocationFixture', (args: { oldPath: string; folderPath: string; vaultPath: string; openPaths: string[] }) => {
    calls++
    expect(args.vaultPath).toBe(fixture.vault)
    expect(args.oldPath).toBe(fixture.file('harbor-note.md'))
    expect(['harbor', 'garden']).toContain(args.folderPath)
    const source = fixture.read('harbor-note.md')
    const destination = fixture.file(`${args.folderPath}/harbor-note.md`)
    if (mode === 'collision') throw new Error('Synthetic occupied destination')
    fs.renameSync(args.oldPath, destination)
    const before = fixture.read('garden-note.md')
    const content = before.replaceAll('[[harbor-note]]', `[[${args.folderPath}/harbor-note]]`)
    fixture.write('garden-note.md', content)
    if (mode === 'lost-reply') throw new Error('Synthetic lost committed reply')
    return {
      new_path: destination, updated_files: 1, failed_updates: 0,
      source_before_content: source, source_content: source,
      updated_open_pages: args.openPaths.includes(fixture.file('garden-note.md'))
        ? [{ path: fixture.file('garden-note.md'), before_content: before, content }] : [],
      unrefreshed_open_paths: [],
    }
  })
  await page.evaluate(() => {
    const bridge = Reflect.get(window, 'relocationFixture') as (args: unknown) => Promise<unknown>
    if (!window.__mockHandlers) throw new Error('Fixture handlers absent')
    window.__mockHandlers.move_note_to_folder = args => bridge(args?.args ?? args)
  })
  await openPage(page, 'Harbor note', 'harbor-note.md')
})
test.afterEach(async () => { await fixture?.dispose() })

test('mouse move drains both panes and reopens exact repaired text in their original modes', async ({ page }) => {
  await page.getByRole('button', { name: 'Split right', exact: true }).click()
  await pane(page, 2).getByText('Open a page here').click()
  await openPage(page, 'Garden note', 'garden-note.md', 2)
  await pane(page, 2).getByRole('button', { name: 'Open the raw editor', exact: true }).click()
  await pane(page, 2).getByTestId('raw-editor-codemirror').locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('\nPeer latest words.\n')
  await pane(page, 1).locator('.bn-editor').getByText('The harbor lantern is ready.', { exact: true }).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Source latest words.')
  await picker(page)
  await page.getByTestId('retarget-note-folder-option:harbor').click()
  await expect(page.getByRole('dialog', { name: 'Move to folder', exact: true })).toBeHidden()
  await expect(pane(page, 1)).toHaveAttribute('data-note-path', fixture.file('harbor/harbor-note.md'))
  await expect(pane(page, 1).locator('.bn-editor')).toContainText('Source latest words.')
  await expect(pane(page, 2).getByTestId('raw-editor-codemirror')).toContainText('[[harbor/harbor-note]]')
  await expect(pane(page, 2)).toContainText('Peer latest words.')
  expect(fixture.read('harbor/harbor-note.md')).toContain('Source latest words.')
  expect(fixture.read('garden-note.md')).toContain('Peer latest words.')
  expect(fs.existsSync(fixture.file('harbor-note.md'))).toBe(false)
  expect(calls).toBe(1)
  expect(fixture.remoteRequests).toEqual([])
})

test('keyboard selection refuses a collision and keeps original saved words editable', async ({ page }) => {
  mode = 'collision'
  const occupant = '# Occupied\n\nKeep exact occupant.\n'
  fixture.write('harbor/harbor-note.md', occupant)
  await picker(page)
  await page.getByTestId('retarget-note-folder-search').fill('harbor')
  await page.keyboard.press('Enter')
  await expect.poll(() => calls).toBe(1)
  await expect(page.getByRole('dialog', { name: 'Move to folder', exact: true })).toHaveAttribute('aria-busy', 'false')
  await page.keyboard.press('Escape')
  await expect(pane(page, 1)).toHaveAttribute('data-note-path', fixture.file('harbor-note.md'))
  await pane(page, 1).locator('.bn-editor').getByText('The harbor lantern is ready.', { exact: true }).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' After refusal.')
  await expect.poll(() => fixture.read('harbor-note.md')).toContain('After refusal.')
  expect(fixture.read('harbor/harbor-note.md')).toBe(occupant)
})

test('a lost committed reply closes stale editors and never recreates the old file', async ({ page }) => {
  mode = 'lost-reply'
  await picker(page)
  await page.getByTestId('retarget-note-folder-option:harbor').click()
  await expect.poll(() => calls).toBe(1)
  await expect(page.getByRole('dialog', { name: 'Move to folder', exact: true })).toHaveAttribute('aria-busy', 'false')
  await page.keyboard.press('Escape')
  await expect(pane(page, 1)).not.toHaveAttribute('data-note-path', fixture.file('harbor-note.md'))
  expect(fs.existsSync(fixture.file('harbor-note.md'))).toBe(false)
  expect(fixture.read('harbor/harbor-note.md')).toContain('The harbor lantern is ready.')
  await openPage(page, 'Harbor note', 'harbor/harbor-note.md')
  await expect(pane(page, 1).locator('.bn-editor')).toContainText('The harbor lantern is ready.')
})

test('a proven collision permits another destination without reopening the picker', async ({ page }) => {
  mode = 'collision'
  await picker(page)
  await page.getByTestId('retarget-note-folder-option:harbor').click()
  await expect.poll(() => calls).toBe(1)
  await expect(page.getByRole('dialog', { name: 'Move to folder', exact: true })).toHaveAttribute('aria-busy', 'false')
  mode = 'commit'
  await page.getByTestId('retarget-note-folder-option:garden').click()
  await expect.poll(() => calls).toBe(2)
  await expect(page.getByRole('dialog', { name: 'Move to folder', exact: true })).toBeHidden()
  await expect(pane(page, 1)).toHaveAttribute('data-note-path', fixture.file('garden/harbor-note.md'))
  expect(fs.existsSync(fixture.file('harbor-note.md'))).toBe(false)
})
