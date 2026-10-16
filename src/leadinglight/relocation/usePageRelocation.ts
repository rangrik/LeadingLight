import { useCallback, useLayoutEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { flushSync } from 'react-dom'
import type { VaultEntry } from '../../types'
import type { useAppSave } from '../../hooks/useAppSave'
import type { OpenReservation } from '../../hooks/useNoteCreation'
import { buildFilenameRenamedEntry, loadNoteContent, performFolderRelocation } from '../../hooks/useNoteRename'
import { requestEditorFocus } from '../../hooks/useEditorFocus'
import { cacheNoteContent, clearPrefetchCache } from '../../hooks/useTabManagement'
import { translate, type AppLocale } from '../../lib/i18n'
import { joinVaultPath, normalizeNotePathForIdentity, notePathFilename, notePathsMatch } from '../../utils/notePathIdentity'
import type { SplitWorkspaceController } from '../useSplitWorkspace'
import { editorWorkSettled } from '../editorWork'
import { backupInputHeld, holdBackupInput } from '../backup/backupInputGate'
import type { PageSettlement } from '../saveHold/paneSettlement'
import { relocatePage, type RelocationPage } from './relocatePage'
import { relocatedPageContent } from './relocationContract'

type Saves = Pick<ReturnType<typeof useAppSave>, 'holdWrites' | 'releaseHeldWrites' | 'prepareForTrash' | 'hasPendingWrite' | 'saveRecovery'>
interface Options {
  vaultPath: string
  locale: AppLocale
  entries: VaultEntry[]
  unsavedPaths: ReadonlySet<string>
  workspace: SplitWorkspaceController
  saves: Saves
  structural: MutableRefObject<{ running: Promise<boolean> | null; holds: number }>
  settlement: MutableRefObject<PageSettlement | null>
  blocked: () => boolean
  /** Template/capture first, then rename/Trash/mutation admission holds. */
  begin: () => () => void
  joinEarlier: () => Promise<void>
  assertClear: () => void
  flushBuffers: (path: string) => void
  commitSource: (oldPath: string, entry: VaultEntry, content: string) => void
  setTabs: Dispatch<SetStateAction<RelocationPage[]>>
  refresh: () => Promise<unknown>
  notify: (text: string) => void
}

const inVault = (path: string, vaultPath: string) => normalizeNotePathForIdentity(path).startsWith(`${normalizeNotePathForIdentity(vaultPath)}/`)
interface FolderContext {
  path: string
  vaultPath: string
  session: number
  navigation: ReturnType<SplitWorkspaceController['markNavigation']>
}

function contextCurrent(context: FolderContext, options: Options): boolean {
  const pane = options.workspace.markNavigation().pane
  return context.session === options.saves.saveRecovery.currentSession()
    && notePathsMatch(context.vaultPath, options.vaultPath)
    && context.navigation.current() && pane === context.navigation.pane
    && notePathsMatch(options.workspace.paths[pane], context.path)
}

export function usePageRelocation(options: Options) {
  const latest = useRef(options)
  useLayoutEffect(() => { latest.current = options })
  const [busy, setBusy] = useState(false)
  const unknownSources = useRef(new Set<string>())
  const folderContext = useRef<FolderContext | null>(null)
  const captureContext = useCallback((path: string) => {
    const initial = latest.current
    const context: FolderContext = { path, vaultPath: initial.vaultPath,
      session: initial.saves.saveRecovery.currentSession(), navigation: initial.workspace.markNavigation() }
    folderContext.current = context
    return () => {
      const valid = contextCurrent(context, latest.current)
      if (!valid) latest.current.notify(translate(latest.current.locale, 'leadinglight.relocation.changed'))
      return valid
    }
  }, [])

  const move = useCallback(async (path: string, folder: string, vaultPath: string,
    onEntryRenamed: (oldPath: string, entry: Partial<VaultEntry> & { path: string }, content: string) => void,
  ): Promise<{ new_path: string } | null> => {
    const initial = latest.current
    const { structural } = initial
    const entry = initial.workspace.currentTabs().find(page => notePathsMatch(page.entry.path, path))?.entry
      ?? initial.entries.find(item => notePathsMatch(item.path, path))
    const t = (key: Parameters<typeof translate>[1]) => translate(initial.locale, key)
    const session = initial.saves.saveRecovery.currentSession()
    const captured = folderContext.current
    const retryContext = captured && notePathsMatch(captured.path, path) && contextCurrent(captured, initial) ? captured : null
    const sourceIdentity = `${session}:${normalizeNotePathForIdentity(path)}`
    if (unknownSources.current.has(sourceIdentity)) {
      initial.notify(t('leadinglight.relocation.unknown'))
      return null
    }
    if (structural.current.running || structural.current.holds || initial.blocked() || backupInputHeld()
      || initial.workspace.pendingPanes.some(Boolean) || !initial.workspace.readyForVisits
      || !entry || (entry.fileKind && entry.fileKind !== 'markdown') || !inVault(path, vaultPath)
      || !notePathsMatch(initial.vaultPath, vaultPath)) {
      initial.notify(t('leadinglight.relocation.busy'))
      return null
    }
    const current = () => latest.current.saves.saveRecovery.currentSession() === session && notePathsMatch(latest.current.vaultPath, vaultPath)
    let resolveRunning: (done: boolean) => void = () => {}
    const running = new Promise<boolean>(resolve => { resolveRunning = resolve })
    structural.current.running = running
    const held: string[] = []
    const reservations = new Map<string, OpenReservation>()
    const visiblePaths = new Set<string>()
    const focusedPath = initial.workspace.paths[initial.workspace.activePane]
    const key = normalizeNotePathForIdentity
    let detached = false
    try {
      const outcome = await relocatePage({
        current,
        begin: () => {
          const reopenActions = initial.begin()
          const reopenInput = holdBackupInput()
          flushSync(() => setBusy(true))
          return () => {
            initial.saves.releaseHeldWrites(held, detached ? 'release' : 'resume')
            reopenActions()
            reopenInput()
            setBusy(false)
          }
        },
        prepare: async () => {
          await initial.joinEarlier()
          await editorWorkSettled()
          if (!current()) throw new Error('Relocation session changed')
          for (const page of latest.current.workspace.currentTabs()) initial.flushBuffers(page.entry.path)
          const paths = [...new Set([
            ...latest.current.entries.map(item => item.path), ...latest.current.unsavedPaths,
            ...latest.current.workspace.currentTabs().map(page => page.entry.path), path,
          ].filter(item => inVault(item, vaultPath)))]
          held.push(...paths)
          initial.saves.holdWrites(held)
          let sourcePath = path
          for (const candidate of paths) {
            const open = latest.current.workspace.currentTabs().some(page => notePathsMatch(page.entry.path, candidate))
            if (!open && !notePathsMatch(candidate, path) && !initial.saves.hasPendingWrite(candidate) && !latest.current.unsavedPaths.has(candidate)) continue
            const settled = await initial.saves.prepareForTrash(candidate)
            if (!held.includes(settled)) held.push(settled)
            if (notePathsMatch(candidate, path)) sourcePath = settled
          }
          initial.assertClear()
          const recovery = initial.saves.saveRecovery.getSnapshot()
          if (!current() || recovery.holds.length || recovery.retriable.length || held.some(initial.saves.hasPendingWrite)) throw new Error('Writing has not settled')
          const pages = latest.current.workspace.currentTabs().map(page => ({ entry: page.entry, content: page.content }))
          if (pages.length > 128 || pages.some(page => !initial.settlement.current?.idle(page.entry.path, page.content))) throw new Error('Editor buffers have not settled')
          const source = pages.find(page => notePathsMatch(page.entry.path, sourcePath)) ?? {
            entry: buildFilenameRenamedEntry(entry, sourcePath), content: await loadNoteContent({ path: sourcePath, vaultPath }),
          }
          return { source, pages, destinationPath: joinVaultPath(joinVaultPath(vaultPath, folder), notePathFilename(sourcePath)) }
        },
        detach: snapshot => {
          const workspace = latest.current.workspace
          for (const pane of [0, 1] as const) {
            if ((workspace.split || workspace.activePane === pane) && workspace.paths[pane]) visiblePaths.add(key(workspace.paths[pane]!))
          }
          if (held.some(initial.saves.hasPendingWrite) || snapshot.pages.some(page => !initial.settlement.current?.idle(page.entry.path, page.content))) throw new Error('Newer editor words are waiting')
          flushSync(() => {
            for (const page of snapshot.pages) {
              if (!visiblePaths.has(key(page.entry.path))) continue
              const reservation = initial.settlement.current?.close(page.entry.path)
              if (reservation) reservations.set(key(page.entry.path), reservation)
            }
          })
          detached = true
        },
        dispatch: snapshot => performFolderRelocation({ path: snapshot.source.entry.path, folderPath: folder, vaultPath, openPaths: snapshot.pages.map(page => page.entry.path) }),
        sourceUnchanged: async snapshot => await loadNoteContent({ path: snapshot.source.entry.path, vaultPath }) === snapshot.source.content,
        commit: (snapshot, receipt) => {
          const moved = buildFilenameRenamedEntry(snapshot.source.entry, receipt.new_path)
          initial.commitSource(snapshot.source.entry.path, moved, receipt.source_content)
          onEntryRenamed(snapshot.source.entry.path, moved, receipt.source_content)
        },
        reopen: async (snapshot, receipt) => {
          const unavailable: string[] = []
          clearPrefetchCache()
          for (const page of snapshot.pages) {
            const source = notePathsMatch(page.entry.path, snapshot.source.entry.path)
            const nextEntry = receipt && source ? buildFilenameRenamedEntry(page.entry, receipt.new_path) : page.entry
            const content = receipt ? relocatedPageContent(receipt, page.entry.path, page.content, snapshot.source.entry.path) : page.content
            const reservation = reservations.get(key(page.entry.path))
            if (content === null || !current()) {
              latest.current.workspace.closePages([nextEntry.path, page.entry.path])
              unavailable.push(nextEntry.path)
              continue
            }
            cacheNoteContent(nextEntry.path, content, nextEntry)
            if (reservation) {
              try {
                if (!await reservation.open(nextEntry, content)) unavailable.push(nextEntry.path)
                else if (!receipt && source && retryContext === folderContext.current && retryContext
                  && notePathsMatch(nextEntry.path, retryContext.path) && current() && reservation.inSession() && reservation.isActive()) {
                  const navigation = latest.current.workspace.markNavigation()
                  // Only our proven original-source reopen renews this picker; later navigation still expires it.
                  if (navigation.pane === retryContext.navigation.pane) retryContext.navigation = navigation
                }
              }
              catch { unavailable.push(nextEntry.path) }
            } else if (!visiblePaths.has(key(page.entry.path))) {
              latest.current.setTabs(previous => previous.map(tab => notePathsMatch(tab.entry.path, page.entry.path) && tab.content === page.content ? { entry: nextEntry, content } : tab))
            } else unavailable.push(nextEntry.path)
          }
          return unavailable
        },
        closeUnconfirmed: snapshot => {
          if (!current()) return
          clearPrefetchCache()
          flushSync(() => latest.current.workspace.closePages([...snapshot.pages.map(page => page.entry.path), snapshot.destinationPath]))
        },
        refresh: async () => { await initial.refresh() },
      })
      if (outcome.status === 'moved') {
        const warned = outcome.refreshPending || outcome.unavailable.length > 0 || outcome.receipt.failed_updates > 0
        initial.notify(t(warned ? 'leadinglight.relocation.movedWarning' : 'leadinglight.relocation.moved'))
        const focusPath = notePathsMatch(focusedPath, path) ? outcome.receipt.new_path : focusedPath
        if (focusPath && !outcome.unavailable.some(item => notePathsMatch(item, focusPath))) {
          window.setTimeout(() => { if (current()) requestEditorFocus({ path: focusPath }) }, 0)
        }
        return { new_path: outcome.receipt.new_path }
      }
      if (outcome.status === 'unknown') unknownSources.current.add(sourceIdentity)
      initial.notify(t(outcome.status === 'unknown' ? 'leadinglight.relocation.unknown' : outcome.reason === 'move' ? 'leadinglight.relocation.refused' : 'leadinglight.relocation.notSaved'))
      return null
    } finally {
      if (structural.current.running === running) structural.current.running = null
      resolveRunning(true)
    }
  }, [])

  return { busy, move, captureContext }
}
