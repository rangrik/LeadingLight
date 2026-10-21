import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { createFixtureVaultCopy, openFixtureVaultDesktopHarness, removeFixtureVaultCopy } from '../helpers/fixtureVault'

// Passage commentary through renames and moves, in the browser against the disk-backed development
// bridge, on disposable synthetic vaults only. Every claim is checked on disk with fs: the commentary
// keeps reaching its source through the exact `[Source](…)` link, only that link destination changes,
// and the capture record in its front matter keeps its exact bytes. Native durability is not shown here.

const SOURCE_TEXT = [
  '# Source page',
  '',
  'The first passage to keep.',
  '',
  'A second thought worth quoting.',
  '',
].join('\n')
const COMMENTARY = 'Topics/commentary-on-source-page.md'
const FOLDERS = [{ name: 'Topics', path: 'Topics', children: [] }, { name: 'Archive', path: 'Archive', children: [] }]

let vault: string
let releaseHeld: () => void = () => {}
const file = (relative: string) => path.join(vault, relative)
const read = (relative: string) => fs.readFileSync(file(relative), 'utf8')
const exists = (relative: string) => fs.existsSync(file(relative))
const pane = (page: Page, id: 0 | 1) => page.locator(`[data-pane-id="${id}"]`)
const dialog = (page: Page) => page.getByTestId('commentary-dialog')
/** The capture record: the front matter block, byte for byte. */
const recordOf = (text: string) => text.slice(0, text.indexOf('\n---\n') + 5)

async function open(page: Page, sourceFile: string) {
  vault = createFixtureVaultCopy()
  fs.mkdirSync(file('Topics'))
  fs.mkdirSync(file('Archive'))
  fs.writeFileSync(file(sourceFile), SOURCE_TEXT)
  await openFixtureVaultDesktopHarness(page, vault, { folders: FOLDERS })
  await page.getByTestId('note-list-container').getByText('Source page', { exact: true }).click()
  await expect(pane(page, 0).locator('.bn-editor')).toBeVisible()
}

/** Creates the commentary beside the source through the dialog; returns its exact bytes. */
async function createCommentary(page: Page, sourceName: string): Promise<string> {
  await pane(page, 0).locator('.bn-editor').getByText('The first passage to keep.', { exact: true }).click({ clickCount: 3 })
  await page.getByRole('button', { name: 'Comment on passage' }).click()
  await expect(dialog(page)).toBeVisible()
  await dialog(page).getByLabel('Your thoughts').fill('Worth keeping')
  await dialog(page).getByTestId('commentary-submit').click()
  await expect(dialog(page)).not.toBeVisible()
  const created = read(COMMENTARY)
  expect(created).toContain(`\n[Source](./${sourceName})\n`)
  await expect(pane(page, 1).getByTestId('commentary-source-card')).toContainText('Source: Source page')
  return created
}

/** Holds the browser bridge's reply to one route until released; the backend itself runs at once. */
async function holdReply(page: Page, route: string): Promise<{ held: () => boolean }> {
  let held = false
  const released = new Promise<void>(resolve => { releaseHeld = resolve })
  await page.route(`**/api/vault/${route}`, async request => {
    const response = await request.fetch()
    held = true
    await released
    await request.fulfill({ response }).catch(() => undefined)
  })
  return { held: () => held }
}

async function moveToFolder(page: Page, id: 0 | 1, folder: string) {
  await pane(page, id).getByRole('button', { name: 'More note actions', exact: true }).click()
  await page.getByTestId('page-move-folder-menu-item').click()
  await expect(page.getByRole('dialog', { name: 'Move to folder', exact: true })).toBeVisible()
  await page.getByTestId(`retarget-note-folder-option:${folder}`).click()
  await expect(page.getByRole('dialog', { name: 'Move to folder', exact: true })).toBeHidden()
}

test.describe('LeadingLight passage commentary through renames and moves', () => {
  test.describe.configure({ timeout: 60_000 })
  test.use({ viewport: { width: 1600, height: 1000 } })

  test.afterEach(() => {
    releaseHeld()
    removeFixtureVaultCopy(vault)
  })

  test('a title rename of the source keeps the exact Source link, the card and the capture record @smoke', async ({ page }) => {
    // A new page takes its first heading as its name; that is the title rename a person sees.
    await open(page, 'Topics/untitled-page-1.md')
    const created = await createCommentary(page, 'untitled-page-1.md')

    await pane(page, 0).locator('.bn-editor').getByRole('heading', { name: 'Source page', level: 1 }).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' notes')
    await expect.poll(() => exists('Topics/source-page-notes.md'), { timeout: 20_000 }).toBe(true)
    expect(exists('Topics/untitled-page-1.md')).toBe(false)
    const renamed = read('Topics/source-page-notes.md')
    expect(renamed).toContain('# Source page notes\n')
    expect(renamed).toContain('The first passage to keep.')

    await expect.poll(() => read(COMMENTARY)).toBe(created.replace('[Source](./untitled-page-1.md)', '[Source](./source-page-notes.md)'))
    expect(recordOf(read(COMMENTARY))).toBe(recordOf(created))
    await expect(pane(page, 1).getByTestId('commentary-source-card')).toContainText('Source: Source page notes')
    await expect(pane(page, 0).getByTestId('commentary-header')).toBeVisible()
  })

  test('a filename rename keeps words typed in the open commentary while it ran, and retargets only the link', async ({ page }) => {
    await open(page, 'Topics/source.md')
    const created = await createCommentary(page, 'source.md')
    const reply = await holdReply(page, 'rename-filename')

    await pane(page, 0).getByTestId('breadcrumb-filename-trigger').dblclick()
    const input = pane(page, 0).getByTestId('breadcrumb-filename-input')
    await input.fill('renamed-source')
    await input.press('Enter')
    await expect.poll(reply.held, { message: 'the rename never reached the bridge' }).toBe(true)
    expect(exists('Topics/renamed-source.md')).toBe(true)

    // The commentary is open and changing while the rename has not answered yet.
    await pane(page, 1).locator('.bn-editor').getByText('Worth keeping', { exact: true }).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' Typed while renaming.')
    releaseHeld()

    await expect(pane(page, 0).getByTestId('breadcrumb-filename-trigger')).toContainText('renamed-source', { timeout: 10_000 })
    await expect.poll(() => read(COMMENTARY), { timeout: 10_000 }).toContain('Worth keeping Typed while renaming.')
    const settled = read(COMMENTARY)
    expect(recordOf(settled)).toBe(recordOf(created))
    expect(settled.match(/^\[Source\]\(.*\)$/gm)).toEqual(['[Source](./renamed-source.md)'])
    expect(read('Topics/renamed-source.md')).toBe(SOURCE_TEXT)
    expect(exists('Topics/source.md')).toBe(false)
    await expect(pane(page, 1).getByTestId('commentary-source-card')).toContainText('Source: Source page')
  })

  test('moving the source to another folder retargets the Source link and leaves the record and the source bytes alone', async ({ page }) => {
    await open(page, 'Topics/source.md')
    const created = await createCommentary(page, 'source.md')

    await moveToFolder(page, 0, 'Archive')
    await expect.poll(() => exists('Archive/source.md'), { timeout: 10_000 }).toBe(true)
    expect(exists('Topics/source.md')).toBe(false)
    expect(read('Archive/source.md')).toBe(SOURCE_TEXT)
    await expect.poll(() => read(COMMENTARY)).toBe(created.replace('[Source](./source.md)', '[Source](../Archive/source.md)'))
    expect(recordOf(read(COMMENTARY))).toBe(recordOf(created))
    await expect(page.getByTestId('commentary-source-card')).toContainText('Source: Source page')
  })

  test('moving the commentary to another folder rebases its own Source link; the source still finds it', async ({ page }) => {
    await open(page, 'Topics/source.md')
    const created = await createCommentary(page, 'source.md')

    await moveToFolder(page, 1, 'Archive')
    const moved = 'Archive/commentary-on-source-page.md'
    await expect.poll(() => exists(moved), { timeout: 10_000 }).toBe(true)
    expect(exists(COMMENTARY)).toBe(false)
    expect(read(moved)).toBe(created.replace('[Source](./source.md)', '[Source](../Topics/source.md)'))
    expect(recordOf(read(moved))).toBe(recordOf(created))
    expect(read('Topics/source.md')).toBe(SOURCE_TEXT)
    await expect(page.getByTestId('commentary-source-card')).toContainText('Source: Source page')
    await expect(pane(page, 0).getByTestId('commentary-header')).toBeVisible()
  })
})
