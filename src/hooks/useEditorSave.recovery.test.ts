import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { AUTO_SAVE_DEBOUNCE_MS, SaveHeldError, SaveRefusedError, useEditorSave, type DocumentMutation } from './useEditorSave'
import { flushEditorContent } from '../utils/autoSave'
import type { OriginalRequest } from '../leadinglight/saveOutcome'

// Seam: native save outcomes -> the queue. Catches text dropped, replayed, or settled by a reply that was not its own.
type Args = Record<string, unknown>
type Reply = unknown | ((args: Args) => unknown)
const replies = new Map<string, Reply[]>()
const reply = (command: string, ...values: Reply[]) => replies.set(command, [...(replies.get(command) ?? []), ...values])
const COMMITTED = { status: 'committed', written: true, durable: true, history: null }
const mockInvokeFn = vi.fn(async (command: string, args: Args = {}) => {
  const queue = replies.get(command)
  if (!queue?.length) return command === 'save_page_content' ? COMMITTED : null
  const next = queue.shift()
  return typeof next === 'function' ? await next(args) : next
})

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: (command: string, args?: Args) => mockInvokeFn(command, args),
  updateMockContent: vi.fn(),
}))

const A = '/vault/a.md'
const B = '/vault/b.md'
const OTHER_ID = '7d2f5b1a-1c4e-4f4b-9a7e-2b8f3c6d5e40'
const CREATED = { status: 'created', path: '/vault/a copy.md', relativePath: 'a copy.md', durable: true }
const calls = (command: string) => mockInvokeFn.mock.calls.filter(([name]) => name === command).map(([, args]) => args as Args)
const saveRequest = (index: number) => calls('save_page_content')[index].request as OriginalRequest
const holdInfo = (request: OriginalRequest, kind: string) =>
  ({ requestId: request.requestId, kind, seq: request.seq, submittedSha256: request.submittedSha256 })
const resolved = (actionId: unknown) => ({ status: 'resolved', actionId, holdRetired: true, leftovers: [] })
const missing = ({ request }: Args) => ({ status: 'refused', reason: 'missing', hold: holdInfo(request as OriginalRequest, 'missing') })
const mutation: DocumentMutation<null> = { publish: async () => null, committedContent: () => null, rebase: content => content }

function gate() {
  let open: (value: unknown) => void = () => {}
  const promise = new Promise(resolve => { open = resolve })
  return { promise, open }
}

function setup() {
  const onNotePersisted = vi.fn()
  const setToastMessage = vi.fn()
  const hook = renderHook(({ scope }) => useEditorSave({
    persistenceScope: scope, updateVaultContent: vi.fn(), setTabs: vi.fn(), setToastMessage, onNotePersisted,
  }), { initialProps: { scope: ['/vault'] } })
  const page = () => hook.result.current
  const recovery = () => page().recovery
  const type = (path: string, content: string) => page().handleContentChange(path, content)
  const save = () => act(() => page().handleSave())
  return { ...hook, page, recovery, type, save, onNotePersisted, setToastMessage }
}

beforeEach(() => {
  replies.clear()
  mockInvokeFn.mockClear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('useEditorSave recovery', () => {
  it('reports a committed but not durable save calmly and never replays it', async () => {
    reply('save_page_content', { ...COMMITTED, durable: false })
    const h = setup()
    h.type(A, 'v1')
    await h.save()
    expect(h.recovery().getSnapshot().notDurable).toEqual([A])
    await h.save()
    expect(calls('save_page_content')).toHaveLength(1)
    expect(h.onNotePersisted).toHaveBeenCalledWith(A, 'v1')

    h.type(A, 'v2')
    await h.save()
    expect(h.recovery().getSnapshot().notDurable).toEqual([])
  })

  it.each(['readOnly', 'readFailed', 'stageFailed', 'busy', 'requestMismatch', 'requestVoided', 'publish'])(
    'keeps text refused with %s pending under its exact request; the next Save makes a new one',
    async reason => {
      reply('save_page_content', reason === 'publish' ? { status: 'failed', reason } : { status: 'refused', reason })
      const h = setup()
      h.type(A, 'v1')
      await h.save()
      expect(h.recovery().getSnapshot()).toMatchObject({ holds: [], retriable: [{ lane: A, reason, request: saveRequest(0) }] })

      await h.save()
      expect(saveRequest(1)).toMatchObject({ seq: saveRequest(0).seq })
      expect(saveRequest(1).requestId).not.toBe(saveRequest(0).requestId)
      expect(h.recovery().getSnapshot().retriable).toEqual([])
      expect(h.onNotePersisted).toHaveBeenCalledWith(A, 'v1')
    },
  )

  it.each([
    ['missing', missing, 'missing'],
    ['parentMissing', ({ request }: Args) => ({ status: 'refused', reason: 'parentMissing', hold: holdInfo(request as OriginalRequest, 'missing') }), 'missing'],
    ['symlink', ({ request }: Args) => ({ status: 'refused', reason: 'symlink', hold: holdInfo(request as OriginalRequest, 'linked') }), 'linked'],
    ['conflict', ({ request }: Args) => ({ status: 'conflict', reason: 'changedDuringSave', hold: holdInfo(request as OriginalRequest, 'conflict') }), 'conflict'],
    ['uncertain', ({ request }: Args) => ({ status: 'uncertain', hold: holdInfo(request as OriginalRequest, 'uncertain'), originalAt: null, stagedAt: null }), 'uncertain'],
    ['a hold naming another request', ({ request }: Args) => ({ status: 'refused', reason: 'missing', hold: { ...holdInfo(request as OriginalRequest, 'missing'), requestId: OTHER_ID } }), 'unknown'],
  ])('holds text for %s and stops ordinary saving before invoke', async (_case, answer, kind) => {
    reply('save_page_content', answer)
    const h = setup()
    h.type(A, 'v1')
    await h.save()
    expect(h.recovery().getSnapshot().holds).toEqual([expect.objectContaining({ lane: A, kind, request: saveRequest(0), adopted: false })])
    await h.save()
    expect(calls('save_page_content')).toHaveLength(1)
    expect(h.page().hasPendingWrite(A)).toBe(true)
  })

  it('leaves an autosave hold to the page notice, and tells an explicit Save why it waits', async () => {
    reply('save_page_content', missing)
    const h = setup()
    vi.useFakeTimers()
    h.type(A, 'v1')
    await act(() => vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS))
    vi.useRealTimers()
    await vi.waitFor(() => expect(h.recovery().getSnapshot().holds).toHaveLength(1))
    expect(h.setToastMessage).not.toHaveBeenCalled()
    await h.save()
    expect(h.setToastMessage).toHaveBeenCalledWith("This page's unsaved text needs a choice before it can save. Your edits are kept.")
  })

  it('refuses forced drains and page changes for a held page while another page still saves', async () => {
    reply('save_page_content', missing)
    const h = setup()
    h.type(A, 'a1')
    await h.save()
    h.type(B, 'b1')
    await h.save()
    expect(calls('save_page_content').map(args => (args.request as OriginalRequest).path)).toEqual([A, B])
    expect(h.onNotePersisted).toHaveBeenCalledWith(B, 'b1')

    await expect(h.page().drainHeld(A)).rejects.toBeInstanceOf(SaveHeldError)
    expect(h.page().mutateDocument(A, mutation)).toEqual({ admitted: false, reason: 'busy' })
    expect(h.page().claimPage(A)).toBeNull()
    expect(calls('save_page_content')).toHaveLength(2)
  })

  it('ignores a reply that arrives after the vault session changed', async () => {
    const reply1 = gate()
    reply('save_page_content', () => reply1.promise)
    const h = setup()
    h.type(A, 'v1')
    const saving = h.page().savePendingForPath(A)
    await vi.waitFor(() => expect(calls('save_page_content')).toHaveLength(1))
    h.rerender({ scope: ['/vault', '/other'] })
    reply1.open(COMMITTED)
    // The old reply settles nothing; the drain saves the still-pending text under the new session.
    await act(async () => { await saving })
    expect(calls('save_page_content')).toHaveLength(2)
    expect(saveRequest(1).session).not.toBe(saveRequest(0).session)
    expect(h.onNotePersisted).toHaveBeenCalledTimes(1)
  })

  it('holds text with no reply under its own request; Check again only queries', async () => {
    reply('save_page_content', null)
    reply('check_save_outcome', { state: 'running' }, { state: 'voided' })
    const h = setup()
    h.type(A, 'v1')
    await h.save()
    const original = saveRequest(0)
    expect(h.recovery().getSnapshot().holds).toEqual([expect.objectContaining({ kind: 'unknown', reason: 'noReply', request: original })])

    expect(await act(() => h.recovery().checkAgain(A))).toEqual({ state: 'running' })
    expect(h.recovery().getSnapshot().holds).toHaveLength(1)
    expect(await act(() => h.recovery().checkAgain(A))).toEqual({ state: 'voided' })
    expect(calls('check_save_outcome')).toEqual([{ request: original }, { request: original }])
    expect(calls('save_page_content')).toHaveLength(1)

    await h.save()
    expect(saveRequest(1).requestId).not.toBe(original.requestId)
    expect(h.onNotePersisted).toHaveBeenCalledWith(A, 'v1')
  })

  it('settles only the submitted text when Check again proves an old save landed', async () => {
    reply('save_page_content', null)
    reply('check_save_outcome', { state: 'done', outcome: COMMITTED })
    const h = setup()
    h.type(A, 'v1')
    await h.save()
    h.type(A, 'v2')
    expect(await act(() => h.recovery().checkAgain(A))).toMatchObject({ state: 'done', held: false })
    expect(h.onNotePersisted).not.toHaveBeenCalled()

    await h.save()
    expect(calls('save_page_content')[1].content).toBe('v2')
    expect(h.onNotePersisted).toHaveBeenCalledWith(A, 'v2')
  })

  it('keeps a retired request recoverable and settles it by its own confirmed copy', async () => {
    reply('save_page_content', null)
    reply('check_save_outcome', { state: 'retired', terminal: 'committed', resolved: false })
    reply('save_draft_as_new_page', CREATED)
    reply('release_hold_with_copy', ({ actionId }: Args) => resolved(actionId))
    const h = setup()
    const receipt = h.type(A, 'v1')!
    await h.save()
    expect(await act(() => h.recovery().checkAgain(A))).toEqual({ state: 'retired', resolved: false })
    expect(h.recovery().getSnapshot().holds).toEqual([expect.objectContaining({ retired: true })])

    expect(await act(() => h.recovery().saveDraftCopy(A, null))).toEqual({ status: 'done', outcome: CREATED })
    expect(calls('save_draft_as_new_page')[0]).toMatchObject({ request: saveRequest(0), draft: { seq: receipt.seq, content: 'v1' } })
    expect(h.recovery().canKeepCopy(A)).toBe(true)

    const final = begin(h, A)
    expect(await act(() => final.resolve('keepCopy'))).toMatchObject({ status: 'prepared', kind: 'keepCopy' })
    expect(final.apply(() => true)).toMatchObject({ status: 'applied', kind: 'keepCopy' })
    expect(calls('release_hold_with_copy')[0]).toMatchObject({
      request: saveRequest(0), operationId: calls('save_draft_as_new_page')[0].operationId, confirmed: { seq: receipt.seq },
    })
    expect(h.page().receiptStatus(receipt)).toBe('settled')
    expect(h.recovery().getSnapshot()).toMatchObject({ holds: [], copies: [] })
    final.release()
  })

  it.each([
    ['names its own holder for this page', {}, {}, true],
    ['names a different holder', { heldBy: OTHER_ID.replace('7', '8') }, {}, false],
    ['holds another page', {}, { path: B }, false],
    ['holds a page in another vault', {}, { vaultPath: '/other' }, false],
  ])('adopts a native held answer only when it %s', async (_case, answerChange, holderChange, adopted) => {
    const holder = (request: OriginalRequest) => ({ ...request, requestId: OTHER_ID, seq: 0, ...holderChange })
    reply('save_page_content', ({ request }: Args) => ({
      status: 'refused', reason: 'held', heldBy: OTHER_ID, heldRequest: holder(request as OriginalRequest), heldKind: 'conflict', ...answerChange,
    }))
    const h = setup()
    h.type(A, 'v1')
    await h.save()
    const snapshot = h.recovery().getSnapshot()
    if (adopted) {
      expect(snapshot.holds).toEqual([expect.objectContaining({ lane: A, adopted: true, kind: 'conflict', request: holder(saveRequest(0)) })])
    } else {
      expect(snapshot).toMatchObject({ holds: [], retriable: [{ lane: A, reason: 'held', request: saveRequest(0) }] })
    }
    expect(h.page().hasPendingWrite(A)).toBe(true)
  })

  it('keeps text refused for an unsafe path recoverable instead of dropping it', async () => {
    reply('save_page_content', { status: 'refused', reason: 'outsideVault' })
    reply('save_draft_as_new_page', CREATED)
    const h = setup()
    h.type(A, 'v1')
    await h.save()
    expect(h.recovery().getSnapshot().holds).toEqual([expect.objectContaining({ kind: 'unsafe', reason: 'outsideVault' })])
    expect(await act(() => h.recovery().saveDraftCopy(A, null))).toEqual({ status: 'done', outcome: CREATED })
    expect(calls('save_draft_as_new_page')[0]).toMatchObject({ request: saveRequest(0), draft: { content: 'v1' } })
    await h.save()
    expect(calls('save_page_content')).toHaveLength(1)
  })

  it('never lets an older copy or a lost reply settle newer text', async () => {
    reply('save_page_content', { status: 'refused', reason: 'stageFailed' })
    reply('save_draft_as_new_page', CREATED)
    const h = setup()
    h.type(A, 'v1')
    await h.save()
    await act(() => h.recovery().saveDraftCopy(A, null))
    h.type(A, 'v2')
    expect(h.recovery().canKeepCopy(A)).toBe(false)

    let final = begin(h, A)
    expect(await final.resolve('keepCopy')).toEqual({ status: 'refused', reason: 'copyStale' })
    reply('discard_hold', null)
    expect(await final.resolve('discard')).toEqual({ status: 'unknown' })
    final.release()

    h.type(A, 'v3')
    reply('discard_hold', resolved(OTHER_ID), ({ actionId }: Args) => resolved(actionId))
    final = begin(h, A)
    expect(await final.resolve('discard')).toEqual({ status: 'unknown' })
    expect(h.page().hasPendingWrite(A)).toBe(true)
    expect(await act(() => final.resolve('discard'))).toMatchObject({ status: 'prepared', kind: 'discard' })
    expect(final.apply(() => true)).toMatchObject({ status: 'applied', kind: 'discard' })
    const [lost, newer, retry] = calls('discard_hold')
    expect(newer.actionId).not.toBe(lost.actionId)
    expect(retry.actionId).toBe(newer.actionId)
    expect((newer.confirmed as { seq: number }).seq).toBeGreaterThan((lost.confirmed as { seq: number }).seq)
    expect(h.page().hasPendingWrite(A)).toBe(false)
    final.release()
  })

  it('blocks the page during a final resolution and keeps newer text when the choice is abandoned', async () => {
    reply('save_page_content', { status: 'refused', reason: 'stageFailed' })
    const h = setup()
    h.type(A, 'v1')
    await h.save()
    const final = begin(h, A)
    expect(h.recovery().beginFinalResolution(A)).toEqual({ status: 'busy' })
    expect(h.type(A, 'typed during the choice')).toBeNull()
    expect(h.page().mutateDocument(A, mutation)).toEqual({ admitted: false, reason: 'busy' })
    expect(h.page().claimPage(A)).toBeNull()
    await expect(h.page().savePendingForPath(A)).rejects.toBeInstanceOf(SaveHeldError)

    const answer = gate()
    reply('discard_hold', () => answer.promise)
    const resolving = final.resolve('discard')
    await vi.waitFor(() => expect(calls('discard_hold')).toHaveLength(1))
    final.release()
    expect(h.type(A, 'v2')).not.toBeNull()
    answer.open(resolved(calls('discard_hold')[0].actionId))
    expect(await resolving).toEqual({ status: 'stale' })
    expect(await final.resolve('discard')).toEqual({ status: 'refused', reason: 'released' })

    await h.save()
    expect(calls('save_page_content').at(-1)?.content).toBe('v2')
  })

  it('lets the fallback writer call tab text saved only by its own receipt', async () => {
    reply('save_page_content', { status: 'refused', reason: 'stageFailed' })
    const h = setup()
    const onSaved = vi.fn()
    const deps = {
      savePendingForPath: h.page().savePendingForPath, getTabContent: () => 'tab text', isUnsaved: () => true,
      admitContent: h.page().handleContentChange, receiptStatus: h.page().receiptStatus, onSaved,
    }
    await expect(act(() => flushEditorContent(A, deps))).rejects.toBeInstanceOf(SaveRefusedError)
    expect(onSaved).not.toHaveBeenCalled()

    await act(() => flushEditorContent(B, deps))
    expect(onSaved).toHaveBeenCalledWith(B, 'tab text')
    expect(calls('save_page_content').map(args => args.content)).toEqual(['tab text', 'tab text'])
  })
})

const STAGE_FAILED = { status: 'refused', reason: 'stageFailed' }
const holderOf = (request: OriginalRequest, change: Partial<OriginalRequest> = {}) =>
  ({ ...request, requestId: OTHER_ID, seq: 0, submittedSha256: 'a'.repeat(64), ...change })
const heldBy = (holder: OriginalRequest) =>
  ({ state: 'done', outcome: { status: 'refused', reason: 'held', heldBy: OTHER_ID, heldRequest: holder, heldKind: 'conflict' } })

function begin(h: ReturnType<typeof setup>, path: string) {
  const started = h.recovery().beginFinalResolution(path)
  if (started.status !== 'ready') throw new Error(`final resolution not ready: ${started.status}`)
  return started.final
}

// Seam: the final choice against saves already running in the page's lane. Catches a discard revived by an older retry.
describe('final resolution and work already in the lane', () => {
  it.each(['discard', 'keepCopy'] as const)('waits out a running retry before %s, then binds the request it left', async kind => {
    reply('save_page_content', STAGE_FAILED)
    reply('save_draft_as_new_page', CREATED)
    reply('discard_hold', ({ actionId }: Args) => resolved(actionId))
    reply('release_hold_with_copy', ({ actionId }: Args) => resolved(actionId))
    const h = setup()
    h.type(A, 'v1')
    await h.save()
    const retry = gate()
    reply('save_page_content', () => retry.promise)
    h.type(A, 'v2')
    const saving = h.page().savePendingForPath(A).catch(() => false)
    await vi.waitFor(() => expect(calls('save_page_content')).toHaveLength(2))

    expect(h.recovery().beginFinalResolution(A)).toEqual({ status: 'busy' })
    const idle = h.recovery().whenPageIdle(A)
    retry.open(STAGE_FAILED)
    await act(async () => { await saving; await idle })
    if (kind === 'keepCopy') await act(() => h.recovery().saveDraftCopy(A, null))
    const final = begin(h, A)
    expect(final.bound).toMatchObject({ request: saveRequest(1), content: 'v2' })
    expect(await act(() => final.resolve(kind))).toMatchObject({ status: 'prepared', kind })
    expect(final.apply(() => true)).toMatchObject({ status: 'applied', kind })
    final.release()
    await h.save()
    expect(calls('save_page_content')).toHaveLength(2)
    expect(h.page().hasPendingWrite(A)).toBe(false)
  })

  it('has nothing left to resolve when the running retry commits', async () => {
    reply('save_page_content', STAGE_FAILED)
    const h = setup()
    h.type(A, 'v1')
    await h.save()
    const retry = gate()
    reply('save_page_content', () => retry.promise)
    h.type(A, 'v2')
    const saving = h.page().savePendingForPath(A)
    await vi.waitFor(() => expect(calls('save_page_content')).toHaveLength(2))
    expect(h.recovery().beginFinalResolution(A)).toEqual({ status: 'busy' })
    retry.open(COMMITTED)
    await act(async () => { await saving })
    expect(h.recovery().beginFinalResolution(A)).toEqual({ status: 'none' })
    expect(h.onNotePersisted).toHaveBeenCalledWith(A, 'v2')
  })

  it('refuses to begin while a claim, a Trash move or closing holds the page', async () => {
    reply('save_page_content', STAGE_FAILED)
    const h = setup()
    h.type(A, 'v1')
    await h.save()
    const claim = h.page().claimPage(A)!
    expect(h.recovery().beginFinalResolution(A)).toEqual({ status: 'busy' })
    claim.release()
    h.page().holdAutosave([A])
    expect(h.recovery().beginFinalResolution(A)).toEqual({ status: 'busy' })
    h.page().releaseAutosave([A], 'release')
    const reopen = h.page().holdMutationAdmission()
    expect(h.recovery().beginFinalResolution(A)).toEqual({ status: 'busy' })
    reopen()
    begin(h, A).release()
  })
})

// Seam: native proof -> the editor reset. Catches a draft retired before its buffers were reset.
describe('final resolution settles only after the editor resets', () => {
  it('keeps the text and its receipt pending after native proof until a reset succeeds', async () => {
    reply('save_page_content', STAGE_FAILED)
    reply('discard_hold', ({ actionId }: Args) => resolved(actionId))
    const h = setup()
    const receipt = h.type(A, 'v1')!
    await h.save()
    const final = begin(h, A)
    expect(await act(() => final.resolve('discard'))).toMatchObject({ status: 'prepared', kind: 'discard' })
    expect(h.page().receiptStatus(receipt)).toBe('pending')
    await expect(h.page().savePendingForPath(A)).rejects.toBeInstanceOf(SaveHeldError)

    expect(final.apply(() => false)).toEqual({ status: 'resetFailed' })
    expect(final.apply(() => { throw new Error('the blocks did not parse') })).toEqual({ status: 'resetFailed' })
    expect(h.page().receiptStatus(receipt)).toBe('pending')
    expect(h.recovery().getSnapshot().retriable).toHaveLength(1)

    let pendingDuringReset = false
    expect(final.apply(() => { pendingDuringReset = h.page().hasPendingWrite(A); return true })).toMatchObject({ status: 'applied' })
    expect(pendingDuringReset).toBe(true)
    expect(h.page().receiptStatus(receipt)).toBe('settled')
    expect(final.apply(() => true)).toEqual({ status: 'notPrepared' })
    final.release()
    await h.save()
    expect(calls('save_page_content')).toHaveLength(1)
  })

  it('lets an exact retry settle after native resolved but the reset never ran', async () => {
    reply('save_page_content', missing)
    reply('discard_hold', ({ actionId }: Args) => resolved(actionId), ({ actionId }: Args) => resolved(actionId))
    const h = setup()
    h.type(A, 'v1')
    await h.save()
    const first = begin(h, A)
    expect(await act(() => first.resolve('discard'))).toMatchObject({ status: 'prepared' })
    first.release()
    expect(first.apply(() => true)).toEqual({ status: 'released' })
    expect(h.page().hasPendingWrite(A)).toBe(true)
    await expect(h.page().savePendingForPath(A)).rejects.toBeInstanceOf(SaveHeldError)

    const again = begin(h, A)
    expect(await act(() => again.resolve('discard'))).toMatchObject({ status: 'prepared' })
    const [lost, retry] = calls('discard_hold')
    expect(retry.actionId).toBe(lost.actionId)
    expect(again.apply(() => true)).toMatchObject({ status: 'applied' })
    again.release()
    expect(h.page().hasPendingWrite(A)).toBe(false)
  })

  it('never settles for a request that a late Check replaced with the real holder', async () => {
    reply('save_page_content', null)
    const check = gate()
    reply('check_save_outcome', () => check.promise)
    reply('discard_hold', ({ actionId }: Args) => resolved(actionId))
    const h = setup()
    h.type(A, 'v1')
    await h.save()
    const final = begin(h, A)
    const checking = h.recovery().checkAgain(A)
    expect(await act(() => final.resolve('discard'))).toMatchObject({ status: 'prepared' })
    check.open(heldBy(holderOf(saveRequest(0))))
    await act(async () => { await checking })
    const reset = vi.fn(() => true)
    expect(final.apply(reset)).toEqual({ status: 'stale' })
    expect(reset).not.toHaveBeenCalled()
    expect(h.page().hasPendingWrite(A)).toBe(true)
    final.release()
  })
})

// Seam: a lost held reply -> Check again. Catches a choice that retires the lost request but not the real holder.
describe('a lost held reply', () => {
  it('adopts the real holder on Check, so the final choice addresses it', async () => {
    reply('save_page_content', null)
    reply('check_save_outcome', ({ request }: Args) => heldBy(holderOf(request as OriginalRequest)))
    reply('discard_hold', ({ actionId }: Args) => resolved(actionId))
    const h = setup()
    h.type(A, 'v1')
    await h.save()
    expect(await act(() => h.recovery().checkAgain(A))).toMatchObject({ state: 'done', held: true })
    expect(h.recovery().getSnapshot().holds).toEqual([
      expect.objectContaining({ adopted: true, kind: 'conflict', request: holderOf(saveRequest(0)) }),
    ])

    const final = begin(h, A)
    expect(final.bound).toMatchObject({ request: { requestId: OTHER_ID }, content: 'v1' })
    expect(await act(() => final.resolve('discard'))).toMatchObject({ status: 'prepared' })
    expect(calls('discard_hold')[0].request).toMatchObject({ requestId: OTHER_ID })
    expect(final.apply(() => true)).toMatchObject({ status: 'applied' })
    final.release()
  })

  it('keeps the hold on its own request when the named holder is another page', async () => {
    reply('save_page_content', null)
    reply('check_save_outcome', ({ request }: Args) => heldBy(holderOf(request as OriginalRequest, { path: B })))
    const h = setup()
    h.type(A, 'v1')
    await h.save()
    expect(await act(() => h.recovery().checkAgain(A))).toMatchObject({ state: 'done', held: true })
    expect(h.recovery().getSnapshot().holds).toEqual([
      expect.objectContaining({ adopted: false, kind: 'unknown', request: saveRequest(0) }),
    ])
  })
})
