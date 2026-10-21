// The browser model's E2 additions to the native extension registry: bound documents, the undo
// records a committed write may offer, and the strict readers for the undo commands. Native is the
// authority (docs/leadinglight/commentary-native.md); this model answers in the same shapes so
// browser checks meet the same refusals. Browser passes never establish native durability.
import { PROPOSAL_LIMITS, isOpaqueToken, type ProposalReceipt } from '../leadinglight/proposals/proposalContract.ts'
import {
  PROPOSAL_UNDO_COMMANDS, type ReleaseUndoReply, type UndoQueryReply, type UndoReceipt, type UndoRefusal, type UndoRequest,
} from '../leadinglight/proposals/proposalUndoContract.ts'

export const UNDO_BRIDGE_COMMANDS: readonly string[] = Object.values(PROPOSAL_UNDO_COMMANDS)

/** Native bounds (amendment 1): pinned offers and remembered consumed tokens per session, presses per process. */
export const UNDO_LIMITS = {
  offersPerSession: 16,
  consumedPerSession: 64,
  operations: 1024,
  documentsPerRun: 8,
} as const

/** A page bound to a run: its resolved place and the bytes it held then, the handle's immutable baseline. */
export interface BoundDocument {
  readonly path: string
  readonly identity: string
  readonly relative: string
}

export type DocumentLookup =
  | { readonly ok: true; readonly document: BoundDocument; readonly content: string }
  | { readonly ok: false; readonly reason: 'outsideVault' | 'missing' | 'notFolder' | 'notDocument' | 'link' | 'unsupported' }

/**
 * One guarded replacement of a whole page. `changed`: the page no longer holds the expected bytes.
 * `missing`: nothing is at the path. `moved`: the place itself changed (folder replaced, link).
 * `unavailable`: nothing was published. `uncertain`: a publication that cannot be proven either way.
 */
export type PageReplace =
  | { readonly status: 'replaced'; readonly durable: boolean }
  | { readonly status: 'changed' | 'missing' | 'moved' | 'busy' | 'unavailable' | 'uncertain' }

/** A guarded move to the vault's Trash of a page that must still hold exactly the expected bytes. */
export type PageTrash = { readonly status: 'trashed' } | { readonly status: 'changed' | 'missing' | 'busy' | 'unavailable' | 'uncertain' }

/** The effects an E2 host adds. Retained bytes are what an append Undo restores, kept before the write. */
export interface DocumentHost {
  resolveDocument(canonicalRoot: string, path: string): Promise<DocumentLookup>
  replacePage(document: BoundDocument, expectedSha256: string, content: string): Promise<PageReplace>
  trashPage(canonicalRoot: string, document: BoundDocument, expectedSha256: string): Promise<PageTrash>
  /** Keeps exactly `content` under `token` and reads it back; false when it could not be kept. */
  retain(token: string, content: string): Promise<boolean>
  /** The kept bytes, verified; null when gone or damaged. */
  readRetained(token: string): Promise<string | null>
  dropRetained(token: string): Promise<void>
}

type Fields = Record<string, unknown>
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value)
const own = (fields: Fields, key: string): unknown => (Object.hasOwn(fields, key) ? Reflect.get(fields, key) : undefined)
const SHA256 = /^[0-9a-f]{64}$/
const isSha256 = (value: unknown): value is string => typeof value === 'string' && SHA256.test(value)
const REQUEST_KEYS = ['operationId', 'sessionId', 'undoReceipt', 'kind', 'expectedSha256', 'beforeSha256']

/** Read as strictly as native's struct with denied unknown fields; null is native's `Err`. */
export function readUndoRequest(value: unknown): UndoRequest | null {
  if (!isFields(value) || Object.keys(value).length !== REQUEST_KEYS.length || !REQUEST_KEYS.every(key => Object.hasOwn(value, key))) return null
  const [operationId, sessionId, undoReceipt, kind, expectedSha256, beforeSha256] = REQUEST_KEYS.map(key => own(value, key))
  if (typeof operationId !== 'string' || typeof sessionId !== 'string' || typeof undoReceipt !== 'string') return null
  if ((kind !== 'create' && kind !== 'append') || typeof expectedSha256 !== 'string') return null
  if (beforeSha256 !== null && typeof beforeSha256 !== 'string') return null
  return { operationId, sessionId, undoReceipt, kind, expectedSha256, beforeSha256 }
}

/** What one committed write offers to undo, kept with its session while offered. */
export interface UndoRecord {
  readonly owner: string
  readonly sessionId: string
  readonly token: string
  readonly kind: 'create' | 'append'
  readonly document: BoundDocument
  readonly canonicalRoot: string
  /** The committed receipt's absolute path. */
  readonly path: string
  readonly afterSha256: string
  readonly beforeSha256: string | null
  /** A press of this token is running; release and close wait for it. */
  running: Promise<void> | null
}

interface UndoOperation { readonly owner: string; readonly digest: string; state: 'running' | UndoReceipt; readonly settled: Promise<void> }

/**
 * Undo offers and presses. A token belongs to one owner and session; `conflict` and `refused`
 * keep it, `undone` and `uncertain` consume it. Presses are an immutable ledger like proposals.
 */
export class UndoLedger {
  private readonly records = new Map<string, UndoRecord>()
  private readonly consumed = new Map<string, string[]>()
  private readonly operations = new Map<string, UndoOperation>()
  private readonly host: DocumentHost
  private readonly sha256: (text: string) => Promise<string>
  /** Operation ids proposals used; an Undo may never reuse one. */
  private readonly proposalIds: (operationId: string) => boolean

  constructor(host: DocumentHost, sha256: (text: string) => Promise<string>, proposalIds: (operationId: string) => boolean) {
    this.host = host
    this.sha256 = sha256
    this.proposalIds = proposalIds
  }

  /** Whether the session can pin one more offer; native reserves before it writes. */
  hasRoom(sessionId: string): boolean {
    return [...this.records.values()].filter(record => record.sessionId === sessionId).length < UNDO_LIMITS.offersPerSession
  }

  /** A fresh token, never reused; what an append retains is kept under it before the write. */
  newToken(): string {
    return `undo-${crypto.randomUUID()}`
  }

  /** Registers the offer of a committed write under its token. */
  register(record: Omit<UndoRecord, 'running'>): void {
    this.records.set(record.token, { ...record, running: null })
  }

  async press(owner: string, request: UndoRequest, openSession: (sessionId: string) => boolean): Promise<UndoReceipt> {
    const { operationId } = request
    const refused = (reason: UndoRefusal): UndoReceipt => ({ status: 'refused', operationId, reason })
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(operationId) || this.proposalIds(operationId)) return refused('operationMismatch')
    const digest = await this.sha256(JSON.stringify(request))
    const recorded = this.operations.get(operationId)
    if (recorded) {
      if (recorded.owner !== owner || recorded.digest !== digest) return refused('operationMismatch')
      await recorded.settled
      const after = this.operations.get(operationId)
      return after && after.state !== 'running' ? after.state : { status: 'uncertain', operationId }
    }
    if (this.operations.size >= UNDO_LIMITS.operations) return refused('busy')
    let settle: () => void = () => undefined
    const settled = new Promise<void>(resolve => { settle = resolve })
    const operation: UndoOperation = { owner, digest, state: 'running', settled }
    this.operations.set(operationId, operation)
    try {
      operation.state = await this.apply(owner, request, openSession)
    } catch {
      operation.state = { status: 'uncertain', operationId }
    }
    settle()
    return operation.state as UndoReceipt
  }

  private async apply(owner: string, request: UndoRequest, openSession: (sessionId: string) => boolean): Promise<UndoReceipt> {
    const { operationId } = request
    const refused = (reason: UndoRefusal): UndoReceipt => ({ status: 'refused', operationId, reason })
    if (!isOpaqueToken(request.sessionId) || !openSession(request.sessionId)) return refused('sessionClosed')
    if (this.consumed.get(request.sessionId)?.includes(request.undoReceipt)) return refused('consumed')
    const record = this.records.get(request.undoReceipt)
    if (!record || record.owner !== owner || record.sessionId !== request.sessionId || record.kind !== request.kind
      || record.afterSha256 !== request.expectedSha256 || record.beforeSha256 !== request.beforeSha256) return refused('unknownReceipt')
    if (record.running) return refused('busy')
    let done: () => void = () => undefined
    record.running = new Promise<void>(resolve => { done = resolve })
    try {
      const receipt = await this.undo(record, operationId)
      if (receipt.status === 'undone' || receipt.status === 'uncertain') this.consume(record)
      return receipt
    } finally {
      record.running = null
      done()
    }
  }

  private async undo(record: UndoRecord, operationId: string): Promise<UndoReceipt> {
    if (record.kind === 'create') {
      const trashed = await this.host.trashPage(record.canonicalRoot, record.document, record.afterSha256)
      switch (trashed.status) {
        case 'trashed': return { status: 'undone', operationId, kind: 'create', path: record.path }
        case 'changed': case 'missing': return { status: 'conflict', operationId, reason: trashed.status }
        case 'busy': return { status: 'refused', operationId, reason: 'busy' }
        case 'unavailable': return { status: 'refused', operationId, reason: 'storageUnavailable' }
        default: return { status: 'uncertain', operationId }
      }
    }
    const preimage = await this.host.readRetained(record.token)
    if (preimage === null || await this.sha256(preimage) !== record.beforeSha256) return { status: 'refused', operationId, reason: 'preimageUnavailable' }
    const replaced = await this.host.replacePage(record.document, record.afterSha256, preimage)
    switch (replaced.status) {
      case 'replaced': return { status: 'undone', operationId, kind: 'append', path: record.path, restoredSha256: record.beforeSha256!, durable: replaced.durable }
      case 'changed': case 'moved': return { status: 'conflict', operationId, reason: 'changed' }
      case 'missing': return { status: 'conflict', operationId, reason: 'missing' }
      case 'busy': return { status: 'refused', operationId, reason: 'busy' }
      case 'unavailable': return { status: 'refused', operationId, reason: 'storageUnavailable' }
      default: return { status: 'uncertain', operationId }
    }
  }

  private consume(record: UndoRecord) {
    this.records.delete(record.token)
    void this.host.dropRetained(record.token)
    const list = this.consumed.get(record.sessionId) ?? []
    list.push(record.token)
    while (list.length > UNDO_LIMITS.consumedPerSession) list.shift()
    this.consumed.set(record.sessionId, list)
  }

  query(owner: string, operationId: string): UndoQueryReply {
    const operation = this.operations.get(operationId)
    if (!operation || operation.owner !== owner) return { status: 'unknown', operationId }
    return operation.state === 'running' ? { status: 'running', operationId } : operation.state
  }

  /** Waits for a running press of the token, then forgets it; no page changes. */
  async release(owner: string, sessionId: string, token: string): Promise<ReleaseUndoReply> {
    const record = this.records.get(token)
    if (!record || record.owner !== owner || record.sessionId !== sessionId) return { status: 'unknown' }
    if (record.running) await record.running
    if (!this.records.has(token)) return { status: 'unknown' }
    this.records.delete(token)
    await this.host.dropRetained(token)
    return { status: 'released' }
  }

  /** A closed session's offers go once any press of them has finished. */
  async closeSession(sessionId: string): Promise<void> {
    const ours = [...this.records.values()].filter(record => record.sessionId === sessionId)
    await Promise.all(ours.map(record => record.running ?? undefined))
    for (const record of ours) {
      this.records.delete(record.token)
      await this.host.dropRetained(record.token)
    }
    this.consumed.delete(sessionId)
  }
}

/** A committed append's receipt, for the model's publication step. */
export function appendCommitted(operationId: string, path: string, beforeSha256: string, afterSha256: string, durable: boolean, undoReceipt: string): ProposalReceipt {
  return { status: 'committed', kind: 'append', operationId, path, beforeSha256, afterSha256, durable, undoReceipt }
}

export const isDocumentPath = (path: string) => path.toLowerCase().endsWith('.md') && !path.includes('\0') && path.length <= PROPOSAL_LIMITS.pathChars
export { isSha256 as isUndoDigest }
