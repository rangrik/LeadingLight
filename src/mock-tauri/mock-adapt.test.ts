import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ADAPT_COMMANDS, ADAPT_LIMITS,
  parseCancelConnectReply, parseCancelTurnReply, parseCloseVisitReply, parseConnectReply, parseDeleteConversationReply, parseDisconnectReply,
  parseListConversationsReply, parseNewConversationReply, parseOpenVisitReply, parseReadConversationReply, parseSaveConversationReply,
  parseSendReply, parseStatusReply,
  type AdaptAttachment, type AdaptCommandName, type AdaptConversation, type AdaptEntry, type AdaptProvider, type AdaptReply, type AdaptSendArgs,
} from '../leadinglight/adapt/adaptContract'
import { parseExtensionPackage } from '../leadinglight/extensions/extensionSchema'
import * as helper from '../../tests/helpers/adaptFixture'
import {
  ADAPT_COMMAND_LIST, ADAPT_FIXTURE_FORMAT, ADAPT_FIXTURE_GUIDE, ADAPT_FIXTURE_KEY, ADAPT_FIXTURE_STATE_KEY, ADAPT_FIXTURE_STEP_MS,
  AdaptArgumentError, browserAdaptHost, readAdaptFixtureScript,
  type AdaptBrowserHost, type AdaptFixtureScript, type AdaptFixtureTurn,
} from './mock-adapt'

const VAULT = '/tmp/laputa-test-vault-adapt'
const PACKAGE_ID = 'local.reading-log'
const sha = (text: string) => createHash('sha256').update(text).digest('hex')
const candidate = (packageText = helper.adaptSamplePackage(PACKAGE_ID)): AdaptReply => ({ kind: 'candidate', message: 'Here is a reading log.', packageText })
const question: AdaptReply = { kind: 'question', message: 'Which folder should it use?', choices: ['Notes', 'Journal'] }
const unsupported: AdaptReply = { kind: 'unsupported', message: 'Extensions cannot send email.', alternative: 'A note you can copy from.' }

/** sessionStorage that can be made to refuse writes, as a full quota does. */
function memoryStorage() {
  const items = new Map<string, string>()
  const storage = {
    full: false,
    get length() { return items.size },
    clear: () => items.clear(),
    getItem: (key: string) => items.get(key) ?? null,
    key: (index: number) => [...items.keys()][index] ?? null,
    removeItem: (key: string) => { items.delete(key) },
    setItem(key: string, value: string) {
      if (storage.full) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      items.set(key, String(value))
    },
  }
  return storage
}
type MemoryStorage = ReturnType<typeof memoryStorage>

function withScript(script: Partial<AdaptFixtureScript>, storage: MemoryStorage = memoryStorage()) {
  storage.setItem(ADAPT_FIXTURE_KEY, JSON.stringify({ fixture: ADAPT_FIXTURE_FORMAT, ...script }))
  return { host: browserAdaptHost(true, storage), storage }
}

/** The host as the UI meets it: `invoke(command, { args })`, every reply read by the frozen contract. */
function api(host: AdaptBrowserHost) {
  function ask<T>(command: AdaptCommandName, args: object, parse: (value: unknown) => T | null): T {
    const reply = host.handle(command, { args })
    const parsed = parse(reply)
    if (parsed === null) throw new Error(`${command} answered outside the contract: ${JSON.stringify(reply)}`)
    return parsed
  }
  return {
    status: () => ask(ADAPT_COMMANDS.status, {}, parseStatusReply),
    codex: () => ask(ADAPT_COMMANDS.status, {}, parseStatusReply).providers.codex,
    connect: (provider: AdaptProvider = 'codex') =>
      ask(ADAPT_COMMANDS.connect, { provider, disclosureVersion: 'adapt-codex-disclosure-1' }, parseConnectReply),
    cancelConnect: () => ask(ADAPT_COMMANDS.cancelConnect, { provider: 'codex' }, parseCancelConnectReply),
    disconnect: () => ask(ADAPT_COMMANDS.disconnect, { provider: 'codex' }, parseDisconnectReply),
    open: (vaultPath = VAULT) => ask(ADAPT_COMMANDS.openVisit, { vaultPath }, parseOpenVisitReply),
    close: (visitId: string) => ask(ADAPT_COMMANDS.closeVisit, { visitId }, parseCloseVisitReply),
    list: (visitId: string) => ask(ADAPT_COMMANDS.listConversations, { visitId }, parseListConversationsReply),
    create: (visitId: string) => ask(ADAPT_COMMANDS.newConversation, { visitId }, parseNewConversationReply),
    read(visitId: string, conversationId: string, knownRevision: number | null = null) {
      const args = { visitId, conversationId, knownRevision }
      return ask(ADAPT_COMMANDS.readConversation, args, value => parseReadConversationReply(value, args))
    },
    remove: (visitId: string, conversationId: string) =>
      ask(ADAPT_COMMANDS.deleteConversation, { visitId, conversationId }, parseDeleteConversationReply),
    save: (visitId: string, conversationId: string) =>
      ask(ADAPT_COMMANDS.saveConversation, { visitId, conversationId }, parseSaveConversationReply),
    send: (args: AdaptSendArgs) => ask(ADAPT_COMMANDS.send, args, value => parseSendReply(value, args)),
    cancel: (visitId: string, conversationId: string, turnId: string) =>
      ask(ADAPT_COMMANDS.cancelTurn, { visitId, conversationId, turnId }, parseCancelTurnReply),
  }
}
type Api = ReturnType<typeof api>

function visitOf(adapt: Api, vaultPath = VAULT): string {
  const visit = adapt.open(vaultPath)
  if (visit.status !== 'open') throw new Error(`no visit: ${visit.reason}`)
  return visit.visitId
}

function conversationIn(adapt: Api, visitId: string): string {
  const created = adapt.create(visitId)
  if (created.status !== 'created') throw new Error(`no conversation: ${JSON.stringify(created)}`)
  return created.conversationId
}

function snapshot(adapt: Api, visitId: string, conversationId: string): AdaptConversation {
  const read = adapt.read(visitId, conversationId)
  if (read.status !== 'ok') throw new Error(`no conversation: ${read.status}`)
  return read.conversation
}

/** A connected fixture with one open conversation. */
function opened(script: Partial<AdaptFixtureScript> = {}, storage: MemoryStorage = memoryStorage()) {
  const { host } = withScript({ account: 'connected', ...script }, storage)
  const adapt = api(host)
  const visitId = visitOf(adapt)
  const conversationId = conversationIn(adapt, visitId)
  const sendArgs = (overrides: Partial<AdaptSendArgs> = {}): AdaptSendArgs => ({
    visitId, conversationId, turnId: crypto.randomUUID(), provider: 'codex', request: 'Make me a reading log\nwith one field',
    attachments: [], includeTurnIds: [], revision: null, ...overrides,
  })
  const conversation = () => snapshot(adapt, visitId, conversationId)
  return { host, adapt, storage, visitId, conversationId, sendArgs, conversation, last: () => conversation().entries.at(-1) as AdaptEntry }
}

const settle = () => vi.advanceTimersByTime(3 * ADAPT_FIXTURE_STEP_MS)
const sentCount = () => window.__leadinglightAdaptFixture?.sent().length

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete window.__leadinglightAdaptFixture
})

describe('without an explicit fixture', () => {
  it('has no provider and no local Adapt storage: nothing is connected, sent or shown as saved', () => {
    const storage = memoryStorage()
    const adapt = api(browserAdaptHost(true, storage))

    expect(adapt.status().providers).toEqual({
      codex: { status: 'unavailable', reason: 'notInstalled', installedVersion: null },
      claude: { status: 'unavailable', reason: 'notAuthorized', installedVersion: null },
    })
    expect(adapt.connect()).toEqual({ status: 'refused', reason: 'unavailable' })
    expect(adapt.connect('claude')).toEqual({ status: 'refused', reason: 'unavailable' })
    expect(adapt.disconnect()).toEqual({ status: 'refused', reason: 'unavailable' })
    expect(adapt.open()).toEqual({ status: 'refused', reason: 'storageUnavailable' })
    expect(adapt.list('visit-1')).toEqual({ status: 'unknownVisit' })
    expect(adapt.save('visit-1', 'conversation-1')).toEqual({ status: 'unknownVisit' })
    expect(adapt.close('visit-1')).toEqual({ status: 'unknown' })
    expect(window.__leadinglightAdaptFixture).toBeUndefined()
    expect(storage.getItem(ADAPT_FIXTURE_STATE_KEY)).toBeNull()
  })

  it('never reads a script outside the dev server', () => {
    const storage = memoryStorage()
    storage.setItem(ADAPT_FIXTURE_KEY, JSON.stringify({ fixture: ADAPT_FIXTURE_FORMAT, account: 'connected' }))
    const adapt = api(browserAdaptHost(false, storage))

    expect(adapt.codex()).toEqual({ status: 'unavailable', reason: 'notInstalled', installedVersion: null })
    expect(adapt.open()).toEqual({ status: 'refused', reason: 'storageUnavailable' })
    expect(window.__leadinglightAdaptFixture).toBeUndefined()
  })

  it.each([
    ['not JSON', '{'],
    ['another format', JSON.stringify({ fixture: 'leadinglight.adapt-fixture/2', account: 'connected' })],
    ['an unknown key', JSON.stringify({ fixture: ADAPT_FIXTURE_FORMAT, account: 'connected', retries: 3 })],
    ['an unknown account', JSON.stringify({ fixture: ADAPT_FIXTURE_FORMAT, account: 'pro' })],
    ['an unknown Connect result', JSON.stringify({ fixture: ADAPT_FIXTURE_FORMAT, connects: [{ result: 'maybe' }] })],
    ['an unknown cancel fault', JSON.stringify({ fixture: ADAPT_FIXTURE_FORMAT, connects: [{ result: 'connected', cancel: 'lost' }] })],
    ['two answers in one turn', JSON.stringify({ fixture: ADAPT_FIXTURE_FORMAT, turns: [{ reply: question, output: '{}' }] })],
    ['a misspelled turn option', JSON.stringify({ fixture: ADAPT_FIXTURE_FORMAT, turns: [{ reply: question, hodl: true }] })],
    ['an unknown save fault', JSON.stringify({ fixture: ADAPT_FIXTURE_FORMAT, turns: [{ reply: question, outcomeSave: 'lost' }] })],
    ['an unknown failure', JSON.stringify({ fixture: ADAPT_FIXTURE_FORMAT, turns: [{ failure: 'networkDown' }] })],
  ])('fails closed on a script with %s, never a default success', (_, text) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const storage = memoryStorage()
    storage.setItem(ADAPT_FIXTURE_KEY, text)
    const adapt = api(browserAdaptHost(true, storage))

    expect(adapt.codex()).toEqual({ status: 'unavailable', reason: 'failed', installedVersion: null })
    expect(adapt.connect()).toEqual({ status: 'refused', reason: 'unavailable' })
    expect(adapt.open()).toEqual({ status: 'refused', reason: 'storageUnavailable' })
    expect(warn).toHaveBeenCalledOnce()
    expect(window.__leadinglightAdaptFixture).toBeUndefined()
    expect(storage.getItem(ADAPT_FIXTURE_STATE_KEY)).toBeNull()
  })
})

describe('the page dispatch', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })
  afterEach(() => {
    document.head.querySelector('meta[name="leadinglight-vault-api"]')?.remove()
    vi.unstubAllGlobals()
  })

  it('answers all thirteen commands from window.__mockHandlers and mockInvoke, never the dev server or network', async () => {
    // A disk session: the dev server serves E1 from disk, but Adapt still has no provider without a fixture.
    document.head.insertAdjacentHTML('beforeend', '<meta name="leadinglight-vault-api" content="disk">')
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchSpy)
    const { mockInvoke } = await import('./index')

    expect(ADAPT_COMMAND_LIST).toHaveLength(13)
    for (const command of ADAPT_COMMAND_LIST) expect(typeof window.__mockHandlers?.[command]).toBe('function')
    // The desktop harness calls the handler itself.
    const status = parseStatusReply(await window.__mockHandlers?.[ADAPT_COMMANDS.status]?.({ args: {} }))
    expect(status?.providers.codex).toEqual({ status: 'unavailable', reason: 'notInstalled', installedVersion: null })
    const visit = parseOpenVisitReply(await mockInvoke(ADAPT_COMMANDS.openVisit, { args: { vaultPath: VAULT } }))
    expect(visit).toEqual({ status: 'refused', reason: 'storageUnavailable' })
    await expect(mockInvoke(ADAPT_COMMANDS.openVisit, { vaultPath: VAULT })).rejects.toBeInstanceOf(AdaptArgumentError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('Connect', () => {
  it('signs in only on an explicit Connect, once the provider sign-in finishes', () => {
    const { host } = withScript({ connects: [{ result: 'connected' }] })
    const adapt = api(host)

    // Reading status never starts a sign-in.
    for (let read = 0; read < 3; read++) expect(adapt.codex()).toEqual({ status: 'signedOut', lastConnect: null })
    vi.advanceTimersByTime(10_000)
    expect(adapt.codex()).toEqual({ status: 'signedOut', lastConnect: null })
    const before = adapt.status().revision

    expect(adapt.connect()).toEqual({ status: 'started' })
    expect(adapt.codex()).toEqual({ status: 'connecting' })
    expect(adapt.connect()).toEqual({ status: 'refused', reason: 'busy' })
    vi.advanceTimersByTime(ADAPT_FIXTURE_STEP_MS)
    expect(adapt.codex()).toEqual({ status: 'connected' })
    expect(adapt.status().revision).toBeGreaterThan(before)
    expect(adapt.connect()).toEqual({ status: 'refused', reason: 'alreadyConnected' })
    expect(adapt.connect('claude')).toEqual({ status: 'refused', reason: 'unavailable' })
  })

  it('ends a failed, refused, cancelled, browserless or unscripted sign-in honestly', () => {
    const { host } = withScript({ connects: [
      { result: 'failed' }, { result: 'accountNotSupported' }, { result: 'connected', hold: true }, { result: 'browserUnavailable' },
    ] })
    const adapt = api(host)
    const visitId = visitOf(adapt)
    const conversationId = conversationIn(adapt, visitId)
    const send = () => adapt.send({ visitId, conversationId, turnId: crypto.randomUUID(), provider: 'codex', request: 'Make a log', attachments: [], includeTurnIds: [], revision: null })

    adapt.connect()
    vi.advanceTimersByTime(ADAPT_FIXTURE_STEP_MS)
    expect(adapt.codex()).toEqual({ status: 'signedOut', lastConnect: 'failed' })

    adapt.connect()
    vi.advanceTimersByTime(ADAPT_FIXTURE_STEP_MS)
    expect(adapt.codex()).toEqual({ status: 'refused', reason: 'accountNotSupported' })
    expect(send()).toEqual({ status: 'refused', reason: 'notConnected' })
    expect(adapt.connect()).toEqual({ status: 'refused', reason: 'alreadyConnected' })
    expect(adapt.disconnect()).toEqual({ status: 'disconnected' })
    expect(adapt.codex()).toEqual({ status: 'signedOut', lastConnect: null })

    expect(adapt.cancelConnect()).toEqual({ status: 'notConnecting' })
    adapt.connect()
    vi.advanceTimersByTime(60_000)
    expect(adapt.codex()).toEqual({ status: 'connecting' })
    expect(adapt.cancelConnect()).toEqual({ status: 'cancelled' })
    expect(adapt.codex()).toEqual({ status: 'signedOut', lastConnect: 'cancelled' })
    // The cancelled sign-in can never complete afterwards.
    expect(window.__leadinglightAdaptFixture?.release()).toBe(0)
    expect(adapt.codex()).toEqual({ status: 'signedOut', lastConnect: 'cancelled' })

    expect(adapt.connect()).toEqual({ status: 'refused', reason: 'browserUnavailable' })
    expect(adapt.codex()).toEqual({ status: 'signedOut', lastConnect: null })

    // Nothing left in the script: the sign-in fails rather than succeeding by default.
    expect(adapt.connect()).toEqual({ status: 'started' })
    vi.advanceTimersByTime(ADAPT_FIXTURE_STEP_MS)
    expect(adapt.codex()).toEqual({ status: 'signedOut', lastConnect: 'failed' })
    expect(send()).toEqual({ status: 'refused', reason: 'notConnected' })
  })

  it('answers an unproven sign-in cancel as unconfirmed for the page lifetime, never cancelled, and starts nothing after it', () => {
    const { host } = withScript({ connects: [{ result: 'connected', hold: true, cancel: 'unconfirmed' }, { result: 'connected' }] })
    const adapt = api(host)
    const visitId = visitOf(adapt)
    const conversationId = conversationIn(adapt, visitId)
    const unqualified = { status: 'unavailable', reason: 'unqualified', installedVersion: null }
    adapt.connect()
    expect(adapt.codex()).toEqual({ status: 'connecting' })
    const before = adapt.status().revision

    expect(adapt.cancelConnect()).toEqual({ status: 'unconfirmed' })
    expect(adapt.status().revision).toBeGreaterThan(before)
    expect(adapt.codex()).toEqual(unqualified)
    // Its admission is closed: the held sign-in can never complete, and nothing new starts or is sent.
    expect(window.__leadinglightAdaptFixture?.release()).toBe(0)
    expect(adapt.codex()).toEqual(unqualified)
    expect(adapt.connect()).toEqual({ status: 'refused', reason: 'unavailable' })
    expect(adapt.send({ visitId, conversationId, turnId: crypto.randomUUID(), provider: 'codex', request: 'Make a log', attachments: [], includeTurnIds: [], revision: null }))
      .toEqual({ status: 'refused', reason: 'providerUnavailable' })
    // Still unresolved: asking again is unconfirmed again, never "nothing to cancel".
    expect(adapt.cancelConnect()).toEqual({ status: 'unconfirmed' })
    expect(adapt.cancelConnect()).toEqual({ status: 'unconfirmed' })
    expect(adapt.codex()).toEqual(unqualified)
  })

  it('completes a held sign-in only when released', () => {
    const { host } = withScript({ connects: [{ result: 'connected', hold: true }] })
    const adapt = api(host)

    adapt.connect()
    vi.advanceTimersByTime(60_000)
    expect(adapt.codex()).toEqual({ status: 'connecting' })
    expect(window.__leadinglightAdaptFixture?.release()).toBe(1)
    expect(adapt.codex()).toEqual({ status: 'connected' })
  })

  it('rejects an unreadable disclosure version instead of starting anything', () => {
    const { host } = withScript({ connects: [{ result: 'connected' }] })

    expect(() => host.handle(ADAPT_COMMANDS.connect, { args: { provider: 'codex', disclosureVersion: 'I agree!' } })).toThrow(AdaptArgumentError)
    expect(api(host).codex()).toEqual({ status: 'signedOut', lastConnect: null })
  })
})

describe('turns', () => {
  it('reports only host-known phases, then a structured candidate, keeping attachment summaries only', () => {
    const run = opened({ turns: [{ reply: candidate() }] })
    const pasted: AdaptAttachment = { kind: 'pastedText', label: 'Pasted text', text: 'PASTED-ONLY-IN-ENVELOPE' }
    const args = run.sendArgs({ request: '  \nMake me a reading log\nwith one field', attachments: [pasted] })

    expect(run.adapt.send(args)).toEqual({ status: 'admitted', turnId: args.turnId })
    expect(run.conversation()).toMatchObject({ turn: { turnId: args.turnId, phase: 'sending' }, storage: 'saved' })
    vi.advanceTimersByTime(ADAPT_FIXTURE_STEP_MS)
    expect(run.conversation().turn?.phase).toBe('working')
    vi.advanceTimersByTime(ADAPT_FIXTURE_STEP_MS)
    expect(run.conversation().turn?.phase).toBe('checking')
    vi.advanceTimersByTime(ADAPT_FIXTURE_STEP_MS)

    const { entries, turn, storage } = run.conversation()
    expect([turn, storage]).toEqual([null, 'saved'])
    expect(entries[0]).toMatchObject({
      kind: 'request', turnId: args.turnId, provider: 'codex', text: args.request, includedTurnIds: [], revision: null, guide: ADAPT_FIXTURE_GUIDE,
      attachments: [{ kind: 'pastedText', label: 'Pasted text', bytes: pasted.text.length, sha256: sha(pasted.text) }],
    })
    expect(entries[1]).toMatchObject({ kind: 'reply', turnId: args.turnId, reply: candidate() })
    expect(run.storage.getItem(ADAPT_FIXTURE_STATE_KEY)).not.toContain('PASTED-ONLY-IN-ENVELOPE')
    expect(run.adapt.list(run.visitId)).toEqual({ status: 'ok', conversations: [
      expect.objectContaining({ conversationId: run.conversationId, title: 'Make me a reading log', turns: 1, running: false }),
    ] })
    // The candidate is untrusted text; here it happens to be a valid E1 package.
    const reply = entries[1].kind === 'reply' ? entries[1].reply : null
    expect(reply?.kind === 'candidate' && parseExtensionPackage(reply.packageText).status).toBe('valid')
  })

  it('answers a question or an unsupported request as plain replies', () => {
    const run = opened({ turns: [{ reply: question }, { reply: unsupported }] })

    run.adapt.send(run.sendArgs())
    settle()
    expect(run.last()).toMatchObject({ kind: 'reply', reply: question })
    run.adapt.send(run.sendArgs({ request: 'Email it to my team' }))
    settle()
    expect(run.last()).toMatchObject({ kind: 'reply', reply: unsupported })
  })

  /** A reply object the model might send that is not one the contract allows. */
  const loose = (reply: Record<string, unknown>) => reply as unknown as AdaptReply
  it.each<[string, AdaptFixtureTurn, 'invalidOutput' | 'outputTooLarge']>([
    ['text that is not JSON', { output: 'Sure! Here is your extension.' }, 'invalidOutput'],
    ['an envelope with an extra key', { output: JSON.stringify({ kind: 'question', message: 'Which?', choices: [], alternative: null, packageText: null, tool: 'shell' }) }, 'invalidOutput'],
    ['an answer over 256 KiB', { output: ' '.repeat(2 * ADAPT_LIMITS.packageBytes + 1) }, 'outputTooLarge'],
    ['a package over 128 KiB', { reply: candidate('x'.repeat(ADAPT_LIMITS.packageBytes + 1)) }, 'outputTooLarge'],
    ['a message over 600 characters', { reply: { ...question, message: 'a'.repeat(ADAPT_LIMITS.messageChars + 1) } }, 'outputTooLarge'],
    ['a message with a direction override', { reply: { ...question, message: 'Safe ‮ text' } }, 'invalidOutput'],
    ['four choices', { reply: { ...question, choices: ['a', 'b', 'c', 'd'] } }, 'invalidOutput'],
    ['a candidate with choices', { reply: loose({ ...candidate(), choices: ['a'] }) }, 'invalidOutput'],
    ['an unknown kind', { reply: loose({ kind: 'script', message: 'Run this.' }) }, 'invalidOutput'],
  ])('never shows %s: the turn fails %s and nothing is retried', (_, step, reason) => {
    const run = opened({ turns: [step] })

    run.adapt.send(run.sendArgs())
    settle()
    expect(run.last()).toMatchObject({ kind: 'failed', reason, resetsAt: null })
    vi.advanceTimersByTime(60_000)
    expect(run.conversation().entries).toHaveLength(2)
    expect(sentCount()).toBe(1)
  })

  it('reads a well-formed raw answer, and leaves package validity to E1', () => {
    const output = JSON.stringify({ kind: 'candidate', message: 'Here it is.', packageText: '{"not":"a package"}', choices: [], alternative: null })
    const run = opened({ turns: [{ output }] })

    run.adapt.send(run.sendArgs())
    settle()
    const last = run.last()
    expect(last).toMatchObject({ kind: 'reply', reply: { kind: 'candidate', packageText: '{"not":"a package"}' } })
    expect(last.kind === 'reply' && last.reply.kind === 'candidate' && parseExtensionPackage(last.reply.packageText).status).toBe('invalid')
  })

  it('cancels a delayed run at once and discards its late result', () => {
    const run = opened({ turns: [{ reply: candidate(), hold: true, slowStop: true }, { reply: question }] })
    const first = run.sendArgs()

    run.adapt.send(first)
    vi.advanceTimersByTime(60_000)
    expect(run.conversation().turn).toEqual({ turnId: first.turnId, phase: 'working' })
    expect(run.adapt.cancel(run.visitId, run.conversationId, first.turnId)).toEqual({ status: 'stopping' })
    expect(run.conversation().turn).toEqual({ turnId: first.turnId, phase: 'stopping' })
    expect(run.adapt.cancel(run.visitId, run.conversationId, first.turnId)).toEqual({ status: 'stopping' })
    expect(run.adapt.send(run.sendArgs())).toEqual({ status: 'refused', reason: 'busy' })
    expect(run.adapt.remove(run.visitId, run.conversationId)).toEqual({ status: 'refused', reason: 'running' })

    // The provider's late candidate arrives now; admission is closed, so it is never shown.
    expect(window.__leadinglightAdaptFixture?.release()).toBe(1)
    const { entries, turn } = run.conversation()
    expect(turn).toBeNull()
    expect(entries.map(entry => entry.kind)).toEqual(['request', 'stopped'])
    expect(entries[1]).toMatchObject({ reason: 'cancelled', confirmed: true })
    expect(run.adapt.cancel(run.visitId, run.conversationId, first.turnId)).toEqual({ status: 'finished' })

    // The next Send gets the next step: the discarded result was not shifted onto it.
    run.adapt.send(run.sendArgs())
    settle()
    expect(run.last()).toMatchObject({ kind: 'reply', reply: question })
  })

  it('stops at once without a slow stop, and refuses a Send whose turn was cancelled first', () => {
    const run = opened({ turns: [{ reply: candidate(), hold: true }, { reply: question }] })
    const held = run.sendArgs()

    run.adapt.send(held)
    expect(run.adapt.cancel(run.visitId, run.conversationId, held.turnId)).toEqual({ status: 'stopped' })
    expect(run.last()).toMatchObject({ kind: 'stopped', turnId: held.turnId, reason: 'cancelled', confirmed: true })
    expect(window.__leadinglightAdaptFixture?.release()).toBe(0)

    // Cancel can name a turn before its Send arrives; that Send is then refused and takes no step.
    const early = run.sendArgs()
    expect(run.adapt.cancel(run.visitId, run.conversationId, early.turnId)).toEqual({ status: 'stopped' })
    expect(run.adapt.send(early)).toEqual({ status: 'refused', reason: 'cancelled' })
    expect(run.adapt.send(held)).toEqual({ status: 'refused', reason: 'replayed' })
    run.adapt.send(run.sendArgs())
    settle()
    expect(run.last()).toMatchObject({ kind: 'reply', reply: question })
  })

  it('cancels only the named conversation, even when another runs the same turn id', () => {
    const run = opened({ turns: [{ reply: question, hold: true }, { reply: unsupported, hold: true }] })
    const other = conversationIn(run.adapt, run.visitId)
    const turnId = crypto.randomUUID()
    run.adapt.send(run.sendArgs({ turnId }))
    run.adapt.send(run.sendArgs({ turnId, conversationId: other }))
    vi.advanceTimersByTime(ADAPT_FIXTURE_STEP_MS)

    // Another open visit of the same vault may cancel; the other conversation keeps running.
    const second = visitOf(run.adapt)
    expect(run.adapt.cancel(second, run.conversationId, turnId)).toEqual({ status: 'stopped' })
    expect(run.last()).toMatchObject({ kind: 'stopped', reason: 'cancelled' })
    expect(snapshot(run.adapt, run.visitId, other).turn).toEqual({ turnId, phase: 'working' })
    // A visit of another vault reaches neither.
    expect(run.adapt.cancel(visitOf(run.adapt, '/tmp/another-synthetic-vault'), other, turnId)).toEqual({ status: 'unknownConversation' })
    window.__leadinglightAdaptFixture?.release()
    expect(snapshot(run.adapt, run.visitId, other).entries.at(-1)).toMatchObject({ kind: 'reply', reply: unsupported })
  })

  it('records provider failures and limits as given, one Send each, never retried', () => {
    const run = opened({ turns: [
      { failure: 'usageLimit', resetsAt: '2026-10-21T08:00:00Z' }, { failure: 'usageLimit' },
      { failure: 'providerFailed', resetsAt: '2026-10-21T08:00:00Z' }, { failure: 'timedOut' }, { failure: 'toolRefused' },
    ] })
    const outcomes: unknown[] = []

    for (let send = 0; send < 6; send++) {
      run.adapt.send(run.sendArgs())
      settle()
      const last = run.last()
      outcomes.push(last.kind === 'failed' && [last.reason, last.resetsAt])
    }
    expect(outcomes).toEqual([
      ['usageLimit', '2026-10-21T08:00:00Z'], ['usageLimit', null], ['providerFailed', null], ['timedOut', null], ['toolRefused', null],
      // Unscripted: a provider with nothing to answer.
      ['providerFailed', null],
    ])
    vi.advanceTimersByTime(60_000)
    expect(run.conversation().entries).toHaveLength(12)
    expect(sentCount()).toBe(6)
  })

  it('signs out when the provider says the account is not connected', () => {
    const run = opened({ turns: [{ failure: 'notConnected' }] })

    run.adapt.send(run.sendArgs())
    settle()
    expect(run.last()).toMatchObject({ kind: 'failed', reason: 'notConnected' })
    expect(run.adapt.codex()).toEqual({ status: 'signedOut', lastConnect: null })
    expect(run.adapt.send(run.sendArgs())).toEqual({ status: 'refused', reason: 'notConnected' })
  })
})

describe('what each Send gives the provider', () => {
  it('is a fresh envelope: this Send’s attachments and only the visible text of the turns it names', () => {
    const run = opened({ turns: [{ reply: candidate() }, { reply: question }, { reply: unsupported }] })
    const first = run.sendArgs({ attachments: [
      { kind: 'pastedText', label: 'Pasted text', text: 'SECRET-PASTE' }, { kind: 'pageSnapshot', label: 'Reading list', text: 'PAGE-SNAPSHOT' },
    ] })
    run.adapt.send(first)
    settle()
    const second = run.sendArgs({ request: 'Add a rating field', includeTurnIds: [first.turnId] })
    run.adapt.send(second)
    settle()
    run.adapt.send(run.sendArgs({ request: 'Start over' }))
    settle()

    const sent = window.__leadinglightAdaptFixture?.sent() ?? []
    expect(sent).toHaveLength(3)
    expect(sent[0]).toEqual({
      turnId: first.turnId, provider: 'codex', request: first.request, attachments: first.attachments, earlierTurns: [],
      changePackage: null, guide: ADAPT_FIXTURE_GUIDE,
    })
    expect(sent[1].attachments).toEqual([])
    expect(sent[1].earlierTurns).toEqual([{ turnId: first.turnId, request: first.request, reply: candidate() }])
    // A removed attachment is not carried along in any hidden thread state.
    expect(JSON.stringify(sent.slice(1))).not.toMatch(/SECRET-PASTE|PAGE-SNAPSHOT/)
    expect(sent[2].earlierTurns).toEqual([])
    expect(run.conversation().entries.find(entry => entry.turnId === second.turnId)).toMatchObject({ kind: 'request', includedTurnIds: [first.turnId] })
  })

  it('names only finished turns of this conversation, counted within the payload bound', () => {
    const run = opened({ turns: [{ reply: candidate(), hold: true }, { reply: question }] })
    const running = run.sendArgs()
    run.adapt.send(running)

    expect(run.adapt.send(run.sendArgs({ includeTurnIds: [running.turnId] }))).toEqual({ status: 'refused', reason: 'busy' })
    window.__leadinglightAdaptFixture?.release()
    expect(run.adapt.send(run.sendArgs({ includeTurnIds: [crypto.randomUUID()] }))).toEqual({ status: 'refused', reason: 'invalidRequest' })
    // Within the bound alone, but not with the named turn's text added.
    const full = Array.from({ length: 4 }, (_, index): AdaptAttachment => ({ kind: 'pastedText', label: `Part ${index + 1}`, text: 'x'.repeat(ADAPT_LIMITS.attachmentBytes) }))
    const fullRequest = { request: 'x', attachments: [...full.slice(0, 3), { ...full[3], text: 'x'.repeat(ADAPT_LIMITS.attachmentBytes - 1) }] }
    expect(run.adapt.send(run.sendArgs({ ...fullRequest, includeTurnIds: [running.turnId] }))).toEqual({ status: 'refused', reason: 'tooLarge' })
    expect(sentCount()).toBe(1)
    expect(run.adapt.send(run.sendArgs(fullRequest))).toMatchObject({ status: 'admitted' })
  })

})

describe('a revision', () => {
  const base = helper.adaptSamplePackage(PACKAGE_ID)
  /** The version active when the person attached the extension: local compare-and-set data only. */
  const ACTIVE = sha('the version active at attach time')
  const attached: AdaptAttachment[] = [{ kind: 'extension', label: 'Reading log', text: base }]

  it('keeps its original expected active version through storage and reload, and sends the provider only package and base', () => {
    const storage = memoryStorage()
    const run = opened({ turns: [{ reply: candidate(helper.adaptSamplePackage(PACKAGE_ID, '1.1.0', 'heading')) }] }, storage)
    const revision = { packageId: PACKAGE_ID, baseSha256: sha(base), expectedActiveSha256: ACTIVE }
    run.adapt.send(run.sendArgs({ request: 'Use a heading instead of a quote', revision, attachments: attached }))
    settle()

    const [request, reply] = run.conversation().entries
    expect(request).toMatchObject({ kind: 'request', revision, attachments: [{ kind: 'extension', sha256: sha(base) }] })
    const sent = window.__leadinglightAdaptFixture?.sent() ?? []
    expect(sent[0].changePackage).toEqual({ packageId: PACKAGE_ID, baseSha256: sha(base) })
    expect(JSON.stringify(sent)).not.toMatch(new RegExp(`${ACTIVE}|expectedActiveSha256`))
    const packageText = reply.kind === 'reply' && reply.reply.kind === 'candidate' ? reply.reply.packageText : ''
    const parsed = parseExtensionPackage(packageText)
    expect(parsed.status === 'valid' && [parsed.extension.id, parsed.extension.version]).toEqual([PACKAGE_ID, '1.1.0'])

    // The stored copy is what a reload returns: the value observed at attach time, never rebuilt.
    const reloaded = api(browserAdaptHost(true, storage))
    expect(snapshot(reloaded, visitOf(reloaded), run.conversationId).entries[0]).toMatchObject({ kind: 'request', revision })
  })

  it('accepts an explicit null when nothing was active, and keeps it null', () => {
    const run = opened({ turns: [{ reply: candidate() }] })
    const revision = { packageId: PACKAGE_ID, baseSha256: sha(base), expectedActiveSha256: null }

    expect(run.adapt.send(run.sendArgs({ revision, attachments: attached }))).toMatchObject({ status: 'admitted' })
    expect(run.conversation().entries[0]).toMatchObject({ kind: 'request', revision })
    expect(window.__leadinglightAdaptFixture?.sent()[0].changePackage).toEqual({ packageId: PACKAGE_ID, baseSha256: sha(base) })
  })

  it('never admits a revision whose expected active version is missing, extra, mistyped or malformed', () => {
    const run = opened({ turns: [{ reply: question }] })
    const send = run.sendArgs({ attachments: attached })
    const rejects = (revision: unknown) =>
      expect(() => run.host.handle(ADAPT_COMMANDS.send, { args: { ...send, revision } })).toThrow(AdaptArgumentError)

    // A shape native cannot deserialize: the call is rejected, as native answers `Err`.
    rejects({ packageId: PACKAGE_ID, baseSha256: sha(base) })
    rejects({ packageId: PACKAGE_ID, baseSha256: sha(base), expectedActiveSha256: ACTIVE, observedAt: '2026-10-20T00:00:00Z' })
    rejects({ packageId: PACKAGE_ID, baseSha256: sha(base), expectedActiveSha256: 7 })
    // Well-typed but not a lowercase SHA-256: refused by the contract's check, as native's.
    for (const expectedActiveSha256 of [ACTIVE.toUpperCase(), ACTIVE.slice(1), '']) {
      expect(run.adapt.send({ ...send, revision: { packageId: PACKAGE_ID, baseSha256: sha(base), expectedActiveSha256 } }))
        .toEqual({ status: 'refused', reason: 'invalidRequest' })
    }
    expect(run.conversation().entries).toEqual([])
    expect(sentCount()).toBe(0)
    // Nothing was consumed: a valid revision takes the first step.
    run.adapt.send({ ...send, revision: { packageId: PACKAGE_ID, baseSha256: sha(base), expectedActiveSha256: ACTIVE } })
    settle()
    expect(run.last()).toMatchObject({ kind: 'reply', reply: question })
  })

  it('treats a stored revision without the field as unreadable state, never guessing it', () => {
    const storage = memoryStorage()
    const run = opened({ turns: [{ reply: candidate() }] }, storage)
    run.adapt.send(run.sendArgs({ revision: { packageId: PACKAGE_ID, baseSha256: sha(base), expectedActiveSha256: ACTIVE }, attachments: attached }))
    settle()
    const state = JSON.parse(storage.getItem(ADAPT_FIXTURE_STATE_KEY) as string)
    delete state.conversations[0].entries[0].revision.expectedActiveSha256
    storage.setItem(ADAPT_FIXTURE_STATE_KEY, JSON.stringify(state))

    const reloaded = api(browserAdaptHost(true, storage))
    expect(reloaded.read(visitOf(reloaded), run.conversationId)).toEqual({ status: 'unknownConversation' })
  })
})

describe('local saving', () => {
  it('keeps a generated result whose save failed through close and reopen, then saves it locally without asking the provider', () => {
    const storage = memoryStorage()
    const run = opened({ turns: [{ reply: candidate(), outcomeSave: 'unsaved' }] }, storage)
    run.adapt.send(run.sendArgs())
    settle()

    const unsaved = run.conversation()
    expect(unsaved.storage).toBe('unsaved')
    expect(unsaved.entries.at(-1)).toMatchObject({ kind: 'reply', reply: candidate() })
    // An ordinary close and reopen keeps it, still plainly unsaved.
    expect(run.adapt.close(run.visitId)).toEqual({ status: 'closed' })
    const visitId = visitOf(run.adapt)
    expect(snapshot(run.adapt, visitId, run.conversationId)).toMatchObject({ storage: 'unsaved', entries: unsaved.entries })

    expect(run.adapt.save(visitId, run.conversationId)).toEqual({ status: 'saved' })
    const saved = snapshot(run.adapt, visitId, run.conversationId)
    expect(saved).toMatchObject({ storage: 'saved', entries: unsaved.entries })
    expect(saved.revision).toBeGreaterThan(unsaved.revision)
    expect(sentCount()).toBe(1)
    // Saved is what a reload finds.
    const reloaded = api(browserAdaptHost(true, storage))
    expect(snapshot(reloaded, visitOf(reloaded), run.conversationId)).toMatchObject({ storage: 'saved', entries: unsaved.entries })
  })

  it('reports an unsynced outcome as unconfirmed until the conversation is written again', () => {
    const run = opened({ turns: [{ reply: question, outcomeSave: 'unconfirmed' }, { reply: unsupported }] })
    run.adapt.send(run.sendArgs())
    settle()
    expect(run.conversation().storage).toBe('unconfirmed')

    // The next Send writes the whole conversation, the earlier outcome with it.
    run.adapt.send(run.sendArgs())
    expect(run.conversation().storage).toBe('saved')
  })

  it('keeps an outcome in memory when sessionStorage refuses it, and saves only once it can', () => {
    const run = opened({ turns: [{ reply: candidate(), hold: true }] })
    run.adapt.send(run.sendArgs())
    run.storage.full = true
    window.__leadinglightAdaptFixture?.release()

    expect(run.conversation()).toMatchObject({ storage: 'unsaved', entries: [{ kind: 'request' }, { kind: 'reply', reply: candidate() }] })
    expect(run.adapt.save(run.visitId, run.conversationId)).toEqual({ status: 'unsaved' })
    run.storage.full = false
    expect(run.adapt.save(run.visitId, run.conversationId)).toEqual({ status: 'saved' })
    expect(sentCount()).toBe(1)
  })
})

describe('conversations and visits', () => {
  it('keeps conversations per vault, newest first, and forgets one only when asked', () => {
    const run = opened({ turns: [{ reply: question }] })
    vi.advanceTimersByTime(1000)
    const second = conversationIn(run.adapt, run.visitId)
    vi.advanceTimersByTime(1000)
    run.adapt.send(run.sendArgs())
    settle()

    const listed = run.adapt.list(run.visitId)
    expect(listed.status === 'ok' && listed.conversations.map(item => item.conversationId)).toEqual([run.conversationId, second])
    const elsewhere = visitOf(run.adapt, '/tmp/another-synthetic-vault')
    expect(run.adapt.list(elsewhere)).toEqual({ status: 'ok', conversations: [] })
    expect(run.adapt.read(elsewhere, run.conversationId)).toEqual({ status: 'unknownConversation' })

    const { revision } = run.conversation()
    expect(run.adapt.read(run.visitId, run.conversationId, revision)).toEqual({ status: 'unchanged', revision })
    expect(run.adapt.remove(run.visitId, second)).toEqual({ status: 'deleted' })
    expect(run.adapt.read(run.visitId, second)).toEqual({ status: 'unknownConversation' })
    expect(run.adapt.remove(run.visitId, second)).toEqual({ status: 'unknownConversation' })
  })

  it('refuses a new conversation at the limit unless an empty, never-sent one can make room', () => {
    const run = opened()
    const ids = [run.conversationId]
    while (ids.length < ADAPT_LIMITS.conversationsPerVault) ids.push(conversationIn(run.adapt, run.visitId))
    for (const conversationId of ids.slice(0, -1)) run.adapt.send(run.sendArgs({ conversationId }))

    // The one empty conversation is reclaimed for the new one.
    const replacement = conversationIn(run.adapt, run.visitId)
    expect(run.adapt.read(run.visitId, ids.at(-1) as string)).toEqual({ status: 'unknownConversation' })
    run.adapt.send(run.sendArgs({ conversationId: replacement }))
    expect(run.adapt.create(run.visitId)).toEqual({ status: 'refused', reason: 'conversationLimit' })
    const listed = run.adapt.list(run.visitId)
    expect(listed.status === 'ok' && listed.conversations).toHaveLength(ADAPT_LIMITS.conversationsPerVault)
  })

  it('closes a visit at once when its turn ends at once', () => {
    const run = opened({ turns: [{ reply: candidate(), hold: true }] })
    run.adapt.send(run.sendArgs())

    expect(run.adapt.close(run.visitId)).toEqual({ status: 'closed' })
    expect(run.adapt.close(run.visitId)).toEqual({ status: 'unknown' })
    expect(window.__leadinglightAdaptFixture?.release()).toBe(0)
    expect(snapshot(run.adapt, visitOf(run.adapt), run.conversationId).entries.at(-1))
      .toMatchObject({ kind: 'stopped', reason: 'visitClosed', confirmed: true })
  })

  it('answers stopping while a closing visit’s work is unproven, and nothing but close until it is', () => {
    const run = opened({ turns: [{ reply: candidate(), hold: true, slowStop: true }] })
    const args = run.sendArgs()
    run.adapt.send(args)

    expect(run.adapt.close(run.visitId)).toEqual({ status: 'stopping' })
    expect(run.adapt.close(run.visitId)).toEqual({ status: 'stopping' })
    expect(run.adapt.read(run.visitId, run.conversationId)).toEqual({ status: 'unknownVisit' })
    expect(run.adapt.list(run.visitId)).toEqual({ status: 'unknownVisit' })
    expect(run.adapt.save(run.visitId, run.conversationId)).toEqual({ status: 'unknownVisit' })
    expect(run.adapt.send(run.sendArgs())).toEqual({ status: 'refused', reason: 'unknownVisit' })
    expect(run.adapt.cancel(run.visitId, run.conversationId, args.turnId)).toEqual({ status: 'unknownVisit' })
    const other = visitOf(run.adapt)
    expect(snapshot(run.adapt, other, run.conversationId).turn).toEqual({ turnId: args.turnId, phase: 'stopping' })

    // The late candidate arrives and is discarded; the same close is then proven, then forgotten.
    window.__leadinglightAdaptFixture?.release()
    expect(run.adapt.close(run.visitId)).toEqual({ status: 'closed' })
    expect(run.adapt.close(run.visitId)).toEqual({ status: 'unknown' })
    expect(snapshot(run.adapt, other, run.conversationId).entries.map(entry => entry.kind)).toEqual(['request', 'stopped'])
  })

  it('closes the oldest visit when a page opens a ninth', () => {
    const adapt = api(withScript({}).host)
    const visits = Array.from({ length: 9 }, () => visitOf(adapt))

    expect(adapt.list(visits[0])).toEqual({ status: 'unknownVisit' })
    expect(adapt.list(visits[1])).toEqual({ status: 'ok', conversations: [] })
  })

  it('closes admission before stopping turns on disconnect, and answers stopping until they end', () => {
    const run = opened({ turns: [{ reply: candidate(), hold: true, slowStop: true }] })
    const other = conversationIn(run.adapt, run.visitId)
    run.adapt.send(run.sendArgs())

    expect(run.adapt.disconnect()).toEqual({ status: 'stopping' })
    expect(run.conversation().turn?.phase).toBe('stopping')
    expect(run.adapt.codex()).toEqual({ status: 'signedOut', lastConnect: null })
    // No Send is admitted for the provider while its old work is still ending.
    expect(run.adapt.send(run.sendArgs({ conversationId: other }))).toEqual({ status: 'refused', reason: 'notConnected' })
    expect(run.adapt.disconnect()).toEqual({ status: 'stopping' })

    window.__leadinglightAdaptFixture?.release()
    expect(run.adapt.disconnect()).toEqual({ status: 'disconnected' })
    expect(run.conversation().entries.map(entry => entry.kind)).toEqual(['request', 'stopped'])
    expect(run.last()).toMatchObject({ reason: 'accountChanged', confirmed: true })
    expect(sentCount()).toBe(1)
  })
})

describe('a reload', () => {
  it('keeps history, account and script position, and ends what the page was running', () => {
    const storage = memoryStorage()
    const run = opened({ turns: [{ reply: candidate() }, { reply: question, hold: true }, { reply: unsupported }] }, storage)
    run.adapt.send(run.sendArgs())
    settle()
    run.adapt.send(run.sendArgs())
    vi.advanceTimersByTime(ADAPT_FIXTURE_STEP_MS)
    const before = run.conversation().revision

    const adapt = api(browserAdaptHost(true, storage))
    expect(adapt.list(run.visitId)).toEqual({ status: 'unknownVisit' })
    const visitId = visitOf(adapt)
    const read = snapshot(adapt, visitId, run.conversationId)
    expect(read.entries.map(entry => entry.kind)).toEqual(['request', 'reply', 'request', 'stopped'])
    expect(read.entries[3]).toMatchObject({ reason: 'visitClosed', confirmed: true })
    expect(read.storage).toBe('saved')
    expect(read.revision).toBeGreaterThan(before)
    expect(adapt.codex()).toEqual({ status: 'connected' })

    adapt.send({ ...run.sendArgs(), visitId })
    settle()
    expect(snapshot(adapt, visitId, run.conversationId).entries.at(-1)).toMatchObject({ kind: 'reply', reply: unsupported })
    expect(sentCount()).toBe(1)
  })

  it('ends a sign-in still in progress as failed', () => {
    const storage = memoryStorage()
    api(withScript({ connects: [{ result: 'connected', hold: true }] }, storage).host).connect()

    expect(api(browserAdaptHost(true, storage)).codex()).toEqual({ status: 'signedOut', lastConnect: 'failed' })
  })

  it('starts fresh for another script or for state it cannot read', () => {
    const storage = memoryStorage()
    const run = opened({}, storage)
    storage.setItem(ADAPT_FIXTURE_KEY, JSON.stringify({ fixture: ADAPT_FIXTURE_FORMAT, account: 'connected', turns: [{ reply: question }] }))
    const another = api(browserAdaptHost(true, storage))
    expect(another.list(visitOf(another))).toEqual({ status: 'ok', conversations: [] })

    // The right script, but a conversation that is no transcript.
    const script = sha(storage.getItem(ADAPT_FIXTURE_KEY) as string)
    storage.setItem(ADAPT_FIXTURE_STATE_KEY, JSON.stringify({
      format: 1, script, revision: 9, statusRevision: 1, epoch: 0, account: { status: 'connected' }, nextConnect: 0, nextTurn: 0,
      conversations: [{ conversationId: run.conversationId, entries: 'no' }],
    }))
    const unreadable = api(browserAdaptHost(true, storage))
    expect(unreadable.read(visitOf(unreadable), run.conversationId)).toEqual({ status: 'unknownConversation' })
  })
})

describe('when fixture state cannot be kept', () => {
  it('refuses with storageUnavailable and changes nothing, never a fake success', () => {
    const run = opened({ turns: [{ reply: question }] })
    const keep = run.sendArgs()
    run.storage.full = true

    expect(run.adapt.open()).toEqual({ status: 'refused', reason: 'storageUnavailable' })
    expect(run.adapt.create(run.visitId)).toEqual({ status: 'refused', reason: 'storageUnavailable' })
    expect(run.adapt.send(keep)).toEqual({ status: 'refused', reason: 'storageUnavailable' })
    expect(run.adapt.remove(run.visitId, run.conversationId)).toEqual({ status: 'refused', reason: 'storageUnavailable' })
    expect(run.conversation()).toMatchObject({ entries: [], storage: 'saved' })
    expect(sentCount()).toBe(0)

    run.storage.full = false
    expect(run.adapt.send(keep)).toEqual({ status: 'admitted', turnId: keep.turnId })
    settle()
    expect(run.last()).toMatchObject({ kind: 'reply', reply: question })
  })
})

describe('arguments', () => {
  it('rejects arguments that are not exactly the typed ones, as native deserialization does', () => {
    const run = opened()
    const send = run.sendArgs()
    const rejects = (command: string, payload: unknown) => expect(() => run.host.handle(command, payload)).toThrow(AdaptArgumentError)

    rejects(ADAPT_COMMANDS.status, {})
    rejects(ADAPT_COMMANDS.status, { args: { verbose: true } })
    rejects(ADAPT_COMMANDS.openVisit, { args: { vaultPath: VAULT, provider: 'codex' } })
    rejects(ADAPT_COMMANDS.readConversation, { args: { visitId: run.visitId, conversationId: run.conversationId } })
    rejects(ADAPT_COMMANDS.saveConversation, { args: { visitId: run.visitId, conversationId: run.conversationId, provider: 'codex' } })
    rejects(ADAPT_COMMANDS.send, { args: { ...send, model: 'gpt' } })
    rejects(ADAPT_COMMANDS.send, { args: { ...send, attachments: [{ kind: 'file', label: 'notes.md', text: 'x' }] } })
    rejects(ADAPT_COMMANDS.send, { args: { ...send, provider: 'openai' } })
    rejects('adapt_forward_request', { args: {} })
    // Well-typed but breaking a rule: a refusal, as native's checks answer.
    expect(run.adapt.send({ ...send, request: '   ' })).toEqual({ status: 'refused', reason: 'invalidRequest' })
    expect(run.adapt.send({ ...send, turnId: send.turnId.toUpperCase() })).toEqual({ status: 'refused', reason: 'invalidRequest' })
    expect(run.adapt.send({ ...send, request: 'x'.repeat(ADAPT_LIMITS.requestBytes + 1) })).toEqual({ status: 'refused', reason: 'tooLarge' })
  })
})

describe('the test helper', () => {
  it('repeats the fixture names and gives valid E1 packages and a script the host reads', () => {
    expect([helper.ADAPT_FIXTURE_KEY, helper.ADAPT_FIXTURE_FORMAT]).toEqual([ADAPT_FIXTURE_KEY, ADAPT_FIXTURE_FORMAT])
    for (const text of [helper.adaptSamplePackage(PACKAGE_ID), helper.adaptSamplePackage(PACKAGE_ID, '1.1.0', 'heading')]) {
      const parsed = parseExtensionPackage(text)
      expect(parsed.status === 'valid' && parsed.extension.id).toBe(PACKAGE_ID)
    }
    const script: helper.AdaptFixtureScript = {
      fixture: helper.ADAPT_FIXTURE_FORMAT, account: 'signedOut', connects: [{ result: 'connected', hold: true }],
      turns: [{ reply: candidate(), outcomeSave: 'unsaved' }, { output: '{}', slowStop: true }, { failure: 'usageLimit', resetsAt: null, hold: true }],
    }
    expect(readAdaptFixtureScript(JSON.stringify(script))).toEqual({
      ...script, connects: [{ result: 'connected', hold: true }],
      turns: [
        { reply: candidate(), hold: false, slowStop: false, outcomeSave: 'unsaved' }, { output: '{}', hold: false, slowStop: true },
        { failure: 'usageLimit', resetsAt: null, hold: true, slowStop: false },
      ],
    })
  })
})
