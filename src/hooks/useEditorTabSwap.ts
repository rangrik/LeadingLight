import { editorContainer, editorScopeForEditor } from '../leadinglight/editorScope'
import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type { useCreateBlockNote } from '@blocknote/react'
import type { VaultEntry } from '../types'
import { compactMarkdown } from '../utils/compact-markdown'
import {
  failNoteOpenTrace,
  finishNoteOpenTrace,
} from '../utils/noteOpenPerformance'
import { logEditorStabilityCheckTrace } from '../utils/editorPerformanceTrace'
import {
  serializeRichEditorBodyToMarkdown,
  serializeRichEditorDocumentToMarkdown,
} from '../utils/richEditorMarkdown'
import { useEditorMountState, useLatestRef } from './editorTabSwapLifecycle'
import {
  applyBlankStateToEditor,
  applyBlocksToEditor,
  type EditorContentPathRef,
} from './editorContentSwapApply'
import {
  consumeRawModeTransition,
  flushBeforePathChange,
  flushBeforeRawMode,
  useDebouncedEditorChange,
} from './editorChangeDebounce'
import {
  blankParagraphBlocks,
  extractEditorBody,
  isUntitledPath,
} from './editorTabContent'
import { clearEditorDomSelection } from './editorDomSelection'
import { editorDocumentSignature, isBlankEditorDocument } from './editorDocumentState'
import {
  cacheEditorState,
  cacheResolvedEditorState,
  isBlankBodyContent,
  resolveBlocksForTarget,
  resolveEmptyHeadingBlocks,
  startsWithEmptyHeading,
  type CachedTabState,
} from './editorBlockResolution'
import {
  createSwapToken,
  invalidatePendingSwap,
  shouldAbortSwap,
  type SwapToken,
} from './editorSwapToken'
import { useParsedBlockPreload } from './editorParsedBlockPreload'
import { scheduleParsedBlockSwap } from './editorParsedBlockSwap'
import { useEditorContentPathSignal } from './useEditorContentPathSignal'
import { assertEditorCompositionReady } from './editorCompositionBoundary'
export { extractEditorBody, getH1TextFromBlocks, replaceTitleInFrontmatter } from './editorTabContent'
export { RICH_EDITOR_CHANGE_DEBOUNCE_MS } from './editorChangeDebounce'

interface Tab {
  entry: VaultEntry
  content: string
  /** Set by the tab controller when this same page was renamed in place from that path. */
  renamedFrom?: string
}

type PendingLocalContent = { path: string; content: string }

interface TabSwapState {
  cache: Map<string, CachedTabState>
  prevPath: string | null
  pathChanged: boolean
  activeTab: Tab | undefined
  previousTab: Tab | undefined
  rawModeJustEnded: boolean
}

interface UseEditorTabSwapOptions {
  tabs: Tab[]
  activeTabPath: string | null
  editor: ReturnType<typeof useCreateBlockNote>
  onContentChange?: (path: string, content: string) => void
  /** When true, the BlockNote editor is hidden (raw/CodeMirror mode active). */
  rawMode?: boolean
  vaultPath?: string
}

interface RunTabSwapEffectOptions {
  tabs: Tab[]
  activeTabPath: string | null
  editor: ReturnType<typeof useCreateBlockNote>
  rawMode?: boolean
  tabCacheRef: MutableRefObject<Map<string, CachedTabState>>
  tabsRef: MutableRefObject<Tab[]>
  prevActivePathRef: MutableRefObject<string | null>
  editorMountedRef: MutableRefObject<boolean>
  pendingSwapRef: MutableRefObject<(() => void) | null>
  swapSeqRef: MutableRefObject<number>
  prevRawModeRef: MutableRefObject<boolean>
  rawSwapPendingRef: MutableRefObject<boolean>
  suppressChangeRef: MutableRefObject<boolean>
  editorContentPathRef: EditorContentPathRef
  pendingLocalContentRef: MutableRefObject<PendingLocalContent | null>
  documentSessionRef: MutableRefObject<number>
  flushPendingEditorChange: () => boolean
  vaultPath?: string
}

interface UseTabSwapEffectOptions extends Omit<RunTabSwapEffectOptions, 'vaultPath'> {
  vaultPathRef: MutableRefObject<string | undefined>
}

interface StableActivePathOptions {
  pathChanged: boolean
  rawModeJustEnded: boolean
  activeTabPath: string | null
  activeTab: Tab | undefined
  cache: Map<string, CachedTabState>
  editor: ReturnType<typeof useCreateBlockNote>
  editorMountedRef: MutableRefObject<boolean>
  editorContentPathRef: EditorContentPathRef
  rawSwapPendingRef: MutableRefObject<boolean>
  pendingLocalContentRef: MutableRefObject<PendingLocalContent | null>
}

type ParsedBlockPreloadEvent = { path: string; content: string }

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now()
}

function signalEditorTabSwapped(path: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('laputa:editor-tab-swapped', {
    detail: { path },
  }))
  finishNoteOpenTrace(path)
}

function readEditorScrollTop(editor: ReturnType<typeof useCreateBlockNote>): number {
  const scrollEl = editorContainer(editor)
  return scrollEl?.scrollTop ?? 0
}

function findActiveTab(options: {
  tabs: Tab[]
  activeTabPath: string | null
}): Tab | undefined {
  const { tabs, activeTabPath } = options
  return activeTabPath
    ? tabs.find(tab => tab.entry.path === activeTabPath)
    : undefined
}

function serializeEditorBody(editor: ReturnType<typeof useCreateBlockNote>): string {
  return serializeRichEditorBodyToMarkdown(editor)
}

function trySerializeEditorBody(
  editor: ReturnType<typeof useCreateBlockNote>,
  reason: string,
): string | null {
  try {
    return serializeEditorBody(editor)
  } catch (error) {
    console.warn(`[editor] Skipped ${reason} because BlockNote document could not be serialized:`, error)
    return null
  }
}

function normalizeTabBody(options: { content: string }): string {
  const { content } = options
  return compactMarkdown(extractEditorBody(content))
}

function activeEditorChangePath(options: {
  prevActivePathRef: MutableRefObject<string | null>
  editorContentPathRef: EditorContentPathRef
}): string | null {
  const { prevActivePathRef, editorContentPathRef } = options
  const path = prevActivePathRef.current
  if (!path || editorContentPathRef.current !== path) return null
  return path
}

function previousContentForPath(options: {
  path: string
  tabs: Tab[]
  cache: Map<string, CachedTabState>
}): string | undefined {
  const { path, tabs, cache } = options
  return tabs.find(t => t.entry.path === path)?.content ?? cache.get(path)?.sourceContent
}

function serializedEditorChange(options: {
  editor: ReturnType<typeof useCreateBlockNote>
  path: string
  previousContent: string
  vaultPath?: string
}): { blocks: CachedTabState['blocks'], content: string } {
  const { editor, path, previousContent, vaultPath } = options
  const blocks = editor.document
  return {
    blocks,
    content: serializeRichEditorDocumentToMarkdown({
      blocks,
      editor,
      notePath: path,
      tabContent: previousContent,
      vaultPath,
    }),
  }
}

/** The editor's current ProseMirror document, or undefined when it cannot be read (no view, or inside a transaction). */
function readEditorDocument(editor: ReturnType<typeof useCreateBlockNote>): unknown {
  try {
    return (editor as { prosemirrorState?: { doc?: unknown } }).prosemirrorState?.doc
  } catch {
    return undefined
  }
}

function useEditorChangeHandler(options: {
  editor: ReturnType<typeof useCreateBlockNote>
  tabsRef: MutableRefObject<Tab[]>
  onContentChangeRef: MutableRefObject<((path: string, content: string) => void) | undefined>
  prevActivePathRef: MutableRefObject<string | null>
  editorContentPathRef: EditorContentPathRef
  suppressChangeRef: MutableRefObject<boolean>
  tabCacheRef: MutableRefObject<Map<string, CachedTabState>>
  pendingLocalContentRef: MutableRefObject<PendingLocalContent | null>
  vaultPathRef: MutableRefObject<string | undefined>
}) {
  const {
    editor,
    tabsRef,
    onContentChangeRef,
    prevActivePathRef,
    editorContentPathRef,
    suppressChangeRef,
    tabCacheRef,
    pendingLocalContentRef,
    vaultPathRef,
  } = options

  const propagateEditorChange = useCallback(() => {
    assertEditorCompositionReady(editor)
    const path = activeEditorChangePath({ prevActivePathRef, editorContentPathRef })
    if (!path) return

    const previousContent = previousContentForPath({
      path,
      tabs: tabsRef.current,
      cache: tabCacheRef.current,
    })
    if (previousContent === undefined) return

    const next = serializedEditorChange({
      editor,
      path,
      previousContent,
      vaultPath: vaultPathRef.current,
    })
    pendingLocalContentRef.current = { path, content: next.content }
    cacheResolvedEditorState(tabCacheRef.current, path, {
      blocks: next.blocks,
      scrollTop: readEditorScrollTop(editor),
      sourceContent: next.content,
    }, vaultPathRef.current)
    onContentChangeRef.current?.(path, next.content)
  }, [editor, editorContentPathRef, onContentChangeRef, pendingLocalContentRef, prevActivePathRef, tabCacheRef, tabsRef, vaultPathRef])

  const { handleEditorChange: markChanged, flushPendingEditorChange: flushChange, hasPendingEditorChange } = useDebouncedEditorChange({ onFlush: propagateEditorChange, suppressChangeRef })
  // TipTap reports a change when only editability flips; the same document object means nothing was typed.
  const lastDocRef = useRef<unknown>(undefined)
  const handleEditorChange = useCallback(() => {
    const doc = readEditorDocument(editor)
    if (doc !== undefined && doc === lastDocRef.current) return
    lastDocRef.current = doc
    markChanged()
  }, [editor, markChanged])
  const flushPendingEditorChange = useCallback(() => {
    assertEditorCompositionReady(editor)
    return flushChange()
  }, [editor, flushChange])
  return { handleEditorChange, flushPendingEditorChange, hasPendingEditorChange }
}

function cachePreviousTabOnPathChange(options: {
  prevPath: string | null
  previousTab: Tab | undefined
  pathChanged: boolean
  editorMountedRef: MutableRefObject<boolean>
  cache: Map<string, CachedTabState>
  editor: ReturnType<typeof useCreateBlockNote>
  editorContentPathRef: EditorContentPathRef
}) {
  const { prevPath, previousTab, pathChanged, editorMountedRef, cache, editor, editorContentPathRef } = options
  if (!prevPath || !previousTab || !pathChanged || !editorMountedRef.current) return
  if (editorContentPathRef.current !== prevPath) return
  cacheEditorState(cache, prevPath, {
    blocks: editor.document,
    scrollTop: readEditorScrollTop(editor),
    sourceContent: previousTab.content,
  })
}

function shouldWaitForActiveTab(options: {
  pathChanged: boolean
  activeTabPath: string | null
  activeTab: Tab | undefined
}) {
  const { pathChanged, activeTabPath, activeTab } = options
  return pathChanged && !!activeTabPath && !activeTab
}

function syncActivePathTransition(options: {
  prevPath: string | null
  pathChanged: boolean
  activeTabPath: string | null
  activeTab: Tab | undefined
  previousTab: Tab | undefined
  cache: Map<string, CachedTabState>
  editor: ReturnType<typeof useCreateBlockNote>
  editorMountedRef: MutableRefObject<boolean>
  prevActivePathRef: MutableRefObject<string | null>
  editorContentPathRef: EditorContentPathRef
  documentSessionRef: MutableRefObject<number>
}) {
  const {
    prevPath,
    pathChanged,
    activeTabPath,
    activeTab,
    previousTab,
    cache,
    editor,
    editorMountedRef,
    prevActivePathRef,
    editorContentPathRef,
    documentSessionRef,
  } = options

  cachePreviousTabOnPathChange({
    prevPath,
    previousTab,
    pathChanged,
    editorMountedRef,
    cache,
    editor,
    editorContentPathRef,
  })
  if (shouldWaitForActiveTab({ pathChanged, activeTabPath, activeTab })) return true

  const renamed = preserveRenamedDocument({
    prevPath,
    activeTabPath,
    activeTab,
    cache,
    editor,
    editorMountedRef,
    editorContentPathRef,
  })
  // A recorded rename keeps the same document; any other path change replaces it.
  if (pathChanged && activeTab?.renamedFrom !== prevPath) documentSessionRef.current += 1
  prevActivePathRef.current = activeTabPath
  return renamed
}

function markRawModeReswapPending(options: {
  activeTabPath: string | null
  cache: Map<string, CachedTabState>
  rawSwapPendingRef: MutableRefObject<boolean>
}) {
  const { activeTabPath, cache, rawSwapPendingRef } = options
  if (!activeTabPath) return false
  cache.delete(activeTabPath)
  rawSwapPendingRef.current = true
  return true
}

function currentEditorMatchesActiveTab(options: {
  activeTabPath: string | null
  activeTab: Tab | undefined
  editor: ReturnType<typeof useCreateBlockNote>
  editorMountedRef: MutableRefObject<boolean>
}) {
  const {
    activeTabPath,
    activeTab,
    editor,
    editorMountedRef,
  } = options

  if (!activeTabPath || !activeTab || !editorMountedRef.current) return false
  if (typeof editor.blocksToMarkdownLossy !== 'function') return false

  const startedAt = now()
  const bodyMarkdown = trySerializeEditorBody(editor, 'active tab comparison')
  const matched = bodyMarkdown === normalizeTabBody({ content: activeTab.content })
  logEditorStabilityCheckTrace({
    durationMs: now() - startedAt,
    matched,
    notePath: activeTabPath,
    sourceBytes: activeTab.content.length,
  })
  return matched
}

function currentEditorMatchesEmptyHeadingTab(options: {
  activeTabPath: string | null
  activeTab: Tab | undefined
  editor: ReturnType<typeof useCreateBlockNote>
  editorMountedRef: MutableRefObject<boolean>
}) {
  const { activeTab } = options
  if (!activeTab || !startsWithEmptyHeading({ content: activeTab.content })) return false
  return currentEditorMatchesActiveTab(options)
}

function cachedActiveTabMatchesEditor(options: {
  activeTabPath: string | null
  activeTab: Tab | undefined
  cache: Map<string, CachedTabState>
  editorContentPathRef: EditorContentPathRef
}) {
  const { activeTabPath, activeTab, cache, editorContentPathRef } = options
  if (!activeTabPath || !activeTab || editorContentPathRef.current !== activeTabPath) return false
  return cache.get(activeTabPath)?.sourceContent === activeTab.content
}

function cacheStableActiveTabAndClearPending(options: {
  cache: Map<string, CachedTabState>
  activeTabPath: string | null
  activeTab: Tab | undefined
  editor: ReturnType<typeof useCreateBlockNote>
  editorMountedRef: MutableRefObject<boolean>
  editorContentPathRef: EditorContentPathRef
  pendingLocalContentRef: MutableRefObject<PendingLocalContent | null>
}) {
  const {
    cache,
    activeTabPath,
    activeTab,
    editor,
    editorMountedRef,
    editorContentPathRef,
    pendingLocalContentRef,
  } = options

  cacheStableActivePath({
    cache,
    activeTabPath,
    activeTab,
    editor,
    editorMountedRef,
    editorContentPathRef,
  })
  pendingLocalContentRef.current = null
  return true
}

function shouldKeepPendingLocalContent(options: {
  activeTabPath: string | null
  activeTab: Tab | undefined
  pendingLocalContentRef: MutableRefObject<PendingLocalContent | null>
}) {
  const {
    activeTabPath,
    activeTab,
    pendingLocalContentRef,
  } = options

  const pendingLocalContent = pendingLocalContentRef.current
  if (!activeTabPath || !activeTab || pendingLocalContent?.path !== activeTabPath) return false
  return true
}

function consumePendingLocalContent(options: {
  cache: Map<string, CachedTabState>
  activeTabPath: string | null
  activeTab: Tab | undefined
  editor: ReturnType<typeof useCreateBlockNote>
  editorMountedRef: MutableRefObject<boolean>
  editorContentPathRef: EditorContentPathRef
  pendingLocalContentRef: MutableRefObject<PendingLocalContent | null>
}) {
  const {
    cache,
    activeTabPath,
    activeTab,
    editor,
    editorMountedRef,
    editorContentPathRef,
    pendingLocalContentRef,
  } = options

  const pendingLocalContent = pendingLocalContentRef.current
  if (!pendingLocalContent || pendingLocalContent.content !== activeTab?.content) return true
  return cacheStableActiveTabAndClearPending({
    cache,
    activeTabPath,
    activeTab,
    editor,
    editorMountedRef,
    editorContentPathRef,
    pendingLocalContentRef,
  })
}

function handleStableActivePath(options: StableActivePathOptions) {
  const {
    pathChanged,
    rawModeJustEnded,
    activeTabPath,
    cache,
    rawSwapPendingRef,
  } = options

  if (pathChanged) return false
  if (rawModeJustEnded) {
    return !markRawModeReswapPending({ activeTabPath, cache, rawSwapPendingRef })
  }
  if (shouldKeepPendingLocalContent(options)) {
    return consumePendingLocalContent(options)
  }
  const contentResolution = resolveStableActivePathContent(options)
  if (contentResolution !== null) return contentResolution
  if (rawSwapPendingRef.current) return true
  // The editor still holds another page, so swap again instead of filing its text under this one.
  if (options.editorContentPathRef.current !== activeTabPath) return false

  cacheStableActivePath(options)
  return true
}

function resolveStableActivePathContent(options: StableActivePathOptions): boolean | null {
  return resolveCachedStableContent(options)
    ?? resolveEmptyHeadingStableContent(options)
    ?? resolveCurrentStableContent(options)
    ?? resolveStaleStableContent(options)
}

function resolveCachedStableContent(options: StableActivePathOptions): boolean | null {
  if (!cachedActiveTabMatchesEditor(options)) return null
  options.pendingLocalContentRef.current = null
  return true
}

function resolveEmptyHeadingStableContent(options: StableActivePathOptions): boolean | null {
  return currentEditorMatchesEmptyHeadingTab(options)
    ? cacheStableActiveTabAndClearPending(options)
    : null
}

function resolveStaleStableContent(options: StableActivePathOptions): boolean | null {
  return shouldRefreshStableActivePath(options) ? false : null
}

function resolveCurrentStableContent(options: StableActivePathOptions): boolean | null {
  return currentEditorMatchesActiveTab(options)
    ? cacheStableActiveTabAndClearPending(options)
    : null
}

function shouldRefreshStableActivePath(options: {
  activeTabPath: string | null
  activeTab: Tab | undefined
  cache: Map<string, CachedTabState>
}): boolean {
  const {
    activeTabPath,
    activeTab,
    cache,
  } = options

  if (!activeTabPath || !activeTab) return false
  const cachedState = cache.get(activeTabPath)
  return !cachedState || cachedState.sourceContent !== activeTab.content
}

function shouldClearDomSelectionForScheduledSwap(options: {
  activeTabPath: string | null
  state: TabSwapState
}): boolean {
  const { activeTabPath, state } = options
  if (state.pathChanged) return true
  if (!activeTabPath || !state.activeTab) return false

  const cachedState = state.cache.get(activeTabPath)
  return !!cachedState && cachedState.sourceContent !== state.activeTab.content
}

function cacheStableActivePath(options: {
  cache: Map<string, CachedTabState>
  activeTabPath: string | null
  activeTab: Tab | undefined
  editor: ReturnType<typeof useCreateBlockNote>
  editorMountedRef: MutableRefObject<boolean>
  editorContentPathRef: EditorContentPathRef
}) {
  const {
    cache,
    activeTabPath,
    activeTab,
    editor,
    editorMountedRef,
    editorContentPathRef,
  } = options

  if (!activeTabPath || !activeTab || !editorMountedRef.current) return
  const moved = editorContentPathRef.current !== activeTabPath
  editorContentPathRef.current = activeTabPath
  cacheEditorState(cache, activeTabPath, {
    blocks: editor.document,
    scrollTop: readEditorScrollTop(editor),
    sourceContent: activeTab.content,
  })
  // Shown without a swap, so send the signal a swap would; readiness waits for it.
  if (moved) signalTabSwap({ path: activeTabPath })
}

function preserveRenamedDocument(options: {
  prevPath: string | null
  activeTabPath: string | null
  activeTab: Tab | undefined
  cache: Map<string, CachedTabState>
  editor: ReturnType<typeof useCreateBlockNote>
  editorMountedRef: MutableRefObject<boolean>
  editorContentPathRef: EditorContentPathRef
}) {
  const { prevPath, activeTab, cache, editorMountedRef, editorContentPathRef } = options
  // Only a recorded rename of the page the editor really holds keeps its live blocks.
  if (!prevPath || activeTab?.renamedFrom !== prevPath) return false
  if (editorContentPathRef.current !== prevPath || !editorMountedRef.current) return false

  cache.delete(prevPath)
  cacheStableActivePath(options)
  return true
}

function signalTabSwap(options: { path: string; shouldAbort?: () => boolean }) {
  const { path, shouldAbort } = options
  requestNextFrame(() => {
    // A swap replaced since this was queued must not report the page ready.
    if (shouldAbort?.()) return
    signalEditorTabSwapped(path)
  })
}

function requestNextFrame(callback: FrameRequestCallback): void {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(callback)
    return
  }

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(callback)
    return
  }

  setTimeout(() => callback(Date.now()), 0)
}

function schedulePostPaint(callback: () => void): void {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    setTimeout(callback, 0)
    return
  }

  window.requestAnimationFrame(() => {
    window.setTimeout(callback, 0)
  })
}

function clearStaleSwap(options: {
  targetPath: string
  prevActivePathRef: MutableRefObject<string | null>,
  suppressChangeRef: MutableRefObject<boolean>,
}): boolean {
  const {
    targetPath,
    prevActivePathRef,
    suppressChangeRef,
  } = options
  if (prevActivePathRef.current === targetPath) return false
  suppressChangeRef.current = false
  return true
}

function applyBlankTabState(options: {
  cache: Map<string, CachedTabState>
  targetPath: string
  content: string
  editor: ReturnType<typeof useCreateBlockNote>
  suppressChangeRef: MutableRefObject<boolean>
  editorContentPathRef: EditorContentPathRef
  shouldAbort: () => boolean
}): boolean {
  const {
    cache,
    targetPath,
    content,
    editor,
    suppressChangeRef,
    editorContentPathRef,
    shouldAbort,
  } = options

  cacheEditorState(cache, targetPath, {
    blocks: blankParagraphBlocks(),
    scrollTop: 0,
    sourceContent: content,
  })
  if (!applyBlankStateToEditor({ editor, suppressChangeRef, editorContentPathRef, targetPath, shouldAbort })) {
    return false
  }

  signalTabSwap({ path: targetPath, shouldAbort })
  return true
}

function editorChangedDuringUntitledEmptyHeadingParse(
  editor: ReturnType<typeof useCreateBlockNote>,
  targetPath: string,
  documentBeforeParseSignature: string,
): boolean {
  return isUntitledPath(targetPath)
    && editorDocumentSignature(editor.document) !== documentBeforeParseSignature
    && !isBlankEditorDocument(editor.document)
}

function scheduleEmptyHeadingSwap(options: {
  editor: ReturnType<typeof useCreateBlockNote>
  cache: Map<string, CachedTabState>
  targetPath: string
  content: string
  prevActivePathRef: MutableRefObject<string | null>
  suppressChangeRef: MutableRefObject<boolean>
  editorContentPathRef: EditorContentPathRef
  swapSeqRef: MutableRefObject<number>
  tabsRef: MutableRefObject<Tab[]>
  token: SwapToken
  vaultPath?: string
}) {
  const {
    editor,
    cache,
    targetPath,
    content,
    prevActivePathRef,
    suppressChangeRef,
    editorContentPathRef,
    swapSeqRef,
    tabsRef,
    token,
    vaultPath,
  } = options

  if (!startsWithEmptyHeading({ content })) return false

  const shouldAbort = () => shouldAbortSwap({ prevActivePathRef, suppressChangeRef, swapSeqRef, tabsRef, token })
  const documentBeforeParseSignature = editorDocumentSignature(editor.document)
  void resolveEmptyHeadingBlocks(editor, content, vaultPath, targetPath)
    .then((blocks) => {
      if (!blocks) return
      if (shouldAbort()) return
      if (editorChangedDuringUntitledEmptyHeadingParse(editor, targetPath, documentBeforeParseSignature)) {
        suppressChangeRef.current = false
        return
      }
      // Record the swap in the tab cache too, like the blank and parsed swap paths do. BlockNote
      // serializes the empty title as "#" while the note source says "# ", so without this the
      // next render of the same tab looks stale and swaps the same blocks in again, which moves
      // the caret out of the new note's title.
      cacheResolvedEditorState(cache, targetPath, { blocks, scrollTop: 0, sourceContent: content }, vaultPath)
      if (!applyBlocksToEditor({ editor, blocks, scrollTop: 0, suppressChangeRef, editorContentPathRef, targetPath, shouldAbort })) return
      signalTabSwap({ path: targetPath, shouldAbort })
    })
    .catch((err: unknown) => {
      if (swapSeqRef.current === token.seq) suppressChangeRef.current = false
      console.error('Failed to render empty heading state:', err)
      failNoteOpenTrace(targetPath, 'empty-heading-swap-failed')
    })

  return true
}

function scheduleTabSwap(options: {
  editor: ReturnType<typeof useCreateBlockNote>
  cache: Map<string, CachedTabState>
  targetPath: string
  activeTab: Tab
  clearDomSelection: boolean
  pendingSwapRef: MutableRefObject<(() => void) | null>
  swapSeqRef: MutableRefObject<number>
  tabsRef: MutableRefObject<Tab[]>
  prevActivePathRef: MutableRefObject<string | null>
  rawSwapPendingRef: MutableRefObject<boolean>
  suppressChangeRef: MutableRefObject<boolean>
  editorContentPathRef: EditorContentPathRef
  vaultPath?: string
}) {
  const {
    editor,
    cache,
    targetPath,
    activeTab,
    clearDomSelection,
    pendingSwapRef,
    swapSeqRef,
    tabsRef,
    prevActivePathRef,
    rawSwapPendingRef,
    suppressChangeRef,
    editorContentPathRef,
    vaultPath,
  } = options

  const token = createSwapToken(swapSeqRef, targetPath, activeTab.content)
  const shouldAbort = () => shouldAbortSwap({ prevActivePathRef, suppressChangeRef, swapSeqRef, tabsRef, token })
  suppressChangeRef.current = true

  const doSwap = () => {
    if (shouldAbort()) return
    if (clearStaleSwap({ targetPath, prevActivePathRef, suppressChangeRef })) return
    rawSwapPendingRef.current = false
    if (clearDomSelection) clearEditorDomSelection(editorScopeForEditor(editor))

    if (isBlankBodyContent({ content: activeTab.content })) {
      applyBlankTabState({
        cache,
        targetPath,
        content: activeTab.content,
        editor,
        suppressChangeRef,
        editorContentPathRef,
        shouldAbort,
      })
      return
    }

    if (scheduleEmptyHeadingSwap({
      editor,
      cache,
      targetPath,
      content: activeTab.content,
      prevActivePathRef,
      suppressChangeRef,
      editorContentPathRef,
      swapSeqRef,
      tabsRef,
      token,
      vaultPath,
    })) {
      return
    }

    scheduleParsedBlockSwap({
      editor,
      cache,
      targetPath,
      content: activeTab.content,
      prevActivePathRef,
      suppressChangeRef,
      editorContentPathRef,
      swapSeqRef,
      tabsRef,
      token,
      signalTabSwap,
      vaultPath,
    })
  }

  if (editor.prosemirrorView) {
    schedulePostPaint(doSwap)
    return
  }
  pendingSwapRef.current = doSwap
}

function resolveTabSwapState(options: {
  tabs: Tab[]
  activeTabPath: string | null
  tabCacheRef: MutableRefObject<Map<string, CachedTabState>>
  prevActivePathRef: MutableRefObject<string | null>
  rawModeJustEnded: boolean
}): TabSwapState {
  const {
    tabs,
    activeTabPath,
    tabCacheRef,
    prevActivePathRef,
    rawModeJustEnded,
  } = options

  const prevPath = prevActivePathRef.current
  return {
    cache: tabCacheRef.current,
    prevPath,
    pathChanged: prevPath !== activeTabPath,
    activeTab: findActiveTab({ tabs, activeTabPath }),
    previousTab: findActiveTab({ tabs, activeTabPath: prevPath }),
    rawModeJustEnded,
  }
}

function shouldSkipScheduledTabSwap(options: {
  state: TabSwapState
  activeTabPath: string | null
  editor: ReturnType<typeof useCreateBlockNote>
  editorMountedRef: MutableRefObject<boolean>
  prevActivePathRef: MutableRefObject<string | null>
  editorContentPathRef: EditorContentPathRef
  rawSwapPendingRef: MutableRefObject<boolean>
  pendingLocalContentRef: MutableRefObject<PendingLocalContent | null>
  documentSessionRef: MutableRefObject<number>
}) {
  const {
    state,
    activeTabPath,
    editor,
    editorMountedRef,
    prevActivePathRef,
    editorContentPathRef,
    rawSwapPendingRef,
    pendingLocalContentRef,
    documentSessionRef,
  } = options

  if (state.pathChanged) {
    pendingLocalContentRef.current = null
  }

  if (syncActivePathTransition({
    prevPath: state.prevPath,
    pathChanged: state.pathChanged,
    activeTabPath,
    activeTab: state.activeTab,
    previousTab: state.previousTab,
    cache: state.cache,
    editor,
    editorMountedRef,
    prevActivePathRef,
    editorContentPathRef,
    documentSessionRef,
  })) {
    return true
  }

  return handleStableActivePath({
    pathChanged: state.pathChanged,
    rawModeJustEnded: state.rawModeJustEnded,
    activeTabPath,
    activeTab: state.activeTab,
    cache: state.cache,
    editor,
    editorMountedRef,
    editorContentPathRef,
    rawSwapPendingRef,
    pendingLocalContentRef,
  })
}

function runTabSwapEffect(options: RunTabSwapEffectOptions) {
  const rawModeJustEnded = consumeRawModeTransition(options.prevRawModeRef, options.rawMode)
  if (flushBeforeRawMode(options)) return
  const state = resolveTabSwapState({
    tabs: options.tabs,
    activeTabPath: options.activeTabPath,
    tabCacheRef: options.tabCacheRef,
    prevActivePathRef: options.prevActivePathRef,
    rawModeJustEnded,
  })
  if (state.pathChanged) invalidatePendingSwap(options)
  flushBeforePathChange({
    pathChanged: state.pathChanged,
    flushPendingEditorChange: options.flushPendingEditorChange,
  })
  if (!state.pathChanged && options.flushPendingEditorChange()) return

  if (shouldSkipScheduledTabSwap({
    state,
    activeTabPath: options.activeTabPath,
    editor: options.editor,
    editorMountedRef: options.editorMountedRef,
    prevActivePathRef: options.prevActivePathRef,
    editorContentPathRef: options.editorContentPathRef,
    rawSwapPendingRef: options.rawSwapPendingRef,
    pendingLocalContentRef: options.pendingLocalContentRef,
    documentSessionRef: options.documentSessionRef,
  })) {
    return
  }

  if (!options.activeTabPath || !state.activeTab) return

  scheduleTabSwap({
    editor: options.editor,
    cache: state.cache,
    targetPath: options.activeTabPath,
    activeTab: state.activeTab,
    clearDomSelection: shouldClearDomSelectionForScheduledSwap({
      activeTabPath: options.activeTabPath,
      state,
    }),
    pendingSwapRef: options.pendingSwapRef,
    swapSeqRef: options.swapSeqRef,
    tabsRef: options.tabsRef,
    prevActivePathRef: options.prevActivePathRef,
    rawSwapPendingRef: options.rawSwapPendingRef,
    suppressChangeRef: options.suppressChangeRef,
    editorContentPathRef: options.editorContentPathRef,
    vaultPath: options.vaultPath,
  })
}

function useTabSwapEffect(options: UseTabSwapEffectOptions) {
  const {
    tabs,
    activeTabPath,
    editor,
    rawMode,
    tabCacheRef,
    tabsRef,
    prevActivePathRef,
    editorMountedRef,
    pendingSwapRef,
    swapSeqRef,
    prevRawModeRef,
    rawSwapPendingRef,
    suppressChangeRef,
    editorContentPathRef,
    pendingLocalContentRef,
    documentSessionRef,
    vaultPathRef,
    flushPendingEditorChange,
  } = options

  useEffect(() => {
    try {
      runTabSwapEffect({
      tabs,
      activeTabPath,
      editor,
      rawMode,
      tabCacheRef,
      tabsRef,
      editorMountedRef,
      prevActivePathRef,
      pendingSwapRef,
      swapSeqRef,
      prevRawModeRef,
      rawSwapPendingRef,
      suppressChangeRef,
      editorContentPathRef,
      pendingLocalContentRef,
      documentSessionRef,
      flushPendingEditorChange,
      vaultPath: vaultPathRef.current,
      })
    } catch (error) {
      // Keep the current document intact. Explicit save/navigation reports the error;
      // an unrelated render must neither replace unsaved text nor crash the editor.
      console.warn('[editor] Deferred tab synchronization until pending content can be saved:', error)
    }
  }, [
    activeTabPath,
    editor,
    editorMountedRef,
    pendingSwapRef,
    swapSeqRef,
    prevActivePathRef,
    prevRawModeRef,
    rawMode,
    rawSwapPendingRef,
    suppressChangeRef,
    editorContentPathRef,
    tabCacheRef,
    tabsRef,
    tabs,
    pendingLocalContentRef,
    documentSessionRef,
    vaultPathRef,
    flushPendingEditorChange,
  ])
}

function useInvalidateSwapsOnUnmount(options: {
  pendingSwapRef: MutableRefObject<(() => void) | null>
  swapSeqRef: MutableRefObject<number>
  suppressChangeRef: MutableRefObject<boolean>
  prevActivePathRef: MutableRefObject<string | null>
}) {
  const { pendingSwapRef, swapSeqRef, suppressChangeRef, prevActivePathRef } = options
  useEffect(() => () => {
    // Deferred swaps (rAF/setTimeout) must not touch the DOM after unmount.
    invalidatePendingSwap({ pendingSwapRef, swapSeqRef })
    // A canceled swap can never release its hold, so a remount (StrictMode replay) must open the page again.
    if (suppressChangeRef.current) prevActivePathRef.current = null
  }, [pendingSwapRef, swapSeqRef, suppressChangeRef, prevActivePathRef])
}

function useForegroundWorkTracker(
  activeTabPath: string | null,
  handleEditorChange: () => void,
) {
  const foregroundWorkAtRef = useRef(0)
  useEffect(() => {
    void activeTabPath
    foregroundWorkAtRef.current = Date.now()
  }, [activeTabPath])
  const handleForegroundEditorChange = useCallback(() => {
    foregroundWorkAtRef.current = Date.now()
    handleEditorChange()
  }, [handleEditorChange])
  return { foregroundWorkAtRef, handleForegroundEditorChange }
}

function usePrepareParsedBlocks(options: {
  editor: ReturnType<typeof useCreateBlockNote>
  tabCacheRef: MutableRefObject<Map<string, CachedTabState>>
  vaultPathRef: MutableRefObject<string | undefined>
}) {
  const { editor, tabCacheRef, vaultPathRef } = options
  return useCallback(async (event: ParsedBlockPreloadEvent) => {
    await resolveBlocksForTarget({
      editor,
      cache: tabCacheRef.current,
      targetPath: event.path,
      content: event.content,
      vaultPath: vaultPathRef.current,
    })
  }, [editor, tabCacheRef, vaultPathRef])
}

/**
 * Manages the tab content-swap machinery for the BlockNote editor.
 *
 * Owns all refs and effects related to:
 * - Tracking editor mount state (editorMountedRef, pendingSwapRef)
 * - Swapping document content when the active tab changes (with caching)
 * - Cleaning up the block cache when tabs are closed
 * - Serializing editor blocks → markdown on change (suppressChangeRef)
 *
 * Returns the onChange callback for SingleEditorView and a flush hook for
 * save/navigation paths that need the latest rich-editor content immediately.
 */
export function useEditorTabSwap({ tabs, activeTabPath, editor, onContentChange, rawMode, vaultPath }: UseEditorTabSwapOptions) {
  const tabCacheRef = useRef<Map<string, CachedTabState>>(new Map())
  const pendingLocalContentRef = useRef<PendingLocalContent | null>(null)
  // Which document the editor holds: unchanged by an untitled rename, advanced when content is replaced.
  const documentSessionRef = useRef(0)
  const prevActivePathRef = useRef<string | null>(null)
  const activeTabPathLatestRef = useLatestRef(activeTabPath)
  const editorContentSignal = useEditorContentPathSignal(activeTabPath)
  const editorContentPathRef = useRef<string | null>(null)
  const editorMountedRef = useRef(false)
  const pendingSwapRef = useRef<(() => void) | null>(null)
  const swapSeqRef = useRef(0)
  const prevRawModeRef = useRef(!!rawMode)
  const rawModeLatestRef = useLatestRef(!!rawMode)
  const rawSwapPendingRef = useRef(false)
  const suppressChangeRef = useRef(false)
  const onContentChangeRef = useLatestRef(onContentChange)
  const tabsRef = useLatestRef(tabs)
  const vaultPathRef = useLatestRef(vaultPath)
  const { handleEditorChange, flushPendingEditorChange, hasPendingEditorChange } = useEditorChangeHandler({
    editor,
    tabsRef,
    onContentChangeRef,
    prevActivePathRef,
    editorContentPathRef,
    suppressChangeRef,
    tabCacheRef,
    pendingLocalContentRef,
    vaultPathRef,
  })
  const { foregroundWorkAtRef, handleForegroundEditorChange } = useForegroundWorkTracker(activeTabPath, handleEditorChange)
  const prepareParsedBlocks = usePrepareParsedBlocks({ editor, tabCacheRef, vaultPathRef })
  useEditorMountState(editor, editorMountedRef, pendingSwapRef)
  useInvalidateSwapsOnUnmount({ pendingSwapRef, swapSeqRef, suppressChangeRef, prevActivePathRef })
  useParsedBlockPreload({
    activeTabPathRef: activeTabPathLatestRef,
    editorMountedRef,
    foregroundWorkAtRef,
    prepareParsedBlocks,
    rawModeRef: rawModeLatestRef,
  })
  useTabSwapEffect({
    tabs,
    activeTabPath,
    editor,
    rawMode,
    tabCacheRef,
    tabsRef,
    prevActivePathRef,
    editorMountedRef,
    pendingSwapRef,
    swapSeqRef,
    prevRawModeRef,
    rawSwapPendingRef,
    suppressChangeRef,
    editorContentPathRef,
    pendingLocalContentRef,
    documentSessionRef,
    vaultPathRef,
    flushPendingEditorChange,
  })

  return {
    editorContentPath: editorContentSignal.path,
    editorContentVersion: editorContentSignal.version,
    handleEditorChange: handleForegroundEditorChange,
    flushPendingEditorChange,
    hasPendingEditorChange,
    editorMountedRef,
    documentSessionRef,
  }
}
