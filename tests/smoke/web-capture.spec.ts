import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { createFixtureVaultCopy, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { webCaptureFixtureRequests, WEB_CAPTURE_FIXTURE_ORIGIN, type WebCaptureFixturePage } from '../helpers/webCaptureFixture'
import {
  closeSettings, expectPageReady, extensionRow, fetchWebPage, fromWebsite, LIGHTHOUSE, LIGHTHOUSE_PAGE, listedExtension, notePane, NOT_ARMED,
  openArmedWebCaptureVault, openExtensionSettings, recordExternalRequests, recordProposals, reloadWebCaptureVault, saveWebPage,
  syntheticPageHtml, vaultChanges, vaultSnapshot, webCaptureDialog, WEBSITE_PACKAGE,
} from '../helpers/webCaptureDiskFixture'
import { executeCommand, openCommandPalette } from './helpers'

// The website dialog's own flows on a disposable synthetic disk vault: Stop, a refused page saved as
// a link, a changed address, a page saved before, the recipe turned off, and a compact window. Pages
// are synthetic, answered in the page for the reserved `.invalid` origin only; every write is checked
// on disk with fs against the exact proposal. Exact bytes, the dirty pane, reload, Undo, collisions
// and a lost reply are in web-capture-disk.spec.ts; both share tests/helpers/webCaptureDiskFixture.ts.
// Each test needs the dev server started with LEADINGLIGHT_DEV_WEB_CAPTURE_FIXTURE=1 and skips,
// saying so, without it; the page without the renderer fixture is covered there too.

const { title: TITLE, file: FILE, copy: COPY, requested: REQUESTED, final: FINAL } = LIGHTHOUSE
const SLOW = `${WEB_CAPTURE_FIXTURE_ORIGIN}/slow`
const MEMBERS = `${WEB_CAPTURE_FIXTURE_ORIGIN}/members`
const SECOND = `${WEB_CAPTURE_FIXTURE_ORIGIN}/markdown-notes`
const AGAIN = `${WEB_CAPTURE_FIXTURE_ORIGIN}/lighthouse-again`
const PAGES: WebCaptureFixturePage[] = [
  LIGHTHOUSE_PAGE,
  { url: SLOW, html: syntheticPageHtml('article'), delayMs: 8_000 },
  { url: MEMBERS, failure: 'accessDenied' },
  { url: SECOND, html: syntheticPageHtml('literals') },
  // Another address that arrives at the saved page's final address.
  { url: AGAIN, finalUrl: FINAL, html: syntheticPageHtml('article') },
]
const COMMAND_INPUT = 'input[placeholder="Type a command..."]'

let vault: string
const read = (relative: string) => fs.readFileSync(path.join(vault, relative), 'utf8')

async function openArmed(page: Page) {
  test.skip(!(await openArmedWebCaptureVault(page, vault, PAGES)), NOT_ARMED)
}

/** Types the saved note's source: found as saved before with no request, and its copy opens. */
async function openSavedCopy(page: Page, requestsSoFar: readonly string[]) {
  await fromWebsite(page).click()
  await page.getByTestId('web-capture-address').fill(FINAL)
  await page.getByTestId('web-capture-fetch').click()
  await expect(page.getByTestId('web-capture-saved-before')).toContainText(`You saved this page before: ${TITLE}, in Workspace folder.`)
  await expect(page.getByTestId('web-capture-fetch')).toHaveText('Fetch anyway')
  expect(await webCaptureFixtureRequests(page)).toEqual(requestsSoFar)
  await page.getByTestId('web-capture-open-saved').click()
  await expect(webCaptureDialog(page)).toHaveCount(0)
  await expect(notePane(page, FILE).locator('.bn-editor').getByRole('heading', { name: TITLE })).toBeVisible()
}

test.describe('LeadingLight Save from website dialog', () => {
  test.describe.configure({ timeout: 90_000 })

  test.beforeEach(() => {
    vault = createFixtureVaultCopy()
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(vault)
  })

  test('Stop keeps the address; a refused page is saved as a link with exactly its proposed bytes', async ({ page }) => {
    const external = recordExternalRequests(page)
    const proposals = recordProposals(page)
    await openArmed(page)
    const before = vaultSnapshot(vault)

    await fromWebsite(page).click()
    await page.getByTestId('web-capture-address').fill(SLOW)
    await page.getByTestId('web-capture-fetch').click()
    await expect(page.getByTestId('web-capture-status')).toContainText('Fetching fixtures.leadinglight.invalid')
    await page.getByTestId('web-capture-stop').click()
    await expect(page.getByTestId('web-capture-status')).toHaveText('Stopped.')
    await expect(page.getByTestId('web-capture-address')).toHaveValue(SLOW)
    await expect(page.getByTestId('web-capture-address')).toBeFocused()
    expect(proposals()).toEqual([])

    await page.getByTestId('web-capture-address').fill(MEMBERS)
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('web-capture-failure')).toHaveAttribute('data-failure', 'accessDenied')
    await expect(page.getByTestId('web-capture-address')).toHaveValue(MEMBERS)
    await page.getByTestId('web-capture-link-only').click()
    await expectPageReady(page)
    await saveWebPage(page)

    const sent = proposals()
    expect(sent).toHaveLength(1)
    expect(read(sent[0].fileName)).toBe(sent[0].content)
    expect(sent[0].content.startsWith(`---\nsource: "${MEMBERS}"\n`)).toBe(true)
    expect(sent[0].content).toContain('\n_leadinglight_capture:\n  version: 1\n  kind: link\n  converter: leadinglight-link-v1\n---\n')
    expect(sent[0].content).toContain('Paste it here if you want it in this note.')
    expect(vaultChanges(before, vaultSnapshot(vault))).toEqual({ added: [sent[0].fileName], changed: [], removed: [] })
    expect(await webCaptureFixtureRequests(page)).toEqual([SLOW, MEMBERS])
    expect(external()).toEqual([])
  })

  test('a changed address drops the fetched page: nothing of it is saved, and the answers carry over', async ({ page }) => {
    const proposals = recordProposals(page)
    await openArmed(page)
    const before = vaultSnapshot(vault)
    await fetchWebPage(page, REQUESTED)
    await expect(page.getByTestId('web-capture-title')).toHaveValue(TITLE)
    const why = webCaptureDialog(page).getByLabel('Why I saved this')
    await why.fill('Kept across pages')

    // Editing the address returns to the first stage: the page, its title and preview are gone.
    await page.getByTestId('web-capture-address').fill(SECOND)
    await expect(webCaptureDialog(page)).toHaveAttribute('data-stage', 'address')
    await expect(page.getByTestId('web-capture-title')).toHaveCount(0)
    await expect(page.getByTestId('web-capture-save')).toBeDisabled()
    expect(await webCaptureFixtureRequests(page)).toEqual([REQUESTED])

    await page.keyboard.press('Enter')
    await expectPageReady(page)
    await expect(page.getByTestId('web-capture-title')).toHaveValue('Notes on Markdown Syntax')
    await expect(why).toHaveValue('Kept across pages')
    await expect(page.getByTestId('web-capture-preview')).toContainText('Kept across pages', { timeout: 15_000 })
    await saveWebPage(page)

    const sent = proposals()
    expect(sent).toHaveLength(1)
    expect(read(sent[0].fileName)).toBe(sent[0].content)
    expect(sent[0].content.startsWith(`---\nsource: "${SECOND}"\n`)).toBe(true)
    expect(sent[0].content).toContain('\n# Notes on Markdown Syntax\n')
    expect(sent[0].content).toContain('\n## My notes\n\nKept across pages\n')
    expect(sent[0].content).not.toContain('Lighthouse')
    expect(vaultChanges(before, vaultSnapshot(vault))).toEqual({ added: [sent[0].fileName], changed: [], removed: [] })
    expect(await webCaptureFixtureRequests(page)).toEqual([REQUESTED, SECOND])
  })

  test('a page saved before, in this session or after a reload, is offered instead of fetching and opens; one that arrives at its address offers another copy', async ({ page }) => {
    const proposals = recordProposals(page)
    await openArmed(page)
    await fetchWebPage(page, REQUESTED)
    await saveWebPage(page)
    const saved = vaultSnapshot(vault)

    // "Saved before" reads the `source` of listed notes. The note just saved is found at once, before
    // any reload: its listing entry carries the written `source` (web-capture-browser-disk-product-finding.md).
    await openSavedCopy(page, [REQUESTED])
    // And again once the vault is listed from disk.
    await reloadWebCaptureVault(page)
    await openSavedCopy(page, [])

    // An address that is not the saved one, but arrives at it: found once fetched, offered as a copy.
    await fetchWebPage(page, AGAIN)
    await expect(page.getByTestId('web-capture-saved-before')).toContainText(`You saved this page before: ${TITLE}`)
    await expect(page.getByTestId('web-capture-save')).toHaveText('Save another copy')
    await expect(page.getByTestId('web-capture-destination')).toContainText(COPY)
    expect(await webCaptureFixtureRequests(page)).toEqual([AGAIN])
    await webCaptureDialog(page).getByRole('button', { name: 'Cancel' }).click()
    await expect(webCaptureDialog(page)).toHaveCount(0)

    expect(vaultSnapshot(vault)).toEqual(saved)
    expect(proposals()).toHaveLength(1)
  })

  test('turning the recipe off removes both entries and leaves saved notes exactly as they are', async ({ page }) => {
    await openArmed(page)
    await fetchWebPage(page, REQUESTED)
    await saveWebPage(page)
    const saved = vaultSnapshot(vault)

    const panel = await openExtensionSettings(page)
    const row = extensionRow(page, WEBSITE_PACKAGE)
    await expect(row).toHaveAttribute('data-chip', 'on')
    await row.getByTestId('extension-switch').click()
    await expect(row).toHaveAttribute('data-chip', 'off')
    await closeSettings(panel)

    await expect(fromWebsite(page)).toHaveCount(0)
    await openCommandPalette(page)
    await page.locator(COMMAND_INPUT).fill('Save from website')
    await expect(page.getByText('Save from website…', { exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    expect((await listedExtension(page, vault, WEBSITE_PACKAGE))?.activeSha256).toBeNull()
    expect(vaultSnapshot(vault)).toEqual(saved)
    expect(read(FILE).startsWith(`---\nsource: "${FINAL}"\n`)).toBe(true)
  })

  test('fits a 480px window and works by keyboard; Escape writes nothing and returns focus to the entry', async ({ page }) => {
    await openArmed(page)
    const before = vaultSnapshot(vault)
    const fitsAndCloses = async (opener: 'sidebar' | 'palette') => {
      await expect(page.getByTestId('web-capture-address')).toBeFocused()
      const box = await webCaptureDialog(page).boundingBox()
      expect(box && box.x >= 0 && box.x + box.width <= 480, `the dialog fits 480px when opened from the ${opener}`).toBe(true)
      await page.keyboard.type(REQUESTED)
      await page.keyboard.press('Tab')
      await expect(page.getByTestId('web-capture-fetch')).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(webCaptureDialog(page)).toHaveCount(0)
    }
    // The palette works at any width; it is opened from the sidebar's first control, so before narrowing.
    await openCommandPalette(page)
    await page.setViewportSize({ width: 480, height: 820 })
    await executeCommand(page, 'Save from website…')
    await expect(webCaptureDialog(page)).toBeVisible()
    await fitsAndCloses('palette')
    // The sidebar entry, where this width still shows the sidebar: focus returns to it.
    if (await fromWebsite(page).isVisible()) {
      await fromWebsite(page).focus()
      await page.keyboard.press('Enter')
      await fitsAndCloses('sidebar')
      await expect(fromWebsite(page)).toBeFocused()
    }
    expect(await webCaptureFixtureRequests(page)).toEqual([])
    expect(vaultSnapshot(vault)).toEqual(before)
  })
})
