import { describe, expect, it, vi } from 'vitest'
import {
  PROPOSAL_LIMITS, parseProposalQueryReply, parseProposalReceipt, type AppendProposal, type CreateProposal,
} from '../proposals/proposalContract'
import {
  openExtensionSession, parseCloseSessionReply, parseEndRunReply, parseOpenSessionReply, parseRunAdmission,
  type BeginRunArgs, type CloseSessionReply, type EndRunReply, type ExtensionApi, type OpenSessionReply, type RunAdmission,
} from './extensionApi'

const sha = (digit: string) => digit.repeat(64)
const operationId = '6f1c2c1e-6d1f-4a59-9a43-2f6f0c8e7b10'
const create: CreateProposal = {
  kind: 'create', operationId, runId: 'run-1', folderHandle: 'folder-1', fileName: 'Debrief.md', content: '# Debrief\n', contentSha256: sha('a'),
}
/** The whole reviewed postimage: metadata and body changed together by trusted preparation. */
const append: AppendProposal = {
  kind: 'append', operationId, runId: 'run-1', documentHandle: 'document-1', expectedSha256: sha('b'),
  content: '---\n_leadinglight_commentary: {}\n---\n# Commentary\n\n> Second passage\n', contentSha256: sha('c'),
}
const created = { status: 'committed', kind: 'create', operationId, path: '/vault/Debrief.md', beforeSha256: null, afterSha256: sha('a'), durable: true, undoReceipt: null }
const appended = { status: 'committed', kind: 'append', operationId, path: '/vault/Commentary.md', beforeSha256: sha('b'), afterSha256: sha('c'), durable: true, undoReceipt: 'undo-1' }

describe('guarded proposal replies', () => {
  it('accepts a creation only for this operation, its own digests and bounded fields', () => {
    expect(parseProposalReceipt(created, create)).toEqual(created)
    expect(parseProposalReceipt({ ...created, undoReceipt: 'undo-7' }, create)).toEqual({ ...created, undoReceipt: 'undo-7' })
    for (const wrong of [
      { operationId: 'another' }, { afterSha256: sha('e') }, { beforeSha256: sha('b') }, { durable: 'yes' }, { kind: 'append' },
      { path: '' }, { path: `/${'p'.repeat(PROPOSAL_LIMITS.pathChars)}` }, { undoReceipt: 'not a token' }, { extra: true },
    ]) expect({ wrong, parsed: parseProposalReceipt({ ...created, ...wrong }, create) }).toEqual({ wrong, parsed: null })
  })

  it('reports an append as written only with the whole postimage digest and a bounded undo token', () => {
    expect(parseProposalReceipt(appended, append)).toEqual(appended)
    for (const wrong of [
      { undoReceipt: null }, { undoReceipt: '' }, { undoReceipt: 'u'.repeat(PROPOSAL_LIMITS.tokenChars + 1) }, { undoReceipt: 'undo 1' },
      { beforeSha256: sha('a') }, { afterSha256: sha('d') }, { kind: 'create' },
    ]) expect({ wrong, parsed: parseProposalReceipt({ ...appended, ...wrong }, append) }).toEqual({ wrong, parsed: null })
  })

  it('reads known no-write answers and never reads another shape as an answer', () => {
    expect(parseProposalReceipt({ status: 'conflict', operationId, reason: 'exists' }, create)).toEqual({ status: 'conflict', operationId, reason: 'exists' })
    expect(parseProposalReceipt({ status: 'refused', operationId, reason: 'storageUnavailable' }, create))
      .toEqual({ status: 'refused', operationId, reason: 'storageUnavailable' })
    expect(parseProposalReceipt({ status: 'refused', operationId, reason: 'because' }, create)).toBeNull()
    expect(parseProposalReceipt({ status: 'uncertain', operationId }, create)).toEqual({ status: 'uncertain', operationId })
    expect(parseProposalReceipt({ status: 'running', operationId }, create)).toBeNull()
    expect(parseProposalReceipt({ status: 'unknown', operationId }, create)).toBeNull()
    expect(parseProposalReceipt(JSON.parse('{"__proto__": {"status": "committed"}}'), create)).toBeNull()
  })

  it('answers a query with running, unknown or the finished receipt, for this operation only', () => {
    expect(parseProposalQueryReply({ status: 'running', operationId }, create)).toEqual({ status: 'running', operationId })
    expect(parseProposalQueryReply({ status: 'unknown', operationId }, create)).toEqual({ status: 'unknown', operationId })
    expect(parseProposalQueryReply(created, create)).toEqual(created)
    expect(parseProposalQueryReply({ status: 'running', operationId: 'another' }, create)).toBeNull()
    expect(parseProposalQueryReply({ status: 'running', operationId, progress: 1 }, create)).toBeNull()
  })
})

// --- Sessions ----------------------------------------------------------------------------------

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const flush = () => new Promise<void>(done => { setTimeout(done, 0) })

/** Native replies arrive only when a test releases them, in the order it chooses. */
function fakeNative() {
  const opens: ReturnType<typeof deferred<OpenSessionReply | null>>[] = []
  const begins: { args: BeginRunArgs; reply: ReturnType<typeof deferred<RunAdmission | null>> }[] = []
  const api = {
    openSession: vi.fn<ExtensionApi['openSession']>(() => {
      const reply = deferred<OpenSessionReply | null>()
      opens.push(reply)
      return reply.promise
    }),
    closeSession: vi.fn<ExtensionApi['closeSession']>(async () => ({ status: 'closed' })),
    beginRun: vi.fn<ExtensionApi['beginRun']>(args => {
      const reply = deferred<RunAdmission | null>()
      begins.push({ args, reply })
      return reply.promise
    }),
    endRun: vi.fn<ExtensionApi['endRun']>(async () => ({ status: 'ended' })),
  }
  return { api, opens, begins }
}
const request = { packageSha256: sha('f'), commandId: 'new-debrief', invocationId: 'invocation-1' }
const admitted = (args: BeginRunArgs, runId = 'run-1'): RunAdmission => ({
  status: 'admitted',
  scope: { runId, sessionId: args.sessionId, invocationId: args.invocationId, packageId: 'local.meeting-debrief', packageSha256: args.packageSha256, commandId: args.commandId },
})
const sessionClosed = { status: 'refused', reason: 'sessionClosed' }
const cancelled = { status: 'refused', reason: 'cancelled' }
const confirmed = { status: 'confirmed' }
const unconfirmed = { status: 'unconfirmed' }
/** A reply of a shape native must never send. */
const malformed = <T>(value: unknown) => value as T
const closeFailures: (() => Promise<CloseSessionReply | null>)[] = [
  async () => null,
  async () => { throw new Error('no reply') },
  async () => malformed<CloseSessionReply>({ status: 'closing' }),
  async () => malformed<CloseSessionReply>({ status: 'closed', joined: 2 }),
]
const endFailures: (() => Promise<EndRunReply | null>)[] = [
  async () => null,
  async () => { throw new Error('no reply') },
  async () => malformed<EndRunReply>({ status: 'gone' }),
  async () => malformed<EndRunReply>({ status: 'ended', at: 1 }),
]
function openedSession(sessionId = 'session-a1') {
  const native = fakeNative()
  const session = openExtensionSession(native.api, '/vault/a')
  native.opens[0].resolve({ status: 'open', sessionId })
  return { native, session }
}

describe('extension sessions', () => {
  it('admits nothing before its own open reply, then admits with that session', async () => {
    const native = fakeNative()
    const session = openExtensionSession(native.api, '/vault/a')
    const pending = session.admit(request)
    await flush()
    expect(native.api.beginRun).not.toHaveBeenCalled()
    native.opens[0].resolve({ status: 'open', sessionId: 'session-a1' })
    await flush()
    expect(native.begins[0].args).toEqual({ sessionId: 'session-a1', ...request })
    native.begins[0].reply.resolve(admitted(native.begins[0].args))
    expect(await pending).toEqual(admitted(native.begins[0].args))
    expect(session.liveness(request.invocationId)).toBe('live')
  })

  it('closes a late open reply as it arrives and never admits through it', async () => {
    const native = fakeNative()
    const session = openExtensionSession(native.api, '/vault/a')
    const pending = session.admit(request)
    const closing = session.close()
    expect(session.liveness(request.invocationId)).toBe('revoked')
    native.opens[0].resolve({ status: 'open', sessionId: 'session-late' })
    expect(await closing).toEqual(confirmed)
    expect(native.api.closeSession).toHaveBeenCalledWith({ sessionId: 'session-late' })
    expect(await pending).toEqual(sessionClosed)
    expect(await session.admit({ ...request, invocationId: 'invocation-2' })).toEqual(sessionClosed)
    expect(await session.close()).toEqual(confirmed)
    expect(native.api.closeSession).toHaveBeenCalledTimes(1)
    expect(native.api.beginRun).not.toHaveBeenCalled()
  })

  it('never lets a delayed admission from an earlier visit to the same vault join a later visit', async () => {
    const native = fakeNative()
    const firstVisit = openExtensionSession(native.api, '/vault/a')
    native.opens[0].resolve({ status: 'open', sessionId: 'session-a1' })
    const delayed = firstVisit.admit(request)
    await flush()
    expect(await firstVisit.close()).toEqual(confirmed)
    const visitB = openExtensionSession(native.api, '/vault/b')
    native.opens[1].resolve({ status: 'open', sessionId: 'session-b1' })
    expect(await visitB.close()).toEqual(confirmed)
    const returnVisit = openExtensionSession(native.api, '/vault/a')
    native.opens[2].resolve({ status: 'open', sessionId: 'session-a2' })

    native.begins[0].reply.resolve(admitted(native.begins[0].args))
    expect(await delayed).toEqual(sessionClosed)
    expect(firstVisit.liveness(request.invocationId)).toBe('revoked')
    expect(native.api.closeSession.mock.calls.map(([args]) => args.sessionId)).toEqual(['session-a1', 'session-b1'])

    void returnVisit.admit({ ...request, invocationId: 'invocation-2' })
    await flush()
    expect(native.begins[1].args.sessionId).toBe('session-a2')
    expect(native.api.openSession).toHaveBeenCalledTimes(3)
  })

  it('ends a run by its request-time key before the admission reply is known', async () => {
    const native = fakeNative()
    const session = openExtensionSession(native.api, '/vault/a')
    native.opens[0].resolve({ status: 'open', sessionId: 'session-a1' })
    const pending = session.admit(request)
    await flush()
    expect(await session.end(request.invocationId)).toEqual(confirmed)
    expect(native.api.endRun).toHaveBeenCalledWith({ sessionId: 'session-a1', invocationId: 'invocation-1' })
    expect(session.liveness(request.invocationId)).toBe('cancelled')
    native.begins[0].reply.resolve(admitted(native.begins[0].args))
    expect(await pending).toEqual(cancelled)
    expect(await session.admit(request)).toEqual(cancelled)
  })

  it('treats a lost, failed or foreign admission reply as no run and says whether its key was ended', async () => {
    const { native, session } = openedSession()
    const replies: (() => Promise<RunAdmission | null>)[] = [
      async () => null,
      async () => { throw new Error('no reply') },
      async () => admitted({ sessionId: 'session-a0', ...request, invocationId: 'invocation-3' }),
      async () => admitted({ sessionId: 'session-a1', ...request, invocationId: 'invocation-4', commandId: 'other' }),
    ]
    for (const [index, reply] of replies.entries()) {
      const invocationId = `invocation-${index + 1}`
      native.api.beginRun.mockImplementationOnce(reply)
      expect(await session.admit({ ...request, invocationId })).toEqual({ status: 'unanswered', end: confirmed })
      expect(native.api.endRun).toHaveBeenLastCalledWith({ sessionId: 'session-a1', invocationId })
      expect(session.liveness(invocationId)).toBe('cancelled')
    }
    native.api.beginRun.mockImplementationOnce(async () => null)
    native.api.endRun.mockImplementationOnce(async () => null)
    expect(await session.admit({ ...request, invocationId: 'invocation-5' })).toEqual({ status: 'unanswered', end: unconfirmed })
    expect(await session.end('invocation-5')).toEqual(confirmed)
  })

  it('holds the close barrier until native answers, sharing one attempt, and admits nothing meanwhile', async () => {
    const { native, session } = openedSession()
    const nativeClose = deferred<CloseSessionReply | null>()
    native.api.closeSession.mockImplementationOnce(() => nativeClose.promise)
    const results: unknown[] = []
    void session.close().then(result => { results.push(result) })
    void session.close().then(result => { results.push(result) })
    await flush()
    expect(results).toEqual([])
    expect(native.api.closeSession).toHaveBeenCalledTimes(1)
    expect(session.liveness(request.invocationId)).toBe('revoked')
    expect(await session.admit(request)).toEqual(sessionClosed)
    nativeClose.resolve({ status: 'closed' })
    await flush()
    expect(results).toEqual([confirmed, confirmed])
    expect(native.api.beginRun).not.toHaveBeenCalled()
  })

  it('reports no close barrier without a valid native answer, and retries the same session until one comes', async () => {
    for (const failure of closeFailures) {
      const { native, session } = openedSession()
      native.api.closeSession.mockImplementationOnce(failure)
      expect(await session.close()).toEqual(unconfirmed)
      expect(session.liveness(request.invocationId)).toBe('revoked')
      expect(await session.admit(request)).toEqual(sessionClosed)
      expect(await session.close()).toEqual(confirmed)
      expect(await session.close()).toEqual(confirmed)
      expect(native.api.closeSession.mock.calls).toEqual([[{ sessionId: 'session-a1' }], [{ sessionId: 'session-a1' }]])
      expect(native.api.beginRun).not.toHaveBeenCalled()
    }
    const restarted = openedSession()
    restarted.native.api.closeSession.mockImplementationOnce(async () => ({ status: 'unknown' }))
    expect(await restarted.session.close()).toEqual(confirmed)
  })

  it('confirms ending a key only from a valid native answer, and repeats it with the same key', async () => {
    const key = { sessionId: 'session-a1', invocationId: 'invocation-1' }
    for (const failure of endFailures) {
      const { native, session } = openedSession()
      native.api.endRun.mockImplementationOnce(failure)
      expect(await session.end('invocation-1')).toEqual(unconfirmed)
      expect(session.liveness('invocation-1')).toBe('cancelled')
      expect(await session.admit(request)).toEqual(cancelled)
      expect(await session.end('invocation-1')).toEqual(confirmed)
      expect(native.api.endRun.mock.calls).toEqual([[key], [key]])
    }
    const { native, session } = openedSession()
    const nativeEnd = deferred<EndRunReply | null>()
    native.api.endRun.mockImplementationOnce(() => nativeEnd.promise)
    const results: unknown[] = []
    void session.end('invocation-1').then(result => { results.push(result) })
    await flush()
    expect(results).toEqual([])
    nativeEnd.resolve({ status: 'unknownSession' })
    await flush()
    expect(results).toEqual([confirmed])
  })

  it('ends a key in a closing session through the session close barrier', async () => {
    const { native, session } = openedSession()
    native.api.closeSession.mockImplementationOnce(async () => null)
    expect(await session.close()).toEqual(unconfirmed)
    expect(await session.end('invocation-1')).toEqual(confirmed)
    expect(native.api.closeSession).toHaveBeenCalledTimes(2)
    expect(native.api.endRun).not.toHaveBeenCalled()
  })

  it('a session whose open never answered admitted nothing, so its barriers hold without native calls', async () => {
    for (const reply of [null, { status: 'refused', reason: 'vaultUnavailable' } as const]) {
      const native = fakeNative()
      const session = openExtensionSession(native.api, '/vault/gone')
      native.opens[0].resolve(reply)
      expect(await session.admit(request)).toEqual(sessionClosed)
      expect(await session.end('invocation-1')).toEqual(confirmed)
      expect(await session.close()).toEqual(confirmed)
      expect(native.api.beginRun).not.toHaveBeenCalled()
      expect(native.api.endRun).not.toHaveBeenCalled()
      expect(native.api.closeSession).not.toHaveBeenCalled()
    }
  })

  it('reads close and end replies strictly', () => {
    expect(parseCloseSessionReply({ status: 'closed' })).toEqual({ status: 'closed' })
    expect(parseCloseSessionReply({ status: 'unknown' })).toEqual({ status: 'unknown' })
    expect(parseCloseSessionReply({ status: 'closing' })).toBeNull()
    expect(parseCloseSessionReply({ status: 'closed', joined: 2 })).toBeNull()
    expect(parseEndRunReply({ status: 'ended' })).toEqual({ status: 'ended' })
    expect(parseEndRunReply({ status: 'unknownSession' })).toEqual({ status: 'unknownSession' })
    expect(parseEndRunReply({ status: 'closed' })).toBeNull()
    expect(parseEndRunReply(null)).toBeNull()
  })

  it('reads open and admission replies strictly against the request', () => {
    expect(parseOpenSessionReply({ status: 'open', sessionId: 'session-a1' })).toEqual({ status: 'open', sessionId: 'session-a1' })
    expect(parseOpenSessionReply({ status: 'open', sessionId: '' })).toBeNull()
    expect(parseOpenSessionReply({ status: 'open', sessionId: 'session a1' })).toBeNull()
    const args = { sessionId: 'session-a1', ...request }
    expect(parseRunAdmission(admitted(args), args)).toEqual(admitted(args))
    expect(parseRunAdmission(admitted({ ...args, packageSha256: sha('e') }), args)).toBeNull()
    expect(parseRunAdmission({ status: 'refused', reason: 'cancelled' }, args)).toEqual({ status: 'refused', reason: 'cancelled' })
    expect(parseRunAdmission({ status: 'refused', reason: 'vaultUnavailable' }, args)).toBeNull()
  })
})
