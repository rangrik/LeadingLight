import { useCallback, useEffect, useRef, useState } from 'react'
import type { VaultEntry } from '../types'
import {
  beginNoteOpenTrace,
  failNoteOpenTrace,
  finishNoteOpenTrace,
  markNoteOpenTrace,
} from '../utils/noteOpenPerformance'
import {
  cacheNoteContent as cacheNoteContentInMemory,
  clearNoteContentCache,
  getCachedNoteContentEntry,
  hasResolvedCachedContent,
  isNoActiveVaultSelectedError,
  isUnreadableNoteContentError,
  loadContentForOpen,
  NOTE_CONTENT_CACHE_LIMIT,
  NOTE_CONTENT_CACHE_MAX_BYTES,
  NOTE_CONTENT_ENTRY_MAX_BYTES,
  NOTE_CONTENT_PREFETCH_CONCURRENCY,
  prefetchNoteContent as prefetchNoteContentInMemory,
  type NoteContentRequestOptions,
} from './noteContentCache'
import { clearParsedNoteBlockCache } from './editorParsedBlockCache'
import { notePathsMatch } from '../utils/notePathIdentity'
import { normalizeVaultEntry } from '../utils/vaultMetadataNormalization'

interface Tab {
  entry: VaultEntry
  content: string
  /** LeadingLight: the path this same page had before an in-place rename. Navigation never sets it. */
  renamedFrom?: string
}

export {
  NOTE_CONTENT_CACHE_LIMIT,
  NOTE_CONTENT_CACHE_MAX_BYTES,
  NOTE_CONTENT_ENTRY_MAX_BYTES,
  NOTE_CONTENT_PREFETCH_CONCURRENCY,
}

export function prefetchNoteContent(target: string | VaultEntry, options?: NoteContentRequestOptions): void {
  prefetchNoteContentInMemory(target, options)
}

export function cacheNoteContent(
  path: string,
  content: string,
  entry?: VaultEntry,
  options?: NoteContentRequestOptions,
): void {
  cacheNoteContentInMemory(path, content, entry, options)
}

/** Clear note-open caches. Call on vault reload to prevent stale content. */
export function clearPrefetchCache(): void {
  clearNoteContentCache()
  clearParsedNoteBlockCache()
}

export type { Tab }

interface TabManagementOptions {
  beforeNavigate?: (fromPath: string, toPath: string) => Promise<void>
  hasUnsavedChanges?: (path: string) => boolean
  onMissingActiveVault?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  onMissingNotePath?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  onUnreadableNoteContent?: (entry: VaultEntry, error: unknown) => void | Promise<void>
}

interface NavigateToEntryOptions {
  entry: VaultEntry
  sourceEntry?: VaultEntry
  forceReload?: boolean
  navSeqRef: React.MutableRefObject<number>
  tabsRef: React.MutableRefObject<Tab[]>
  activeTabPathRef: React.MutableRefObject<string | null>
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>
  hasUnsavedChanges?: (path: string) => boolean
  onMissingActiveVault?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  onMissingNotePath?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  onUnreadableNoteContent?: (entry: VaultEntry, error: unknown) => void | Promise<void>
}

function syncActiveTabPath(
  activeTabPathRef: React.MutableRefObject<string | null>,
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>,
  path: string | null,
) {
  activeTabPathRef.current = path
  setActiveTabPath(path)
}

function resetRequestedPathIfStillPending(
  requestedActiveTabPathRef: React.MutableRefObject<string | null>,
  activeTabPathRef: React.MutableRefObject<string | null>,
  pendingPath: string,
) {
  if (requestedActiveTabPathRef.current === pendingPath) {
    requestedActiveTabPathRef.current = activeTabPathRef.current
  }
}

function setSingleTab(
  tabsRef: React.MutableRefObject<Tab[]>,
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>,
  nextTab: Tab,
) {
  tabsRef.current = [nextTab]
  setTabs([nextTab])
}

function clearTabs(
  tabsRef: React.MutableRefObject<Tab[]>,
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>,
) {
  tabsRef.current = []
  setTabs([])
}

function normalizeOpenEntry(entry: VaultEntry): VaultEntry | null {
  const path = typeof entry.path === 'string' ? entry.path.trim() : ''
  if (!path) return null
  return normalizeVaultEntry({ ...entry, path })
}

function callbackEntryForLoadFailure(entry: VaultEntry, sourceEntry?: VaultEntry): VaultEntry {
  return sourceEntry ? { ...sourceEntry, path: entry.path } : entry
}

function isAlreadyViewingPath(
  tabsRef: React.MutableRefObject<Tab[]>,
  activeTabPathRef: React.MutableRefObject<string | null>,
  path: string,
) {
  return notePathsMatch(activeTabPathRef.current, path)
    || tabsRef.current.some((tab) => notePathsMatch(tab.entry.path, path))
}

function startEntryNavigation(options: {
  entry: VaultEntry
  navSeqRef: React.MutableRefObject<number>
  activeTabPathRef: React.MutableRefObject<string | null>
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const {
    entry,
    navSeqRef,
    activeTabPathRef,
    setActiveTabPath,
  } = options

  const seq = ++navSeqRef.current
  const cachedEntry = getCachedNoteContentEntry(entry.path)
  syncActiveTabPath(activeTabPathRef, setActiveTabPath, entry.path)
  if (hasResolvedCachedContent(cachedEntry)) {
    markNoteOpenTrace(entry.path, 'cacheReady')
  }

  return { seq, cachedEntry }
}

function openBinaryEntry(options: {
  entry: VaultEntry
  navSeqRef: React.MutableRefObject<number>
  tabsRef: React.MutableRefObject<Tab[]>
  activeTabPathRef: React.MutableRefObject<string | null>
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const {
    entry,
    navSeqRef,
    tabsRef,
    activeTabPathRef,
    setTabs,
    setActiveTabPath,
  } = options

  navSeqRef.current += 1
  syncActiveTabPath(activeTabPathRef, setActiveTabPath, entry.path)
  setSingleTab(tabsRef, setTabs, { entry, content: '' })
  finishNoteOpenTrace(entry.path)
}

function isMissingNotePathError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : String(error)
  return /does not exist|not found|enoent/i.test(message)
}

function shouldApplyLoadedEntry(options: {
  seq: number
  navSeqRef: React.MutableRefObject<number>
  content: string
  forceReload: boolean
  activeTabPathRef: React.MutableRefObject<string | null>
  tabsRef: React.MutableRefObject<Tab[]>
  path: string
}) {
  const {
    seq,
    navSeqRef,
    content,
    forceReload,
    activeTabPathRef,
    tabsRef,
    path,
  } = options

  if (navSeqRef.current !== seq) return false
  if (forceReload) return true
  if (!notePathsMatch(activeTabPathRef.current, path)) return true
  const openTab = tabsRef.current.find((tab) => notePathsMatch(tab.entry.path, path))
  return !openTab || openTab.content !== content
}

type EntryLoadFailureKind =
  | 'missing-active-vault'
  | 'missing-path'
  | 'unreadable-content'
  | 'load-failed'

type RecoverableEntryLoadFailureKind = Exclude<EntryLoadFailureKind, 'load-failed'>

function getEntryLoadFailureKind(error: unknown): EntryLoadFailureKind {
  if (isNoActiveVaultSelectedError(error)) return 'missing-active-vault'
  if (isMissingNotePathError(error)) return 'missing-path'
  if (isUnreadableNoteContentError(error)) return 'unreadable-content'
  return 'load-failed'
}

function resetFailedEntrySelection(options: {
  tabsRef: React.MutableRefObject<Tab[]>
  activeTabPathRef: React.MutableRefObject<string | null>
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const { tabsRef, activeTabPathRef, setTabs, setActiveTabPath } = options
  clearTabs(tabsRef, setTabs)
  syncActiveTabPath(activeTabPathRef, setActiveTabPath, null)
}

function runEntryFailureCallback(options: {
  callback?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  entry: VaultEntry
  error: unknown
  warning: string
}) {
  const { callback, entry, error, warning } = options
  Promise.resolve(callback?.(entry, error)).catch((callbackError) => {
    console.warn(warning, callbackError)
  })
}

function handleRecoverableEntryLoadFailure(options: {
  kind: RecoverableEntryLoadFailureKind
  entry: VaultEntry
  callbackEntry: VaultEntry
  tabsRef: React.MutableRefObject<Tab[]>
  activeTabPathRef: React.MutableRefObject<string | null>
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>
  error: unknown
  onMissingActiveVault?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  onMissingNotePath?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  onUnreadableNoteContent?: (entry: VaultEntry, error: unknown) => void | Promise<void>
}) {
  const {
    kind,
    entry,
    callbackEntry,
    tabsRef,
    activeTabPathRef,
    setTabs,
    setActiveTabPath,
    error,
    onMissingActiveVault,
    onMissingNotePath,
    onUnreadableNoteContent,
  } = options

  if (kind === 'missing-active-vault') {
    clearPrefetchCache()
  }

  resetFailedEntrySelection({
    tabsRef,
    activeTabPathRef,
    setTabs,
    setActiveTabPath,
  })
  failNoteOpenTrace(entry.path, kind)

  if (kind === 'missing-active-vault') {
    runEntryFailureCallback({
      callback: onMissingActiveVault,
      entry: callbackEntry,
      error,
      warning: 'Failed to handle missing active vault:',
    })
    return
  }

  if (kind === 'missing-path') {
    runEntryFailureCallback({
      callback: onMissingNotePath,
      entry: callbackEntry,
      error,
      warning: 'Failed to handle missing note path:',
    })
    return
  }

  runEntryFailureCallback({
    callback: onUnreadableNoteContent,
    entry: callbackEntry,
    error,
    warning: 'Failed to handle unreadable note content:',
  })
}

function handleEntryLoadFailure(options: {
  entry: VaultEntry
  callbackEntry: VaultEntry
  seq: number
  navSeqRef: React.MutableRefObject<number>
  tabsRef: React.MutableRefObject<Tab[]>
  activeTabPathRef: React.MutableRefObject<string | null>
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>
  error: unknown
  onMissingActiveVault?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  onMissingNotePath?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  onUnreadableNoteContent?: (entry: VaultEntry, error: unknown) => void | Promise<void>
}) {
  const {
    entry,
    callbackEntry,
    seq,
    navSeqRef,
    tabsRef,
    activeTabPathRef,
    setTabs,
    setActiveTabPath,
    error,
    onMissingActiveVault,
    onMissingNotePath,
    onUnreadableNoteContent,
  } = options

  console.warn('Failed to load note content:', error)
  if (navSeqRef.current !== seq) return

  const failureKind = getEntryLoadFailureKind(error)
  if (failureKind !== 'load-failed') {
    handleRecoverableEntryLoadFailure({
      kind: failureKind,
      entry,
      callbackEntry,
      tabsRef,
      activeTabPathRef,
      setTabs,
      setActiveTabPath,
      error,
      onMissingActiveVault,
      onMissingNotePath,
      onUnreadableNoteContent,
    })
    return
  }

  resetFailedEntrySelection({
    tabsRef,
    activeTabPathRef,
    setTabs,
    setActiveTabPath,
  })
  failNoteOpenTrace(entry.path, 'load-failed')
}

function reopenAlreadyViewingEntry({
  entry,
  tabsRef,
  activeTabPathRef,
  setActiveTabPath,
  hasUnsavedChanges,
}: Pick<NavigateToEntryOptions, 'entry' | 'tabsRef' | 'activeTabPathRef' | 'setActiveTabPath' | 'hasUnsavedChanges'>): boolean {
  if (!isAlreadyViewingPath(tabsRef, activeTabPathRef, entry.path)) return false
  if (!hasUnsavedChanges?.(entry.path)) return false
  syncActiveTabPath(activeTabPathRef, setActiveTabPath, entry.path)
  finishNoteOpenTrace(entry.path)
  return true
}

async function loadTextEntry(options: Required<Pick<NavigateToEntryOptions, 'forceReload'>> & NavigateToEntryOptions) {
  const {
    entry,
    sourceEntry,
    forceReload,
    navSeqRef,
    tabsRef,
    activeTabPathRef,
    setTabs,
    setActiveTabPath,
    onMissingActiveVault,
    onMissingNotePath,
    onUnreadableNoteContent,
  } = options

  const { seq, cachedEntry } = startEntryNavigation({
    entry,
    navSeqRef,
    activeTabPathRef,
    setActiveTabPath,
  })

  try {
    markNoteOpenTrace(entry.path, 'contentLoadStart')
    const content = await loadContentForOpen({
      entry,
      forceReload,
      cachedEntry,
    })
    markNoteOpenTrace(entry.path, 'contentLoadEnd')
    if (!shouldApplyLoadedEntry({
      seq,
      navSeqRef,
      content,
      forceReload,
      activeTabPathRef,
      tabsRef,
      path: entry.path,
    })) return
    setSingleTab(tabsRef, setTabs, { entry, content })
  } catch (err) {
    handleEntryLoadFailure({
      entry,
      callbackEntry: callbackEntryForLoadFailure(entry, sourceEntry),
      seq,
      navSeqRef,
      tabsRef,
      activeTabPathRef,
      setTabs,
      setActiveTabPath,
      error: err,
      onMissingActiveVault,
      onMissingNotePath,
      onUnreadableNoteContent,
    })
  }
}

async function navigateToEntry(options: NavigateToEntryOptions) {
  const forceReload = options.forceReload ?? false

  if (options.entry.fileKind === 'binary') {
    openBinaryEntry(options)
    return
  }

  if (!forceReload && reopenAlreadyViewingEntry(options)) return

  await loadTextEntry({ ...options, forceReload })
}

export function useTabManagement(options: TabManagementOptions = {}) {
  // Single-note model: tabs has 0 or 1 elements.
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null)
  const activeTabPathRef = useRef(activeTabPath)
  const requestedActiveTabPathRef = useRef<string | null>(activeTabPath)
  useEffect(() => { activeTabPathRef.current = activeTabPath })
  const tabsRef = useRef(tabs)
  useEffect(() => { tabsRef.current = tabs })

  // Sequence counter for rapid-switch safety: only the latest navigation wins.
  const navSeqRef = useRef(0)
  const beforeNavigateSeqRef = useRef(0)
  const beforeNavigate = options.beforeNavigate
  const hasUnsavedChanges = options.hasUnsavedChanges
  const onMissingActiveVault = options.onMissingActiveVault
  const onMissingNotePath = options.onMissingNotePath
  const onUnreadableNoteContent = options.onUnreadableNoteContent

  const executeNavigationWithBoundary = useCallback(async (
    targetPath: string,
    navigate: () => void | Promise<void>,
  ) => {
    const seq = ++beforeNavigateSeqRef.current
    const currentPath = activeTabPathRef.current
    if (beforeNavigate && currentPath && !notePathsMatch(currentPath, targetPath)) {
      try {
        markNoteOpenTrace(targetPath, 'beforeNavigateStart')
        await beforeNavigate(currentPath, targetPath)
        markNoteOpenTrace(targetPath, 'beforeNavigateEnd')
      } catch (err) {
        console.warn('Failed to persist note before navigation:', err)
        failNoteOpenTrace(targetPath, 'before-navigate-failed')
        return false
      }
      if (beforeNavigateSeqRef.current !== seq) return false
    }
    await navigate()
    return true
  }, [beforeNavigate])

  /** Open a note — replaces the current note (single-note model). */
  const handleSelectNote = useCallback(async (entry: VaultEntry) => {
    const openEntry = normalizeOpenEntry(entry)
    if (!openEntry) return
    requestedActiveTabPathRef.current = openEntry.path
    const alreadyViewingDirtyEntry = notePathsMatch(openEntry.path, activeTabPathRef.current)
      && !!hasUnsavedChanges?.(openEntry.path)
    if (!alreadyViewingDirtyEntry) {
      beginNoteOpenTrace(openEntry.path, 'select-note')
    }
    const navigated = await executeNavigationWithBoundary(openEntry.path, () => navigateToEntry({
      entry: openEntry,
      sourceEntry: entry,
      navSeqRef,
      tabsRef,
      activeTabPathRef,
      setTabs,
      setActiveTabPath,
      hasUnsavedChanges,
      onMissingActiveVault,
      onMissingNotePath,
      onUnreadableNoteContent,
    }))
    if (!navigated) {
      resetRequestedPathIfStillPending(requestedActiveTabPathRef, activeTabPathRef, openEntry.path)
    }
  }, [executeNavigationWithBoundary, hasUnsavedChanges, onMissingActiveVault, onMissingNotePath, onUnreadableNoteContent])

  const handleSwitchTab = useCallback((path: string) => {
    requestedActiveTabPathRef.current = path
    syncActiveTabPath(activeTabPathRef, setActiveTabPath, path)
  }, [])

  /** Open a tab with known content — no IPC round-trip. Used for newly created notes. Resolves whether it opened. */
  const openTabWithContent = useCallback(async (entry: VaultEntry, content: string, canCommit?: () => boolean) => {
    const openEntry = normalizeOpenEntry(entry)
    if (!openEntry) return false
    requestedActiveTabPathRef.current = openEntry.path
    let opened = false
    const navigation = executeNavigationWithBoundary(openEntry.path, () => {
      if (canCommit && !canCommit()) return
      // The shown page supersedes older reads still loading in this lane.
      navSeqRef.current += 1
      cacheNoteContent(openEntry.path, content, openEntry)
      setSingleTab(tabsRef, setTabs, { entry: openEntry, content })
      syncActiveTabPath(activeTabPathRef, setActiveTabPath, openEntry.path)
      opened = true
    })
    const requestSeq = beforeNavigateSeqRef.current
    await navigation
    // Release the reservation only if no newer request (even for the same page) took over.
    if (!opened && beforeNavigateSeqRef.current === requestSeq) {
      resetRequestedPathIfStillPending(requestedActiveTabPathRef, activeTabPathRef, openEntry.path)
    }
    return opened
  }, [executeNavigationWithBoundary])

  const handleReplaceActiveTab = useCallback(async (entry: VaultEntry) => {
    const openEntry = normalizeOpenEntry(entry)
    if (!openEntry) return
    requestedActiveTabPathRef.current = openEntry.path
    const replacingDifferentEntry = !notePathsMatch(openEntry.path, activeTabPathRef.current)
    if (replacingDifferentEntry) {
      beginNoteOpenTrace(openEntry.path, 'replace-active-tab')
    }
    const navigated = await executeNavigationWithBoundary(openEntry.path, () => navigateToEntry({
      entry: openEntry,
      sourceEntry: entry,
      forceReload: !replacingDifferentEntry,
      navSeqRef,
      tabsRef,
      activeTabPathRef,
      setTabs,
      setActiveTabPath,
      onMissingActiveVault,
      onMissingNotePath,
      onUnreadableNoteContent,
    }))
    if (!navigated) {
      resetRequestedPathIfStillPending(requestedActiveTabPathRef, activeTabPathRef, openEntry.path)
    }
  }, [executeNavigationWithBoundary, onMissingActiveVault, onMissingNotePath, onUnreadableNoteContent])

  const closeAllTabs = useCallback(() => {
    navSeqRef.current += 1
    beforeNavigateSeqRef.current += 1
    tabsRef.current = []
    setTabs([])
    requestedActiveTabPathRef.current = null
    syncActiveTabPath(activeTabPathRef, setActiveTabPath, null)
  }, [])

  /**
   * Opt-in (LeadingLight split drops): saves and keeps the current page until the new page has
   * loaded and `canCommit` still holds, so a failed save or read never empties the pane.
   */
  const openEntryWhenLoaded = useCallback(async (entry: VaultEntry, canCommit: () => boolean): Promise<boolean> => {
    const openEntry = normalizeOpenEntry(entry)
    if (!openEntry || openEntry.fileKind === 'binary') return false
    requestedActiveTabPathRef.current = openEntry.path
    let opened = false
    const navigation = executeNavigationWithBoundary(openEntry.path, async () => {
      const seq = ++navSeqRef.current
      try {
        const content = await loadContentForOpen({ entry: openEntry, forceReload: false, cachedEntry: getCachedNoteContentEntry(openEntry.path) })
        if (navSeqRef.current !== seq || !canCommit()) return
        setSingleTab(tabsRef, setTabs, { entry: openEntry, content })
        syncActiveTabPath(activeTabPathRef, setActiveTabPath, openEntry.path)
        opened = true
      } catch (error) {
        console.warn('Failed to load dropped note:', error)
        // Stale or superseded requests stay quiet; the current one always tells the user.
        if (navSeqRef.current !== seq || !canCommit()) return
        const callbacks = { 'missing-active-vault': onMissingActiveVault, 'missing-path': onMissingNotePath, 'unreadable-content': onUnreadableNoteContent, 'load-failed': onUnreadableNoteContent }
        runEntryFailureCallback({ callback: callbacks[getEntryLoadFailureKind(error)], entry: openEntry, error, warning: 'Failed to report dropped note load failure:' })
      }
    })
    // Every navigation request advances this sequence synchronously; it identifies our request.
    const requestSeq = beforeNavigateSeqRef.current
    await navigation
    // Hand the reservation back only if no newer request (even for the same note) took over.
    if (!opened && beforeNavigateSeqRef.current === requestSeq) {
      resetRequestedPathIfStillPending(requestedActiveTabPathRef, activeTabPathRef, openEntry.path)
    }
    return opened
  }, [executeNavigationWithBoundary, onMissingActiveVault, onMissingNotePath, onUnreadableNoteContent])

  /** Opt-in (LeadingLight finder): cancels any pending navigation and shows the loaded page again. */
  const showLoadedEntry = useCallback((path: string) => {
    if (!tabsRef.current.some((tab) => notePathsMatch(tab.entry.path, path))) return false
    navSeqRef.current += 1
    beforeNavigateSeqRef.current += 1
    requestedActiveTabPathRef.current = path
    syncActiveTabPath(activeTabPathRef, setActiveTabPath, path)
    return true
  }, [])

  return {
    tabs,
    setTabs,
    activeTabPath,
    activeTabPathRef,
    requestedActiveTabPathRef,
    handleSelectNote,
    openTabWithContent,
    handleSwitchTab,
    handleReplaceActiveTab,
    closeAllTabs,
    openEntryWhenLoaded,
    showLoadedEntry,
  }
}
