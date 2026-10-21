import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { adaptFixtureSent, installAdaptFixture, type AdaptFixtureTurn } from '../helpers/adaptFixture'
import { createFixtureVaultCopy, openFixtureVaultDesktopHarness, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { executeCommand, openCommandPalette } from './helpers'

// Ask LeadingLight about attached text, in the browser over the disk-backed development bridge, on
// disposable synthetic vaults. Replies come from the explicit Adapt fixture (docs/leadinglight/adapt-browser.md):
// this proves the interface, never a live provider. Every page read and every page-text search is
// counted where it happens, at the disk routes; page bytes are checked with fs.

const SOURCE = 'Topics/source.md'
const OTHER = 'Topics/other.md'
const SOURCE_TEXT = ['# Source page', '', 'The first passage to keep.', '', 'A second thought worth quoting.', ''].join('\n')
const OTHER_TEXT = ['# Other page', '', 'Notes on the other page.', ''].join('\n')
// An answer that tries everything a passive preview must never do; nothing listens on port 9.
const HOSTILE = [
  '## In plain words',
  '',
  'Sleep helps **memory**. See [the study](http://127.0.0.1:9/study) and ![chart](http://127.0.0.1:9/chart.png).',
  '',
  '<script>window.__askPwned = 1</script>',
  '',
  '<img src="http://127.0.0.1:9/raw.png" onerror="window.__askPwned = 2">',
  '',
  '[[Private page]] stays text.',
].join('\n')
const answer = (text: string): AdaptFixtureTurn => ({ reply: { kind: 'answer', message: 'Here is a plain explanation.', answer: text } })

let vault: string
const reads: string[] = []
/** The `query` of every page-text search (`search_vault`) the app asks the disk backend for. */
const searches: string[] = []
const foreign: string[] = []
/** E2's commentary discovery searches for its record key when a page is shown (CommentaryServices). */
const DISCOVERY_QUERY = '_leadinglight_commentary'

/** Starts measuring Ask: from here on every read or search is Ask's, none is filtered out. */
function measure() {
  reads.length = 0
  searches.length = 0
}
const dialog = (page: Page) => page.getByTestId('adapt-dialog')
const pane = (page: Page) => page.locator('[data-pane-id="0"]')

async function start(page: Page, turns: AdaptFixtureTurn[]) {
  measure()
  foreign.length = 0
  vault = createFixtureVaultCopy()
  fs.mkdirSync(path.join(vault, 'Topics'))
  fs.writeFileSync(path.join(vault, SOURCE), SOURCE_TEXT)
  fs.writeFileSync(path.join(vault, OTHER), OTHER_TEXT)
  await installAdaptFixture(page, { fixture: 'leadinglight.adapt-fixture/1', account: 'connected', turns })
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname === '/api/vault/content') reads.push(url.searchParams.get('path') ?? '')
    if (url.pathname === '/api/vault/search') searches.push(url.searchParams.get('query') ?? '')
    if (url.port === '9') foreign.push(url.href)
  })
  // Reloads keep what the app saved itself (its layout and Ask's local memory).
  await openFixtureVaultDesktopHarness(page, vault, { folders: [{ name: 'Topics', path: 'Topics', children: [] }], preserveStorageOnReload: true })
  // The Topics folder lists only the two synthetic pages. The note list then preloads the page next to
  // the selected one (its own "likely next" reads, unrelated to Ask), and that is exactly other.md.
  await page.getByTestId('folder-row:Topics').click()
  await page.getByTestId('note-list-container').getByText('Source page', { exact: true }).click()
  await expect(pane(page).locator('.bn-editor')).toBeVisible()
  // Start-up work settles before Ask is measured, on its own precise signals: the note list's preload
  // of its one neighbour, and E2's discovery search for the shown page. Neither is repeated later.
  await expect.poll(() => reads.some(read => read.endsWith('/Topics/other.md'))).toBe(true)
  await expect.poll(() => searches.includes(DISCOVERY_QUERY)).toBe(true)
}

async function command(page: Page, name: string) {
  await openCommandPalette(page)
  await executeCommand(page, name)
}

async function send(page: Page, request: string) {
  await dialog(page).getByTestId('adapt-request').fill(request)
  await dialog(page).getByTestId('adapt-send').click()
}

test.describe('Ask LeadingLight about attached text', () => {
  test.describe.configure({ timeout: 60_000 })

  test.afterEach(() => {
    removeFixtureVaultCopy(vault)
  })

  test('opening reads and attaches nothing; Ask about this page sends exactly that page; the answer is inert and Copy is exact @smoke', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await start(page, [answer(HOSTILE)])
    measure()
    await expect(page.getByTestId('sidebar-adapt')).toHaveText('Ask LeadingLight…')
    await page.getByTestId('sidebar-adapt').click()
    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page).getByTestId('adapt-chip')).toHaveCount(0)
    await expect(dialog(page).getByTestId('adapt-sends-what'))
      .toHaveText('Send includes this request, the attachments above and LeadingLight’s guide. Nothing else from your workspace.')
    expect(reads).toEqual([])
    expect(searches).toEqual([])
    expect(await adaptFixtureSent(page)).toEqual([])
    await dialog(page).getByTestId('adapt-keep-writing').click()

    await command(page, 'Ask about this page…')
    await expect(dialog(page).getByTestId('adapt-chip-toggle')).toContainText('Source page')
    expect(await dialog(page).getByTestId('adapt-chip-text').textContent()).toBe(SOURCE_TEXT)
    // The page in front is taken from its editor once saved; nothing else is read or searched for it.
    expect(reads).toEqual([])
    expect(searches).toEqual([])
    await send(page, 'Explain this')

    const shown = dialog(page).getByTestId('adapt-answer')
    await expect(shown.getByTestId('adapt-answer-formatted')).toContainText('<script>window.__askPwned = 1</script>')
    await expect(shown.getByRole('heading', { name: 'In plain words' })).toBeVisible()
    expect(await shown.locator('a, img, iframe, script, [href], [src], [onerror]').count()).toBe(0)
    expect(await page.evaluate(() => (window as { __askPwned?: unknown }).__askPwned)).toBeUndefined()
    const [sent] = await adaptFixtureSent(page)
    expect(sent).toMatchObject({ request: 'Explain this', attachments: [{ kind: 'pageSnapshot', label: 'Source page', text: SOURCE_TEXT }], earlierTurns: [] })
    expect(JSON.stringify(sent)).not.toContain(vault)

    await shown.getByTestId('adapt-answer-copy').click()
    await expect(shown.getByTestId('adapt-answer-copied')).toHaveText('Copied.')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(HOSTILE)
    expect(foreign).toEqual([])
    expect(fs.readFileSync(path.join(vault, SOURCE), 'utf8')).toBe(SOURCE_TEXT)
  })

  test('a selected passage is taken only by its own command, labelled by its page; with nothing selected it says so', async ({ page }) => {
    await start(page, [answer('Plain words.')])
    const passage = pane(page).locator('.bn-editor').getByText('The first passage to keep.', { exact: true })
    await passage.click()
    await command(page, 'Ask about this passage')
    await expect(page.getByText('Select a passage first, then choose Ask about this passage.')).toBeVisible()
    await expect(dialog(page)).toHaveCount(0)

    await passage.click({ clickCount: 3 })
    await command(page, 'Ask about this passage')
    await expect(dialog(page).getByTestId('adapt-chip-toggle')).toContainText('Passage from Source page')
    // A triple-click selects the paragraph up to the next block, so the editor's own capture ends with
    // that block break. It is kept exactly: the chip shows and Send carries what was selected.
    const selected = 'The first passage to keep.\n'
    expect(await dialog(page).getByTestId('adapt-chip-text').textContent()).toBe(selected)
    await send(page, 'Explain this')
    await expect(dialog(page).getByTestId('adapt-answer')).toContainText('Plain words.')
    const [sent] = await adaptFixtureSent(page)
    expect(sent.attachments).toEqual([{ kind: 'pastedText', label: 'Passage from Source page', text: selected }])
    expect(fs.readFileSync(path.join(vault, SOURCE), 'utf8')).toBe(SOURCE_TEXT)
  })

  test('Another page… picks through the finder, reads only that page from disk, and a removed chip is not sent', async ({ page }) => {
    await start(page, [answer('Fine.')])
    await page.getByTestId('sidebar-adapt').click()
    await expect(dialog(page)).toBeVisible()
    measure()
    await dialog(page).getByTestId('adapt-attach').click()
    await page.getByRole('menuitem', { name: 'Another page…' }).click()
    const finder = page.getByRole('dialog', { name: 'Choose a page to attach' })
    await expect(finder).toBeVisible()
    await expect(dialog(page)).toHaveCount(0)
    await finder.getByRole('combobox').fill('Other page')
    await expect(finder.getByRole('option', { name: /Other page/ }).first()).toBeVisible()
    // Past the finder's 200 ms page-text search delay: choosing a page searches and reads no page text.
    await page.waitForTimeout(800)
    expect(searches).toEqual([])
    expect(reads).toEqual([])
    await finder.getByRole('option', { name: /Other page/ }).first().click()

    await expect(dialog(page).getByTestId('adapt-chip-toggle')).toContainText('Other page')
    expect(await dialog(page).getByTestId('adapt-chip-text').textContent()).toBe(OTHER_TEXT)
    // Only the chosen page is read, once.
    expect(reads).toHaveLength(1)
    expect(reads[0]).toMatch(/\/Topics\/other\.md$/)
    expect(searches).toEqual([])
    // Choosing a page attaches it; it does not open it.
    await expect(pane(page)).toHaveAttribute('data-note-path', /\/Topics\/source\.md$/)

    await dialog(page).getByRole('button', { name: 'Remove Other page' }).click()
    await send(page, 'What should I read next?')
    await expect(dialog(page).getByTestId('adapt-answer')).toContainText('Fine.')
    const [sent] = await adaptFixtureSent(page)
    expect(sent.attachments).toEqual([])
    expect(JSON.stringify(sent)).not.toContain('Notes on the other page.')
  })

  test('Ask about this page returns to that page’s conversation as stored, also after a reload, and sends nothing by itself', async ({ page }) => {
    await start(page, [answer('First answer.')])
    await command(page, 'Ask about this page…')
    await send(page, 'Summarize this page')
    await expect(dialog(page).getByTestId('adapt-answer')).toContainText('First answer.')
    await dialog(page).getByTestId('adapt-new-request').click()
    await dialog(page).getByTestId('adapt-keep-writing').click()

    await page.reload()
    await expect(pane(page)).toHaveAttribute('data-note-path', /\/Topics\/source\.md$/)
    await command(page, 'Ask about this page…')
    await expect(dialog(page).getByTestId('adapt-answer')).toContainText('First answer.')
    await expect(dialog(page).getByTestId('adapt-chip')).toHaveCount(1)
    await expect(dialog(page).getByTestId('adapt-earlier-warning')).toBeVisible()
    expect(await adaptFixtureSent(page)).toEqual([])
  })
})
