// Associated runs: a command that captures a passage, adds to the note linked to its source or
// creates one. The controller binds the destination, checks an append's reviewed baseline, sends
// the host-prepared whole page once, and leaves showing it to the host's page lane.
import { describe, expect, it, vi } from 'vitest'
import { CAPABILITIES, type ComposedDocument, type PassageCapture } from './extensionContract'
import type { AppendProposal, CreateProposal, ProposalReceipt } from '../proposals/proposalContract'
import { sha256Hex } from '../saveOutcome'
import { createExtensionController, runnableCommands, selectionCommands, type AssociatedRequest, type OpenTarget } from './extensionSessionController'
import { deferred, fakeRegistry, fixtureText, packageOf, VAULT } from './extensions.test-utils'

vi.mock('./extensionMarkdownText', async () => (await import('./extensionEncoder.test-utils')).encoderStandIn())

const KEY = 'local.passage-commentary/comment'
const CAPTURE: PassageCapture = { passage: 'capture-1', quote: 'The quoted passage', sourceTitle: 'Source page' }
const ANSWERS = { thought: 'Worth keeping', question: '' }
const BASELINE = '# Commentary on Source page\n\n[Source](source.md)\n\n> Earlier\n'
const POSTIMAGE = `${BASELINE}\n> The quoted passage\n\nWorth keeping\n`

const target = (): OpenTarget & { open: ReturnType<typeof vi.fn>; committed: ReturnType<typeof vi.fn>; beforeWrite: ReturnType<typeof vi.fn> } =>
  ({ beforeWrite: vi.fn(), committed: vi.fn(), open: vi.fn(async () => true) })

async function setup(host: readonly (typeof CAPABILITIES)[number][] = CAPABILITIES) {
  const registry = fakeRegistry([await packageOf([fixtureText('passage-commentary.json')], 'newest')])
  const controller = createExtensionController({ api: registry.transport, hostCapabilities: host })
  controller.enter(VAULT)
  await controller.refresh()
  return { registry, controller }
}

function request(destination: AssociatedRequest['destination'], prepare?: AssociatedRequest['prepare']) {
  const prepared = vi.fn<AssociatedRequest['prepare']>(prepare ?? ((_document: ComposedDocument, where) =>
    ({ status: 'ready', content: where.kind === 'append' ? POSTIMAGE : '# Commentary on Source page\n' })))
  const open = target()
  return { prepared, open, value: { answers: ANSWERS, destination, prepare: prepared, target: open } satisfies AssociatedRequest }
}

const appendCommitted = (proposal: AppendProposal): ProposalReceipt => ({
  status: 'committed', kind: 'append', operationId: proposal.operationId, path: `${VAULT}/commentary.md`,
  beforeSha256: proposal.expectedSha256, afterSha256: proposal.contentSha256, durable: true, undoReceipt: 'undo-1',
})

describe('capture commands', () => {
  it('are offered for a selection only once the host performs every capability they use', async () => {
    const supported = await setup()
    expect(selectionCommands(supported.controller.snapshot()).map(item => item.key)).toEqual([KEY])
    expect(runnableCommands(supported.controller.snapshot())).toEqual([])
    const e1 = await setup(['document.create', 'document.open'])
    expect(selectionCommands(e1.controller.snapshot())).toEqual([])
  })

  it('open only with a capture, and compose the host source block first', async () => {
    const { controller } = await setup()
    const opening = controller.openCaptureRun(KEY, CAPTURE)!
    expect(controller.openRun(KEY)).toBeNull()
    const { document, problems } = controller.compose(opening, ANSWERS, 'append')
    expect(problems).toEqual([])
    expect(document?.title).toBeNull()
    expect(document?.blocks[0]).toEqual({ type: 'source', passage: 'capture-1', quote: 'The quoted passage' })
    expect(controller.compose(opening, ANSWERS, 'create').document?.title).toBe('Commentary on Source page')
  })
})

describe('Create beside the source', () => {
  it('binds the source folder, sends the prepared note once under the host file name and opens nothing itself', async () => {
    const { registry, controller } = await setup()
    const { value, open, prepared } = request({ kind: 'create', folder: 'Topics', fileName: 'commentary-on-source-page.md' })
    const outcome = await controller.submit(controller.openCaptureRun(KEY, CAPTURE)!, value)
    expect(registry.api.bindFolder).toHaveBeenCalledWith(expect.objectContaining({ folder: 'Topics' }))
    const sent = registry.api.submitProposal.mock.calls[0][0] as CreateProposal
    expect(sent).toMatchObject({ kind: 'create', fileName: 'commentary-on-source-page.md', content: '# Commentary on Source page\n' })
    expect(sent.contentSha256).toBe(await sha256Hex('# Commentary on Source page\n'))
    expect(prepared.mock.calls.at(-1)?.[0].blocks[0].type).toBe('source')
    expect(outcome).toMatchObject({ status: 'committed', page: { path: `${VAULT}/Topics/commentary-on-source-page.md`, displayPath: 'Topics/commentary-on-source-page.md' } })
    expect(open.committed).toHaveBeenCalledTimes(1)
    expect(open.open).not.toHaveBeenCalled()
    expect(registry.api.endRun).toHaveBeenCalledTimes(1)
  })

  it('reports a taken name as exists, and a later Create starts a fresh operation', async () => {
    const { registry, controller } = await setup()
    registry.api.submitProposal.mockImplementationOnce(async proposal => ({ status: 'conflict', operationId: proposal.operationId, reason: 'exists' }))
    const opening = controller.openCaptureRun(KEY, CAPTURE)!
    const { value } = request({ kind: 'create', folder: '', fileName: 'taken.md' })
    expect(await controller.submit(opening, value)).toEqual({ status: 'notWritten', reason: 'exists' })
    const second = await controller.submit(opening, request({ kind: 'create', folder: '', fileName: 'taken-2.md' }).value)
    expect(second.status).toBe('committed')
    const [first, retry] = registry.api.submitProposal.mock.calls.map(call => call[0].operationId)
    expect(first).not.toBe(retry)
  })
})

describe('Add to the linked note', () => {
  it('sends the whole postimage with the reviewed baseline digest and returns its undo receipt', async () => {
    const { registry, controller } = await setup()
    const baselineSha = await sha256Hex(BASELINE)
    registry.api.bindDocument.mockImplementation(async () => ({ status: 'bound', documentHandle: 'doc-1', displayPath: 'commentary.md', contentSha256: baselineSha }) as never)
    registry.api.submitProposal.mockImplementation(async proposal => appendCommitted(proposal as AppendProposal))
    const { value, prepared } = request({ kind: 'append', path: `${VAULT}/commentary.md`, baseline: BASELINE })
    const outcome = await controller.submit(controller.openCaptureRun(KEY, CAPTURE)!, value)
    expect(registry.api.bindDocument).toHaveBeenCalledWith(expect.objectContaining({ path: 'commentary.md' }))
    expect(registry.api.submitProposal.mock.calls[0][0]).toMatchObject({ kind: 'append', documentHandle: 'doc-1', expectedSha256: baselineSha, content: POSTIMAGE })
    expect(prepared.mock.calls.at(-1)?.[1]).toEqual({ kind: 'append', path: `${VAULT}/commentary.md`, baseline: BASELINE })
    expect(outcome).toMatchObject({ status: 'committed', page: { path: `${VAULT}/commentary.md`, content: POSTIMAGE }, receipt: { kind: 'append', undoReceipt: 'undo-1' } })
    expect(outcome.status === 'committed' && outcome.undo).toEqual({
      sessionId: 'session-1', undoReceipt: 'undo-1', kind: 'append', path: `${VAULT}/commentary.md`, afterSha256: await sha256Hex(POSTIMAGE), beforeSha256: baselineSha,
    })
  })

  it('sends nothing when the bound page no longer holds the reviewed text, and Add may review afresh', async () => {
    const { registry, controller } = await setup()
    registry.api.bindDocument.mockImplementation(async () => ({ status: 'bound', documentHandle: 'doc-1', displayPath: 'commentary.md', contentSha256: 'f'.repeat(64) }) as never)
    const opening = controller.openCaptureRun(KEY, CAPTURE)!
    const { value } = request({ kind: 'append', path: `${VAULT}/commentary.md`, baseline: BASELINE })
    expect(await controller.submit(opening, value)).toEqual({ status: 'notWritten', reason: 'changed' })
    expect(registry.api.submitProposal).not.toHaveBeenCalled()
    expect(registry.api.beginRun).toHaveBeenCalledTimes(1)
    await controller.submit(opening, value)
    expect(registry.api.beginRun).toHaveBeenCalledTimes(2)
  })

  it('refuses an unsafe tail before admitting anything', async () => {
    const { registry, controller } = await setup()
    const { value } = request({ kind: 'append', path: `${VAULT}/commentary.md`, baseline: '```\nopen fence\n' }, () => ({ status: 'refused', reason: 'unsafeTail' }))
    expect(await controller.submit(controller.openCaptureRun(KEY, CAPTURE)!, value)).toEqual({ status: 'notWritten', reason: 'unsafeTail' })
    expect(registry.effects()).toBe(0)
  })

  it('keeps a lost reply as the answer, never sends it again, and a query that finds it committed opens nothing', async () => {
    const { registry, controller } = await setup()
    const baselineSha = await sha256Hex(BASELINE)
    registry.api.bindDocument.mockImplementation(async () => ({ status: 'bound', documentHandle: 'doc-1', displayPath: 'commentary.md', contentSha256: baselineSha }) as never)
    registry.api.submitProposal.mockImplementationOnce(async () => null)
    const opening = controller.openCaptureRun(KEY, CAPTURE)!
    const { value, open } = request({ kind: 'append', path: `${VAULT}/commentary.md`, baseline: BASELINE })
    const first = await controller.submit(opening, value)
    expect(first.status).toBe('uncertain')
    expect((await controller.submit(opening, value)).status).toBe('uncertain')
    expect(registry.api.submitProposal).toHaveBeenCalledTimes(1)
    const sent = registry.api.submitProposal.mock.calls[0][0] as AppendProposal
    registry.api.queryProposal.mockImplementationOnce(async () => appendCommitted(sent))
    expect(await controller.recheck(opening)).toMatchObject({ status: 'committed', receipt: { undoReceipt: 'undo-1' } })
    expect(open.open).not.toHaveBeenCalled()
  })

  it('answers busy to a second Add while the first is running', async () => {
    const { registry, controller } = await setup()
    const reply = deferred<ProposalReceipt | null>()
    registry.api.bindDocument.mockImplementation(async () => ({ status: 'bound', documentHandle: 'doc-1', displayPath: 'commentary.md', contentSha256: await sha256Hex(BASELINE) }) as never)
    registry.api.submitProposal.mockImplementationOnce(() => reply.promise)
    const opening = controller.openCaptureRun(KEY, CAPTURE)!
    const { value } = request({ kind: 'append', path: `${VAULT}/commentary.md`, baseline: BASELINE })
    const first = controller.submit(opening, value)
    expect(await controller.submit(opening, value)).toEqual({ status: 'busy' })
    await vi.waitFor(() => expect(registry.api.submitProposal).toHaveBeenCalledTimes(1))
    reply.resolve(appendCommitted(registry.api.submitProposal.mock.calls[0][0] as AppendProposal))
    expect((await first).status).toBe('committed')
  })
})

describe('Undo after the run ended', () => {
  async function committedAppend() {
    const { registry, controller } = await setup()
    const baselineSha = await sha256Hex(BASELINE)
    registry.api.bindDocument.mockImplementation(async () => ({ status: 'bound', documentHandle: 'doc-1', displayPath: 'commentary.md', contentSha256: baselineSha }) as never)
    registry.api.submitProposal.mockImplementation(async proposal => appendCommitted(proposal as AppendProposal))
    const outcome = await controller.submit(controller.openCaptureRun(KEY, CAPTURE)!, request({ kind: 'append', path: `${VAULT}/commentary.md`, baseline: BASELINE }).value)
    if (outcome.status !== 'committed' || !outcome.undo) throw new Error('expected an undo offer')
    return { registry, controller, offer: outcome.undo }
  }

  it('sends the offer bound to its session with a fresh operation id each press', async () => {
    const { registry, controller, offer } = await committedAppend()
    registry.api.undoProposal.mockImplementation(async request => ({ status: 'conflict', operationId: request.operationId, reason: 'changed' }))
    expect((await controller.undo(offer)).status).toBe('conflict')
    expect((await controller.undo(offer)).status).toBe('conflict')
    const [first, second] = registry.api.undoProposal.mock.calls.map(call => call[0])
    expect(first).toMatchObject({ sessionId: 'session-1', undoReceipt: 'undo-1', kind: 'append', expectedSha256: offer.afterSha256, beforeSha256: offer.beforeSha256 })
    expect(first.operationId).not.toBe(second.operationId)
    expect(registry.api.endRun).toHaveBeenCalled()
  })

  it('keeps a press with no answer as its own operation, asked about by query only', async () => {
    const { registry, controller, offer } = await committedAppend()
    const pressed = await controller.undo(offer)
    expect(pressed).toMatchObject({ status: 'unanswered', detail: 'noReply' })
    const operationId = pressed.status === 'unanswered' ? pressed.operationId : ''
    registry.api.queryUndo.mockImplementationOnce(async () => ({ status: 'running', operationId }))
    expect(await controller.recheckUndo(offer, operationId)).toEqual({ status: 'unanswered', operationId, detail: 'running' })
    registry.api.queryUndo.mockImplementationOnce(async () => ({ status: 'undone', operationId, kind: 'append', path: offer.path, restoredSha256: offer.beforeSha256!, durable: true }))
    expect((await controller.recheckUndo(offer, operationId)).status).toBe('undone')
    expect(registry.api.undoProposal).toHaveBeenCalledTimes(1)
  })

  it('releases an offer that is no longer shown', async () => {
    const { registry, controller, offer } = await committedAppend()
    controller.releaseUndo(offer)
    expect(registry.api.releaseUndo).toHaveBeenCalledWith({ sessionId: 'session-1', undoReceipt: 'undo-1' })
  })
})
