// Model of the native S0 save commands (m5-native-s0-api.md) for the browser bridge and the dev
// vault server. Pure: no React, hooks, invoke or Node modules; a store does the page and copy work.
import {
  isSha256Hex,
  sha256Hex,
  type ConfirmedSnapshot,
  type CopyOutcome,
  type CopyRefusalReason,
  type DraftSnapshot,
  type HistoryNote,
  type HoldInfo,
  type HoldKind,
  type HoldRefusalReason,
  type OriginalRequest,
  type PlainRefusalReason,
  type ResolutionOutcome,
  type ResolutionRefusalReason,
  type SaveOutcome,
  type SaveRequestState,
  type SaveTerminal,
} from '../leadinglight/saveOutcome.ts'
import { memoryPageHistory, type MemoryPageHistory } from './mock-history.ts'

export const SAVE_RECOVERY_COMMANDS = [
  'save_page_content',
  'check_save_outcome',
  'save_draft_as_new_page',
  'release_hold_with_copy',
  'discard_hold',
] as const
export type SaveRecoveryCommand = (typeof SAVE_RECOVERY_COMMANDS)[number]

/** Set by the dev vault server on its pages: such a page can reach a vault on disk. */
export const VAULT_API_MARKER = 'leadinglight-vault-api'

/** A malformed argument. Native answers `Err`, which the frontend treats as no reply. */
export class SaveRecoveryArgumentError extends Error {}

/** Steps 3–7 of one admitted save, as the store saw them. `history` is this save's capture note. */
export type PageWrite =
  | { status: 'committed'; written: boolean; durable: boolean; history: HistoryNote | null }
  | { status: 'refused'; reason: 'readOnly' | 'readFailed' | 'stageFailed' }
  | { status: 'hold'; reason: HoldRefusalReason }
  | { status: 'failed' }
  | { status: 'conflict' }
  | { status: 'uncertain'; originalAt: string | null; stagedAt: string | null; proof: unknown }

/** One copy request after binding, as native `copy_draft` sees it under the copy lock. */
export interface CopyJob {
  root: string
  operationId: string
  /** Digest of the binding, draft and raw folder choice; a retry must match it exactly. */
  args: string
  binding: string
  /** The copied draft's own sequence, which keep-copy must confirm; not the request's. */
  seq: number
  contentSha256: string
  folder: string | null
  page: string
  content: string
}

export interface SaveRecoveryStore {
  /** Native page target: a stable key for the page, or null when it fails vault validation. */
  pageKey(request: OriginalRequest): string | null
  writePage(request: OriginalRequest, content: string): PageWrite
  /** Re-proof of an uncertain save at check time. */
  reprove(request: OriginalRequest, proof: unknown): 'committed' | 'failed' | 'uncertain'
  rootIsUsable(root: string): boolean
  /** Creates, resumes or reports the operation's one copy; never takes an existing name. */
  copyDraft(job: CopyJob): CopyOutcome
  /** Keep-copy proof now: null only while this request's copy still holds exactly that draft. */
  verifyCopy(root: string, operationId: string, binding: string, confirmed: ConfirmedSnapshot): ResolutionRefusalReason | null
}

// Native accepts only the canonical lowercase form, so one ID never names two operations.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const REQUEST_KEYS = ['requestId', 'vaultPath', 'session', 'path', 'seq', 'submittedSha256'] as const

function fieldsOf(value: unknown, keys: readonly string[], name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SaveRecoveryArgumentError(`${name} must be an object`)
  const actual = Object.keys(value)
  if (actual.length !== keys.length || !keys.every(key => actual.includes(key))) {
    throw new SaveRecoveryArgumentError(`${name} needs exactly: ${keys.join(', ')}`)
  }
  return value as Record<string, unknown>
}
function textOf(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new SaveRecoveryArgumentError(`${name} must be a string`)
  return value
}
function seqOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new SaveRecoveryArgumentError('seq must be a non-negative integer')
  return value
}
function argsOf(args: unknown): Record<string, unknown> {
  if (typeof args !== 'object' || args === null) throw new SaveRecoveryArgumentError('missing arguments')
  return args as Record<string, unknown>
}
function requestOf(value: unknown): OriginalRequest {
  const fields = fieldsOf(value, REQUEST_KEYS, 'request')
  return {
    requestId: textOf(fields.requestId, 'requestId'),
    vaultPath: textOf(fields.vaultPath, 'vaultPath'),
    session: textOf(fields.session, 'session'),
    path: textOf(fields.path, 'path'),
    seq: seqOf(fields.seq),
    submittedSha256: textOf(fields.submittedSha256, 'submittedSha256'),
  }
}
function draftOf(value: unknown): DraftSnapshot {
  const fields = fieldsOf(value, ['seq', 'content'], 'draft')
  return { seq: seqOf(fields.seq), content: textOf(fields.content, 'content') }
}
function confirmedOf(value: unknown): ConfirmedSnapshot {
  const fields = fieldsOf(value, ['seq', 'contentSha256'], 'confirmed')
  return { seq: seqOf(fields.seq), contentSha256: textOf(fields.contentSha256, 'contentSha256') }
}

const wellFormed = (request: OriginalRequest) => UUID.test(request.requestId) && isSha256Hex(request.submittedSha256)

/** Over the six raw fields only, so binding never depends on the filesystem. */
const bindingDigest = (r: OriginalRequest) =>
  sha256Hex(JSON.stringify([r.requestId, r.vaultPath, r.session, r.path, r.seq, r.submittedSha256]))

interface Hold { kind: HoldKind; proof: unknown; leftovers: string[] }
interface ActionRecord { digest: string; result: ResolutionOutcome }
interface RequestRecord {
  request: OriginalRequest
  digest: string
  /**
   * `retired` is a finished record compacted to its terminal class. There is no `running`: a
   * write is synchronous here, so no other command can see a save in progress.
   */
  state: 'voided' | 'done' | 'retired'
  outcome: SaveOutcome | null
  terminal: SaveTerminal | null
  /** The page it ran on; null for answers given without running. */
  key: string | null
  hold: Hold | null
  actions: Map<string, ActionRecord>
}

const refused = (reason: PlainRefusalReason): SaveOutcome => ({ status: 'refused', reason })
/** A stored answer given again says nothing about history now (§7); nothing else changes. */
const stored = (outcome: SaveOutcome): SaveOutcome => (outcome.status === 'committed' ? { ...outcome, history: null } : outcome)
const copyRefused = (reason: CopyRefusalReason): CopyOutcome => ({ status: 'refused', reason })
const resolutionRefused = (reason: ResolutionRefusalReason): ResolutionOutcome => ({ status: 'refused', reason })

function written(write: PageWrite, request: OriginalRequest): [SaveOutcome, Hold | null] {
  const held = (kind: HoldKind, proof: unknown = null, leftovers: string[] = []): Hold => ({ kind, proof, leftovers })
  const info = (hold: Hold): HoldInfo =>
    ({ requestId: request.requestId, kind: hold.kind, seq: request.seq, submittedSha256: request.submittedSha256 })
  switch (write.status) {
    case 'committed': return [{ status: 'committed', written: write.written, durable: write.durable, history: write.history }, null]
    case 'refused': return [refused(write.reason), null]
    case 'failed': return [{ status: 'failed', reason: 'publish' }, null]
    case 'hold': {
      const hold = held(write.reason === 'missing' || write.reason === 'parentMissing' ? 'missing' : 'linked')
      return [{ status: 'refused', reason: write.reason, hold: info(hold) }, hold]
    }
    case 'conflict': {
      const hold = held('conflict')
      return [{ status: 'conflict', reason: 'changedDuringSave', hold: info(hold) }, hold]
    }
    case 'uncertain': {
      const kept = [write.stagedAt, write.originalAt].filter((at): at is string => at !== null && at !== request.path)
      const hold = held('uncertain', write.proof, kept)
      return [{ status: 'uncertain', hold: info(hold), originalAt: write.originalAt, stagedAt: write.stagedAt }, hold]
    }
  }
}

export type SaveRecovery = ReturnType<typeof createSaveRecovery>

/** One process's registry. Hashing happens first; every decision after it is synchronous, so commands never interleave. */
export function createSaveRecovery(store: SaveRecoveryStore) {
  const records = new Map<string, RequestRecord>()
  const holds = new Map<string, string>()
  const latest = new Map<string, string>()

  const record = (request: OriginalRequest, digest: string, state: RequestRecord['state'], outcome: SaveOutcome | null = null): RequestRecord => {
    const created: RequestRecord = { request, digest, state, outcome, terminal: outcome?.status ?? null, key: null, hold: null, actions: new Map() }
    records.set(request.requestId, created)
    return created
  }

  // A query or recovery seeing an envelope first binds it as voided, so a late save never publishes.
  function bind(request: OriginalRequest, digest: string): RequestRecord | null {
    const known = records.get(request.requestId)
    if (known) return known.digest === digest ? known : null
    return record(request, digest, 'voided')
  }

  /** Keeps the binding, terminal class and actions; drops the full answer and any hold. */
  function compact(entry: RequestRecord): void {
    if (entry.state !== 'done') return
    if (entry.key !== null && holds.get(entry.key) === entry.request.requestId) holds.delete(entry.key)
    entry.state = 'retired'
    entry.outcome = null
    entry.hold = null
  }

  function replay(entry: RequestRecord, digest: string): SaveOutcome {
    if (entry.digest !== digest) return refused('requestMismatch')
    return entry.state === 'done' && entry.outcome ? stored(entry.outcome) : refused('requestVoided')
  }

  function heldBy(key: string): SaveOutcome | null {
    const holder = records.get(holds.get(key) ?? '')
    if (holder?.state !== 'done' || !holder.hold) return null
    return { status: 'refused', reason: 'held', heldBy: holder.request.requestId, heldRequest: holder.request, heldKind: holder.hold.kind }
  }

  // Stored without a page, so neither the page's latest save nor its hold changes.
  function answered(request: OriginalRequest, digest: string, outcome: SaveOutcome): SaveOutcome {
    record(request, digest, 'done', outcome)
    return outcome
  }

  function finish(request: OriginalRequest, digest: string, key: string, [outcome, hold]: [SaveOutcome, Hold | null]): SaveOutcome {
    const entry = record(request, digest, 'done', outcome)
    entry.key = key
    entry.hold = hold
    if (hold) holds.set(key, request.requestId)
    const previous = records.get(latest.get(key) ?? '')
    latest.set(key, request.requestId)
    if (previous) compact(previous)
    return outcome
  }

  async function savePageContent(args: unknown): Promise<SaveOutcome> {
    const fields = argsOf(args)
    const request = requestOf(fields.request)
    const content = textOf(fields.content, 'content')
    // Malformed envelopes and unmatched bytes are never registered.
    if (!wellFormed(request) || await sha256Hex(content) !== request.submittedSha256) return refused('requestMismatch')
    const digest = await bindingDigest(request)
    const key = store.pageKey(request)
    const known = records.get(request.requestId)
    if (known) return replay(known, digest)
    if (key === null) return answered(request, digest, refused('outsideVault'))
    const held = heldBy(key)
    if (held) return answered(request, digest, held)
    let write: PageWrite
    try {
      write = store.writePage(request, content)
    } catch {
      // Native stores a panic in the pipeline as uncertain.
      write = { status: 'uncertain', originalAt: null, stagedAt: null, proof: null }
    }
    return finish(request, digest, key, written(write, request))
  }

  function settle(entry: RequestRecord): void {
    // Nothing is read unless the page still resolves where it was saved, inside its vault now.
    if (store.pageKey(entry.request) !== entry.key) return
    const proven = store.reprove(entry.request, entry.hold?.proof ?? null)
    if (proven === 'uncertain') return
    entry.outcome = proven === 'committed'
      ? { status: 'committed', written: true, durable: false, history: null }
      : { status: 'failed', reason: 'publish' }
    entry.terminal = entry.outcome.status
    entry.hold = null
    if (entry.key !== null && holds.get(entry.key) === entry.request.requestId) holds.delete(entry.key)
  }

  async function checkSaveOutcome(args: unknown): Promise<SaveRequestState> {
    const request = requestOf(argsOf(args).request)
    if (!wellFormed(request)) return { state: 'mismatch' }
    const entry = bind(request, await bindingDigest(request))
    if (!entry) return { state: 'mismatch' }
    if (entry.state === 'voided') return { state: 'voided' }
    const terminal = entry.terminal ?? 'refused'
    if (entry.actions.size > 0 || entry.state === 'retired' || !entry.outcome) {
      return { state: 'retired', terminal, resolved: entry.actions.size > 0 }
    }
    if (entry.outcome.status === 'uncertain' && entry.hold) settle(entry)
    return { state: 'done', outcome: stored(entry.outcome) }
  }

  async function saveDraftAsNewPage(args: unknown): Promise<CopyOutcome> {
    const fields = argsOf(args)
    const request = requestOf(fields.request)
    const draft = draftOf(fields.draft)
    const operationId = textOf(fields.operationId, 'operationId')
    const folder = fields.folder === null ? null : textOf(fields.folder, 'folder')
    if (!store.rootIsUsable(request.vaultPath)) return copyRefused('outsideVault')
    if (!wellFormed(request)) return copyRefused('requestMismatch')
    if (!UUID.test(operationId)) return copyRefused('operationMismatch')
    const binding = await bindingDigest(request)
    const contentSha256 = await sha256Hex(draft.content)
    const copyArgs = await sha256Hex(JSON.stringify([binding, draft.seq, contentSha256, folder]))
    if (!bind(request, binding)) return copyRefused('requestMismatch')
    try {
      return store.copyDraft({
        root: request.vaultPath, operationId, args: copyArgs, binding, seq: draft.seq, contentSha256, folder, page: request.path, content: draft.content,
      })
    } catch {
      // A copy step that broke without an answer may already have published.
      return { status: 'uncertain', candidatePath: null }
    }
  }

  async function resolve(kind: 'copy' | 'discard', args: unknown): Promise<ResolutionOutcome> {
    const fields = argsOf(args)
    const request = requestOf(fields.request)
    const actionId = textOf(fields.actionId, 'actionId')
    const confirmed = confirmedOf(fields.confirmed)
    const operationId = kind === 'copy' ? textOf(fields.operationId, 'operationId') : null
    // An unreachable vault cannot prove a copy, so nothing is recorded.
    if (operationId !== null && !store.rootIsUsable(request.vaultPath)) return resolutionRefused('busy')
    if (!wellFormed(request)) return resolutionRefused('requestMismatch')
    if (operationId !== null && !UUID.test(operationId)) return resolutionRefused('operationMismatch')
    if (!UUID.test(actionId) || !isSha256Hex(confirmed.contentSha256)) return resolutionRefused('actionMismatch')
    const binding = await bindingDigest(request)
    const actionDigest = await sha256Hex(JSON.stringify([kind, binding, confirmed.seq, confirmed.contentSha256, operationId ?? '']))
    const entry = bind(request, binding)
    if (!entry) return resolutionRefused('requestMismatch')
    // Rechecked on an exact retry too: a stored result never outlives the copy's proof.
    let unproven: ResolutionRefusalReason | null = null
    if (operationId !== null) {
      try {
        unproven = store.verifyCopy(request.vaultPath, operationId, binding, confirmed)
      } catch {
        unproven = 'copyNotPublished'
      }
    }
    const prior = entry.actions.get(actionId)
    if (prior && prior.digest !== actionDigest) return resolutionRefused('actionMismatch')
    if (unproven) return resolutionRefused(unproven)
    if (prior) return prior.result
    const hold = entry.state === 'done' ? entry.hold : null
    const result: ResolutionOutcome = { status: 'resolved', actionId, holdRetired: hold !== null, leftovers: hold ? [...hold.leftovers] : [] }
    entry.actions.set(actionId, { digest: actionDigest, result })
    compact(entry)
    return result
  }

  return {
    savePageContent,
    checkSaveOutcome,
    saveDraftAsNewPage,
    releaseHoldWithCopy: (args: unknown) => resolve('copy', args),
    discardHold: (args: unknown) => resolve('discard', args),
    /** Page keys with a live hold; native refuses other mutations of these pages. */
    heldKeys: (): string[] => [...holds.keys()],
  }
}

export function runSaveRecoveryCommand(recovery: SaveRecovery, command: SaveRecoveryCommand, args: unknown): Promise<unknown> {
  switch (command) {
    case 'save_page_content': return recovery.savePageContent(args)
    case 'check_save_outcome': return recovery.checkSaveOutcome(args)
    case 'save_draft_as_new_page': return recovery.saveDraftAsNewPage(args)
    case 'release_hold_with_copy': return recovery.releaseHoldWithCopy(args)
    case 'discard_hold': return recovery.discardHold(args)
  }
}

export interface MemoryPages {
  read: (path: string) => string | undefined
  write: (path: string, content: string) => void
}

const trimSlash = (value: string) => value.replace(/\/+$/, '')
const parentOf = (page: string) => page.slice(0, Math.max(page.lastIndexOf('/'), 0)) || '/'
const hasParentStep = (target: string) => target.split('/').includes('..')
function copyName(page: string, index: number): string {
  const name = page.slice(page.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `${name.slice(0, dot)}-${index}${name.slice(dot)}` : `${name}-${index}`
}

/**
 * The in-memory mock vault. Its pages have no links, modes, folders or staging, so only missing
 * pages hold, every write is durable, and a copy never asks for another folder.
 * `homes` are the mock's own roots, which count as inside any memory vault.
 * `history` keeps earlier versions of these pages; a save it could not keep answers its note.
 */
export function memoryStore(pages: MemoryPages, homes: readonly string[] = [], history: MemoryPageHistory = memoryPageHistory): SaveRecoveryStore {
  history.usePages(pages, homes)
  const encoder = new TextEncoder()
  const copies = new Map<string, CopyJob & { path: string }>()
  const copyKey = (root: string, operationId: string) => `${trimSlash(root)}\n${operationId}`
  const homeOf = (root: string, target: string) => [root, ...homes].map(trimSlash)
    .find(home => home.startsWith('/') && (target === home || target.startsWith(`${home}/`)))
  const created = (home: string, path: string): CopyOutcome =>
    ({ status: 'created', path, relativePath: path.slice(home.length + 1), durable: true })
  return {
    pageKey: ({ vaultPath, path }) => (!hasParentStep(path) && homeOf(vaultPath, parentOf(path)) ? path : null),
    writePage(request, content) {
      const current = pages.read(request.path)
      if (current === undefined) return { status: 'hold', reason: 'missing' }
      if (current === content) return { status: 'committed', written: false, durable: true, history: null }
      // Optional and never the save's outcome (S1a §2); only its note rides along.
      const after = encoder.encode(content)
      const note = history.capture({ vaultPath: request.vaultPath, page: request.path, before: encoder.encode(current), after })
      pages.write(request.path, content)
      history.committed({ vaultPath: request.vaultPath, page: request.path, after })
      return { status: 'committed', written: true, durable: true, history: note }
    },
    reprove: () => 'uncertain',
    rootIsUsable: root => trimSlash(root).startsWith('/'),
    copyDraft(job) {
      const recorded = copies.get(copyKey(job.root, job.operationId))
      if (recorded) {
        if (recorded.args !== job.args) return { status: 'refused', reason: 'operationMismatch' }
        const home = homeOf(job.root, recorded.path)
        return home && pages.read(recorded.path) !== undefined ? created(home, recorded.path) : { status: 'uncertain', candidatePath: recorded.path }
      }
      const folder = trimSlash(job.folder === null ? parentOf(job.page) : job.folder.startsWith('/') ? job.folder : `${trimSlash(job.root)}/${job.folder}`)
      const home = hasParentStep(folder) ? undefined : homeOf(job.root, folder)
      if (!home || folder.split('/').some(part => part.startsWith('.leadinglight'))) return { status: 'refused', reason: 'outsideVault' }
      for (let index = 2; index <= 101; index += 1) {
        const path = `${folder}/${copyName(job.page, index)}`
        if (pages.read(path) !== undefined) continue
        pages.write(path, job.content)
        copies.set(copyKey(job.root, job.operationId), { ...job, path })
        return created(home, path)
      }
      return { status: 'refused', reason: 'nameUnavailable' }
    },
    verifyCopy(root, operationId, binding, confirmed) {
      const copy = copies.get(copyKey(root, operationId))
      if (!copy) return 'copyNotPublished'
      if (copy.binding !== binding) return 'operationMismatch'
      const current = pages.read(copy.path)
      if (current === undefined) return 'copyNotOwned'
      const sameDraft = copy.seq === confirmed.seq && copy.contentSha256 === confirmed.contentSha256
      return sameDraft && current === copy.content ? null : 'copyChanged'
    },
  }
}
