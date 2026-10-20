// The UI side of extensions: the registry as this vault sees it, one native session per vault
// visit, and the runs started through it. No React here, so every ordering rule is testable.
//
// - A visit owns at most one ExtensionSession, opened only when a run is first asked for, so
//   browsing, previews and settings never reach native sessions. Returning to a vault is a new
//   visit; nothing is keyed by path.
// - Each explicit Create is one run: a fresh invocation, admission, folder handle and operation id.
//   Only a definite no-write answer lets the next Create start another; an uncertain write is only
//   ever queried with its own operation id.
// - Every native answer is checked against what was asked before it grants a path or an open.
import { notePathsMatch, joinVaultPath, normalizeNotePathForIdentity, normalizeVaultRelativePath } from '../../utils/notePathIdentity'
import { sha256Hex } from '../saveOutcome'
import type { CommittedReceipt, GuardedProposal, ProposalReceipt, ProposalRefusal } from '../proposals/proposalContract'
import {
  openExtensionSession,
  type ActivationRefusal, type ExtensionSession, type HandleRefusal, type RunAdmissionRefusal, type SessionBarrier, type StoredVersion,
} from './extensionApi'
import {
  E1_HOST_CAPABILITIES, RESERVED_PACKAGE_ID_PREFIX,
  type Capability, type CommandReview, type ExtensionCommand, type ExtensionDiagnostic, type ExtensionPackage, type FormAnswers,
  type InputProblem, type PackageReview, type RunEffects, type RunLiveness, type RunOutcome,
} from './extensionContract'
import { buildExtensionMarkdown, type MarkdownRefusal } from './extensionMarkdown'
import { previewDocument, reviewPackage, runExtensionCommand } from './extensionRecipe'
import { parseExtensionPackage } from './extensionSchema'
import type { ExtensionTransport } from './extensionTransport'

// --- Registry view ---------------------------------------------------------------------------------

export type PackageLoad =
  | { readonly status: 'ready'; readonly extension: ExtensionPackage; readonly review: PackageReview }
  /** Missing, damaged, hash or id mismatch, or no longer valid: shown, never runnable. */
  | { readonly status: 'unreadable' }

export interface PackageView {
  readonly packageId: string
  /** Package text: render as plain text only. */
  readonly name: string
  /** Shipped with LeadingLight; only bundled packages use the reserved id prefix. */
  readonly bundled: boolean
  readonly versions: readonly StoredVersion[]
  readonly activeSha256: string | null
  readonly previousSha256: string | null
  readonly active: PackageLoad | null
  /** What Preview and Turn on review: the newest import that is neither active nor the rollback target. */
  readonly candidate: { readonly stored: StoredVersion; readonly load: PackageLoad } | null
  /** The version a behaviour rollback restores, when there is one. */
  readonly rollback: StoredVersion | null
}

export type RegistrySnapshot =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly vaultPath: string }
  | { readonly status: 'ready'; readonly vaultPath: string; readonly packages: readonly PackageView[] }
  | { readonly status: 'failed'; readonly vaultPath: string; readonly reason: 'noReply' | 'vaultUnavailable' }
  /** Leaving was refused because native did not confirm a session closed; nothing runs until it does. */
  | { readonly status: 'unsettled'; readonly vaultPath: string }

export interface RunnableCommand {
  /** `${packageId}/${commandId}`; both ids exclude '/'. */
  readonly key: string
  readonly packageId: string
  readonly packageSha256: string
  readonly packageName: string
  readonly extension: ExtensionPackage
  readonly command: ExtensionCommand
  readonly review: CommandReview
}

/** Commands the person can start from New page now: active, readable, fully supported, no selection needed. */
export function runnableCommands(snapshot: RegistrySnapshot): RunnableCommand[] {
  if (snapshot.status !== 'ready') return []
  return snapshot.packages.flatMap(view => {
    const active = view.active
    if (view.activeSha256 === null || active?.status !== 'ready' || active.review.activation !== 'available') return []
    return active.extension.commands.flatMap(command => {
      const review = active.review.commands.find(item => item.id === command.id)
      if (!review || review.missing.length > 0 || review.placement !== 'palette') return []
      return [{ key: `${view.packageId}/${command.id}`, packageId: view.packageId, packageSha256: view.activeSha256!,
        packageName: active.extension.name, extension: active.extension, command, review }]
    })
  })
}

// --- Outcomes --------------------------------------------------------------------------------------

export type ImportOutcome =
  | { readonly status: 'invalid'; readonly diagnostics: readonly ExtensionDiagnostic[]; readonly truncated: boolean }
  | { readonly status: 'candidate'; readonly packageSha256: string; readonly extension: ExtensionPackage; readonly review: PackageReview }
  | { readonly status: 'refused'; readonly reason: 'reservedId' | 'storageUnavailable' }
  /** No usable answer, or one about other bytes. Import never activates, so checking again is safe. */
  | { readonly status: 'noReply' }

export type ChangeOutcome =
  | { readonly status: 'done' }
  | { readonly status: 'refused'; readonly reason: ActivationRefusal; readonly missing: readonly Capability[] }
  | { readonly status: 'noReply' }

/** Every one of these proves nothing was written, so an explicit Create may try again. */
export type NotWrittenReason =
  | 'exists' | 'storage' | 'invalidName' | 'tooLarge' | 'link' | 'folderMissing' | 'busy'
  | 'notStarted' | 'unavailable' | 'unsafeText' | 'internal'

export interface CreatedPage {
  /** Absolute page path in the visit's vault, from the receipt. */
  readonly path: string
  /** Vault-relative, for display; the receipt path when it is not inside the vault. */
  readonly displayPath: string
  readonly title: string
  readonly content: string
}

export interface PendingAttempt {
  readonly operationId: string
  /** Where the page would be, for the person to look; never a reason to write again. */
  readonly expected: CreatedPage
  readonly proposal: GuardedProposal
}

export type UncertainDetail = 'noReply' | 'running' | 'unknown'

export type CreateOutcome =
  | { readonly status: 'opened'; readonly page: CreatedPage; readonly durable: boolean }
  /** Written; not shown here because the recipe does not open it, or the pane, vault or run moved on. */
  | { readonly status: 'created'; readonly page: CreatedPage; readonly durable: boolean; readonly opened: 'notRequested' | 'notShown' }
  | { readonly status: 'notWritten'; readonly reason: NotWrittenReason }
  /** The opening's one unresolved operation; it stays the answer to Create until a query settles it. */
  | { readonly status: 'uncertain'; readonly attempt: PendingAttempt; readonly detail: UncertainDetail }
  | { readonly status: 'revoked'; readonly reason: 'workspace' | 'package' }
  | { readonly status: 'invalid'; readonly problems: readonly InputProblem[] }
  /** Closed or abandoned; nothing more is written through this opening. */
  | { readonly status: 'cancelled' }
  /** A Create or Check again of this opening is still running. */
  | { readonly status: 'busy' }
  /** Check again with no unresolved operation: there is nothing to ask about. */
  | { readonly status: 'idle' }

// --- Host seams ------------------------------------------------------------------------------------

/** The request-time destination, taken when the dialog opened. */
export interface OpenTarget {
  /** Called with the exact absolute path just before the proposal is submitted. */
  beforeWrite(path: string): void
  /**
   * The exact proposed page is on disk. The host lists it only if the run's vault is still the one
   * shown; called whether or not the page is then opened.
   */
  committed(page: CreatedPage): void
  /**
   * Shows the committed page in the reserved pane. `stillCurrent` is the run's own guard; the
   * target checks it and its pane reservation before and after anything it awaits.
   */
  open(page: CreatedPage, stillCurrent: () => boolean): Promise<boolean>
}

export interface ControllerOptions {
  api: ExtensionTransport
  hostCapabilities?: readonly Capability[]
  newId?: () => string
  /** How long leaving waits for native to confirm the session closed before reporting unconfirmed. */
  closeTimeoutMs?: number
}

const CONFIRMED: SessionBarrier = { status: 'confirmed' }
const UNCONFIRMED: SessionBarrier = { status: 'unconfirmed' }
const UNREADABLE: PackageLoad = { status: 'unreadable' }
/** A handle no native call ever sees; only for previews and input checks. */
const CHECK_HANDLE = 'preview-folder'
const LOAD_CACHE_LIMIT = 64

function withTimeout(barrier: Promise<SessionBarrier>, ms: number): Promise<SessionBarrier> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(UNCONFIRMED), ms)
    void barrier.then(result => { clearTimeout(timer); resolve(result) }, () => { clearTimeout(timer); resolve(UNCONFIRMED) })
  })
}

// --- Visits ----------------------------------------------------------------------------------------

export interface ExtensionVisit {
  readonly id: number
  readonly vaultPath: string
  /** False once leaving began; nothing more is admitted through this visit. */
  isOpen(): boolean
}

class Visit implements ExtensionVisit {
  readonly id: number
  readonly vaultPath: string
  private readonly api: ExtensionTransport
  private session: ExtensionSession | null = null
  private open = true
  constructor(id: number, vaultPath: string, api: ExtensionTransport) {
    this.id = id
    this.vaultPath = vaultPath
    this.api = api
  }
  isOpen() { return this.open }
  /** Opens the visit's session on first use; null once the visit is leaving. */
  sessionNow(): ExtensionSession | null {
    if (!this.open) return null
    this.session ??= openExtensionSession(this.api, this.vaultPath)
    return this.session
  }
  /** Native lost or never opened this session; the next run opens a fresh one for the same visit. */
  replaceSession(dead: ExtensionSession) {
    if (this.session !== dead) return
    this.session = null
    void dead.close()
  }
  close(): Promise<SessionBarrier> {
    this.open = false
    return this.session ? this.session.close() : Promise.resolve(CONFIRMED)
  }
}

// --- Controller ------------------------------------------------------------------------------------

export interface RunOpening {
  readonly visit: ExtensionVisit
  readonly runnable: RunnableCommand
}

/**
 * What one opening has written or may have written. The controller, not the form, is the
 * authority: while `pending` is set no Create allocates another invocation or operation, and once
 * `done` is set the opening never writes again.
 */
interface OpeningState {
  generation: number
  cancelled: boolean
  /** A Create or Check again is running; another call answers `busy` without asking native. */
  busy: boolean
  /** The invocation whose admission or run is in flight, so cancelling can end it by key. */
  live: { session: ExtensionSession; invocationId: string } | null
  /**
   * The immutable proposal that may have reached native, with the request-time target it would
   * open in. Kept through every unknown answer; only a definite no-write answer clears it.
   */
  pending: { attempt: PendingAttempt; target: OpenTarget; detail: UncertainDetail } | null
  /** Committed, cancelled or abandoned: the opening's final answer. */
  done: CreateOutcome | null
}

const BUSY: CreateOutcome = { status: 'busy' }
const CANCELLED: CreateOutcome = { status: 'cancelled' }

const PROPOSAL_REASONS: Record<ProposalRefusal, NotWrittenReason> = {
  staleRun: 'notStarted', handleMismatch: 'internal', operationMismatch: 'internal', digestMismatch: 'internal',
  invalidName: 'invalidName', tooLarge: 'tooLarge', link: 'link', unsupported: 'unavailable', busy: 'busy', storageUnavailable: 'storage',
}
const HANDLE_REASONS: Record<HandleRefusal, NotWrittenReason> = {
  staleRun: 'notStarted', outsideVault: 'folderMissing', missing: 'folderMissing', notFolder: 'folderMissing',
  notDocument: 'folderMissing', link: 'link', unsupported: 'unavailable',
}
const MARKDOWN_REASONS: Record<MarkdownRefusal, NotWrittenReason> = { source: 'unavailable', unsafeText: 'unsafeText', tooLarge: 'tooLarge' }

export function displayPathFor(vaultPath: string, path: string): string {
  const root = normalizeNotePathForIdentity(vaultPath)
  const normalized = normalizeNotePathForIdentity(path)
  return normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : path
}

export type ExtensionController = ReturnType<typeof createExtensionController>

export function createExtensionController(options: ControllerOptions) {
  const { api } = options
  const host = options.hostCapabilities ?? E1_HOST_CAPABILITIES
  const newId = options.newId ?? (() => crypto.randomUUID())
  const closeTimeoutMs = options.closeTimeoutMs ?? 10_000

  let visits = 0
  let visit: Visit | null = null
  /** Visits whose session close native has not confirmed; every later leave asks again for each. */
  const unsettled = new Set<Visit>()
  let snapshot: RegistrySnapshot = { status: 'idle' }
  let loads = 0
  const listeners = new Set<() => void>()
  const loadCache = new Map<string, PackageLoad>()
  const generations = new Map<string, number>()
  const openings = new WeakMap<RunOpening, OpeningState>()

  const publish = (next: RegistrySnapshot) => { snapshot = next; for (const listener of listeners) listener() }
  const generationOf = (packageId: string) => generations.get(packageId) ?? 0
  /** Open runs of this package can no longer write or open; called before any version change is sent. */
  const revokePackage = (packageId: string) => generations.set(packageId, generationOf(packageId) + 1)

  // --- Registry ---

  async function loadVersion(stored: StoredVersion, packageId: string): Promise<PackageLoad> {
    if (!stored.readable) return UNREADABLE
    const cached = loadCache.get(stored.packageSha256)
    if (cached) return cached
    const reply = await api.read({ packageSha256: stored.packageSha256 })
    if (reply?.status !== 'ok' || await sha256Hex(reply.packageText) !== stored.packageSha256) return UNREADABLE
    const parsed = parseExtensionPackage(reply.packageText)
    if (parsed.status !== 'valid' || parsed.extension.id !== packageId || parsed.extension.version !== stored.version) return UNREADABLE
    const load: PackageLoad = { status: 'ready', extension: parsed.extension, review: reviewPackage(parsed.extension, host) }
    if (loadCache.size >= LOAD_CACHE_LIMIT) loadCache.delete(loadCache.keys().next().value as string)
    loadCache.set(stored.packageSha256, load)
    return load
  }

  async function viewOf(item: Parameters<typeof toView>[0]): Promise<PackageView> {
    return toView(item, await Promise.all([
      item.activeSha256 === null ? null : loadVersion(item.versions.find(stored => stored.packageSha256 === item.activeSha256)!, item.packageId),
      candidateOf(item) ? loadVersion(candidateOf(item)!, item.packageId) : null,
    ]))
  }

  function candidateOf(item: { versions: readonly StoredVersion[]; activeSha256: string | null; previousSha256: string | null }): StoredVersion | null {
    const newest = item.versions[0]
    if (!newest || newest.packageSha256 === item.activeSha256) return null
    // While on, the rollback target is offered as Go back, not as a new review.
    if (item.activeSha256 !== null && newest.packageSha256 === item.previousSha256) return null
    return newest
  }

  function toView(item: { packageId: string; name: string; versions: readonly StoredVersion[]; activeSha256: string | null; previousSha256: string | null },
    [active, candidate]: [PackageLoad | null, PackageLoad | null]): PackageView {
    const rollbackSha = item.activeSha256 !== null && item.previousSha256 !== item.activeSha256 ? item.previousSha256 : null
    const stored = candidateOf(item)
    return {
      packageId: item.packageId, name: item.name, bundled: item.packageId.startsWith(RESERVED_PACKAGE_ID_PREFIX),
      versions: item.versions, activeSha256: item.activeSha256, previousSha256: item.previousSha256,
      active, candidate: stored && candidate ? { stored, load: candidate } : null,
      rollback: item.versions.find(version => version.packageSha256 === rollbackSha) ?? null,
    }
  }

  /** Re-reads this vault's registry; an older read finishing later never replaces a newer one. */
  async function refresh(): Promise<RegistrySnapshot> {
    const current = visit
    if (!current) { publish({ status: 'idle' }); return snapshot }
    const load = ++loads
    const vaultPath = current.vaultPath
    if (snapshot.status !== 'ready' || snapshot.vaultPath !== vaultPath) publish({ status: 'loading', vaultPath })
    const reply = await api.list({ vaultPath })
    let next: RegistrySnapshot
    if (reply === null) next = { status: 'failed', vaultPath, reason: 'noReply' }
    else if (reply.status === 'refused') next = { status: 'failed', vaultPath, reason: 'vaultUnavailable' }
    else next = { status: 'ready', vaultPath, packages: await Promise.all(reply.extensions.map(viewOf)) }
    if (load !== loads || visit !== current) return snapshot
    // Another window or a refused version change can move the active version; its open runs stop.
    if (snapshot.status === 'ready' && next.status === 'ready') {
      for (const view of next.packages) {
        const before = snapshot.packages.find(item => item.packageId === view.packageId)
        if (before && before.activeSha256 !== view.activeSha256) revokePackage(view.packageId)
      }
    }
    publish(next)
    return next
  }

  async function importText(packageText: string): Promise<ImportOutcome> {
    const parsed = parseExtensionPackage(packageText)
    if (parsed.status === 'invalid') return { status: 'invalid', diagnostics: parsed.diagnostics, truncated: parsed.truncated }
    if (parsed.extension.id.startsWith(RESERVED_PACKAGE_ID_PREFIX)) return { status: 'refused', reason: 'reservedId' }
    const reply = await api.importCandidate({ packageText })
    if (reply === null) return { status: 'noReply' }
    if (reply.status === 'invalid') return { status: 'invalid', diagnostics: reply.diagnostics, truncated: false }
    if (reply.status === 'refused') return { status: 'refused', reason: reply.reason }
    const exact = reply.packageSha256 === await sha256Hex(packageText)
      && reply.packageId === parsed.extension.id && reply.version === parsed.extension.version
    void refresh()
    if (!exact) return { status: 'noReply' }
    return { status: 'candidate', packageSha256: reply.packageSha256, extension: parsed.extension, review: reviewPackage(parsed.extension, host) }
  }

  async function change(packageId: string, send: (vaultPath: string) => Promise<ChangeOutcome>): Promise<ChangeOutcome> {
    const current = visit
    if (!current) return { status: 'refused', reason: 'vaultUnavailable', missing: [] }
    revokePackage(packageId)
    const outcome = await send(current.vaultPath)
    await refresh()
    return outcome
  }

  /** Turns one stored version on, or back on (rollback is the same call with an older version). */
  function activate(packageId: string, packageSha256: string, expectedActiveSha256: string | null): Promise<ChangeOutcome> {
    return change(packageId, async vaultPath => {
      const reply = await api.activate({ vaultPath, packageId, packageSha256, expectedActiveSha256 })
      if (reply === null) return { status: 'noReply' }
      return reply.status === 'active' ? { status: 'done' } : { status: 'refused', reason: reply.reason, missing: reply.missingCapabilities }
    })
  }

  function deactivate(packageId: string, expectedActiveSha256: string): Promise<ChangeOutcome> {
    return change(packageId, async vaultPath => {
      const reply = await api.deactivate({ vaultPath, packageId, expectedActiveSha256 })
      if (reply === null) return { status: 'noReply' }
      return reply.status === 'inactive' ? { status: 'done' } : { status: 'refused', reason: reply.reason, missing: [] }
    })
  }

  // --- Visits ---

  /** Closing is synchronous for admissions; the visit stays tracked until native confirms. */
  function closeVisit(closing: Visit): Promise<SessionBarrier> {
    unsettled.add(closing)
    return closing.close().then(result => {
      if (result.status === 'confirmed') unsettled.delete(closing)
      return result
    })
  }

  /** Begins a new visit; the one before stops admitting at once and is closed natively. */
  function enter(vaultPath: string): ExtensionVisit {
    const previous = visit
    visit = new Visit(++visits, vaultPath, api)
    if (previous) void closeVisit(previous)
    loads += 1
    publish({ status: 'idle' })
    return visit
  }

  /**
   * Stops the current visit's admissions synchronously, then waits for native to confirm that
   * session, and every earlier one still unconfirmed, closed. `unconfirmed` (no valid answer in
   * time) leaves the boundary unsettled; calling again asks native again for the same sessions.
   */
  function closeAll(targets: ReadonlySet<Visit>): Promise<SessionBarrier> {
    if (targets.size === 0) return Promise.resolve(CONFIRMED)
    const all = Promise.all([...targets].map(closeVisit))
      .then(results => (results.every(result => result.status === 'confirmed') ? CONFIRMED : UNCONFIRMED))
    return withTimeout(all, closeTimeoutMs)
  }

  function leave(): Promise<SessionBarrier> {
    const leaving = visit
    const targets = new Set(unsettled)
    if (leaving) targets.add(leaving)
    if (targets.size === 0) return Promise.resolve(CONFIRMED)
    // Shown at once: an open run dialog learns its workspace is leaving without waiting for native.
    if (leaving) publish({ ...snapshot })
    return closeAll(targets).then(result => {
      // The person may stay in this vault; it shows as blocked, not as a list that cannot run.
      if (result.status === 'unconfirmed' && leaving && visit === leaving) publish({ status: 'unsettled', vaultPath: leaving.vaultPath })
      return result
    })
  }

  /**
   * After a refused transition the person stays: a new visit of the same vault, with a fresh
   * session later. Refused while any earlier close is unconfirmed, so nothing new is admitted past
   * a barrier native has not settled. True when a new visit began.
   */
  function resume(): boolean {
    if (!visit || visit.isOpen() || unsettled.size > 0) return false
    enter(visit.vaultPath)
    return true
  }

  /** The blocked state's retry: asks native again for every unconfirmed close, then resumes once all are confirmed. */
  async function retryUnsettled(): Promise<SessionBarrier> {
    // A visit still open is not leaving; only the earlier unconfirmed closes are asked again.
    if (visit?.isOpen()) return closeAll(new Set(unsettled))
    const result = await leave()
    if (result.status === 'confirmed' && resume()) void refresh()
    return result
  }

  /** No vault is shown: the visit ends and nothing is listed until the next one begins. */
  function exit() {
    const previous = visit
    visit = null
    loads += 1
    if (previous) void closeVisit(previous)
    publish({ status: 'idle' })
  }

  // --- Runs ---

  function openRun(key: string): RunOpening | null {
    const current = visit
    const runnable = runnableCommands(snapshot).find(item => item.key === key)
    if (!current?.isOpen() || !runnable || snapshot.status !== 'ready' || snapshot.vaultPath !== current.vaultPath) return null
    const opening: RunOpening = { visit: current, runnable }
    openings.set(opening, { generation: generationOf(runnable.packageId), cancelled: false, busy: false, live: null, pending: null, done: null })
    return opening
  }

  function stateOf(opening: RunOpening): OpeningState {
    const state = openings.get(opening)
    if (!state) throw new Error('Unknown extension run opening')
    return state
  }

  /** 'workspace' once the visit is leaving; 'package' once its version changed or it was turned off. */
  function revokedReason(opening: RunOpening): 'workspace' | 'package' | null {
    if (!opening.visit.isOpen() || opening.visit !== visit) return 'workspace'
    return stateOf(opening).generation !== generationOf(opening.runnable.packageId) ? 'package' : null
  }

  /**
   * The person closed the dialog: a pending admission or run is ended by its request key and the
   * opening writes nothing more. An unresolved operation stays recorded until it is abandoned.
   */
  function cancel(opening: RunOpening) {
    const state = stateOf(opening)
    state.cancelled = true
    if (!state.pending) state.done ??= CANCELLED
    if (state.live) void state.live.session.end(state.live.invocationId)
  }

  /** What the opening answers without asking native: its final result, or its unresolved operation. */
  function settledAnswer(state: OpeningState): CreateOutcome | null {
    if (state.busy) return BUSY
    if (state.done) return state.done
    if (state.pending) return { status: 'uncertain', attempt: state.pending.attempt, detail: state.pending.detail }
    return state.cancelled ? CANCELLED : null
  }

  /** The document a Create would write now, with a handle no native call sees. */
  function check(opening: RunOpening, answers: FormAnswers) {
    const { command } = opening.runnable
    const preview = previewDocument(command, { capture: null, answers, destination: { kind: 'newInFolder', folderHandle: CHECK_HANDLE } })
    const markdown = preview.document ? buildExtensionMarkdown(preview.document, command.title) : null
    return { problems: preview.problems, markdown }
  }

  function pageFor(vaultPath: string, folder: string, fileName: string, title: string, content: string): CreatedPage {
    const relative = [normalizeVaultRelativePath(folder), fileName].filter(Boolean).join('/')
    return { path: joinVaultPath(vaultPath, relative), displayPath: relative, title, content }
  }

  /**
   * One explicit Create. Allocates a fresh run and operation only when the opening has no final
   * result and no unresolved operation: a duplicate, re-entrant or later Create after an uncertain
   * write answers that same operation and asks native nothing.
   */
  async function create(opening: RunOpening, request: { answers: FormAnswers; folder: string; target: OpenTarget }): Promise<CreateOutcome> {
    const state = stateOf(opening)
    const settled = settledAnswer(state)
    if (settled) return settled
    const revoked = revokedReason(opening)
    if (revoked) return { status: 'revoked', reason: revoked }
    const { problems, markdown } = check(opening, request.answers)
    if (problems.length > 0) return { status: 'invalid', problems }
    if (markdown?.status !== 'built') return { status: 'notWritten', reason: markdown ? MARKDOWN_REASONS[markdown.reason] : 'tooLarge' }
    state.busy = true
    try {
      return await runOnce(opening, state, request)
    } finally {
      state.busy = false
      state.live = null
    }
  }

  async function runOnce(opening: RunOpening, state: OpeningState, request: { answers: FormAnswers; folder: string; target: OpenTarget }): Promise<CreateOutcome> {
    const visitState = opening.visit as Visit
    const session = visitState.sessionNow()
    if (!session) return { status: 'revoked', reason: 'workspace' }
    const { runnable } = opening
    const folder = normalizeVaultRelativePath(request.folder)
    const invocationId = newId()
    state.live = { session, invocationId }
    const admission = await session.admit({ packageSha256: runnable.packageSha256, commandId: runnable.command.id, invocationId })
    if (admission.status !== 'admitted') {
      // A refused or unanswered admission has no run id, so no proposal can have been sent.
      if (admission.status === 'unanswered' || admission.reason === 'sessionClosed') {
        if (opening.visit.isOpen() && admission.status === 'refused') visitState.replaceSession(session)
        return admissionOutcome(opening, state, admission.status === 'refused' ? admission.reason : null)
      }
      return admissionOutcome(opening, state, admission.reason)
    }

    let bindFailure: NotWrittenReason | null = null
    let attempt: PendingAttempt | null = null
    const live = (): RunLiveness => {
      if (revokedReason(opening)) return 'revoked'
      return state.cancelled ? 'cancelled' : session.liveness(invocationId)
    }
    const effects: RunEffects = {
      liveness: live,
      async review() {
        const reply = await api.bindFolder({ runId: admission.scope.runId, folder })
        if (reply?.status !== 'bound') {
          bindFailure = reply ? HANDLE_REASONS[reply.reason] : 'notStarted'
          return { action: 'cancel' }
        }
        // The handle must name the folder the person chose, nothing else.
        if (normalizeVaultRelativePath(reply.displayPath) !== folder) {
          bindFailure = 'internal'
          return { action: 'cancel' }
        }
        return { action: 'submit', answers: request.answers, destination: { kind: 'newInFolder', folderHandle: reply.folderHandle } }
      },
      async commit(proposal): Promise<ProposalReceipt> {
        const built = proposal.write.mode === 'create' ? buildExtensionMarkdown(proposal.document, runnable.command.title) : null
        // Nothing is sent for a write this host cannot prepare; that is a proof of no write.
        if (proposal.write.mode !== 'create' || built?.status !== 'built') {
          return { status: 'refused', operationId: proposal.operationId, reason: built?.status === 'refused' && built.reason === 'tooLarge' ? 'tooLarge' : 'unsupported' }
        }
        const { markdown } = built
        const guarded: GuardedProposal = {
          kind: 'create', operationId: proposal.operationId, runId: proposal.runId, folderHandle: proposal.write.folderHandle,
          fileName: markdown.fileName, content: markdown.content, contentSha256: await sha256Hex(markdown.content),
        }
        // Ended while the digest was computed: nothing is sent, which is itself a proof of no write.
        if (live() !== 'live') return { status: 'refused', operationId: proposal.operationId, reason: 'staleRun' }
        const expected = pageFor(opening.visit.vaultPath, folder, markdown.fileName, markdown.title, markdown.content)
        try { request.target.beforeWrite(expected.path) } catch { /* Marking the watcher is advisory; the write is not. */ }
        // From here on the proposal may reach native: the opening holds it until a definite answer.
        const sent: PendingAttempt = { operationId: proposal.operationId, expected, proposal: guarded }
        attempt = sent
        state.pending = { attempt: sent, target: request.target, detail: 'noReply' }
        const receipt = await api.submitProposal(guarded) ?? { status: 'uncertain', operationId: proposal.operationId }
        if (receipt.status === 'committed') announce(request.target, sent, receipt)
        return receipt
      },
      open(receipt) {
        const page = attempt && pageFromReceipt(attempt, receipt)
        if (!page) return Promise.resolve(false)
        return request.target.open(page, () => live() === 'live')
      },
    }
    const operationId = newId()
    let outcome: RunOutcome
    try {
      outcome = await runExtensionCommand({
        extension: runnable.extension, commandId: runnable.command.id, runId: admission.scope.runId, operationId, capture: null, hostCapabilities: host,
      }, effects)
    } finally {
      // Finished, refused or uncertain, the run is released; ending joins a write already admitted.
      void session.end(invocationId)
    }
    return runOutcome(opening, state, outcome, attempt, bindFailure)
  }

  function admissionOutcome(opening: RunOpening, state: OpeningState, reason: RunAdmissionRefusal | null): CreateOutcome {
    if (reason === null) return { status: 'notWritten', reason: 'notStarted' }
    if (reason === 'cancelled' || state.cancelled) return { status: 'cancelled' }
    const revoked = revokedReason(opening)
    if (revoked) return { status: 'revoked', reason: revoked }
    switch (reason) {
      case 'sessionClosed': return { status: 'notWritten', reason: 'notStarted' }
      case 'notActive': void refresh(); return { status: 'revoked', reason: 'package' }
      case 'busy': return { status: 'notWritten', reason: 'busy' }
      case 'replayed': return { status: 'notWritten', reason: 'internal' }
      default: void refresh(); return { status: 'notWritten', reason: 'unavailable' }
    }
  }

  /** A receipt path is used only when it is the exact page proposed in this vault. */
  function pageFromReceipt(attempt: PendingAttempt, receipt: CommittedReceipt): CreatedPage | null {
    return receipt.kind === 'create' && notePathsMatch(receipt.path, attempt.expected.path) ? attempt.expected : null
  }

  function announce(target: OpenTarget, attempt: PendingAttempt, receipt: CommittedReceipt) {
    const page = pageFromReceipt(attempt, receipt)
    if (!page) return
    try { target.committed(page) } catch { /* Listing is the host's; the note is written either way. */ }
  }

  function committedPage(opening: RunOpening, attempt: PendingAttempt | null, receipt: CommittedReceipt): CreatedPage {
    return (attempt && pageFromReceipt(attempt, receipt))
      ?? { path: receipt.path, displayPath: displayPathFor(opening.visit.vaultPath, receipt.path), title: attempt?.expected.title ?? '', content: '' }
  }

  function notWritten(receipt: Extract<ProposalReceipt, { status: 'conflict' | 'refused' }>): CreateOutcome {
    if (receipt.status === 'conflict') return { status: 'notWritten', reason: receipt.reason === 'exists' ? 'exists' : 'internal' }
    return { status: 'notWritten', reason: PROPOSAL_REASONS[receipt.reason] }
  }

  function runOutcome(opening: RunOpening, state: OpeningState, outcome: RunOutcome, attempt: PendingAttempt | null, bindFailure: NotWrittenReason | null): CreateOutcome {
    switch (outcome.status) {
      case 'committed': {
        api.forget(outcome.receipt.operationId)
        state.pending = null
        const page = committedPage(opening, attempt, outcome.receipt)
        state.done = outcome.navigation === 'opened' ? { status: 'opened', page, durable: outcome.receipt.durable }
          : { status: 'created', page, durable: outcome.receipt.durable, opened: outcome.navigation === 'notRequested' ? 'notRequested' : 'notShown' }
        return state.done
      }
      case 'notWritten': {
        api.forget(outcome.receipt.operationId)
        state.pending = null
        const revoked = outcome.receipt.status === 'refused' && outcome.receipt.reason === 'staleRun' ? revokedReason(opening) : null
        if (revoked) return { status: 'revoked', reason: revoked }
        if (state.cancelled) return CANCELLED
        return notWritten(outcome.receipt)
      }
      case 'uncertain':
        // Nothing reached the submit call without a recorded attempt, so no attempt is no write.
        return state.pending ? { status: 'uncertain', attempt: state.pending.attempt, detail: state.pending.detail } : { status: 'notWritten', reason: 'notStarted' }
      case 'refused':
        return outcome.reason === 'invalidInput' ? { status: 'invalid', problems: outcome.problems } : { status: 'notWritten', reason: 'unavailable' }
      case 'cancelled':
      case 'stale': {
        if (bindFailure) return { status: 'notWritten', reason: bindFailure }
        const revoked = revokedReason(opening)
        if (revoked) return { status: 'revoked', reason: revoked }
        return state.cancelled ? { status: 'cancelled' } : { status: 'notWritten', reason: 'notStarted' }
      }
    }
  }

  /**
   * Asks about the opening's own unresolved operation again. Never writes; a definite no-write
   * answer is the only thing that lets Create start a fresh operation, and a committed answer is
   * final. Opens the recovered page only when this recipe opens its result, in the request-time
   * target, under the same guards as the first run.
   */
  async function recheck(opening: RunOpening): Promise<CreateOutcome> {
    const state = stateOf(opening)
    if (state.busy) return BUSY
    if (state.done) return state.done
    const pending = state.pending
    if (!pending) return { status: 'idle' }
    state.busy = true
    try {
      const reply = await api.queryProposal({ operationId: pending.attempt.operationId }).catch(() => null)
      if (reply === null || reply.status === 'uncertain' || reply.status === 'running' || reply.status === 'unknown') {
        const detail: UncertainDetail = reply?.status === 'running' || reply?.status === 'unknown' ? reply.status : 'noReply'
        state.pending = { ...pending, detail }
        return { status: 'uncertain', attempt: pending.attempt, detail }
      }
      api.forget(pending.attempt.operationId)
      state.pending = null
      if (reply.status !== 'committed') return notWritten(reply)
      state.done = await recovered(opening, state, pending, reply)
      return state.done
    } finally {
      state.busy = false
    }
  }

  async function recovered(opening: RunOpening, state: OpeningState, pending: NonNullable<OpeningState['pending']>, receipt: CommittedReceipt): Promise<CreateOutcome> {
    const { attempt, target } = pending
    announce(target, attempt, receipt)
    const page = committedPage(opening, attempt, receipt)
    // The same intent as an immediate reply: a recipe without openCommittedResult never navigates.
    if (!opening.runnable.review.opensResult) return { status: 'created', page, durable: receipt.durable, opened: 'notRequested' }
    const current = () => !revokedReason(opening) && !state.cancelled
    const shown = current() && pageFromReceipt(attempt, receipt) !== null && await target.open(page, current).catch(() => false)
    return shown ? { status: 'opened', page, durable: receipt.durable } : { status: 'created', page, durable: receipt.durable, opened: 'notShown' }
  }

  /**
   * The person stopped checking: whatever native did stays as it is, and this opening is retired,
   * so its uncertain operation can never turn into a fresh Create.
   */
  function abandon(opening: RunOpening) {
    const state = stateOf(opening)
    if (state.pending) api.forget(state.pending.attempt.operationId)
    state.pending = null
    state.done ??= CANCELLED
    cancel(opening)
  }

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    snapshot: () => snapshot,
    visit: (): ExtensionVisit | null => visit,
    enter, leave, resume, retryUnsettled, exit, refresh, importText, activate, deactivate,
    openRun, revokedReason, cancel, check, create, recheck, abandon,
  }
}
