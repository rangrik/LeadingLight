import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { invoke } from '@tauri-apps/api/core'
import { requestEditorFocus } from '../../hooks/useEditorFocus'
import type {
  CheckAgainResult, FinalApplyResult, FinalResolutionKind, FinalResolutionResult,
  RetriableSave, SaveCopyView, SaveHold, SaveRecoveryApi,
} from '../../hooks/useEditorSave'
import type { OpenReservation } from '../../hooks/useNoteCreation'
import { translate, type AppLocale, type TranslationKey, type TranslationValues } from '../../lib/i18n'
import { isTauri, mockInvoke } from '../../mock-tauri'
import type { VaultEntry } from '../../types'
import { notePathsMatch } from '../../utils/notePathIdentity'
import { editorWorkSettled } from '../editorWork'
import { includesPath, type PageSettlement } from './paneSettlement'

export type SaveHoldBusy = 'check' | 'copy' | 'final'
export interface SaveHoldNotice { key: TranslationKey; values?: TranslationValues }

/** Everything a page's notice shows; built from the queue's own recovery snapshot. */
export interface PageRecoveryView {
  path: string
  hold: SaveHold | null
  retriable: RetriableSave | null
  notDurable: boolean
  copy: SaveCopyView | null
  canKeepCopy: boolean
  busy: SaveHoldBusy | null
  notice: SaveHoldNotice | null
}

interface Options {
  recovery: SaveRecoveryApi
  /** Hands the page's rich and raw buffers to the queue. */
  flushBuffers: (path: string) => void
  settlementRef: RefObject<PageSettlement | null>
  clearUnsaved: (path: string) => void
  /** A copy was created; lists should learn about the new page. */
  onCopyCreated: () => void
  /** Lists a kept copy right away, from its fresh read, without waiting for a full list refresh. */
  addEntry: (entry: VaultEntry) => void
  notify: (message: string) => void
  pageTitle: (path: string) => string
  locale: AppLocale
}

const notice = (key: TranslationKey, values?: TranslationValues): SaveHoldNotice => ({ key, values })

function checkNotice(result: CheckAgainResult): SaveHoldNotice | null {
  if (result.state === 'unknown') return notice('saveHold.check.unknown')
  if (result.state === 'running') return notice('saveHold.tryAgain')
  if (result.state === 'stale') return notice('saveHold.final.stale')
  if (result.state === 'mismatch' || result.state === 'retired' || (result.state === 'done' && result.held)) return notice('saveHold.check.stillHeld')
  return null
}

function resolutionNotice(result: Exclude<FinalResolutionResult, { status: 'prepared' }>): SaveHoldNotice | null {
  if (result.status === 'unknown') return notice('saveHold.final.noReply')
  if (result.status === 'stale') return notice('saveHold.final.stale')
  if (result.status === 'running') return notice('saveHold.tryAgain')
  switch (result.reason) {
    case 'busy': return notice('saveHold.tryAgain')
    case 'noCopy': case 'copyStale': return notice('saveHold.copy.newer')
    case 'copyChanged': case 'copyNotPublished': case 'copyNotOwned': return notice('saveHold.final.copyChanged')
    case 'released': return null
    default: return notice('saveHold.final.refused')
  }
}

const applyNotice = (result: Exclude<FinalApplyResult, { status: 'applied' }>) =>
  notice(result.status === 'resetFailed' ? 'saveHold.newerWords' : 'saveHold.final.stale')

function createdCopy(api: SaveRecoveryApi, path: string) {
  const outcome = api.getSnapshot().copies.find(item => notePathsMatch(item.lane, path))?.outcome
  return outcome?.status === 'created' ? outcome : null
}

interface CopyPage { entry: VaultEntry; content: string }
const local = <T,>(command: string, args: Record<string, unknown>) => isTauri() ? invoke<T>(command, args) : mockInvoke<T>(command, args)

/** The copy as it is on disk now, at its exact path in the bound vault; never the draft that was sent. */
async function readCopy(path: string, vaultPath: string): Promise<CopyPage | null> {
  try {
    const args = { path, vaultPath }
    const [entry, content] = await Promise.all([local<VaultEntry>('reload_vault_entry', args), local<string>('get_note_content', args)])
    if (notePathsMatch(entry?.path, path) && typeof content === 'string') return { entry, content }
    console.warn('[save recovery] The copy read answered for another page:', entry?.path)
  } catch (error) {
    console.warn('[save recovery] The copy could not be read:', error)
  }
  return null
}

/** Opens the copy in the pane that showed the original; never another pane, never over a newer navigation. */
async function openCopy(options: Options, reservation: OpenReservation | null, page: CopyPage) {
  // Called right after apply with no await between, so this is still the session the choice was made in.
  options.addEntry(page.entry)
  if (!reservation) return false
  try {
    const shown = await reservation.open(page.entry, page.content)
    if (shown && reservation.isActive()) requestEditorFocus({ path: page.entry.path })
    return shown
  } catch (error) {
    console.warn('[save recovery] The kept copy could not be opened:', error)
    return false
  }
}

/** The recovery record a person saw when they chose: this session and this request, nothing later. */
interface Intent { session: number; requestId: string }
const recordFor = (api: SaveRecoveryApi, path: string) => {
  const { holds, retriable } = api.getSnapshot()
  return [...holds, ...retriable].find(item => notePathsMatch(item.lane, path)) ?? null
}
const intendedNow = (api: SaveRecoveryApi, path: string, intent: Intent) =>
  api.currentSession() === intent.session && recordFor(api, path)?.request.requestId === intent.requestId
// A record that saved meanwhile needs nothing; a newer one waits for a new choice.
const changedNotice = (api: SaveRecoveryApi, path: string) => recordFor(api, path) ? notice('saveHold.tryAgain') : null

/** Runs after the pane is inert; every exit leaves the page's text and recovery handle as they were, unless applied. */
async function settle(options: Options, path: string, kind: FinalResolutionKind, intent: Intent): Promise<SaveHoldNotice | null> {
  const { recovery: api, flushBuffers, settlementRef } = options
  // Imports accepted before the block finish into the editor first, then everything goes to the queue.
  await editorWorkSettled()
  if (!intendedNow(api, path, intent)) return changedNotice(api, path)
  flushBuffers(path)
  let begun = api.beginFinalResolution(path)
  if (begun.status === 'busy') {
    // Join running work once; a close, switch or Trash hold is not work and is not waited out.
    await api.whenPageIdle(path)
    if (!intendedNow(api, path, intent)) return changedNotice(api, path)
    begun = api.beginFinalResolution(path)
  }
  if (begun.status === 'busy') return notice('saveHold.tryAgain')
  if (begun.status === 'none') return null
  const { final } = begun
  try {
    if (final.bound.session !== intent.session || final.bound.request.requestId !== intent.requestId) return changedNotice(api, path)
    const idle = () => settlementRef.current?.idle(path, final.bound.content) ?? false
    if (!idle()) return notice('saveHold.newerWords')
    const copy = kind === 'keepCopy' ? createdCopy(api, path) : null
    // Read before anything settles: a failed read keeps the page, its words and the native hold as they were.
    const page = copy ? await readCopy(copy.path, final.bound.request.vaultPath) : null
    if (copy && !page) return notice('saveHold.copy.readFailed')
    const proof = await final.resolve(kind)
    if (proof.status !== 'prepared') return resolutionNotice(proof)
    const closed: { reservation: OpenReservation | null } = { reservation: null }
    const applied = final.apply(() => {
      const settlement = settlementRef.current
      if (!settlement || !idle()) return false
      closed.reservation = settlement.close(path)
      return true
    })
    if (applied.status !== 'applied') return applyNotice(applied)
    const t = (key: TranslationKey, values?: TranslationValues) => translate(options.locale, key, values)
    options.clearUnsaved(path)
    const leftovers = applied.leftovers.length > 0 ? ` ${t('saveHold.done.leftovers', { files: applied.leftovers.join(', ') })}` : ''
    if (kind === 'discard' || !copy || !page) {
      options.notify(`${t('saveHold.done.discarded', { title: options.pageTitle(path) })}${leftovers}`)
      return null
    }
    // The choice is applied; only opening can still fail, and the notice says exactly that.
    const shown = await openCopy(options, closed.reservation, page)
    options.notify(`${t(shown ? 'saveHold.done.keptCopy' : 'saveHold.done.keptCopyNotOpened', { path: copy.relativePath })}${leftovers}`)
    return null
  } finally {
    final.release()
  }
}

/** The recovery actions a page's notice offers, in the order the frozen queue protocol requires. */
export function useSaveHoldActions(options: Options) {
  const latest = useRef(options)
  useLayoutEffect(() => { latest.current = options })
  const { recovery } = options
  const snapshot = useSyncExternalStore(recovery.subscribe, recovery.getSnapshot)
  const [blocked, setBlocked] = useState<ReadonlySet<string>>(() => new Set())
  const [pages, setPages] = useState<Readonly<Record<string, { busy: SaveHoldBusy | null; notice: SaveHoldNotice | null; session: number }>>>({})
  const running = useRef(new Set<string>())

  // One action per page path at a time, so an older action's cleanup never touches a newer one.
  const run = useCallback(async (path: string, busy: SaveHoldBusy, action: () => Promise<SaveHoldNotice | null>) => {
    if (running.current.has(path)) return
    running.current.add(path)
    // Its result belongs to the session it started in; a later visit to the same path never shows it.
    const session = latest.current.recovery.currentSession()
    setPages(current => ({ ...current, [path]: { busy, notice: null, session } }))
    let result: SaveHoldNotice | null = null
    try {
      result = await action()
    } catch (error) {
      console.warn('[save recovery] The action did not finish:', error)
      result = notice('saveHold.final.refused')
    } finally {
      running.current.delete(path)
      setPages(current => ({ ...current, [path]: { busy: null, notice: result, session } }))
    }
  }, [])

  const checkAgain = useCallback((path: string) =>
    run(path, 'check', async () => checkNotice(await latest.current.recovery.checkAgain(path))), [run])

  const saveCopy = useCallback((path: string, folder: string | null) => run(path, 'copy', async () => {
    const { recovery: api, flushBuffers, onCopyCreated } = latest.current
    // Copying never blocks writing; it takes the text on screen right now.
    flushBuffers(path)
    const result = await api.saveDraftCopy(path, folder)
    if (result.status === 'done' && result.outcome?.status === 'created') onCopyCreated()
    // A copy's outcome stays in the queue's snapshot and shows from there.
    return result.status === 'stale' ? notice('saveHold.final.stale') : null
  }), [run])

  const finish = useCallback((path: string, kind: FinalResolutionKind) => {
    // Taken at the click, before any wait, so a later save, vault switch or new record cannot inherit this choice.
    const api = latest.current.recovery
    const record = recordFor(api, path)
    if (!record) return Promise.resolve()
    const intent: Intent = { session: api.currentSession(), requestId: record.request.requestId }
    return run(path, 'final', async () => {
      // Committed before anything waits: no typing, paste, drop or page command reaches the pane now.
      flushSync(() => setBlocked(current => new Set(current).add(path)))
      try {
        return await settle(latest.current, path, kind, intent)
      } finally {
        setBlocked(current => { const next = new Set(current); next.delete(path); return next })
      }
    })
  }, [run])

  const viewFor = useCallback((path: string): PageRecoveryView => {
    const lane = <T extends { lane: string }>(items: readonly T[]) => items.find(item => notePathsMatch(item.lane, path)) ?? null
    const page = pages[path]
    return {
      path,
      hold: lane(snapshot.holds),
      retriable: lane(snapshot.retriable),
      notDurable: includesPath(snapshot.notDurable, path),
      copy: lane(snapshot.copies),
      canKeepCopy: recovery.canKeepCopy(path),
      busy: page?.busy ?? null,
      notice: page && page.session === recovery.currentSession() ? page.notice : null,
    }
  }, [pages, recovery, snapshot])

  return { snapshot, blockedPaths: blocked, viewFor, checkAgain, saveCopy, finish }
}

export type SaveHoldActions = ReturnType<typeof useSaveHoldActions>
