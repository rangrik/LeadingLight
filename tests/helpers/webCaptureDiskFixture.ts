import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { expect, type Locator, type Page } from '@playwright/test'
import { executeCommand, openCommandPalette } from '../smoke/helpers'
import { openFixtureVault } from './fixtureVault'
import { installWebCaptureFixture, WEB_CAPTURE_FIXTURE_ORIGIN, type WebCaptureFixturePage } from './webCaptureFixture'

// Save from website on a synthetic disk vault, in an ordinary browser page on the dev server.
// Two opt-ins are needed, and neither ever reaches a real site:
// - the dev server started with LEADINGLIGHT_DEV_WEB_CAPTURE_FIXTURE=1, so its disk extension host
//   ships the website recipe and performs `web.capture` (scripts/vault-api-extensions.ts);
// - the renderer's synthetic fetch fixture, answered in the page for the reserved `.invalid` origin
//   only (tests/helpers/webCaptureFixture.ts, src/mock-tauri/mock-web-capture.ts).
// Writes go through the dev server's existing exclusive create, query and Undo; this helper adds no
// route and no handler. The plain browser path is used, not the desktop harness: there every
// extension command already goes to the disk route, and a reload re-runs both init scripts.

/** Repeats scripts/vault-api-extensions.ts, so this helper never imports dev-server code. */
export const WEB_CAPTURE_DISK_FIXTURE_ENV = 'LEADINGLIGHT_DEV_WEB_CAPTURE_FIXTURE'
export const WEBSITE_PACKAGE = 'leadinglight.website-capture'
/** Why an armed test skipped: normal gates run without the flag and stay green. */
export const NOT_ARMED = `Start the dev server with ${WEB_CAPTURE_DISK_FIXTURE_ENV}=1 to run the disk website checks`

/** One of W2's synthetic fixture pages (src/leadinglight/webCapture/fixtures), as text. */
export const syntheticPageHtml = (name: string): string =>
  fs.readFileSync(path.join(process.cwd(), 'src/leadinglight/webCapture/fixtures', `${name}.html`), 'utf8')

/** The synthetic article: requested at one address, answered after a redirect at another. */
export const LIGHTHOUSE = {
  requested: `${WEB_CAPTURE_FIXTURE_ORIGIN}/lighthouse`,
  final: `${WEB_CAPTURE_FIXTURE_ORIGIN}/2026/lighthouse-log`,
  title: 'Keeping a Lighthouse Log',
  site: 'Harbour Notes',
  file: 'keeping-a-lighthouse-log.md',
  copy: 'keeping-a-lighthouse-log-2.md',
} as const
export const LIGHTHOUSE_PAGE: WebCaptureFixturePage = { url: LIGHTHOUSE.requested, finalUrl: LIGHTHOUSE.final, html: syntheticPageHtml('article') }

type FixtureVaultOptions = NonNullable<Parameters<typeof openFixtureVault>[2]>

/**
 * Opens `vault` from disk. With `pages`, the renderer fixture's init script is registered first, so
 * the app reads it on load; with `null` the page has no website fetch at all. Reloads keep what the
 * app saved (pane layout) unless told otherwise.
 */
export async function openWebCaptureDiskVault(
  page: Page,
  vault: string,
  pages: readonly WebCaptureFixturePage[] | null,
  options: Pick<FixtureVaultOptions, 'folders' | 'preserveStorageOnReload'> = {},
): Promise<void> {
  if (pages) await installWebCaptureFixture(page, pages)
  await openFixtureVault(page, vault, { folders: options.folders ?? [], preserveStorageOnReload: options.preserveStorageOnReload ?? true })
}

interface ListedExtension { readonly packageId: string; readonly activeSha256: string | null }

/** Opens `vault` with the renderer fixture and answers whether the dev server is armed; tests skip when not. */
export async function openArmedWebCaptureVault(page: Page, vault: string, pages: readonly WebCaptureFixturePage[]): Promise<boolean> {
  await openWebCaptureDiskVault(page, vault, pages)
  return diskBackendArmed(page, vault)
}

/** Reloads the page; the vault, the renderer fixture and the pane layout come back from their scripts. */
export async function reloadWebCaptureVault(page: Page): Promise<void> {
  await page.reload()
  await expect(page.getByTestId('note-list-container')).toBeVisible()
}

export const webCaptureDialog = (page: Page): Locator => page.getByTestId('web-capture-dialog')
export const fromWebsite = (page: Page): Locator => page.getByTestId('sidebar-top-nav').getByRole('button', { name: 'From website…' })
/** The pane showing the note at vault-relative `relative`. */
export const notePane = (page: Page, relative: string): Locator => page.locator(`[data-note-path$="/${relative}"]`)
export const extensionRow = (page: Page, packageId: string): Locator => page.locator(`[data-testid="extension-row"][data-package-id="${packageId}"]`)

/** From website…, the address, Enter; then waits for the page stage and its verified preview. */
export async function fetchWebPage(page: Page, address: string): Promise<void> {
  await fromWebsite(page).click()
  await expect(webCaptureDialog(page)).toBeVisible()
  await expect(page.getByTestId('web-capture-address')).toBeFocused()
  await page.getByTestId('web-capture-address').fill(address)
  await page.keyboard.press('Enter')
  await expectPageReady(page)
}

/** The page stage, with the whole note prepared for its preview. */
export async function expectPageReady(page: Page): Promise<void> {
  await expect(webCaptureDialog(page)).toHaveAttribute('data-stage', 'page', { timeout: 15_000 })
  await expect(page.getByTestId('web-capture-preview').getByTestId('template-preview')).toBeAttached({ timeout: 15_000 })
}

/** Save, answered by opening the note: the dialog is gone. */
export async function saveWebPage(page: Page): Promise<void> {
  await page.getByTestId('web-capture-save').click()
  await expect(webCaptureDialog(page)).toHaveCount(0, { timeout: 15_000 })
}

/** Settings at its Extensions section, at any window width. */
export async function openExtensionSettings(page: Page): Promise<Locator> {
  await openCommandPalette(page)
  await executeCommand(page, 'Open Settings')
  const panel = page.getByTestId('settings-panel')
  await expect(panel).toBeVisible()
  const nav = panel.getByRole('button', { name: 'Extensions', exact: true })
  if (await nav.isVisible()) await nav.click()
  else await panel.locator('#settings-section-extensions').scrollIntoViewIfNeeded()
  await expect(page.getByTestId('extension-settings')).toBeVisible()
  return panel
}

/** The header's close control (the backdrop button shares its name but has no title). */
export async function closeSettings(panel: Locator): Promise<void> {
  await panel.getByTitle('Close settings', { exact: true }).click()
  await expect(panel).not.toBeVisible()
}

/** The vault's local Trash: each moved page's bytes, as text. */
export function trashPayloads(vault: string): string[] {
  const trash = path.join(vault, '.leadinglight', 'trash')
  if (!fs.existsSync(trash)) return []
  return fs.readdirSync(trash).map(item => path.join(trash, item, 'payload')).filter(file => fs.existsSync(file)).map(file => fs.readFileSync(file, 'utf8'))
}

/** One listed package, asked through the page's own bridge and owner: never a second owner. */
export function listedExtension(page: Page, vault: string, packageId: string): Promise<ListedExtension | null> {
  return page.evaluate(async ({ vaultPath, id }) => {
    type Handler = (args?: unknown) => Promise<unknown>
    const list = (window as unknown as { __mockHandlers?: Record<string, Handler> }).__mockHandlers?.list_extensions
    if (!list) throw new Error('This page has no extension bridge')
    const reply = await list({ vaultPath }) as { status?: string; extensions?: ListedExtension[] }
    if (reply.status !== 'ok') throw new Error(`The extensions could not be listed: ${JSON.stringify(reply)}`)
    return reply.extensions?.find(item => item.packageId === id) ?? null
  }, { vaultPath: vault, id: packageId })
}

/** The dev server was started armed: its disk host ships the website recipe and turns it on by default. */
export async function diskBackendArmed(page: Page, vault: string): Promise<boolean> {
  return (await listedExtension(page, vault, WEBSITE_PACKAGE))?.activeSha256 != null
}

/** Every visible file under the vault with its digest; hidden and internal folders (`.…`) are skipped. */
export function vaultSnapshot(vault: string): Record<string, string> {
  const state: Record<string, string> = {}
  const walk = (dir: string) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.name.startsWith('.')) continue
      const full = path.join(dir, item.name)
      if (item.isDirectory()) walk(full)
      else state[path.relative(vault, full).split(path.sep).join('/')] = createHash('sha256').update(fs.readFileSync(full)).digest('hex')
    }
  }
  walk(vault)
  return state
}

/** The files `after` adds to `before`, and the files whose bytes it changed, each sorted. */
export function vaultChanges(before: Record<string, string>, after: Record<string, string>): { added: string[]; changed: string[]; removed: string[] } {
  const keys = (record: Record<string, string>) => Object.keys(record).sort()
  return {
    added: keys(after).filter(file => !(file in before)),
    changed: keys(after).filter(file => file in before && before[file] !== after[file]),
    removed: keys(before).filter(file => !(file in after)),
  }
}

/**
 * Starts recording every network request the page makes; the returned reader lists those that left
 * the dev server's own origin. Call before the first navigation.
 */
export function recordExternalRequests(page: Page): () => readonly string[] {
  const seen: string[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) seen.push(request.url())
  })
  return () => {
    const own = new URL(page.url()).origin
    return seen.filter(url => {
      const target = new URL(url)
      const origin = target.protocol.startsWith('ws') ? `${target.protocol === 'wss:' ? 'https:' : 'http:'}//${target.host}` : target.origin
      return origin !== own
    })
  }
}

export interface SentProposal {
  readonly kind: string
  readonly operationId: string
  readonly fileName: string
  readonly content: string
  readonly contentSha256: string
}

/** Starts recording each proposal the page sends to the disk route, exactly as sent. */
export function recordProposals(page: Page): () => readonly SentProposal[] {
  const sent: SentProposal[] = []
  page.on('request', request => {
    if (!request.url().endsWith('/api/extensions/submit_document_proposal')) return
    const body = request.postDataJSON() as { args?: { proposal?: SentProposal } } | null
    if (body?.args?.proposal) sent.push(body.args.proposal)
  })
  return () => [...sent]
}

/**
 * The next create reply is lost on its way back: the request reaches the dev server, which writes,
 * and the page sees a failed request. Only the first submit is affected.
 */
export async function loseNextSubmitReply(page: Page): Promise<void> {
  let fired = false
  await page.route('**/api/extensions/submit_document_proposal', async route => {
    if (fired) return route.continue()
    fired = true
    await route.fetch()
    await route.abort('failed')
  })
}
