import { expect, type Locator, type Page, test } from '@playwright/test'
import { APP_COMMAND_IDS } from '../../src/hooks/appCommandCatalog'
import { triggerMenuCommand } from './testBridge'
import { LANTERN, TIDE, WorkspaceBackupFixture } from './workspaceBackupFixture'

// Real BlockNote and CodeMirror editors, real disposable disk writes. Reuse the existing
// fixture's request-joining, inode-checked cleanup; it never points at a personal vault.
let fixture: WorkspaceBackupFixture
const slot = (page: Page, number: number) => page.locator(`section[aria-label="Page pane ${number}"]`)
const raw = (pane: Locator) => pane.getByTestId('raw-editor-codemirror').locator('.cm-content')
const rich = (pane: Locator) => pane.locator('.bn-editor')

async function openPage(page: Page, title: string, relative: string, number: number) {
  await page.getByTestId('sidebar-top-nav').getByRole('button', { name: 'Search', exact: true }).click()
  const finder = page.getByRole('dialog', { name: 'Find a page' })
  await finder.getByRole('combobox').fill(title)
  await finder.getByRole('group', { name: 'Pages', exact: true }).getByRole('option').filter({ hasText: new RegExp(`^${title}`) }).first().click()
  await expect(finder).toBeHidden()
  await expect(slot(page, number)).toHaveAttribute('data-note-path', fixture.file(relative))
}

async function appendRich(page: Page, owner: Locator, line: string, text: string) {
  await rich(owner).getByText(line, { exact: true }).click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(text)
}

async function switchToRaw(owner: Locator) {
  await owner.getByRole('button', { name: 'Open the raw editor', exact: true }).click()
  await expect(raw(owner)).toBeVisible()
}

async function switchToRich(owner: Locator) {
  await owner.getByRole('button', { name: 'Return to the editor', exact: true }).click()
  await expect(rich(owner)).toBeVisible()
}

test.use({ viewport: { width: 1600, height: 1000 } })
test.describe.configure({ retries: 0, timeout: 60_000 })
test.beforeEach(async ({ page }) => { fixture = new WorkspaceBackupFixture(page); await fixture.open() })
test.afterEach(async () => { await fixture?.dispose() })

test('mixed modes preserve dirty words, active commands, pane identity and persisted visual order', async ({ page }) => {
  await openPage(page, 'Lantern', LANTERN, 1)
  await page.getByRole('button', { name: 'Split right', exact: true }).click()
  await slot(page, 2).getByText('Open a page here').click()
  await openPage(page, 'Tide table', TIDE, 2)
  const left = slot(page, 1)
  const right = slot(page, 2)
  const leftEditor = await rich(left).elementHandle()
  const releaseSaves = fixture.holdSaves()
  await appendRich(page, left, 'The harbor lantern faces the breakwater.', ' Left dirty words.')
  await appendRich(page, right, 'Low water at the north jetty.', ' Right dirty words.')
  await switchToRaw(right)
  await expect(rich(left)).toContainText('Left dirty words.')
  await expect(raw(left)).toHaveCount(0)
  expect(await leftEditor?.evaluate(element => element.isConnected)).toBe(true)
  await expect(raw(right)).toContainText('Right dirty words.')
  await raw(right).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText('\nRaw words before its timer.\n')
  // Immediate mouse exit exercises forwarding from CodeMirror before its debounce saves.
  await switchToRich(right)
  await expect(rich(right)).toContainText('Raw words before its timer.')
  await expect(rich(left)).toContainText('Left dirty words.')
  await switchToRaw(left)
  await switchToRaw(right)
  await raw(right).click()
  await triggerMenuCommand(page, APP_COMMAND_IDS.editToggleRawEditor)
  await expect(rich(right)).toBeVisible()
  await expect(raw(left)).toBeVisible()
  // Exercise a real unrelated singleton config notification, without injecting pane modes.
  await page.evaluate(async () => {
    const modulePath = '/src/utils/vaultConfigStore.ts'
    const config = await import(/* @vite-ignore */ modulePath)
    config.updateVaultConfigField('zoom', 1.05)
  })
  await expect(raw(left)).toBeVisible()
  await expect(rich(right)).toBeVisible()
  releaseSaves()
  await triggerMenuCommand(page, APP_COMMAND_IDS.fileSave)
  await expect.poll(() => fixture.read(LANTERN)).toContain('Left dirty words.')
  await expect.poll(() => fixture.read(TIDE)).toContain('Raw words before its timer.')
  const saved = [fixture.read(LANTERN), fixture.read(TIDE)]

  await page.getByRole('button', { name: 'Stack pages', exact: true }).click()
  await page.getByRole('separator', { name: 'Resize page panes' }).press('ArrowDown')
  await left.getByRole('button', { name: 'Choose a page', exact: true }).press('Alt+Shift+ArrowDown')
  await expect(slot(page, 2)).toHaveAttribute('data-note-path', fixture.file(LANTERN))
  await expect(raw(slot(page, 2))).toBeVisible()
  await expect(rich(slot(page, 1))).toBeVisible()
  await slot(page, 2).getByRole('button', { name: 'Close pane', exact: true }).click()
  await page.getByRole('button', { name: 'Split right', exact: true }).click()
  await expect(raw(slot(page, 2))).toBeVisible()
  await expect(rich(slot(page, 1))).toBeVisible()

  const key = `leadinglight.workspace:${fixture.vault}`
  const snapshot = await page.evaluate(key => localStorage.getItem(key), key)
  expect(snapshot).not.toBeNull()
  expect(JSON.parse(snapshot!).editorModes).toEqual(['preview', 'raw'])
  // fixtureVault clears storage on navigation. Preserve this one synthetic workspace's real
  // snapshot across that reset, regardless of init-script ordering, to model a restart.
  await page.addInitScript(({ key, snapshot }) => {
    localStorage.setItem(key, snapshot)
    const clear = Storage.prototype.clear
    Storage.prototype.clear = function () { clear.call(this); if (this === localStorage) this.setItem(key, snapshot) }
  }, { key, snapshot: snapshot! })
  await page.reload()
  await expect(slot(page, 1)).toHaveAttribute('data-note-path', fixture.file(TIDE))
  await expect(slot(page, 2)).toHaveAttribute('data-note-path', fixture.file(LANTERN))
  await expect(rich(slot(page, 1))).toContainText('Raw words before its timer.')
  await expect(raw(slot(page, 2))).toContainText('Left dirty words.')
  expect([fixture.read(LANTERN), fixture.read(TIDE)]).toEqual(saved)
})
