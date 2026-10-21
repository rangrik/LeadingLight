import { test, expect, type Locator, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { createFixtureVaultCopy, openFixtureVaultDesktopHarness, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { executeCommand, openCommandPalette } from './helpers'

// Passage commentary in the browser, against the disk-backed development bridge, on disposable
// synthetic vaults only. Every persistence claim is checked on disk with fs, never from the UI. The
// bundled passage-commentary recipe is on by default; native durability is not established here.

const SOURCE = 'Topics/source.md'
const COMMENTARY = 'Topics/commentary-on-source-page.md'
const SOURCE_TEXT = [
  '# Source page',
  '',
  'The first passage to keep.',
  '',
  'A second thought worth quoting.',
  '',
  'Literal <b>html</b> and [[a link]] stay text.',
  '',
].join('\n')

let vault: string
const read = (relative: string) => fs.readFileSync(path.join(vault, relative), 'utf8')
const exists = (relative: string) => fs.existsSync(path.join(vault, relative))
const notesIn = (folder: string) => fs.readdirSync(path.join(vault, folder)).filter(name => name.endsWith('.md')).sort()
const pane = (page: Page, id: 0 | 1) => page.locator(`[data-pane-id="${id}"]`)
const dialog = (page: Page) => page.getByTestId('commentary-dialog')
const submitKey = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter'

async function openSource(page: Page) {
  await page.getByTestId('note-list-container').getByText('Source page', { exact: true }).click()
  await expect(pane(page, 0).locator('.bn-editor')).toBeVisible()
}

/** Selects one paragraph of a pane's rich editor the way a person would, then waits for the toolbar. */
async function selectParagraph(page: Page, where: Locator, text: string | RegExp) {
  await where.locator('.bn-editor').getByText(text, { exact: typeof text === 'string' }).first().click({ clickCount: 3 })
  await expect(page.getByRole('button', { name: 'Comment on passage' })).toBeVisible()
}

async function commentOn(page: Page, text: string) {
  await selectParagraph(page, pane(page, 0), text)
  await page.getByRole('button', { name: 'Comment on passage' }).click()
  await expect(dialog(page)).toBeVisible()
}

/** Wraps one frozen command's handler in the page so its next reply is lost after it ran. */
async function loseReplyOnce(page: Page, command: string) {
  await page.evaluate(command => {
    type Handler = (args?: unknown) => unknown
    const handlers = (window as unknown as { __mockHandlers: Record<string, Handler> }).__mockHandlers
    const original = handlers[command]
    if (typeof original !== 'function') throw new Error(`The browser bridge has no ${command} handler`)
    let fired = false
    handlers[command] = async (args?: unknown) => {
      const reply = await original(args)
      if (!fired) { fired = true; throw new Error('The reply was lost on the way back') }
      return reply
    }
  }, command)
}

test.describe('LeadingLight passage commentary', () => {
  test.beforeEach(async ({ page }) => {
    vault = createFixtureVaultCopy()
    fs.mkdirSync(path.join(vault, 'Topics'))
    fs.writeFileSync(path.join(vault, SOURCE), SOURCE_TEXT)
    // Reloads keep what the app saved (its pane layout), so the restore below is the app's own.
    await openFixtureVaultDesktopHarness(page, vault, { folders: [{ name: 'Topics', path: 'Topics', children: [] }], preserveStorageOnReload: true })
    await expect(page.getByTestId('note-list-container')).toBeVisible()
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(vault)
  })

  test('Cancel writes nothing; Create writes one linked note beside the source and never touches it @smoke', async ({ page }) => {
    await openSource(page)
    await commentOn(page, 'The first passage to keep.')
    await expect(dialog(page).getByTestId('commentary-passage')).toHaveText('The first passage to keep.')
    await expect(dialog(page).getByLabel('Your thoughts')).toBeFocused()
    await expect(dialog(page).getByTestId('commentary-destination')).toContainText('Will create Commentary on Source page beside this page.')
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog(page)).not.toBeVisible()
    expect(notesIn('Topics')).toEqual(['source.md'])

    await commentOn(page, 'The first passage to keep.')
    await dialog(page).getByLabel('Your thoughts').fill('Worth keeping')
    await dialog(page).getByTestId('commentary-submit').click()
    await expect(dialog(page)).not.toBeVisible()
    expect(read(SOURCE)).toBe(SOURCE_TEXT)
    expect(notesIn('Topics')).toEqual(['commentary-on-source-page.md', 'source.md'])
    const created = read(COMMENTARY)
    expect(created).toMatch(/^---\n_leadinglight_commentary:\n[\s\S]*\n---\n# Commentary on Source page\n\n\[Source\]\(\.\/source\.md\)\n\n> The first passage to keep\.\n\nWorth keeping\n$/)
    expect(created.match(/^# /gm)).toHaveLength(1)
    // Opened beside the source, which keeps its pane; the note says what happened and offers Undo.
    await expect(pane(page, 0)).toHaveAttribute('data-note-path', /\/Topics\/source\.md$/)
    await expect(pane(page, 1).getByTestId('commentary-notice')).toContainText('Created beside Source page.')
    await expect(pane(page, 1).getByTestId('commentary-source-card')).toContainText('Source: Source page')
    await expect(pane(page, 0).getByTestId('commentary-header')).toBeVisible()

    await page.reload()
    await expect(page.getByTestId('note-list-container')).toBeVisible()
    // Both panes come back from the layout the app saved, the source still first.
    await expect(pane(page, 0)).toHaveAttribute('data-note-path', /\/Topics\/source\.md$/)
    await expect(pane(page, 1)).toHaveAttribute('data-note-path', /\/Topics\/commentary-on-source-page\.md$/)
    await expect(pane(page, 1).getByTestId('commentary-source-card')).toContainText('Source: Source page')
    await expect(pane(page, 0).getByTestId('commentary-header')).toBeVisible()
    expect(read(SOURCE)).toBe(SOURCE_TEXT)
    expect(read(COMMENTARY)).toBe(created)
  })

  test('a second passage adds one entry to the same note, and Undo restores its exact earlier bytes @smoke', async ({ page }) => {
    await openSource(page)
    await commentOn(page, 'The first passage to keep.')
    await dialog(page).getByLabel('Your thoughts').fill('First')
    await page.keyboard.press(submitKey)
    await expect(dialog(page)).not.toBeVisible()
    const first = read(COMMENTARY)

    await commentOn(page, 'A second thought worth quoting.')
    await expect(dialog(page).getByTestId('commentary-destination')).toContainText('Will add to Commentary on Source page.')
    await expect(dialog(page).getByTestId('commentary-pane-effect')).toHaveText('Already open beside this page.')
    await dialog(page).getByLabel('A question to come back to').fill('Why twice?')
    await dialog(page).getByTestId('commentary-submit').click()
    await expect(dialog(page)).not.toBeVisible()
    const second = read(COMMENTARY)
    // One entry added at the end; the title, Source line and earlier entry are byte for byte the same.
    const bodyOf = (text: string) => text.slice(text.indexOf('\n---\n') + 5)
    expect(bodyOf(second).startsWith(bodyOf(first))).toBe(true)
    expect(second.match(/^# /gm)).toHaveLength(1)
    expect(second.match(/^\[Source\]/gm)).toHaveLength(1)
    expect(second).toMatch(/> The first passage to keep\.\n\nFirst\n\n> A second thought worth quoting\.\n\n- Question: Why twice\?\n$/)
    expect(read(SOURCE)).toBe(SOURCE_TEXT)

    const notice = pane(page, 1).getByTestId('commentary-notice')
    await expect(notice).toContainText('Added to this note.')
    await notice.getByTestId('commentary-undo').click()
    await expect(notice).toHaveCount(0)
    await expect.poll(() => read(COMMENTARY)).toBe(first)
  })

  test('the palette asks for a selection first, and keeps a hostile passage literal through the dialog and the note', async ({ page }) => {
    await openSource(page)
    await pane(page, 0).locator('.bn-editor').getByText('The first passage to keep.', { exact: true }).click()
    await openCommandPalette(page)
    await executeCommand(page, 'Comment on passage')
    await expect(page.getByText('Select a passage first, then choose Comment on passage.')).toBeVisible()
    await expect(dialog(page)).toHaveCount(0)

    // The rich editor shows this line rendered; the passage is whatever it shows, kept literally.
    await selectParagraph(page, pane(page, 0), /^Literal/)
    await openCommandPalette(page)
    await executeCommand(page, 'Comment on passage')
    await expect(dialog(page)).toBeVisible()
    const quote = dialog(page).getByTestId('commentary-passage')
    await expect(quote.locator('b, img, a')).toHaveCount(0)
    const shown = await quote.textContent()
    await page.keyboard.type('Keyboard only')
    await page.keyboard.press(submitKey)
    await expect(dialog(page)).not.toBeVisible()
    // The record keeps exactly the passage shown, as base64 no wikilink rewrite can match.
    const exact = /^\s+exact: "([A-Za-z0-9+/=]*)"$/m.exec(read(COMMENTARY))?.[1] ?? ''
    expect(Buffer.from(exact, 'base64').toString('utf8')).toBe(shown)
    expect(read(SOURCE)).toBe(SOURCE_TEXT)
  })

  test('Separate note creates a numbered note; the next passage asks which note to add to', async ({ page }) => {
    await openSource(page)
    await commentOn(page, 'The first passage to keep.')
    await page.keyboard.press(submitKey)
    await expect(dialog(page)).not.toBeVisible()

    await commentOn(page, 'A second thought worth quoting.')
    await dialog(page).getByTestId('commentary-separate').click()
    await expect(dialog(page).getByTestId('commentary-destination')).toContainText('Will create a new note, Commentary on Source page 2, beside this page.')
    await dialog(page).getByTestId('commentary-submit').click()
    await expect(dialog(page)).not.toBeVisible()
    expect(notesIn('Topics')).toEqual(['commentary-on-source-page-2.md', 'commentary-on-source-page.md', 'source.md'])

    await commentOn(page, 'The first passage to keep.')
    await expect(dialog(page).getByTestId('commentary-target')).toBeVisible()
    await dialog(page).getByTestId('commentary-target').click()
    await expect(page.getByRole('option')).toHaveText(['Commentary on Source page 2', 'Commentary on Source page', 'New separate note'])
  })

  test('a lost Add reply offers only Check again, which finds the one entry without writing another', async ({ page }) => {
    await openSource(page)
    await commentOn(page, 'The first passage to keep.')
    await page.keyboard.press(submitKey)
    await expect(dialog(page)).not.toBeVisible()

    await commentOn(page, 'A second thought worth quoting.')
    await loseReplyOnce(page, 'submit_document_proposal')
    await dialog(page).getByTestId('commentary-submit').click()
    await expect(dialog(page).getByTestId('commentary-check')).toBeVisible()
    await expect(dialog(page).getByTestId('commentary-submit')).toHaveCount(0)
    await expect.poll(() => (read(COMMENTARY).match(/^> /gm) ?? []).length).toBe(2)
    await dialog(page).getByTestId('commentary-check').click()
    await expect(dialog(page)).not.toBeVisible()
    expect((read(COMMENTARY).match(/^> /gm) ?? []).length).toBe(2)
  })

  test('turning the recipe off hides the action; the source card and Commentary button keep working', async ({ page }) => {
    await openSource(page)
    await commentOn(page, 'The first passage to keep.')
    await page.keyboard.press(submitKey)
    await expect(dialog(page)).not.toBeVisible()

    await openCommandPalette(page)
    await executeCommand(page, 'Open Settings')
    const settings = page.getByTestId('settings-panel')
    const nav = settings.getByRole('button', { name: 'Extensions', exact: true })
    if (await nav.isVisible()) await nav.click()
    else await settings.locator('#settings-section-extensions').scrollIntoViewIfNeeded()
    const row = page.locator('[data-testid="extension-row"][data-package-id="leadinglight.passage-commentary"]')
    await expect(row.getByTestId('extension-chip')).toHaveText('On')
    await row.getByTestId('extension-switch').click()
    await expect(row.getByTestId('extension-chip')).toHaveText('Off')
    await settings.getByTitle('Close settings', { exact: true }).click()

    await pane(page, 0).locator('.bn-editor').getByText('A second thought worth quoting.', { exact: true }).click({ clickCount: 3 })
    await expect(page.getByRole('button', { name: 'Comment on passage' })).toHaveCount(0)
    await expect(pane(page, 1).getByTestId('commentary-source-card')).toContainText('Source: Source page')
    await expect(pane(page, 0).getByTestId('commentary-header')).toBeVisible()
    expect(exists(COMMENTARY)).toBe(true)
  })
})
