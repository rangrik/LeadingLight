import { test, expect, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { adaptFixtureSent, adaptSamplePackage, installAdaptFixture, type AdaptFixtureScript } from '../helpers/adaptFixture'
import { createFixtureVaultCopy, openFixtureVaultDesktopHarness, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { executeCommand, openCommandPalette } from './helpers'

// Adapt in the browser. Without a fixture the provider is honestly unavailable. With the explicit,
// deterministic test fixture (docs/leadinglight/adapt-browser.md) replies are scripted: this proves
// the UI only, never a live provider. Extensions are stored, previewed, turned on and run by the real
// E1 path over the disk-backed development bridge, on disposable synthetic vaults; note creation is
// checked on disk with fs.

let vault: string
let id: string

/** Every note in the vault with its digest. */
function notes(root = vault): Record<string, string> {
  const state: Record<string, string> = {}
  const walk = (dir: string) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name)
      if (item.isDirectory()) walk(full)
      else if (item.name.endsWith('.md')) state[path.relative(root, full)] = createHash('sha256').update(fs.readFileSync(full)).digest('hex')
    }
  }
  walk(root)
  return state
}
const added = (before: Record<string, string>) => Object.keys(notes()).filter(file => !(file in before)).sort()

const adaptDialog = (page: Page) => page.getByTestId('adapt-dialog')
const preview = (page: Page) => page.getByTestId('extension-preview-dialog')
const lastCard = (page: Page) => adaptDialog(page).getByTestId('adapt-candidate').last()

async function openAdapt(page: Page) {
  await page.getByTestId('sidebar-adapt').click()
  await expect(adaptDialog(page)).toBeVisible()
}

async function ask(page: Page, text: string) {
  await adaptDialog(page).getByTestId('adapt-request').fill(text)
  await adaptDialog(page).getByTestId('adapt-send').click()
}

async function turnOnLatest(page: Page) {
  await lastCard(page).getByTestId('adapt-preview').click()
  await expect(preview(page)).toBeVisible()
  await expect(adaptDialog(page)).toHaveCount(0)
  await expect(preview(page).getByText('This preview writes nothing.')).toBeVisible()
  await preview(page).getByTestId('extension-turn-on').click()
  await expect(adaptDialog(page)).toBeVisible()
}

async function start(page: Page, script: Omit<AdaptFixtureScript, 'fixture'> | null) {
  if (script) await installAdaptFixture(page, { fixture: 'leadinglight.adapt-fixture/1', ...script })
  await openFixtureVaultDesktopHarness(page, vault)
}

test.describe('Adapt LeadingLight', () => {
  test.beforeEach(() => {
    id = `local.reading-log-${Date.now().toString(36)}${test.info().workerIndex}`
    vault = createFixtureVaultCopy()
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(vault)
  })

  test('without a fixture Codex is honestly unavailable and nothing can be sent @smoke', async ({ page }) => {
    await start(page, null)
    await openAdapt(page)
    await expect(adaptDialog(page).getByTestId('adapt-provider')).toContainText('Codex isn’t installed on this computer. LeadingLight doesn’t install it for you.')
    await expect(adaptDialog(page).getByTestId('adapt-claude')).toContainText('Claude isn’t available in this version.')
    await expect(adaptDialog(page).getByTestId('adapt-request')).toHaveCount(0)
    await expect(adaptDialog(page).getByTestId('adapt-connect')).toHaveCount(0)
  })

  test('asks, previews in E1, turns on, and Try it creates exactly one note @smoke', async ({ page }) => {
    await start(page, { connects: [{ result: 'connected' }], turns: [{ reply: { kind: 'candidate', message: 'A reading log with one question.', packageText: adaptSamplePackage(id) } }] })
    await openAdapt(page)
    await expect(adaptDialog(page).getByTestId('adapt-provider')).toContainText('This sign-in is only for LeadingLight.')
    await adaptDialog(page).getByTestId('adapt-connect').click()
    await expect(adaptDialog(page).getByTestId('adapt-connected')).toContainText('Codex · Connected')

    await adaptDialog(page).getByTestId('adapt-attach').click()
    await page.getByRole('menuitem', { name: 'Pasted text…' }).click()
    await adaptDialog(page).getByLabel('Text to attach').fill('Dune, chapter 3')
    await adaptDialog(page).getByTestId('adapt-paste-add').click()
    await expect(adaptDialog(page).getByTestId('adapt-chip')).toContainText('Pasted text')
    await expect(adaptDialog(page).getByTestId('adapt-sends-what')).toContainText('Nothing else from your workspace.')
    const before = notes()
    await ask(page, 'A reading log for what I read')

    await expect(lastCard(page)).toContainText('Checked by LeadingLight')
    await expect(lastCard(page)).toContainText('A new extension: Reading log')
    const [sent] = await adaptFixtureSent(page)
    expect(sent).toMatchObject({ request: 'A reading log for what I read', attachments: [{ kind: 'pastedText', label: 'Pasted text', text: 'Dune, chapter 3' }], changePackage: null })
    expect(JSON.stringify(sent)).not.toContain(vault)

    await turnOnLatest(page)
    await expect(adaptDialog(page).getByTestId('adapt-adoption')).toContainText('Reading log is on.')
    await expect(adaptDialog(page).getByTestId('adapt-chip')).toContainText('Reading log · 1.0.0')
    expect(added(before)).toEqual([])

    await adaptDialog(page).getByTestId('adapt-try').click()
    const run = page.getByTestId('extension-run-dialog')
    await expect(run).toBeVisible()
    await run.getByLabel('What did you read?', { exact: false }).fill('Dune')
    await run.getByTestId('extension-run-create').click()
    await expect(run).not.toBeVisible()
    expect(added(before)).toEqual(['reading-dune.md'])
    expect(fs.readFileSync(path.join(vault, 'reading-dune.md'), 'utf8')).toBe('# Reading: Dune\n\n> Dune\n')
    expect(await adaptFixtureSent(page)).toHaveLength(1)
  })

  test('revises the version turned on in the same chat, and Undo goes back without touching notes', async ({ page }) => {
    await start(page, {
      account: 'connected',
      turns: [
        { reply: { kind: 'candidate', message: 'Here it is.', packageText: adaptSamplePackage(id) } },
        { reply: { kind: 'candidate', message: 'Now with a heading.', packageText: adaptSamplePackage(id, '1.1.0', 'heading') } },
      ],
    })
    await openAdapt(page)
    await ask(page, 'A reading log')
    await expect(lastCard(page)).toContainText('A new extension: Reading log')
    await turnOnLatest(page)

    await expect(adaptDialog(page).getByTestId('adapt-chip')).toContainText('Reading log · 1.0.0')
    await ask(page, 'Use a heading instead of a quote')
    await expect(adaptDialog(page).getByTestId('adapt-candidate')).toHaveCount(2)
    await expect(lastCard(page)).toContainText('Changes Reading log: version 1.0.0 → 1.1.0.')
    const [, second] = await adaptFixtureSent(page)
    expect(second.changePackage).toMatchObject({ packageId: id })
    expect(second.earlierTurns).toHaveLength(1)
    expect(second.attachments.map(item => item.kind)).toEqual(['extension'])

    const before = notes()
    await lastCard(page).getByTestId('adapt-preview').click()
    await expect(preview(page).getByTestId('extension-preview-version')).toHaveText('Replaces version 1.0.0 with version 1.1.0.')
    await preview(page).getByTestId('extension-turn-on').click()
    await expect(lastCard(page).getByTestId('adapt-adoption')).toContainText('Reading log is on.')
    await lastCard(page).getByTestId('adapt-undo').click()
    await expect(lastCard(page).getByTestId('adapt-adoption')).toContainText('Reading log is back to version 1.0.0. Notes it created stay as they are.')
    expect(notes()).toEqual(before)
  })

  test('Keep writing from Settings leaves Settings, returns to the page, and keeps the request running', async ({ page }) => {
    await start(page, { account: 'connected', turns: [{ reply: { kind: 'question', message: 'Which folder?', choices: ['Reading'] }, hold: true }] })
    const note = page.getByTestId('note-list-container').getByText('Note B', { exact: true })
    await expect(note).toBeVisible({ timeout: 10_000 })
    await note.click()
    await expect(page.locator('.bn-editor[contenteditable="true"]')).toBeVisible({ timeout: 30_000 })

    await openCommandPalette(page)
    await executeCommand(page, 'Open Settings')
    const settings = page.getByTestId('settings-panel')
    await expect(settings).toBeVisible()
    const nav = settings.getByRole('button', { name: 'Extensions', exact: true })
    if (await nav.isVisible()) await nav.click()
    else await settings.locator('#settings-section-extensions').scrollIntoViewIfNeeded()
    await settings.getByTestId('extension-adapt').click()
    await expect(adaptDialog(page)).toBeVisible()
    await ask(page, 'A reading log')
    await expect(adaptDialog(page).getByTestId('adapt-status')).toContainText('Working…')

    await adaptDialog(page).getByTestId('adapt-keep-writing').click()
    await expect(adaptDialog(page)).toHaveCount(0)
    await expect(settings).not.toBeVisible()
    await expect(page.locator('.bn-editor')).toBeFocused()
    await expect(page.getByTestId('sidebar-adapt')).toHaveText('Working…')
    await page.getByTestId('sidebar-adapt').click()
    await expect(adaptDialog(page).getByTestId('adapt-status')).toContainText('Working…')
    expect(await adaptFixtureSent(page)).toHaveLength(1)
  })

  test('keeps the request through a failure, retries only on Try again, and stops on Cancel; compact and keyboard-only', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 820 })
    await start(page, {
      account: 'connected',
      turns: [{ output: 'Sure! Here is your extension.' }, { reply: { kind: 'question', message: 'Which folder?', choices: ['Reading'] }, hold: true }],
    })
    await openCommandPalette(page)
    await executeCommand(page, 'Ask LeadingLight…')
    await expect(adaptDialog(page)).toBeVisible()
    const request = adaptDialog(page).getByTestId('adapt-request')
    await expect(request).toBeFocused()
    await page.keyboard.type('A reading log')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')

    await expect(adaptDialog(page).getByTestId('adapt-failed')).toContainText('Codex’s answer wasn’t in a form LeadingLight can use. Your request is kept')
    await expect(request).toHaveValue('A reading log')
    await page.waitForTimeout(600)
    expect(await adaptFixtureSent(page)).toHaveLength(1)

    await adaptDialog(page).getByTestId('adapt-try-again').click()
    await expect(adaptDialog(page).getByTestId('adapt-status')).toContainText('Working…')
    expect(await adaptFixtureSent(page)).toHaveLength(2)
    await adaptDialog(page).getByTestId('adapt-cancel').click()
    await expect(adaptDialog(page).getByTestId('adapt-stopped')).toContainText('Stopped. Nothing was added.')
    await expect(request).toHaveValue('A reading log')

    await page.keyboard.press('Escape')
    await expect(adaptDialog(page)).toHaveCount(0)
    await page.getByTestId('sidebar-adapt').click()
    await expect(adaptDialog(page).getByTestId('adapt-request')).toHaveValue('A reading log')
  })
})
