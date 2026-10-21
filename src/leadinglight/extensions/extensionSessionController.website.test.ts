// Website runs: a command that starts with `captureWebPage` opens like any other, submits with the
// dialog's page instead of a passage, creates only, opens the exact page in its request-time target
// and offers the run session's Undo. The host's preparation supplies the bytes; nothing else writes.
import { describe, expect, it, vi } from 'vitest'
import { E2_HOST_CAPABILITIES, type ComposedDocument, type WebPageCapture } from './extensionContract'
import type { CreateProposal, ProposalReceipt } from '../proposals/proposalContract'
import { sha256Hex } from '../saveOutcome'
import {
  createExtensionController, isWebCaptureCommand, runnableCommands, selectionCommands, webCaptureCommands,
  type AssociatedRequest, type OpenTarget,
} from './extensionSessionController'
import { fakeRegistry, packageOf, VAULT } from './extensions.test-utils'
import websitePackage from './fixtures/website-capture.json?raw'

vi.mock('./extensionMarkdownText', async () => (await import('./extensionEncoder.test-utils')).encoderStandIn())

const KEY = 'local.website-capture/save-page'
const WEB_HOST = [...E2_HOST_CAPABILITIES, 'web.capture'] as const
const PAGE: WebPageCapture = {
  page: 'page-0b8a1c2e', kind: 'article', pageTitle: 'Lighthouse log', pageUrl: 'https://fixtures.leadinglight.invalid/lighthouse',
  siteName: 'Harbour Notes', byline: null,
}
const NOTE = '---\nsource: https://fixtures.leadinglight.invalid/lighthouse\n---\n# Lighthouse log\n\nThe keeper wrote.\n'
const FILE = 'lighthouse-log.md'

const target = () => ({
  beforeWrite: vi.fn<OpenTarget['beforeWrite']>(), committed: vi.fn<OpenTarget['committed']>(), open: vi.fn<OpenTarget['open']>(async () => true),
}) satisfies OpenTarget

async function setup(host: readonly (typeof WEB_HOST)[number][] = WEB_HOST) {
  const registry = fakeRegistry([await packageOf([websitePackage], 'newest')])
  // Native gives a website create its own undo receipt, bound to the run's session.
  registry.api.submitProposal.mockImplementation(async proposal => ({ ...registry.committedFor(proposal as CreateProposal), undoReceipt: 'undo-web-1' }))
  const controller = createExtensionController({ api: registry.transport, hostCapabilities: host })
  controller.enter(VAULT)
  await controller.refresh()
  return { registry, controller }
}

function request(overrides: Partial<AssociatedRequest> = {}) {
  const open = target()
  const prepare = vi.fn<AssociatedRequest['prepare']>((document: ComposedDocument) =>
    (document.blocks[0]?.type === 'webArticle' ? { status: 'ready', content: NOTE } : { status: 'refused', reason: 'internal' }))
  const value: AssociatedRequest = {
    answers: { why: '' }, webPage: PAGE, destination: { kind: 'create', folder: 'Clippings', fileName: FILE }, prepare, target: open, ...overrides,
  }
  return { value, open, prepare }
}

describe('website commands', () => {
  it('are runnable only where the host performs web.capture, and listed with every other command', async () => {
    const web = await setup()
    expect(webCaptureCommands(web.controller.snapshot()).map(item => item.key)).toEqual([KEY])
    expect(runnableCommands(web.controller.snapshot()).map(item => item.key)).toEqual([KEY])
    expect(selectionCommands(web.controller.snapshot())).toEqual([])
    expect(isWebCaptureCommand(webCaptureCommands(web.controller.snapshot())[0].command)).toBe(true)
    const e2 = await setup(E2_HOST_CAPABILITIES as typeof WEB_HOST[number][])
    expect(webCaptureCommands(e2.controller.snapshot())).toEqual([])
    expect(e2.controller.openRun(KEY)).toBeNull()
  })

  it('compose the host page block first, titled by the page', async () => {
    const { controller } = await setup()
    const opening = controller.openRun(KEY)!
    expect(opening.capture).toBeNull()
    const { document, problems } = controller.compose(opening, { why: 'For the harbour essay' }, 'create', PAGE)
    expect(problems).toEqual([])
    expect(document?.title).toBe('Lighthouse log')
    expect(document?.blocks[0]).toEqual({ type: 'webArticle', page: PAGE.page })
  })
})

describe('Save from website', () => {
  it('binds the chosen folder, sends the prepared note once, opens that page and offers Undo', async () => {
    const { registry, controller } = await setup()
    const opening = controller.openRun(KEY)!
    const { value, open, prepare } = request()
    const outcome = await controller.submit(opening, value)
    expect(registry.api.bindFolder).toHaveBeenCalledWith(expect.objectContaining({ folder: 'Clippings' }))
    expect(registry.api.submitProposal).toHaveBeenCalledTimes(1)
    const sent = registry.api.submitProposal.mock.calls[0][0] as CreateProposal
    expect(sent).toMatchObject({ kind: 'create', fileName: FILE, content: NOTE, contentSha256: await sha256Hex(NOTE) })
    expect(prepare.mock.calls.every(([document]) => document.blocks[0]?.type === 'webArticle')).toBe(true)
    const page = { path: `${VAULT}/Clippings/${FILE}`, displayPath: `Clippings/${FILE}`, title: 'Lighthouse log', content: NOTE }
    expect(open.beforeWrite).toHaveBeenCalledWith(page.path)
    expect(open.committed).toHaveBeenCalledWith(page)
    expect(open.open).toHaveBeenCalledTimes(1)
    expect(open.open.mock.calls[0][0]).toEqual(page)
    expect(outcome).toMatchObject({ status: 'opened', page, durable: true })
    expect(outcome.status === 'opened' && outcome.undo).toEqual({
      sessionId: 'session-1', undoReceipt: 'undo-web-1', kind: 'create', path: page.path, afterSha256: await sha256Hex(NOTE), beforeSha256: null,
    })
    expect(registry.api.endRun).toHaveBeenCalledTimes(1)
  })

  it('writes nothing without a valid page, for an append, or with a passage', async () => {
    const { registry, controller } = await setup()
    for (const overrides of [
      { webPage: null }, { webPage: undefined }, { webPage: { ...PAGE, page: 'not a token' } }, { webPage: { ...PAGE, pageUrl: 'file:///etc/hosts' } },
      { destination: { kind: 'append' as const, path: `${VAULT}/a.md`, baseline: '# A\n' } },
    ]) {
      expect(await controller.submit(controller.openRun(KEY)!, request(overrides).value)).toEqual({ status: 'notWritten', reason: 'unavailable' })
    }
    expect(registry.api.beginRun).not.toHaveBeenCalled()
    expect(registry.api.submitProposal).not.toHaveBeenCalled()
  })

  it('sends nothing when the preparation refuses the proposal document', async () => {
    const { registry, controller } = await setup()
    const refusing = request({ prepare: () => ({ status: 'refused', reason: 'internal' }) })
    expect(await controller.submit(controller.openRun(KEY)!, refusing.value)).toEqual({ status: 'notWritten', reason: 'internal' })
    expect(registry.api.submitProposal).not.toHaveBeenCalled()
  })

  it('answers a second Save with the first result, and Check again never writes again', async () => {
    const { registry, controller } = await setup()
    const opening = controller.openRun(KEY)!
    registry.api.submitProposal.mockImplementationOnce(async () => null)
    const first = await controller.submit(opening, request().value)
    expect(first.status).toBe('uncertain')
    expect(await controller.submit(opening, request().value)).toMatchObject({ status: 'uncertain' })
    const operationId = (registry.api.submitProposal.mock.calls[0][0] as CreateProposal).operationId
    const committed = { ...registry.committedFor(registry.api.submitProposal.mock.calls[0][0] as CreateProposal), undoReceipt: 'undo-web-1' } as ProposalReceipt
    registry.api.queryProposal.mockImplementationOnce(async () => ({ ...committed, operationId }) as ProposalReceipt)
    const checked = await controller.recheck(opening)
    expect(checked).toMatchObject({ status: 'opened', page: { displayPath: `Clippings/${FILE}` } })
    expect(checked.status === 'opened' && checked.undo?.undoReceipt).toBe('undo-web-1')
    expect(await controller.recheck(opening)).toBe(checked)
    expect(await controller.submit(opening, request().value)).toBe(checked)
    expect(registry.api.submitProposal).toHaveBeenCalledTimes(1)
  })

  it('is revoked once the recipe is turned off, and after a workspace change', async () => {
    const off = await setup()
    const opening = off.controller.openRun(KEY)!
    const view = (off.controller.snapshot() as Extract<ReturnType<typeof off.controller.snapshot>, { status: 'ready' }>).packages[0]
    await off.controller.deactivate(view.packageId, view.activeSha256!)
    expect(off.controller.revokedReason(opening)).toBe('package')
    expect(webCaptureCommands(off.controller.snapshot())).toEqual([])
    expect(await off.controller.submit(opening, request().value)).toEqual({ status: 'revoked', reason: 'package' })

    const moved = await setup()
    const away = moved.controller.openRun(KEY)!
    void moved.controller.leave()
    expect(await moved.controller.submit(away, request().value)).toEqual({ status: 'revoked', reason: 'workspace' })
    expect(off.registry.api.submitProposal).not.toHaveBeenCalled()
    expect(moved.registry.api.submitProposal).not.toHaveBeenCalled()
  })

  it('keeps an E1 Create from writing a website command', async () => {
    const { registry, controller } = await setup()
    const outcome = await controller.create(controller.openRun(KEY)!, { answers: { why: '' }, folder: '', target: target() })
    expect(outcome.status).toBe('invalid')
    expect(registry.api.submitProposal).not.toHaveBeenCalled()
  })
})
