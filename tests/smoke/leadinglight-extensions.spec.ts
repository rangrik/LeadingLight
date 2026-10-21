import { test, expect, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createFixtureVaultCopy, openFixtureVaultDesktopHarness, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { executeCommand, openCommandPalette } from './helpers'

// E1 local extensions in the browser, against the disk-backed development bridge, on disposable
// synthetic vaults only. The desktop harness routes `invoke` to window.__mockHandlers, which must
// hold the extension and proposal commands (native/browser lane); faults are injected there by
// their frozen command names. Persistence claims are checked on disk with fs, never from the UI.

// The bundled package as the native lane ships it (src-tauri/.../bundled/meeting-debrief.json).
const BUNDLED = 'leadinglight.meeting-debrief'
const FIXTURES = path.resolve('src/leadinglight/extensions/fixtures')
const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name), 'utf8')

let vault: string
let suffix: string

/** Each test stores packages under its own id, so an earlier test's candidates never interfere. */
function dailyDebrief(version = '1.0.0', layout: 'quote' | 'heading' = 'quote') {
  return JSON.stringify({
    schema: 'leadinglight.extension/1', id: `local.daily-debrief-${suffix}`, version, name: 'Daily debrief',
    description: 'One win at the end of the day.', capabilities: ['document.create', 'document.open'],
    commands: [{ id: 'evening', title: 'Evening reflection', steps: [
      { id: 'form', op: 'collectForm', fields: [{ id: 'win', kind: 'text', label: 'One win', required: true }] },
      { id: 'where', op: 'resolveDestination', policy: 'newInChosenFolder' },
      { id: 'note', op: 'composeDocument', title: ['Evening: ', { step: 'form', field: 'win' }],
        blocks: layout === 'quote' ? [{ type: 'quote', text: [{ step: 'form', field: 'win' }] }] : [{ type: 'heading', level: 3, text: ['Win'] }, { type: 'paragraph', text: [{ step: 'form', field: 'win' }] }] },
      { id: 'save', op: 'proposeDocument' },
      { id: 'open', op: 'openCommittedResult' },
    ] }],
  }, null, 2)
}

/** Every file under the vault with its digest; a preview must leave this exactly as it was. */
function vaultState(root = vault): Record<string, string> {
  const state: Record<string, string> = {}
  const walk = (dir: string) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name)
      if (item.isDirectory()) walk(full)
      else state[path.relative(root, full)] = createHash('sha256').update(fs.readFileSync(full)).digest('hex')
    }
  }
  walk(root)
  return state
}
const notesIn = (folder: string) => fs.existsSync(path.join(vault, folder)) ? fs.readdirSync(path.join(vault, folder)).filter(name => name.endsWith('.md')).sort() : []
const read = (relative: string) => fs.readFileSync(path.join(vault, relative), 'utf8')

async function openExtensionsSettings(page: Page) {
  await openCommandPalette(page)
  await executeCommand(page, 'Open Settings')
  const panel = page.getByTestId('settings-panel')
  await expect(panel).toBeVisible()
  // The section navigation is shown from the md breakpoint up; below it the sections are one
  // scrolling column, so a compact window scrolls to the Extensions section itself.
  const nav = panel.getByRole('button', { name: 'Extensions', exact: true })
  if (await nav.isVisible()) await nav.click()
  else await panel.locator('#settings-section-extensions').scrollIntoViewIfNeeded()
  await expect(page.getByTestId('extension-settings')).toBeVisible()
}
const row = (page: Page, packageId: string) => page.locator(`[data-testid="extension-row"][data-package-id="${packageId}"]`)
const runDialog = (page: Page) => page.getByTestId('extension-run-dialog')

/**
 * The header's X. The full-size backdrop button underneath the panel has the same accessible name
 * ("Close settings") but no title, so the title picks the visible control a person clicks.
 */
async function closeSettings(page: Page) {
  const close = page.getByTestId('settings-panel').getByTitle('Close settings', { exact: true })
  await expect(close).toHaveCount(1)
  await close.click()
  await expect(page.getByTestId('settings-panel')).not.toBeVisible()
}

async function turnOnFromPreview(page: Page, packageId: string) {
  await row(page, packageId).getByTestId('extension-switch').click()
  const preview = page.getByTestId('extension-preview-dialog')
  await expect(preview).toBeVisible()
  await preview.getByTestId('extension-turn-on').click()
  await expect(row(page, packageId).getByTestId('extension-chip')).toHaveText('On')
}

async function importPackage(page: Page, text: string) {
  await page.getByTestId('extension-paste').click()
  const dialog = page.getByTestId('extension-import-dialog')
  await dialog.getByLabel('Paste the extension text').fill(text)
  await dialog.getByTestId('extension-import-check').click()
}

async function chooseFolder(page: Page, folder: string) {
  await runDialog(page).getByTestId('extension-folder').click()
  await page.getByRole('option', { name: folder, exact: true }).click()
}

/** Wraps one frozen command's handler in the page; the original still runs unless the fault says not. */
async function injectFault(page: Page, command: string, fault: 'loseReplyOnce' | 'holdReply') {
  await page.evaluate(({ command, fault }) => {
    type Handler = (args?: unknown) => unknown
    const handlers = (window as unknown as { __mockHandlers: Record<string, Handler> }).__mockHandlers
    const original = handlers[command]
    if (typeof original !== 'function') throw new Error(`The browser bridge has no ${command} handler`)
    const state = window as unknown as { __llFaults?: Record<string, { release?: () => void; fired?: boolean }> }
    state.__llFaults ??= {}
    const entry: { release?: () => void; fired?: boolean } = {}
    state.__llFaults[command] = entry
    handlers[command] = async (args?: unknown) => {
      if (fault === 'holdReply' && !entry.fired) {
        entry.fired = true
        await new Promise<void>(release => { entry.release = release })
        return original(args)
      }
      const reply = await original(args)
      if (fault === 'loseReplyOnce' && !entry.fired) {
        entry.fired = true
        throw new Error('The reply was lost on the way back')
      }
      return reply
    }
  }, { command, fault })
}
const releaseFault = (page: Page, command: string) => page.evaluate(command => {
  (window as unknown as { __llFaults: Record<string, { release?: () => void }> }).__llFaults[command].release?.()
}, command)
const faultCount = (page: Page, command: string) => page.evaluate(command =>
  Boolean((window as unknown as { __llFaults?: Record<string, { fired?: boolean }> }).__llFaults?.[command]?.fired), command)

test.describe('LeadingLight local extensions', () => {
  test.beforeEach(async ({ page }, info) => {
    suffix = `${Date.now().toString(36)}${info.workerIndex}`
    vault = createFixtureVaultCopy()
    fs.mkdirSync(path.join(vault, 'Meetings'))
    await openFixtureVaultDesktopHarness(page, vault, { folders: [{ name: 'Meetings', path: 'Meetings', children: [] }] })
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(vault)
  })

  test('bundled debrief starts off, previews with no disk writes, turns on once, creates and survives reload @smoke', async ({ page }) => {
    await openExtensionsSettings(page)
    await expect(row(page, BUNDLED).getByTestId('extension-chip')).toHaveText('Off')
    await expect(page.getByTestId('extension-backup-limitation')).toContainText('Workspace backups don’t include them yet')
    await expect(page.getByTestId('sidebar-top-nav').getByRole('button', { name: 'From extension…' })).toHaveCount(0)

    const before = vaultState()
    await row(page, BUNDLED).getByTestId('extension-preview').click()
    const preview = page.getByTestId('extension-preview-dialog')
    await expect(preview.getByText('This preview writes nothing.')).toBeVisible()
    await expect(preview.getByTestId('extension-preview-sample')).toContainText('Debrief: Sample answer')
    await preview.getByRole('button', { name: 'Not now' }).click()
    expect(vaultState()).toEqual(before)

    await turnOnFromPreview(page, BUNDLED)
    await page.getByTestId('extension-try').click()
    await expect(runDialog(page)).toBeVisible()
    await runDialog(page).getByLabel('Meeting', { exact: false }).fill('Weekly sync')
    await runDialog(page).getByLabel('Decisions', { exact: false }).fill('Ship on Friday')
    await chooseFolder(page, 'Meetings')
    await expect(runDialog(page).getByTestId('extension-destination')).toHaveText('Will create Meetings/debrief-weekly-sync.md')
    await runDialog(page).getByTestId('extension-run-create').click()
    await expect(runDialog(page)).not.toBeVisible()
    expect(notesIn('Meetings')).toEqual(['debrief-weekly-sync.md'])
    expect(read('Meetings/debrief-weekly-sync.md')).toMatch(/^# Debrief: Weekly sync\n\n[\s\S]*## Decisions\n\nShip on Friday\n/)

    await page.reload()
    await expect(page.getByTestId('note-list-container')).toBeVisible()
    await expect(page.getByTestId('sidebar-top-nav').getByRole('button', { name: 'From extension…' })).toBeVisible()
    await expect(page.getByTestId('note-list-container').getByText('Debrief: Weekly sync').first()).toBeVisible()
    expect(notesIn('Meetings')).toEqual(['debrief-weekly-sync.md'])
  })

  test('a pasted custom package coexists and creates a different note; invalid and unsupported ones never run', async ({ page }) => {
    await openExtensionsSettings(page)
    await turnOnFromPreview(page, BUNDLED)

    await importPackage(page, fixture('invalid/folder-path.json'))
    await expect(page.getByTestId('extension-import-result')).toContainText('Where: /commands/0/steps/1/folder')
    await page.getByTestId('extension-import-dialog').getByRole('button', { name: 'Cancel' }).click()

    await importPackage(page, fixture('passage-commentary.json').replace('"local.passage-commentary"', `"local.passage-commentary-${suffix}"`))
    const commentary = page.getByTestId('extension-preview-dialog')
    await expect(commentary.getByTestId('extension-preview-needs')).toContainText('Needs: selecting text in a page')
    await expect(commentary.getByTestId('extension-turn-on')).toBeDisabled()
    await commentary.getByRole('button', { name: 'Not now' }).click()
    await expect(row(page, `local.passage-commentary-${suffix}`).getByTestId('extension-chip')).toHaveText('Unavailable in this version')

    await importPackage(page, dailyDebrief())
    await page.getByTestId('extension-preview-dialog').getByTestId('extension-turn-on').click()
    await expect(row(page, `local.daily-debrief-${suffix}`).getByTestId('extension-chip')).toHaveText('On')
    await closeSettings(page)

    await page.getByTestId('sidebar-top-nav').getByRole('button', { name: 'From extension…' }).click()
    const chooser = page.getByTestId('extension-chooser')
    await expect(chooser.getByTestId('extension-choice')).toHaveCount(2)
    await expect(chooser).not.toContainText('Comment on passage')
    await chooser.getByRole('button', { name: /Evening reflection/ }).click()
    await runDialog(page).getByLabel('One win', { exact: false }).fill('Fixed the sync bug')
    await runDialog(page).getByTestId('extension-run-create').click()
    await expect(runDialog(page)).not.toBeVisible()
    expect(read('evening-fixed-the-sync-bug.md')).toBe('# Evening: Fixed the sync bug\n\n> Fixed the sync bug\n')
  })

  test('keeps answers on a required-field error and a name collision, and retries only on Create', async ({ page }) => {
    fs.writeFileSync(path.join(vault, 'Meetings', 'debrief-weekly-sync.md'), '# Someone else’s note\n')
    const existing = read('Meetings/debrief-weekly-sync.md')
    await openExtensionsSettings(page)
    await turnOnFromPreview(page, BUNDLED)
    await page.getByTestId('extension-try').click()

    await runDialog(page).getByLabel('Who was there', { exact: false }).fill('Ana, Ben')
    await runDialog(page).getByTestId('extension-run-create').click()
    await expect(runDialog(page).getByText('Answer this before creating.').first()).toBeVisible()
    await expect(runDialog(page).getByLabel('Meeting', { exact: false })).toBeFocused()
    await expect(runDialog(page).getByLabel('Who was there', { exact: false })).toHaveValue('Ana, Ben')

    await runDialog(page).getByLabel('Meeting', { exact: false }).fill('Weekly sync')
    await runDialog(page).getByLabel('Decisions', { exact: false }).fill('Ship it')
    await chooseFolder(page, 'Meetings')
    await runDialog(page).getByTestId('extension-run-create').click()
    await expect(runDialog(page).getByTestId('extension-destination')).toContainText('A note named “debrief-weekly-sync.md” already exists in Meetings')
    expect(read('Meetings/debrief-weekly-sync.md')).toBe(existing)
    await expect(runDialog(page).getByLabel('Decisions', { exact: false })).toHaveValue('Ship it')

    await runDialog(page).getByLabel('Meeting', { exact: false }).fill('Weekly sync 2')
    await runDialog(page).getByTestId('extension-run-create').click()
    await expect(runDialog(page)).not.toBeVisible()
    expect(notesIn('Meetings')).toEqual(['debrief-weekly-sync-2.md', 'debrief-weekly-sync.md'])
    expect(read('Meetings/debrief-weekly-sync.md')).toBe(existing)
  })

  test('a lost write reply offers only Check again, which finds the one note without writing another', async ({ page }) => {
    await openExtensionsSettings(page)
    await turnOnFromPreview(page, BUNDLED)
    await page.getByTestId('extension-try').click()
    await injectFault(page, 'submit_document_proposal', 'loseReplyOnce')
    await runDialog(page).getByLabel('Meeting', { exact: false }).fill('Lost reply')
    await runDialog(page).getByLabel('Decisions', { exact: false }).fill('Recover it')
    await runDialog(page).getByTestId('extension-run-create').click()
    await expect(runDialog(page).getByTestId('extension-run-check')).toBeVisible()
    await expect(runDialog(page).getByTestId('extension-run-create')).toHaveCount(0)
    expect(await faultCount(page, 'submit_document_proposal')).toBe(true)
    // The write landed; only its reply was lost.
    expect(notesIn('.').filter(name => name.startsWith('debrief-lost-reply'))).toEqual(['debrief-lost-reply.md'])
    // ⌘Enter while uncertain is Check again: it queries the same operation and never writes again.
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
    await expect(runDialog(page)).not.toBeVisible()
    expect(notesIn('.').filter(name => name.startsWith('debrief-lost-reply'))).toEqual(['debrief-lost-reply.md'])
  })

  test('a delayed admission cannot be doubled, and a reload during a delayed write leaves at most one note', async ({ page }) => {
    await openExtensionsSettings(page)
    await turnOnFromPreview(page, BUNDLED)
    await page.getByTestId('extension-try').click()
    await injectFault(page, 'begin_extension_run', 'holdReply')
    await runDialog(page).getByLabel('Meeting', { exact: false }).fill('Slow start')
    await runDialog(page).getByLabel('Decisions', { exact: false }).fill('Wait')
    await runDialog(page).getByTestId('extension-run-create').click()
    await expect(runDialog(page).getByTestId('extension-run-create')).toHaveText('Creating…')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
    await page.keyboard.press('Escape')
    await expect(runDialog(page)).toBeVisible()
    await releaseFault(page, 'begin_extension_run')
    await expect(runDialog(page)).not.toBeVisible()
    expect(notesIn('.').filter(name => name.startsWith('debrief-slow-start'))).toEqual(['debrief-slow-start.md'])

    await page.getByTestId('sidebar-top-nav').getByRole('button', { name: 'From extension…' }).click()
    await injectFault(page, 'submit_document_proposal', 'holdReply')
    await runDialog(page).getByLabel('Meeting', { exact: false }).fill('Reloaded')
    await runDialog(page).getByLabel('Decisions', { exact: false }).fill('Mid write')
    await runDialog(page).getByTestId('extension-run-create').click()
    await expect(runDialog(page).getByTestId('extension-run-create')).toHaveText('Creating…')
    await page.reload()
    await expect(page.getByTestId('note-list-container')).toBeVisible()
    expect(notesIn('.').filter(name => name.startsWith('debrief-reloaded')).length).toBeLessThanOrEqual(1)
    await expect(page.getByTestId('sidebar-top-nav').getByRole('button', { name: 'From extension…' })).toBeVisible()
  })

  test('replacing a version and going back changes behaviour only; created notes keep their bytes', async ({ page }) => {
    const id = `local.daily-debrief-${suffix}`
    await openExtensionsSettings(page)
    await importPackage(page, dailyDebrief('1.0.0', 'quote'))
    await page.getByTestId('extension-preview-dialog').getByTestId('extension-turn-on').click()
    await expect(row(page, id).getByTestId('extension-chip')).toHaveText('On')
    await closeSettings(page)
    // The bundled debrief stays off here, so this is the only runnable command: its form opens directly.
    await page.getByTestId('sidebar-top-nav').getByRole('button', { name: 'From extension…' }).click()
    await expect(runDialog(page).getByRole('heading', { name: 'Evening reflection' })).toBeVisible()
    await expect(page.getByTestId('extension-chooser')).toHaveCount(0)
    await runDialog(page).getByLabel('One win', { exact: false }).fill('Version one')
    await runDialog(page).getByTestId('extension-run-create').click()
    await expect(runDialog(page)).not.toBeVisible()
    const first = read('evening-version-one.md')
    expect(first).toBe('# Evening: Version one\n\n> Version one\n')

    await openExtensionsSettings(page)
    await importPackage(page, dailyDebrief('2.0.0', 'heading'))
    const replace = page.getByTestId('extension-preview-dialog')
    await expect(replace.getByTestId('extension-preview-version')).toHaveText('Replaces version 1.0.0 with version 2.0.0.')
    await replace.getByTestId('extension-turn-on').click()
    await expect(row(page, id).getByTestId('extension-rollback')).toHaveText(/Go back to version 1\.0\.0/)
    expect(read('evening-version-one.md')).toBe(first)

    await row(page, id).getByTestId('extension-rollback').click()
    const confirm = page.getByTestId('extension-rollback-dialog')
    await expect(confirm).toContainText('Notes it created stay as they are')
    await confirm.getByTestId('extension-rollback-confirm').click()
    await expect(page.getByTestId('extension-notice')).toContainText('is back to version 1.0.0')
    expect(read('evening-version-one.md')).toBe(first)

    await row(page, id).getByTestId('extension-switch').click()
    await expect(page.getByTestId('extension-notice')).toContainText('Notes it created stay in your workspace.')
    await closeSettings(page)
    expect(read('evening-version-one.md')).toBe(first)
  })

  test('turning an extension off while its form is open revokes the form and keeps the answers', async ({ page }) => {
    await openExtensionsSettings(page)
    await turnOnFromPreview(page, BUNDLED)
    await page.getByTestId('extension-try').click()
    await runDialog(page).getByLabel('Meeting', { exact: false }).fill('Revoked')
    await runDialog(page).getByLabel('Decisions', { exact: false }).fill('Too late')
    // The dialog is modal; the change arrives as another window would make it, through the bridge.
    const reply = await page.evaluate(async ({ id, vaultPath }) => {
      const handlers = (window as unknown as { __mockHandlers: Record<string, (args?: unknown) => Promise<unknown>> }).__mockHandlers
      const list = await handlers.list_extensions({ vaultPath }) as { extensions: { packageId: string; activeSha256: string }[] }
      const active = list.extensions.find(item => item.packageId === id)!.activeSha256
      return handlers.deactivate_extension({ vaultPath, packageId: id, expectedActiveSha256: active })
    }, { id: BUNDLED, vaultPath: vault })
    expect(reply).toMatchObject({ status: 'inactive' })
    await runDialog(page).getByTestId('extension-run-create').click()
    await expect(runDialog(page).getByTestId('extension-run-status')).toContainText('so this form can’t be submitted. Your answers stay here to copy.')
    await expect(runDialog(page).getByLabel('Meeting', { exact: false })).toHaveValue('Revoked')
    expect(notesIn('.').filter(name => name.startsWith('debrief-revoked'))).toEqual([])
  })

  test('compact window: keyboard-only completion with the preview behind Show preview @smoke', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 820 })
    await openExtensionsSettings(page)
    await turnOnFromPreview(page, BUNDLED)
    await closeSettings(page)
    await openCommandPalette(page)
    await executeCommand(page, 'New page from extension')
    const dialog = runDialog(page)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Meeting', { exact: false })).toBeFocused()
    await page.keyboard.type('Compact sync')
    await page.keyboard.press('Tab')
    await page.keyboard.type('Ana')
    await page.keyboard.press('Tab')
    await page.keyboard.type('Decided on keyboard')
    await expect(dialog.getByRole('button', { name: 'Show preview' })).toBeVisible()
    await expect(dialog.getByTestId('extension-destination')).toBeVisible()
    await dialog.getByRole('button', { name: 'Show preview' }).focus()
    await page.keyboard.press('Enter')
    await expect(dialog.getByRole('button', { name: 'Hide preview' })).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
    await expect(dialog).not.toBeVisible()
    expect(read('debrief-compact-sync.md')).toMatch(/^# Debrief: Compact sync\n/)
  })

  test('Settings → Preview keeps Tab inside the preview, Escape closes only it, and focus returns', async ({ page }) => {
    await openExtensionsSettings(page)
    const previewButton = row(page, BUNDLED).getByTestId('extension-preview')
    await previewButton.focus()
    await page.keyboard.press('Enter')
    const preview = page.getByTestId('extension-preview-dialog')
    await expect(preview).toBeVisible()
    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press('Tab')
      expect(await preview.evaluate(element => element.contains(document.activeElement))).toBe(true)
    }
    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press('Shift+Tab')
      expect(await preview.evaluate(element => element.contains(document.activeElement))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(preview).not.toBeVisible()
    await expect(page.getByTestId('settings-panel')).toBeVisible()
    await expect(previewButton).toBeFocused()
  })
})
