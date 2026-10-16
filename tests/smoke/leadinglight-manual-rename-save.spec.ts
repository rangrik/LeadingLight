import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { APP_COMMAND_IDS } from '../../src/hooks/appCommandCatalog'
import { createFixtureVaultCopy, openFixtureVaultDesktopHarness, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { triggerMenuCommand, triggerShortcutCommand } from './testBridge'

// A manual filename rename has moved the file on disk, but its reply to the page is held while
// newer text is typed and saved. Afterwards the editor and the new file keep every newer word.

const OLD_FILE = path.join('note', 'note-b.md')
const NEW_STEM = 'harbor-ledger'
const NEW_FILE = path.join('note', `${NEW_STEM}.md`)
const ORIGINAL_SENTENCE = 'This is Note B, referenced by Alpha Project.'

interface RenameGate {
  held: boolean
  release: () => void
}

let vault: string
let activeGate: RenameGate | null = null
const abs = (relative: string) => path.join(vault, relative)
const readIfExists = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '')

test.beforeEach(() => {
  vault = createFixtureVaultCopy()
})

test.afterEach(() => {
  activeGate?.release()
  activeGate = null
  removeFixtureVaultCopy(vault)
})

// The backend rename runs at once; only its reply to the page waits until release.
async function holdFilenameRename(page: Page): Promise<RenameGate> {
  let releaseReply = () => {}
  const released = new Promise<void>((resolve) => { releaseReply = resolve })
  const gate: RenameGate = { held: false, release: () => releaseReply() }
  await page.route('**/api/vault/rename-filename', async (route) => {
    const response = await route.fetch()
    gate.held = true
    await released
    // The page may already be closing when afterEach releases a failed test.
    await route.fulfill({ response }).catch(() => undefined)
  })
  activeGate = gate
  return gate
}

// Observation only: the content of every save or create the page sends for one file.
function recordWrites(page: Page, file: string): string[] {
  const contents: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'POST' || !/\/api\/vault\/(save|create)$/.test(new URL(request.url()).pathname)) return
    let body: { path?: unknown, content?: unknown } | null = null
    try { body = request.postDataJSON() } catch { return }
    if (body?.path === file) contents.push(typeof body.content === 'string' ? body.content : '')
  })
  return contents
}

async function openNoteB(page: Page): Promise<void> {
  await openFixtureVaultDesktopHarness(page, vault)
  await page.getByTestId('note-list-container').getByText('Note B', { exact: true }).first().click()
  await expect(page.locator('.bn-editor')).toContainText(ORIGINAL_SENTENCE, { timeout: 5_000 })
}

// Starts the rename from the breadcrumb and returns once the file has moved but the page is not told.
async function renameAndHold(page: Page, gate: RenameGate): Promise<void> {
  await page.getByTestId('breadcrumb-filename-trigger').dblclick()
  const input = page.getByTestId('breadcrumb-filename-input')
  await expect(input).toBeVisible({ timeout: 5_000 })
  await input.fill(NEW_STEM)
  await input.press('Enter')
  await expect.poll(() => gate.held, { message: 'the rename never reached the vault backend' }).toBe(true)
  expect(fs.existsSync(abs(NEW_FILE))).toBe(true)
  expect(fs.existsSync(abs(OLD_FILE))).toBe(false)
}

async function expectSettledAtNewPathOnly(page: Page, newerText: string[], oldPathWrites: string[]): Promise<void> {
  await expect.poll(() => readIfExists(abs(NEW_FILE)), { timeout: 10_000 }).toContain(newerText.at(-1) ?? '')
  const saveState = page.getByRole('region', { name: 'Page pane 1', exact: true })
    .getByRole('status').filter({ hasText: /^(Saved|Unsaved)$/ })
  await expect(saveState).toHaveText('Saved', { timeout: 10_000 })
  const disk = readIfExists(abs(NEW_FILE))
  expect(disk).toContain(ORIGINAL_SENTENCE)
  for (const part of newerText) expect(disk).toContain(part)
  expect(fs.existsSync(abs(OLD_FILE)), 'the old file was written again').toBe(false)
  expect(oldPathWrites, 'writes sent to the old path after the rename started').toEqual([])
}

test('rich text typed and saved during a manual rename stays in the editor and lands only at the new name', async ({ page }) => {
  test.setTimeout(60_000)
  const saved = 'Rich words saved while the rename waits.'
  const tail = 'Rich words still in the editor when it lands.'
  const after = 'Rich words typed after the rename.'
  await openNoteB(page)
  const gate = await holdFilenameRename(page)
  const oldPathWrites = recordWrites(page, abs(OLD_FILE))
  await renameAndHold(page, gate)

  const blocks = page.locator('.bn-editor .bn-block-content')
  await expect(blocks.last()).toHaveText('')
  await blocks.last().click()
  await page.keyboard.type(saved)
  await triggerMenuCommand(page, APP_COMMAND_IDS.fileSave)
  // Typed just before the reply: it is still inside the editor's change delay.
  await page.keyboard.press('Enter')
  await page.keyboard.type(tail)
  gate.release()

  await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(NEW_STEM, { timeout: 10_000 })
  const editor = page.locator('.bn-editor')
  await expect(editor).toContainText(saved)
  await expect(editor).toContainText(tail)
  await expect(blocks.last()).toHaveText('')
  await blocks.last().click()
  await page.keyboard.type(after)

  await expectSettledAtNewPathOnly(page, [saved, tail, after], oldPathWrites)
  await expect(editor).toContainText(saved)
  await expect(editor).toContainText(tail)
  await expect(editor).toContainText(after)
})

test('raw Markdown typed and saved during a manual rename stays in the editor and lands only at the new name', async ({ page }) => {
  test.setTimeout(60_000)
  const saved = 'Raw words saved while the rename waits.'
  const tail = 'Raw words still in the editor when it lands.'
  const after = 'Raw words typed after the rename.'
  await openNoteB(page)
  await triggerShortcutCommand(page, APP_COMMAND_IDS.editToggleRawEditor)
  const raw = page.getByTestId('raw-editor-codemirror').locator('.cm-content')
  await expect(raw).toContainText(ORIGINAL_SENTENCE, { timeout: 5_000 })
  const gate = await holdFilenameRename(page)
  const oldPathWrites = recordWrites(page, abs(OLD_FILE))
  await renameAndHold(page, gate)

  await raw.click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type(saved)
  await triggerMenuCommand(page, APP_COMMAND_IDS.fileSave)
  // Typed just before the reply: it is still inside the raw editor's 500 ms delay.
  await page.keyboard.press('Enter')
  await page.keyboard.type(tail)
  gate.release()

  await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(NEW_STEM, { timeout: 10_000 })
  await expect(raw).toContainText(saved)
  await expect(raw).toContainText(tail)
  await raw.click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type(after)

  await expectSettledAtNewPathOnly(page, [saved, tail, after], oldPathWrites)
  await expect(raw).toContainText(saved)
  await expect(raw).toContainText(tail)
  await expect(raw).toContainText(after)
})
