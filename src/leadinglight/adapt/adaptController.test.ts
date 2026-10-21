import { describe, expect, it, vi } from 'vitest'
import { parseExtensionPackage } from '../extensions/extensionSchema'
import quickText from '../extensions/fixtures/quick-note.json?raw'
import meetingText from '../extensions/fixtures/meeting-debrief.json?raw'
import { AT, deferred, fakeHost, SHA } from './adapt.test-utils'
import type { AdaptApi, AdaptProviderState, AdaptSendReply, AdaptStatusReply } from './adaptContract'
import { createAdaptController, includedTurnsOf, lastOutcomeOf, turnPhaseOf } from './adaptController'

const VAULT = '/Users/someone/Private Notes'

async function ready(codex?: AdaptProviderState, retries = 4) {
  const host = fakeHost(codex)
  const controller = createAdaptController({ api: host.api as unknown as AdaptApi, pollMs: 1, retryMs: 1, retries })
  await controller.enter(VAULT)
  await vi.waitFor(() => expect(controller.snapshot().provider.status).toBe('known'))
  return { host, controller }
}

const quick = () => {
  const parsed = parseExtensionPackage(quickText)
  if (parsed.status !== 'valid') throw new Error('fixture')
  return parsed.extension
}

describe('sending only what the person chose', () => {
  it('sends nothing until Codex is connected and the request has words', async () => {
    const { host, controller } = await ready({ status: 'signedOut', lastConnect: null })
    controller.setRequest('A weekly review')
    expect(controller.canSend()).toBe(false)
    await controller.send()
    expect(host.api.newConversation).not.toHaveBeenCalled()
    expect(host.api.send).not.toHaveBeenCalled()
  })

  it('sends exactly the request and visible attachments, no path, and clears the composer once admitted', async () => {
    const { host, controller } = await ready()
    controller.setRequest('A reading reflection')
    controller.attachText('Dune, chapter 3', 'Pasted text')
    controller.attachPage({ title: 'Reading list', text: '# Reading list' })
    await controller.send()
    const args = host.api.send.mock.calls[0][0]
    expect(args).toMatchObject({
      request: 'A reading reflection', provider: 'codex', includeTurnIds: [], revision: null,
      attachments: [{ kind: 'pastedText', label: 'Pasted text', text: 'Dune, chapter 3' }, { kind: 'pageSnapshot', label: 'Reading list', text: '# Reading list' }],
    })
    expect(JSON.stringify(args)).not.toContain(VAULT)
    expect(controller.snapshot().draft).toEqual({ request: '', attachments: [] })
    expect(turnPhaseOf(controller.snapshot())).toBe('working')
    host.reply(args.conversationId)
    await vi.waitFor(() => expect(lastOutcomeOf(controller.snapshot().conversation)?.kind).toBe('reply'))
    expect(controller.snapshot().unseenReply).toBe(true)
    expect(host.api.newConversation).toHaveBeenCalledOnce()
  })

  it('resends only finished earlier turns that ended with a reply, and New request resends nothing', async () => {
    const { host, controller } = await ready()
    controller.setRequest('First')
    await controller.send()
    const conversationId = host.api.send.mock.calls[0][0].conversationId
    host.fail(conversationId)
    await vi.waitFor(() => expect(controller.snapshot().conversation?.turn).toBeNull())
    controller.setRequest('Second')
    await controller.send()
    host.reply(conversationId)
    await vi.waitFor(() => expect(lastOutcomeOf(controller.snapshot().conversation)?.kind).toBe('reply'))
    controller.setRequest('Third')
    await controller.send()
    const [, second, third] = host.api.send.mock.calls.map(([args]) => args)
    expect(second.includeTurnIds).toEqual([])
    expect(third.includeTurnIds).toEqual([second.turnId])
    expect(includedTurnsOf(controller.snapshot().conversation)).toEqual([second.turnId])
    host.reply(conversationId)
    await vi.waitFor(() => expect(controller.snapshot().conversation?.turn).toBeNull())
    controller.newRequest()
    controller.setRequest('Fresh')
    await controller.send()
    expect(host.api.send.mock.calls[3][0]).toMatchObject({ includeTurnIds: [], conversationId: 'conv-2' })
  })
})

describe('keeping the request through every non-reply ending', () => {
  it('puts the draft back after a failure and retries only on an explicit Send with a new turn', async () => {
    const { host, controller } = await ready()
    controller.setRequest('A weekly review')
    controller.attachText('notes', 'Pasted text')
    await controller.send()
    host.fail(host.api.send.mock.calls[0][0].conversationId)
    await vi.waitFor(() => expect(controller.snapshot().draft.request).toBe('A weekly review'))
    expect(controller.snapshot().draft.attachments.map(item => item.label)).toEqual(['Pasted text'])
    await new Promise(done => setTimeout(done, 20))
    expect(host.api.send).toHaveBeenCalledOnce()
    await controller.send()
    const [first, second] = host.api.send.mock.calls.map(([args]) => args.turnId)
    expect(second).not.toBe(first)
  })

  it('puts the draft back when Send is refused', async () => {
    const { host, controller } = await ready()
    host.state.codex = { status: 'signedOut', lastConnect: null }
    controller.setRequest('Needs a sign-in')
    await controller.send()
    expect(controller.snapshot()).toMatchObject({ draft: { request: 'Needs a sign-in' }, notice: { kind: 'sendRefused', reason: 'notConnected' } })
  })

  it('closes admission by turn id when cancelled before Send is answered, and keeps the draft', async () => {
    const { host, controller } = await ready()
    const admission = deferred<void>()
    const original = host.api.send.getMockImplementation()!
    host.api.send.mockImplementationOnce(async args => { await admission.promise; return original(args) })
    controller.setRequest('Stop me')
    const sending = controller.send()
    await vi.waitFor(() => expect(controller.snapshot().attempt?.stage).toBe('admitting'))
    const { turnId } = controller.snapshot().attempt!
    expect(turnPhaseOf(controller.snapshot())).toBe('sending')
    await controller.cancel()
    expect(host.api.cancelTurn).toHaveBeenCalledWith(expect.objectContaining({ turnId }))
    admission.resolve()
    await sending
    expect(controller.snapshot()).toMatchObject({ attempt: null, draft: { request: 'Stop me' }, notice: { kind: 'sendRefused', reason: 'cancelled' } })
  })

  it('reports a stop native did not confirm, and puts the draft back', async () => {
    const { host, controller } = await ready()
    controller.setRequest('Long one')
    await controller.send()
    const { conversationId, turnId } = host.api.send.mock.calls[0][0]
    host.api.cancelTurn.mockImplementationOnce(async () => { host.setPhase(conversationId, 'stopping'); return { status: 'stopping' } as const })
    await controller.cancel()
    expect(turnPhaseOf(controller.snapshot())).toBe('stopping')
    host.finish(conversationId, { kind: 'stopped', turnId, at: AT, reason: 'cancelled', confirmed: false })
    await vi.waitFor(() => expect(controller.snapshot().notice).toEqual({ kind: 'cancelUnconfirmed' }))
    expect(controller.snapshot().draft.request).toBe('Long one')
  })

  it('after an unanswered Send, cancels that turn id and keeps the draft once native proves it kept nothing', async () => {
    const { host, controller } = await ready()
    host.api.send.mockResolvedValueOnce(null)
    controller.setRequest('Lost on the way')
    await controller.send()
    const { turnId } = host.api.send.mock.calls[0][0]
    expect(host.api.cancelTurn).toHaveBeenCalledWith(expect.objectContaining({ turnId }))
    await vi.waitFor(() => expect(controller.snapshot().notice).toEqual({ kind: 'sendRefused', reason: 'notSent' }))
    expect(controller.snapshot()).toMatchObject({ attempt: null, draft: { request: 'Lost on the way' } })
    expect(controller.canSend()).toBe(true)
  })
})

describe('one Send at a time', () => {
  /** Holds the next call of `method` until `release()`, then answers as the host would. */
  function hold<K extends 'newConversation' | 'send' | 'readConversation'>(host: ReturnType<typeof fakeHost>, method: K) {
    const gate = deferred<void>()
    const mock = host.api[method] as unknown as ReturnType<typeof vi.fn>
    const original = mock.getMockImplementation()!
    mock.mockImplementationOnce(async (args: unknown) => { await gate.promise; return original(args) })
    return { release: () => gate.resolve() }
  }

  it('makes one conversation and one Send for a double click while the conversation is being made', async () => {
    const { host, controller } = await ready()
    const creating = hold(host, 'newConversation')
    controller.setRequest('Once')
    const first = controller.send()
    const second = controller.send()
    expect(controller.snapshot().attempt).toMatchObject({ stage: 'creating' })
    controller.newRequest()
    expect(controller.snapshot().draft.request).toBe('Once')
    creating.release()
    await Promise.all([first, second])
    expect(host.api.newConversation).toHaveBeenCalledOnce()
    expect(host.api.send).toHaveBeenCalledOnce()
    expect(controller.snapshot().conversationId).toBe('conv-1')
  })

  it('never calls Send when cancelled while its conversation is being made', async () => {
    const { host, controller } = await ready()
    const creating = hold(host, 'newConversation')
    controller.setRequest('Never mind')
    const sending = controller.send()
    await controller.cancel()
    expect(turnPhaseOf(controller.snapshot())).toBe('stopping')
    creating.release()
    await sending
    expect(host.api.send).not.toHaveBeenCalled()
    expect(controller.snapshot()).toMatchObject({ attempt: null, draft: { request: 'Never mind' }, notice: { kind: 'sendRefused', reason: 'cancelled' } })
  })

  it('keeps an unanswered Send whose cancel also went unanswered, and shows the old turn when it starts late', async () => {
    const { host, controller } = await ready()
    const original = host.api.send.getMockImplementation()!
    let deliver!: () => Promise<AdaptSendReply | null>
    host.api.send.mockImplementationOnce(async args => { deliver = () => original(args); return null })
    host.api.cancelTurn.mockResolvedValueOnce(null)
    controller.setRequest('Lost reply')
    await controller.send()
    expect(controller.snapshot()).toMatchObject({ attempt: { stage: 'unresolved', cancel: 'unconfirmed' }, notice: { kind: 'cancelUnconfirmed' } })
    const reads = host.api.readConversation.mock.calls.length
    await vi.waitFor(() => expect(host.api.readConversation.mock.calls.length).toBeGreaterThan(reads + 2))
    // Empty transcripts prove nothing: no "not sent", and no second Send.
    expect(controller.snapshot().notice).toEqual({ kind: 'cancelUnconfirmed' })
    expect(controller.canSend()).toBe(false)
    await deliver()
    await vi.waitFor(() => expect(controller.snapshot().attempt?.stage).toBe('running'))
    expect(controller.snapshot().draft.request).toBe('')
    host.reply(host.api.send.mock.calls[0][0].conversationId)
    await vi.waitFor(() => expect(controller.snapshot().attempt).toBeNull())
    expect(lastOutcomeOf(controller.snapshot().conversation)?.kind).toBe('reply')
    expect(controller.snapshot().notice).toBeNull()
    expect(host.api.send).toHaveBeenCalledOnce()
  })

  it('keeps what the person typed while Send was unanswered, and stays busy until the turn is read', async () => {
    const { host, controller } = await ready()
    const admission = hold(host, 'send')
    const reading = hold(host, 'readConversation')
    controller.setRequest('First thought')
    // The composer always has words here, so only the Send in flight can make Send unavailable.
    const allowed: boolean[] = []
    const stop = controller.subscribe(() => allowed.push(controller.canSend()))
    const sending = controller.send()
    await vi.waitFor(() => expect(host.api.send).toHaveBeenCalledOnce())
    controller.setRequest('Second thought')
    admission.release()
    await vi.waitFor(() => expect(controller.snapshot().attempt?.stage).toBe('running'))
    reading.release()
    await sending
    stop()
    expect(allowed).not.toContain(true)
    expect(host.api.send.mock.calls[0][0].request).toBe('First thought')
    expect(controller.snapshot().draft.request).toBe('Second thought')
  })

  it('cancels the pending turn in its own conversation even after the person picks another', async () => {
    const { host, controller } = await ready()
    controller.setRequest('One')
    await controller.send()
    host.reply('conv-1')
    await vi.waitFor(() => expect(controller.snapshot().attempt).toBeNull())
    controller.newRequest()
    const admission = hold(host, 'send')
    controller.setRequest('Two')
    const sending = controller.send()
    await vi.waitFor(() => expect(host.api.send).toHaveBeenCalledTimes(2))
    controller.newRequest()
    await controller.show('conv-1')
    await controller.deleteConversation()
    expect(controller.snapshot().conversationId).toBe('conv-2')
    expect(host.api.deleteConversation).not.toHaveBeenCalled()
    await controller.cancel()
    expect(host.api.cancelTurn).toHaveBeenCalledWith({ visitId: 'visit-1', conversationId: 'conv-2', turnId: host.api.send.mock.calls[1][0].turnId })
    admission.release()
    await sending
    expect(host.api.send).toHaveBeenCalledTimes(2)
  })

  it('ignores an older running snapshot that arrives after the turn ended', async () => {
    const { host, controller } = await ready()
    controller.setRequest('Race')
    await controller.send()
    const { conversationId } = host.api.send.mock.calls[0][0]
    const running = host.store.get(conversationId)!
    const stale = deferred<void>()
    const reads = host.api.readConversation.mock.calls.length
    host.api.readConversation.mockImplementationOnce(async () => { await stale.promise; return { status: 'ok', conversation: running } })
    await vi.waitFor(() => expect(host.api.readConversation).toHaveBeenCalledTimes(reads + 1))
    host.reply(conversationId)
    await controller.cancel()
    expect(controller.snapshot().attempt).toBeNull()
    stale.resolve()
    await new Promise(done => setTimeout(done, 10))
    expect(controller.snapshot().conversation?.turn).toBeNull()
    expect(lastOutcomeOf(controller.snapshot().conversation)?.kind).toBe('reply')
  })

  it('ends a Send whose visit native no longer knows, keeping its draft, and reopens only when asked', async () => {
    const { host, controller } = await ready()
    host.api.send.mockResolvedValueOnce(null)
    host.api.cancelTurn.mockResolvedValueOnce({ status: 'unknownVisit' })
    controller.setRequest('Visit ended')
    await controller.send()
    expect(controller.snapshot()).toMatchObject({ visit: 'closed', attempt: null, draft: { request: 'Visit ended' }, notice: { kind: 'visitClosed' } })
    expect(controller.canSend()).toBe(false)
    expect(host.api.openVisit).toHaveBeenCalledOnce()
    await controller.reopen()
    expect(controller.snapshot()).toMatchObject({ visit: 'open', draft: { request: 'Visit ended' } })
  })
})

describe('visits and accounts', () => {
  it('ignores a visit that opens late for a vault already left, and closes it', async () => {
    const host = fakeHost()
    const late = deferred<{ status: 'open'; visitId: string }>()
    host.api.openVisit.mockImplementationOnce(() => late.promise)
    const controller = createAdaptController({ api: host.api as unknown as AdaptApi, pollMs: 1 })
    const first = controller.enter('/vaults/a')
    await controller.enter('/vaults/b')
    late.resolve({ status: 'open', visitId: 'visit-old' })
    await first
    expect(host.api.closeVisit).toHaveBeenCalledWith({ visitId: 'visit-old' })
    expect(controller.snapshot().visit).toBe('open')
  })

  it('shows nothing from a turn that finishes after its vault was left', async () => {
    const { host, controller } = await ready()
    controller.setRequest('Before the switch')
    await controller.send()
    const { conversationId } = host.api.send.mock.calls[0][0]
    await controller.enter('/vaults/other')
    host.reply(conversationId)
    await new Promise(done => setTimeout(done, 20))
    expect(controller.snapshot()).toMatchObject({ conversationId: null, conversation: null })
    expect(host.api.closeVisit).toHaveBeenCalledWith({ visitId: 'visit-1' })
  })

  it('closes and reopens the visit when the account changes, keeping what the person is typing', async () => {
    const { host, controller } = await ready()
    controller.setRequest('Half typed')
    host.state.codex = { status: 'signedOut', lastConnect: null }
    await controller.refreshStatus()
    await vi.waitFor(() => expect(host.api.openVisit).toHaveBeenCalledTimes(2))
    expect(host.api.closeVisit).toHaveBeenCalledWith({ visitId: 'visit-1' })
    expect(controller.snapshot().draft.request).toBe('Half typed')
  })

  it('connects only on Connect and follows the sign-in until it ends', async () => {
    const { host, controller } = await ready({ status: 'signedOut', lastConnect: null })
    expect(host.api.connect).not.toHaveBeenCalled()
    await controller.connect()
    expect(host.api.connect).toHaveBeenCalledWith({ provider: 'codex', disclosureVersion: 'adapt-disclosure-1' })
    host.state.codex = { status: 'connected' }
    await vi.waitFor(() => expect(controller.snapshot().provider).toMatchObject({ codex: { status: 'connected' } }))
  })
})

describe('late answers, stopping work and local saving', () => {
  const claude = { status: 'unavailable', reason: 'notAuthorized', installedVersion: null } as const

  it('ignores an older signed-out status that arrives after a newer connected one, keeping the visit and the Send', async () => {
    const { host, controller } = await ready()
    controller.setRequest('Keep running')
    await controller.send()
    const stale = deferred<AdaptStatusReply>()
    host.api.status.mockImplementationOnce(() => stale.promise)
    const older = controller.refreshStatus()
    await controller.refreshStatus()
    stale.resolve({ revision: 1, providers: { codex: { status: 'signedOut', lastConnect: null }, claude } })
    await older
    expect(controller.snapshot()).toMatchObject({ provider: { codex: { status: 'connected' } }, visit: 'open', attempt: { stage: 'running' } })
    expect(host.api.openVisit).toHaveBeenCalledOnce()
    expect(host.api.closeVisit).not.toHaveBeenCalled()
  })

  it('keeps New request, or a later pick, when an earlier history read answers late', async () => {
    const { host, controller } = await ready()
    controller.setRequest('One')
    await controller.send()
    host.reply('conv-1')
    await vi.waitFor(() => expect(controller.snapshot().attempt).toBeNull())
    controller.newRequest()
    controller.setRequest('Two')
    await controller.send()
    host.reply('conv-2')
    await vi.waitFor(() => expect(controller.snapshot().attempt).toBeNull())

    const original = host.api.readConversation.getMockImplementation()!
    const late = deferred<void>()
    host.api.readConversation.mockImplementationOnce(async args => { await late.promise; return original(args) })
    const picking = controller.show('conv-1')
    controller.newRequest()
    late.resolve()
    await picking
    expect(controller.snapshot()).toMatchObject({ conversationId: null, conversation: null })

    const later = deferred<void>()
    host.api.readConversation.mockImplementationOnce(async args => { await later.promise; return original(args) })
    const first = controller.show('conv-1')
    await controller.show('conv-2')
    later.resolve()
    await first
    expect(controller.snapshot().conversationId).toBe('conv-2')
  })

  it('asks a stopping close again by the same id, without holding up the next visit', async () => {
    const { host, controller } = await ready()
    host.api.closeVisit.mockResolvedValueOnce({ status: 'stopping' } as never).mockResolvedValueOnce({ status: 'stopping' } as never)
    await controller.enter('/vaults/next')
    expect(controller.snapshot()).toMatchObject({ visit: 'open', closingVisit: 'stopping' })
    controller.setRequest('Writing meanwhile')
    expect(controller.canSend()).toBe(true)
    await vi.waitFor(() => expect(controller.snapshot().closingVisit).toBe('none'))
    expect(host.api.closeVisit.mock.calls.map(([args]) => args.visitId)).toEqual(['visit-1', 'visit-1', 'visit-1'])
  })

  it('reports a close native never confirms as unconfirmed, after a bounded number of asks', async () => {
    const { host, controller } = await ready(undefined, 3)
    host.api.closeVisit.mockResolvedValue({ status: 'stopping' } as never)
    await controller.exit()
    await vi.waitFor(() => expect(controller.snapshot().closingVisit).toBe('unconfirmed'))
    expect(host.api.closeVisit).toHaveBeenCalledTimes(4)
  })

  it('shows a sign-out whose work is still stopping as stopping, and lets no new sign-in start until it ends', async () => {
    const { host, controller } = await ready()
    const proven = deferred<{ status: 'disconnected' }>()
    host.api.disconnect
      .mockImplementationOnce(async () => { host.state.codex = { status: 'signedOut', lastConnect: null }; return { status: 'stopping' } as never })
      .mockImplementationOnce(() => proven.promise as never)
    await controller.disconnect()
    expect(controller.snapshot()).toMatchObject({ signingOut: 'stopping', provider: { codex: { status: 'signedOut' } } })
    await controller.connect()
    expect(host.api.connect).not.toHaveBeenCalled()
    proven.resolve({ status: 'disconnected' })
    await vi.waitFor(() => expect(controller.snapshot().signingOut).toBe('none'))
    await controller.connect()
    expect(host.api.connect).toHaveBeenCalledOnce()
  })

  it('shows an unsaved conversation as unsaved and saves it again locally, without sending anything', async () => {
    const { host, controller } = await ready()
    controller.setRequest('Keep my reply')
    await controller.send()
    host.reply('conv-1')
    host.setStorage('conv-1', 'unsaved')
    await vi.waitFor(() => expect(controller.snapshot().conversation?.storage).toBe('unsaved'))
    host.api.saveConversation.mockResolvedValueOnce(null as never)
    await controller.saveConversation()
    expect(controller.snapshot()).toMatchObject({ notice: { kind: 'saveRefused' }, conversation: { storage: 'unsaved' } })
    expect(lastOutcomeOf(controller.snapshot().conversation)?.kind).toBe('reply')
    host.state.saves = 'unconfirmed'
    await controller.saveConversation()
    expect(controller.snapshot().conversation?.storage).toBe('unconfirmed')
    host.state.saves = 'saved'
    await controller.saveConversation()
    expect(controller.snapshot().conversation?.storage).toBe('saved')
    expect(host.api.saveConversation).toHaveBeenCalledTimes(3)
    expect(host.api.send).toHaveBeenCalledOnce()
  })

  it('reopens a visit that ended natively with the same conversation in view, even one that ended in a failure', async () => {
    const { host, controller } = await ready()
    controller.setRequest('Failing')
    await controller.send()
    host.fail('conv-1')
    await vi.waitFor(() => expect(controller.snapshot().attempt).toBeNull())
    host.api.readConversation.mockResolvedValueOnce({ status: 'unknownVisit' } as never)
    await controller.show('conv-1')
    expect(controller.snapshot()).toMatchObject({ visit: 'closed', conversationId: 'conv-1' })
    await controller.reopen()
    await vi.waitFor(() => expect(controller.snapshot()).toMatchObject({ visit: 'open', conversationId: 'conv-1' }))
    expect(lastOutcomeOf(controller.snapshot().conversation)?.kind).toBe('failed')
  })
})

describe('revisions and local history', () => {
  it('binds an ordinary extension by its attached hash, and keeps that binding for follow-ups', async () => {
    const { host, controller } = await ready()
    controller.attachPackage(quick(), { sha256: SHA, activeSha256: SHA })
    controller.setRequest('Ask for a mood too')
    await controller.send()
    const { conversationId } = host.api.send.mock.calls[0][0]
    expect(host.api.send.mock.calls[0][0].revision).toEqual({ packageId: 'local.quick-note', baseSha256: SHA, expectedActiveSha256: SHA })
    host.reply(conversationId)
    await vi.waitFor(() => expect(controller.snapshot().conversation?.turn).toBeNull())
    controller.setRequest('And a date')
    await controller.send()
    expect(host.api.send.mock.calls[1][0]).toMatchObject({ attachments: [], revision: { packageId: 'local.quick-note', baseSha256: SHA, expectedActiveSha256: SHA } })
  })

  it('names no base for a bundled extension, so its change becomes a new extension', async () => {
    const { host, controller } = await ready()
    const parsed = parseExtensionPackage(meetingText.replace('"local.meeting-debrief"', '"leadinglight.meeting-debrief"'))
    if (parsed.status !== 'valid') throw new Error('fixture')
    controller.attachPackage(parsed.extension, { sha256: SHA, activeSha256: SHA })
    controller.setRequest('Make my own version')
    await controller.send()
    expect(host.api.send.mock.calls[0][0]).toMatchObject({ revision: null, attachments: [{ kind: 'extension' }] })
  })

  it('reopens the latest conversation when it ended with a reply, and starts fresh after a failure', async () => {
    const { host, controller } = await ready()
    controller.setRequest('Keep me')
    await controller.send()
    host.reply(host.api.send.mock.calls[0][0].conversationId)
    await vi.waitFor(() => expect(controller.snapshot().conversation?.turn).toBeNull())
    await controller.enter(VAULT)
    await vi.waitFor(() => expect(controller.snapshot().conversationId).toBe('conv-1'))

    controller.newRequest()
    controller.setRequest('Fail me')
    await controller.send()
    host.fail('conv-2')
    await vi.waitFor(() => expect(controller.snapshot().conversation?.turn).toBeNull())
    await controller.enter(VAULT)
    await vi.waitFor(() => expect(controller.snapshot().visit).toBe('open'))
    await new Promise(done => setTimeout(done, 10))
    expect(controller.snapshot().conversationId).toBeNull()
  })

  it('refuses to delete a running conversation and deletes a finished one', async () => {
    const { host, controller } = await ready()
    controller.setRequest('Running')
    await controller.send()
    await controller.deleteConversation()
    expect(controller.snapshot().notice).toEqual({ kind: 'deleteRefused', reason: 'running' })
    expect(host.api.deleteConversation).not.toHaveBeenCalled()
    host.reply('conv-1')
    await vi.waitFor(() => expect(controller.snapshot().conversation?.turn).toBeNull())
    await controller.deleteConversation()
    expect(controller.snapshot()).toMatchObject({ conversationId: null, conversation: null, notice: null })
    expect(host.store.has('conv-1')).toBe(false)
  })
})
