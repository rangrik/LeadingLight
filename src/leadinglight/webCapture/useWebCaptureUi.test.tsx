// The website host as App wires it: From website… opens the recipe's dialog, Fetch goes through the
// transport only, Save is the controller's one guarded create with the verified note, the page opens
// in the reserved pane, and the Undo notice goes through the note's own lane.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { MutateExistingDocument, RunPageExclusive } from '../../hooks/useAppSave'
import type { VaultEntry } from '../../types'
import { E2_HOST_CAPABILITIES } from '../extensions/extensionContract'
import { createExtensionController, type ExtensionController } from '../extensions/extensionSessionController'
import { fakeRegistry, fakeReservation, fixtureText, packageOf } from '../extensions/extensions.test-utils'
import { useExtensionUi } from '../extensions/useExtensionUi'
import type { Extensions } from '../extensions/useExtensions'
import websitePackage from '../extensions/fixtures/website-capture.json?raw'
import type { CreateProposal } from '../proposals/proposalContract'
import { sha256Hex } from '../saveOutcome'
import { CAPTURED_AT, fixture } from './webCapture.test-utils'
import type { WebCaptureFetchOutcome, WebCaptureTransport } from './webCaptureTransport'
import { useWebCaptureUi, type WebCaptureUiOptions } from './useWebCaptureUi'

vi.mock('../../utils/macosDismissableEscapeSurface', () => ({
  registerMacosDismissableEscapeSurface: () => () => {},
  useMacosDismissableEscapeSurfaceRef: (ref: unknown) => ref ?? (() => {}),
}))
vi.mock('../../hooks/useEditorFocus', () => ({ requestEditorFocus: vi.fn() }))

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.scrollIntoView ??= () => {}
})
afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

const VAULT = '/vault'
const KEY = 'local.website-capture/save-page'
const REQUESTED = 'https://fixtures.leadinglight.invalid/lighthouse'
const FINAL = 'https://fixtures.leadinglight.invalid/2026/lighthouse-log'
const TITLE = 'Keeping a Lighthouse Log'
const WEB_HOST = [...E2_HOST_CAPABILITIES, 'web.capture'] as const
const SECOND_WEBSITE = websitePackage.replace('"local.website-capture"', '"local.reading-list"').replace('"name": "Save from website"', '"name": "Reading list"')

const entry = (path: string, title: string, source?: string): VaultEntry => ({ path, filename: path.split('/').pop()!, title, isA: null, aliases: [], belongsTo: [],
  relatedTo: [], status: null, archived: false, modifiedAt: 1, createdAt: 1, fileSize: 1, snippet: '', wordCount: 0, relationships: {}, icon: null,
  color: null, order: null, sidebarLabel: null, template: null, sort: null, view: null, visible: null, organized: false, favorite: false,
  favoriteIndex: null, listPropertiesDisplay: [], outgoingLinks: [], properties: source ? { source } : {}, hasH1: true })

function transportOf(answer: (attemptId: string, url: string) => WebCaptureFetchOutcome | Promise<WebCaptureFetchOutcome>) {
  return {
    fetch: vi.fn(async (attemptId: string, url: string) => answer(attemptId, url)),
    cancel: vi.fn(async (attemptId: string) => ({ status: 'cancelled' as const, attemptId })),
  } satisfies WebCaptureTransport
}
const fetched = (attemptId: string, url: string): WebCaptureFetchOutcome => ({
  status: 'fetched', attemptId, requestedUrl: url, finalUrl: FINAL, fetchedAt: CAPTURED_AT, contentType: 'text/html', encoding: 'UTF-8',
  encodingSource: 'header', html: fixture('article'), hadReplacements: false,
})

/** The page lane: runs publish at once; a created note's Undo leaves no bytes behind. */
function lane() {
  const mutate: MutateExistingDocument = (path, mutation) => ({
    admitted: true, path,
    done: (async () => {
      const result = await mutation.publish(path)
      return { kind: 'returned', path, result, current: true, integration: 'none', latest: mutation.committedContent(result) }
    })(),
  })
  return vi.fn<RunPageExclusive>(async (_path, work) => work(mutate))
}

interface MountOptions {
  readonly packages?: readonly string[]
  readonly entries?: VaultEntry[]
  readonly transport?: WebCaptureTransport
  readonly host?: readonly (typeof WEB_HOST)[number][]
}

async function mount(options: MountOptions = {}) {
  const registry = fakeRegistry(await Promise.all((options.packages ?? [websitePackage]).map(text => packageOf([text], 'newest'))), VAULT)
  registry.api.submitProposal.mockImplementation(async proposal => ({ ...registry.committedFor(proposal as CreateProposal), undoReceipt: 'undo-web-1' }))
  registry.api.undoProposal.mockImplementation(async (request, offer) => ({ status: 'undone', operationId: request.operationId, kind: 'create', path: offer.path }))
  const controller: ExtensionController = createExtensionController({ api: registry.transport, hostCapabilities: options.host ?? WEB_HOST })
  controller.enter(VAULT)
  await controller.refresh()
  const transport = options.transport ?? transportOf(fetched)
  const { reservation, open } = fakeReservation()
  const tabs: { entry: VaultEntry; content: string }[] = []
  open.mockImplementation(async (opened: VaultEntry, content: string) => { tabs.push({ entry: opened, content }); return true })
  // The listing as App keeps it: an added entry is in the next render's entries.
  const listing = [...(options.entries ?? [])]
  const calls = {
    notify: vi.fn(), onTrashed: vi.fn(), onOpenSaved: vi.fn(), onOpenInBrowser: vi.fn(), markInternalWrite: vi.fn(), onPersisted: vi.fn(),
    addEntry: vi.fn((added: VaultEntry) => { listing.push(added) }),
  }
  const runPageExclusive = lane()
  const extensions = () => ({ controller, snapshot: controller.snapshot(), runnable: [], boundary: { begin: () => () => {}, settle: async () => {} } }) as unknown as Extensions
  const props = (): WebCaptureUiOptions => ({
    locale: 'en', vaultPath: VAULT, extensions: extensions(), folders: [], entries: [...listing], listingComplete: true,
    tabs: [...tabs], workspace: { paths: [tabs[0]?.entry.path ?? null, null], activePane: 0, split: false },
    reserveOpen: () => reservation, runPageExclusive, ...calls, canOpen: () => true, blocked: false, transport,
  })
  let ui: ReturnType<typeof useWebCaptureUi> | null = null
  let shown: string | null = null
  function Harness() {
    ui = useWebCaptureUi(props())
    return <>{ui.dialogs}{shown && <div data-testid="page-notice">{ui.renderNotice(shown)}</div>}</>
  }
  const view = render(<Harness />)
  const rerender = () => view.rerender(<Harness />)
  return {
    registry, controller, transport, open, tabs, calls, runPageExclusive, rerender,
    ui: () => ui!,
    show: (path: string | null) => { shown = path; rerender() },
    openFromWebsite: () => act(async () => { ui!.openFromWebsite() }),
  }
}

async function fetchPage(address = 'fixtures.leadinglight.invalid/lighthouse') {
  fireEvent.change(screen.getByTestId('web-capture-address'), { target: { value: address } })
  fireEvent.click(screen.getByTestId('web-capture-fetch'))
  await waitFor(() => expect(screen.getByTestId('web-capture-dialog').dataset.stage).toBe('page'), { timeout: 8000 })
  await waitFor(() => expect(within(screen.getByTestId('web-capture-preview')).queryByTestId('template-preview')).not.toBeNull(), { timeout: 8000 })
}

/** Fetches the redirected page and saves it; the dialog closes on the opened note. */
async function saveOnce(host: Awaited<ReturnType<typeof mount>>) {
  await host.openFromWebsite()
  await fetchPage()
  await act(async () => { fireEvent.click(screen.getByTestId('web-capture-save')) })
  await waitFor(() => expect(screen.queryByTestId('web-capture-dialog')).toBeNull(), { timeout: 8000 })
  expect(host.registry.api.submitProposal).toHaveBeenCalledTimes(1)
}

describe('From website…', () => {
  it('opens the one website command with the address focused, and Cancel writes nothing', async () => {
    const host = await mount()
    expect(host.ui().hasCommands).toBe(true)
    expect(host.ui().commands.map(item => item.key)).toEqual([KEY])
    await host.openFromWebsite()
    expect(document.activeElement).toBe(screen.getByTestId('web-capture-address'))
    expect(host.ui().isOpen()).toBe(true)
    expect(host.transport.fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByTestId('web-capture-dialog')).toBeNull())
    expect(host.ui().isOpen()).toBe(false)
    expect(host.registry.api.beginRun).not.toHaveBeenCalled()
    expect(host.registry.api.submitProposal).not.toHaveBeenCalled()
  })

  it('is absent where the host does not fetch', async () => {
    const host = await mount({ host: E2_HOST_CAPABILITIES as (typeof WEB_HOST)[number][] })
    expect(host.ui().hasCommands).toBe(false)
    await host.openFromWebsite()
    expect(screen.queryByTestId('web-capture-dialog')).toBeNull()
  })

  it('lists only website commands in the chooser when several are on', async () => {
    const host = await mount({ packages: [websitePackage, SECOND_WEBSITE, fixtureText('meeting-debrief.json')] })
    await host.openFromWebsite()
    const choices = screen.getAllByTestId('extension-choice').map(button => button.dataset.key)
    expect(choices).toEqual([KEY, 'local.reading-list/save-page'])
    fireEvent.click(screen.getAllByTestId('extension-choice')[1])
    await waitFor(() => expect(screen.getByTestId('web-capture-dialog')).toBeInTheDocument())
    expect(screen.queryByTestId('extension-chooser')).toBeNull()
  })
})

describe('Save from website', () => {
  it('writes the verified note once through the run, opens it, and offers Undo that moves it to Trash', async () => {
    const host = await mount()
    await host.openFromWebsite()
    await fetchPage()
    expect(host.transport.fetch).toHaveBeenCalledTimes(1)
    expect(host.transport.fetch).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f-]{36}$/u), 'https://fixtures.leadinglight.invalid/lighthouse')
    fireEvent.change(screen.getByLabelText('Why I saved this'), { target: { value: 'For the harbour essay' } })
    await waitFor(() => expect(within(screen.getByTestId('web-capture-preview')).getByTestId('template-preview').textContent).toContain('For the harbour essay'), { timeout: 8000 })
    await act(async () => { fireEvent.click(screen.getByTestId('web-capture-save')) })
    await waitFor(() => expect(screen.queryByTestId('web-capture-dialog')).toBeNull(), { timeout: 8000 })

    expect(host.registry.api.submitProposal).toHaveBeenCalledTimes(1)
    const sent = host.registry.api.submitProposal.mock.calls[0][0] as CreateProposal
    expect(sent.content.startsWith(`---\nsource: "${FINAL}"\n`)).toBe(true)
    expect(sent.content).toContain('\n_leadinglight_capture:\n  version: 1\n  kind: article\n  requested: "https://fixtures.leadinglight.invalid/lighthouse"\n')
    expect(sent.content).toContain('\n# Keeping a Lighthouse Log\n')
    expect(sent.content).toContain('\n## My notes\n\nFor the harbour essay\n')
    expect(sent.contentSha256).toBe(await sha256Hex(sent.content))
    const path = `${VAULT}/${sent.fileName}`
    expect(host.calls.markInternalWrite).toHaveBeenCalledWith(path)
    expect(host.calls.addEntry).toHaveBeenCalledWith(expect.objectContaining({ path }))
    expect(host.open).toHaveBeenCalledTimes(1)
    expect(host.tabs).toEqual([{ entry: expect.objectContaining({ path }), content: sent.content }])

    host.show(path)
    const notice = screen.getByTestId('web-capture-notice')
    expect(notice.textContent).toContain('Saved from Harbour Notes.')
    await act(async () => { fireEvent.click(within(notice).getByTestId('web-capture-undo')) })
    await waitFor(() => expect(host.calls.onTrashed).toHaveBeenCalledWith(path))
    expect(host.runPageExclusive).toHaveBeenCalledWith(path, expect.any(Function))
    expect(host.registry.api.undoProposal.mock.calls[0][0]).toMatchObject({ sessionId: 'session-1', undoReceipt: 'undo-web-1', kind: 'create', beforeSha256: null })
    expect(host.calls.notify).toHaveBeenCalledWith('The saved page was moved to Trash.')
    expect(screen.queryByTestId('web-capture-notice')).toBeNull()
  })

  it('offers the copy saved before instead of fetching, and opens it', async () => {
    const saved = entry(`${VAULT}/Clippings/lighthouse.md`, 'Lighthouse', 'https://fixtures.leadinglight.invalid/lighthouse')
    const host = await mount({ entries: [saved] })
    await host.openFromWebsite()
    fireEvent.change(screen.getByTestId('web-capture-address'), { target: { value: 'https://fixtures.leadinglight.invalid/lighthouse' } })
    fireEvent.click(screen.getByTestId('web-capture-fetch'))
    expect(host.transport.fetch).not.toHaveBeenCalled()
    expect(screen.getByTestId('web-capture-saved-before').textContent).toContain('You saved this page before: Lighthouse, in Clippings.')
    fireEvent.click(screen.getByTestId('web-capture-open-saved'))
    expect(host.calls.onOpenSaved).toHaveBeenCalledWith(saved.path)
    await waitFor(() => expect(screen.queryByTestId('web-capture-dialog')).toBeNull())
    expect(host.registry.api.beginRun).not.toHaveBeenCalled()
  })

  it('finds a page it just saved by its final address before any reload, from the entry it listed', async () => {
    const host = await mount()
    await saveOnce(host)
    const sent = host.registry.api.submitProposal.mock.calls[0][0] as CreateProposal
    const listed = host.calls.addEntry.mock.calls[0][0]
    expect(listed).toMatchObject({ path: `${VAULT}/${sent.fileName}`, title: TITLE, properties: { source: FINAL, captured: CAPTURED_AT } })
    expect(listed.properties).not.toHaveProperty('requested')
    host.rerender()

    await host.openFromWebsite()
    fireEvent.change(screen.getByTestId('web-capture-address'), { target: { value: FINAL } })
    fireEvent.click(screen.getByTestId('web-capture-fetch'))
    expect(host.transport.fetch).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('web-capture-saved-before').textContent).toContain(`You saved this page before: ${TITLE}`)
    expect(screen.getByTestId('web-capture-fetch').textContent).toBe('Fetch anyway')
    fireEvent.click(screen.getByTestId('web-capture-fetch'))
    await waitFor(() => expect(screen.getByTestId('web-capture-dialog').dataset.stage).toBe('page'), { timeout: 8000 })
    expect(host.transport.fetch).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.getByTestId('web-capture-save').textContent).toBe('Save another copy'))
  })

  it('knows a redirected page only by its final address: the requested one fetches, then the copy shows', async () => {
    const host = await mount()
    await saveOnce(host)
    host.rerender()

    await host.openFromWebsite()
    // The note records where the page ended up, not the address typed for it.
    await fetchPage(REQUESTED)
    expect(host.transport.fetch).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('web-capture-saved-before').textContent).toContain(`You saved this page before: ${TITLE}`)
    await waitFor(() => expect(screen.getByTestId('web-capture-save').textContent).toBe('Save another copy'))
  })

  it('lists a page it created but could not open with the same source, and finds it', async () => {
    const host = await mount()
    host.open.mockImplementationOnce(async () => false)
    await host.openFromWebsite()
    await fetchPage()
    await act(async () => { fireEvent.click(screen.getByTestId('web-capture-save')) })
    await waitFor(() => expect(screen.getByTestId('web-capture-dialog').dataset.step).toBe('created'), { timeout: 8000 })
    expect(host.tabs).toEqual([])
    expect(host.calls.addEntry).toHaveBeenCalledTimes(1)
    expect(host.calls.addEntry.mock.calls[0][0].properties).toMatchObject({ source: FINAL })
    fireEvent.click(screen.getByTestId('web-capture-done'))
    await waitFor(() => expect(screen.queryByTestId('web-capture-dialog')).toBeNull())
    host.rerender()

    await host.openFromWebsite()
    fireEvent.change(screen.getByTestId('web-capture-address'), { target: { value: FINAL } })
    fireEvent.click(screen.getByTestId('web-capture-fetch'))
    expect(host.transport.fetch).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('web-capture-saved-before').textContent).toContain(`You saved this page before: ${TITLE}`)
  })

  it('shows Check again for an unconfirmed write and never writes a second time', async () => {
    const host = await mount()
    host.registry.api.submitProposal.mockImplementationOnce(async () => null)
    await host.openFromWebsite()
    await fetchPage()
    await act(async () => { fireEvent.click(screen.getByTestId('web-capture-save')) })
    await waitFor(() => expect(screen.getByTestId('web-capture-dialog').dataset.step).toBe('uncertain'), { timeout: 8000 })
    const sent = host.registry.api.submitProposal.mock.calls[0][0] as CreateProposal
    host.registry.api.queryProposal.mockImplementationOnce(async () => ({ ...host.registry.committedFor(sent), undoReceipt: 'undo-web-1' }))
    await act(async () => { fireEvent.click(screen.getByTestId('web-capture-check')) })
    await waitFor(() => expect(screen.queryByTestId('web-capture-dialog')).toBeNull(), { timeout: 8000 })
    expect(host.registry.api.submitProposal).toHaveBeenCalledTimes(1)
    expect(host.open).toHaveBeenCalledTimes(1)
    host.show(`${VAULT}/${sent.fileName}`)
    expect(screen.getByTestId('web-capture-notice').textContent).toContain('Saved from Harbour Notes.')
  })

  it('offers no Undo for a write confirmed after the workspace changed', async () => {
    const host = await mount()
    host.registry.api.submitProposal.mockImplementationOnce(async () => null)
    await host.openFromWebsite()
    await fetchPage()
    await act(async () => { fireEvent.click(screen.getByTestId('web-capture-save')) })
    await waitFor(() => expect(screen.getByTestId('web-capture-dialog').dataset.step).toBe('uncertain'), { timeout: 8000 })
    const sent = host.registry.api.submitProposal.mock.calls[0][0] as CreateProposal
    await act(async () => { void host.controller.leave() })
    host.registry.api.queryProposal.mockImplementationOnce(async () => ({ ...host.registry.committedFor(sent), undoReceipt: 'undo-web-1' }))
    await act(async () => { fireEvent.click(screen.getByTestId('web-capture-check')) })
    await waitFor(() => expect(screen.getByTestId('web-capture-dialog').dataset.step).toBe('created'), { timeout: 8000 })
    expect(screen.getByTestId('web-capture-dialog').textContent).toContain('in the workspace that was open before')
    expect(host.open).not.toHaveBeenCalled()
    host.show(`${VAULT}/${sent.fileName}`)
    expect(screen.queryByTestId('web-capture-notice')).toBeNull()
  })

  it('stops a fetch and saves nothing once the recipe is turned off', async () => {
    let answer!: (value: WebCaptureFetchOutcome) => void
    const transport = transportOf(() => new Promise(resolve => { answer = resolve }))
    const host = await mount({ transport })
    await host.openFromWebsite()
    fireEvent.change(screen.getByTestId('web-capture-address'), { target: { value: 'fixtures.leadinglight.invalid/lighthouse' } })
    fireEvent.click(screen.getByTestId('web-capture-fetch'))
    const view = (host.controller.snapshot() as Extract<ReturnType<typeof host.controller.snapshot>, { status: 'ready' }>).packages[0]
    await act(async () => { await host.controller.deactivate(view.packageId, view.activeSha256!) })
    host.rerender()
    expect(transport.cancel).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('web-capture-dialog').dataset.flow).toBe('revoked')
    await act(async () => { answer(fetched(transport.fetch.mock.calls[0][0], transport.fetch.mock.calls[0][1])) })
    expect(screen.getByTestId('web-capture-dialog').dataset.stage).toBe('address')
    expect(host.ui().hasCommands).toBe(false)
    expect(host.registry.api.submitProposal).not.toHaveBeenCalled()
  })
})

describe('website commands reached from the extension surfaces', () => {
  it('route Try it and the chooser to the website dialog, never the generic form', async () => {
    const registry = fakeRegistry([await packageOf([websitePackage], 'newest')], VAULT)
    const controller = createExtensionController({ api: registry.transport, hostCapabilities: WEB_HOST })
    controller.enter(VAULT)
    await controller.refresh()
    const openWebRun = vi.fn(() => 'opened' as const)
    let ui: ReturnType<typeof useExtensionUi> | null = null
    function Harness() {
      ui = useExtensionUi({
        locale: 'en', extensions: { controller, snapshot: controller.snapshot(), runnable: [], boundary: { begin: () => () => {}, settle: async () => {} } } as unknown as Extensions,
        folders: [], entries: [], reserveOpen: () => fakeReservation().reservation, addEntry: vi.fn(), markInternalWrite: vi.fn(), onPersisted: vi.fn(),
        notify: vi.fn(), canOpen: () => true, blocked: false, openWebRun,
      })
      return <>{ui.dialogs}</>
    }
    render(<Harness />)
    const onCommitted = vi.fn()
    let start: string | null = null
    act(() => { start = ui!.openRun(KEY, onCommitted, 'abc') })
    expect(start).toBe('opened')
    expect(openWebRun).toHaveBeenCalledWith(KEY, onCommitted, 'abc')
    act(() => { ui!.openFromExtension() })
    expect(openWebRun).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('extension-run-dialog')).toBeNull()
  })
})
