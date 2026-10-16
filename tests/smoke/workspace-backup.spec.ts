import fs from 'node:fs'
import path from 'node:path'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { APP_COMMAND_IDS } from '../../src/hooks/appCommandCatalog'
import { BACKUP_LIMITS, WORKSPACE_FOLDER } from '../../src/leadinglight/backup/backupContract'
import { executeCommand, openCommandPalette } from './helpers'
import { triggerMenuCommand } from './testBridge'
import { EXCLUDED, inventory, LANTERN, PAGES, PAYLOADS, TIDE, verifyBackup, verifyRestored, WorkspaceBackupFixture } from './workspaceBackupFixture'

// Public renderer controls, real files and real backup routes. Picker answers and transport
// faults are synthetic; these checks do not stand in for native picker or crash-durability QA.
let fixture: WorkspaceBackupFixture
const pane = (page: Page, n: 1 | 2) => page.locator(`section[aria-label="Page pane ${n}"]`)
const backup = (page: Page) => page.getByTestId('backup-dialog')
const restore = (page: Page) => page.getByTestId('restore-dialog')
const finder = (page: Page) => page.getByRole('dialog', { name: 'Find a page' })

async function openByTitle(page: Page, title: string, relative: string, n: 1 | 2 = 1, root = fixture.vault) {
  await page.getByTestId('sidebar-top-nav').getByRole('button', { name: 'Search', exact: true }).click()
  await finder(page).getByRole('combobox').fill(title)
  await finder(page).getByRole('group', { name: 'Pages', exact: true }).getByRole('option')
    .filter({ hasText: new RegExp(`^${title}`) }).first().click()
  await expect(finder(page)).toBeHidden()
  await expect(pane(page, n)).toHaveAttribute('data-note-path', path.join(root, relative))
}

async function typeRich(page: Page, owner: Locator, text: string) {
  await owner.locator('.bn-editor').getByText('The harbor lantern faces the breakwater.', { exact: true }).click()
  await page.keyboard.press('End')
  await page.keyboard.type(text)
}

async function openFromMenu(page: Page, kind: 'backup' | 'restore') {
  await page.getByTestId('status-vault-trigger').click()
  await page.getByTestId(kind === 'backup' ? 'vault-menu-back-up' : 'vault-menu-restore-backup').click()
  await expect(kind === 'backup' ? backup(page) : restore(page)).toBeVisible()
}

async function createBackup(page: Page): Promise<string> {
  await openFromMenu(page, 'backup')
  fixture.pickNext(fixture.destination)
  await backup(page).getByRole('button', { name: 'Choose folder…', exact: true }).click()
  return completedBackup(page)
}

async function completedBackup(page: Page): Promise<string> {
  await expect(backup(page)).toHaveAttribute('data-step', 'finished')
  await expect(backup(page).getByTestId('backup-result')).toContainText('Backup saved')
  const folder = await backup(page).getByTestId('backup-result-path').innerText()
  expect(path.dirname(folder)).toBe(fixture.destination)
  return folder
}

async function inspectBackup(page: Page, folder: string) {
  await openFromMenu(page, 'restore')
  fixture.pickNext(folder)
  await restore(page).getByRole('button', { name: 'Choose backup…', exact: true }).click()
  await expect(restore(page)).toHaveAttribute('data-step', 'form')
}

async function startRestore(page: Page, name: string) {
  await restore(page).getByRole('textbox', { name: 'Name of the new workspace folder' }).fill(name)
  fixture.pickNext(fixture.restoreParent)
  await restore(page).getByRole('button', { name: 'Choose where to restore…', exact: true }).click()
}

test.use({ viewport: { width: 1600, height: 1000 } })
test.describe.configure({ retries: 0, timeout: 60_000 })
test.beforeEach(async ({ page }) => { fixture = new WorkspaceBackupFixture(page) })
test.afterEach(async () => { await fixture?.dispose() })

test('cancelling the destination picker writes no backup and releases editing and commands', async ({ page }) => {
  await fixture.open()
  await openByTitle(page, 'Lantern', LANTERN)
  const original = inventory(fixture.vault)
  await openFromMenu(page, 'backup')
  await expect(backup(page).getByTestId('backup-intro')).toContainText('Pages in Trash, Git history and linked folders aren’t included.')
  const cancelPicker = fixture.holdPicker()
  await backup(page).getByRole('button', { name: 'Choose folder…', exact: true }).click()
  await expect.poll(() => fixture.pickerCalls).toBe(1)
  await expect(backup(page)).toHaveAttribute('data-step', 'choosing')
  // Both a renderer shortcut and desktop-menu dispatch must respect preparation's input guard.
  await page.keyboard.press('Control+k')
  await triggerMenuCommand(page, APP_COMMAND_IDS.fileNewNote)
  await expect(page.locator('input[placeholder="Type a command..."]')).toHaveCount(0)
  await expect(pane(page, 1)).toHaveAttribute('data-note-path', fixture.file(LANTERN))
  cancelPicker(null)
  await expect(backup(page)).toHaveAttribute('data-step', 'intro')
  await page.keyboard.press('Escape')
  await expect(backup(page)).toBeHidden()
  expect(fixture.callsOf('start-workspace-backup')).toHaveLength(0)
  expect(fs.readdirSync(fixture.destination)).toEqual([])
  expect(inventory(fixture.vault)).toEqual(original)

  await typeRich(page, pane(page, 1), ' Editing resumed.')
  await triggerMenuCommand(page, APP_COMMAND_IDS.fileSave)
  await expect.poll(() => fixture.read(LANTERN)).toContain('Editing resumed.')
  await openCommandPalette(page)
  await executeCommand(page, 'Back up workspace')
  await expect(backup(page)).toHaveAttribute('data-step', 'intro')
  await page.keyboard.press('Escape')
})

test('backup saves dirty rich and raw panes, verifies all bytes, and restores without overwrite or an automatic switch', async ({ page }) => {
  await fixture.open()
  await openByTitle(page, 'Lantern', LANTERN)
  await page.getByRole('button', { name: 'Split right', exact: true }).click()
  await pane(page, 2).getByText('Open a page here').click()
  await openByTitle(page, 'Tide table', TIDE, 2)

  // Editor mode is shared across panes: make the rich edit before opening raw mode.
  // Hold real writes before disk admission so both edits are still dirty at Choose folder.
  const releaseSaves = fixture.holdSaves()
  await typeRich(page, pane(page, 1), ' Rich words kept in the backup.')
  await pane(page, 2).getByRole('button', { name: 'Open the raw editor', exact: true }).click()
  const raw = pane(page, 2).getByTestId('raw-editor-codemirror')
  await expect(raw).toBeVisible()
  await raw.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText('\nRaw words kept in the backup.\n')
  await openFromMenu(page, 'backup')
  fixture.pickNext(fixture.destination)
  await backup(page).getByRole('button', { name: 'Choose folder…', exact: true }).click()
  await expect(backup(page)).toHaveAttribute('data-step', 'saving')
  expect(fixture.callsOf('start-workspace-backup')).toHaveLength(0)
  expect([fixture.read(LANTERN), fixture.read(TIDE)]).toEqual([PAGES[LANTERN], PAGES[TIDE]])
  releaseSaves()

  const folder = await completedBackup(page)
  const manifest = verifyBackup(folder)
  await expect(backup(page).getByTestId('backup-result')).toContainText(`Files copied and checked: ${manifest.totalFiles}`)
  await expect(backup(page).getByTestId('backup-result')).toContainText('Items in Trash not included: 1.')
  expect(manifest.trashItemsNotIncluded).toBe(1)
  expect(fixture.callsOf('start-workspace-backup')).toHaveLength(1)
  expect(fixture.read(LANTERN)).toContain('Rich words kept in the backup.')
  expect(fixture.read(TIDE)).toContain('Raw words kept in the backup.')
  const source = inventory(fixture.vault)
  for (const file of manifest.files) expect(source[file.path], `source bytes: ${file.path}`).toEqual({ bytes: file.bytes, sha256: file.sha256 })
  for (const [relative, bytes] of Object.entries(PAYLOADS)) {
    if (relative !== LANTERN && relative !== TIDE) expect(fs.readFileSync(fixture.file(relative))).toEqual(Buffer.from(bytes))
  }
  const versionRelative = path.relative(fixture.vault, fixture.earlier.payload)
  expect(fs.readFileSync(path.join(folder, WORKSPACE_FOLDER, versionRelative))).toEqual(fixture.earlier.bytes)
  for (const [relative, bytes] of Object.entries(EXCLUDED)) {
    if (relative !== '.laputa-cache.json') expect(fs.readFileSync(fixture.file(relative))).toEqual(Buffer.from(bytes))
  }
  await backup(page).getByRole('button', { name: 'Done', exact: true }).click()

  await inspectBackup(page, folder)
  await expect(restore(page).getByTestId('restore-summary')).toContainText(`Workspace: ${manifest.workspaceName}`)
  await expect(restore(page).getByTestId('restore-summary')).toContainText(`Files: ${manifest.totalFiles}`)
  await expect(restore(page).getByTestId('restore-summary')).toContainText('Backed up:')
  await expect(restore(page).getByTestId('restore-summary')).toContainText('Every file in the backup was checked.')
  // The form and long selectable path fit a compact window too.
  await page.setViewportSize({ width: 560, height: 720 })
  for (const control of [restore(page).getByTestId('restore-name'), restore(page).getByTestId('restore-start')]) {
    await control.scrollIntoViewIfNeeded()
    await expect(control).toBeInViewport({ ratio: 1 })
  }
  expect(await restore(page).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.setViewportSize({ width: 1600, height: 1000 })

  const collision = path.join(fixture.restoreParent, 'Already here')
  fs.mkdirSync(collision)
  fs.writeFileSync(path.join(collision, 'keep.bin'), Buffer.from([0, 255, 42]))
  const sentinel = inventory(collision)
  await startRestore(page, 'Already here')
  await expect(restore(page).getByTestId('restore-notice')).toHaveAttribute('data-notice', 'nameTaken')
  expect(inventory(collision)).toEqual(sentinel)
  await expect(restore(page).getByTestId('restore-name')).toHaveValue('Already here')
  const restored = path.join(fixture.restoreParent, 'Harbor restored')
  await startRestore(page, 'Harbor restored')
  await expect(restore(page).getByTestId('restore-result')).toContainText('Workspace restored')
  await expect(restore(page).getByTestId('restore-result-path')).toHaveText(restored)
  verifyRestored(restored, manifest)
  expect(inventory(fixture.vault), 'restore leaves the source intact').toEqual(source)
  await expect(pane(page, 1)).toHaveAttribute('data-note-path', fixture.file(LANTERN))
  await expect(pane(page, 2)).toHaveAttribute('data-note-path', fixture.file(TIDE))
  expect(fs.readdirSync(fixture.restoreParent).sort()).toEqual(['Already here', 'Harbor restored'])

  await restore(page).getByRole('button', { name: 'Open it now', exact: true }).click()
  await expect(restore(page)).toBeHidden()
  await expect(page.getByTestId('status-vault-trigger')).toContainText('Harbor restored')
  await openByTitle(page, 'Lantern', LANTERN, 1, restored)
  const returnToEditor = pane(page, 1).getByRole('button', { name: 'Return to the editor', exact: true })
  if (await returnToEditor.isVisible()) await returnToEditor.click()
  await expect(pane(page, 1).locator('.bn-editor')).toContainText('Rich words kept in the backup.')
  await pane(page, 1).getByRole('button', { name: 'More note actions', exact: true }).click()
  await page.getByTestId('page-history-menu-item').click()
  await page.getByTestId('page-history-dialog').locator(`[data-version-id="${fixture.earlier.id}"]`).click()
  await expect(page.getByTestId('page-history-preview-formatted')).toContainText('Earlier harbor words.')
  expect(fs.readFileSync(fixture.earlier.payload)).toEqual(fixture.earlier.bytes)
})

test('payload damage after inspection refuses restore, and a fresh inspection also refuses it', async ({ page }) => {
  await fixture.open()
  const folder = await createBackup(page)
  verifyBackup(folder)
  await backup(page).getByRole('button', { name: 'Done', exact: true }).click()
  const source = inventory(fixture.vault)
  await inspectBackup(page, folder)
  const payload = path.join(folder, WORKSPACE_FOLDER, 'assets/every-byte.bin')
  const tampered = fs.readFileSync(payload)
  tampered[0] ^= 0xff
  fs.writeFileSync(payload, tampered)
  await startRestore(page, 'Must not complete')
  await expect(restore(page).getByTestId('restore-result')).toContainText('The backup changed after it was checked.')
  await expect(restore(page).getByTestId('restore-result')).toContainText('No restored workspace was created.')
  await expect(restore(page).getByTestId('restore-open')).toHaveCount(0)
  expect(fs.readdirSync(fixture.restoreParent)).toEqual([])
  expect(inventory(fixture.vault)).toEqual(source)

  await restore(page).getByRole('button', { name: 'Try again', exact: true }).click()
  fixture.pickNext(folder)
  await restore(page).getByRole('button', { name: 'Choose backup…', exact: true }).click()
  await expect(restore(page).getByTestId('restore-check')).toContainText('This backup can’t be restored')
  await expect(restore(page).getByTestId('restore-check')).toContainText('Content doesn’t match')
  await expect(restore(page).getByTestId('restore-start')).toHaveCount(0)
  expect(fixture.callsOf('start-backup-restore')).toHaveLength(1)
  expect(fs.readFileSync(payload)).toEqual(tampered)
  expect(fs.readdirSync(fixture.restoreParent)).toEqual([])
})

test('a lost start reply recovers the real result through status without starting another copy', async ({ page }) => {
  await fixture.open()
  fixture.dropNextStart = true
  await openCommandPalette(page)
  await executeCommand(page, 'Back up workspace')
  fixture.pickNext(fixture.destination)
  await backup(page).getByRole('button', { name: 'Choose folder…', exact: true }).click()
  const folder = await completedBackup(page)
  verifyBackup(folder)
  const starts = fixture.callsOf('start-workspace-backup')
  expect(starts).toHaveLength(1)
  expect(starts[0].dropped).toBe(true)
  const statuses = fixture.callsOf('get-backup-operation')
  expect(statuses.length).toBeGreaterThan(0)
  expect(statuses.every(call => call.body.operationId === starts[0].body.operationId)).toBe(true)
  expect(fs.readdirSync(fixture.destination)).toEqual([path.basename(folder)])
})

test('unknown status ends in actionable uncertainty, releases the guard and never replays the lost start', async ({ page }) => {
  await fixture.open()
  await openByTitle(page, 'Lantern', LANTERN)
  fixture.dropNextStart = true
  fixture.unknownStatus = true
  await openFromMenu(page, 'backup')
  fixture.pickNext(fixture.destination)
  await backup(page).getByRole('button', { name: 'Choose folder…', exact: true }).click()
  await expect(backup(page).getByTestId('backup-uncertain')).toContainText('LeadingLight lost track of this backup')
  await expect(backup(page).getByTestId('backup-destination')).toHaveText(fixture.destination)
  const starts = fixture.callsOf('start-workspace-backup')
  expect(starts).toHaveLength(1)
  expect(starts[0].dropped).toBe(true)
  const id = starts[0].body.operationId
  expect(id).toBeTruthy()
  const terminal = await fixture.settled(id as string)
  expect(terminal.kind).toBe('backup')
  if (terminal.kind !== 'backup' || terminal.result.status !== 'complete') throw new Error(`unexpected real result: ${JSON.stringify(terminal)}`)
  verifyBackup(terminal.result.folder)
  // Bounded observation over two polling intervals: uncertainty stops polling as well as starts.
  const polls = fixture.callsOf('get-backup-operation').length
  await page.waitForTimeout(BACKUP_LIMITS.pollIntervalMs * 2 + 50)
  expect(fixture.callsOf('get-backup-operation')).toHaveLength(polls)
  expect(fixture.callsOf('start-workspace-backup')).toHaveLength(1)
  expect(fs.readdirSync(fixture.destination)).toEqual([path.basename(terminal.result.folder)])
  await backup(page).getByRole('button', { name: 'Close', exact: true }).last().click()
  await expect(backup(page)).toBeHidden()
  await typeRich(page, pane(page, 1), ' Resumed after uncertainty.')
  await triggerMenuCommand(page, APP_COMMAND_IDS.fileSave)
  await expect.poll(() => fixture.read(LANTERN)).toContain('Resumed after uncertainty.')
})
