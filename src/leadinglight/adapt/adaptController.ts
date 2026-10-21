// The UI side of Adapt: provider status, one native visit per vault visit, the shown conversation,
// the composer draft and the person's Sends. No React, so ordering rules are testable.
//
// - Nothing is sent without an explicit Send while Codex is connected. Each Send is a fresh turn id
//   with exactly the draft's request, its visible attachments, the finished earlier turns shown in
//   this conversation, and the revision binding; native adds only the built-in guide.
// - One Send at a time. Its attempt is taken before anything is awaited and kept until its turn has
//   a terminal outcome or native has proved the turn id can no longer start. While it lasts nothing
//   else is sent and the shown conversation does not change.
// - The draft survives every outcome but a reply: a refusal, failure or stop puts it back for an
//   explicit Try again. Nothing is retried automatically.
// - Cancel closes the turn's admission at once, even before Send was answered; "stopped" is shown
//   only when native proves it, otherwise the stop is reported as not confirmed.
// - A visit belongs to one vault and one account. Leaving the vault or a change of account closes it;
//   anything that answers later for the old visit is ignored. A close or sign-out whose work is not
//   yet proven ended is shown as stopping and asked again by its own identity, boundedly, without
//   holding up what the person is writing.
// - What native reports about local saving is shown as it is; Save again writes locally only.
import type { ExtensionPackage } from '../extensions/extensionContract'
import type { PackageView } from '../extensions/extensionSessionController'
import {
  attachCurrentPage, attachExtension, attachExtensionFrom, attachPastedText, detach, revisionBaseOf, wireAttachments, wireRevision,
  type AdaptAttachment, type AttachmentRefusal, type AttachmentResult,
} from './adaptAttachments'
import {
  ADAPT_LIMITS, checkSendArgs,
  type AdaptApi, type AdaptCloseVisitReply, type AdaptConnectReply, type AdaptConversation, type AdaptConversationSummary, type AdaptEntry,
  type AdaptProviderState, type AdaptRevisionBase, type AdaptSendArgs, type AdaptSendRefusal, type AdaptTurnPhase,
} from './adaptContract'
import type { PageSnapshot } from './adaptPage'

/** The text of the disclosure shown on Connect; recorded by native with the consent. */
export const ADAPT_DISCLOSURE_VERSION = 'adapt-disclosure-1'

export interface AdaptDraft { readonly request: string; readonly attachments: readonly AdaptAttachment[] }
const EMPTY_DRAFT: AdaptDraft = { request: '', attachments: [] }

export type ProviderSnapshot =
  | { readonly status: 'checking' }
  /** The host gave no usable answer: Adapt is not available here (for example in the browser). */
  | { readonly status: 'noReply' }
  | { readonly status: 'known'; readonly codex: AdaptProviderState; readonly claude: AdaptProviderState }

/** `closed`: native no longer knows the visit (it ended without this window closing it); reopen to go on. */
export type VisitStatus = 'none' | 'opening' | 'open' | 'refused' | 'noReply' | 'closed'

/** Plain reasons the controller reports beside the conversation; none of them changes anything. */
export type AdaptNotice =
  | { readonly kind: 'sendRefused'; readonly reason: AdaptSendRefusal | 'notSent' }
  | { readonly kind: 'conversationRefused'; readonly reason: 'conversationLimit' | 'storageUnavailable' | 'noReply' }
  | { readonly kind: 'deleteRefused'; readonly reason: 'running' | 'storageUnavailable' | 'noReply' }
  | { readonly kind: 'connectRefused'; readonly reason: Extract<AdaptConnectReply, { status: 'refused' }>['reason'] | 'noReply' }
  /** Cancelling a sign-in was not proven complete (`unconfirmed`), or got no usable answer. */
  | { readonly kind: 'cancelConnectUnconfirmed'; readonly reason: 'unconfirmed' | 'noReply' }
  | { readonly kind: 'attachRefused'; readonly reason: AttachmentRefusal | Exclude<PageSnapshot, object> }
  | { readonly kind: 'cancelUnconfirmed' }
  /** The visit ended natively while a Send was in flight: nothing of it can start any more. */
  | { readonly kind: 'visitClosed' }
  | { readonly kind: 'disconnectRefused' }
  /** Save again got no usable answer; what is shown is still only as safe as native last said. */
  | { readonly kind: 'saveRefused' }

/**
 * Work that was asked to stop but is not yet proven ended: `stopping` while native is asked again,
 * `unconfirmed` when the bounded asking ran out. Neither is ever shown as stopped.
 */
export type Winding = 'none' | 'stopping' | 'unconfirmed'

/**
 * The one Send in flight, from its click until its turn has a terminal outcome or native proved
 * nothing was sent. `creating`: its conversation is being made; `admitting`: Send is unanswered;
 * `running`: admitted; `unresolved`: Send went unanswered and native has not yet confirmed that
 * this turn id can no longer start. `cancel`: whether Cancel was asked, and whether native's answer
 * proved the stop.
 */
export interface AttemptView {
  readonly turnId: string
  readonly stage: 'creating' | 'admitting' | 'running' | 'unresolved'
  readonly cancel: 'none' | 'requested' | 'unconfirmed'
}

export interface AdaptSnapshot {
  readonly provider: ProviderSnapshot
  readonly visit: VisitStatus
  readonly conversations: readonly AdaptConversationSummary[]
  readonly conversationId: string | null
  readonly conversation: AdaptConversation | null
  readonly draft: AdaptDraft
  readonly attempt: AttemptView | null
  readonly notice: AdaptNotice | null
  /** A reply arrived while nobody was looking; cleared by `setLooking(true)`. */
  readonly unseenReply: boolean
  /** Save again is waiting for native's answer. */
  readonly saving: boolean
  /** Visits this window closed whose turns are not yet proven ended. */
  readonly closingVisit: Winding
  /** A sign-out whose cancelled work is not yet proven ended. */
  readonly signingOut: Winding
  /** The open visit's id; anything prepared for one visit is not used in another. */
  readonly visitId: string | null
}

export interface ControllerOptions {
  api: AdaptApi
  newId?: () => string
  /** How often a running turn or a sign-in in progress is read again. */
  pollMs?: number
  /** The first pause before asking again whether a close or sign-out finished; it doubles, up to 16 times this. */
  retryMs?: number
  /** How many times a close or sign-out is asked again before it is reported unconfirmed. */
  retries?: number
}

/** The phase the person sees: what the host reports, or Sending until the host reports one. */
export function turnPhaseOf(snapshot: AdaptSnapshot): AdaptTurnPhase | null {
  const hostPhase = snapshot.conversation?.turn?.phase ?? null
  const { attempt } = snapshot
  if (!attempt) return hostPhase
  if (snapshot.conversation?.turn?.turnId === attempt.turnId) return hostPhase
  return attempt.cancel === 'none' ? 'sending' : 'stopping'
}

/** The outcome entry of the latest turn, once it has ended. */
export function lastOutcomeOf(conversation: AdaptConversation | null): Exclude<AdaptEntry, { kind: 'request' }> | null {
  const last = conversation?.entries.at(-1)
  return last && last.kind !== 'request' ? last : null
}

/** Finished earlier turns whose request and reply text the next Send carries: those that ended with a reply. */
export function includedTurnsOf(conversation: AdaptConversation | null): string[] {
  if (!conversation) return []
  const replied = conversation.entries.filter(entry => entry.kind === 'reply').map(entry => entry.turnId)
  return replied.slice(-ADAPT_LIMITS.includedTurns)
}

/**
 * The revision this conversation already binds, from its latest request that named one, with the
 * expected active version recorded then; a follow-up keeps it unchanged.
 */
export function boundRevisionOf(conversation: AdaptConversation | null): AdaptRevisionBase | null {
  const requests = conversation?.entries.filter(entry => entry.kind === 'request') ?? []
  for (let index = requests.length - 1; index >= 0; index -= 1) {
    const request = requests[index]
    if (request.kind === 'request' && request.revision) return request.revision
  }
  return null
}

export const isConnected = (snapshot: AdaptSnapshot) => snapshot.provider.status === 'known' && snapshot.provider.codex.status === 'connected'
/** No Send in flight and no turn running: the shown conversation may change, and a Send may start. */
export const isSettled = (snapshot: AdaptSnapshot) => !snapshot.attempt && !snapshot.conversation?.turn
export const canSendIn = (snapshot: AdaptSnapshot) =>
  snapshot.visit === 'open' && isConnected(snapshot) && isSettled(snapshot) && snapshot.draft.request.trim() !== ''

/** The attempt as the controller keeps it: its identity never changes once taken. */
interface Attempt {
  readonly turnId: string
  readonly draft: AdaptDraft
  /** The revision this Send binds, fixed when it is taken. */
  readonly revision: AdaptRevisionBase | null
  conversationId: string | null
  stage: AttemptView['stage']
  cancel: AttemptView['cancel']
  /** Native answered a cancel of this exact turn id: it can no longer be admitted. */
  tombstoned: boolean
  /** Cancel was asked before Send was called; Send is then never called. */
  revoked: boolean
  /** Send's call has not returned yet. */
  sending: boolean
}

export type AdaptController = ReturnType<typeof createAdaptController>

export function createAdaptController(options: ControllerOptions) {
  const { api } = options
  const newId = options.newId ?? (() => crypto.randomUUID())
  const pollMs = options.pollMs ?? 600
  const retryMs = options.retryMs ?? 250
  const retries = options.retries ?? 8

  let snapshot: AdaptSnapshot = {
    provider: { status: 'checking' }, visit: 'none', conversations: [], conversationId: null, conversation: null,
    draft: EMPTY_DRAFT, attempt: null, notice: null, unseenReply: false, saving: false, closingVisit: 'none', signingOut: 'none',
    visitId: null,
  }
  const listeners = new Set<() => void>()
  /** Every visit gets a new epoch; an answer for an older one changes nothing. */
  let epoch = 0
  let vaultPath: string | null = null
  let visitId: string | null = null
  let attempt: Attempt | null = null
  let watching = false
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let looking = false
  /** The newest provider status shown in this visit; an older answer is ignored. */
  let statusRevision = -1
  /** Every explicit choice of what to show (history, New request, Send) takes a new number. */
  let selection = 0
  /** Visits closed by id whose close native has not yet answered `closed`. */
  const retiring = new Set<string>()
  let unconfirmedClose = false

  const publish = (next: Partial<AdaptSnapshot>) => {
    snapshot = { ...snapshot, ...next }
    for (const listener of listeners) listener()
  }
  const current = (at: number) => at === epoch
  const view = (value: Attempt | null): AttemptView | null => value && { turnId: value.turnId, stage: value.stage, cancel: value.cancel }
  const publishAttempt = (extra: Partial<AdaptSnapshot> = {}) => publish({ attempt: view(attempt), ...extra })

  /** Asks again after a growing pause, a bounded number of times, until `done`; nothing waits on it. */
  async function untilDone<R>(ask: () => Promise<R | null>, done: (reply: R) => boolean): Promise<boolean> {
    for (let tries = 0; tries < retries; tries += 1) {
      await new Promise(resolve => setTimeout(resolve, Math.min(retryMs * 2 ** tries, retryMs * 16)))
      const reply = await ask()
      if (reply && done(reply)) return true
    }
    return false
  }

  // --- Provider ---

  /**
   * Status answers may overlap (a poll, a click); one older than the one shown is ignored, so a late
   * stale "signed out" cannot close a visit that is in use. A lost answer changes nothing known.
   */
  async function refreshStatus(): Promise<void> {
    const at = epoch
    const reply = await api.status({})
    if (!current(at)) return
    const before = snapshot.provider
    if (!reply) {
      if (before.status !== 'known') publish({ provider: { status: 'noReply' } })
      return
    }
    if (reply.revision <= statusRevision) return
    statusRevision = reply.revision
    const provider: ProviderSnapshot = { status: 'known', codex: reply.providers.codex, claude: reply.providers.claude }
    publish({ provider })
    // A different or removed account: native stops its turns; this visit is closed and reopened,
    // keeping what the person is typing (or the request that was in flight) and the conversation shown.
    if (before.status === 'known' && before.codex.status === 'connected' && provider.codex.status !== 'connected' && vaultPath) {
      await enter(vaultPath, composerOrAttempt(), snapshot.conversationId)
    }
    if (provider.codex.status === 'connecting') schedule()
  }

  async function connect(): Promise<void> {
    // While a sign-out is still stopping its work it is asked again; a new sign-in waits for that.
    if (snapshot.provider.status !== 'known' || snapshot.provider.codex.status !== 'signedOut' || snapshot.signingOut === 'stopping') return
    publish({ notice: null })
    const reply = await api.connect({ provider: 'codex', disclosureVersion: ADAPT_DISCLOSURE_VERSION })
    if (reply?.status !== 'started') publish({ notice: { kind: 'connectRefused', reason: reply?.status === 'refused' ? reply.reason : 'noReply' } })
    await refreshStatus()
  }

  /**
   * Cancels a sign-in in progress. Only `cancelled` (or `notConnecting`, nothing to cancel) settles
   * it; an unproven or unreadable answer is said plainly and never shown as cancelled. Either way
   * the provider's own status is read again and the draft is left as it is.
   */
  async function cancelConnect(): Promise<void> {
    const reply = await api.cancelConnect({ provider: 'codex' })
    if (reply?.status !== 'cancelled' && reply?.status !== 'notConnecting') {
      publish({ notice: { kind: 'cancelConnectUnconfirmed', reason: reply ? 'unconfirmed' : 'noReply' } })
    }
    await refreshStatus()
  }

  /**
   * Signs out. `stopping` means signed out with nothing admitted, but work it cancelled is not yet
   * proven ended: that is shown as stopping, never as stopped, and asked again until it is proven.
   */
  async function disconnect(): Promise<void> {
    if (snapshot.signingOut === 'stopping') return
    const reply = await api.disconnect({ provider: 'codex' })
    if (!reply || reply.status === 'refused') { publish({ notice: { kind: 'disconnectRefused' } }); await refreshStatus(); return }
    if (reply.status === 'stopping') {
      publish({ signingOut: 'stopping' })
      void untilDone(() => api.disconnect({ provider: 'codex' }), next => next.status === 'disconnected')
        .then(proven => publish({ signingOut: proven ? 'none' : 'unconfirmed' }))
    }
    await refreshStatus()
  }

  // --- Visits and conversations ---

  /** What the composer should hold after a reset: what is typed, else the request in flight. */
  const composerOrAttempt = (): AdaptDraft => {
    const typed = snapshot.draft.request.trim() !== '' || snapshot.draft.attachments.length > 0
    return typed || !attempt ? snapshot.draft : attempt.draft
  }

  /**
   * Begins a visit of this vault; the one before is closed, and its late answers are ignored. A new
   * vault starts with an empty composer; `draft` carries the person's typing across an account change.
   */
  async function enter(path: string, draft: AdaptDraft = EMPTY_DRAFT, prefer: string | null = null): Promise<void> {
    closeCurrentVisit()
    epoch += 1
    const at = epoch
    vaultPath = path
    attempt = null
    statusRevision = -1
    selection += 1
    publish({ visit: 'opening', visitId: null, conversations: [], conversationId: null, conversation: null, attempt: null, notice: null, draft })
    void refreshStatus()
    const reply = await api.openVisit({ vaultPath: path })
    if (!current(at)) {
      if (reply?.status === 'open') retire(reply.visitId)
      return
    }
    if (reply?.status !== 'open') { publish({ visit: reply ? 'refused' : 'noReply' }); return }
    visitId = reply.visitId
    publish({ visit: 'open', visitId: reply.visitId })
    await resumeLatest(at, prefer)
  }

  /**
   * Shows the conversation that was shown before a reopen (`prefer`), so nothing it holds, saved or
   * not, drops out of sight; otherwise the latest one when it still has something to act on. Never
   * over a newer choice the person made meanwhile.
   */
  async function resumeLatest(at: number, prefer: string | null): Promise<void> {
    const intent = selection
    const list = await listConversations(at)
    const latest = list.find(item => item.conversationId === prefer) ?? list[0]
    if (!latest || !current(at) || selection !== intent) return
    if (latest.running || latest.conversationId === prefer) { await show(latest.conversationId, at); return }
    const conversation = await readOnce(latest.conversationId, null, at)
    if (conversation && lastOutcomeOf(conversation)?.kind === 'reply' && settled() && current(at) && selection === intent) {
      publish({ conversationId: conversation.conversationId, conversation })
    }
  }

  async function listConversations(at = epoch): Promise<readonly AdaptConversationSummary[]> {
    if (!visitId) return []
    const reply = await api.listConversations({ visitId })
    if (current(at) && reply?.status === 'unknownVisit') visitLost()
    if (!current(at) || reply?.status !== 'ok') return snapshot.conversations
    publish({ conversations: reply.conversations })
    return reply.conversations
  }

  /**
   * Native no longer knows this visit, so no turn of it can start or go on. A Send in flight ends
   * here with its draft back; the visit shows as closed until the person reopens it.
   */
  function visitLost() {
    const lost = visitId
    epoch += 1
    visitId = null
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
    watching = false
    // It may be closing natively: closing it by its own id learns when its work is proven ended.
    if (lost) retire(lost)
    const ended = attempt
    attempt = null
    const empty = snapshot.draft.request.trim() === '' && snapshot.draft.attachments.length === 0
    publish({
      visit: 'closed', visitId: null, attempt: null,
      ...(ended ? { notice: { kind: 'visitClosed' } as const } : {}), ...(ended && empty ? { draft: ended.draft } : {}),
    })
  }

  /** The conversation is gone natively (deleted elsewhere), so no turn can start in it. */
  function conversationGone(conversationId: string) {
    if (attempt?.conversationId === conversationId) finish(attempt, { kind: 'sendRefused', reason: 'unknownConversation' }, true)
    if (snapshot.conversationId === conversationId) publish({ conversationId: null, conversation: null })
    void listConversations()
  }

  /** Opens a fresh visit of the same vault after one closed or never answered, keeping the composer. */
  async function reopen(): Promise<void> {
    if (vaultPath && (snapshot.visit === 'closed' || snapshot.visit === 'noReply' || snapshot.visit === 'refused')) {
      await enter(vaultPath, snapshot.draft, snapshot.conversationId)
    }
  }

  /**
   * Closes one visit by its own id. `stopping` means its turns admit nothing but are not all proven
   * ended, so the same id is asked again, boundedly, in the background: what the person is writing
   * never waits for it, and it is shown as stopping until native says closed (or as unconfirmed).
   */
  function retire(closing: string) {
    retiring.add(closing)
    publish({ closingVisit: 'stopping' })
    const closed = (reply: AdaptCloseVisitReply) => reply.status !== 'stopping'
    void (async () => {
      const first = await api.closeVisit({ visitId: closing })
      const proven = (first !== null && closed(first)) || await untilDone(() => api.closeVisit({ visitId: closing }), closed)
      retiring.delete(closing)
      if (!proven) unconfirmedClose = true
      publish({ closingVisit: retiring.size > 0 ? 'stopping' : unconfirmedClose ? 'unconfirmed' : 'none' })
    })()
  }

  function closeCurrentVisit() {
    const closing = visitId
    visitId = null
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
    watching = false
    if (closing) retire(closing)
  }

  /** Leaves the vault: the visit closes, its turns stop natively, and nothing of it is shown. */
  async function exit(): Promise<void> {
    epoch += 1
    vaultPath = null
    attempt = null
    selection += 1
    publish({ visit: 'none', visitId: null, conversations: [], conversationId: null, conversation: null, attempt: null, notice: null, draft: EMPTY_DRAFT })
    closeCurrentVisit()
  }

  async function readOnce(conversationId: string, known: number | null, at: number): Promise<AdaptConversation | null> {
    if (!visitId) return null
    const reply = await api.readConversation({ visitId, conversationId, knownRevision: known })
    if (!current(at) || !reply) return null
    if (reply.status === 'ok') return reply.conversation
    if (reply.status === 'unchanged') return snapshot.conversation?.conversationId === conversationId ? snapshot.conversation : null
    if (reply.status === 'unknownVisit') visitLost()
    else conversationGone(conversationId)
    return null
  }

  /** While a Send is in flight or a turn runs, the shown conversation stays the one it belongs to. */
  const settled = () => !attempt && !snapshot.conversation?.turn

  /** Shows a conversation, unless the person chose something else (another one, New request) meanwhile. */
  async function show(conversationId: string, at = epoch): Promise<void> {
    if (!settled()) return
    const intent = ++selection
    const conversation = await readOnce(conversationId, null, at)
    if (!current(at) || !conversation || !settled() || selection !== intent) return
    publish({ conversationId, conversation, notice: null })
    if (conversation.turn) watch()
  }

  /** A fresh request: nothing earlier in any conversation travels with it, not even an attached extension. */
  function newRequest() {
    if (!settled()) return
    selection += 1
    publish({ conversationId: null, conversation: null, draft: EMPTY_DRAFT, notice: null })
  }

  /**
   * Writes the shown conversation to local storage again, after native reported it unsaved or
   * unconfirmed. Local only: nothing is sent and no turn is repeated, so it is never a Send.
   */
  async function saveConversation(): Promise<void> {
    const conversationId = snapshot.conversationId
    if (!visitId || !conversationId || snapshot.saving) return
    const at = epoch
    publish({ saving: true })
    const reply = await api.saveConversation({ visitId, conversationId })
    if (!current(at)) return
    publish({ saving: false })
    if (!reply) { publish({ notice: { kind: 'saveRefused' } }); return }
    if (reply.status === 'unknownVisit') { visitLost(); return }
    if (reply.status === 'unknownConversation') { conversationGone(conversationId); return }
    // Native's answer covers everything it holds for this conversation, so also what is shown.
    const shown = snapshot.conversation
    if (shown?.conversationId === conversationId && shown.storage !== reply.status) publish({ conversation: { ...shown, storage: reply.status } })
    await poll(at)
  }

  async function deleteConversation(): Promise<void> {
    const conversationId = snapshot.conversationId
    if (!visitId || !conversationId) return
    if (!settled()) { publish({ notice: { kind: 'deleteRefused', reason: 'running' } }); return }
    const at = epoch
    const reply = await api.deleteConversation({ visitId, conversationId })
    if (!current(at)) return
    if (reply?.status === 'refused') { publish({ notice: { kind: 'deleteRefused', reason: reply.reason } }); return }
    if (!reply) { publish({ notice: { kind: 'deleteRefused', reason: 'noReply' } }); return }
    if (reply.status === 'unknownVisit') { visitLost(); return }
    if (snapshot.conversationId === conversationId && settled()) publish({ conversationId: null, conversation: null, notice: null })
    await listConversations(at)
  }

  // --- Draft ---

  function setRequest(request: string) { publish({ draft: { ...snapshot.draft, request }, notice: null }) }

  function applyAttachment(result: AttachmentResult) {
    if (result.status === 'refused') { publish({ notice: { kind: 'attachRefused', reason: result.reason } }); return false }
    publish({ draft: { ...snapshot.draft, attachments: result.attachments }, notice: null })
    return true
  }
  const attachText = (text: string, label: string) => applyAttachment(attachPastedText(snapshot.draft.attachments, text, label))
  /** The page snapshot the host took on the person's click, or why there is none. */
  function attachPage(page: PageSnapshot) {
    if (typeof page !== 'string') return applyAttachment(attachCurrentPage(snapshot.draft.attachments, page))
    publish({ notice: { kind: 'attachRefused', reason: page } })
    return false
  }
  const attachPackage = (extension: ExtensionPackage, stored: { sha256: string; activeSha256: string | null }) =>
    applyAttachment(attachExtension(snapshot.draft.attachments, extension, stored))
  const attachFromView = (view: PackageView) => applyAttachment(attachExtensionFrom(snapshot.draft.attachments, view))
  /**
   * Adjust on an extension: a fresh request about it, so nothing from the conversation shown before
   * travels with it. What is typed stays; while a Send is in flight it is only attached.
   */
  function adjust(view: PackageView) {
    if (settled() && snapshot.conversationId) { selection += 1; publish({ conversationId: null, conversation: null }) }
    return attachFromView(view)
  }
  function removeAttachment(id: string) { publish({ draft: { ...snapshot.draft, attachments: detach(snapshot.draft.attachments, id) } }) }

  // --- Turns ---

  const canSend = () => canSendIn(snapshot)

  /** Ends the attempt. A non-reply ending puts its draft back, but only into an empty composer. */
  function finish(ended: Attempt, notice: AdaptNotice | null, restore: boolean) {
    if (attempt !== ended) return
    attempt = null
    const empty = snapshot.draft.request.trim() === '' && snapshot.draft.attachments.length === 0
    publish({ attempt: null, notice, ...(restore && empty ? { draft: ended.draft } : {}) })
  }

  /**
   * The request is in the transcript now. The first time, the composer empties, unless the person
   * has typed or attached something since Send, which stays.
   */
  function admitted(taken: Attempt, extra: Partial<AdaptSnapshot> = {}) {
    const first = taken.stage !== 'running'
    const unchanged = snapshot.draft.request === taken.draft.request && snapshot.draft.attachments === taken.draft.attachments
    taken.stage = 'running'
    publishAttempt({ ...(first && unchanged ? { draft: EMPTY_DRAFT } : {}), ...extra })
  }

  function argsFor(taken: Attempt, conversationId: string): AdaptSendArgs | null {
    if (!visitId) return null
    const shown = snapshot.conversation?.conversationId === conversationId ? snapshot.conversation : null
    return {
      visitId, conversationId, turnId: taken.turnId, provider: 'codex', request: taken.draft.request,
      attachments: wireAttachments(taken.draft.attachments), includeTurnIds: includedTurnsOf(shown), revision: taken.revision,
    }
  }

  /**
   * One explicit Send of the current draft; Try again is the same call with the restored draft. The
   * attempt is taken before the first await, so a second click finds it and does nothing. Its
   * revision is the attached extension's (with what was on when it was attached), else the one this
   * conversation already binds, unchanged.
   */
  async function send(): Promise<void> {
    if (!canSend() || !visitId) return
    const at = epoch
    const shown = snapshot.conversationId && snapshot.conversation?.conversationId === snapshot.conversationId ? snapshot.conversation : null
    const base = revisionBaseOf(snapshot.draft.attachments)
    const taken: Attempt = {
      turnId: newId(), draft: snapshot.draft, revision: base ? wireRevision(base) : boundRevisionOf(shown), conversationId: snapshot.conversationId,
      stage: snapshot.conversationId ? 'admitting' : 'creating', cancel: 'none', tombstoned: false, revoked: false, sending: false,
    }
    // The arguments are checked before a conversation is made for them.
    const problem = checkSendArgs(argsFor(taken, taken.conversationId ?? 'pending')!)
    if (problem) { publish({ notice: { kind: 'sendRefused', reason: problem } }); return }
    attempt = taken
    // Sending is a choice of this conversation: an earlier history pick still loading yields to it.
    selection += 1
    publishAttempt({ notice: null })

    if (!taken.conversationId) {
      const reply = await api.newConversation({ visitId })
      if (!current(at) || attempt !== taken) return
      // Cancelled while the conversation was being made: Send is never called for this attempt.
      if (taken.revoked) { finish(taken, { kind: 'sendRefused', reason: 'cancelled' }, true); return }
      if (reply?.status === 'unknownVisit') { visitLost(); return }
      if (reply?.status !== 'created') {
        finish(taken, { kind: 'conversationRefused', reason: reply?.status === 'refused' ? reply.reason : 'noReply' }, true)
        return
      }
      taken.conversationId = reply.conversationId
      taken.stage = 'admitting'
      publishAttempt({ conversationId: reply.conversationId, conversation: null })
    }
    const args = argsFor(taken, taken.conversationId!)
    const late = args && checkSendArgs(args)
    if (!args || late) { finish(taken, { kind: 'sendRefused', reason: late || 'invalidRequest' }, true); return }
    taken.sending = true
    const reply = await api.send(args)
    taken.sending = false
    if (!current(at) || attempt !== taken) return
    if (reply?.status === 'refused' && reply.reason === 'unknownVisit') { visitLost(); return }
    if (reply?.status === 'refused' && reply.reason === 'unknownConversation') { conversationGone(taken.conversationId!); return }
    // Admitted, or already seen in the transcript while Send was unanswered.
    if (reply?.status === 'admitted' || taken.stage === 'running') {
      admitted(taken)
      watch()
      await poll(at)
      return
    }
    if (reply) { finish(taken, { kind: 'sendRefused', reason: reply.reason }, true); return }
    // Unknown whether it was admitted: close its admission by id. Only a valid answer for that id
    // proves it can no longer start; until then the attempt stays and nothing else is sent.
    taken.stage = 'unresolved'
    publishAttempt()
    await cancelById(taken, at)
  }

  /** Asks native to stop this exact turn id; records whether the answer proved anything. */
  async function cancelById(taken: Attempt, at: number): Promise<void> {
    if (!visitId || !taken.conversationId) return
    const reply = await api.cancelTurn({ visitId, conversationId: taken.conversationId, turnId: taken.turnId })
    if (!current(at) || attempt !== taken) return
    if (reply?.status === 'unknownVisit') { visitLost(); return }
    if (reply?.status === 'unknownConversation') { conversationGone(taken.conversationId); return }
    if (reply === null) {
      taken.cancel = 'unconfirmed'
      publishAttempt({ notice: { kind: 'cancelUnconfirmed' } })
    } else {
      // Admission of this id is closed natively: from here its transcript tells the whole story.
      taken.tombstoned = true
      if (taken.cancel === 'unconfirmed') taken.cancel = 'requested'
      publishAttempt({ notice: snapshot.notice?.kind === 'cancelUnconfirmed' ? null : snapshot.notice })
    }
    watch()
    await poll(at)
  }

  /**
   * Stops the Send in flight. Before its conversation exists, Send is simply never called; after
   * that, its turn id is cancelled natively, whether or not Send was answered. Asking again repeats
   * the same id.
   */
  async function cancel(): Promise<void> {
    const taken = attempt
    const at = epoch
    if (!taken) { await cancelShown(at); return }
    if (taken.stage === 'creating') {
      taken.revoked = true
      taken.cancel = 'requested'
      publishAttempt()
      return
    }
    taken.cancel = 'requested'
    publishAttempt()
    await cancelById(taken, at)
  }

  /** A turn shown running that this window did not start here (reopened after Keep writing). */
  async function cancelShown(at: number): Promise<void> {
    const conversationId = snapshot.conversationId
    const turn = snapshot.conversation?.turn
    if (!visitId || !conversationId || !turn) return
    const reply = await api.cancelTurn({ visitId, conversationId, turnId: turn.turnId })
    if (!current(at)) return
    if (reply?.status === 'unknownVisit') { visitLost(); return }
    if (reply?.status === 'unknownConversation') { conversationGone(conversationId); return }
    if (reply === null) publish({ notice: { kind: 'cancelUnconfirmed' } })
    watch()
    await poll(at)
  }

  // --- Watching ---

  function schedule() {
    if (pollTimer) return
    pollTimer = setTimeout(() => { pollTimer = null; void tick() }, pollMs)
  }

  function watch() {
    watching = true
    schedule()
  }

  async function tick() {
    const at = epoch
    if (snapshot.provider.status === 'known' && snapshot.provider.codex.status === 'connecting') await refreshStatus()
    if (watching) await poll(at)
    if (!current(at)) return
    if (watching || (snapshot.provider.status === 'known' && snapshot.provider.codex.status === 'connecting')) schedule()
  }

  /**
   * Reads the shown conversation. Reads may overlap; a snapshot older than the one shown is
   * ignored. When the attempt's turn has ended, the attempt ends by how it ended.
   */
  async function poll(at = epoch): Promise<void> {
    const conversationId = snapshot.conversationId
    if (!conversationId) { watching = false; return }
    const shown = snapshot.conversation?.conversationId === conversationId ? snapshot.conversation : null
    const conversation = await readOnce(conversationId, shown?.revision ?? null, at)
    if (!current(at) || !conversation || snapshot.conversationId !== conversationId) return
    const latest = snapshot.conversation?.conversationId === conversationId ? snapshot.conversation : null
    if (latest && conversation.revision < latest.revision) return
    if (conversation !== latest) publish({ conversation })
    settleAttempt(conversation)
    if (!attempt && !conversation.turn) {
      watching = false
      void listConversations(at)
    }
  }

  function settleAttempt(conversation: AdaptConversation) {
    const taken = attempt
    if (!taken || taken.conversationId !== conversation.conversationId) return
    const entries = conversation.entries.filter(entry => entry.turnId === taken.turnId)
    if (entries.length === 0) {
      // No trace of it: only a proved cancel of this id, with Send no longer pending, means it was not sent.
      if (taken.tombstoned && !taken.sending && taken.stage === 'unresolved') finish(taken, { kind: 'sendRefused', reason: 'notSent' }, true)
      return
    }
    // Its request is in the transcript, so it was admitted, whatever Send itself answered.
    if (taken.stage !== 'running') admitted(taken, snapshot.notice?.kind === 'cancelUnconfirmed' ? { notice: null } : {})
    const outcome = entries.find(entry => entry.kind !== 'request')
    if (outcome?.kind === 'reply') {
      finish(taken, null, false)
      if (!looking) publish({ unseenReply: true })
      return
    }
    if (outcome?.kind === 'stopped') finish(taken, outcome.confirmed ? null : { kind: 'cancelUnconfirmed' }, true)
    if (outcome?.kind === 'failed') finish(taken, null, true)
  }

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    snapshot: () => snapshot,
    enter, exit, reopen, refreshStatus, connect, cancelConnect, disconnect,
    show, newRequest, deleteConversation, saveConversation, listConversations: () => listConversations(),
    setRequest, attachText, attachPage, attachPackage, attachFromView, adjust, removeAttachment,
    canSend, send, cancel,
    /** Names the open visit; an answer prepared for one visit is not used in another. */
    visitToken: () => visitId,
    /** Whether someone is looking at Adapt; a reply that arrives while nobody is marks it unseen. */
    setLooking(value: boolean) { looking = value; if (value && snapshot.unseenReply) publish({ unseenReply: false }) },
    dismissNotice() { if (snapshot.notice) publish({ notice: null }) },
  }
}
