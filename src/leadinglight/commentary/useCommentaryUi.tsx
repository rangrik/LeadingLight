// The passage commentary host: the toolbar and palette action, the run dialog, opening the note
// beside its source, the Undo notice, the Commentary header button and the source card. The run
// itself is the recipe's, through the extension controller; preparation is the commentary domain's,
// injected as services. Core association (header button, card, opening) needs no recipe.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { requestEditorFocus } from '../../hooks/useEditorFocus'
import type { RunPageExclusive } from '../../hooks/useAppSave'
import { buildNewEntry } from '../../hooks/useNoteCreation'
import type { CommandAction } from '../../hooks/commands/types'
import type { AppLocale } from '../../lib/i18n'
import type { VaultEntry } from '../../types'
import { normalizeNotePathForIdentity, notePathFilename, notePathsMatch } from '../../utils/notePathIdentity'
import { deriveDisplayTitleState } from '../../utils/noteTitle'
import { utf8Bytes } from '../extensions/extensionSchema'
import { selectionCommands, type CreatedPage, type OpenTarget, type UndoOutcome } from '../extensions/extensionSessionController'
import { translator, type T } from '../extensions/extensionUiText'
import type { Extensions } from '../extensions/useExtensions'
import { pageLabel } from '../pageLabel'
import type { NoteDropTarget } from '../pageTabDrag'
import type { BesideReservation, SplitOrientation } from '../useSplitWorkspace'
import { COMMENTARY_LIMITS } from './commentaryContract'
import type { CommentaryPaneAction, EditorPassage, PaneId, PassageCaptureEndpoint } from './commentaryContext'
import { CommentaryDialog } from './CommentaryDialog'
import { CommentaryHeaderButton, CommentarySourceCard, CommentaryUndoNotice, type NoticeState, type SourceCardState } from './CommentaryNotices'
import { relativeTo, type CaptureRefusal, type CommentaryServices } from './CommentaryPorts'
import { rawSelectedText } from './rawPassageAdapter'
import { createCommentaryRun, type CommentaryRun, type CommittedCommentary } from './CommentaryRun'
import { useCommentaryLinks } from './useCommentaryLinks'

export interface CommentaryWorkspace {
  readonly paths: readonly [string | null, string | null]
  readonly activePane: PaneId
  readonly split: boolean
  readonly orientation: SplitOrientation
  reserveBeside(sourcePane: PaneId): BesideReservation
  currentTabs(): { entry: VaultEntry; content: string }[]
  focusPane(pane: PaneId): void
  placeNote(entry: VaultEntry, target: NoteDropTarget): Promise<boolean>
}

export interface CommentaryUiOptions {
  locale: AppLocale
  vaultPath: string
  extensions: Extensions
  services: CommentaryServices
  entries: VaultEntry[]
  /** The open pages, as state, so notices notice their note changing. */
  tabs: readonly { entry: VaultEntry; content: string }[]
  workspace: CommentaryWorkspace
  /** Saves the page's pending text; rejects when it could not be saved. */
  settle: (path: string) => Promise<unknown>
  runPageExclusive: RunPageExclusive
  /** The page's bytes on disk, or null. */
  read: (path: string) => Promise<string | null>
  addEntry: (entry: VaultEntry) => void
  markInternalWrite: (path: string) => void
  onPersisted: (path: string) => void
  notify: (message: string) => void
  /** A created note Undo moved to Trash: close it where shown and forget it in the listing. */
  onTrashed: (path: string) => void
  canOpen: () => boolean
  blocked: boolean
  /** Side by side would leave a pane under the Inspector float threshold. */
  narrow: () => boolean
  /** The finder, for a source that can no longer be found. */
  openFinder: () => void
}

interface DialogState { readonly id: number; readonly run: CommentaryRun; readonly sourcePath: string }
interface Notice extends CommittedCommentary { readonly id: number; readonly state: NoticeState; readonly seen: boolean }

const NOTICE_LIMIT = 8
const newEndpoints = () => [{ current: null }, { current: null }] as [MutableRefObject<PassageCaptureEndpoint | null>, MutableRefObject<PassageCaptureEndpoint | null>]

function useLatest<T>(value: T): () => T {
  const ref = useRef(value)
  useLayoutEffect(() => { ref.current = value })
  return useCallback(() => ref.current, [])
}

/** A listing entry for the exact bytes a run created, as the app's other creators add one. */
function entryFor(page: CreatedPage): VaultEntry {
  const filename = notePathFilename(page.path)
  return { ...buildNewEntry({ path: page.path, slug: filename.replace(/\.md$/i, ''), title: page.title, type: 'Note', status: null }),
    isA: null, ...deriveDisplayTitleState({ content: page.content, filename }) }
}

const selectedText = (passage: EditorPassage) =>
  passage.selection.mode === 'rich' ? passage.selection.text : rawSelectedText(passage.markdown, passage.selection)

const REFUSAL_KEYS: Record<CaptureRefusal, Parameters<T>[0]> = {
  stale: 'leadinglight.commentary.pageChanged',
  empty: 'leadinglight.commentary.pageChanged',
  tooLong: 'leadinglight.commentary.tooLong',
  unsafeText: 'leadinglight.commentary.unsafePassage',
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

export function useCommentaryUi(options: CommentaryUiOptions) {
  const latest = useLatest(options)
  const { locale, extensions, services, vaultPath } = options
  const { controller, snapshot } = extensions
  const t = useMemo(() => translator(locale), [locale])
  const commands = useMemo(() => selectionCommands(snapshot), [snapshot])
  const [captureRefs] = useState(newEndpoints)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const dialogRef = useRef<DialogState | null>(null)
  const runs = useRef(0)
  const starting = useRef(false)
  const creations = useRef(new Map<string, Promise<unknown>>())
  const [notices, setNotices] = useState<ReadonlyMap<string, Notice>>(new Map())
  const noticesRef = useRef(notices)
  useLayoutEffect(() => { noticesRef.current = notices })
  const [epoch, setEpoch] = useState(0)

  const show = useCallback((next: DialogState | null) => { dialogRef.current = next; setDialog(next) }, [])
  const notify = useCallback((key: Parameters<T>[0], values?: Record<string, string>) => latest().notify(t(key, values)), [latest, t])

  // --- Notices ---

  const retire = useCallback((path: string, release: boolean) => {
    const notice = noticesRef.current.get(normalizeNotePathForIdentity(path))
    if (!notice) return
    if (release && notice.offer) controller.releaseUndo(notice.offer)
    setNotices(current => { const next = new Map(current); next.delete(normalizeNotePathForIdentity(path)); return next })
  }, [controller])
  const setNoticeState = useCallback((path: string, state: NoticeState) => {
    setNotices(current => {
      const key = normalizeNotePathForIdentity(path)
      const notice = current.get(key)
      return notice ? new Map(current).set(key, { ...notice, state }) : current
    })
  }, [])
  const committed = useCallback((result: CommittedCommentary) => {
    setEpoch(value => value + 1)
    setNotices(current => {
      const key = normalizeNotePathForIdentity(result.path)
      const older = current.get(key)
      if (older?.offer) controller.releaseUndo(older.offer)
      const next = new Map(current)
      next.delete(key)
      next.set(key, { ...result, id: ++runs.current, state: { step: 'offered' }, seen: false })
      // Bounded: the oldest notices give their Undo back first.
      for (const [path, notice] of next) {
        if (next.size <= NOTICE_LIMIT) break
        if (notice.offer) controller.releaseUndo(notice.offer)
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
      if (notice.state.step === 'undoing' || (notice.state.step === 'uncertain')) continue
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
    if (!notice?.offer) return
    let published = false
    const box: { outcome: UndoOutcome | 'busy' | 'settleFailed' } = { outcome: 'busy' }
    // The note's own lane: its unsaved words are saved first, so Undo can only ever see the exact bytes.
    await latest().runPageExclusive(notice.path, async mutate => {
      const admission = mutate(notice.path, {
        publish: async () => { published = true; return ask(notice) },
        committedContent: outcome => (outcome.status === 'undone' && outcome.kind === 'append' ? notice.preimage : null),
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
    setEpoch(value => value + 1)
    if (notice.kind === 'create') {
      latest().onTrashed(notice.path)
      notify('leadinglight.commentary.notice.undoneCreated')
    } else {
      const durable = typeof box.outcome === 'object' && box.outcome.status === 'undone' && box.outcome.kind === 'append' ? box.outcome.durable : true
      notify(durable ? 'leadinglight.commentary.notice.undone' : 'leadinglight.commentary.notice.undoneNotDurable')
    }
  }, [latest, notify, retire, setNoticeState])

  const undo = useCallback((path: string) => {
    const notice = noticesRef.current.get(normalizeNotePathForIdentity(path))
    if (!notice?.offer || notice.state.step === 'undoing' || notice.state.step === 'uncertain' || notice.state.step === 'blocked') return
    setNoticeState(path, { step: 'undoing' })
    void runUndo(path, current => controller.undo(current.offer!))
  }, [controller, runUndo, setNoticeState])
  const checkUndo = useCallback((path: string) => {
    const notice = noticesRef.current.get(normalizeNotePathForIdentity(path))
    if (notice?.state.step !== 'uncertain' || notice.state.checking || !notice.offer) return
    const { operationId } = notice.state
    setNoticeState(path, { step: 'uncertain', operationId, checking: true })
    // Only ever asks about that press; never presses again.
    void runUndo(path, current => controller.recheckUndo(current.offer!, operationId))
  }, [controller, runUndo, setNoticeState])

  // --- One run ---

  const serialize = useCallback(<R,>(key: string, work: () => Promise<R>): Promise<R> => {
    const before = creations.current.get(key) ?? Promise.resolve()
    const next = before.catch(() => {}).then(work)
    creations.current.set(key, next)
    void next.finally(() => { if (creations.current.get(key) === next) creations.current.delete(key) }).catch(() => {})
    return next
  }, [])

  const comment = useCallback(async (pane: PaneId) => {
    const command = selectionCommands(controller.snapshot())[0]
    const o = latest()
    if (!command || starting.current || dialogRef.current || o.blocked || !o.canOpen()) return
    const read = captureRefs[pane].current?.() ?? { status: 'notReady' as const }
    if (read.status === 'empty') { notify('leadinglight.commentary.selectFirst', { title: command.command.title }); return }
    if (read.status !== 'ok') return
    const { passage } = read
    const tab = o.workspace.currentTabs().find(item => notePathsMatch(item.entry.path, passage.path))
    const sourcePath = relativeTo(o.vaultPath, passage.path)
    if (!tab || !sourcePath || (tab.entry.fileKind && tab.entry.fileKind !== 'markdown')) return
    if (utf8Bytes(selectedText(passage)) > COMMENTARY_LIMITS.quoteBytes) { notify('leadinglight.commentary.tooLong'); return }
    const visit = controller.visit()
    const sourceTitle = pageLabel(tab.entry, o.locale).replace(/\s+/gu, ' ').trim() || notePathFilename(passage.path).replace(/\.md$/i, '')
    starting.current = true
    try {
      // The source's unsaved words first: the capture must describe the page as saved.
      try { await o.settle(passage.path) } catch { notify('leadinglight.commentary.saveFirst'); return }
      const now = latest()
      const settled = now.workspace.currentTabs().find(item => notePathsMatch(item.entry.path, passage.path))?.content
      if (controller.visit() !== visit || !notePathsMatch(now.workspace.paths[pane], passage.path) || settled === undefined) {
        notify('leadinglight.commentary.pageChanged')
        return
      }
      const build = await services.buildCapture({ passage, settled, sourcePath, sourceTitle, token: `passage-${crypto.randomUUID()}` })
      if (build.status === 'refused') {
        if (build.reason === 'empty') notify('leadinglight.commentary.selectFirst', { title: command.command.title })
        else notify(REFUSAL_KEYS[build.reason])
        return
      }
      if (controller.visit() !== visit || dialogRef.current) return
      const opening = controller.openCaptureRun(command.key, build.capture)
      if (!opening) return
      const target: OpenTarget = {
        beforeWrite: path => {
          // A new page is this window's own write; an added-to page is left to the watcher, so a
          // write whose answer was lost is still noticed as a change.
          if (!latest().entries.some(entry => notePathsMatch(entry.path, path))) latest().markInternalWrite(path)
        },
        committed: page => {
          if (controller.visit() !== visit) return
          latest().onPersisted(page.path)
          if (!latest().entries.some(entry => notePathsMatch(entry.path, page.path))) latest().addEntry(entryFor(page))
        },
        open: async () => false,
      }
      const run = createCommentaryRun({
        controller, opening, services, captured: build.captured, vaultPath: now.vaultPath, beside: now.workspace.reserveBeside(pane),
        entries: () => latest().entries,
        tabs: () => latest().workspace.currentTabs(),
        read: path => latest().read(path),
        runPageExclusive: (path, work) => latest().runPageExclusive(path, work),
        target,
        narrow: () => latest().narrow(),
        labelOf: path => {
          const entry = latest().entries.find(item => notePathsMatch(item.path, path))
          return entry ? pageLabel(entry, latest().locale) : notePathFilename(path).replace(/\.md$/i, '')
        },
        entryFor,
        focus: path => requestEditorFocus({ path, cursorAtEnd: true }),
        onCommitted: committed,
        serialize,
      })
      show({ id: ++runs.current, run, sourcePath: passage.path })
      void run.discover()
    } finally {
      starting.current = false
    }
  }, [captureRefs, committed, controller, latest, notify, serialize, services, show])

  // --- Core association: header button, source card, opening beside ---

  const pages = useMemo(() => shownPaths.flatMap(path => {
    const tab = tabs.find(item => notePathsMatch(item.entry.path, path))
    return tab ? [{ path: tab.entry.path, content: tab.content }] : []
  }), [shownPaths, tabs])
  const links = useCommentaryLinks({ vaultPath, services, entries: options.entries, pages, epoch })

  /** Opens `path` beside the page in `pane`: focused where it is already shown, never in that pane. */
  const openBeside = useCallback((pane: PaneId, path: string) => {
    const o = latest()
    const entry = o.entries.find(item => notePathsMatch(item.path, path))
    if (!entry) return
    const owner = ([0, 1] as const).find(item => notePathsMatch(o.workspace.paths[item], path))
    const other: PaneId = pane === 0 ? 1 : 0
    const target: NoteDropTarget = owner !== undefined || o.workspace.split ? { pane: owner ?? other }
      : { edge: o.workspace.orientation === 'vertical' || o.narrow() ? 'bottom' : 'right' }
    void o.workspace.placeNote(entry, target)
      .then(placed => { if (placed) requestEditorFocus({ path: entry.path }) })
      .catch(() => {})
  }, [latest])

  const cardState = useCallback((path: string): SourceCardState | null => {
    const note = links.noteOf(path)
    if (!note || note.record.status !== 'ready') return null
    if (note.source.status !== 'linked') return { kind: 'unreadable' }
    const entry = links.entryAt(note.source.sourcePath)
    if (!entry) return { kind: 'missing' }
    const visible = shownPaths.some(shown => notePathsMatch(shown, entry.path))
    return { kind: 'found', title: pageLabel(entry, locale), visible }
  }, [links, locale, shownPaths])

  const paneOf = useCallback((path: string): PaneId | null => {
    const { paths } = latest().workspace
    return notePathsMatch(paths[0], path) ? 0 : notePathsMatch(paths[1], path) ? 1 : null
  }, [latest])

  const renderHeader = useCallback((path: string, pane: PaneId): ReactNode => (
    <CommentaryHeaderButton t={t} linked={links.linkedTo(path)} onOpen={target => openBeside(pane, target)} />
  ), [links, openBeside, t])

  const renderNotice = useCallback((path: string): ReactNode => {
    const card = cardState(path)
    const notice = notices.get(normalizeNotePathForIdentity(path))
    const note = links.noteOf(path)
    const source = note?.source.status === 'linked' ? links.entryAt(note.source.sourcePath) : null
    return <>
      {card && <CommentarySourceCard t={t} state={card}
        onOpen={() => {
          const pane = paneOf(path)
          if (!source || pane === null) return
          const owner = paneOf(source.path)
          if (owner !== null) { latest().workspace.focusPane(owner); requestEditorFocus({ path: source.path }) } else openBeside(pane, source.path)
        }}
        onFind={() => latest().openFinder()} />}
      {notice && <CommentaryUndoNotice t={t}
        view={{ kind: notice.kind, sourceTitle: notice.sourceTitle, durable: notice.durable, canUndo: notice.offer !== null, state: notice.state }}
        onUndo={() => undo(notice.path)} onCheckAgain={() => checkUndo(notice.path)} onDismiss={() => retire(notice.path, true)} />}
    </>
  }, [cardState, checkUndo, latest, links, notices, openBeside, paneOf, retire, t, undo])

  // --- Surfaces ---

  const available = commands.length > 0 && !options.blocked
  const paneAction = useCallback((pane: PaneId): CommentaryPaneAction | null => (commands[0]
    ? { available, title: commands[0].command.title, compact: false, comment: () => { void comment(pane) } }
    : null), [available, commands, comment])

  /** One palette entry per passage command, acting on the active pane's selection. */
  const paletteCommands = useMemo<CommandAction[]>(() => commands.map(item => ({
    id: `comment-on-passage:${item.key}`, label: item.command.title, group: 'Note', enabled: available,
    keywords: ['passage', 'selection', 'commentary', 'quote', 'comment'],
    execute: () => { void comment(latest().workspace.activePane) },
  })), [available, commands, comment, latest])

  const closeDialog = useCallback((handled: boolean) => {
    const current = dialogRef.current
    show(null)
    // Cancel returns to the source, whose editor still holds its selection; a shown note keeps focus.
    if (!handled && current) window.setTimeout(() => requestEditorFocus({ path: current.sourcePath }), 0)
  }, [show])

  const dialogs = dialog
    ? <CommentaryDialog key={dialog.id} locale={locale} run={dialog.run} onClose={closeDialog}
      onCloseAutoFocus={event => event.preventDefault()} />
    : null

  return {
    captureRefs, paneAction, paletteCommands, renderHeader, renderNotice, dialogs,
    isOpen: () => dialogRef.current !== null,
  }
}

export type CommentaryUi = ReturnType<typeof useCommentaryUi>
