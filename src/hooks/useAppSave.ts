import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useEditorSaveWithLinks } from './useEditorSaveWithLinks'
import { UnmergedDraftError, unmergedDraftKey, type ContentReceipt, type DocumentMutation, type HeldDraftRebase, type MutationAdmission, type ReceiptStatus } from './useEditorSave'
import { flushEditorContent } from '../utils/autoSave'
import { deriveDisplayTitleState, extractH1TitleFromContent } from '../utils/noteTitle'
import { isTauri } from '../mock-tauri'
import type { VaultEntry } from '../types'
import { createTranslator, type AppLocale } from '../lib/i18n'
import { canWritePathToVault } from '../utils/vaultPathContainment'
import { vaultPathForEntry } from '../utils/workspaces'
import { notePathFilename, notePathsMatch } from '../utils/notePathIdentity'
import { managedRenameAdmission } from '../leadinglight/rename/renameAdmission'
import { runAutomaticRename, type RebaseHeldDraft } from '../leadinglight/rename/managedRename'
import { loadNoteContent, performAutoRename } from './useNoteRename'

interface TabState {
  entry: VaultEntry
  content: string
}

const UNTITLED_RENAME_DEBOUNCE_MS = 2500

interface PendingUntitledRename {
  path: string
  title: string
  timer: ReturnType<typeof setTimeout>
}

type RenamedPathMap = Map<string, string>
type InFlightRenameMap = Map<string, Promise<string>>

/** Runs a change to an existing page inside its save queue, after its renames settle. */
export type MutateExistingDocument = <R>(
  path: string,
  mutation: Omit<DocumentMutation<R>, 'flushBuffers'>,
) => MutationAdmission<R>

/**
 * Runs a page's property write alone on the page; false when refused or when the work says so.
 * `mutate` admits the write itself into the page's save queue, under this claim.
 */
export type RunPageExclusive = (path: string, work: (mutate: MutateExistingDocument) => Promise<boolean>) => Promise<boolean>

/** Runs a manual page rename through the barrier; a refused one shows the busy message and never starts. */
export type RunManualRename = (path: string, rename: () => Promise<void>) => Promise<void>

/** What the automatic rename needs from services created after it (RENAME contract 6.1/6.2). */
interface ManagedRenameSeams {
  mutate: MutateExistingDocument
  rebaseHeldDraft: RebaseHeldDraft
  holdUnproven: (path: string) => HeldDraftRebase
  isUnproven: (path: string) => boolean
  /** Fails closed: a buffer that cannot be read leaves its page held as unknown. */
  flushEditorBuffers: (path: string) => void
  holdAutosave: (paths: readonly string[]) => void
  releaseAutosave: (paths: readonly string[], action: 'resume') => void
  linkedPaths: (sourcePath: string) => string[]
  guards: PageChangeGuards
}

/** The save-queue services a managed rename takes (Amendment B). */
function managedRenameQueue(managed: ManagedRenameSeams) {
  return {
    mutateExistingDocument: managed.mutate,
    rebaseHeldDraft: managed.rebaseHeldDraft,
    holdUnproven: managed.holdUnproven,
    flushEditorBuffers: managed.flushEditorBuffers,
  }
}

/** Pages with an admitted change: their automatic rename waits, and a manual one is refused meanwhile. */
interface PageChangeGuards {
  renaming: Set<string>
  renameSuppressed: Set<string>
  deferredRenames: Map<string, string>
  // Manual renames from admission to settlement, and the folder moves holding new ones back.
  manualRenames: Set<Promise<void>>
  manualRenameHolds: Set<object>
}

function guardedPath(paths: Iterable<string>, path: string, resolveCurrentPath: (path: string) => string): string | undefined {
  const current = resolveCurrentPath(path)
  for (const candidate of paths) if (notePathsMatch(resolveCurrentPath(candidate), current)) return candidate
  return undefined
}

function findRenamedPath(renamedPaths: RenamedPathMap, path: string): string | undefined {
  for (const [oldPath, newPath] of renamedPaths) {
    if (notePathsMatch(oldPath, path)) return newPath
  }
  return undefined
}

function resolveLatestPath(renamedPaths: RenamedPathMap, path: string): string {
  let current = path
  const visited = new Set<string>()

  while (!visited.has(current)) {
    visited.add(current)
    const next = findRenamedPath(renamedPaths, current)
    if (!next || next === current) break
    current = next
  }

  return current
}

function trackRenamedPath(renamedPaths: RenamedPathMap, oldPath: string, newPath: string): void {
  if (notePathsMatch(oldPath, newPath)) return
  const latestPath = resolveLatestPath(renamedPaths, newPath)
  for (const [trackedOldPath, trackedNewPath] of renamedPaths) {
    if (notePathsMatch(trackedNewPath, oldPath)) renamedPaths.set(trackedOldPath, latestPath)
  }
  for (const trackedOldPath of renamedPaths.keys()) {
    if (notePathsMatch(trackedOldPath, oldPath)) {
      renamedPaths.set(trackedOldPath, latestPath)
      return
    }
  }
  renamedPaths.set(oldPath, latestPath)
}

function vaultPathForTabPath(tabs: TabState[], path: string, fallbackVaultPath: string): string {
  const tab = tabs.find((candidate) => notePathsMatch(candidate.entry.path, path))
  return tab ? vaultPathForEntry(tab.entry, fallbackVaultPath) : fallbackVaultPath
}

async function waitForSettledPath({
  path,
  renamedPaths,
  inFlightRenames,
}: {
  path: string
  renamedPaths: RenamedPathMap
  inFlightRenames: InFlightRenameMap
}): Promise<string> {
  let current = resolveLatestPath(renamedPaths, path)
  const visited = new Set<string>()

  while (!visited.has(current)) {
    visited.add(current)
    const inFlightRename = inFlightRenames.get(current)
    if (!inFlightRename) return resolveLatestPath(renamedPaths, current)
    current = resolveLatestPath(renamedPaths, await inFlightRename)
  }

  return current
}

function findUnsavedFallback({
  tabs,
  activeTabPath,
  unsavedPaths,
}: {
  tabs: TabState[]
  activeTabPath: string | null
  unsavedPaths: Set<string>
}): { path: string; content: string } | undefined {
  const activeTab = tabs.find((t) => t.entry.path === activeTabPath)
  if (!activeTab || !unsavedPaths.has(activeTab.entry.path)) return undefined
  return { path: activeTab.entry.path, content: activeTab.content }
}

function isUntitledRenameCandidate(path: string): boolean {
  const filename = notePathFilename(path)
  const stem = filename.replace(/\.md$/, '')
  return stem.startsWith('untitled-') && /\d+$/.test(stem)
}

function schedulableUntitledRenameTitle({
  path,
  content,
  initialH1AutoRenameEnabled,
}: {
  path: string
  content: string
  initialH1AutoRenameEnabled: boolean
}): string | null {
  if (!isTauri() || !initialH1AutoRenameEnabled || !isUntitledRenameCandidate(path)) return null
  return extractH1TitleFromContent(content)
}

function matchingPendingRename({
  pending,
  path,
}: {
  pending: PendingUntitledRename | null
  path?: string
}): PendingUntitledRename | null {
  if (!pending) return null
  if (path && pending.path !== path) return null
  return pending
}

function takePendingRename({
  pendingRenameRef,
  path,
}: {
  pendingRenameRef: MutableRefObject<PendingUntitledRename | null>
  path?: string
}): PendingUntitledRename | null {
  const pending = matchingPendingRename({
    pending: pendingRenameRef.current,
    path,
  })
  if (!pending) return null
  clearTimeout(pending.timer)
  pendingRenameRef.current = null
  return pending
}

function schedulePendingRename({
  pendingRenameRef,
  path,
  title,
  onFire,
}: {
  pendingRenameRef: MutableRefObject<PendingUntitledRename | null>
  path: string
  title: string
  onFire: (path: string) => void
}): void {
  const currentPending = pendingRenameRef.current
  if (currentPending?.path === path && currentPending.title === title) return
  takePendingRename({ pendingRenameRef })
  const timer = setTimeout(() => {
    const pending = takePendingRename({ pendingRenameRef, path })
    if (pending) onFire(pending.path)
  }, UNTITLED_RENAME_DEBOUNCE_MS)
  pendingRenameRef.current = { path, title, timer }
}

function pendingRenameOutsideActiveTab({
  pendingRenameRef,
  activeTabPath,
}: {
  pendingRenameRef: MutableRefObject<PendingUntitledRename | null>
  activeTabPath: string | null
}): string | null {
  const pending = pendingRenameRef.current
  if (!pending || pending.path === activeTabPath) return null
  return pending.path
}

function useCurrentValueRef<T>(value: T) {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref
}

function useRenamePathRegistry() {
  const renamedPathsRef = useRef<RenamedPathMap>(new Map())
  const inFlightUntitledRenameRef = useRef<InFlightRenameMap>(new Map())

  const registerRenamedPath = useCallback((oldPath: string, newPath: string) => {
    trackRenamedPath(renamedPathsRef.current, oldPath, newPath)
  }, [])

  const resolveCurrentPath = useCallback((path: string) => resolveLatestPath(renamedPathsRef.current, path), [])
  const resolvePathBeforeSave = useCallback(
    (path: string) =>
      waitForSettledPath({
      path,
      renamedPaths: renamedPathsRef.current,
      inFlightRenames: inFlightUntitledRenameRef.current,
    }),
    [],
  )

  return {
    renamedPathsRef,
    inFlightUntitledRenameRef,
    registerRenamedPath,
    resolveCurrentPath,
    resolvePathBeforeSave,
  }
}

function useUntitledRenameExecutor(options: {
  resolvedPath: string
  tabsRef: MutableRefObject<TabState[]>
  activeTabPathRef: MutableRefObject<string | null>
  setTabs: AppSaveDeps['setTabs']
  handleSwitchTab: AppSaveDeps['handleSwitchTab']
  replaceEntry: AppSaveDeps['replaceEntry']
  loadModifiedFiles: AppSaveDeps['loadModifiedFiles']
  onInternalVaultWrite?: AppSaveDeps['onInternalVaultWrite']
  renamedPathsRef: MutableRefObject<RenamedPathMap>
  inFlightUntitledRenameRef: MutableRefObject<InFlightRenameMap>
  managedRef: MutableRefObject<ManagedRenameSeams | null>
}) {
  const { resolvedPath, tabsRef, activeTabPathRef, setTabs, handleSwitchTab, replaceEntry, loadModifiedFiles, onInternalVaultWrite, renamedPathsRef, inFlightUntitledRenameRef, managedRef } = options
  return useCallback(
    async (path: string) => {
      const managed = managedRef.current
      if (!managed) return false
      // An earlier rename of this page may still finish: it is never sent again from here.
      if (managed.isUnproven(path)) return false
      const vaultPath = vaultPathForTabPath(tabsRef.current, path, resolvedPath)
      // Admission, then this page's hold and in-flight promise, then linked pages (RENAME 6.1).
      return runAutomaticRename(path, {
        inFlight: inFlightUntitledRenameRef.current,
        vaultPath,
        linkedPaths: managed.linkedPaths,
        oldTitle: source => deriveDisplayTitleState({
          content: tabsRef.current.find(tab => notePathsMatch(tab.entry.path, source))?.content ?? '',
          filename: notePathFilename(source),
        }).title,
        readSource: source => loadNoteContent({ path: source, vaultPath }),
        // Only after a valid receipt: a page it left unrefreshed continues from its exact bytes.
        readPage: page => loadNoteContent({ path: page, vaultPath }),
        dispatch: (source, openPaths) => performAutoRename({ path: source, vaultPath, openPaths }),
        // Changes of the page wait as for a manual rename; its newer words stay held until settled.
        holdAutosave: paths => {
          managed.holdAutosave(paths)
          for (const held of paths) managed.guards.renaming.add(held)
        },
        releaseAutosave: (paths, action) => {
          for (const held of paths) managed.guards.renaming.delete(held)
          managed.releaseAutosave(paths, action)
        },
        services: { tabsRef, setTabs, ...managedRenameQueue(managed) },
        route: (oldPath, newPath) => {
          onInternalVaultWrite?.(oldPath)
          onInternalVaultWrite?.(newPath)
          // The editor is bound to the old path until it renders again; its words join the queue first.
          managed.flushEditorBuffers(oldPath)
          trackRenamedPath(renamedPathsRef.current, oldPath, newPath)
          setTabs((prev: TabState[]) => prev.map(tab => notePathsMatch(tab.entry.path, oldPath)
            ? { ...tab, entry: { ...tab.entry, path: newPath, filename: notePathFilename(newPath) } }
            : tab))
          if (notePathsMatch(activeTabPathRef.current, oldPath)) handleSwitchTab(newPath)
        },
        // Only the renamed page's entry is read again; linked pages already took their receipts.
        afterRename: async (oldPath, result) => {
          const newPath = result.receipt.new_path
          const newEntry = await invoke<VaultEntry>('reload_vault_entry', { path: newPath })
          startTransition(() => {
            setTabs((prev: TabState[]) => prev.map(tab => notePathsMatch(tab.entry.path, newPath)
              ? { ...tab, entry: { ...tab.entry, ...newEntry, path: newPath } }
              : tab))
            replaceEntry(oldPath, { ...newEntry, path: newPath }, result.sourceText)
            loadModifiedFiles()
          })
        },
      })
    },
    [
    resolvedPath,
    tabsRef,
    activeTabPathRef,
    setTabs,
    handleSwitchTab,
    replaceEntry,
    loadModifiedFiles,
    onInternalVaultWrite,
    renamedPathsRef,
    inFlightUntitledRenameRef,
    managedRef,
    ],
  )
}

function useUntitledRenameScheduler({
  executeUntitledRename,
  initialH1AutoRenameEnabled,
}: {
  executeUntitledRename: (path: string) => Promise<boolean>
  initialH1AutoRenameEnabled: boolean
}) {
  const pendingUntitledRenameRef = useRef<PendingUntitledRename | null>(null)

  const cancelPendingUntitledRename = useCallback(
    (path?: string) =>
      takePendingRename({
        pendingRenameRef: pendingUntitledRenameRef,
        path,
      }) !== null,
    [],
  )

  const flushPendingUntitledRename = useCallback(
    async (path?: string) => {
      const pending = takePendingRename({
        pendingRenameRef: pendingUntitledRenameRef,
        path,
      })
    if (!pending) return false
    return executeUntitledRename(pending.path)
    },
    [executeUntitledRename],
  )

  const scheduleUntitledRename = useCallback(
    (path: string, content: string) => {
      const title = schedulableUntitledRenameTitle({
        path,
        content,
        initialH1AutoRenameEnabled,
      })
    if (!title) {
      cancelPendingUntitledRename(path)
      return
    }

    schedulePendingRename({
      pendingRenameRef: pendingUntitledRenameRef,
      path,
      title,
      onFire: (pendingPath) => {
        void executeUntitledRename(pendingPath)
      },
    })
    },
    [cancelPendingUntitledRename, executeUntitledRename, initialH1AutoRenameEnabled],
  )

  const refreshPendingUntitledRename = useCallback(
    (path: string, content: string) => {
      if (
        !matchingPendingRename({
          pending: pendingUntitledRenameRef.current,
          path,
        })
      )
        return
    scheduleUntitledRename(path, content)
    },
    [scheduleUntitledRename],
  )

  return { pendingUntitledRenameRef, cancelPendingUntitledRename, flushPendingUntitledRename, refreshPendingUntitledRename, scheduleUntitledRename }
}

function useUntitledRenameCoordinator(options: {
  resolvedPath: string
  tabsRef: MutableRefObject<TabState[]>
  activeTabPathRef: MutableRefObject<string | null>
  setTabs: AppSaveDeps['setTabs']
  handleSwitchTab: AppSaveDeps['handleSwitchTab']
  replaceEntry: AppSaveDeps['replaceEntry']
  loadModifiedFiles: AppSaveDeps['loadModifiedFiles']
  onInternalVaultWrite?: AppSaveDeps['onInternalVaultWrite']
  initialH1AutoRenameEnabled: boolean
  managedRef: MutableRefObject<ManagedRenameSeams | null>
}) {
  const { resolvedPath, tabsRef, activeTabPathRef, setTabs, handleSwitchTab, replaceEntry, loadModifiedFiles, onInternalVaultWrite, initialH1AutoRenameEnabled, managedRef } = options
  const { renamedPathsRef, inFlightUntitledRenameRef, registerRenamedPath, resolveCurrentPath, resolvePathBeforeSave } =
    useRenamePathRegistry()
  const executeUntitledRename = useUntitledRenameExecutor({
    resolvedPath,
    tabsRef,
    activeTabPathRef,
    setTabs,
    handleSwitchTab,
    replaceEntry,
    loadModifiedFiles,
    onInternalVaultWrite,
    renamedPathsRef,
    inFlightUntitledRenameRef,
    managedRef,
  })
  const {
        pendingUntitledRenameRef,
        cancelPendingUntitledRename,
        flushPendingUntitledRename,
        refreshPendingUntitledRename,
        scheduleUntitledRename,
      } = useUntitledRenameScheduler({
        executeUntitledRename,
        initialH1AutoRenameEnabled,
      })

      return {
        pendingUntitledRenameRef,
        cancelPendingUntitledRename,
        registerRenamedPath,
        resolveCurrentPath,
        resolvePathBeforeSave,
        flushPendingUntitledRename,
        refreshPendingUntitledRename,
        scheduleUntitledRename,
      }
    }

    interface AppSaveDeps {
      updateEntry: (path: string, patch: Partial<VaultEntry>) => void
      setTabs: Parameters<typeof useEditorSaveWithLinks>[0]['setTabs']
      handleSwitchTab: (path: string) => void
      setToastMessage: (msg: string | null) => void
      loadModifiedFiles: () => void
      reloadViews?: () => Promise<void>
      trackUnsaved?: (path: string) => void
      clearUnsaved: (path: string) => void
      unsavedPaths: Set<string>
      tabs: TabState[]
      activeTabPath: string | null
      handleRenameNote: (
        path: string,
        newTitle: string,
        vaultPath: string,
        onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void,
      ) => Promise<void>
      handleRenameFilename: (
        path: string,
        newFilenameStem: string,
        vaultPath: string,
        onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void,
      ) => Promise<void>
      replaceEntry: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void
      resolvedPath: string
      writableVaultPaths?: readonly string[]
      initialH1AutoRenameEnabled: boolean
      onInternalVaultWrite?: (path: string) => void
      locale?: AppLocale
      /** Synchronously pushes a page's rich and raw editor buffers into the save queue. */
      flushEditorBuffers?: (path: string) => void
      /** Shown when a property write or manual rename is refused because the page is busy. */
      pageBusyMessage?: string
      onHistoryNote?: EditorPersistenceOptions['onHistoryNote']
    }

    interface EditorPersistenceOptions {
      updateEntry: AppSaveDeps['updateEntry']
      setTabs: AppSaveDeps['setTabs']
      setToastMessage: AppSaveDeps['setToastMessage']
      loadModifiedFiles: AppSaveDeps['loadModifiedFiles']
      trackUnsaved?: AppSaveDeps['trackUnsaved']
      clearUnsaved: AppSaveDeps['clearUnsaved']
      onInternalVaultWrite?: AppSaveDeps['onInternalVaultWrite']
      reloadViews: AppSaveDeps['reloadViews']
      refreshPendingUntitledRename: (path: string, content: string) => void
      scheduleUntitledRename: (path: string, content: string) => void
      resolveCurrentPath: (path: string) => string
      resolvePathBeforeSave: (path: string) => Promise<string>
      canPersist: boolean
      persistenceScope: string | readonly string[]
      locale: AppLocale
      onHistoryNote?: Parameters<typeof useEditorSaveWithLinks>[0]['onHistoryNote']
    }

    function useAppSaveStateRefs({
      tabs,
      activeTabPath,
      unsavedPaths,
    }: Pick<AppSaveDeps, 'tabs' | 'activeTabPath' | 'unsavedPaths'>) {
      return {
        tabsRef: useCurrentValueRef(tabs),
        activeTabPathRef: useCurrentValueRef(activeTabPath),
        unsavedPathsRef: useCurrentValueRef(unsavedPaths),
      }
    }

    function useAppSaveEffects({
      contentChangeRef,
      handleContentChange,
      cancelPendingUntitledRename,
      pendingUntitledRenameRef,
      activeTabPath,
    }: {
      contentChangeRef: MutableRefObject<(path: string, content: string) => void>
      handleContentChange: (path: string, content: string) => void
      cancelPendingUntitledRename: (path?: string) => boolean
      pendingUntitledRenameRef: MutableRefObject<PendingUntitledRename | null>
      activeTabPath: string | null
    }) {
      useEffect(() => {
        contentChangeRef.current = handleContentChange
      }, [contentChangeRef, handleContentChange])
      useEffect(
        () => () => {
          cancelPendingUntitledRename()
        },
        [cancelPendingUntitledRename],
      )
      useEffect(() => {
        const pendingPath = pendingRenameOutsideActiveTab({
          pendingRenameRef: pendingUntitledRenameRef,
          activeTabPath,
        })
        if (pendingPath) cancelPendingUntitledRename(pendingPath)
      }, [activeTabPath, cancelPendingUntitledRename, pendingUntitledRenameRef])
    }

    function useFlushBeforeAction(options: {
      canPersist: boolean
      resolveCurrentPath: (path: string) => string
      savePendingForPath: (path: string) => Promise<boolean>
      tabsRef: MutableRefObject<TabState[]>
      unsavedPathsRef: MutableRefObject<Set<string>>
      clearUnsaved: AppSaveDeps['clearUnsaved']
      setToastMessage: AppSaveDeps['setToastMessage']
      flushPendingUntitledRename: (path?: string) => Promise<boolean>
      locale: AppLocale
      /** Pages whose unsaved tab text must not be written directly (a Trash move holds them). */
      skipFallback?: (path: string) => boolean
      /** Unsaved tab text goes through the same queue and counts as saved only by its own receipt. */
      admitContent: (path: string, content: string) => ContentReceipt | null
      receiptStatus: (receipt: ContentReceipt) => ReceiptStatus
    }) {
      const { canPersist, resolveCurrentPath, savePendingForPath, tabsRef, unsavedPathsRef, clearUnsaved, setToastMessage, flushPendingUntitledRename, locale, skipFallback, admitContent, receiptStatus } = options
  const t = useMemo(() => createTranslator(locale), [locale])

  return useCallback(
    async (path: string) => {
    const currentPath = resolveCurrentPath(path)
    if (!canPersist) {
      if (unsavedPathsRef.current.has(currentPath)) {
        const message = t('save.toast.missingActiveVault')
        setToastMessage(message)
        throw new Error(message)
      }
      return
    }
    try {
      await flushEditorContent(currentPath, {
        savePendingForPath,
          getTabContent: (p) => tabsRef.current.find((t) => t.entry.path === p)?.content,
        isUnsaved: (p) => unsavedPathsRef.current.has(p) && !skipFallback?.(p),
        admitContent,
        receiptStatus,
          onSaved: (p) => {
            clearUnsaved(p)
          },
      })
      await flushPendingUntitledRename(currentPath)
    } catch (err) {
      setToastMessage(err instanceof UnmergedDraftError ? t(unmergedDraftKey(err)) : t('save.error.autoFailed', { error: String(err) }))
      throw err
    }
    },
    [
      canPersist,
      resolveCurrentPath,
      savePendingForPath,
      tabsRef,
      unsavedPathsRef,
      clearUnsaved,
      setToastMessage,
      flushPendingUntitledRename,
      skipFallback,
      admitContent,
      receiptStatus,
      t,
    ],
  )
}

async function preparePathForManualRename({
  path,
  resolveCurrentPath,
  resolvePathBeforeSave,
  cancelPendingUntitledRename,
}: {
  path: string
  resolveCurrentPath: (path: string) => string
  resolvePathBeforeSave: (path: string) => Promise<string>
  cancelPendingUntitledRename: (path?: string) => boolean
}): Promise<string> {
  const currentPath = resolveCurrentPath(path)
  cancelPendingUntitledRename(currentPath)
  const settledPath = await resolvePathBeforeSave(currentPath)
  cancelPendingUntitledRename(currentPath)
  cancelPendingUntitledRename(settledPath)
  return settledPath
}

/** Waits until no change of the page is registered; callers then act before any await. */
async function whenPageQuiet(path: string, pageMutation: (path: string) => Promise<unknown> | undefined) {
  for (let earlier = pageMutation(path); earlier; earlier = pageMutation(path)) await Promise.allSettled([earlier])
}

/** A manual rename waits for earlier page changes and blocks new ones; a folder move refuses it. */
function useRenameBarrier(options: {
  guards: PageChangeGuards
  pageMutation: (path: string) => Promise<unknown> | undefined
  resolveCurrentPath: (path: string) => string
  setToastMessage: AppSaveDeps['setToastMessage']
  locale: AppLocale
  onPageBusy: () => void
  writes: Pick<AppSaveServices, 'holdAutosave' | 'releaseAutosave' | 'drainHeld'>
  flushEditorBuffers: AppSaveDeps['flushEditorBuffers']
  linkedPaths: (sourcePath: string) => string[]
  /** An earlier change left the page unknown; renaming it could repeat a rename that may still finish. */
  isUnproven: (path: string) => boolean
}): RunManualRename {
  const { guards, pageMutation, resolveCurrentPath, setToastMessage, locale, onPageBusy, writes, flushEditorBuffers, linkedPaths, isUnproven } = options
  const { holdAutosave, releaseAutosave, drainHeld } = writes
  const t = useMemo(() => createTranslator(locale), [locale])
  return useCallback(async (path: string, rename: () => Promise<void>): Promise<void> => {
    if (guards.manualRenameHolds.size > 0) {
      onPageBusy()
      return
    }
    let current = resolveCurrentPath(path)
    if (isUnproven(current)) {
      setToastMessage(t('leadinglight.rename.unproven'))
      return
    }
    // One managed-rename admission before this page's own registration (RENAME 6.1): a rename
    // that may rewrite a page another rename holds is refused here, before anything is sent.
    let ticket = managedRenameAdmission.admit(current, linkedPaths(current))
    // Only this page's own running rename (its automatic one) is waited for, holding nothing.
    const own = ticket ? null : managedRenameAdmission.held(current)
    if (own) {
      await own.released
      if (guards.manualRenameHolds.size > 0) {
        onPageBusy()
        return
      }
      current = resolveCurrentPath(path)
      ticket = managedRenameAdmission.admit(current, linkedPaths(current))
    }
    if (!ticket) {
      onPageBusy()
      return
    }
    const admitted = ticket
    // Registered before any await, so a folder move that starts later still waits for it.
    let settle = () => {}
    const registration = new Promise<void>(resolve => { settle = resolve })
    guards.manualRenames.add(registration)
    guards.renaming.add(current)
    let held = false
    try {
      await whenPageQuiet(current, pageMutation)
      // Text typed while the file moves must not land on the old path; it resumes at the new one.
      flushEditorBuffers?.(current)
      holdAutosave([current])
      held = true
      await drainHeld(current)
      // Checked again with nothing left to wait for: an earlier change may have left it unknown meanwhile.
      if (isUnproven(current)) {
        setToastMessage(t('leadinglight.rename.unproven'))
        return
      }
      await rename()
    } catch (error) {
      if (error instanceof UnmergedDraftError) setToastMessage(t(unmergedDraftKey(error)))
      throw error
    } finally {
      if (held) releaseAutosave([current], 'resume')
      guards.renaming.delete(current)
      guards.manualRenames.delete(registration)
      settle()
      admitted.release()
    }
  }, [drainHeld, flushEditorBuffers, guards, holdAutosave, isUnproven, linkedPaths, onPageBusy, pageMutation, releaseAutosave, resolveCurrentPath, setToastMessage, t])
}

function useRenameHandlers(options: {
  resolveCurrentPath: (path: string) => string
  resolvePathBeforeSave: (path: string) => Promise<string>
  cancelPendingUntitledRename: (path?: string) => boolean
  handleRenameNote: AppSaveDeps['handleRenameNote']
  handleRenameFilename: AppSaveDeps['handleRenameFilename']
  resolvedPath: string
  tabsRef: MutableRefObject<TabState[]>
  replaceRenamedEntry: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void
  loadModifiedFiles: AppSaveDeps['loadModifiedFiles']
  withRenameBarrier: RunManualRename
}) {
  const { resolveCurrentPath, resolvePathBeforeSave, cancelPendingUntitledRename, handleRenameNote, handleRenameFilename, resolvedPath, tabsRef, replaceRenamedEntry, loadModifiedFiles, withRenameBarrier } = options
  const handleFilenameRename = useCallback(
    (path: string, newFilenameStem: string) => withRenameBarrier(path, async () => {
    const currentPath = await preparePathForManualRename({
      path,
      resolveCurrentPath,
      resolvePathBeforeSave,
      cancelPendingUntitledRename,
    })
    const renameVaultPath = vaultPathForTabPath(tabsRef.current, currentPath, resolvedPath)
      await handleRenameFilename(currentPath, newFilenameStem, renameVaultPath, replaceRenamedEntry).then(
        loadModifiedFiles,
      )
    }),
    [
      resolveCurrentPath,
      resolvePathBeforeSave,
      cancelPendingUntitledRename,
      tabsRef,
      resolvedPath,
      handleRenameFilename,
      replaceRenamedEntry,
      loadModifiedFiles,
      withRenameBarrier,
    ],
  )

  const handleTitleSync = useCallback(
    (path: string, newTitle: string) => {
    void withRenameBarrier(path, () => preparePathForManualRename({
      path,
      resolveCurrentPath,
      resolvePathBeforeSave,
      cancelPendingUntitledRename,
    })
      .then((currentPath) => {
        const renameVaultPath = vaultPathForTabPath(tabsRef.current, currentPath, resolvedPath)
        return handleRenameNote(currentPath, newTitle, renameVaultPath, replaceRenamedEntry)
      })
      .then(loadModifiedFiles))
      .catch((err) => console.error('Title rename failed:', err))
    },
    [
      resolveCurrentPath,
      resolvePathBeforeSave,
      cancelPendingUntitledRename,
      tabsRef,
      resolvedPath,
      handleRenameNote,
      replaceRenamedEntry,
      loadModifiedFiles,
      withRenameBarrier,
    ],
  )

  return { handleFilenameRename, handleTitleSync }
}

function useHandleSaveAction({
  handleSaveRaw,
  tabs,
  activeTabPath,
  unsavedPaths,
  flushPendingUntitledRename,
  resolveCurrentPath,
}: {
  handleSaveRaw: (unsavedFallback?: { path: string; content: string }) => Promise<boolean>
  tabs: TabState[]
  activeTabPath: string | null
  unsavedPaths: Set<string>
  flushPendingUntitledRename: (path?: string) => Promise<boolean>
  resolveCurrentPath: (path: string) => string
}) {
  return useCallback(async () => {
    const resolvedActiveTabPath = activeTabPath ? resolveCurrentPath(activeTabPath) : null
    const saveCompleted = await handleSaveRaw(
      findUnsavedFallback({
      tabs,
      activeTabPath: resolvedActiveTabPath,
      unsavedPaths,
      }),
    )
    if (!saveCompleted) return false
    await flushPendingUntitledRename(resolvedActiveTabPath ?? undefined)
    return true
  }, [handleSaveRaw, tabs, activeTabPath, unsavedPaths, flushPendingUntitledRename, resolveCurrentPath])
}

function useEditorPersistence(options: EditorPersistenceOptions) {
  const { updateEntry, setTabs, setToastMessage, loadModifiedFiles, trackUnsaved, clearUnsaved, onInternalVaultWrite, reloadViews, refreshPendingUntitledRename, scheduleUntitledRename, resolveCurrentPath, resolvePathBeforeSave, canPersist, persistenceScope, locale, onHistoryNote } = options
  const onAfterSave = useCallback(() => {
    loadModifiedFiles()
  }, [loadModifiedFiles])

  const onNotePersisted = useCallback(
    (path: string, content: string) => {
    onInternalVaultWrite?.(path)
    clearUnsaved(path)
    if (path.endsWith('.yml')) reloadViews?.()
    scheduleUntitledRename(path, content)
    },
    [clearUnsaved, onInternalVaultWrite, reloadViews, scheduleUntitledRename],
  )

  const {
        handleSave: handleSaveRaw,
        handleContentChange: handleContentChangeRaw,
        savePendingForPath: savePendingForPathRaw,
        savePending,
        holdAutosave,
        releaseAutosave,
        hasPendingWrite,
        receiptStatus,
        drainHeld: drainHeldRaw,
        isHeld,
        isSaveBlocked,
        recovery,
        mutateDocument,
        holdMutationAdmission,
        whenMutationsIdle,
        pageMutation,
        claimPage,
        rebaseHeldDraft,
        holdUnproven,
        isUnproven,
      } = useEditorSaveWithLinks({
        updateEntry,
        setTabs,
        setToastMessage,
        onAfterSave,
        onBeforePersist: onInternalVaultWrite,
        onNotePersisted,
        resolvePath: resolveCurrentPath,
        resolvePathBeforeSave,
        canPersist,
        persistenceScope,
        locale,
        onHistoryNote,
      })

      const handleContentChange = useCallback(
        (path: string, content: string) => {
        const currentPath = resolveCurrentPath(path)
        if (!canWritePathToVault(currentPath, persistenceScope)) return null
        refreshPendingUntitledRename(currentPath, content)
        trackUnsaved?.(currentPath)
        return handleContentChangeRaw(currentPath, content)
        },
        [handleContentChangeRaw, persistenceScope, refreshPendingUntitledRename, resolveCurrentPath, trackUnsaved],
      )

      const savePendingForPath = useCallback(
        (path: string) => {
        const currentPath = resolveCurrentPath(path)
        return canWritePathToVault(currentPath, persistenceScope)
          ? savePendingForPathRaw(currentPath)
          : Promise.resolve(false)
        },
        [savePendingForPathRaw, persistenceScope, resolveCurrentPath],
      )
      const drainHeld = useCallback(
        (path: string) => {
        const currentPath = resolveCurrentPath(path)
        return canWritePathToVault(currentPath, persistenceScope) ? drainHeldRaw(currentPath) : Promise.resolve(false)
        },
        [drainHeldRaw, persistenceScope, resolveCurrentPath],
      )

      return {
        handleSaveRaw,
        handleContentChange,
        savePendingForPath,
        savePending,
        holdAutosave,
        releaseAutosave,
        hasPendingWrite,
        receiptStatus,
        drainHeld,
        isHeld,
        isSaveBlocked,
        recovery,
        mutateDocument,
        holdMutationAdmission,
        whenMutationsIdle,
        pageMutation,
        claimPage,
        rebaseHeldDraft,
        holdUnproven,
        isUnproven,
      }
    }

    function useReplaceRenamedEntry({
      registerRenamedPath,
      replaceEntry,
    }: {
      registerRenamedPath: (oldPath: string, newPath: string) => void
      replaceEntry: AppSaveDeps['replaceEntry']
    }) {
      return useCallback(
        (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => {
        registerRenamedPath(oldPath, newEntry.path)
        replaceEntry(oldPath, newEntry, newContent)
        },
        [registerRenamedPath, replaceEntry],
      )
    }

    function useAppSaveHandlers(options: {
      contentChangeRef: MutableRefObject<(path: string, content: string) => void>
      handleContentChange: (path: string, content: string) => ContentReceipt | null
      receiptStatus: (receipt: ContentReceipt) => ReceiptStatus
      canPersist: boolean
      cancelPendingUntitledRename: (path?: string) => boolean
      pendingUntitledRenameRef: MutableRefObject<PendingUntitledRename | null>
      activeTabPath: string | null
      resolveCurrentPath: (path: string) => string
      resolvePathBeforeSave: (path: string) => Promise<string>
      savePendingForPath: (path: string) => Promise<boolean>
      tabsRef: MutableRefObject<TabState[]>
      unsavedPathsRef: MutableRefObject<Set<string>>
      clearUnsaved: AppSaveDeps['clearUnsaved']
      setToastMessage: AppSaveDeps['setToastMessage']
      flushPendingUntitledRename: (path?: string) => Promise<boolean>
      locale: AppLocale
      handleRenameNote: AppSaveDeps['handleRenameNote']
      handleRenameFilename: AppSaveDeps['handleRenameFilename']
      resolvedPath: string
      replaceRenamedEntry: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void
      loadModifiedFiles: AppSaveDeps['loadModifiedFiles']
      handleSaveRaw: (unsavedFallback?: { path: string; content: string }) => Promise<boolean>
      tabs: TabState[]
      unsavedPaths: Set<string>
      drainHeld: (path: string) => Promise<boolean>
      isHeld: (path: string) => boolean
      queueUnsavedTabText: (path: string) => void
      withRenameBarrier: RunManualRename
    }) {
      const { contentChangeRef, handleContentChange, receiptStatus, canPersist, cancelPendingUntitledRename, pendingUntitledRenameRef, activeTabPath, resolveCurrentPath, resolvePathBeforeSave, savePendingForPath, tabsRef, unsavedPathsRef, clearUnsaved, setToastMessage, flushPendingUntitledRename, locale, handleRenameNote, handleRenameFilename, resolvedPath, replaceRenamedEntry, loadModifiedFiles, handleSaveRaw, tabs, unsavedPaths, drainHeld, isHeld, queueUnsavedTabText, withRenameBarrier } = options
  useAppSaveEffects({
    contentChangeRef,
    handleContentChange,
    cancelPendingUntitledRename,
    pendingUntitledRenameRef,
    activeTabPath,
  })

  // Unsaved tab text goes through the page's queue, so it can never land after a queued change.
  const savePendingInLane = useCallback((path: string) => {
    queueUnsavedTabText(path)
    return savePendingForPath(path)
  }, [queueUnsavedTabText, savePendingForPath])
  const flushOptions = { canPersist, resolveCurrentPath, tabsRef, unsavedPathsRef, clearUnsaved, setToastMessage, flushPendingUntitledRename, locale, admitContent: handleContentChange, receiptStatus }
  const flushBeforeAction = useFlushBeforeAction({ ...flushOptions, savePendingForPath: savePendingInLane, skipFallback: isHeld })
  // Only the Trash move writes the pages it holds.
  const flushForTrash = useFlushBeforeAction({ ...flushOptions, savePendingForPath: drainHeld })
  const { handleFilenameRename, handleTitleSync } = useRenameHandlers({
    resolveCurrentPath,
    resolvePathBeforeSave,
    cancelPendingUntitledRename,
    handleRenameNote,
    handleRenameFilename,
    resolvedPath,
    tabsRef,
    replaceRenamedEntry,
    loadModifiedFiles,
    withRenameBarrier,
  })
  const handleSave = useHandleSaveAction({
    handleSaveRaw,
    tabs,
    activeTabPath,
    unsavedPaths,
    flushPendingUntitledRename,
    resolveCurrentPath,
  })

  return {
    handleFilenameRename,
    handleSave,
    handleTitleSync,
    flushBeforeAction,
    flushForTrash,
  }
}

function useAppSaveServices(
  options: AppSaveDeps,
  refs: ReturnType<typeof useAppSaveStateRefs>,
  canPersist: boolean,
) {
  const { updateEntry, setTabs, handleSwitchTab, setToastMessage, loadModifiedFiles, reloadViews, trackUnsaved, clearUnsaved, replaceEntry, resolvedPath, writableVaultPaths, initialH1AutoRenameEnabled, onInternalVaultWrite, locale = 'en', onHistoryNote } = options
  const { tabsRef, activeTabPathRef } = refs
  // Filled once the page-change services below exist; the automatic rename reads it when it runs.
  const managedRef = useRef<ManagedRenameSeams | null>(null)
  const {
    pendingUntitledRenameRef,
    cancelPendingUntitledRename,
    registerRenamedPath,
    resolveCurrentPath,
    resolvePathBeforeSave,
    flushPendingUntitledRename,
    refreshPendingUntitledRename,
    scheduleUntitledRename,
  } = useUntitledRenameCoordinator({
    resolvedPath,
    tabsRef,
    activeTabPathRef,
    setTabs,
    handleSwitchTab,
    replaceEntry,
    loadModifiedFiles,
    onInternalVaultWrite,
    initialH1AutoRenameEnabled,
    managedRef,
  })
  const [guards] = useState<PageChangeGuards>(() => ({ renaming: new Set(), renameSuppressed: new Set(), deferredRenames: new Map(), manualRenames: new Set(), manualRenameHolds: new Set() }))
  // While a page change runs, its automatic rename waits; it is scheduled again once the change settles.
  const scheduleRenameUnlessChanging = useCallback((path: string, content: string) => {
    if (guardedPath(guards.renameSuppressed, path, resolveCurrentPath) !== undefined) {
      guards.deferredRenames.set(resolveCurrentPath(path), content)
      return
    }
    scheduleUntitledRename(path, content)
  }, [guards, resolveCurrentPath, scheduleUntitledRename])
  const { handleSaveRaw, handleContentChange, savePendingForPath, savePending, holdAutosave, releaseAutosave, hasPendingWrite, receiptStatus, drainHeld, isHeld, isSaveBlocked, recovery, mutateDocument, holdMutationAdmission, whenMutationsIdle, pageMutation, claimPage, rebaseHeldDraft, holdUnproven, isUnproven } = useEditorPersistence({
    updateEntry,
    setTabs,
    setToastMessage,
    loadModifiedFiles,
    trackUnsaved,
    clearUnsaved,
    onInternalVaultWrite,
    reloadViews,
    refreshPendingUntitledRename,
    scheduleUntitledRename: scheduleRenameUnlessChanging,
    resolveCurrentPath,
    resolvePathBeforeSave,
    canPersist,
    persistenceScope: writableVaultPaths && writableVaultPaths.length > 0 ? writableVaultPaths : resolvedPath,
    locale,
    onHistoryNote,
  })
  const replaceRenamedEntry = useReplaceRenamedEntry({
    registerRenamedPath,
    replaceEntry,
  })
  return { pendingUntitledRenameRef, cancelPendingUntitledRename, registerRenamedPath, resolveCurrentPath, resolvePathBeforeSave, flushPendingUntitledRename, scheduleUntitledRename, handleSaveRaw, handleContentChange, savePendingForPath, savePending, holdAutosave, releaseAutosave, hasPendingWrite, receiptStatus, drainHeld, isHeld, isSaveBlocked, recovery, replaceRenamedEntry, guards, mutateDocument, holdMutationAdmission, whenMutationsIdle, pageMutation, claimPage, rebaseHeldDraft, holdUnproven, isUnproven, managedRef }
}

type AppSaveServices = ReturnType<typeof useAppSaveServices>

/** Unsaved tab text with nothing queued is queued, so the page's queue is the only writer. */
function useUnsavedTabQueue(services: AppSaveServices, refs: ReturnType<typeof useAppSaveStateRefs>) {
  const { handleContentChange, hasPendingWrite, isHeld } = services
  const { tabsRef, unsavedPathsRef } = refs
  return useCallback((path: string) => {
    if (hasPendingWrite(path) || isHeld(path) || !unsavedPathsRef.current.has(path)) return
    const tab = tabsRef.current.find(candidate => candidate.entry.path === path)
    if (tab) handleContentChange(path, tab.content)
  }, [handleContentChange, hasPendingWrite, isHeld, tabsRef, unsavedPathsRef])
}

type AdmitExistingDocument = <R>(
  path: string,
  mutation: Omit<DocumentMutation<R>, 'flushBuffers'>,
  claim?: Promise<void>,
) => MutationAdmission<R>

/** The Favorite and property seam: one change, admitted synchronously, run inside the page's save queue. */
function useExistingDocumentMutation(
  services: AppSaveServices,
  tabsRef: MutableRefObject<TabState[]>,
  queueUnsavedTabText: (path: string) => void,
  flushEditorBuffers: AppSaveDeps['flushEditorBuffers'],
): AdmitExistingDocument {
  const { guards, mutateDocument, cancelPendingUntitledRename, resolveCurrentPath, scheduleUntitledRename } = services
  return useCallback(<R,>(path: string, mutation: Omit<DocumentMutation<R>, 'flushBuffers'>, claim?: Promise<void>): MutationAdmission<R> => {
    const current = resolveCurrentPath(path)
    if (guardedPath(guards.renaming, current, resolveCurrentPath) !== undefined) return { admitted: false, reason: 'renaming' }
    queueUnsavedTabText(current)
    const admission = mutateDocument(current, { ...mutation, flushBuffers: flushEditorBuffers }, claim)
    if (!admission.admitted) return admission
    guards.renameSuppressed.add(admission.path)
    if (cancelPendingUntitledRename(admission.path)) {
      const tab = tabsRef.current.find(candidate => notePathsMatch(candidate.entry.path, admission.path))
      guards.deferredRenames.set(admission.path, tab?.content ?? '')
    }
    void admission.done.then(settled => {
      guards.renameSuppressed.delete(admission.path)
      const deferred = guardedPath(guards.deferredRenames.keys(), settled.path, resolveCurrentPath)
      if (deferred === undefined) return
      const content = guards.deferredRenames.get(deferred) ?? ''
      guards.deferredRenames.delete(deferred)
      const latest = settled.kind === 'returned' ? settled.latest : null
      scheduleUntitledRename(resolveCurrentPath(settled.path), latest ?? content)
    })
    return admission
  }, [cancelPendingUntitledRename, flushEditorBuffers, guards, mutateDocument, queueUnsavedTabText, resolveCurrentPath, scheduleUntitledRename, tabsRef])
}

type TrashBoundaryServices = Pick<AppSaveServices, 'holdAutosave' | 'releaseAutosave' | 'hasPendingWrite' | 'cancelPendingUntitledRename' | 'resolveCurrentPath' | 'resolvePathBeforeSave' | 'pageMutation' | 'isUnproven'>

/**
 * LeadingLight Trash: automatic writes are held while a page moves; `prepareForTrash` writes its
 * latest text, settles automatic renames and returns the path to move. Folder moves use it too.
 */
function useTrashSaveBoundary(services: TrashBoundaryServices, flushForTrash: (path: string) => Promise<void>) {
  const { holdAutosave, releaseAutosave, hasPendingWrite, cancelPendingUntitledRename, resolveCurrentPath, resolvePathBeforeSave, pageMutation, isUnproven } = services
  // A move or Trash is a write too: a page an earlier change left unknown is never moved, typed or clean.
  const refuseUnproven = useCallback((path: string) => {
    if (isUnproven(path)) throw new UnmergedDraftError(resolveCurrentPath(path), true)
  }, [isUnproven, resolveCurrentPath])
  const prepareForTrash = useCallback(async (path: string) => {
    refuseUnproven(path)
    // A change admitted before the hold finishes first; its newer text then moves with the page.
    await pageMutation(resolveCurrentPath(path))
    await flushForTrash(path)
    let settled = await resolvePathBeforeSave(resolveCurrentPath(path))
    if (settled !== path) {
      holdAutosave([settled])
      await flushForTrash(settled)
      settled = await resolvePathBeforeSave(resolveCurrentPath(settled))
    }
    // A rename must not start while the file is moving.
    cancelPendingUntitledRename(settled)
    // Again with nothing left to wait for: an earlier change or rename may have ended unknown meanwhile.
    refuseUnproven(settled)
    return settled
  }, [cancelPendingUntitledRename, flushForTrash, holdAutosave, pageMutation, refuseUnproven, resolveCurrentPath, resolvePathBeforeSave])
  const releaseHeldWrites = useCallback((paths: readonly string[], action: 'discard' | 'resume' | 'release') => {
    if (action === 'discard') for (const path of paths) cancelPendingUntitledRename(path)
    releaseAutosave(paths, action)
  }, [cancelPendingUntitledRename, releaseAutosave])
  return { holdWrites: holdAutosave, releaseHeldWrites, prepareForTrash, hasPendingWrite }
}

/** Property writes: after earlier changes of the page settle, claimed before any await, released in finally. */
function usePageExclusive(services: AppSaveServices, admit: AdmitExistingDocument, onPageBusy: () => void): RunPageExclusive {
  const { guards, pageMutation, claimPage, resolveCurrentPath } = services
  return useCallback(async (path, work) => {
    const current = resolveCurrentPath(path)
    // A quiet page is claimed in this same turn, so nothing can start on it first.
    if (pageMutation(current)) await whenPageQuiet(current, pageMutation)
    const renaming = guardedPath(guards.renaming, current, resolveCurrentPath) !== undefined
    const page = renaming ? null : claimPage(current)
    if (!page) {
      onPageBusy()
      return false
    }
    try {
      return await work((target, mutation) => admit(target, mutation, page.claim))
    } finally {
      page.release()
    }
  }, [admit, claimPage, guards, onPageBusy, pageMutation, resolveCurrentPath])
}

/** A folder move holds new manual renames first, then joins the ones already running. */
function useManualRenameAdmission(guards: PageChangeGuards) {
  const isManualRenameAdmissionHeld = useCallback(() => guards.manualRenameHolds.size > 0, [guards])
  const holdManualRenameAdmission = useCallback(() => {
    const hold = {}
    guards.manualRenameHolds.add(hold)
    return () => { guards.manualRenameHolds.delete(hold) }
  }, [guards])
  const whenManualRenamesIdle = useCallback(async () => {
    while (guards.manualRenames.size > 0) await Promise.all([...guards.manualRenames])
  }, [guards])
  return { holdManualRenameAdmission, whenManualRenamesIdle, isManualRenameAdmissionHeld }
}

export function useAppSave(options: AppSaveDeps) {
  const { setToastMessage, loadModifiedFiles, clearUnsaved, unsavedPaths, tabs, activeTabPath, handleRenameNote, handleRenameFilename: handleRenameFilenameRaw, resolvedPath, locale = 'en' } = options
  const contentChangeRef = useRef<(path: string, content: string) => void>(() => {})
  const canPersist = resolvedPath.trim().length > 0
  const refs = useAppSaveStateRefs({ tabs, activeTabPath, unsavedPaths })
  const { tabsRef, unsavedPathsRef } = refs
  const services = useAppSaveServices(options, refs, canPersist)
  const { pendingUntitledRenameRef, cancelPendingUntitledRename, registerRenamedPath, resolveCurrentPath, resolvePathBeforeSave, flushPendingUntitledRename, handleSaveRaw, handleContentChange, savePendingForPath, savePending, receiptStatus, replaceRenamedEntry, drainHeld, isHeld, recovery, guards, pageMutation, holdMutationAdmission, whenMutationsIdle } = services
  const queueUnsavedTabText = useUnsavedTabQueue(services, refs)
  const mutateExistingDocument = useExistingDocumentMutation(services, tabsRef, queueUnsavedTabText, options.flushEditorBuffers)
  const { pageBusyMessage } = options
  const onPageBusy = useCallback(() => {
    if (pageBusyMessage) setToastMessage(pageBusyMessage)
    else console.warn('[save] A page change was refused because the page is busy')
  }, [pageBusyMessage, setToastMessage])
  const runPageExclusive = usePageExclusive(services, mutateExistingDocument, onPageBusy)
  const { holdManualRenameAdmission, whenManualRenamesIdle, isManualRenameAdmissionHeld } = useManualRenameAdmission(guards)
  // Every page besides the source whose text this window holds: open tabs and pending writes.
  const managedRenameLinkedPaths = useCallback((sourcePath: string) => [...new Set([
    ...tabsRef.current.map(tab => tab.entry.path), ...unsavedPathsRef.current,
  ])].filter(path => !notePathsMatch(path, sourcePath)), [tabsRef, unsavedPathsRef])
  const { flushEditorBuffers } = options
  const { rebaseHeldDraft: rebaseQueuedDraft, holdUnproven: holdQueuedUnproven, isUnproven } = services
  // Words still in an editor join the queue first. A buffer that cannot be read may hold words the
  // queue never saw, so its page is held as unknown: never settled, replaced or called clean.
  const flushRenameBuffers = useCallback((path: string): boolean => {
    try {
      flushEditorBuffers?.(path)
      return true
    } catch (error) {
      console.warn('[save] Editor buffers could not be read; the page is held unsaved:', error)
      holdQueuedUnproven(path)
      return false
    }
  }, [flushEditorBuffers, holdQueuedUnproven])
  const rebaseHeldDraft = useCallback<RebaseHeldDraft>((path, rebase): HeldDraftRebase => {
    flushRenameBuffers(path)
    return rebaseQueuedDraft(path, rebase)
  }, [flushRenameBuffers, rebaseQueuedDraft])
  // Held before its buffers are read, so a buffer that throws cannot leave the page writable.
  const holdUnproven = useCallback((path: string): HeldDraftRebase => {
    holdQueuedUnproven(path)
    return flushRenameBuffers(path) ? holdQueuedUnproven(path) : 'unmergedDraft'
  }, [flushRenameBuffers, holdQueuedUnproven])
  // Routing moves a page's queue identity; an editor still bound to the old path hands its words over
  // first. The file has moved either way, so the route is recorded even when that handover failed.
  const trackRenamedPath = useCallback((oldPath: string, newPath: string) => {
    flushRenameBuffers(oldPath)
    registerRenamedPath(oldPath, newPath)
  }, [flushRenameBuffers, registerRenamedPath])
  const flushManagedRenameBuffers = useCallback((path: string) => { flushRenameBuffers(path) }, [flushRenameBuffers])
  const { managedRef, holdAutosave, releaseAutosave } = services
  useLayoutEffect(() => {
    managedRef.current = {
      mutate: mutateExistingDocument, rebaseHeldDraft, holdUnproven, isUnproven, flushEditorBuffers: flushManagedRenameBuffers,
      holdAutosave, releaseAutosave, linkedPaths: managedRenameLinkedPaths, guards,
    }
  }, [flushManagedRenameBuffers, guards, holdAutosave, holdUnproven, isUnproven, managedRef, managedRenameLinkedPaths, mutateExistingDocument, rebaseHeldDraft, releaseAutosave])
  const withRenameBarrier = useRenameBarrier({ guards, pageMutation, resolveCurrentPath, setToastMessage, locale, onPageBusy, writes: services, flushEditorBuffers: options.flushEditorBuffers, linkedPaths: managedRenameLinkedPaths, isUnproven })
  const { handleFilenameRename, handleSave, handleTitleSync, flushBeforeAction, flushForTrash } = useAppSaveHandlers({
    contentChangeRef,
    handleContentChange,
    receiptStatus,
    canPersist,
    cancelPendingUntitledRename,
    pendingUntitledRenameRef,
    activeTabPath,
    resolveCurrentPath,
    savePendingForPath,
    tabsRef,
    unsavedPathsRef,
    clearUnsaved,
    setToastMessage,
    flushPendingUntitledRename,
    locale,
    handleRenameNote,
    handleRenameFilename: handleRenameFilenameRaw,
    resolvedPath,
    resolvePathBeforeSave,
    replaceRenamedEntry,
    loadModifiedFiles,
    handleSaveRaw,
    tabs,
    unsavedPaths,
    drainHeld,
    isHeld,
    queueUnsavedTabText,
    withRenameBarrier,
  })
  const trashBoundary = useTrashSaveBoundary(services, flushForTrash)

  return {
    contentChangeRef,
    handleContentChange,
    handleFilenameRename,
    handleSave,
    handleTitleSync,
    savePending,
    savePendingForPath,
    receiptStatus,
    /** Save holds, retriable failures and the guarded final resolution, for the recovery UI. */
    saveRecovery: recovery,
    trackRenamedPath,
    flushBeforeAction,
    mutateExistingDocument,
    holdMutationAdmission,
    whenMutationsIdle,
    runPageExclusive,
    withManualRename: withRenameBarrier,
    /** RENAME seams: settle a renamed page's held text, and the pages a managed rename protects. */
    rebaseHeldDraft,
    /** A page left unproven by its own change (a rename with no proof either way) saves nothing more. */
    holdUnproven,
    /** Whether an earlier change left the page unknown: nothing may rename, move or change it now. */
    isUnproven,
    /** The managed rename's buffer flush, failing closed (see `flushRenameBuffers`). */
    flushManagedRenameBuffers,
    managedRenameLinkedPaths,
    holdManualRenameAdmission,
    whenManualRenamesIdle,
    isManualRenameAdmissionHeld,
    ...trashBoundary,
  }
}
