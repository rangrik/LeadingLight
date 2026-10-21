import type { PaneEditorMode } from './paneEditorMode'
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback, type MutableRefObject, type PointerEvent, type ReactNode } from 'react'
import { Columns, Rows, X, CaretDown, Plus, DotsSixVertical, ArrowBendUpLeft } from '@phosphor-icons/react'
import { LazyEditor } from '../components/LazyEditor'
import { getInspectorLinkSummary } from '../components/inspector/useInspectorData'
import type { VaultEntry } from '../types'
import type { EditorProps } from '../components/Editor'
import { Button } from '../components/ui/button'
import { QuickOpenPalette } from '../components/QuickOpenPalette'
import { requestEditorFocus } from '../hooks/useEditorFocus'
import { translate } from '../lib/i18n'
import { vaultPathForEntry } from '../utils/workspaces'
import type { RichEditorBlockTypeDefinition } from '../utils/richEditorBlockTypes'
import type { NotePdfExportSource } from '../utils/notePdfExport'
import type { PaneId, SplitWorkspaceController } from './useSplitWorkspace'
import { arrowEdge, DROP_EDGES, offeredEdges, type DropEdge } from './pageTabDrag'
import { usePageTabDrag } from './usePageTabDrag'
import { useNoteListDrop } from './useNoteListDrop'
import { useInspectorOverlay } from './useInspectorOverlay'
import { notePathsMatch } from '../utils/notePathIdentity'
import { PageDropOverlay } from './PageDropOverlay'
import { pageLabel } from './pageLabel'
import { includesPath, usePaneSettlement, type PageSettlement } from './saveHold/paneSettlement'
import type { EditorIdleCheck } from '../components/editorContentFlushRegistration'
import { PageHistoryActionContext } from './pageHistory/pageHistoryContext'
import { contextualWikilinkPaths } from './wikilinkContext'
import { PageRelocationContext } from './relocation/pageRelocationContext'
import { CommentaryPaneContext, type CommentaryPaneAction, type PassageCaptureEndpoint } from './commentary/commentaryContext'
import { useCommentaryPaneWidths } from './commentary/useCommentaryPaneWidths'
import './splitWorkspace.css'
import './polish.css'

const ref = <T,>(current: T): MutableRefObject<T> => ({ current })
function editorRefs() {
  return {
    rawToggleRef: ref(() => {}), diffToggleRef: ref(() => {}), tableOfContentsToggleRef: ref(() => {}),
    findInNoteRef: ref<((options?: { replace?: boolean }) => void) | null>(null),
    pdfExportRef: ref<((source?: NotePdfExportSource) => void) | null>(null),
    turnCurrentBlockIntoRef: ref<((target: RichEditorBlockTypeDefinition) => void) | null>(null),
    flushPendingEditorContentRef: ref<((path: string) => void) | null>(null),
    flushPendingRawContentRef: ref<((path: string) => void) | null>(null),
    editorIdleRef: ref<EditorIdleCheck | null>(null),
  }
}
interface Props extends EditorProps {
  onOpenMovePage?: (path: string, pane: PaneId, returnFocus: HTMLElement | null) => void
  onCreatePage?: (title: string) => unknown | Promise<unknown>
  /** Opens the finder on real recent pages; absent when there is nothing to resume. */
  onResume?: () => void
  /** The vault has no pages at all, so the empty pane leads with creation. */
  emptyVault?: boolean
  transitionPending?: boolean
  workspace: SplitWorkspaceController
  unsavedPaths: Set<string>
  /** Pages inside a final recovery choice: their pane takes no input or page commands. */
  blockedPaths?: ReadonlySet<string>
  /** Filled with the panes' side of a final recovery choice. */
  settlementRef?: MutableRefObject<PageSettlement | null>
  /** A page's own save notice, shown under its pane header. */
  renderPageNotice?: (path: string) => ReactNode
  /** Earlier versions of the page shown in a pane; offered in that pane's page menu. */
  onOpenPageHistory?: (path: string, pane: PaneId, returnFocus: HTMLElement | null) => void
  /** A quiet note beside the pane's Saved state. */
  renderPaneStatus?: (path: string, pane: PaneId) => ReactNode
  /** Passage commentary: each pane's capture endpoint, its toolbar action and its header button. */
  commentary?: {
    captureRefs: readonly [MutableRefObject<PassageCaptureEndpoint | null>, MutableRefObject<PassageCaptureEndpoint | null>]
    paneAction: (pane: PaneId) => CommentaryPaneAction | null
    renderHeader: (path: string, pane: PaneId) => ReactNode
  }
}
export function SplitEditorWorkspace(props: Props) {
  const { workspace, unsavedPaths } = props
  const paneRefs = useMemo(() => [editorRefs(), editorRefs()] as const, [])
  const idleRefs = useMemo(() => [paneRefs[0].editorIdleRef, paneRefs[1].editorIdleRef] as const, [paneRefs])
  const settlement = usePaneSettlement({ paths: workspace.paths, blockedPaths: props.blockedPaths, onContentChange: props.onContentChange,
    idleRefs, closePageAndReserveOpen: workspace.closePageAndReserveOpen, settlementRef: props.settlementRef })
  const activeRef = useRef(workspace.activePane)
  useLayoutEffect(() => { activeRef.current = workspace.activePane }, [workspace.activePane])
  // One stable action per pane, naming that pane's page when it runs, so editors do not re-render for it.
  const historyRef = useRef({ open: props.onOpenPageHistory, paths: workspace.paths })
  useLayoutEffect(() => { historyRef.current = { open: props.onOpenPageHistory, paths: workspace.paths } })
  const openHistoryIn = useCallback((pane: PaneId, returnFocus: HTMLElement | null) => {
    const { open, paths } = historyRef.current
    const path = paths[pane]
    if (open && path) open(path, pane, returnFocus)
  }, [])
  const historyZero = useCallback((returnFocus: HTMLElement | null) => openHistoryIn(0, returnFocus), [openHistoryIn])
  const historyOne = useCallback((returnFocus: HTMLElement | null) => openHistoryIn(1, returnFocus), [openHistoryIn])
  const historyActions = [historyZero, historyOne] as const
  const containerRef = useRef<HTMLDivElement>(null)
  const [pickerPane, setPickerPane] = useState<PaneId | null>(null)
  const pickerTriggerRef = useRef<HTMLButtonElement | null>(null)
  const returnPickerFocusRef = useRef(true)
  const locale = props.locale ?? 'en'
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key)
  const activate = (pane: PaneId) => { activeRef.current = pane; workspace.focusPane(pane) }
  // Backlinks: the pane asking first becomes active, so the source opens there and nowhere else.
  const [revealPane, setRevealPane] = useState<PaneId | null>(null)
  const clearReveal = useCallback(() => setRevealPane(null), [])
  const showBacklinks = (pane: PaneId) => {
    activate(pane)
    setRevealPane(pane)
    if (props.inspectorCollapsed) props.onToggleInspector()
  }
  const openBacklink = (pane: PaneId, entry: VaultEntry) => {
    activate(pane)
    return workspace.openNoteWhenLoaded(entry)
  }
  const closePicker = useCallback(() => {
    setPickerPane(null)
    if (returnPickerFocusRef.current) pickerTriggerRef.current?.focus()
  }, [])
  const placePage = (pane: PaneId, edge: DropEdge) => {
    if (!workspace.placePane(pane, edge)) return false
    activeRef.current = pane
    return true
  }
  const canDragPages = !props.transitionPending && !workspace.pendingPanes.some(Boolean)
  const dragOrigin = (pane: PaneId) => `${props.vaultPath ?? ''}\n${workspace.paths[pane] ?? ''}`
  const pageDrag = usePageTabDrag({ areaRef: containerRef, onDrop: (pane, edge, origin) => {
    // A gesture from before a vault, page or transition change must not move the new state.
    if (!canDragPages || origin !== dragOrigin(pane)) return
    const path = workspace.paths[pane]
    if (placePage(pane, edge) && path) requestEditorFocus({ path })
  } })
  // Notes dragged from the list: validated against this vault's entries at every step.
  const droppableNote = (path: string | null) => {
    const entry = path && canDragPages ? props.entries.find(item => notePathsMatch(item.path, path)) : undefined
    if (!entry || entry.fileKind === 'binary') return null
    const owner = ([0, 1] as const).find(pane => notePathsMatch(workspace.paths[pane], entry.path))
    return { entry, title: pageLabel(entry, locale), edges: owner === undefined ? DROP_EDGES : offeredEdges(workspace, owner) }
  }
  const noteDrop = useNoteListDrop({ areaRef: containerRef, vaultPath: props.vaultPath ?? '', describe: droppableNote, onDrop: (path, target) => {
    const note = droppableNote(path)
    if (!note) return
    void workspace.placeNote(note.entry, target)
      .then(placed => { if (placed) requestEditorFocus({ path: note.entry.path }) })
      .catch(() => {})
  } })
  const { cancelPageDrag } = pageDrag
  const { invalidateNoteDrag } = noteDrop
  const [paneZeroPath, paneOnePath] = workspace.paths
  useEffect(() => () => {
    cancelPageDrag()
    invalidateNoteDrag()
  }, [cancelPageDrag, invalidateNoteDrag, canDragPages, props.vaultPath, paneZeroPath, paneOnePath,
    workspace.split, workspace.orientation, workspace.order])

  const { rawToggleRef, diffToggleRef, tableOfContentsToggleRef, findInNoteRef, pdfExportRef,
    turnCurrentBlockIntoRef, flushPendingEditorContentRef, flushPendingRawContentRef } = props
  const { isBlocked } = settlement
  const { beginEditorModeChange } = workspace
  const modeBegins = useMemo(() => ([0, 1] as const).map(pane => () => {
    if (isBlocked(pane) || props.transitionPending) return null
    const commit = beginEditorModeChange(pane)
    return commit ? (mode: PaneEditorMode) => !isBlocked(pane) && commit(mode) : null
  }), [beginEditorModeChange, isBlocked, props.transitionPending])

  // A shown page with unsaved words stays writable when a list refresh no longer has its file.
  const editorEntries = useMemo(() => {
    const kept = workspace.paths.flatMap(path => {
      const tab = path && unsavedPaths.has(path) ? props.tabs.find(item => item.entry.path === path) : undefined
      return tab && !props.entries.some(entry => entry.path === tab.entry.path) ? [tab.entry] : []
    })
    return kept.length ? [...props.entries, ...kept] : props.entries
  }, [workspace.paths, unsavedPaths, props.tabs, props.entries])
  const wikilinkPreferences = useMemo(() => ([0, 1] as const).map(pane => {
    const other = pane === 0 ? 1 : 0
    const otherPath = workspace.paths[other]
    const otherLoaded = workspace.split && !workspace.pendingPanes[other]
      && props.tabs.some(tab => notePathsMatch(tab.entry.path, otherPath))
    return contextualWikilinkPaths({
      entries: props.entries,
      vaultPath: props.vaultPath,
      sourcePath: workspace.paths[pane],
      otherPanePath: otherLoaded ? otherPath : null,
      recentPaths: props.wikilinkPreferredPaths,
    })
  }), [workspace.paths, workspace.split, workspace.pendingPanes, props.tabs, props.entries, props.vaultPath, props.wikilinkPreferredPaths])
  // A focused editor that turns inert may keep focus; move it out so keys cannot reach the page.
  useLayoutEffect(() => {
    const focused = document.activeElement
    if (focused instanceof HTMLElement && focused.closest('[data-recovery-blocked]')) focused.blur()
  }, [props.blockedPaths])
  useEffect(() => {
    // A pane inside a final recovery choice takes no page command; the other pane still does.
    const pane = () => isBlocked(activeRef.current) || props.transitionPending || !workspace.editorModesReady || workspace.pendingPanes[activeRef.current] ? null : paneRefs[activeRef.current]
    if (rawToggleRef) rawToggleRef.current = () => pane()?.rawToggleRef.current()
    if (diffToggleRef) diffToggleRef.current = () => pane()?.diffToggleRef.current()
    if (tableOfContentsToggleRef) tableOfContentsToggleRef.current = () => paneRefs[activeRef.current].tableOfContentsToggleRef.current()
    if (findInNoteRef) findInNoteRef.current = options => pane()?.findInNoteRef.current?.(options)
    if (pdfExportRef) pdfExportRef.current = source => pane()?.pdfExportRef.current?.(source)
    if (turnCurrentBlockIntoRef) turnCurrentBlockIntoRef.current = target => pane()?.turnCurrentBlockIntoRef.current?.(target)
    if (flushPendingEditorContentRef) flushPendingEditorContentRef.current = path => paneRefs.forEach(pane => pane.flushPendingEditorContentRef.current?.(path))
    if (flushPendingRawContentRef) flushPendingRawContentRef.current = path => paneRefs.forEach(pane => pane.flushPendingRawContentRef.current?.(path))
  }, [paneRefs, isBlocked, props.transitionPending, workspace.editorModesReady, workspace.pendingPanes, rawToggleRef, diffToggleRef, tableOfContentsToggleRef, findInNoteRef,
    pdfExportRef, turnCurrentBlockIntoRef, flushPendingEditorContentRef, flushPendingRawContentRef])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const focusKey = event.code || event.key
      const exactChord = event.metaKey !== event.ctrlKey && event.altKey && !event.shiftKey && ['ArrowLeft', 'ArrowRight', 'Digit1', 'Digit2'].includes(focusKey)
      const inDialog = event.target instanceof Element && event.target.closest('[role="dialog"]')
      if (!exactChord || !workspace.split || pickerPane !== null || inDialog || !canDragPages) return
      // Capture phase: the editor never sees it, so Mod-Alt-1/2 cannot also turn a block into a heading.
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      // Keys name visual slots; pane IDs stay internal.
      const pane = workspace.order[focusKey === 'ArrowLeft' || focusKey === 'Digit1' ? 0 : 1]
      activeRef.current = pane
      workspace.focusPane(pane)
      const surface = containerRef.current?.querySelector<HTMLElement>(`[data-pane-id="${pane}"]`)
      const target = surface?.querySelector<HTMLElement>('[contenteditable="true"]') ?? surface?.querySelector<HTMLElement>('.ll-page-picker')
      target?.focus()
    }
    window.addEventListener('keydown', keydown, true)
    return () => window.removeEventListener('keydown', keydown, true)
  }, [workspace, pickerPane, canDragPages])

  const resizePointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    workspace.resize(workspace.orientation === 'horizontal' ? (event.clientX - rect.left) / rect.width * 100 : (event.clientY - rect.top) / rect.height * 100)
  }
  const refocusPageTab = (pane: PaneId) => window.setTimeout(() => {
    containerRef.current?.querySelector<HTMLElement>(`[data-pane-id="${pane}"] [data-page-tab]`)?.focus()
  }, 0)
  // Rendered in visual order with stable keys, so React moves panes without remounting editors.
  const visiblePanes: readonly PaneId[] = workspace.split ? workspace.order : [workspace.activePane]
  const narrowPanes = useCommentaryPaneWidths(containerRef, `${workspace.split}:${workspace.orientation}:${Math.round(workspace.ratio)}`)
  const commentaryAction = (pane: PaneId): CommentaryPaneAction | null => {
    const action = props.commentary?.paneAction(pane)
    // A pane that is busy, inert or in a recovery choice offers nothing to capture.
    const usable = !!action && !props.transitionPending && !workspace.pendingPanes[pane] && workspace.editorModesReady
      && !includesPath(props.blockedPaths, workspace.paths[pane])
    return action ? { ...action, available: action.available && usable, compact: narrowPanes[pane] } : null
  }
  const inspector = useInspectorOverlay({ areaRef: containerRef, visiblePanes, activePane: workspace.activePane,
    activePath: workspace.paths[workspace.activePane] ?? null, inspectorOpen: !props.inspectorCollapsed,
    inspectorWidth: props.inspectorWidth, revealPane, onClose: props.onToggleInspector })
  return <div className={`ll-workspace${pageDrag.drag ? ' ll-workspace--dragging' : ''}`} inert={props.transitionPending} aria-busy={props.transitionPending}>
    <div className="ll-workspace-toolbar">
      <span className="ll-workspace-hint">{t('leadinglight.split.workspace')}</span>
      <Button variant="ghost" size="sm" aria-pressed={workspace.split && workspace.orientation === 'horizontal'} onClick={() => workspace.openSplit('horizontal')}><Columns />{t('leadinglight.split.right')}</Button>
      <Button variant="ghost" size="sm" aria-pressed={workspace.split && workspace.orientation === 'vertical'} onClick={() => workspace.openSplit('vertical')}><Rows />{t('leadinglight.split.stack')}</Button>
    </div>
    <div ref={containerRef} className={`ll-panes ll-panes--${workspace.orientation}`}>
      {visiblePanes.map((pane, index) => {
        const path = workspace.paths[pane]
        const tab = props.tabs.find(item => item.entry.path === path)
        const active = workspace.activePane === pane
        const backlinkCount = tab ? getInspectorLinkSummary(tab.entry, props.entries).backlinks.length : 0
        const backlinkLabel = translate(locale, 'leadinglight.backlinks.show', { count: backlinkCount })
        const blocked = includesPath(props.blockedPaths, path)
        return <Fragment key={pane}>
          {index === 1 && <div className="ll-pane-separator" role="separator" tabIndex={0}
            aria-label={t('leadinglight.split.resize')} aria-orientation={workspace.orientation === 'horizontal' ? 'vertical' : 'horizontal'}
            aria-valuemin={25} aria-valuemax={75} aria-valuenow={Math.round(workspace.ratio)}
            onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId) }}
            onPointerMove={resizePointer} onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)}
            onDoubleClick={() => workspace.resize(50)}
            onKeyDown={event => {
              if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Home'].includes(event.key)) {
                event.preventDefault()
                workspace.resize(event.key === 'Home' ? 50 : workspace.ratio + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -5 : 5))
              }
            }} />}
          <section inert={workspace.pendingPanes[pane] || !workspace.editorModesReady} aria-busy={workspace.pendingPanes[pane]} data-pane-id={pane} data-pane-active={active} data-note-path={path ?? ''}
            aria-label={translate(locale, 'leadinglight.split.pane', { number: index + 1 })}
            className={`ll-pane${active ? ' ll-pane--active' : ''}`}
            style={{ flex: workspace.split ? `${index === 0 ? workspace.ratio : 100 - workspace.ratio} 1 0` : '1 1 0' }}
            onPointerDownCapture={event => {
              // The page tab activates on click or drop, so a canceled drag changes nothing.
              if (!(event.target instanceof Element && event.target.closest('[data-page-tab]'))) activate(pane)
            }} onFocusCapture={() => activate(pane)} onKeyDown={inspector.closeOnEscape}>
            <div className="ll-pane-header">
              <Button variant="ghost" className="ll-page-picker justify-between" aria-label={t('leadinglight.split.choose')}
                aria-haspopup="dialog" aria-expanded={pickerPane === pane} data-placeholder={!tab ? '' : undefined}
                data-page-tab="" data-draggable={tab && canDragPages ? '' : undefined}
                title={tab ? t('leadinglight.split.dragHint') : undefined}
                aria-keyshortcuts={tab ? 'Alt+Shift+ArrowLeft Alt+Shift+ArrowRight Alt+Shift+ArrowUp Alt+Shift+ArrowDown' : undefined}
                onPointerDown={tab && canDragPages ? event => pageDrag.startPageDrag({
                  event, pane, title: pageLabel(tab.entry, locale), edges: offeredEdges(workspace, pane), origin: dragOrigin(pane),
                }) : undefined}
                onKeyDown={tab && canDragPages ? event => {
                  const edge = event.altKey && event.shiftKey && !event.metaKey && !event.ctrlKey ? arrowEdge(event.key) : null
                  if (!edge) return
                  event.preventDefault()
                  if (placePage(pane, edge)) refocusPageTab(pane)
                } : undefined}
                data-state={pickerPane === pane ? 'open' : 'closed'} onClick={event => {
                  activate(pane)
                  pickerTriggerRef.current = event.currentTarget
                  returnPickerFocusRef.current = true
                  setPickerPane(pane)
                }}>{tab && <DotsSixVertical className="ll-page-grip" aria-hidden="true" />}<span>{tab ? pageLabel(tab.entry, locale) : t('leadinglight.split.choose')}</span><CaretDown /></Button>
              {tab && path && <span className="ll-save-state" data-state={unsavedPaths.has(path) ? 'unsaved' : 'saved'} role="status">{t(unsavedPaths.has(path) ? 'leadinglight.split.unsaved' : 'leadinglight.split.saved')}</span>}
              {tab && path && props.renderPaneStatus?.(path, pane)}
              {tab && path && props.commentary?.renderHeader(path, pane)}
              {tab && <Button variant="ghost" size="sm" className="ll-backlinks-count" data-count={backlinkCount} aria-label={backlinkLabel} title={backlinkLabel}
                onClick={() => showBacklinks(pane)}><ArrowBendUpLeft aria-hidden="true" />{backlinkCount}</Button>}
              <Button variant="ghost" size="icon-sm" aria-label={t('leadinglight.split.create')} title={t('leadinglight.split.create')} onClick={() => { activate(pane); props.onCreateNote?.() }}><Plus /></Button>
              {workspace.split && <Button variant="ghost" size="icon-sm" aria-label={t('leadinglight.split.close')} title={t('leadinglight.split.close')} onClick={() => { void workspace.closePane(pane).catch(() => {}) }}><X /></Button>}
            </div>
            {tab && path && props.renderPageNotice?.(path)}
            {tab ? <div className="contents" inert={blocked} data-recovery-blocked={blocked ? '' : undefined}>
              <PageRelocationContext.Provider value={props.onOpenMovePage && (!tab.entry.fileKind || tab.entry.fileKind === 'markdown') ? returnFocus => {
                activate(pane)
                props.onOpenMovePage?.(tab.entry.path, pane, returnFocus)
              } : null}>
              <PageHistoryActionContext.Provider value={props.onOpenPageHistory ? historyActions[pane] : null}>
              <CommentaryPaneContext.Provider value={commentaryAction(pane)}>
              <LazyEditor {...props} {...paneRefs[pane]} passageCaptureRef={props.commentary?.captureRefs[pane]} editorModeControl={{ mode: workspace.editorModes[pane], begin: modeBegins[pane] }} tabs={[tab]} activeTabPath={path} entries={editorEntries}
                wikilinkPreferredPaths={wikilinkPreferences[pane]}
              onContentChange={settlement.contentChanges[pane]}
              inspectorEntry={tab.entry} inspectorContent={tab.content} inspectorCollapsed={!active || props.inspectorCollapsed}
              inspectorOverlay={inspector.floats(pane)}
              showAIChat={active && props.showAIChat} aiWorkspaceSurface={active ? props.aiWorkspaceSurface : undefined}
              pendingCommitDiffRequest={active ? props.pendingCommitDiffRequest : undefined}
              vaultPath={vaultPathForEntry(tab.entry, props.vaultPath ?? '')}
              onGoBack={workspace.goBack} onGoForward={workspace.goForward} canGoBack={workspace.canGoBack} canGoForward={workspace.canGoForward}
              onNavigateWikilink={target => { activate(pane); props.onNavigateWikilink(target) }}
              onOpenEntry={entry => openBacklink(pane, entry)}
              revealBacklinks={active && revealPane === pane} onBacklinksRevealed={clearReveal}
              backlinksEmptyLabel={t('inspector.backlinks.empty')} />
              </CommentaryPaneContext.Provider>
              </PageHistoryActionContext.Provider>
              </PageRelocationContext.Provider>
            </div>
              : <div className="ll-pane-empty">
                <p>{t(props.emptyVault ? 'leadinglight.split.emptyVault' : 'leadinglight.split.empty')}</p>
                {props.emptyVault && <span>{t('leadinglight.split.emptyVaultHint')}</span>}
                <div className="ll-pane-empty-actions">
                  <Button variant="outline" onClick={() => { activate(pane); props.onCreateNote?.() }}>{t('leadinglight.split.create')}</Button>
                  {props.onResume && !props.emptyVault && <Button variant="ghost" onClick={event => {
                    activate(pane)
                    // WebKit does not focus a clicked button; the finder returns focus here on Escape.
                    event.currentTarget.focus({ preventScroll: true })
                    props.onResume?.()
                  }}>{t('leadinglight.split.resume')}</Button>}
                </div>
              </div>}
          </section>
        </Fragment>
      })}
      <PageDropOverlay drag={pageDrag.drag ?? noteDrop.preview} locale={locale} />
    </div>
    <QuickOpenPalette open={pickerPane !== null} entries={props.entries} isLoading={props.isVaultLoading} locale={locale}
      onClose={closePicker} onSelect={entry => {
        if (pickerPane === null) return
        returnPickerFocusRef.current = false
        void workspace.selectNoteInPane(entry, pickerPane).then(() => requestEditorFocus({ path: entry.path }))
      }}
      onCreateNote={title => {
        if (pickerPane === null) return false
        returnPickerFocusRef.current = false
        activate(pickerPane)
        return props.onCreatePage ? props.onCreatePage(title) : props.onCreateNote?.()
      }} />
  </div>
}
