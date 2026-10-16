import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { SetStateAction } from 'react'
import { useSaveNote } from './useSaveNote'
import { cacheNoteContent } from './useTabManagement'
import { createTranslator, type AppLocale } from '../lib/i18n'
import { canWritePathToVault } from '../utils/vaultPathContainment'
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
type LaneOutcome = { seq: number; outcome: 'saved' | 'dropped' | 'trashed' }
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
  const { saveNote } = useSaveNote(updateSavedContent)
  const cancelTimer = useCallback((path?: string) => {
    for (const [key, timer] of timers.current) {
      if (path && currentPath(key) !== currentPath(path)) continue
      clearTimeout(timer)
      timers.current.delete(key)
    }
  }, [currentPath])
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
    }
    for (const path of [...unmerged.current.keys()]) if (!findPending(path)) unmerged.current.delete(path)
  }, [cancelTimer, currentPath, findPending, recordOutcome, scopeKey])
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
  const flushPath = useCallback(async function flushDocument(path: string, drain = true, force = false): Promise<boolean> {
    cancelTimer(path)
    if (optionsRef.current.canPersist === false) return false
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
      const resolved = currentPath(snapshot.path)
      const target = config.resolvePathBeforeSave ? await config.resolvePathBeforeSave(resolved) : resolved
      if (!canWritePathToVault(target, optionsRef.current.persistenceScope ?? '')) {
        if (pending.current.get(key) === snapshot) {
          pending.current.delete(key)
          recordOutcome(target, snapshot.seq, 'dropped')
        }
        return false
      }
      config.onBeforePersist?.(target)
      await saveNote(target, snapshot.content)
      if (pending.current.get(key) !== snapshot) return false
      pending.current.delete(key)
      recordOutcome(target, snapshot.seq, 'saved')
      optionsRef.current.onNotePersisted?.(target, snapshot.content)
      return true
    }
    const promise = persist()
    inFlight.current.set(lane, promise)
    let saved: boolean
    try { saved = await promise } finally {
      if (inFlight.current.get(lane) === promise) inFlight.current.delete(lane)
    }
    return drain && findPending(path) ? flushDocument(path, drain, force) : saved
  }, [cancelTimer, currentPath, findPending, integrate, recordOutcome, saveNote])
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
    const message = errorMessage(error)
    const invalid = /os error 123|filename, directory name, or volume label syntax is incorrect|path is invalid on this platform/i.test(message)
    optionsRef.current.setToastMessage(invalid ? t('save.error.invalidPath') : t('save.error.failed', { error: message }))
  }, [t])
  const scheduleAutosave = useCallback((key: string) => {
    cancelTimer(key)
    if (optionsRef.current.canPersist === false) return
    timers.current.set(key, setTimeout(() => {
      timers.current.delete(key)
      void flushPath(key, false).then(saved => {
        if (saved) optionsRef.current.onAfterSave?.()
      }).catch(error => { console.error('Auto-save failed:', error); showFailure(error) })
    }, AUTO_SAVE_DEBOUNCE_MS))
  }, [cancelTimer, flushPath, showFailure])
  const handleContentChange = useCallback((path: string, content: string): ContentReceipt | null => {
    const target = currentPath(path)
    if (!canWritePathToVault(target, optionsRef.current.persistenceScope ?? '')) return null
    const old = findPending(path)
    const key = old?.[0] ?? target
    const seq = ++admissions.current
    pending.current.set(key, { path: target, content, seq })
    updateTabs(target, content)
    scheduleAutosave(key)
    return Object.freeze({ path: target, content, session: session.current, seq })
  }, [currentPath, findPending, scheduleAutosave, updateTabs])
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
      if (fallback && !hadPendingFallback && !saved && !isHeld(fallback.path)) {
        pending.current.set(fallback.path, { ...fallback, seq: ++admissions.current })
        saved = await savePendingForPath(fallback.path)
      }
      config.setToastMessage(saved ? t('save.toast.saved') : t('save.toast.nothingToSave'))
      config.onAfterSave?.()
      return true
    } catch (error) { console.error('Save failed:', error); showFailure(error); return false }
  }, [cancelTimer, findPending, isHeld, savePending, savePendingForPath, showFailure, t])
  const mutation = useDocumentMutations({
    optionsRef, pending, inFlight, mutations, admissionHolds, unmerged, changeWrites, session,
    currentPath, findPending, findInFlight, findMutation, isHeld, integrate, flushPath, replacePending, updateSavedContent,
  })
  /** Whether this session wrote, or moved to Trash, the page's text from this admission or a later one. */
  const receiptStatus = useCallback((receipt: Pick<ContentReceipt, 'path' | 'session' | 'seq'>): ReceiptStatus => {
    if (receipt.session !== session.current) return 'unproven'
    if (hasPendingWrite(receipt.path)) return 'pending'
    const lane = currentPath(receipt.path)
    const last = [...outcomes.current].find(([key]) => currentPath(key) === lane)?.[1]
    return last && last.seq >= receipt.seq && last.outcome !== 'dropped' ? 'settled' : 'unproven'
  }, [currentPath, hasPendingWrite])
  return { handleContentChange, handleSave, savePending, savePendingForPath, holdAutosave, releaseAutosave, hasPendingWrite, receiptStatus, drainHeld, isHeld, ...mutation }
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
    if (d.admissionHolds.current > 0 || d.isHeld(lane) || d.findMutation(lane)) return null
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
