import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { VaultEntry } from '../types'
import { notePathsMatch } from '../utils/notePathIdentity'
import { editorWorkSettled } from './editorWork'
import { moveToLocalTrash, restoreFromLocalTrash, type TrashMoved, type TrashRestoreResult } from './localTrash'

type Named = TrashMoved & { title: string }

export interface TrashMoveOutcome {
  moved: Named[]
  /** Moved, but newer text arrived meanwhile: the page stays with that text and an older copy is in Trash. */
  changed: Named[]
  /** Moved, but the open page could not be checked afterwards, so it stays open and keeps saving. */
  uncertain: Named[]
  failed: { path: string, title: string, code: string }[]
  /** The whole request was refused; nothing moved. */
  unavailable: boolean
}

/** A finished move as shown to the user; Undo only acts in the vault session the move ran in. */
export interface TrashNoticeState {
  outcome: TrashMoveOutcome
  undo: () => Promise<TrashRestoreResult | null>
}

export type TrashActivity = 'move' | 'restore' | null
export type HeldWriteAction = 'discard' | 'resume' | 'release'

export interface LocalTrashOptions {
  vaultPath: string
  entries: VaultEntry[]
  /** Writes the page's latest text, settles automatic renames, and returns the path to move. */
  prepare: (path: string) => Promise<string>
  /** Pushes editor buffers for a page into the save queue. */
  flushBuffers: (path: string) => void
  hasPendingWrite: (path: string) => boolean
  holdWrites: (paths: readonly string[]) => void
  releaseHeldWrites: (paths: readonly string[], action: HeldWriteAction) => void
  closePages: (paths: readonly string[]) => void
  removeEntries: (paths: string[]) => void
  addEntry: (entry: VaultEntry) => void
  clearUnsaved: (path: string) => void
  markInternalWrite: (path: string) => void
  reloadVault: () => unknown
  afterChange?: () => void
  /** True while the app is closing or switching vaults; new moves and restores are refused. */
  isBlocked?: () => boolean
}

/** Everything an operation needs, fixed when the user asks for it. */
interface Origin {
  epoch: number
  options: LocalTrashOptions
  titles: Map<string, string>
}

interface Target { original: string, path: string }

function titleFor(entries: VaultEntry[], path: string): string {
  const entry = entries.find(item => notePathsMatch(item.path, path))
  return entry?.title || entry?.filename || path.split('/').pop() || path
}

async function prepareTargets(origin: Origin, requested: string[], held: string[]) {
  const o = origin.options
  const targets: Target[] = []
  const failed: string[] = []
  // Pasted or dropped images still copying would otherwise change the page after its last save.
  await editorWorkSettled()
  for (const path of requested) {
    try {
      const settled = await o.prepare(path)
      if (!held.includes(settled)) held.push(settled)
      targets.push({ original: path, path: settled })
    } catch {
      // Its latest text is not on disk, so the page is not moved.
      failed.push(path)
    }
  }
  return { targets, failed }
}

/** After the native move: a page with newer text stays; a page that cannot be checked stays too. */
function settleMovedPage(o: LocalTrashOptions, item: Named): 'moved' | 'changed' | 'uncertain' {
  try {
    o.flushBuffers(item.path)
    return o.hasPendingWrite(item.path) ? 'changed' : 'moved'
  } catch {
    return 'uncertain'
  }
}

/**
 * Moves pages to the vault's local Trash and restores them, one operation at a time.
 * Each operation keeps the vault session it was requested in; only confirmed pages leave the app.
 */
export function useLocalTrash(options: LocalTrashOptions) {
  const latest = useRef(options)
  useLayoutEffect(() => { latest.current = options })
  // Leaving and returning to a vault starts a new session; nothing from an older one acts in it.
  const [sessionState, setSessionState] = useState({ vaultPath: options.vaultPath, epoch: 0 })
  if (sessionState.vaultPath !== options.vaultPath) setSessionState({ vaultPath: options.vaultPath, epoch: sessionState.epoch + 1 })
  const session = useRef(sessionState)
  useLayoutEffect(() => { session.current = sessionState }, [sessionState])
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const blockers = useRef(0)
  // Pages moved since the listing last changed, so a queued repeat is not reported as a failure.
  const recentlyMoved = useRef(new Set<string>())
  useLayoutEffect(() => { recentlyMoved.current.clear() }, [options.entries])
  const pendingCount = useRef(0)
  const [activity, setActivity] = useState<TrashActivity>(null)
  const [notice, setNotice] = useState<(TrashNoticeState & { epoch: number }) | null>(null)
  const focusBefore = useRef<Element | null>(null)

  const capture = useCallback((): Origin => {
    const current = latest.current
    return { epoch: session.current.epoch, options: current, titles: new Map(current.entries.map(entry => [entry.path, entry.title || entry.filename])) }
  }, [])
  const inSession = useCallback((origin: Origin) => session.current.epoch === origin.epoch, [])
  const admits = useCallback(() => blockers.current === 0 && !latest.current.isBlocked?.(), [])

  const enqueue = useCallback(<T,>(kind: 'move' | 'restore', task: () => Promise<T>): Promise<T> => {
    if (pendingCount.current++ === 0) focusBefore.current = document.activeElement
    const start = () => { setActivity(kind); return task() }
    const run = queue.current.then(start, start)
    queue.current = run.catch(() => undefined)
    return run.finally(() => { if (--pendingCount.current === 0) setActivity(null) })
  }, [])

  // The app is inert while busy; give focus back to whatever still exists, so the other pane keeps its caret.
  const busy = activity !== null
  useEffect(() => {
    if (busy) return
    const element = focusBefore.current
    focusBefore.current = null
    if (element instanceof HTMLElement && element.isConnected && !element.closest('[inert]')) element.focus({ preventScroll: true })
  }, [busy])

  const runMove = useCallback(async (origin: Origin, paths: string[]): Promise<TrashMoveOutcome | null> => {
    const o = origin.options
    // A request from an earlier visit to this vault is not reinterpreted in the current one.
    if (!inSession(origin) || !o.vaultPath) return null
    const requested = [...new Set(paths)].filter(path => ![...recentlyMoved.current].some(gone => notePathsMatch(gone, path)))
    if (requested.length === 0) return null
    const title = (path: string) => origin.titles.get(path) ?? titleFor(o.entries, path)
    const held = [...requested]
    o.holdWrites(held)
    const outcome: TrashMoveOutcome = { moved: [], changed: [], uncertain: [], failed: [], unavailable: false }
    const release = new Map<string, HeldWriteAction>()
    try {
      const { targets, failed } = await prepareTargets(origin, requested, held)
      outcome.failed = failed.map(path => ({ path, title: title(path), code: 'saveFailed' }))
      if (targets.length > 0) {
        targets.forEach(target => o.markInternalWrite(target.path))
        let result
        try {
          result = await moveToLocalTrash(o.vaultPath, [...new Set(targets.map(target => target.path))])
        } catch {
          outcome.unavailable = true
          return session.current.epoch === origin.epoch ? outcome : null
        }
        const originalOf = (path: string) => targets.find(target => target.path === path)?.original ?? path
        outcome.failed.push(...result.failed.map(item => ({ path: item.path, title: title(originalOf(item.path)), code: item.code })))
        // Every confirmed move is recorded before any editor work, so its id is never lost.
        for (const item of result.moved) {
          const named = { ...item, title: title(originalOf(item.path)) }
          const state = settleMovedPage(o, named)
          outcome[state].push(named)
          if (state !== 'moved') continue
          for (const path of held) if (notePathsMatch(path, item.path) || notePathsMatch(path, originalOf(item.path))) release.set(path, 'discard')
        }
      }
    } finally {
      const current = inSession(origin)
      // Another session's queue is not touched beyond lifting this operation's own hold.
      for (const path of held) o.releaseHeldWrites([path], current ? release.get(path) ?? 'resume' : 'release')
    }
    if (!inSession(origin)) return null
    const gone = held.filter(path => release.get(path) === 'discard')
    try {
      if (gone.length > 0) {
        gone.forEach(path => recentlyMoved.current.add(path))
        o.closePages(gone)
        o.removeEntries(gone)
        gone.forEach(path => o.clearUnsaved(path))
      }
      if (gone.length > 0 || outcome.changed.length > 0 || outcome.uncertain.length > 0) o.afterChange?.()
    } catch {
      // The move itself is done and reported; a listing refresh corrects any view left behind.
    }
    return outcome
  }, [inSession])

  const runRestore = useCallback(async (origin: Origin, ids: string[]): Promise<TrashRestoreResult | null> => {
    const o = origin.options
    if (!inSession(origin)) return null
    let result: TrashRestoreResult
    try {
      result = await restoreFromLocalTrash(o.vaultPath, ids)
    } catch {
      return { restored: [], failed: ids.map(id => ({ id, code: 'unavailable', message: '' })) }
    }
    if (!inSession(origin)) return null
    for (const item of result.restored) {
      o.markInternalWrite(item.path)
      for (const gone of [...recentlyMoved.current]) if (notePathsMatch(gone, item.path)) recentlyMoved.current.delete(gone)
      if (item.entry) o.addEntry(item.entry)
    }
    if (result.restored.some(item => !item.entry)) await o.reloadVault()
    if (result.restored.length > 0) o.afterChange?.()
    return result
  }, [inSession])

  const restoreIn = useCallback((origin: Origin, ids: string[]) => {
    if (!admits() || !inSession(origin)) return Promise.resolve(null)
    return enqueue('restore', () => runRestore(origin, ids))
  }, [admits, enqueue, inSession, runRestore])

  const moveToTrash = useCallback((paths: string[]) => {
    if (!admits()) return Promise.resolve(null)
    const origin = capture()
    return enqueue('move', () => runMove(origin, paths)).then(outcome => {
      if (outcome && inSession(origin)) {
        const ids = [...outcome.moved, ...outcome.uncertain].map(item => item.id)
        setNotice({ epoch: origin.epoch, outcome, undo: () => restoreIn(origin, ids) })
      }
      return outcome
    })
  }, [admits, capture, enqueue, inSession, restoreIn, runMove])
  const restore = useCallback((ids: string[]) => restoreIn(capture(), ids), [capture, restoreIn])

  /** Refuses new moves and restores until the returned function runs; quit and vault switches hold it. */
  const holdAdmission = useCallback(() => {
    blockers.current += 1
    let held = true
    return () => {
      if (!held) return
      held = false
      blockers.current -= 1
    }
  }, [])
  /** Resolves once the queue is empty and stays empty; hold admission first so nothing new joins. */
  const whenIdle = useCallback(async () => {
    let tail: Promise<unknown>
    do {
      tail = queue.current
      await tail
    } while (tail !== queue.current)
  }, [])
  const dismissNotice = useCallback(() => setNotice(null), [])
  const visibleNotice = notice && notice.epoch === sessionState.epoch ? notice : null
  return { moveToTrash, restore, whenIdle, holdAdmission, busy, activity, notice: visibleNotice, dismissNotice }
}
