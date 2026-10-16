import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from 'react'
import { flushSync } from 'react-dom'
import { useNavigationHistory } from '../hooks/useNavigationHistory'
import { useTabManagement, type Tab } from '../hooks/useTabManagement'
import type { VaultEntry } from '../types'
import { notePathsMatch } from '../utils/notePathIdentity'
import { edgeSlot, pagePlacement, type DropEdge, type NoteDropTarget, type PaneOrder } from './pageTabDrag'

export type PaneId = 0 | 1
export type SplitOrientation = 'horizontal' | 'vertical'
interface WorkspaceSnapshot {
  paths: [string | null, string | null]
  active: PaneId
  split: boolean
  orientation: SplitOrientation
  ratio: number
}
const emptySnapshot = (): WorkspaceSnapshot => ({ paths: [null, null], active: 0, split: false, orientation: 'horizontal', ratio: 50 })
export function readWorkspaceSnapshot(vaultPath: string): WorkspaceSnapshot {
  try {
    const value = JSON.parse(localStorage.getItem(`leadinglight.workspace:${vaultPath}`) ?? 'null')
    if (!value || !Array.isArray(value.paths)) return emptySnapshot()
    const paths: [string | null, string | null] = [0, 1].map(i => typeof value.paths[i] === 'string' ? value.paths[i] : null) as [string | null, string | null]
    if (notePathsMatch(paths[0], paths[1])) paths[1] = null
    return { paths, active: value.active === 1 ? 1 : 0, split: value.split === true,
      orientation: value.orientation === 'vertical' ? 'vertical' : 'horizontal',
      ratio: typeof value.ratio === 'number' && Number.isFinite(value.ratio) ? Math.min(75, Math.max(25, value.ratio)) : 50 }
  } catch { return emptySnapshot() }
}

type Options = Parameters<typeof useTabManagement>[0] & {
  vaultPath: string
  entries: VaultEntry[]
  isVaultLoading?: boolean
  restoreWorkspace?: boolean
}

/** Two independent navigation lanes, exposed through the upstream active-note facade. */
export function useSplitWorkspace(options: Options) {
  const first = useTabManagement(options)
  const second = useTabManagement(options)
  const controllers = [first, second] as const
  const controllersRef = useRef(controllers)
  useLayoutEffect(() => { controllersRef.current = controllers })
  const [activePane, setActivePane] = useState<PaneId>(0)
  const activePaneRef = useRef<PaneId>(0)
  const [pendingPanes, setPendingPanes] = useState<[boolean, boolean]>([false, false])
  // In-flight operations per pane: an older one finishing never frees a pane a newer one still holds.
  const busyCountRef = useRef<[number, number]>([0, 0])
  const beginBusy = useCallback((pane: PaneId) => {
    busyCountRef.current[pane] += 1
    setPendingPanes(current => (current[pane] ? current : pane === 0 ? [true, current[1]] : [current[0], true]))
  }, [])
  const endBusy = useCallback((pane: PaneId) => {
    busyCountRef.current[pane] = Math.max(0, busyCountRef.current[pane] - 1)
    if (busyCountRef.current[pane] === 0) setPendingPanes(current => (pane === 0 ? [false, current[1]] : [current[0], false]))
  }, [])
  const currentVaultRef = useRef(options.vaultPath)
  useLayoutEffect(() => { currentVaultRef.current = options.vaultPath }, [options.vaultPath])
  // A new epoch on every vault change, so leaving and returning to a vault starts a new session.
  const [session, setSession] = useState({ vaultPath: options.vaultPath, epoch: 0 })
  if (session.vaultPath !== options.vaultPath) setSession({ vaultPath: options.vaultPath, epoch: session.epoch + 1 })
  const sessionRef = useRef(session.epoch)
  useLayoutEffect(() => { sessionRef.current = session.epoch }, [session.epoch])
  const entriesRef = useRef(options.entries)
  useLayoutEffect(() => { entriesRef.current = options.entries }, [options.entries])
  const [split, setSplit] = useState(false)
  const splitRef = useRef(split)
  useLayoutEffect(() => { splitRef.current = split }, [split])
  const [orientation, setOrientation] = useState<SplitOrientation>('horizontal')
  const [ratio, setRatio] = useState(50)
  // Visual slots (left/top, right/bottom). Pane IDs and their editors never move.
  const [order, setOrder] = useState<PaneOrder>([0, 1])
  const activeTabPathRef = useRef<string | null>(null)
  const requestedActiveTabPathRef = useRef<string | null>(null)
  const restoreStartedRef = useRef(-1)
  // Saved pages whose restore read failed; stored until that pane gets a page.
  const pendingPathsRef = useRef<[string | null, string | null]>([null, null])
  const persistPausedRef = useRef(false)
  const interactionVersionRef = useRef(0)
  // Interaction since this vault became current means the user's context beats the saved layout.
  const vaultInteractionRef = useRef(0)
  useLayoutEffect(() => { vaultInteractionRef.current = interactionVersionRef.current }, [options.vaultPath])
  const [restoredEpoch, setRestoredEpoch] = useState(-1)
  const firstHistory = useNavigationHistory()
  const secondHistory = useNavigationHistory()
  const histories = [firstHistory, secondHistory] as const
  const historiesRef = useRef(histories)
  useLayoutEffect(() => { historiesRef.current = histories })
  const tabs = useMemo(() => [...first.tabs, ...second.tabs], [first.tabs, second.tabs])
  const paneTabsRef = useRef<[Tab[], Tab[]]>([first.tabs, second.tabs])
  useLayoutEffect(() => { paneTabsRef.current = [first.tabs, second.tabs] }, [first.tabs, second.tabs])
  const activeTabPath = controllers[activePane].activeTabPath
  useLayoutEffect(() => {
    activeTabPathRef.current = activeTabPath
    requestedActiveTabPathRef.current = controllersRef.current[activePane].requestedActiveTabPathRef.current
  }, [activeTabPath, activePane])

  const focusPane = useCallback((pane: PaneId) => {
    interactionVersionRef.current += 1
    activePaneRef.current = pane
    activeTabPathRef.current = controllersRef.current[pane].activeTabPathRef.current
    requestedActiveTabPathRef.current = controllersRef.current[pane].requestedActiveTabPathRef.current
    setActivePane(pane)
  }, [])
  // Advances on every navigation request per pane, so a slow drop never commits over a newer one.
  const requestGenerationRef = useRef<[number, number]>([0, 0])
  const findPane = useCallback((path: string): PaneId | undefined => {
    return ([0, 1] as const).find(pane => {
      const controller = controllersRef.current[pane]
      return notePathsMatch(controller.activeTabPathRef.current, path) || notePathsMatch(controller.requestedActiveTabPathRef.current, path)
    })
  }, [])
  const selectNoteInPane = useCallback(async (entry: VaultEntry, pane: PaneId, replace = false) => {
    const existing = findPane(entry.path)
    if (existing !== undefined && existing !== pane) { setSplit(true); focusPane(existing); return }
    requestGenerationRef.current[pane] += 1
    focusPane(pane)
    requestedActiveTabPathRef.current = entry.path
    beginBusy(pane)
    try {
      await (replace ? controllersRef.current[pane].handleReplaceActiveTab(entry) : controllersRef.current[pane].handleSelectNote(entry))
      if (activePaneRef.current === pane) activeTabPathRef.current = controllersRef.current[pane].activeTabPathRef.current
    } finally { endBusy(pane) }
  }, [beginBusy, endBusy, findPane, focusPane])
  const handleSelectNote = useCallback((entry: VaultEntry) => selectNoteInPane(entry, activePaneRef.current), [selectNoteInPane])
  const handleReplaceActiveTab = useCallback((entry: VaultEntry) => selectNoteInPane(entry, activePaneRef.current, true), [selectNoteInPane])
  const handleSwitchTab = useCallback((path: string) => {
    const pane = findPane(path) ?? activePaneRef.current
    requestGenerationRef.current[pane] += 1
    controllersRef.current[pane].handleSwitchTab(path)
    focusPane(pane)
    activeTabPathRef.current = path
  }, [findPane, focusPane])
  const openTabWithContent = useCallback((entry: VaultEntry, content: string) => {
    interactionVersionRef.current += 1
    const existing = findPane(entry.path)
    if (existing !== undefined) { focusPane(existing); return }
    const pane = activePaneRef.current
    requestGenerationRef.current[pane] += 1
    beginBusy(pane)
    void controllersRef.current[pane].openTabWithContent(entry, content).finally(() => {
      endBusy(pane)
    })
  }, [beginBusy, endBusy, findPane, focusPane])
  // Opens that are not the user's navigation (creation commits, startup restore), and the newest creation per pane.
  const backgroundOpensRef = useRef<[number, number]>([0, 0])
  const newestCreationRef = useRef<[number, number]>([0, 0])
  const creationCountRef = useRef(0)
  /** Opt-in for creation, taken at the user's request: a later open targets this pane, its page and the vault session. */
  const reserveOpen = useCallback(() => {
    interactionVersionRef.current += 1
    const pane = activePaneRef.current
    const id = ++creationCountRef.current
    const navigation = requestGenerationRef.current[pane] - backgroundOpensRef.current[pane]
    const epoch = sessionRef.current
    const inSession = () => sessionRef.current === epoch
    const visible = () => splitRef.current || activePaneRef.current === pane
    // Earlier creations opening here do not cancel it; user navigation, a newer creation or closing the pane do.
    const valid = () => inSession() && visible() && newestCreationRef.current[pane] < id
      && requestGenerationRef.current[pane] - backgroundOpensRef.current[pane] === navigation
    const open = async (entry: VaultEntry, content: string) => {
      if (!valid() || findPane(entry.path) !== undefined) return false
      newestCreationRef.current[pane] = id
      backgroundOpensRef.current[pane] += 1
      const request = ++requestGenerationRef.current[pane]
      beginBusy(pane)
      try {
        return await controllersRef.current[pane].openTabWithContent(entry, content,
          () => inSession() && visible() && requestGenerationRef.current[pane] === request)
      } finally { endBusy(pane) }
    }
    return { inSession, isActive: () => activePaneRef.current === pane, open }
  }, [beginBusy, endBusy, findPane])
  /** Taken at a command: current until the person navigates or closes that pane, or the vault changes. Creation opens do not count. */
  const markNavigation = useCallback(() => {
    const pane = activePaneRef.current
    const navigation = requestGenerationRef.current[pane] - backgroundOpensRef.current[pane]
    const epoch = sessionRef.current
    const current = () => sessionRef.current === epoch && (splitRef.current || activePaneRef.current === pane)
      && requestGenerationRef.current[pane] - backgroundOpensRef.current[pane] === navigation
    return { pane, current }
  }, [])
  const setTabs = useCallback((action: SetStateAction<Tab[]>) => {
    const panes = controllersRef.current
    const previousPaneTabs = paneTabsRef.current
    const previous = [...previousPaneTabs[0], ...previousPaneTabs[1]]
    const next = typeof action === 'function' ? action(previous) : action
    if (next === previous) return
    for (const pane of [0, 1] as const) {
      const oldTab = previousPaneTabs[pane][0]
      if (!oldTab) continue
      // Existing callers map content/metadata or rename paths without reordering.
      const exact = next.find(tab => notePathsMatch(tab.entry.path, oldTab.entry.path))
      const updated = exact ?? (next.length === previous.length ? next[previous.indexOf(oldTab)] : undefined)
      const renamed = !!updated && updated.entry.path !== oldTab.entry.path
      // The same tab with a new path is a rename; editors use this to keep async work bound to the page.
      paneTabsRef.current[pane] = updated ? [renamed ? { ...updated, renamedFrom: oldTab.entry.path } : updated] : []
      if (!updated || renamed) requestGenerationRef.current[pane] += 1
      panes[pane].setTabs(paneTabsRef.current[pane])
      if (updated && updated.entry.path !== oldTab.entry.path) panes[pane].handleSwitchTab(updated.entry.path)
      if (!updated) panes[pane].closeAllTabs()
    }
  }, [])
  // Bumped by layout actions, so a slow note placement never overrides a newer layout.
  const layoutVersionRef = useRef(0)
  const closeAllTabs = useCallback(() => {
    layoutVersionRef.current += 1
    requestGenerationRef.current = [requestGenerationRef.current[0] + 1, requestGenerationRef.current[1] + 1]
    for (const pane of controllersRef.current) pane.closeAllTabs()
    historiesRef.current.forEach(history => history.reset())
    focusPane(0)
    setSplit(false)
    setOrder([0, 1])
    pendingPathsRef.current = [null, null]
  }, [focusPane])
  /**
   * Pages moved to Trash: a pane showing one is emptied and a pending open of one is canceled.
   * Every other page, the layout and the other pane stay exactly as they are.
   */
  const closePages = useCallback((paths: readonly string[]) => {
    const gone = (path: string | null) => !!path && paths.some(item => notePathsMatch(item, path))
    for (const pane of [0, 1] as const) {
      const controller = controllersRef.current[pane]
      const shown = paneTabsRef.current[pane][0]?.entry.path ?? null
      if (gone(pendingPathsRef.current[pane])) pendingPathsRef.current[pane] = null
      if (gone(shown)) {
        requestGenerationRef.current[pane] += 1
        paneTabsRef.current[pane] = []
        controller.closeAllTabs()
      } else if (gone(controller.requestedActiveTabPathRef.current)) {
        requestGenerationRef.current[pane] += 1
        if (!shown || !controller.showLoadedEntry(shown)) controller.closeAllTabs()
      }
    }
    activeTabPathRef.current = controllersRef.current[activePaneRef.current].activeTabPathRef.current
  }, [])
  /** Pages held by the panes right now, not as of the last render; flushes before quit use this. */
  const currentTabs = useCallback(() => [...paneTabsRef.current[0], ...paneTabsRef.current[1]], [])
  const beforeNavigate = options.beforeNavigate
  const closePane = useCallback(async (pane: PaneId) => {
    const path = controllersRef.current[pane].activeTabPathRef.current
    layoutVersionRef.current += 1
    requestGenerationRef.current[pane] += 1
    beginBusy(pane)
    try {
      if (path) await beforeNavigate?.(path, '')
      // Retain the closed document for an explicit reopen, while removing its editor.
      setSplit(false)
      focusPane(pane === 0 ? 1 : 0)
    } finally { endBusy(pane) }
  }, [beginBusy, endBusy, focusPane, beforeNavigate])
  const openSplit = useCallback((direction: SplitOrientation) => {
    interactionVersionRef.current += 1
    layoutVersionRef.current += 1
    setOrientation(direction)
    setSplit(true)
    if (split) return
    // The second pane always opens after the current page.
    const current = activePaneRef.current
    setOrder(current === 0 ? [0, 1] : [1, 0])
    focusPane(current === 0 ? 1 : 0)
  }, [focusPane, split])
  const resize = useCallback((value: number) => { interactionVersionRef.current += 1; setRatio(Math.min(75, Math.max(25, value))) }, [])
  /** Layout only: reveals the other pane as it is (retained page or empty) and moves no document. */
  const placePane = useCallback((pane: PaneId, edge: DropEdge) => {
    const next = pagePlacement({ split, orientation, order }, pane, edge)
    if (!next) return false
    layoutVersionRef.current += 1
    setSplit(true)
    setOrientation(next.orientation)
    setOrder(next.order)
    focusPane(pane)
    return true
  }, [focusPane, order, orientation, split])
  /** Opens a dragged note. Layout and focus change only after the note has actually loaded. */
  const placeNote = useCallback(async (entry: VaultEntry, target: NoteDropTarget) => {
    interactionVersionRef.current += 1
    const owner = findPane(entry.path)
    if (owner !== undefined) {
      // Already open or requested: move or focus that editor, never a second buffer.
      if ('edge' in target && placePane(owner, target.edge)) return true
      // A hidden owner is revealed beside the current page; focusing it alone would unmount that page.
      if (!split && owner !== activePaneRef.current) {
        layoutVersionRef.current += 1
        setSplit(true)
      }
      focusPane(owner)
      return true
    }
    const version = ++layoutVersionRef.current
    const vaultPath = currentVaultRef.current
    // A single page keeps its pane; the note loads in the hidden lane. A split replaces the dropped slot.
    const pane: PaneId = 'pane' in target ? target.pane : split ? order[edgeSlot(target.edge)] : activePaneRef.current === 0 ? 1 : 0
    const request = ++requestGenerationRef.current[pane]
    // A newer request for this pane, a layout change, a vault switch, or the note being removed or renamed cancels the commit.
    const stillCurrent = () => requestGenerationRef.current[pane] === request && layoutVersionRef.current === version && currentVaultRef.current === vaultPath
      && entriesRef.current.some(item => notePathsMatch(item.path, entry.path))
    let opened = false
    beginBusy(pane)
    try {
      // Saves the page being replaced first and keeps it showing until the note has loaded.
      opened = await controllersRef.current[pane].openEntryWhenLoaded(entry, stillCurrent)
    } finally { endBusy(pane) }
    if (!opened || !stillCurrent()) return false
    const next = 'edge' in target ? pagePlacement({ split, orientation, order }, pane, target.edge) : null
    if (next) {
      setSplit(true)
      setOrientation(next.orientation)
      setOrder(next.order)
    }
    focusPane(pane)
    return true
  }, [beginBusy, endBusy, findPane, focusPane, order, orientation, placePane, split])
  /** Finder selection into the active pane: true only once the page is loaded and shown. */
  const openNoteWhenLoaded = useCallback(async (entry: VaultEntry, options: { commitNow?: boolean } = {}) => {
    const epoch = sessionRef.current
    const listed = () => sessionRef.current === epoch && entriesRef.current.some(item => notePathsMatch(item.path, entry.path))
    if (entry.fileKind === 'binary' || !listed()) return false
    interactionVersionRef.current += 1
    const owner = ([0, 1] as const).find(pane => paneTabsRef.current[pane].some(tab => notePathsMatch(tab.entry.path, entry.path)))
    if (owner !== undefined) {
      const show = () => {
        // Choosing a loaded page again cancels a replacement still pending in its pane.
        requestGenerationRef.current[owner] += 1
        controllersRef.current[owner].showLoadedEntry(entry.path)
        if (!splitRef.current && owner !== activePaneRef.current) {
          layoutVersionRef.current += 1
          setSplit(true)
        }
        focusPane(owner)
      }
      // A keyboard command commits the switch now, so its ready editor can take the next key.
      if (options.commitNow) flushSync(show)
      else show()
      return true
    }
    // Still loading elsewhere: its own request decides, so do not claim it opened.
    if (findPane(entry.path) !== undefined) return false
    const pane = activePaneRef.current
    const request = ++requestGenerationRef.current[pane]
    const current = () => requestGenerationRef.current[pane] === request && listed()
    let opened = false
    beginBusy(pane)
    try {
      opened = await controllersRef.current[pane].openEntryWhenLoaded(entry, current)
    } finally { endBusy(pane) }
    if (!opened || !current()) return false
    if (activePaneRef.current === pane) focusPane(pane)
    return true
  }, [beginBusy, endBusy, findPane, focusPane])

  const firstPush = firstHistory.push
  const secondPush = secondHistory.push
  useEffect(() => { if (first.activeTabPath) firstPush(first.activeTabPath) }, [first.activeTabPath, firstPush])
  useEffect(() => { if (second.activeTabPath) secondPush(second.activeTabPath) }, [second.activeTabPath, secondPush])
  const navigateHistory = useCallback(async (offset: number) => {
    const pane = activePaneRef.current
    const history = historiesRef.current[pane]
    const valid = (path: string) => options.entries.some(item => notePathsMatch(item.path, path))
    const target = offset < 0 ? history.goBack(valid) : history.goForward(valid)
    const entry = options.entries.find(item => notePathsMatch(item.path, target))
    if (!entry) return
    await selectNoteInPane(entry, pane)
    if (!notePathsMatch(controllersRef.current[pane].activeTabPathRef.current, entry.path)) {
      if (offset < 0) history.goForward(valid)
      else history.goBack(valid)
    }
  }, [options.entries, selectNoteInPane])

  // isVaultLoading stays true until the listing for this exact vault is authoritative.
  useEffect(() => {
    if (options.restoreWorkspace === false || !options.vaultPath || options.isVaultLoading || restoreStartedRef.current === session.epoch) return
    const vaultPath = options.vaultPath
    const epoch = session.epoch
    restoreStartedRef.current = epoch
    const snapshot = readWorkspaceSnapshot(vaultPath)
    // Saved pages missing from an authoritative listing are gone.
    const listed = snapshot.paths.map(path => options.entries.find(item => notePathsMatch(item.path, path)))
    const restore = async () => {
      const failedPaths = await Promise.all(([0, 1] as const).map(async pane => {
        const entry = listed[pane]
        const controller = controllersRef.current[pane]
        // A pane the user already filled keeps its page; never duplicate a page open elsewhere.
        if (!entry || controller.activeTabPathRef.current || controller.requestedActiveTabPathRef.current || findPane(entry.path) !== undefined) return null
        requestGenerationRef.current[pane] += 1
        backgroundOpensRef.current[pane] += 1
        await controller.handleSelectNote(entry)
        // A failed read leaves the pane empty; keep storing the saved page instead of nothing.
        return controllersRef.current[pane].activeTabPathRef.current ? null : entry.path
      }))
      // A restore from an earlier visit to this vault must not settle or rearrange the current one.
      if (sessionRef.current !== epoch) return
      pendingPathsRef.current = failedPaths as [string | null, string | null]
      if (interactionVersionRef.current === vaultInteractionRef.current) {
        setSplit(snapshot.split)
        setOrientation(snapshot.orientation)
        setRatio(snapshot.ratio)
        focusPane(snapshot.active)
      }
      persistPausedRef.current = false
      setRestoredEpoch(epoch)
    }
    void restore()
  }, [session.epoch, options.vaultPath, options.isVaultLoading, options.entries, options.restoreWorkspace, findPane, focusPane])
  useEffect(() => {
    // A pane that gets a page no longer needs its failed saved page.
    const pending = pendingPathsRef.current
    if (first.activeTabPath) pending[0] = null
    if (second.activeTabPath) pending[1] = null
    if (options.restoreWorkspace === false || !options.vaultPath || restoredEpoch !== session.epoch || persistPausedRef.current) return
    // Stored in visual order, so a restart maps slot N back to pane N.
    const paths = [first.activeTabPath ?? pending[0], second.activeTabPath ?? pending[1]]
    try {
      localStorage.setItem(`leadinglight.workspace:${options.vaultPath}`, JSON.stringify({
        paths: [paths[order[0]], paths[order[1]]], active: order.indexOf(activePane), split, orientation, ratio,
      }))
    } catch { /* Restricted storage still permits editing; restoration is best effort. */ }
  }, [activePane, first.activeTabPath, second.activeTabPath, options.vaultPath, options.restoreWorkspace, order, orientation, ratio, restoredEpoch, session.epoch, split])

  return { tabs, setTabs, activeTabPath, activeTabPathRef, requestedActiveTabPathRef, handleSelectNote,
    handleReplaceActiveTab, handleSwitchTab, openTabWithContent, reserveOpen, closeAllTabs,
    splitWorkspace: { pendingPanes, suspendPersistence: () => { persistPausedRef.current = true }, activePane, split, orientation, ratio, order, focusPane, selectNoteInPane, closePane, closePages, openSplit, resize, placePane, placeNote,
      currentTabs,
      markNavigation,
      openNoteWhenLoaded,
      // Recents may count visits only after this vault session's restore has settled.
      readyForVisits: options.restoreWorkspace === false || restoredEpoch === session.epoch,
      paths: [first.activeTabPath, second.activeTabPath] as const,
      canGoBack: histories[activePane].canGoBack,
      canGoForward: histories[activePane].canGoForward,
      goBack: () => { void navigateHistory(-1) }, goForward: () => { void navigateHistory(1) } } }
}
export type SplitWorkspaceController = ReturnType<typeof useSplitWorkspace>['splitWorkspace']
