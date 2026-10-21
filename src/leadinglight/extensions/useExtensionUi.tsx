import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { requestEditorFocus } from '../../hooks/useEditorFocus'
import { buildNewEntry, type OpenReservation } from '../../hooks/useNoteCreation'
import type { AppLocale } from '../../lib/i18n'
import type { FolderNode, VaultEntry } from '../../types'
import { joinVaultPath, notePathFilename, notePathsCollide } from '../../utils/notePathIdentity'
import { flattenRetargetFolders } from '../../utils/noteRetargetingPaths'
import { deriveDisplayTitleState } from '../../utils/noteTitle'
import type { StoredVersion } from './extensionApi'
import { ExtensionChooserDialog } from './ExtensionChooserDialog'
import { ExtensionImportDialog } from './ExtensionImportDialog'
import { ExtensionPreviewDialog, type PreviewTarget } from './ExtensionPreviewDialog'
import { ExtensionRollbackDialog } from './ExtensionSettings'
import { ExtensionRunDialog, type FolderOption } from './ExtensionRunDialog'
import {
  runnableCommands,
  type ChangeOutcome, type CreatedPage, type ExtensionVisit, type ImportOutcome, type OpenTarget, type PackageView, type RegistrySnapshot, type RunOpening,
} from './extensionSessionController'
import { changeRefusalText, translator } from './extensionUiText'
import type { Extensions } from './useExtensions'

export interface ExtensionNotice {
  text: string
  /** A command of the package just turned on, offered as Try it. */
  tryKey: string | null
}

type Turn = { packageId: string; name: string; sha: string; expected: string | null }
/**
 * How a preview ended: turned on (with the command Try it would open), or closed without that.
 * `moved`: it belonged to a visit that has ended, so its Turn on did nothing.
 */
export type PreviewEnding =
  | { readonly turnedOn: true; readonly tryKey: string | null }
  | { readonly turnedOn: false; readonly outcome: ChangeOutcome | null; readonly moved?: true }
/** Whether Try it opened its form, or why not: `changed` when another version is on than the one expected. */
export type RunStart = 'opened' | 'notOpened' | 'changed'
type DialogState =
  | {
    kind: 'preview'; name: string; target: PreviewTarget; turnOn: Turn | null; after?: (ending: PreviewEnding) => void
    /** A preview opened for another surface's request stays bound to the visit it was opened in. */
    bound?: { visit: ExtensionVisit | null; stillCurrent: () => boolean }
  }
  | { kind: 'import' }
  | { kind: 'chooser' }
  | { kind: 'run'; id: number; opening: RunOpening; target: OpenTarget; initialFolder: string }
  | { kind: 'rollback'; view: PackageView; version: StoredVersion }

export interface ExtensionUiOptions {
  locale: AppLocale
  extensions: Extensions
  folders: FolderNode[]
  entries: VaultEntry[]
  /** The split workspace's request-time pane reservation (notes.reserveOpen). */
  reserveOpen: () => OpenReservation
  addEntry: (entry: VaultEntry) => void
  /** Before a write lands, so the watcher reads it as this window's own. */
  markInternalWrite: (path: string) => void
  onPersisted: (path: string) => void
  notify: (message: string) => void
  /** False while the workspace is still loading or a draft owns input. */
  canOpen: () => boolean
  /** True while the window closes or switches, or another workspace-wide action holds still. */
  blocked: boolean
}

const FOLDER_MEMORY_LIMIT = 50
const folderMemoryKey = (vaultPath: string) => `leadinglight.extensionFolders:${vaultPath}`

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

/** A listing entry for the exact bytes written, as the app's other creators add one. */
function entryFor(page: CreatedPage): VaultEntry {
  const filename = notePathFilename(page.path)
  return { ...buildNewEntry({ path: page.path, slug: filename.replace(/\.md$/i, ''), title: page.title, type: 'Note', status: null }),
    isA: null, ...deriveDisplayTitleState({ content: page.content, filename }) }
}

const viewOf = (snapshot: RegistrySnapshot, packageId: string) =>
  snapshot.status === 'ready' ? snapshot.packages.find(item => item.packageId === packageId) ?? null : null
const versionOf = (view: PackageView, sha: string | null) => view.versions.find(item => item.packageSha256 === sha)?.version ?? ''
const activeOf = (view: PackageView | null): PreviewTarget['replacing'] =>
  view?.active?.status === 'ready' && view.activeSha256 !== null ? { version: versionOf(view, view.activeSha256), review: view.active.review } : null

/**
 * One dialog at a time. The first of a sequence (import, then its preview) remembers the element
 * focus returns to; a run that opened its page has already moved focus there.
 */
function useDialogStack<D>() {
  const [dialog, setDialog] = useState<D | null>(null)
  const current = useRef<D | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const focusMoved = useRef(false)
  const runs = useRef(0)
  const actions = useMemo(() => ({
    show(next: D) {
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
    isOpen: () => current.current !== null,
    nextRun: () => ++runs.current,
    onCloseAutoFocus(event: Event) {
      if (current.current) return
      event.preventDefault()
      if (focusMoved.current) { focusMoved.current = false; return }
      if (opener.current?.isConnected) opener.current.focus()
    },
  }), [])
  return { dialog, ...actions }
}

/** Reads the latest options from callbacks without making them depend on every render. */
function useLatest<T>(value: T): () => T {
  const ref = useRef(value)
  useLayoutEffect(() => { ref.current = value })
  return useCallback(() => ref.current, [])
}

/**
 * Settings actions and the preview, import, chooser and run dialogs. One dialog at a time; a run
 * reserves its pane when it opens and never places a page anywhere else.
 */
export function useExtensionUi(options: ExtensionUiOptions) {
  const latest = useLatest(options)
  const { locale, extensions, folders, entries, blocked } = options
  const { controller, snapshot, runnable } = extensions
  const t = useMemo(() => translator(locale), [locale])
  const { dialog, show, hide, isOpen, nextRun, onCloseAutoFocus } = useDialogStack<DialogState>()
  const [notice, setNotice] = useState<ExtensionNotice | null>(null)
  const [busyPackage, setBusyPackage] = useState<string | null>(null)

  const folderOptions = useMemo<FolderOption[]>(
    () => [{ path: '', label: t('leadinglight.extensions.rootFolder') }, ...flattenRetargetFolders(folders)], [folders, t])

  const makeTarget = useCallback((reservation: OpenReservation, onCommitted?: (page: CreatedPage) => void): OpenTarget => ({
    beforeWrite: path => latest().markInternalWrite(path),
    committed(page) {
      onCommitted?.(page)
      // Never into another vault's listing: the reservation knows the vault session it was taken in.
      if (!reservation.inSession()) return
      latest().onPersisted(page.path)
      latest().addEntry(entryFor(page))
    },
    async open(page, stillCurrent) {
      if (!stillCurrent() || !reservation.inSession()) return false
      // The split opener asks the run's own guard again at placement, after the outgoing save, with
      // its pane, page and vault-session checks; a revoked or cancelled run places nothing.
      const shown = await reservation.open(entryFor(page), page.content, stillCurrent)
      if (shown && stillCurrent() && reservation.isActive()) requestEditorFocus({ path: page.path, cursorAtEnd: true })
      return shown
    },
  }), [latest])

  /**
   * `onCommitted`: told once the run's note is on disk, whether or not it is then opened.
   * `expectedSha256`: open only that exact version's command; another version on is `changed`.
   */
  const openRun = useCallback((key: string, onCommitted?: (page: CreatedPage) => void, expectedSha256?: string): RunStart => {
    if (latest().blocked || !latest().canOpen()) return 'notOpened'
    const opening = controller.openRun(key)
    if (!opening) return 'notOpened'
    if (expectedSha256 !== undefined && opening.runnable.packageSha256 !== expectedSha256) {
      controller.cancel(opening)
      return 'changed'
    }
    const remembered = readFolderMemory(opening.visit.vaultPath)[key] ?? ''
    // A remembered folder is offered only while the host still lists it; native checks it again.
    const initialFolder = folderOptions.some(option => option.path === remembered) ? remembered : ''
    show({ kind: 'run', id: nextRun(), opening, target: makeTarget(latest().reserveOpen(), onCommitted), initialFolder })
    return 'opened'
  }, [controller, folderOptions, latest, makeTarget, nextRun, show])

  /** New page → From extension…: one command opens directly, several open the chooser. */
  const openFromExtension = useCallback(() => {
    if (isOpen() || latest().blocked || !latest().canOpen()) return
    const commands = runnableCommands(controller.snapshot())
    if (commands.length === 1) openRun(commands[0].key)
    else if (commands.length > 1) show({ kind: 'chooser' })
  }, [controller, isOpen, latest, openRun, show])

  const report = useCallback((outcome: ChangeOutcome, name: string, success: () => ExtensionNotice) => {
    setNotice(outcome.status === 'done' ? success() : { text: changeRefusalText(t, outcome.status === 'noReply' ? 'noReply' : outcome.reason, name), tryKey: null })
  }, [t])

  /** Activation and rollback; the controller refreshes before answering, so the list is current. */
  const turn = useCallback(async ({ packageId, name, sha, expected }: Turn, success: (tryKey: string | null) => ExtensionNotice): Promise<PreviewEnding> => {
    setBusyPackage(packageId)
    setNotice({ text: t('leadinglight.extensions.status.changing', { name }), tryKey: null })
    try {
      const outcome = await controller.activate(packageId, sha, expected)
      const tryKey = runnableCommands(controller.snapshot()).find(item => item.packageId === packageId)?.key ?? null
      report(outcome, name, () => success(tryKey))
      return outcome.status === 'done' ? { turnedOn: true, tryKey } : { turnedOn: false, outcome }
    } finally {
      setBusyPackage(null)
    }
  }, [controller, report, t])
  const turnedOn = useCallback((name: string) => (tryKey: string | null): ExtensionNotice =>
    ({ text: t('leadinglight.extensions.status.on', { name }), tryKey }), [t])

  const preview = useCallback((view: PackageView) => {
    const { candidate } = view
    if (candidate) {
      show({ kind: 'preview', name: view.name, target: { version: candidate.stored.version, load: candidate.load, replacing: activeOf(view) },
        turnOn: { packageId: view.packageId, name: view.name, sha: candidate.stored.packageSha256, expected: view.activeSha256 } })
    } else if (view.active && view.activeSha256 !== null) {
      show({ kind: 'preview', name: view.name, target: { version: versionOf(view, view.activeSha256), load: view.active, replacing: null }, turnOn: null })
    }
  }, [show])

  const toggle = useCallback(async (view: PackageView, on: boolean) => {
    if (busyPackage) return
    if (!on) {
      if (view.activeSha256 === null) return
      setBusyPackage(view.packageId)
      try {
        report(await controller.deactivate(view.packageId, view.activeSha256), view.name,
          () => ({ text: t('leadinglight.extensions.status.off', { name: view.name }), tryKey: null }))
      } finally {
        setBusyPackage(null)
      }
      return
    }
    const { candidate } = view
    // Turning the same reviewed version back on asks nothing; anything else is reviewed first.
    if (candidate && candidate.stored.packageSha256 === view.previousSha256 && candidate.load.status === 'ready' && candidate.load.review.activation === 'available') {
      await turn({ packageId: view.packageId, name: view.name, sha: candidate.stored.packageSha256, expected: null }, turnedOn(view.name))
      return
    }
    preview(view)
  }, [busyPackage, controller, preview, report, t, turn, turnedOn])

  const rollback = useCallback((view: PackageView) => {
    if (view.rollback) show({ kind: 'rollback', view, version: view.rollback })
  }, [show])

  const checkImport = useCallback((text: string): Promise<ImportOutcome> => controller.importText(text), [controller])
  const showCandidate = (candidate: Extract<ImportOutcome, { status: 'candidate' }>) => {
    const { extension } = candidate
    const current = viewOf(controller.snapshot(), extension.id)
    setNotice({ text: t('leadinglight.extensions.status.added', { name: extension.name }), tryKey: null })
    show({ kind: 'preview', name: extension.name,
      target: { version: extension.version, load: { status: 'ready', extension, review: candidate.review }, replacing: activeOf(current) },
      turnOn: { packageId: extension.id, name: extension.name, sha: candidate.packageSha256, expected: current?.activeSha256 ?? null } })
  }

  /**
   * A candidate stored from elsewhere (Adapt): the same effect-free preview, with Turn on as its
   * single activation. `expected` is the active version the request started from, so a version
   * that changed meanwhile is refused rather than replaced. `after` hears how the preview ended.
   * The preview belongs to this visit and to the caller's `stillCurrent`: once either has moved
   * on (another vault, even the same one again), its Turn on activates nothing.
   */
  const reviewCandidate = useCallback((candidate: Extract<ImportOutcome, { status: 'candidate' }>, expected: string | null,
    after: (ending: PreviewEnding) => void, stillCurrent: () => boolean) => {
    if (isOpen()) return false
    const { extension } = candidate
    const current = viewOf(controller.snapshot(), extension.id)
    show({ kind: 'preview', name: extension.name, after, bound: { visit: controller.visit(), stillCurrent },
      target: { version: extension.version, load: { status: 'ready', extension, review: candidate.review }, replacing: activeOf(current) },
      turnOn: { packageId: extension.id, name: extension.name, sha: candidate.packageSha256, expected } })
    return true
  }, [controller, isOpen, show])
  const boundHere = (bound: { visit: ExtensionVisit | null; stillCurrent: () => boolean } | undefined) =>
    !bound || (bound.visit !== null && controller.visit() === bound.visit && bound.visit.isOpen() && bound.stillCurrent())

  const close = () => hide()
  const renderDialog = (state: DialogState) => {
    switch (state.kind) {
      case 'preview': {
        const { turnOn, after, bound } = state
        return <ExtensionPreviewDialog key={`${state.name}:${state.target.version}`} locale={locale} name={state.name} target={state.target}
          onCloseAutoFocus={onCloseAutoFocus} onClose={() => { hide(); after?.({ turnedOn: false, outcome: null }) }}
          onTurnOn={turnOn ? async () => {
            // Checked at the click, before anything is sent: a preview left open across a visit change turns nothing on.
            if (!boundHere(bound)) { hide(); after?.({ turnedOn: false, outcome: null, moved: true }); return }
            const ending = await turn(turnOn, turnedOn(turnOn.name))
            hide()
            after?.(ending)
          } : undefined} />
      }
      case 'import':
        return <ExtensionImportDialog locale={locale} check={checkImport} onCloseAutoFocus={onCloseAutoFocus} onClose={close} onCandidate={showCandidate} />
      case 'chooser':
        return <ExtensionChooserDialog locale={locale} commands={runnable} onCloseAutoFocus={onCloseAutoFocus} onClose={close}
          onChoose={key => { hide(); openRun(key) }} />
      case 'run': {
        const { vaultPath } = state.opening.visit
        return <ExtensionRunDialog key={state.id} locale={locale} controller={controller} opening={state.opening} target={state.target}
          folders={folderOptions} initialFolder={state.initialFolder} blocked={blocked}
          pageExists={relative => entries.some(entry => notePathsCollide(entry.path, joinVaultPath(vaultPath, relative)))}
          onRemember={folder => rememberFolder(vaultPath, state.opening.runnable.key, folder)}
          onNotice={message => latest().notify(message)} onCloseAutoFocus={onCloseAutoFocus}
          onClose={handled => hide(handled)} />
      }
      case 'rollback': {
        const { view, version } = state
        return <ExtensionRollbackDialog locale={locale} name={view.name} version={version.version} onCloseAutoFocus={onCloseAutoFocus} onCancel={close}
          onConfirm={async () => {
            await turn({ packageId: view.packageId, name: view.name, sha: version.packageSha256, expected: view.activeSha256 },
              () => ({ text: t('leadinglight.extensions.status.rolledBack', { name: view.name, version: version.version }), tryKey: null }))
            hide()
          }} />
      }
    }
  }

  return {
    locale, snapshot, runnable, notice, busyPackage,
    hasRunnable: runnable.length > 0,
    openFromExtension, openRun, preview, toggle, rollback, isOpen, reviewCandidate,
    paste: () => show({ kind: 'import' }),
    /** Reads the registry again, or, while blocked, asks native again to confirm the unsettled closes. */
    retry: () => { void (controller.snapshot().status === 'unsettled' ? controller.retryUnsettled() : controller.refresh()) },
    dialogs: dialog ? renderDialog(dialog) : null,
  }
}

export type ExtensionUi = ReturnType<typeof useExtensionUi>
