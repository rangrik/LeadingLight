// Wire shapes of the native S0 save commands (src-tauri/src/leadinglight_history/outcome.rs).
// Pure leaf: no hooks, components or invoke, so the bridge and server can import it.

/** One save attempt, made before invoke and never changed afterwards. */
export interface OriginalRequest {
  requestId: string
  vaultPath: string
  session: string
  path: string
  seq: number
  submittedSha256: string
}

export interface DraftSnapshot { seq: number; content: string }
export interface ConfirmedSnapshot { seq: number; contentSha256: string }

export type HoldKind = 'missing' | 'linked' | 'conflict' | 'uncertain'
export interface HoldInfo { requestId: string; kind: HoldKind; seq: number; submittedSha256: string }

export type PlainRefusalReason =
  | 'outsideVault' | 'readOnly' | 'readFailed' | 'stageFailed' | 'busy' | 'requestMismatch' | 'requestVoided'
export type HoldRefusalReason = 'missing' | 'parentMissing' | 'linked' | 'symlink'

/** The page was saved but its earlier version was not kept. Null history says nothing about history. */
export interface HistoryNote { status: 'notKept'; reason: 'tooLarge' | 'full' | 'lowSpace' | 'busy' | 'unavailable' }

/** Every refusal means no publication was attempted; none certifies the bytes on disk. */
export type SaveOutcome =
  | { status: 'committed'; written: boolean; durable: boolean; history: HistoryNote | null }
  | { status: 'refused'; reason: PlainRefusalReason }
  | { status: 'refused'; reason: 'held'; heldBy: string; heldRequest: OriginalRequest; heldKind: HoldKind }
  | { status: 'refused'; reason: HoldRefusalReason; hold: HoldInfo }
  | { status: 'failed'; reason: 'publish' }
  | { status: 'conflict'; reason: 'changedDuringSave'; hold: HoldInfo }
  | { status: 'uncertain'; hold: HoldInfo; originalAt: string | null; stagedAt: string | null }

export type SaveTerminal = 'committed' | 'refused' | 'failed' | 'conflict' | 'uncertain'

export type SaveRequestState =
  | { state: 'voided' }
  | { state: 'running' }
  | { state: 'done'; outcome: SaveOutcome }
  | { state: 'retired'; terminal: SaveTerminal; resolved: boolean }
  | { state: 'mismatch' }

export type CopyRefusalReason = 'busy' | 'outsideVault' | 'nameUnavailable' | 'operationMismatch' | 'requestMismatch'

export type CopyOutcome =
  | { status: 'created'; path: string; relativePath: string; durable: boolean }
  | { status: 'folderUnavailable'; recordedFolder: string }
  | { status: 'refused'; reason: CopyRefusalReason }
  | { status: 'failed'; message: string }
  | { status: 'uncertain'; candidatePath: string | null }

export type ResolutionRefusalReason =
  | 'requestMismatch' | 'actionMismatch' | 'copyNotPublished' | 'copyNotOwned' | 'copyChanged' | 'operationMismatch' | 'busy'

export type ResolutionOutcome =
  | { status: 'resolved'; actionId: string; holdRetired: boolean; leftovers: string[] }
  | { status: 'running' }
  | { status: 'refused'; reason: ResolutionRefusalReason }

/** Lowercase hex SHA-256 of the UTF-8 bytes of an already captured string. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

type Fields = Record<string, unknown>

const HOLD_KINDS: readonly HoldKind[] = ['missing', 'linked', 'conflict', 'uncertain']
const PLAIN_REASONS: readonly PlainRefusalReason[] =
  ['outsideVault', 'readOnly', 'readFailed', 'stageFailed', 'busy', 'requestMismatch', 'requestVoided']
const HOLD_REASONS: readonly HoldRefusalReason[] = ['missing', 'parentMissing', 'linked', 'symlink']
const HISTORY_REASONS: readonly HistoryNote['reason'][] = ['tooLarge', 'full', 'lowSpace', 'busy', 'unavailable']
const TERMINALS: readonly SaveTerminal[] = ['committed', 'refused', 'failed', 'conflict', 'uncertain']
const COPY_REASONS: readonly CopyRefusalReason[] =
  ['busy', 'outsideVault', 'nameUnavailable', 'operationMismatch', 'requestMismatch']
const RESOLUTION_REASONS: readonly ResolutionRefusalReason[] =
  ['requestMismatch', 'actionMismatch', 'copyNotPublished', 'copyNotOwned', 'copyChanged', 'operationMismatch', 'busy']
const SHA256 = /^[0-9a-f]{64}$/

const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value)
const isSeq = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const isText = (value: unknown): value is string => typeof value === 'string'
const isNullableText = (value: unknown): value is string | null => value === null || typeof value === 'string'
const isOneOf = <T extends string>(options: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (options as readonly string[]).includes(value)

export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && SHA256.test(value)
}

export function parseOriginalRequest(value: unknown): OriginalRequest | null {
  if (!isFields(value)) return null
  const { requestId, vaultPath, session, path, seq, submittedSha256 } = value
  if (!isText(requestId) || !isText(vaultPath) || !isText(session) || !isText(path)) return null
  if (!isSeq(seq) || !isSha256Hex(submittedSha256)) return null
  return { requestId, vaultPath, session, path, seq, submittedSha256 }
}

function parseHoldInfo(value: unknown): HoldInfo | null {
  if (!isFields(value)) return null
  const { requestId, kind, seq, submittedSha256 } = value
  if (!isText(requestId) || !isOneOf(HOLD_KINDS, kind) || !isSeq(seq) || !isSha256Hex(submittedSha256)) return null
  return { requestId, kind, seq, submittedSha256 }
}

function parseRefusal(value: Fields): SaveOutcome | null {
  const { reason } = value
  if (isOneOf(PLAIN_REASONS, reason)) return { status: 'refused', reason }
  if (isOneOf(HOLD_REASONS, reason)) {
    const hold = parseHoldInfo(value.hold)
    return hold && { status: 'refused', reason, hold }
  }
  if (reason !== 'held' || !isText(value.heldBy) || !isOneOf(HOLD_KINDS, value.heldKind)) return null
  const heldRequest = parseOriginalRequest(value.heldRequest)
  return heldRequest && { status: 'refused', reason, heldBy: value.heldBy, heldRequest, heldKind: value.heldKind }
}

function parseCommitted(value: Fields): SaveOutcome | null {
  const { written, durable, history } = value
  if (typeof written !== 'boolean' || typeof durable !== 'boolean') return null
  if (history === null) return { status: 'committed', written, durable, history: null }
  if (!isFields(history) || history.status !== 'notKept' || !isOneOf(HISTORY_REASONS, history.reason)) return null
  return { status: 'committed', written, durable, history: { status: 'notKept', reason: history.reason } }
}

/** The outcome, or null for any other shape, which callers treat as no reply. */
export function parseSaveOutcome(value: unknown): SaveOutcome | null {
  if (!isFields(value)) return null
  switch (value.status) {
    case 'committed':
      return parseCommitted(value)
    case 'refused':
      return parseRefusal(value)
    case 'failed':
      return value.reason === 'publish' ? { status: 'failed', reason: 'publish' } : null
    case 'conflict': {
      const hold = parseHoldInfo(value.hold)
      return hold && value.reason === 'changedDuringSave' ? { status: 'conflict', reason: 'changedDuringSave', hold } : null
    }
    case 'uncertain': {
      const hold = parseHoldInfo(value.hold)
      if (!hold || !isNullableText(value.originalAt) || !isNullableText(value.stagedAt)) return null
      return { status: 'uncertain', hold, originalAt: value.originalAt, stagedAt: value.stagedAt }
    }
    default:
      return null
  }
}

export function parseSaveRequestState(value: unknown): SaveRequestState | null {
  if (!isFields(value)) return null
  switch (value.state) {
    case 'voided':
    case 'running':
    case 'mismatch':
      return { state: value.state }
    case 'done': {
      const outcome = parseSaveOutcome(value.outcome)
      return outcome && { state: 'done', outcome }
    }
    case 'retired':
      return isOneOf(TERMINALS, value.terminal) && typeof value.resolved === 'boolean'
        ? { state: 'retired', terminal: value.terminal, resolved: value.resolved }
        : null
    default:
      return null
  }
}

export function parseCopyOutcome(value: unknown): CopyOutcome | null {
  if (!isFields(value)) return null
  switch (value.status) {
    case 'created':
      return isText(value.path) && isText(value.relativePath) && typeof value.durable === 'boolean'
        ? { status: 'created', path: value.path, relativePath: value.relativePath, durable: value.durable }
        : null
    case 'folderUnavailable':
      return isText(value.recordedFolder) ? { status: 'folderUnavailable', recordedFolder: value.recordedFolder } : null
    case 'refused':
      return isOneOf(COPY_REASONS, value.reason) ? { status: 'refused', reason: value.reason } : null
    case 'failed':
      return isText(value.message) ? { status: 'failed', message: value.message } : null
    case 'uncertain':
      return isNullableText(value.candidatePath) ? { status: 'uncertain', candidatePath: value.candidatePath } : null
    default:
      return null
  }
}

export function parseResolutionOutcome(value: unknown): ResolutionOutcome | null {
  if (!isFields(value)) return null
  switch (value.status) {
    case 'resolved': {
      const { actionId, holdRetired, leftovers } = value
      if (!isText(actionId) || typeof holdRetired !== 'boolean') return null
      if (!Array.isArray(leftovers) || !leftovers.every(isText)) return null
      return { status: 'resolved', actionId, holdRetired, leftovers: [...leftovers] }
    }
    case 'running':
      return { status: 'running' }
    case 'refused':
      return isOneOf(RESOLUTION_REASONS, value.reason) ? { status: 'refused', reason: value.reason } : null
    default:
      return null
  }
}
