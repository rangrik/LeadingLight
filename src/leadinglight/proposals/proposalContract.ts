// Guarded document proposals, version 1: one reviewed write per extension run.
// A leaf beside ordinary autosave; OriginalRequest and the save DTOs are deliberately untouched.
// Native owns the guard: run, session and handle revalidation, one page lease, no-clobber creation.
// The first native milestone implements exclusive creation only and refuses append as `unsupported`.

export const PROPOSAL_COMMANDS = {
  submit: 'submit_document_proposal',
  query: 'query_document_proposal',
} as const

export const PROPOSAL_LIMITS = {
  /** UTF-8 bytes of encoded content. Composed text is limited to 256 KiB before encoding. */
  contentBytes: 1024 * 1024,
  /** One path segment ending in `.md`, chosen by the host from the title. */
  fileNameBytes: 255,
  /** Characters of the absolute page path in a reply. */
  pathChars: 4096,
  /** Characters of an opaque id, handle or undo token, drawn from A-Z a-z 0-9 . _ : - */
  tokenChars: 128,
} as const

const TOKEN = new RegExp(`^[A-Za-z0-9._:-]{1,${PROPOSAL_LIMITS.tokenChars}}$`)
/** Ids, handles and undo tokens mean nothing to the UI, but are always short and plain. */
export const isOpaqueToken = (value: unknown): value is string => typeof value === 'string' && TOKEN.test(value)

interface ProposalBase {
  /** Lowercase UUID v4, one per run. Reusing it with any other field is refused. */
  operationId: string
  runId: string
  /** The exact bytes the page will hold after this write. */
  content: string
  contentSha256: string
}

/** Creates `fileName` in the bound folder and never replaces an existing file. */
export interface CreateProposal extends ProposalBase {
  kind: 'create'
  folderHandle: string
  fileName: string
}

/**
 * Reserved for the commentary milestone; E1 native refuses it as `unsupported`. `content` is the
 * WHOLE reviewed postimage, built by trusted host preparation that updates the association record
 * and appends the body together; it is never a fragment for native to concatenate. Native replaces
 * exactly the page whose bytes hash to `expectedSha256` in one guarded write. A package's
 * `document.append` permission never lets it supply or replace page bytes itself.
 */
export interface AppendProposal extends ProposalBase {
  kind: 'append'
  documentHandle: string
  expectedSha256: string
}

export type GuardedProposal = CreateProposal | AppendProposal

/**
 * Every refusal is given only before publication begins, so it proves nothing was written.
 * `storageUnavailable`: the folder or disk could not be prepared or written (missing, read-only,
 * full) before anything was published. `staleRun`: the run, its session or its handle is no longer
 * admitted.
 */
export const PROPOSAL_REFUSALS = [
  'staleRun', 'handleMismatch', 'operationMismatch', 'digestMismatch', 'invalidName', 'tooLarge', 'link', 'unsupported', 'busy',
  'storageUnavailable',
] as const
export type ProposalRefusal = (typeof PROPOSAL_REFUSALS)[number]

interface CommittedBase {
  status: 'committed'
  operationId: string
  /** Absolute page path in the run's vault, host only; never given to a package. */
  path: string
  /** Always the proposal's `contentSha256`. */
  afterSha256: string
  /** False: written, but a sync failed. Never retried. */
  durable: boolean
}

/** A new page. E1 promises no undo for it; a token, if native sends one, offers nothing yet. */
export interface CreatedReceipt extends CommittedBase {
  kind: 'create'
  beforeSha256: null
  undoReceipt: string | null
}

/** A guarded replacement is reported written only together with its undo token. */
export interface AppendedReceipt extends CommittedBase {
  kind: 'append'
  beforeSha256: string
  undoReceipt: string
}

export type CommittedReceipt = CreatedReceipt | AppendedReceipt

/**
 * `conflict` and `refused` prove nothing was written. `uncertain` may already have committed: query
 * it with the same operation id and never submit again automatically.
 */
export type ProposalReceipt =
  | CommittedReceipt
  /** `exists`: the name is taken. `changed`: the page no longer has the reviewed bytes. */
  | { status: 'conflict'; operationId: string; reason: 'exists' | 'changed' }
  | { status: 'refused'; operationId: string; reason: ProposalRefusal }
  | { status: 'uncertain'; operationId: string }

/** A query never applies or retries anything. */
export interface ProposalQueryArgs { operationId: string }
/**
 * `running`: known and not finished; ask again later. `unknown`: this process keeps no record of the
 * operation, which is never proof that nothing was written.
 */
export type ProposalQueryReply =
  | ProposalReceipt
  | { status: 'running'; operationId: string }
  | { status: 'unknown'; operationId: string }

type Fields = Record<string, unknown>
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value)
const SHA256 = /^[0-9a-f]{64}$/
const isSha256 = (value: unknown): value is string => typeof value === 'string' && SHA256.test(value)
const isOneOf = <T extends string>(options: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (options as readonly string[]).includes(value)
const has = (value: Fields, key: string): unknown => (Object.hasOwn(value, key) ? value[key] : undefined)
/** Exactly these keys, so an extra or renamed field is never read as an answer. */
const hasKeys = (value: Fields, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))

const COMMITTED_KEYS = ['status', 'kind', 'operationId', 'path', 'beforeSha256', 'afterSha256', 'durable', 'undoReceipt']

function committed(value: Fields, proposal: GuardedProposal): CommittedReceipt | null {
  const path = has(value, 'path')
  const durable = has(value, 'durable')
  const undo = has(value, 'undoReceipt')
  const before = has(value, 'beforeSha256')
  if (!hasKeys(value, COMMITTED_KEYS) || has(value, 'kind') !== proposal.kind) return null
  if (typeof path !== 'string' || path === '' || path.length > PROPOSAL_LIMITS.pathChars || typeof durable !== 'boolean') return null
  if (!isSha256(has(value, 'afterSha256')) || has(value, 'afterSha256') !== proposal.contentSha256) return null
  const base = { status: 'committed', operationId: proposal.operationId, path, afterSha256: proposal.contentSha256, durable } as const
  if (proposal.kind === 'create') {
    return before === null && (undo === null || isOpaqueToken(undo)) ? { ...base, kind: 'create', beforeSha256: null, undoReceipt: undo } : null
  }
  return before === proposal.expectedSha256 && isOpaqueToken(undo) ? { ...base, kind: 'append', beforeSha256: proposal.expectedSha256, undoReceipt: undo } : null
}

/**
 * The reply for exactly this proposal, or null. A committed reply must carry the proposal's own
 * kind and digests, and an append its undo token; null means recover by query, never success and
 * never a reason to submit again.
 */
export function parseProposalReceipt(value: unknown, proposal: GuardedProposal): ProposalReceipt | null {
  if (!isFields(value) || has(value, 'operationId') !== proposal.operationId) return null
  const { operationId } = proposal
  const reason = has(value, 'reason')
  switch (has(value, 'status')) {
    case 'committed':
      return committed(value, proposal)
    case 'conflict':
      return hasKeys(value, ['status', 'operationId', 'reason']) && (reason === 'exists' || reason === 'changed') ? { status: 'conflict', operationId, reason } : null
    case 'refused':
      return hasKeys(value, ['status', 'operationId', 'reason']) && isOneOf(PROPOSAL_REFUSALS, reason) ? { status: 'refused', operationId, reason } : null
    case 'uncertain':
      return hasKeys(value, ['status', 'operationId']) ? { status: 'uncertain', operationId } : null
    default:
      return null
  }
}

export function parseProposalQueryReply(value: unknown, proposal: GuardedProposal): ProposalQueryReply | null {
  if (!isFields(value) || has(value, 'operationId') !== proposal.operationId) return null
  const status = has(value, 'status')
  if (status === 'running' || status === 'unknown') return hasKeys(value, ['status', 'operationId']) ? { status, operationId: proposal.operationId } : null
  return parseProposalReceipt(value, proposal)
}
