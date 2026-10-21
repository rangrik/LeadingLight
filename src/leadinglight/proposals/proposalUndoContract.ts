// Undo of one committed guarded proposal, version 1. A leaf beside proposalContract.ts, which it
// does not change: a committed receipt's `undoReceipt` token is what this undoes.
// Native owns every guard. Undo is a host action bound to the window and the extension session
// the write was committed in, not to its run or package: ending the run, turning the recipe off or
// rolling it back keeps it. It ends when released, once used, or when the session closes (leaving
// the vault, reloading or closing the window, or a restart).
//
// An appended page is restored to its exact earlier bytes, and a created page is moved to the
// vault's local Trash, only while the page still holds exactly the bytes that write left there.
// Before an append replaced the page, native kept those earlier bytes as an ordinary page-history
// version, verified on disk and pinned against pruning while its Undo is offered; after that the
// version stays in Page history under ordinary retention. Undo reads them back from disk, never
// from memory. The source page of a passage is never read or written by undo.
import { isOpaqueToken, PROPOSAL_LIMITS, type CommittedReceipt } from './proposalContract.ts'

export const PROPOSAL_UNDO_COMMANDS = {
  /** `{ request: UndoRequest }`, read strictly. */
  undo: 'undo_document_proposal',
  /** `{ operationId }`. Never applies or retries anything. */
  query: 'query_document_undo',
  /** `{ sessionId, undoReceipt }`. Unpins the earlier text and forgets the token; no page changes. */
  release: 'release_document_undo',
} as const

/**
 * What the UI keeps to offer Undo for one committed receipt, for as long as its notice shows,
 * including after the run and its dialog have ended. Built only by `undoOfferFor`.
 */
export interface UndoOffer {
  readonly sessionId: string
  readonly undoReceipt: string
  readonly kind: 'create' | 'append'
  /** The committed receipt's absolute page path. */
  readonly path: string
  /** The committed receipt's `afterSha256`: the bytes the page must still hold exactly. */
  readonly afterSha256: string
  /** The committed receipt's `beforeSha256`: what an append Undo restores; null for a create. */
  readonly beforeSha256: string | null
}

/** One press of Undo, on the wire. Built only by `undoRequestFor`. */
export interface UndoRequest {
  /**
   * Lowercase UUID v4, fresh for each press and never one a proposal used. Reusing it with any
   * other field is refused. After a lost reply, query it; never press again automatically.
   */
  operationId: string
  /** The session the write was committed in. */
  sessionId: string
  undoReceipt: string
  kind: 'create' | 'append'
  /** The offer's `afterSha256`. */
  expectedSha256: string
  /** The offer's `beforeSha256`; null exactly for a create. */
  beforeSha256: string | null
}

/**
 * Every refusal proves nothing was written by this request.
 * `sessionClosed`: the session is not open here, so none of its undo tokens exist any more.
 * `unknownReceipt`: no such token in this window and session for this kind and these digests,
 * for example after it was released. `consumed`: the token was already used by another request;
 * that request's own answer stands. `busy`: the page is saving, held or being changed, another
 * press of this token is still running, page history is busy, or the ledger is full.
 * `storageUnavailable`: the page's folder, disk or page history could not be prepared before
 * anything was published. `preimageUnavailable`: the kept earlier text could not be read back
 * exactly from page history (removed or damaged outside the app); the page is untouched.
 */
export const UNDO_REFUSALS = [
  'sessionClosed', 'unknownReceipt', 'consumed', 'operationMismatch', 'busy', 'storageUnavailable', 'preimageUnavailable',
] as const
export type UndoRefusal = (typeof UNDO_REFUSALS)[number]

/**
 * `undone` for an append: the page holds exactly its bytes before that append again
 * (`restoredSha256` is always the offer's `beforeSha256`), and the replaced text was kept in page
 * history first; `durable` false means written, but a sync failed. `undone` for a create: the page
 * was moved to the vault's local Trash, where Trash can restore it. `conflict` proves nothing was
 * written: `changed`, the page no longer holds exactly the bytes written (someone typed, saved or
 * replaced it since), so Undo would lose words; `missing`, nothing is at the page's path any more
 * (moved, renamed or deleted). The token stays usable after a conflict or refusal. `uncertain`
 * may already have undone the write: query it, never press again automatically; the token is used
 * either way.
 */
export type UndoReceipt =
  | { status: 'undone'; operationId: string; kind: 'append'; path: string; restoredSha256: string; durable: boolean }
  | { status: 'undone'; operationId: string; kind: 'create'; path: string }
  | { status: 'conflict'; operationId: string; reason: 'changed' | 'missing' }
  | { status: 'refused'; operationId: string; reason: UndoRefusal }
  | { status: 'uncertain'; operationId: string }

export interface UndoQueryArgs { operationId: string }
/**
 * `running`: known and not finished; ask again later. `unknown`: this process keeps no record of
 * the request, which is never proof that nothing was undone.
 */
export type UndoQueryReply =
  | UndoReceipt
  | { status: 'running'; operationId: string }
  | { status: 'unknown'; operationId: string }

export interface ReleaseUndoArgs { sessionId: string; undoReceipt: string }
/**
 * Sent once the token is gone, after any press of it still running has finished. `unknown`: no
 * such token for this window and session, so nothing is pinned for it.
 */
export type ReleaseUndoReply = { status: 'released' } | { status: 'unknown' }

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
const isPath = (value: unknown): value is string => typeof value === 'string' && value !== '' && value.length <= PROPOSAL_LIMITS.pathChars

/**
 * The offer for a receipt that `parseProposalReceipt` accepted, or null when it offers no Undo
 * (no token, or a session id that is not a token). An append offer always has its before digest.
 */
export function undoOfferFor(receipt: CommittedReceipt, sessionId: string): UndoOffer | null {
  const { undoReceipt, path, afterSha256 } = receipt
  if (!isOpaqueToken(sessionId) || !isOpaqueToken(undoReceipt) || !isPath(path) || !isSha256(afterSha256)) return null
  if (receipt.kind === 'append' && (!isSha256(receipt.beforeSha256) || receipt.beforeSha256 === afterSha256)) return null
  const offer: UndoOffer = {
    sessionId, undoReceipt, kind: receipt.kind, path, afterSha256,
    beforeSha256: receipt.kind === 'append' ? receipt.beforeSha256 : null,
  }
  return Object.freeze(offer)
}

export function undoRequestFor(offer: UndoOffer, operationId: string): UndoRequest {
  return {
    operationId, sessionId: offer.sessionId, undoReceipt: offer.undoReceipt, kind: offer.kind,
    expectedSha256: offer.afterSha256, beforeSha256: offer.beforeSha256,
  }
}

function undone(value: Fields, offer: UndoOffer, operationId: string): UndoReceipt | null {
  if (has(value, 'kind') !== offer.kind || has(value, 'path') !== offer.path) return null
  const { path } = offer
  if (offer.kind === 'create') return hasKeys(value, ['status', 'operationId', 'kind', 'path']) ? { status: 'undone', operationId, kind: 'create', path } : null
  const durable = has(value, 'durable')
  return hasKeys(value, ['status', 'operationId', 'kind', 'path', 'restoredSha256', 'durable'])
    && offer.beforeSha256 !== null && has(value, 'restoredSha256') === offer.beforeSha256 && typeof durable === 'boolean'
    ? { status: 'undone', operationId, kind: 'append', path, restoredSha256: offer.beforeSha256, durable }
    : null
}

/**
 * The reply for exactly this press of this offer, or null. `undone` must name the offer's kind and
 * path, and for an append restore exactly the offer's before digest; null means recover by query,
 * never success and never a reason to press again.
 */
export function parseUndoReceipt(value: unknown, offer: UndoOffer, operationId: string): UndoReceipt | null {
  if (!isFields(value) || has(value, 'operationId') !== operationId) return null
  const reason = has(value, 'reason')
  switch (has(value, 'status')) {
    case 'undone':
      return undone(value, offer, operationId)
    case 'conflict':
      return hasKeys(value, ['status', 'operationId', 'reason']) && (reason === 'changed' || reason === 'missing') ? { status: 'conflict', operationId, reason } : null
    case 'refused':
      return hasKeys(value, ['status', 'operationId', 'reason']) && isOneOf(UNDO_REFUSALS, reason) ? { status: 'refused', operationId, reason } : null
    case 'uncertain':
      return hasKeys(value, ['status', 'operationId']) ? { status: 'uncertain', operationId } : null
    default:
      return null
  }
}

export function parseUndoQueryReply(value: unknown, offer: UndoOffer, operationId: string): UndoQueryReply | null {
  if (!isFields(value) || has(value, 'operationId') !== operationId) return null
  const status = has(value, 'status')
  if (status === 'running' || status === 'unknown') return hasKeys(value, ['status', 'operationId']) ? { status, operationId } : null
  return parseUndoReceipt(value, offer, operationId)
}

export function parseReleaseUndoReply(value: unknown): ReleaseUndoReply | null {
  const status = isFields(value) && hasKeys(value, ['status']) ? has(value, 'status') : null
  return status === 'released' || status === 'unknown' ? { status } : null
}
