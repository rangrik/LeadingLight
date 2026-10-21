// The website host: "From website…" and its palette entry, the website dialog for a website
// command's opening, and the Undo notice under a saved page. Fetch is the native page fetch through
// the flow; the write is the recipe's run through the extension controller: one guarded create per
// opening, Check again for an unconfirmed one, and the session's Undo. No other path writes.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { requestEditorFocus } from '../../hooks/useEditorFocus'
import type { RunPageExclusive } from '../../hooks/useAppSave'
import type { OpenReservation } from '../../hooks/useNoteCreation'
import type { AppLocale } from '../../lib/i18n'
import type { FolderNode, VaultEntry } from '../../types'
import { joinVaultPath, normalizeNotePathForIdentity, notePathsCollide, notePathsMatch } from '../../utils/notePathIdentity'
import { flattenRetargetFolders } from '../../utils/noteRetargetingPaths'
import type { NoticeState } from '../commentary/CommentaryNotices'
import { ExtensionChooserDialog } from '../extensions/ExtensionChooserDialog'
import {
  displayPathFor, isWebCaptureCommand, webCaptureCommands,
  type CreateOutcome, type CreatedPage, type OpenTarget, type RunOpening, type UndoOutcome,
} from '../extensions/extensionSessionController'
import { translator } from '../extensions/extensionUiText'
import type { RunStart } from '../extensions/useExtensionUi'
import type { Extensions } from '../extensions/useExtensions'
import type { UndoOffer } from '../proposals/proposalUndoContract'
import type { WebCaptureFolder } from './WebCaptureDialog'
import { findSavedCopies, savedSourceEntries } from './webCaptureDuplicates'
import { webCaptureEntry } from './webCaptureEntry'
import { createWebCaptureFlow, type WebCaptureFlow } from './webCaptureFlow'
import { webCaptureLabels, webCaptureMediaLabels } from './webCaptureLocale'
import type { WebPageCaptureValue } from './webCapturePageStore'
import { WebCaptureRunDialog } from './WebCaptureRunDialog'
import { createWebCaptureTransport, type WebCaptureTransport } from './webCaptureTransport'
import { WebCaptureUndoNotice } from './WebCaptureUndoNotice'

export interface WebCaptureWorkspace {
  readonly paths: readonly [string | null, string | null]
  readonly activePane: 0 | 1
  readonly split: boolean
}

export interface WebCaptureUiOptions {
  locale: AppLocale
  vaultPath: string
  extensions: Extensions
  folders: FolderNode[]
  entries: VaultEntry[]
  /** False while the note list is still loading: "saved before" then says it may be incomplete. */
  listingComplete: boolean
  /** The open pages, as state, so a notice notices its note changing. */
  tabs: readonly { entry: VaultEntry; content: string }[]
  /** Which pages are shown, so a notice ends once its pane has left its note. */
  workspace: WebCaptureWorkspace
  /** The split workspace's request-time pane reservation (notes.reserveOpen). */
  reserveOpen: () => OpenReservation
  runPageExclusive: RunPageExclusive
  addEntry: (entry: VaultEntry) => void
  markInternalWrite: (path: string) => void
  onPersisted: (path: string) => void
  notify: (message: string) => void
  /** A saved note Undo moved to Trash: close it where shown and forget it in the listing. */
  onTrashed: (path: string) => void
  /** Opens an existing note (a saved copy). */
  onOpenSaved: (path: string) => void
  onOpenInBrowser: (url: string) => void
  /** False while the workspace is still loading or a draft owns input. */
  canOpen: () => boolean
  /** True while the window closes or switches, or another workspace-wide action holds still. */
  blocked: boolean
  /** Tests only: the native fetch. */
  transport?: WebCaptureTransport
}

type DialogState =
  | { readonly kind: 'chooser' }
  | { readonly kind: 'run'; readonly id: number; readonly opening: RunOpening; readonly target: OpenTarget; readonly flow: WebCaptureFlow; readonly initialFolder: string }

interface Notice {
  readonly id: number
  readonly path: string
  /** The exact bytes written; the notice ends once its note is anything else. */
  readonly postimage: string
  readonly site: string
  readonly durable: boolean
  readonly offer: UndoOffer
  readonly state: NoticeState
  readonly seen: boolean
}

const NOTICE_LIMIT = 8
const FOLDER_MEMORY_LIMIT = 50
const folderMemoryKey = (vaultPath: string) => `leadinglight.webCaptureFolders:${vaultPath}`

function readFolderMemory(vaultPath: string): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(folderMemoryKey(vaultPath)) ?? '{}')
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([, folder]) => typeof folder === 'string')) as Record<string, string>
  } catch {
    return {}
  }
}

function rememberFolder(vaultPath: string, key: string, folder: string) {
  const memory = readFolderMemory(vaultPath)
  delete memory[key]
  const kept = [...Object.entries(memory), [key, folder] as const].slice(-FOLDER_MEMORY_LIMIT)
  try { localStorage.setItem(folderMemoryKey(vaultPath), JSON.stringify(Object.fromEntries(kept))) } catch { /* Only a default. */ }
}

function noticeAfter(outcome: UndoOutcome | 'busy' | 'settleFailed'): NoticeState | 'undone' {
  if (outcome === 'busy') return { step: 'busy' }
  if (outcome === 'settleFailed') return { step: 'blocked', reason: 'changed' }
  switch (outcome.status) {
    case 'undone': return 'undone'
    case 'conflict': return { step: 'blocked', reason: outcome.reason }
    case 'refused':
      if (outcome.reason === 'busy') return { step: 'busy' }
      return { step: 'blocked', reason: outcome.reason === 'storageUnavailable' || outcome.reason === 'preimageUnavailable' ? 'notUndone' : 'unavailable' }
    case 'uncertain': return { step: 'uncertain', operationId: outcome.operationId, checking: false }
    case 'unanswered': return { step: 'uncertain', operationId: outcome.operationId, checking: false }
  }
}

function useLatest<T>(value: T): () => T {
  const ref = useRef(value)
  useLayoutEffect(() => { ref.current = value })
  return useCallback(() => ref.current, [])
}

/** One dialog at a time; focus returns to what opened the first of a sequence (chooser, then run). */
function useDialogStack() {
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const current = useRef<DialogState | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const focusMoved = useRef(false)
  const actions = useMemo(() => ({
    show(next: DialogState) {
      if (!current.current) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      current.current = next
      setDialog(next)
    },
    /** `focusMovedOn`: the closing dialog already put focus somewhere useful. */
    hide(focusMovedOn = false) {
      focusMoved.current = focusMovedOn
      current.current = null
      setDialog(null)
    },
    moveFocusOn() { focusMoved.current = true },
    isOpen: () => current.current !== null,
    onCloseAutoFocus(event: Event) {
      if (current.current) return
      event.preventDefault()
      if (focusMoved.current) { focusMoved.current = false; return }
      if (opener.current?.isConnected) opener.current.focus()
    },
  }), [])
  return { dialog, ...actions }
}

export function useWebCaptureUi(options: WebCaptureUiOptions) {
  const latest = useLatest(options)
  const { locale, extensions, folders, entries, listingComplete, vaultPath } = options
  const { controller, snapshot } = extensions
  const t = useMemo(() => translator(locale), [locale])
  const commands = useMemo(() => webCaptureCommands(snapshot), [snapshot])
  const { dialog, show, hide, moveFocusOn, isOpen, onCloseAutoFocus } = useDialogStack()
  const runs = useRef(0)
  const [transport] = useState(() => options.transport ?? createWebCaptureTransport())
  const [notices, setNotices] = useState<ReadonlyMap<string, Notice>>(new Map())
  const noticesRef = useRef(notices)
  useLayoutEffect(() => { noticesRef.current = notices })

  const folderOptions = useMemo<WebCaptureFolder[]>(
    () => [{ path: '', label: t('leadinglight.extensions.rootFolder') }, ...flattenRetargetFolders(folders)], [folders, t])
  const labels = useMemo(() => webCaptureLabels(t, path => {
    const relative = displayPathFor(latest().vaultPath, path)
    const slash = relative.lastIndexOf('/')
    return slash > 0 ? relative.slice(0, slash) : t('leadinglight.extensions.rootFolder')
  }), [latest, t])
  const mediaLabels = useMemo(() => webCaptureMediaLabels(t), [t])
  const savedEntries = useMemo(() => savedSourceEntries(entries), [entries])
  const savedCopies = useCallback((urls: readonly string[]) => findSavedCopies(urls, savedEntries, { listingComplete }), [listingComplete, savedEntries])

  // --- Notices ---

  const retire = useCallback((path: string, release: boolean) => {
    const notice = noticesRef.current.get(normalizeNotePathForIdentity(path))
    if (!notice) return
    if (release) controller.releaseUndo(notice.offer)
    setNotices(current => { const next = new Map(current); next.delete(normalizeNotePathForIdentity(path)); return next })
  }, [controller])
  const setNoticeState = useCallback((path: string, state: NoticeState) => {
    setNotices(current => {
      const key = normalizeNotePathForIdentity(path)
      const notice = current.get(key)
      return notice ? new Map(current).set(key, { ...notice, state }) : current
    })
  }, [])

  /**
   * A Save or Check again answered: a note this opening created is offered for Undo, once, and only
   * while its workspace is still the one shown; a late answer for a workspace left behind offers none.
   */
  const answered = useCallback((opening: RunOpening, outcome: CreateOutcome, webPage: WebPageCaptureValue | null) => {
    if ((outcome.status !== 'opened' && outcome.status !== 'created') || !outcome.undo || !webPage) return
    if (controller.revokedReason(opening) === 'workspace') return
    const { page, durable, undo: offer } = outcome
    const key = normalizeNotePathForIdentity(page.path)
    if (noticesRef.current.get(key)?.offer === offer) return
    setNotices(current => {
      const older = current.get(key)
      if (older?.offer === offer) return current
      if (older) controller.releaseUndo(older.offer)
      const next = new Map(current)
      next.delete(key)
      next.set(key, { id: ++runs.current, path: page.path, postimage: page.content, site: webPage.siteName, durable, offer, state: { step: 'offered' }, seen: false })
      // Bounded: the oldest notices give their Undo back first.
      for (const [path, notice] of next) {
        if (next.size <= NOTICE_LIMIT) break
        controller.releaseUndo(notice.offer)
        next.delete(path)
      }
      return next
    })
  }, [controller])

  // A notice ends with the next change to its note or once its pane has left it; Page history stays.
  const { tabs, workspace } = options
  const [firstPath, secondPath] = workspace.paths
  const shownPaths = useMemo(() => (workspace.split ? [firstPath, secondPath] : [workspace.activePane === 0 ? firstPath : secondPath])
    .filter((path): path is string => !!path), [firstPath, secondPath, workspace.activePane, workspace.split])
  useEffect(() => {
    for (const notice of noticesRef.current.values()) {
      if (notice.state.step === 'undoing' || notice.state.step === 'uncertain') continue
      const shown = shownPaths.some(path => notePathsMatch(path, notice.path))
      const tab = tabs.find(item => notePathsMatch(item.entry.path, notice.path))
      if (shown && !notice.seen) {
        setNotices(current => {
          const key = normalizeNotePathForIdentity(notice.path)
          const now = current.get(key)
          return now && now.id === notice.id ? new Map(current).set(key, { ...now, seen: true }) : current
        })
      }
      if ((notice.seen && !shown) || (tab && tab.content !== notice.postimage)) retire(notice.path, true)
    }
  }, [retire, shownPaths, tabs])
  // A new vault visit: every earlier Undo belongs to a closed session.
  useEffect(() => () => { setNotices(new Map()) }, [vaultPath])

  const runUndo = useCallback(async (path: string, ask: (notice: Notice) => Promise<UndoOutcome>) => {
    const notice = noticesRef.current.get(normalizeNotePathForIdentity(path))
    if (!notice) return
    let published = false
    const box: { outcome: UndoOutcome | 'busy' | 'settleFailed' } = { outcome: 'busy' }
    // The note's own lane: its unsaved words are saved first, so Undo can only ever see the exact bytes.
    await latest().runPageExclusive(notice.path, async mutate => {
      const admission = mutate(notice.path, {
        publish: async () => { published = true; return ask(notice) },
        committedContent: () => null,
        rebase: text => (published ? null : text),
      })
      if (!admission.admitted) return false
      const settled = await admission.done
      box.outcome = settled.kind === 'returned' ? settled.result : settled.kind === 'notRun' ? 'settleFailed' : 'busy'
      return true
    })
    const next = noticeAfter(box.outcome)
    if (next !== 'undone') { setNoticeState(notice.path, next); return }
    retire(notice.path, false)
    latest().onTrashed(notice.path)
    latest().notify(t('leadinglight.webCapture.notice.undone'))
  }, [latest, retire, setNoticeState, t])

  const undo = useCallback((path: string) => {
    const notice = noticesRef.current.get(normalizeNotePathForIdentity(path))
    if (!notice || notice.state.step === 'undoing' || notice.state.step === 'uncertain' || notice.state.step === 'blocked') return
    setNoticeState(path, { step: 'undoing' })
    void runUndo(path, current => controller.undo(current.offer))
  }, [controller, runUndo, setNoticeState])
  const checkUndo = useCallback((path: string) => {
    const notice = noticesRef.current.get(normalizeNotePathForIdentity(path))
    if (notice?.state.step !== 'uncertain' || notice.state.checking) return
    const { operationId } = notice.state
    setNoticeState(path, { step: 'uncertain', operationId, checking: true })
    // Only ever asks about that press; never presses again.
    void runUndo(path, current => controller.recheckUndo(current.offer, operationId))
  }, [controller, runUndo, setNoticeState])

  const renderNotice = useCallback((path: string): ReactNode => {
    const notice = notices.get(normalizeNotePathForIdentity(path))
    if (!notice) return null
    return <WebCaptureUndoNotice t={t} view={{ site: notice.site, durable: notice.durable, canUndo: true, state: notice.state }}
      onUndo={() => undo(notice.path)} onCheckAgain={() => checkUndo(notice.path)} onDismiss={() => retire(notice.path, true)} />
  }, [checkUndo, notices, retire, t, undo])

  // --- Openings ---

  const makeTarget = useCallback((reservation: OpenReservation, onCommitted?: (page: CreatedPage) => void): OpenTarget => ({
    beforeWrite: path => latest().markInternalWrite(path),
    committed(page) {
      onCommitted?.(page)
      // Never into another vault's listing: the reservation knows the vault session it was taken in.
      if (!reservation.inSession()) return
      latest().onPersisted(page.path)
      latest().addEntry(webCaptureEntry(page))
    },
    async open(page, stillCurrent) {
      if (!stillCurrent() || !reservation.inSession()) return false
      // The split opener asks the run's own guard again at placement, after the outgoing save; a
      // revoked or cancelled run places nothing, and an unsaved pane is never replaced unsaved.
      const shown = await reservation.open(webCaptureEntry(page), page.content, stillCurrent)
      if (shown && stillCurrent() && reservation.isActive()) requestEditorFocus({ path: page.path, cursorAtEnd: true })
      return shown
    },
  }), [latest])

  /** Opens a website command's dialog, replacing the chooser when chosen from it. */
  const start = useCallback((key: string, onCommitted?: (page: CreatedPage) => void, expectedSha256?: string): RunStart => {
    if (latest().blocked || !latest().canOpen()) return 'notOpened'
    const opening = controller.openRun(key)
    if (!opening) return 'notOpened'
    if (!isWebCaptureCommand(opening.runnable.command)) { controller.cancel(opening); return 'notOpened' }
    if (expectedSha256 !== undefined && opening.runnable.packageSha256 !== expectedSha256) { controller.cancel(opening); return 'changed' }
    const remembered = readFolderMemory(opening.visit.vaultPath)[key] ?? ''
    // A remembered folder is offered only while the host still lists it; native checks it again.
    const initialFolder = folderOptions.some(option => option.path === remembered) ? remembered : ''
    const flow = createWebCaptureFlow({ transport, convertOptions: { mediaLabels } })
    show({ kind: 'run', id: ++runs.current, opening, target: makeTarget(latest().reserveOpen(), onCommitted), flow, initialFolder })
    return 'opened'
  }, [controller, folderOptions, latest, makeTarget, mediaLabels, show, transport])

  /** A website command by key (the chooser, Settings' Try it, Adapt's Try): the same as E1's `openRun`. */
  const openRun = useCallback((key: string, onCommitted?: (page: CreatedPage) => void, expectedSha256?: string): RunStart =>
    (isOpen() ? 'notOpened' : start(key, onCommitted, expectedSha256)), [isOpen, start])

  /** From website…: one website command opens directly; several open the chooser, listing only them. */
  const openFromWebsite = useCallback(() => {
    if (isOpen() || latest().blocked || !latest().canOpen()) return
    const available = webCaptureCommands(controller.snapshot())
    if (available.length === 1) start(available[0].key)
    else if (available.length > 1) show({ kind: 'chooser' })
  }, [controller, isOpen, latest, show, start])

  const renderDialog = (state: DialogState) => {
    if (state.kind === 'chooser') {
      return <ExtensionChooserDialog locale={locale} commands={commands} onCloseAutoFocus={onCloseAutoFocus} onClose={() => hide()}
        onChoose={key => { if (start(key) !== 'opened') hide() }} />
    }
    const { opening } = state
    const { vaultPath: runVault } = opening.visit
    return <WebCaptureRunDialog key={state.id} locale={locale} labels={labels} controller={controller} opening={opening} target={state.target}
      flow={state.flow} folders={folderOptions} initialFolder={state.initialFolder}
      findSavedCopies={savedCopies}
      pageExists={relative => entries.some(entry => notePathsCollide(entry.path, joinVaultPath(runVault, relative)))}
      onOutcome={(outcome, webPage) => answered(opening, outcome, webPage)}
      onOpenSaved={path => {
        moveFocusOn()
        latest().onOpenSaved(path)
        requestEditorFocus({ path })
      }}
      onOpenInBrowser={url => latest().onOpenInBrowser(url)}
      onRemember={folder => rememberFolder(runVault, opening.runnable.key, folder)}
      onNotice={message => latest().notify(message)} onCloseAutoFocus={onCloseAutoFocus}
      onClose={handled => hide(handled)} />
  }

  return {
    commands,
    hasCommands: commands.length > 0,
    openFromWebsite, openRun, renderNotice,
    dialogs: dialog ? renderDialog(dialog) : null,
    isOpen,
  }
}

export type WebCaptureUi = ReturnType<typeof useWebCaptureUi>
