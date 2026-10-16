import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SetStateAction } from 'react'
import { checkSaveOutcome, discardHold, releaseHoldWithCopy, saveDraftAsNewPage, useSaveNote } from './useSaveNote'
import { cacheNoteContent } from './useTabManagement'
import { createTranslator, type AppLocale, type TranslationKey } from '../lib/i18n'
import { canWritePathToVault, isPathInsideVaultRoot } from '../utils/vaultPathContainment'
import {
  sha256Hex,
  type CopyOutcome, type HoldInfo, type HoldKind, type OriginalRequest, type ResolutionRefusalReason, type SaveOutcome,
} from '../leadinglight/saveOutcome'
import { errorMessage } from '../utils/vaultErrors'
import type { VaultEntry } from '../types'

interface Tab {
  entry: VaultEntry
  content: string
}

interface EditorSaveConfig {
  updateVaultContent: (path: string, content: string) => void
  setTabs: (fn: SetStateAction<Tab[]>) => void
  setToastMessage: (msg: string | null) => void
  onAfterSave?: () => void
  /** Called immediately before content is persisted to disk. */
  onBeforePersist?: (path: string) => void
  /** Called after content is persisted — used to clear unsaved state and live-reload themes. */
  onNotePersisted?: (path: string, content: string) => void
  /** Resolve stale paths (for example after a note rename) before persisting buffered content. */
  resolvePath?: (path: string) => string
  /** Wait for an in-flight path change to settle before persisting buffered content. */
  resolvePathBeforeSave?: (path: string) => Promise<string>
  /** False when editor state is present but no vault is available to receive writes. */
  canPersist?: boolean
  /** Clears pending debounced content when the persistence target changes. */
  persistenceScope?: string | readonly string[]
  disabledSaveMessage?: string
  locale?: AppLocale
  /** Pending text was given a document change it missed; derived metadata must follow it. */
  onContentRebased?: (path: string, content: string) => void
}

export type MutationRefusal =
  | 'closing' | 'noVault' | 'outsideVault' | 'trash' | 'busy' | 'renaming' | 'invalidFrontmatter'

/** One change to an existing page that runs alone in the page's write lane. */
export interface DocumentMutation<R> {
  publish: (path: string) => Promise<R>
  /** The page's content for every committed result, written or already in that state. */
  committedContent: (result: R) => string | null
  /** The same change applied to newer text; null when that text cannot take it. */
  rebase: (content: string) => string | null
  /** Synchronously pushes the page's rich and raw editor buffers into the save queue. */
  flushBuffers?: (path: string) => void
}

export type MutationIntegration = 'none' | 'rebased' | 'unmergedDraft'

export type MutationSettled<R> =
  | { kind: 'notRun'; path: string; error: unknown; current: boolean }
  | { kind: 'returned'; path: string; result: R; current: boolean; integration: MutationIntegration; latest: string | null }
  | { kind: 'unknown'; path: string; error: unknown; current: boolean }

export type MutationAdmission<R> =
  | { admitted: false; reason: MutationRefusal }
  | { admitted: true; path: string; done: Promise<MutationSettled<R>> }

/** A page's newest text still can't take a committed change, so it must not be saved yet. */
export class UnmergedDraftError extends Error {
  readonly path: string

  constructor(path: string) {
    super(`The page's latest edits are not saved yet: ${path}`)
    this.name = 'UnmergedDraftError'
    this.path = path
  }
}

/** The page's text waits for an explicit recovery choice, so ordinary saving stops before invoke. */
export class SaveHeldError extends Error {
  readonly path: string
  readonly requestId: string | null

  constructor(path: string, requestId: string | null) {
    super('This page has unsaved text that needs a recovery choice.')
    this.name = 'SaveHeldError'
    this.path = path
    this.requestId = requestId
  }
}

export type SaveRefusalReason =
  | 'readOnly' | 'readFailed' | 'stageFailed' | 'busy' | 'publish' | 'held' | 'requestMismatch' | 'requestVoided' | 'noVault'

const REFUSAL_MESSAGES: Record<Exclude<SaveRefusalReason, 'noVault'>, string> = {
  readOnly: 'The file is read-only.',
  readFailed: "The file couldn't be read.",
  stageFailed: "The new text couldn't be prepared on disk.",
  busy: 'The page is busy. Try again in a moment.',
  publish: "The file couldn't be replaced. It wasn't changed.",
  held: 'Another save is holding this page.',
  requestMismatch: 'The save request was refused.',
  requestVoided: 'The save request was refused.',
}

/** The person-facing wording for each refusal; the error message itself stays English for logs. */
export const SAVE_REFUSAL_KEYS: Record<Exclude<SaveRefusalReason, 'noVault'>, TranslationKey> = {
  readOnly: 'save.refused.readOnly',
  readFailed: 'save.refused.readFailed',
  stageFailed: 'save.refused.stageFailed',
  busy: 'save.refused.busy',
  publish: 'save.refused.publish',
  held: 'save.refused.held',
  requestMismatch: 'save.refused.request',
  requestVoided: 'save.refused.request',
}

/** Nothing was published; the text stays pending, and the next edit or Save tries again. */
export class SaveRefusedError extends Error {
  readonly path: string
  readonly reason: SaveRefusalReason

  constructor(path: string, reason: SaveRefusalReason) {
    super(reason === 'noVault' ? MISSING_ACTIVE_VAULT_SAVE_MESSAGE : REFUSAL_MESSAGES[reason])
    this.name = 'SaveRefusedError'
    this.path = path
    this.reason = reason
  }
}

/** `unknown`: no reply; `unsafe`: native refused the path itself (for example a folder link leaving the vault). */
export type SaveHoldKind = HoldKind | 'unknown' | 'unsafe'

/** A page whose text needs an explicit choice; ordinary saving pauses only for it. */
export interface SaveHold {
  readonly lane: string
  /** The original request copy, discard and Check again are bound to; an adopted one is another request's. */
  readonly request: OriginalRequest
  readonly kind: SaveHoldKind
  /** The native refusal reason or status, for example `parentMissing`, `symlink`, `conflict` or `noReply`. */
  readonly reason: string
  /** Another request held the page; this queue's own newer text stays the separate pending draft. */
  readonly adopted: boolean
  /** Check again said native no longer holds this request; copy and discard still work. */
  readonly retired: boolean
  /** A final resolution got no reply; choose again (an exact retry is safe). */
  readonly nativeUnknown: boolean
}

/** The page's latest refused request: nothing was published, ordinary saving continues on the next edit. */
export interface RetriableSave {
  readonly lane: string
  readonly request: OriginalRequest
  readonly reason: SaveRefusalReason
}

export interface SaveCopyView {
  readonly lane: string
  readonly requestId: string
  readonly operationId: string
  readonly seq: number
  /** null: the copy got no reply; repeating it reuses the same operation. */
  readonly outcome: CopyOutcome | null
}

/** Immutable; a new object after every change, for `useSyncExternalStore`. */
export interface SaveRecoverySnapshot {
  readonly version: number
  readonly holds: readonly SaveHold[]
  readonly retriable: readonly RetriableSave[]
  /** Pages whose last save committed but could not be confirmed durable; never replayed. */
  readonly notDurable: readonly string[]
  readonly copies: readonly SaveCopyView[]
}

export type CheckAgainResult =
  | { state: 'noHold' | 'unknown' | 'stale' | 'running' | 'mismatch' }
  | { state: 'voided' }
  | { state: 'retired'; resolved: boolean }
  | { state: 'done'; outcome: SaveOutcome; held: boolean }

export type DraftCopyResult =
  | { status: 'noRecovery' | 'noDraft' | 'stale' }
  | { status: 'done'; outcome: CopyOutcome | null }

export type FinalResolutionKind = 'keepCopy' | 'discard'

export type FinalResolutionResult =
  /** Native proved the choice; nothing local changed yet. Settle it with `apply`. */
  | { status: 'prepared'; kind: FinalResolutionKind; leftovers: readonly string[]; holdRetired: boolean }
  | { status: 'running' }
  | { status: 'refused'; reason: ResolutionRefusalReason | 'noCopy' | 'copyStale' | 'released' }
  /** No reply; the hold stays, marked `nativeUnknown`. */
  | { status: 'unknown' }
  /** The session or the bound text changed; nothing was settled. */
  | { status: 'stale' }

export interface FinalResolutionBound {
  readonly session: number
  readonly lane: string
  readonly request: OriginalRequest
  readonly seq: number
  readonly content: string
}

export type FinalApplyResult =
  /** The reset ran; the page's text is settled as copied or discarded. */
  | { status: 'applied'; kind: FinalResolutionKind; leftovers: readonly string[]; holdRetired: boolean }
  /** Nothing settled; the text and its recovery record stay as they were. */
  | { status: 'notPrepared' | 'released' | 'stale' | 'resetFailed' }

/**
 * Held from `beginFinalResolution` until `release`: the page admits no text, mutation or timer.
 * The UI blocks input visibly and flushes the page's buffers before beginning.
 */
export interface FinalResolution {
  readonly bound: FinalResolutionBound
  resolve: (kind: FinalResolutionKind) => Promise<FinalResolutionResult>
  /** After `prepared`, runs the UI's synchronous reset; only a `true` return settles the page. */
  apply: (reset: () => boolean) => FinalApplyResult
  release: () => void
}

export type FinalBeginResult =
  | { status: 'ready'; final: FinalResolution }
  /** A save, page change, Trash move, close or another choice holds the page; wait and try again. */
  | { status: 'busy' }
  | { status: 'none' }

export interface SaveRecoveryApi {
  getSnapshot: () => SaveRecoverySnapshot
  subscribe: (listener: () => void) => () => void
  /** A query only; it never saves. */
  checkAgain: (path: string) => Promise<CheckAgainResult>
  /** Creates a new page from the current pending text; never resolves the original. */
  saveDraftCopy: (path: string, folder: string | null) => Promise<DraftCopyResult>
  /** Whether the last copy holds exactly the current pending text. */
  canKeepCopy: (path: string) => boolean
  /** Resolves once no save or page change is running for the page. */
  whenPageIdle: (path: string) => Promise<void>
  beginFinalResolution: (path: string) => FinalBeginResult
  /** The receiving session now; it changes on every vault switch, so a choice can tell it outlived its page. */
  currentSession: () => number
}

interface HoldRecord extends SaveHold {
  /** The text this queue submitted with `request`; null for an adopted request. */
  readonly submitted: string | null
}
interface CopyRecord extends SaveCopyView { readonly folder: string | null; readonly content: string }
interface ActionRecord {
  readonly actionId: string
  readonly kind: FinalResolutionKind
  readonly requestId: string
  readonly seq: number
  readonly content: string
  readonly operationId: string | null
}
interface RecoveryStore {
  holds: Map<string, HoldRecord>
  retriable: Map<string, RetriableSave>
  notDurable: Set<string>
  copies: Map<string, CopyRecord>
  actions: Map<string, ActionRecord>
  guards: Set<string>
  /** The last failure shown per page, so autosave says it once. */
  notified: Map<string, string>
  listeners: Set<() => void>
  snapshot: SaveRecoverySnapshot
}

const EMPTY_RECOVERY: SaveRecoverySnapshot = Object.freeze({ version: 0, holds: [], retriable: [], notDurable: [], copies: [] })

function createRecoveryStore(): RecoveryStore {
  return {
    holds: new Map(), retriable: new Map(), notDurable: new Set(), copies: new Map(), actions: new Map(),
    guards: new Set(), notified: new Map(), listeners: new Set(), snapshot: EMPTY_RECOVERY,
  }
}

function publicHold(record: HoldRecord): SaveHold {
  const { lane, request, kind, reason, adopted, retired, nativeUnknown } = record
  return Object.freeze({ lane, request, kind, reason, adopted, retired, nativeUnknown })
}

function publicCopy(record: CopyRecord): SaveCopyView {
  const { lane, requestId, operationId, seq, outcome } = record
  return Object.freeze({ lane, requestId, operationId, seq, outcome })
}

function nextSnapshot(store: RecoveryStore): SaveRecoverySnapshot {
  return Object.freeze({
    version: store.snapshot.version + 1,
    holds: Object.freeze([...store.holds.values()].map(publicHold)),
    retriable: Object.freeze([...store.retriable.values()]),
    notDurable: Object.freeze([...store.notDurable]),
    copies: Object.freeze([...store.copies.values()].map(publicCopy)),
  })
}

/** The persistence root that contains the page, as the scope check accepted it; the longest wins. */
function vaultRootFor(path: string, scope: string | readonly string[]): string | null {
  const roots = (typeof scope === 'string' ? [scope] : [...scope]).map(root => root.trim()).filter(Boolean)
  const inside = roots.filter(root => isPathInsideVaultRoot(path, root))
  return inside.sort((a, b) => b.length - a.length)[0] ?? null
}

const freezeRequest = (request: OriginalRequest): OriginalRequest => Object.freeze({ ...request })

/** One debounce and ordered write lane per note; editing another pane never replaces pending data. */
export const AUTO_SAVE_DEBOUNCE_MS = 1_500
export const MISSING_ACTIVE_VAULT_SAVE_MESSAGE = 'Select or restore a vault before saving.'
interface PendingContent { path: string; content: string }
/** `seq` orders admissions, so a receipt can tell which later outcome of its page covers it. */
interface QueuedContent extends PendingContent { seq: number }
type PendingItem = [string, QueuedContent]
/** The queue's own record that it took these exact bytes for this page, in this session. */
export interface ContentReceipt { readonly path: string; readonly content: string; readonly session: number; readonly seq: number }
/** `settled`: written, or deliberately moved to Trash, by this session; `unproven`: no such record. */
export type ReceiptStatus = 'pending' | 'settled' | 'unproven'
type LaneOutcome = { seq: number; outcome: 'saved' | 'dropped' | 'trashed' | 'copied' | 'discarded' }
function persistenceScopeKey(scope: EditorSaveConfig['persistenceScope']): string {
  return JSON.stringify(typeof scope === 'string' ? [scope] : [...(scope ?? [])].sort())
}

export function useEditorSave(options: EditorSaveConfig) {
  const optionsRef = useRef(options)
  useLayoutEffect(() => { optionsRef.current = options }, [options])
  const pending = useRef(new Map<string, QueuedContent>())
  const admissions = useRef(0)
  // How each page's newest admission left the queue; read only by receipt checks.
  const outcomes = useRef(new Map<string, LaneOutcome>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const inFlight = useRef(new Map<string, Promise<boolean>>())
  // Pages being moved to Trash: only explicit drains write them, so nothing recreates a moved file.
  const held = useRef(new Set<string>())
  // Admitted document changes, so close and switch can wait for pages with no pending text.
  const mutations = useRef(new Map<string, Promise<unknown>>())
  const admissionHolds = useRef(0)
  // Committed changes whose newer draft could not take them yet; that draft is never saved as is.
  const unmerged = useRef(new Map<string, (content: string) => string | null>())
  // Lane writes that are page changes, not text saves.
  const changeWrites = useRef(new WeakSet<Promise<boolean>>())
  // A new persistence scope is a new session, even when it returns to an earlier vault.
  const session = useRef(0)
  const scopeKey = persistenceScopeKey(options.persistenceScope)
  const scopeRef = useRef(scopeKey)
  const t = useMemo(() => createTranslator(options.locale ?? 'en'), [options.locale])
  // Native binds `session` opaquely; this instance's id keeps two windows' epochs apart.
  const [instanceId] = useState(() => globalThis.crypto.randomUUID())
  const [store] = useState(createRecoveryStore)
  const currentPath = useCallback((path: string) => optionsRef.current.resolvePath?.(path) ?? path, [])
  const findPending = useCallback((path: string) => [...pending.current.entries()].find(([key]) => currentPath(key) === currentPath(path)), [currentPath])
  const findInFlight = useCallback((path: string) => [...inFlight.current].find(([key]) => currentPath(key) === currentPath(path))?.[1], [currentPath])
  const findMutation = useCallback((path: string) => [...mutations.current].find(([key]) => currentPath(key) === currentPath(path))?.[1], [currentPath])
  const recordOutcome = useCallback((path: string, seq: number, outcome: LaneOutcome['outcome']) => {
    const lane = currentPath(path)
    for (const key of [...outcomes.current.keys()]) if (currentPath(key) === lane) outcomes.current.delete(key)
    outcomes.current.set(lane, { seq, outcome })
  }, [currentPath])
  const updateTabs = useCallback((path: string, content: string) => {
    optionsRef.current.setTabs(previous => {
      let changed = false
      const next = previous.map(tab => {
        if (tab.entry.path !== path || tab.content === content) return tab
        changed = true
        return { ...tab, content }
      })
      return changed ? next : previous
    })
  }, [])
  const updateSavedContent = useCallback((path: string, content: string) => {
    const latest = findPending(path)?.[1]
    if (latest && latest.content !== content) return
    optionsRef.current.updateVaultContent(path, content)
    updateTabs(path, content)
  }, [findPending, updateTabs])
  const { saveNote, commitSaved } = useSaveNote(updateSavedContent)
  const cancelTimer = useCallback((path?: string) => {
    for (const [key, timer] of timers.current) {
      if (path && currentPath(key) !== currentPath(path)) continue
      clearTimeout(timer)
      timers.current.delete(key)
    }
  }, [currentPath])
  const laneKey = useCallback(<T,>(map: Map<string, T>, path: string) => [...map.keys()].find(key => currentPath(key) === currentPath(path)), [currentPath])
  const emitRecovery = useCallback(() => {
    store.snapshot = nextSnapshot(store)
    for (const listener of [...store.listeners]) listener()
  }, [store])
  const isGuarded = useCallback((path: string) => [...store.guards].some(key => currentPath(key) === currentPath(path)), [currentPath, store])
  const findHold = useCallback((path: string) => {
    const key = laneKey(store.holds, path)
    return key === undefined ? undefined : store.holds.get(key)
  }, [laneKey, store])
  const findRetriable = useCallback((path: string) => {
    const key = laneKey(store.retriable, path)
    return key === undefined ? undefined : store.retriable.get(key)
  }, [laneKey, store])
  /** Held for a recovery choice, or inside a final resolution: nothing ordinary writes the page. */
  const isSaveBlocked = useCallback((path: string) => !!findHold(path) || isGuarded(path), [findHold, isGuarded])
  const dropLane = useCallback(<T,>(map: Map<string, T>, path: string) => {
    for (const key of [...map.keys()]) if (currentPath(key) === currentPath(path)) map.delete(key)
  }, [currentPath])
  const setHold = useCallback((record: HoldRecord) => {
    dropLane(store.holds, record.lane)
    dropLane(store.retriable, record.lane)
    store.holds.set(record.lane, record)
    cancelTimer(record.lane)
    emitRecovery()
  }, [cancelTimer, dropLane, emitRecovery, store])
  /** The page's recovery state ends: a commit, a voided request or a final disposition. */
  const clearRecovery = useCallback((path: string, scope: 'saving' | 'all') => {
    dropLane(store.holds, path)
    dropLane(store.retriable, path)
    dropLane(store.notified, path)
    if (scope === 'all') {
      dropLane(store.copies, path)
      dropLane(store.actions, path)
      for (const key of [...store.notDurable]) if (currentPath(key) === currentPath(path)) store.notDurable.delete(key)
    }
    emitRecovery()
  }, [currentPath, dropLane, emitRecovery, store])
  useEffect(() => () => cancelTimer(), [cancelTimer])
  useEffect(() => {
    const epoch = session
    // Results that arrive after unmount belong to a closed session.
    return () => { epoch.current += 1 }
  }, [])
  useLayoutEffect(() => {
    if (scopeRef.current === scopeKey) return
    scopeRef.current = scopeKey
    session.current += 1
    for (const [path, snapshot] of pending.current) {
      if (canWritePathToVault(currentPath(snapshot.path), optionsRef.current.persistenceScope ?? '')) continue
      pending.current.delete(path)
      recordOutcome(snapshot.path, snapshot.seq, 'dropped')
      cancelTimer(path)
      clearRecovery(snapshot.path, 'all')
    }
    for (const path of [...unmerged.current.keys()]) if (!findPending(path)) unmerged.current.delete(path)
  }, [cancelTimer, clearRecovery, currentPath, findPending, recordOutcome, scopeKey])
  const replacePending = useCallback(([key, snapshot]: PendingItem, content: string) => {
    pending.current.set(key, { path: snapshot.path, content, seq: snapshot.seq })
    updateTabs(snapshot.path, content)
    optionsRef.current.onContentRebased?.(snapshot.path, content)
  }, [updateTabs])
  /** Applies a retained change to the page's newer text; false while that text still can't take it. */
  const integrate = useCallback((path: string): boolean => {
    const hold = [...unmerged.current].find(([key]) => currentPath(key) === currentPath(path))
    if (!hold) return true
    const item = findPending(path)
    const rebased = item ? hold[1](item[1].content) : null
    if (item && rebased === null) return false
    unmerged.current.delete(hold[0])
    if (item && rebased !== null) replacePending(item, rebased)
    return true
  }, [currentPath, findPending, replacePending])
  const refuse = useCallback((lane: string, request: OriginalRequest, reason: SaveRefusalReason): never => {
    dropLane(store.retriable, lane)
    store.retriable.set(lane, Object.freeze({ lane, request, reason }))
    emitRecovery()
    throw new SaveRefusedError(lane, reason)
  }, [dropLane, emitRecovery, store])
  const holdLane = useCallback((lane: string, request: OriginalRequest, kind: SaveHoldKind, reason: string, submitted: string | null, adopted = false): never => {
    setHold({ lane, request, kind, reason, adopted, retired: false, nativeUnknown: false, submitted })
    throw new SaveHeldError(lane, request.requestId)
  }, [setHold])
  /** A native hold must name this request; anything else is held as unknown under this request. */
  const holdFrom = useCallback((lane: string, request: OriginalRequest, content: string, hold: HoldInfo, reason: string): never => {
    if (hold.requestId !== request.requestId || hold.seq !== request.seq || hold.submittedSha256 !== request.submittedSha256) {
      console.warn('[save] A hold answer named another request; holding this one as unknown')
      return holdLane(lane, request, 'unknown', 'mismatchedHold', content)
    }
    return holdLane(lane, request, hold.kind, reason, content)
  }, [holdLane])
  /** Whether a held answer provably names this page's holder, in this vault. */
  const isOwnHolder = useCallback((lane: string, request: OriginalRequest, heldBy: string, holder: OriginalRequest) =>
    heldBy === holder.requestId && holder.vaultPath === request.vaultPath && currentPath(holder.path) === lane, [currentPath])
  /** Adopts another request's hold only when it is provably this page's, in this vault. */
  const adoptHolder = useCallback((lane: string, request: OriginalRequest, heldBy: string, holder: OriginalRequest, kind: HoldKind): never => {
    if (!isOwnHolder(lane, request, heldBy, holder)) {
      console.warn('[save] A held answer named a request for another page; not adopted')
      return refuse(lane, request, 'held')
    }
    return holdLane(lane, freezeRequest(holder), kind, 'held', null, true)
  }, [holdLane, isOwnHolder, refuse])
  /**
   * Applies one reply of the current session. True only when this exact snapshot was written;
   * false when newer text superseded it; throws for every outcome that saved nothing.
   */
  const applyOutcome = useCallback((target: string, request: OriginalRequest, content: string, outcome: SaveOutcome | null, own: PendingItem | null): boolean => {
    const lane = currentPath(target)
    if (outcome === null) return holdLane(lane, request, 'unknown', 'noReply', content)
    switch (outcome.status) {
      case 'committed': {
        commitSaved(target, content)
        clearRecovery(lane, 'saving')
        if (outcome.durable) for (const key of [...store.notDurable]) { if (currentPath(key) === lane) store.notDurable.delete(key) }
        else store.notDurable.add(lane)
        emitRecovery()
        if (!own) return false
        pending.current.delete(own[0])
        recordOutcome(target, own[1].seq, 'saved')
        optionsRef.current.onNotePersisted?.(target, content)
        return true
      }
      case 'failed':
        return refuse(lane, request, 'publish')
      case 'conflict':
        return holdFrom(lane, request, content, outcome.hold, outcome.reason)
      case 'uncertain':
        return holdFrom(lane, request, content, outcome.hold, 'uncertain')
    }
    switch (outcome.reason) {
      // A still-current draft refused for its unsafe path keeps copy and discard; it is never dropped.
      case 'outsideVault':
        return holdLane(lane, request, 'unsafe', 'outsideVault', content)
      case 'held':
        return adoptHolder(lane, request, outcome.heldBy, outcome.heldRequest, outcome.heldKind)
      case 'missing':
      case 'parentMissing':
      case 'linked':
      case 'symlink':
        return holdFrom(lane, request, content, outcome.hold, outcome.reason)
      default:
        return refuse(lane, request, outcome.reason)
    }
  }, [adoptHolder, clearRecovery, commitSaved, currentPath, emitRecovery, holdFrom, holdLane, recordOutcome, refuse, store])
  const flushPath = useCallback(async function flushDocument(path: string, drain = true, force = false): Promise<boolean> {
    cancelTimer(path)
    if (optionsRef.current.canPersist === false) return false
    // A page waiting for a recovery choice is never written by ordinary saving, forced drains included.
    if (isSaveBlocked(path)) {
      if (!drain && !force) return false
      throw new SaveHeldError(currentPath(path), findHold(path)?.request.requestId ?? null)
    }
    // A page moving to Trash is written only by the move's own drain; its text stays pending meanwhile.
    if (!force && (held.current.has(path) || held.current.has(currentPath(path)))) return false
    const lane = currentPath(path)
    const existing = [...inFlight.current].find(([key]) => currentPath(key) === lane)?.[1]
    if (existing) {
      // A page change carries newer text forward itself, so only pending text waits behind it.
      if (changeWrites.current.has(existing) && !findPending(path)) return false
      const saved = await existing
      // A manual flush waits for changes typed during the earlier write too.
      const stillDebouncing = [...timers.current.keys()].some(key => currentPath(key) === lane)
      // An autosave whose idle timer already expired waits behind the older write.
      // Only a newer, still-running timer may defer the next snapshot again.
      return findPending(path) && (drain || !stillDebouncing) ? flushDocument(path, drain, force) : saved
    }
    // Autosave quietly skips an unmerged draft; anything explicit must say it could not save.
    if (!integrate(path)) {
      if (drain || force) throw new UnmergedDraftError(lane)
      return false
    }
    const item = findPending(path)
    if (!item) return false
    const [key, snapshot] = item
    const persist = async () => {
      const config = optionsRef.current
      const opened = session.current
      const resolved = currentPath(snapshot.path)
      const target = config.resolvePathBeforeSave ? await config.resolvePathBeforeSave(resolved) : resolved
      if (session.current !== opened) return false
      const scope = optionsRef.current.persistenceScope ?? ''
      if (!canWritePathToVault(target, scope)) {
        if (pending.current.get(key) === snapshot) {
          pending.current.delete(key)
          recordOutcome(target, snapshot.seq, 'dropped')
        }
        return false
      }
      const vaultPath = vaultRootFor(target, scope)
      if (!vaultPath) throw new SaveRefusedError(currentPath(target), 'noVault')
      config.onBeforePersist?.(target)
      // From here only this captured snapshot is used; nothing mutable is read again.
      const content = snapshot.content
      const request = freezeRequest({
        requestId: globalThis.crypto.randomUUID(), vaultPath, session: `${instanceId}:${opened}`,
        path: target, seq: snapshot.seq, submittedSha256: await sha256Hex(content),
      })
      const outcome = await saveNote(request, content)
      // A reply for a closed session is ignored; native keeps its own record of it.
      if (session.current !== opened) return false
      return applyOutcome(target, request, content, outcome, pending.current.get(key) === snapshot ? [key, snapshot] : null)
    }
    const promise = persist()
    inFlight.current.set(lane, promise)
    let saved: boolean
    try { saved = await promise } finally {
      if (inFlight.current.get(lane) === promise) inFlight.current.delete(lane)
    }
    return drain && findPending(path) ? flushDocument(path, drain, force) : saved
  }, [applyOutcome, cancelTimer, currentPath, findHold, findPending, instanceId, integrate, isSaveBlocked, recordOutcome, saveNote])
  const savePendingForPath = useCallback((path: string) => flushPath(path), [flushPath])
  /** The Trash move's own drain: writes a held page's latest text. */
  const drainHeld = useCallback((path: string) => flushPath(path, true, true), [flushPath])
  const isHeld = useCallback((path: string) => held.current.has(path) || held.current.has(currentPath(path)), [currentPath])
  const savePending = useCallback(async () => {
    let saved = false
    // Await every lane even if one fails: the other page must still reach disk.
    const lanes = [...pending.current.keys()].filter(path => !isHeld(path))
    const results = await Promise.allSettled(lanes.map(path => savePendingForPath(path)))
    let failure: unknown
    for (const result of results) {
      if (result.status === 'fulfilled') saved = result.value || saved
      else failure = result.reason
    }
    if (failure) throw failure
    return saved
  }, [isHeld, savePendingForPath])
  const showFailure = useCallback((error: unknown) => {
    if (error instanceof UnmergedDraftError) {
      optionsRef.current.setToastMessage(t('save.error.unmergedDraft'))
      return
    }
    if (error instanceof SaveHeldError) {
      optionsRef.current.setToastMessage(t('save.error.held'))
      return
    }
    if (error instanceof SaveRefusedError) {
      const detail = error.reason === 'noVault' ? t('save.toast.missingActiveVault') : t(SAVE_REFUSAL_KEYS[error.reason])
      optionsRef.current.setToastMessage(t('save.error.failed', { error: detail }))
      return
    }
    const message = errorMessage(error)
    const invalid = /os error 123|filename, directory name, or volume label syntax is incorrect|path is invalid on this platform/i.test(message)
    optionsRef.current.setToastMessage(invalid ? t('save.error.invalidPath') : t('save.error.failed', { error: message }))
  }, [t])
  /** Autosave reports one refusal per page once, until the page's state changes. */
  const isRepeatedFailure = useCallback((error: unknown) => {
    if (!(error instanceof SaveHeldError) && !(error instanceof SaveRefusedError)) return false
    const shown = `${error.name}:${error instanceof SaveRefusedError ? error.reason : error.requestId}`
    const key = laneKey(store.notified, error.path) ?? error.path
    if (store.notified.get(key) === shown) return true
    store.notified.set(key, shown)
    return false
  }, [laneKey, store])
  const scheduleAutosave = useCallback((key: string) => {
    cancelTimer(key)
    if (optionsRef.current.canPersist === false || isSaveBlocked(key)) return
    timers.current.set(key, setTimeout(() => {
      timers.current.delete(key)
      void flushPath(key, false).then(saved => {
        if (saved) optionsRef.current.onAfterSave?.()
      }).catch(error => {
        // The page's persistent recovery notice explains a hold; a toast would only repeat it.
        if (error instanceof SaveHeldError || isRepeatedFailure(error)) return
        console.error('Auto-save failed:', error)
        showFailure(error)
      })
    }, AUTO_SAVE_DEBOUNCE_MS))
  }, [cancelTimer, flushPath, isRepeatedFailure, isSaveBlocked, showFailure])
  const handleContentChange = useCallback((path: string, content: string): ContentReceipt | null => {
    const target = currentPath(path)
    if (!canWritePathToVault(target, optionsRef.current.persistenceScope ?? '')) return null
    // Inside a final resolution the page takes no text; M4 capture keeps its own recovery copy.
    if (isGuarded(target)) return null
    const old = findPending(path)
    const key = old?.[0] ?? target
    const seq = ++admissions.current
    pending.current.set(key, { path: target, content, seq })
    updateTabs(target, content)
    scheduleAutosave(key)
    return Object.freeze({ path: target, content, session: session.current, seq })
  }, [currentPath, findPending, isGuarded, scheduleAutosave, updateTabs])
  const holdAutosave = useCallback((paths: readonly string[]) => {
    for (const path of paths) {
      held.current.add(path)
      held.current.add(currentPath(path))
    }
  }, [currentPath])
  /**
   * `discard` drops text already copied to Trash (the caller checked nothing newer arrived);
   * `resume` saves held text again; `release` only lifts the hold.
   */
  const releaseAutosave = useCallback((paths: readonly string[], action: 'discard' | 'resume' | 'release') => {
    for (const path of paths) {
      held.current.delete(path)
      held.current.delete(currentPath(path))
      const item = findPending(path)
      if (!item || action === 'release') continue
      if (action === 'discard') {
        cancelTimer(path)
        pending.current.delete(item[0])
        recordOutcome(item[1].path, item[1].seq, 'trashed')
      } else {
        scheduleAutosave(item[0])
      }
    }
  }, [cancelTimer, currentPath, findPending, recordOutcome, scheduleAutosave])
  const hasPendingWrite = useCallback((path: string) => !!findPending(path) || [...inFlight.current.keys()].some(key => currentPath(key) === currentPath(path)), [currentPath, findPending])
  const handleSave = useCallback(async (fallback?: PendingContent): Promise<boolean> => {
    cancelTimer()
    const config = optionsRef.current
    if (config.canPersist === false) {
      const dirty = pending.current.size > 0 || fallback !== undefined
      config.setToastMessage(dirty ? config.disabledSaveMessage ?? t('save.toast.missingActiveVault') : t('save.toast.nothingToSave'))
      return !dirty
    }
    try {
      const hadPendingFallback = fallback ? !!findPending(fallback.path) : false
      let saved = await savePending()
      if (fallback && !hadPendingFallback && !saved && !isHeld(fallback.path) && !isGuarded(fallback.path)) {
        pending.current.set(fallback.path, { ...fallback, seq: ++admissions.current })
        saved = await savePendingForPath(fallback.path)
      }
      config.setToastMessage(saved ? t('save.toast.saved') : t('save.toast.nothingToSave'))
      config.onAfterSave?.()
      return true
    } catch (error) { console.error('Save failed:', error); showFailure(error); return false }
  }, [cancelTimer, findPending, isGuarded, isHeld, savePending, savePendingForPath, showFailure, t])
  const mutation = useDocumentMutations({
    optionsRef, pending, inFlight, mutations, admissionHolds, unmerged, changeWrites, session,
    currentPath, findPending, findInFlight, findMutation, isHeld, isSaveBlocked, integrate, flushPath, replacePending, updateSavedContent,
  })
  // A save or page change already running, which a final choice must not overtake.
  const laneWork = useCallback((path: string) => findInFlight(path) ?? findMutation(path), [findInFlight, findMutation])
  const recovery = useSaveRecovery({
    store, pending, session, unmerged, optionsRef, admissionHolds,
    currentPath, findPending, findHold, findRetriable, isGuarded, isHeld, laneWork, isOwnHolder, laneKey, dropLane, setHold,
    clearRecovery, emitRecovery, recordOutcome, cancelTimer, scheduleAutosave, commitSaved,
  })
  /** Whether this session wrote, or moved to Trash, the page's text from this admission or a later one. */
  const receiptStatus = useCallback((receipt: Pick<ContentReceipt, 'path' | 'session' | 'seq'>): ReceiptStatus => {
    if (receipt.session !== session.current) return 'unproven'
    if (hasPendingWrite(receipt.path)) return 'pending'
    const lane = currentPath(receipt.path)
    const last = [...outcomes.current].find(([key]) => currentPath(key) === lane)?.[1]
    return last && last.seq >= receipt.seq && last.outcome !== 'dropped' ? 'settled' : 'unproven'
  }, [currentPath, hasPendingWrite])
  return { handleContentChange, handleSave, savePending, savePendingForPath, holdAutosave, releaseAutosave, hasPendingWrite, receiptStatus, drainHeld, isHeld, isSaveBlocked, recovery, ...mutation }
}

interface SaveRecoveryDeps {
  store: RecoveryStore
  pending: { current: Map<string, QueuedContent> }
  session: { current: number }
  unmerged: { current: Map<string, (content: string) => string | null> }
  optionsRef: { current: EditorSaveConfig }
  admissionHolds: { current: number }
  currentPath: (path: string) => string
  findPending: (path: string) => PendingItem | undefined
  findHold: (path: string) => HoldRecord | undefined
  findRetriable: (path: string) => RetriableSave | undefined
  isGuarded: (path: string) => boolean
  isHeld: (path: string) => boolean
  laneWork: (path: string) => Promise<unknown> | undefined
  isOwnHolder: (lane: string, request: OriginalRequest, heldBy: string, holder: OriginalRequest) => boolean
  laneKey: <T>(map: Map<string, T>, path: string) => string | undefined
  dropLane: <T>(map: Map<string, T>, path: string) => void
  setHold: (record: HoldRecord) => void
  clearRecovery: (path: string, scope: 'saving' | 'all') => void
  emitRecovery: () => void
  recordOutcome: (path: string, seq: number, outcome: LaneOutcome['outcome']) => void
  cancelTimer: (path?: string) => void
  scheduleAutosave: (key: string) => void
  commitSaved: (path: string, content: string) => void
}

const sameDraft = (item: QueuedContent | undefined, seq: number, content: string) => !!item && item.seq === seq && item.content === content

/** Check again, copies and the guarded final resolution, each applied only to the exact bound text. */
function useSaveRecovery(deps: SaveRecoveryDeps): SaveRecoveryApi {
  const depsRef = useRef(deps)
  useLayoutEffect(() => { depsRef.current = deps })

  /** The text native answered for, when a later Check proves it reached disk. */
  const applyChecked = useCallback((hold: HoldRecord, outcome: SaveOutcome): boolean => {
    const d = depsRef.current
    const lane = hold.lane
    const resume = () => {
      d.clearRecovery(lane, 'saving')
      const item = d.findPending(lane)
      if (item) d.scheduleAutosave(item[0])
      return false
    }
    if (outcome.status === 'committed' || (outcome.status === 'failed' && outcome.reason === 'publish')) {
      if (outcome.status === 'committed' && !hold.adopted && hold.submitted !== null) {
        const target = d.currentPath(hold.request.path)
        d.commitSaved(target, hold.submitted)
        if (!outcome.durable) d.store.notDurable.add(lane)
        const item = d.findPending(lane)
        // Only the exact submitted text is settled; newer text stays and saves normally.
        if (item && sameDraft(item[1], hold.request.seq, hold.submitted)) {
          d.pending.current.delete(item[0])
          d.recordOutcome(target, hold.request.seq, 'saved')
          d.optionsRef.current.onNotePersisted?.(target, hold.submitted)
        }
      }
      return resume()
    }
    if (outcome.status === 'refused' && outcome.reason === 'held') {
      // A lost held reply: the real holder, when provably this page's, is what the final choice must address.
      const holder = outcome.heldRequest
      if (!d.isOwnHolder(lane, hold.request, outcome.heldBy, holder)) console.warn('[save] Check again named a holder for another page; not adopted')
      else if (holder.requestId !== hold.request.requestId) {
        d.setHold({ lane, request: freezeRequest(holder), kind: outcome.heldKind, reason: 'held', adopted: true, retired: false, nativeUnknown: false, submitted: null })
      }
      return true
    }
    if (outcome.status === 'refused' && !('hold' in outcome)) {
      if (outcome.reason === 'outsideVault') return true
      // The request was refused before publication; its text simply saves again.
      return resume()
    }
    return true
  }, [])

  const checkAgain = useCallback(async (path: string): Promise<CheckAgainResult> => {
    const d = depsRef.current
    const hold = d.findHold(path)
    if (!hold) return { state: 'noHold' }
    const opened = d.session.current
    const answer = await checkSaveOutcome(hold.request)
    const now = depsRef.current
    if (now.session.current !== opened || now.findHold(path) !== hold) return { state: 'stale' }
    if (answer === null) return { state: 'unknown' }
    switch (answer.state) {
      case 'voided': {
        // Native never ran it and now never will: the text stays pending and saves under a new request.
        now.clearRecovery(hold.lane, 'saving')
        const item = now.findPending(hold.lane)
        if (item) now.scheduleAutosave(item[0])
        return { state: 'voided' }
      }
      case 'running':
        return { state: 'running' }
      case 'mismatch':
        console.warn('[save] Check again was refused for a different request')
        return { state: 'mismatch' }
      case 'retired':
        now.setHold({ ...hold, retired: true })
        return { state: 'retired', resolved: answer.resolved }
      case 'done':
        return { state: 'done', outcome: answer.outcome, held: applyChecked(hold, answer.outcome) }
    }
  }, [applyChecked])

  const recoveryFor = useCallback((path: string) => {
    const d = depsRef.current
    return d.findHold(path) ?? d.findRetriable(path)
  }, [])

  const saveDraftCopy = useCallback(async (path: string, folder: string | null): Promise<DraftCopyResult> => {
    const d = depsRef.current
    const record = recoveryFor(path)
    if (!record) return { status: 'noRecovery' }
    const item = d.findPending(path)
    if (!item) return { status: 'noDraft' }
    const opened = d.session.current
    const lane = record.lane
    const { seq, content } = item[1]
    const lastKey = d.laneKey(d.store.copies, lane)
    const last = lastKey === undefined ? undefined : d.store.copies.get(lastKey)
    // Only a copy that got no reply, or a busy one, is repeated as the same operation.
    const retry = last && last.requestId === record.request.requestId && last.seq === seq && last.content === content
      && last.folder === folder && (last.outcome === null || (last.outcome.status === 'refused' && last.outcome.reason === 'busy'))
    const operationId = retry ? last.operationId : globalThis.crypto.randomUUID()
    const outcome = await saveDraftAsNewPage(record.request, { seq, content }, operationId, folder)
    const now = depsRef.current
    if (now.session.current !== opened) return { status: 'stale' }
    now.dropLane(now.store.copies, lane)
    now.store.copies.set(lane, Object.freeze({ lane, requestId: record.request.requestId, operationId, seq, outcome, folder, content }))
    now.emitRecovery()
    return { status: 'done', outcome }
  }, [recoveryFor])

  const copyFor = useCallback((lane: string) => {
    const d = depsRef.current
    const key = d.laneKey(d.store.copies, lane)
    return key === undefined ? undefined : d.store.copies.get(key)
  }, [])

  const canKeepCopy = useCallback((path: string) => {
    const d = depsRef.current
    const record = recoveryFor(path)
    const copy = record && copyFor(record.lane)
    return !!copy && copy.outcome?.status === 'created' && copy.requestId === record.request.requestId
      && sameDraft(d.findPending(path)?.[1], copy.seq, copy.content)
  }, [copyFor, recoveryFor])

  const whenPageIdle = useCallback(async (path: string) => {
    for (let work = depsRef.current.laneWork(path); work; work = depsRef.current.laneWork(path)) await Promise.allSettled([work])
  }, [])

  const beginFinalResolution = useCallback((path: string): FinalBeginResult => {
    const d = depsRef.current
    const record = recoveryFor(path)
    const item = d.findPending(path)
    if (!record || !item) return { status: 'none' }
    // Checked and claimed with no await between, so no earlier save can land after the choice.
    if (d.isGuarded(path) || d.laneWork(path) || d.isHeld(path) || d.admissionHolds.current > 0) return { status: 'busy' }
    const lane = record.lane
    d.store.guards.add(lane)
    d.cancelTimer(lane)
    const bound: FinalResolutionBound = Object.freeze({
      session: d.session.current, lane, request: record.request, seq: item[1].seq, content: item[1].content,
    })
    let released = false
    let prepared: { kind: FinalResolutionKind; actionId: string; leftovers: readonly string[]; holdRetired: boolean } | null = null
    const release = () => {
      if (released) return
      released = true
      depsRef.current.store.guards.delete(lane)
      depsRef.current.emitRecovery()
    }
    // The same session still holds a recovery record for exactly the bound request.
    const stillBound = () => depsRef.current.session.current === bound.session && recoveryFor(lane)?.request.requestId === bound.request.requestId
    const markUnknown = () => {
      const now = depsRef.current
      const hold = now.findHold(lane)
      if (hold && hold.request.requestId === bound.request.requestId) now.setHold({ ...hold, nativeUnknown: true })
    }
    const resolve = async (kind: FinalResolutionKind): Promise<FinalResolutionResult> => {
      prepared = null
      if (released) return { status: 'refused', reason: 'released' }
      if (!stillBound()) return { status: 'stale' }
      if (depsRef.current.laneWork(lane)) return { status: 'refused', reason: 'busy' }
      const copy = kind === 'keepCopy' ? copyFor(lane) : undefined
      if (kind === 'keepCopy') {
        if (!copy || copy.outcome?.status !== 'created') return { status: 'refused', reason: 'noCopy' }
        // An older copy never settles newer text.
        if (copy.requestId !== bound.request.requestId || copy.seq !== bound.seq || copy.content !== bound.content) {
          return { status: 'refused', reason: 'copyStale' }
        }
      }
      const operationId = copy?.operationId ?? null
      const contentSha256 = await sha256Hex(bound.content)
      if (released) return { status: 'refused', reason: 'released' }
      if (!stillBound()) return { status: 'stale' }
      const d = depsRef.current
      const priorKey = d.laneKey(d.store.actions, lane)
      const prior = priorKey === undefined ? undefined : d.store.actions.get(priorKey)
      // Only the same action on the same text repeats its id; anything else is a new explicit action.
      const exactRetry = prior && prior.kind === kind && prior.requestId === bound.request.requestId
        && prior.seq === bound.seq && prior.content === bound.content && prior.operationId === operationId
      const actionId = exactRetry ? prior.actionId : globalThis.crypto.randomUUID()
      d.dropLane(d.store.actions, lane)
      d.store.actions.set(lane, Object.freeze({ actionId, kind, requestId: bound.request.requestId, seq: bound.seq, content: bound.content, operationId }))
      const confirmed = { seq: bound.seq, contentSha256 }
      const answer = kind === 'keepCopy' && operationId !== null
        ? await releaseHoldWithCopy(bound.request, actionId, confirmed, operationId)
        : await discardHold(bound.request, actionId, confirmed)
      const now = depsRef.current
      if (now.session.current !== bound.session) return { status: 'stale' }
      if (answer === null) {
        markUnknown()
        return { status: 'unknown' }
      }
      if (answer.status === 'running') return { status: 'running' }
      if (answer.status === 'refused') return { status: 'refused', reason: answer.reason }
      if (answer.actionId !== actionId) {
        console.warn('[save] A resolution answered for a different action; nothing settled')
        markUnknown()
        return { status: 'unknown' }
      }
      if (released || !stillBound() || !sameDraft(now.findPending(lane)?.[1], bound.seq, bound.content)) {
        markUnknown()
        return { status: 'stale' }
      }
      // Native retired the choice; the text stays pending until the editor has been reset.
      const leftovers = Object.freeze([...answer.leftovers])
      prepared = { kind, actionId, leftovers, holdRetired: answer.holdRetired }
      return { status: 'prepared', kind, leftovers, holdRetired: answer.holdRetired }
    }
    const apply = (reset: () => boolean): FinalApplyResult => {
      if (released) return { status: 'released' }
      const ready = prepared
      if (!ready) return { status: 'notPrepared' }
      const now = depsRef.current
      const current = now.findPending(lane)
      const actionKey = now.laneKey(now.store.actions, lane)
      const action = actionKey === undefined ? undefined : now.store.actions.get(actionKey)
      if (!stillBound() || !current || !sameDraft(current[1], bound.seq, bound.content) || action?.actionId !== ready.actionId) {
        return { status: 'stale' }
      }
      let ok = false
      try {
        ok = reset() === true
      } catch (error) {
        console.error('[save] The page could not be reset after a final choice:', error)
      }
      if (!ok) return { status: 'resetFailed' }
      now.pending.current.delete(current[0])
      now.unmerged.current.delete(current[0])
      now.recordOutcome(lane, bound.seq, ready.kind === 'keepCopy' ? 'copied' : 'discarded')
      now.clearRecovery(lane, 'all')
      prepared = null
      return { status: 'applied', kind: ready.kind, leftovers: ready.leftovers, holdRetired: ready.holdRetired }
    }
    d.emitRecovery()
    return { status: 'ready', final: Object.freeze({ bound, resolve, apply, release }) }
  }, [copyFor, recoveryFor])

  const getSnapshot = useCallback(() => depsRef.current.store.snapshot, [])
  const subscribe = useCallback((listener: () => void) => {
    const { store } = depsRef.current
    store.listeners.add(listener)
    return () => { store.listeners.delete(listener) }
  }, [])
  const currentSession = useCallback(() => depsRef.current.session.current, [])

  return useMemo(() => ({ getSnapshot, subscribe, checkAgain, saveDraftCopy, canKeepCopy, whenPageIdle, beginFinalResolution, currentSession }),
    [beginFinalResolution, canKeepCopy, checkAgain, currentSession, getSnapshot, saveDraftCopy, subscribe, whenPageIdle])
}

interface MutationLaneDeps {
  optionsRef: { current: EditorSaveConfig }
  pending: { current: Map<string, PendingContent> }
  inFlight: { current: Map<string, Promise<boolean>> }
  mutations: { current: Map<string, Promise<unknown>> }
  admissionHolds: { current: number }
  unmerged: { current: Map<string, (content: string) => string | null> }
  changeWrites: { current: WeakSet<Promise<boolean>> }
  session: { current: number }
  currentPath: (path: string) => string
  findPending: (path: string) => PendingItem | undefined
  findInFlight: (path: string) => Promise<boolean> | undefined
  findMutation: (path: string) => Promise<unknown> | undefined
  isHeld: (path: string) => boolean
  isSaveBlocked: (path: string) => boolean
  integrate: (path: string) => boolean
  flushPath: (path: string) => Promise<boolean>
  replacePending: (item: PendingItem, content: string) => void
  updateSavedContent: (path: string, content: string) => void
}

/** Runs one admitted change alone in its page's write lane, then merges it into newer text once. */
function useDocumentMutations(deps: MutationLaneDeps) {
  const depsRef = useRef(deps)
  useLayoutEffect(() => { depsRef.current = deps })

  const complete = useCallback(<R,>(target: string, mutation: DocumentMutation<R>, result: R, sessionAtAdmission: number): MutationSettled<R> => {
    const d = depsRef.current
    const current = d.session.current === sessionAtAdmission
    const settled = (integration: MutationIntegration, latest: string | null): MutationSettled<R> =>
      ({ kind: 'returned', path: target, result, current, integration, latest })
    if (!current) return settled('none', null)
    const committed = mutation.committedContent(result)
    try {
      mutation.flushBuffers?.(target)
    } catch (error) {
      console.warn('[save] Editor buffers could not be read after a page change:', error)
    }
    if (committed === null) return settled('none', d.findPending(target)?.[1].content ?? null)
    cacheNoteContent(target, committed)
    const item = d.findPending(target)
    if (!item) {
      d.updateSavedContent(target, committed)
      d.optionsRef.current.onNotePersisted?.(target, committed)
      return settled('none', committed)
    }
    const rebased = mutation.rebase(item[1].content)
    if (rebased === null) {
      d.unmerged.current.set(item[0], mutation.rebase)
      return settled('unmergedDraft', item[1].content)
    }
    d.replacePending(item, rebased)
    return settled('rebased', rebased)
  }, [])

  const run = useCallback(async <R,>(lane: string, mutation: DocumentMutation<R>, sessionAtAdmission: number): Promise<MutationSettled<R>> => {
    const d = depsRef.current
    let target = lane
    try {
      for (;;) {
        if (d.isHeld(target) || !d.findPending(target)) await d.findInFlight(target)
        else await d.flushPath(target)
        const config = d.optionsRef.current
        target = config.resolvePathBeforeSave ? await config.resolvePathBeforeSave(d.currentPath(target)) : d.currentPath(target)
        const waiting = d.findInFlight(target) || (!d.isHeld(target) && d.findPending(target))
        if (!waiting) break
        if (config.canPersist === false) throw new Error('The page could not be saved before the change')
      }
    } catch (error) {
      return { kind: 'notRun', path: target, error, current: d.session.current === sessionAtAdmission }
    }
    // Claimed with no await since the check above, so no other write can start in between.
    const laneKey = d.currentPath(target)
    let release: (saved: boolean) => void = () => {}
    const claim = new Promise<boolean>(resolve => { release = resolve })
    d.inFlight.current.set(laneKey, claim)
    d.changeWrites.current.add(claim)
    let saved = false
    try {
      d.optionsRef.current.onBeforePersist?.(target)
      let result: R
      try {
        result = await mutation.publish(target)
      } catch (error) {
        return { kind: 'unknown', path: target, error, current: d.session.current === sessionAtAdmission }
      }
      saved = mutation.committedContent(result) !== null
      try {
        return complete(target, mutation, result, sessionAtAdmission)
      } catch (error) {
        // The change is on disk; a draft that did not take it must not overwrite it later.
        console.error('[save] Could not merge a committed change into newer text:', error)
        const item = d.findPending(target)
        if (item) d.unmerged.current.set(item[0], mutation.rebase)
        const current = d.session.current === sessionAtAdmission
        return { kind: 'returned', path: target, result, current, integration: item ? 'unmergedDraft' : 'none', latest: item?.[1].content ?? null }
      }
    } finally {
      if (d.inFlight.current.get(laneKey) === claim) d.inFlight.current.delete(laneKey)
      release(saved)
    }
  }, [complete])

  /** `claim`, from `claimPage`, lets its holder admit one change of the page it marked. */
  const mutateDocument = useCallback(<R,>(path: string, mutation: DocumentMutation<R>, claim?: Promise<void>): MutationAdmission<R> => {
    const d = depsRef.current
    const config = d.optionsRef.current
    if (d.admissionHolds.current > 0) return { admitted: false, reason: 'closing' }
    if (config.canPersist === false) return { admitted: false, reason: 'noVault' }
    const lane = d.currentPath(path)
    if (!canWritePathToVault(lane, config.persistenceScope ?? '')) return { admitted: false, reason: 'outsideVault' }
    if (d.isHeld(lane)) return { admitted: false, reason: 'trash' }
    // A page waiting for a recovery choice takes no change until the person chooses.
    if (d.isSaveBlocked(lane)) return { admitted: false, reason: 'busy' }
    const registered = d.findMutation(lane)
    if (registered && registered !== claim) return { admitted: false, reason: 'busy' }
    mutation.flushBuffers?.(lane)
    d.integrate(lane)
    const latest = d.findPending(lane)
    if (latest && mutation.rebase(latest[1].content) === null) return { admitted: false, reason: 'invalidFrontmatter' }
    const done = run(lane, mutation, d.session.current)
    // Under a claim the page stays marked until its holder lets go.
    if (registered) return { admitted: true, path: lane, done }
    d.mutations.current.set(lane, done)
    void done.finally(() => {
      if (d.mutations.current.get(lane) === done) d.mutations.current.delete(lane)
    })
    return { admitted: true, path: lane, done }
  }, [run])

  /** Refuses new changes until the returned function runs; quit and vault switches hold it. */
  const holdMutationAdmission = useCallback(() => {
    depsRef.current.admissionHolds.current += 1
    let open = true
    return () => {
      if (!open) return
      open = false
      depsRef.current.admissionHolds.current -= 1
    }
  }, [])
  /** Resolves once every admitted change has settled; hold admission first so nothing new joins. */
  const whenMutationsIdle = useCallback(async () => {
    const { mutations } = depsRef.current
    while (mutations.current.size > 0) await Promise.allSettled([...mutations.current.values()])
  }, [])
  const pageMutation = useCallback((path: string) => depsRef.current.findMutation(path), [])
  /**
   * Marks the page as changing, like an admitted change, until `release` runs.
   * Null while closing, during a Trash move, or while another change of the page is registered.
   */
  const claimPage = useCallback((path: string): { claim: Promise<void>; release: () => void } | null => {
    const d = depsRef.current
    const lane = d.currentPath(path)
    if (d.admissionHolds.current > 0 || d.isHeld(lane) || d.isSaveBlocked(lane) || d.findMutation(lane)) return null
    let settle = () => {}
    const claim = new Promise<void>(resolve => { settle = resolve })
    d.mutations.current.set(lane, claim)
    const release = () => {
      if (d.mutations.current.get(lane) === claim) d.mutations.current.delete(lane)
      settle()
    }
    return { claim, release }
  }, [])

  return { mutateDocument, holdMutationAdmission, whenMutationsIdle, pageMutation, claimPage }
}
