import { test, expect, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createFixtureVaultCopy, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { webCaptureFixtureRequests } from '../helpers/webCaptureFixture'
import {
  closeSettings, diskBackendArmed, extensionRow, fetchWebPage, fromWebsite, LIGHTHOUSE, LIGHTHOUSE_PAGE, loseNextSubmitReply,
  notePane, NOT_ARMED, openArmedWebCaptureVault, openExtensionSettings, openWebCaptureDiskVault, recordExternalRequests, recordProposals,
  reloadWebCaptureVault, saveWebPage, trashPayloads, vaultChanges, vaultSnapshot, webCaptureDialog, WEBSITE_PACKAGE,
} from '../helpers/webCaptureDiskFixture'

// Save from website on a disposable synthetic disk vault, through the dev server's existing
// exclusive create, query and Undo: exact bytes, the dirty pane, reload, Undo and collisions.
// Synthetic pages only, answered in the page for the reserved `.invalid` origin; nothing here
// reaches a real site. Every persistence claim is checked on disk with fs. The armed tests need the
// dev server started with LEADINGLIGHT_DEV_WEB_CAPTURE_FIXTURE=1 and skip, saying so, without it.
// This qualifies the browser bridge, not native fetch or windows. The dialog's own flows (Stop,
// refused pages, address changes, saved before, Off, compact window) are in web-capture.spec.ts.

const { title: TITLE, file: FILE, copy: COPY, requested: REQUESTED, final: FINAL } = LIGHTHOUSE
const PAGES = [LIGHTHOUSE_PAGE]
const ALPHA = 'project/alpha-project.md'

let vault: string
const read = (relative: string) => fs.readFileSync(path.join(vault, relative), 'utf8')
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

async function openArmed(page: Page) {
  test.skip(!(await openArmedWebCaptureVault(page, vault, PAGES)), NOT_ARMED)
}

test.describe('LeadingLight Save from website on a disk vault', () => {
  test.describe.configure({ timeout: 90_000 })

  test.beforeEach(() => {
    vault = createFixtureVaultCopy()
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(vault)
  })

  test('without the renderer fixture a disk vault offers no website capture, armed server or not', async ({ page }) => {
    await openWebCaptureDiskVault(page, vault, null)
    const armed = await diskBackendArmed(page, vault)
    const panel = await openExtensionSettings(page)
    await expect(extensionRow(page, 'leadinglight.passage-commentary')).toBeVisible()
    // Armed, the disk host performs `web.capture`, but this window does not fetch: never "On".
    if (armed) await expect(extensionRow(page, WEBSITE_PACKAGE)).toHaveAttribute('data-chip', 'unavailable')
    else await expect(extensionRow(page, WEBSITE_PACKAGE)).toHaveCount(0)
    await closeSettings(panel)
    await expect(fromWebsite(page)).toHaveCount(0)
    expect(await page.evaluate(() => typeof (window as unknown as { __mockHandlers?: Record<string, unknown> }).__mockHandlers?.web_capture_fetch)).toBe('undefined')
  })

  test("saves one exact note on disk, never rewrites it on opening or after a reload, and keeps a dirty pane's words", async ({ page }) => {
    const external = recordExternalRequests(page)
    const proposals = recordProposals(page)
    await openArmed(page)

    // Unsaved words in the pane the website note will open in.
    await page.getByTestId('note-list-container').getByText('Alpha Project', { exact: true }).first().click()
    const alpha = notePane(page, ALPHA).locator('.bn-editor')
    await expect(alpha).toBeVisible()
    const before = vaultSnapshot(vault)
    const typed = 'Written before saving a website page.'
    await alpha.click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.press('Enter')
    await page.keyboard.type(typed)

    await fetchWebPage(page, 'fixtures.leadinglight.invalid/lighthouse')
    expect(await webCaptureFixtureRequests(page)).toEqual([REQUESTED])
    await expect(page.getByTestId('web-capture-title')).toHaveValue(TITLE)
    await webCaptureDialog(page).getByLabel('Why I saved this').fill('For the harbour essay')
    await expect(page.getByTestId('web-capture-preview')).toContainText('For the harbour essay', { timeout: 15_000 })
    await saveWebPage(page)

    // One new file, holding exactly the bytes the page verified and proposed; its source is the
    // address the redirect ended at.
    const sent = proposals()
    expect(sent).toHaveLength(1)
    expect(sent[0].fileName).toBe(FILE)
    const bytes = fs.readFileSync(path.join(vault, FILE))
    expect(bytes.toString('utf8')).toBe(sent[0].content)
    expect(sha256(bytes)).toBe(sent[0].contentSha256)
    expect(sent[0].content.startsWith(`---\nsource: "${FINAL}"\n`)).toBe(true)
    expect(sent[0].content).toContain(`\n  requested: "${REQUESTED}"\n`)
    expect(sent[0].content).toContain(`\n# ${TITLE}\n`)
    expect(sent[0].content).toContain('\n## My notes\n\nFor the harbour essay\n')

    // The dirty page kept its own words, and nothing else in the vault changed.
    await expect.poll(() => read(ALPHA).includes(typed), { timeout: 10_000 }).toBe(true)
    expect(read(ALPHA)).not.toContain('Lighthouse')
    expect(vaultChanges(before, vaultSnapshot(vault))).toEqual({ added: [FILE], changed: [ALPHA], removed: [] })

    // Opened from disk; opening never rewrote it.
    await expect(notePane(page, FILE).locator('.bn-editor').getByRole('heading', { name: TITLE })).toBeVisible()
    await page.waitForTimeout(1_500)
    expect(fs.readFileSync(path.join(vault, FILE)).equals(bytes)).toBe(true)

    // A reload reopens it from disk, unchanged.
    await reloadWebCaptureVault(page)
    await page.getByTestId('note-list-container').getByText(TITLE, { exact: true }).first().click()
    await expect(notePane(page, FILE).locator('.bn-editor').getByRole('heading', { name: TITLE })).toBeVisible()
    await page.waitForTimeout(1_500)
    expect(fs.readFileSync(path.join(vault, FILE)).equals(bytes)).toBe(true)
    expect(proposals()).toHaveLength(1)
    expect(external()).toEqual([])
  })

  test('Undo is refused once the note changed on disk, and moves exactly the bytes of an unchanged copy to Trash', async ({ page }) => {
    const proposals = recordProposals(page)
    await openArmed(page)
    await fetchWebPage(page, REQUESTED)
    await saveWebPage(page)
    const first = notePane(page, FILE).getByTestId('web-capture-notice')
    await expect(first).toHaveAttribute('data-step', 'offered')

    // Changed on disk behind the open page: Undo is refused and the changed bytes stay.
    const changed = `${read(FILE)}Edited elsewhere.\n`
    fs.writeFileSync(path.join(vault, FILE), changed)
    await first.getByTestId('web-capture-undo').click()
    await expect(first).toHaveAttribute('data-step', 'blocked')
    expect(read(FILE)).toBe(changed)
    expect(trashPayloads(vault)).toEqual([])

    // Another copy of the same page. "Saved before" reads the `source` of listed notes, and a note
    // saved in this page session is listed without it until the vault is listed again from disk
    // (web-capture-browser-disk-product-finding.md), so the copy is made after a reload. The address
    // requested is not the saved source; the final address it arrives at is, so Save offers a copy.
    await reloadWebCaptureVault(page)
    await fetchWebPage(page, REQUESTED)
    await expect(page.getByTestId('web-capture-saved-before')).toContainText(`You saved this page before: ${TITLE}`)
    await expect(page.getByTestId('web-capture-save')).toHaveText('Save another copy')
    await expect(page.getByTestId('web-capture-destination')).toContainText(COPY)
    await saveWebPage(page)
    const copy = proposals().at(-1)
    expect(copy?.fileName).toBe(COPY)
    expect(read(COPY)).toBe(copy?.content)
    await notePane(page, COPY).getByTestId('web-capture-undo').click()
    await expect(page.getByText('The saved page was moved to Trash.')).toBeVisible()
    expect(fs.existsSync(path.join(vault, COPY))).toBe(false)
    expect(trashPayloads(vault)).toEqual([copy?.content])
    expect(read(FILE)).toBe(changed)
    expect(proposals()).toHaveLength(2)
  })

  test('a name taken on disk after Fetch is refused at Save, and a lost reply asks Check again and writes once', async ({ page }) => {
    const proposals = recordProposals(page)
    await openArmed(page)
    await fetchWebPage(page, REQUESTED)

    // Another file appears at the name after the page was fetched: native-style exclusive create refuses.
    const placed = '# Placed by someone else\n'
    fs.writeFileSync(path.join(vault, FILE), placed)
    const before = vaultSnapshot(vault)
    await page.getByTestId('web-capture-save').click()
    await expect(webCaptureDialog(page)).toHaveAttribute('data-step', 'editing', { timeout: 15_000 })
    await expect(page.getByTestId('web-capture-destination')).toContainText('already exists')
    expect(read(FILE)).toBe(placed)
    expect(vaultSnapshot(vault)).toEqual(before)

    // A new title, and this time the reply is lost after the write: Check again finds it.
    await page.getByTestId('web-capture-title').fill('Lighthouse log, kept twice')
    await loseNextSubmitReply(page)
    await page.getByTestId('web-capture-save').click()
    await expect(webCaptureDialog(page)).toHaveAttribute('data-step', 'uncertain', { timeout: 15_000 })
    await page.getByTestId('web-capture-check').click()
    await expect(webCaptureDialog(page)).toHaveCount(0, { timeout: 15_000 })

    // Two operations in all (the refused one and the lost one); Check again sent nothing new.
    const sent = proposals()
    const last = sent.at(-1)
    expect(sent).toHaveLength(2)
    expect(new Set(sent.map(proposal => proposal.operationId)).size).toBe(2)
    expect(last?.fileName).not.toBe(FILE)
    expect(vaultChanges(before, vaultSnapshot(vault))).toEqual({ added: [last?.fileName], changed: [], removed: [] })
    expect(read(last?.fileName ?? '')).toBe(last?.content)
    expect(read(FILE)).toBe(placed)
  })
})
