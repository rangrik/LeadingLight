// Transport contract between the UI and the native extension registry, version 1, plus the one
// session gate the UI uses to call it in the right order. Native implements the commands; the UI
// receives an ExtensionApi. Every id and handle is opaque here and revalidated natively; a package
// id or command id taken from package text is never authority by itself.
import { isOpaqueToken, type GuardedProposal, type ProposalQueryArgs, type ProposalQueryReply, type ProposalReceipt } from '../proposals/proposalContract.ts'
import type { ReleaseUndoArgs, ReleaseUndoReply, UndoOffer, UndoQueryArgs, UndoQueryReply, UndoReceipt, UndoRequest } from '../proposals/proposalUndoContract.ts'
import type { Capability, ExtensionDiagnostic, RunLiveness } from './extensionContract'

export const EXTENSION_COMMANDS = {
  importCandidate: 'import_extension_candidate',
  list: 'list_extensions',
  read: 'read_extension_package',
  activate: 'activate_extension_version',
  deactivate: 'deactivate_extension',
  openSession: 'open_extension_session',
  closeSession: 'close_extension_session',
  beginRun: 'begin_extension_run',
  endRun: 'end_extension_run',
  bindFolder: 'bind_extension_folder',
  bindDocument: 'bind_extension_document',
} as const
export type ExtensionCommandName = (typeof EXTENSION_COMMANDS)[keyof typeof EXTENSION_COMMANDS]

// --- Candidates and versions -----------------------------------------------------------------------

/** Native revalidates and stores the exact bytes under their SHA-256. Import never activates. */
export interface ImportCandidateArgs { packageText: string }
export type ImportCandidateReply =
  | { status: 'candidate'; packageSha256: string; packageId: string; version: string; missingCapabilities: Capability[] }
  | { status: 'invalid'; diagnostics: ExtensionDiagnostic[] }
  /** `reservedId`: only bundled packages may use the reserved id prefix. */
  | { status: 'refused'; reason: 'reservedId' | 'storageUnavailable' }

export interface ListExtensionsArgs { vaultPath: string }
export interface StoredVersion {
  packageSha256: string
  version: string
  /** False when the stored bytes no longer match their hash or schema; such a version stays off. */
  readable: boolean
}
export interface InstalledExtension {
  packageId: string
  name: string
  /** Newest import first. */
  versions: StoredVersion[]
  /** For this vault; null when off. */
  activeSha256: string | null
  /** The version active before the current one: the target of a behaviour rollback. */
  previousSha256: string | null
}
export type ExtensionListReply =
  | { status: 'ok'; extensions: InstalledExtension[] }
  | { status: 'refused'; reason: 'vaultUnavailable' }

/** The stored text, which the UI validates again before it shows commands or previews. */
export interface ReadExtensionArgs { packageSha256: string }
export type ReadExtensionReply = { status: 'ok'; packageText: string } | { status: 'unreadable' | 'unknown' }

// --- Activation, deactivation and version rollback -------------------------------------------------

export const ACTIVATION_REFUSALS = [
  'unknownVersion', 'unreadable', 'invalid', 'missingCapabilities', 'reservedId', 'changed', 'vaultUnavailable',
] as const
export type ActivationRefusal = (typeof ACTIVATION_REFUSALS)[number]

/**
 * Turns one stored version on for one vault. Rolling back is activating an older stored version;
 * it restores behaviour only, never note content. Compare-and-set: `changed` when the active
 * version is not `expectedActiveSha256`.
 */
export interface ActivateArgs { vaultPath: string; packageId: string; packageSha256: string; expectedActiveSha256: string | null }
export type ActivationReply =
  /** Runs of the replaced version are revoked. */
  | { status: 'active'; packageSha256: string; previousSha256: string | null; revokedRuns: number }
  | { status: 'refused'; reason: ActivationRefusal; missingCapabilities: Capability[] }

/** Removes contributions and revokes runs; notes the package created stay ordinary notes. */
export interface DeactivateArgs { vaultPath: string; packageId: string; expectedActiveSha256: string }
export type DeactivationReply =
  | { status: 'inactive'; revokedRuns: number }
  | { status: 'refused'; reason: 'changed' | 'vaultUnavailable' }

// --- Sessions and runs -----------------------------------------------------------------------------
//
// The session protocol, frozen:
// 1. openSession: one per vault visit in one window. Its id is fresh, opaque and never issued again;
//    returning to a vault opens a new session. Identity never comes from a path.
// 2. beginRun needs an open session id. Native admits nothing for a closed or unknown session.
// 3. endRun is keyed by the request-time {sessionId, invocationId}, so a run whose admission reply is
//    late or lost can still be ended. Native keeps the key as a tombstone for the session's life: a
//    later beginRun with it is refused `cancelled`. Ending revokes the run and its handles, then
//    joins a write already admitted to publication. Repeating it is harmless.
// 4. closeSession marks the session closed first, then revokes its pending admissions, runs and
//    handles, then joins writes already admitted to publication, then answers. Repeating it is
//    harmless; a closed id never reopens. Native also closes every session of a window that closes
//    or reloads.
// 5. Only a valid close or end answer proves the boundary. A lost, failed or malformed answer
//    proves nothing: the caller keeps admissions off, does not leave the vault as if settled, and
//    asks again with the same session id or key (see SessionBarrier).
// 6. A write that committed stays committed after any of these; it is reported, never retried.
//    An uncertain write stays uncertain and is queried, never resubmitted.

export interface OpenSessionArgs { vaultPath: string }
export type OpenSessionReply = { status: 'open'; sessionId: string } | { status: 'refused'; reason: 'vaultUnavailable' }

export interface CloseSessionArgs { sessionId: string }
/**
 * Sent only after revocation and the join are complete. `unknown`: no such session in the answering
 * native process (for example after a restart), so no work of it is active there; it proves
 * nothing about writes committed earlier, which keep their own status.
 */
export type CloseSessionReply = { status: 'closed' | 'unknown' }

/** `invocationId`: a fresh UUID per person's request. */
export interface BeginRunArgs { sessionId: string; packageSha256: string; commandId: string; invocationId: string }
/** Native binds the run to this session, exact package version, command and request. */
export interface RunScope { runId: string; sessionId: string; invocationId: string; packageId: string; packageSha256: string; commandId: string }
/**
 * `sessionClosed`: no open session (closed, unknown or never opened). `cancelled`: the request's key
 * was ended first. `replayed`: the invocation id was already used in this session.
 */
export const RUN_REFUSALS = ['sessionClosed', 'cancelled', 'replayed', 'notActive', 'unknownCommand', 'missingCapabilities', 'unreadable', 'busy'] as const
export type RunAdmissionRefusal = (typeof RUN_REFUSALS)[number]
export type RunAdmission = { status: 'admitted'; scope: RunScope } | { status: 'refused'; reason: RunAdmissionRefusal }

export interface EndRunArgs { sessionId: string; invocationId: string }
/**
 * Sent only after the key is tombstoned and any admitted write is joined. `ended` also when the
 * key was never admitted. `unknownSession`: no such session in the answering process, as above.
 */
export type EndRunReply = { status: 'ended' | 'unknownSession' }

export const HANDLE_REFUSALS = ['staleRun', 'outsideVault', 'missing', 'notFolder', 'notDocument', 'link', 'unsupported'] as const
export type HandleRefusal = (typeof HANDLE_REFUSALS)[number]

/** The person's folder choice from host controls; `folder` is vault-relative, '' for the root. */
export interface BindFolderArgs { runId: string; folder: string }
export type FolderHandleReply =
  | { status: 'bound'; folderHandle: string; displayPath: string }
  | { status: 'refused'; reason: HandleRefusal }

/** An existing page the person chose or the host resolved. Append milestone; E1 answers `unsupported`. */
export interface BindDocumentArgs { runId: string; path: string }
export type DocumentHandleReply =
  | { status: 'bound'; documentHandle: string; displayPath: string; contentSha256: string }
  | { status: 'refused'; reason: HandleRefusal }

// --- The injected surface --------------------------------------------------------------------------

/**
 * Native in the desktop app; a synthetic in-memory implementation for previews and browser tests.
 * Every call answers null when no usable reply came back; null is never read as an outcome.
 * After a null from `submitProposal`, ask `queryProposal` with the same operation id.
 */
export interface ExtensionApi {
  importCandidate(args: ImportCandidateArgs): Promise<ImportCandidateReply | null>
  list(args: ListExtensionsArgs): Promise<ExtensionListReply | null>
  read(args: ReadExtensionArgs): Promise<ReadExtensionReply | null>
  activate(args: ActivateArgs): Promise<ActivationReply | null>
  deactivate(args: DeactivateArgs): Promise<DeactivationReply | null>
  openSession(args: OpenSessionArgs): Promise<OpenSessionReply | null>
  closeSession(args: CloseSessionArgs): Promise<CloseSessionReply | null>
  beginRun(args: BeginRunArgs): Promise<RunAdmission | null>
  endRun(args: EndRunArgs): Promise<EndRunReply | null>
  bindFolder(args: BindFolderArgs): Promise<FolderHandleReply | null>
  bindDocument(args: BindDocumentArgs): Promise<DocumentHandleReply | null>
  submitProposal(proposal: GuardedProposal): Promise<ProposalReceipt | null>
  queryProposal(args: ProposalQueryArgs): Promise<ProposalQueryReply | null>
  /** One press of Undo; the reply is read against the offer it was pressed for. */
  undoProposal(request: UndoRequest, offer: UndoOffer): Promise<UndoReceipt | null>
  /** Asks about a press whose reply was lost; never applies anything. */
  queryUndo(args: UndoQueryArgs, offer: UndoOffer): Promise<UndoQueryReply | null>
  /** Gives up an Undo that is no longer offered, so native unpins what it kept for it. */
  releaseUndo(args: ReleaseUndoArgs): Promise<ReleaseUndoReply | null>
}

// --- Reading session replies -----------------------------------------------------------------------

type Fields = Record<string, unknown>
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value)
const has = (value: Fields, key: string): unknown => (Object.hasOwn(value, key) ? value[key] : undefined)
const hasKeys = (value: Fields, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))

export function parseOpenSessionReply(value: unknown): OpenSessionReply | null {
  if (!isFields(value)) return null
  const sessionId = has(value, 'sessionId')
  if (has(value, 'status') === 'open') return hasKeys(value, ['status', 'sessionId']) && isOpaqueToken(sessionId) ? { status: 'open', sessionId } : null
  return hasKeys(value, ['status', 'reason']) && has(value, 'status') === 'refused' && has(value, 'reason') === 'vaultUnavailable'
    ? { status: 'refused', reason: 'vaultUnavailable' }
    : null
}

export function parseCloseSessionReply(value: unknown): CloseSessionReply | null {
  const status = isFields(value) && hasKeys(value, ['status']) ? has(value, 'status') : null
  return status === 'closed' || status === 'unknown' ? { status } : null
}

export function parseEndRunReply(value: unknown): EndRunReply | null {
  const status = isFields(value) && hasKeys(value, ['status']) ? has(value, 'status') : null
  return status === 'ended' || status === 'unknownSession' ? { status } : null
}

const SCOPE_KEYS = ['runId', 'sessionId', 'invocationId', 'packageId', 'packageSha256', 'commandId']

/** An admission must echo this request exactly; anything else is no reply. */
export function parseRunAdmission(value: unknown, args: BeginRunArgs): RunAdmission | null {
  if (!isFields(value)) return null
  const reason = has(value, 'reason')
  if (has(value, 'status') === 'refused') {
    return hasKeys(value, ['status', 'reason']) && typeof reason === 'string' && (RUN_REFUSALS as readonly string[]).includes(reason)
      ? { status: 'refused', reason: reason as RunAdmissionRefusal }
      : null
  }
  const scope = has(value, 'scope')
  if (has(value, 'status') !== 'admitted' || !hasKeys(value, ['status', 'scope']) || !isFields(scope) || !hasKeys(scope, SCOPE_KEYS)) return null
  const { runId, packageId } = scope
  const echoes = scope.sessionId === args.sessionId && scope.invocationId === args.invocationId
    && scope.packageSha256 === args.packageSha256 && scope.commandId === args.commandId
  if (!echoes || !isOpaqueToken(runId) || !isOpaqueToken(packageId)) return null
  return { status: 'admitted', scope: { runId, sessionId: args.sessionId, invocationId: args.invocationId, packageId, packageSha256: args.packageSha256, commandId: args.commandId } }
}

// --- The session gate ------------------------------------------------------------------------------

export interface AdmitRequest { packageSha256: string; commandId: string; invocationId: string }

/**
 * Whether native has proved that no work of the session (or key) is still running or can start.
 * `confirmed`: a valid close or end answer for this exact session or key, or no session id was
 * ever obtained, so nothing could have been admitted through it. It says nothing about writes that
 * already committed or are uncertain; those keep their own status and are never retried.
 * `unconfirmed`: no proof. The boundary is NOT settled; ask again with the same call.
 */
export type SessionBarrier = { status: 'confirmed' } | { status: 'unconfirmed' }

export type Admission =
  | { status: 'admitted'; scope: RunScope }
  | { status: 'refused'; reason: RunAdmissionRefusal }
  /** No usable reply, so no run id is known. `end` says whether native confirmed ending its key. */
  | { status: 'unanswered'; end: SessionBarrier }

/** One vault visit's admission context. Make one per visit, never per path, and close it on leaving. */
export interface ExtensionSession {
  /** Asks native only after this session's open reply, and never once close has begun. */
  admit(request: AdmitRequest): Promise<Admission>
  /**
   * Ends a run by its request-time key, whether or not its admission reply has arrived. Liveness
   * turns `cancelled` at once. Once close has begun, this is the session's close barrier.
   */
  end(invocationId: string): Promise<SessionBarrier>
  /** For RunEffects.liveness: `revoked` once close begins, `cancelled` once the run is ended. */
  liveness(invocationId: string): RunLiveness
  /**
   * The native session id once its open reply arrived, else null. An Undo offer names it, since
   * native binds every undo token to the session its write committed in.
   */
  id(): string | null
  /**
   * Stops admissions at once, then closes natively, waiting for the open reply if it is late.
   * Leave the vault only after `confirmed`. A confirmed result is kept; `unconfirmed` is not, and
   * calling again asks native again for the same session.
   */
  close(): Promise<SessionBarrier>
}

type SessionApi = Pick<ExtensionApi, 'openSession' | 'closeSession' | 'beginRun' | 'endRun'>

/** A rejected call is no reply. */
const settled = <T>(reply: Promise<T | null>): Promise<T | null> => reply.catch(() => null)
const CONFIRMED: SessionBarrier = { status: 'confirmed' }
const UNCONFIRMED: SessionBarrier = { status: 'unconfirmed' }
const barrier = (proved: boolean): SessionBarrier => (proved ? CONFIRMED : UNCONFIRMED)

export function openExtensionSession(api: SessionApi, vaultPath: string): ExtensionSession {
  let closed = false
  let closeConfirmed = false
  let closeAttempt: Promise<SessionBarrier> | null = null
  const ended = new Set<string>()
  let openedId: string | null = null
  const opened = settled(api.openSession({ vaultPath })).then(reply => {
    const parsed = parseOpenSessionReply(reply)
    openedId = parsed?.status === 'open' ? parsed.sessionId : null
    return openedId
  })
  const refused = (reason: RunAdmissionRefusal): Admission => ({ status: 'refused', reason })
  const blocked = (invocationId: string): Admission | null =>
    closed ? refused('sessionClosed') : ended.has(invocationId) ? refused('cancelled') : null

  /** Without a session id, no beginRun was ever sent, so nothing can be running; no native cleanup is claimed. */
  async function askClose(): Promise<SessionBarrier> {
    const sessionId = await opened
    if (sessionId === null) return CONFIRMED
    return barrier(parseCloseSessionReply(await settled(api.closeSession({ sessionId }))) !== null)
  }

  function close(): Promise<SessionBarrier> {
    closed = true
    if (closeConfirmed) return Promise.resolve(CONFIRMED)
    closeAttempt ??= askClose().then(result => {
      closeAttempt = null
      closeConfirmed = result.status === 'confirmed'
      return result
    })
    return closeAttempt
  }

  async function end(invocationId: string): Promise<SessionBarrier> {
    ended.add(invocationId)
    const sessionId = await opened
    if (sessionId === null) return CONFIRMED
    if (closed) return close()
    return barrier(parseEndRunReply(await settled(api.endRun({ sessionId, invocationId }))) !== null)
  }

  return {
    async admit(request) {
      const early = blocked(request.invocationId)
      if (early) return early
      const sessionId = await opened
      if (sessionId === null) return refused('sessionClosed')
      const beforeAsking = blocked(request.invocationId)
      if (beforeAsking) return beforeAsking
      const args = { sessionId, ...request }
      const reply = parseRunAdmission(await settled(api.beginRun(args)), args)
      const afterReply = blocked(request.invocationId)
      if (afterReply) return afterReply
      if (reply !== null) return reply
      return { status: 'unanswered', end: await end(request.invocationId) }
    },
    end,
    liveness(invocationId) {
      return closed ? 'revoked' : ended.has(invocationId) ? 'cancelled' : 'live'
    },
    id: () => openedId,
    close,
  }
}
