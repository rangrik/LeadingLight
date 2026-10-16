import type { PaneEditorModeControl } from '../leadinglight/paneEditorMode'
import { useRef, useEffect, useCallback, memo, useState, type ReactNode } from 'react'
import { useEditorTabSwap } from '../hooks/useEditorTabSwap'
import { useCreateBlockNote } from '@blocknote/react'
import '@blocknote/mantine/style.css'
import 'katex/dist/katex.min.css'
import {
  emptyImageUploadResult,
  isUnsupportedImageFormatError,
  uploadImageFile,
  type ImageImportError,
  type UploadImageFileResult,
} from '../hooks/useImageDrop'
import { trackEditorWork } from '../leadinglight/editorWork'
import { DEFAULT_AI_AGENT, type AiAgentId, type AiAgentReadiness } from '../lib/aiAgents'
import type { AiTarget } from '../lib/aiTargets'
import { translate, type AppLocale } from '../lib/i18n'
import { RUNTIME_STYLE_NONCE } from '../lib/runtimeStyleNonce'
import type { VaultEntry, GitCommit, NoteWidthMode, NoteStatus, WorkspaceIdentity } from '../types'
import type { NoteListItem } from '../utils/ai-context'
import type { FrontmatterValue } from './Inspector'
import type { FrontmatterOpOptions } from '../hooks/frontmatterOps'
import { ResizeHandle } from './ResizeHandle'
import { useDiffMode, type CommitDiffRequest } from '../hooks/useDiffMode'
import { insertDraftAtEnd, useEditorFocus } from '../hooks/useEditorFocus'
import type { ContentReceipt } from '../hooks/useEditorSave'
import { useDragRegion } from '../hooks/useDragRegion'
import { formatShortcutDisplay } from '../hooks/appCommandCatalog'
import { EditorRightPanel } from './EditorRightPanel'
import { EditorContent } from './EditorContent'
import { EditorMemoryProbe } from './EditorMemoryProbe'
import { FilePreview } from './FilePreview'
import { schema } from './editorSchema'
import { useRightPanelExclusion } from './useRightPanelExclusion'
import type { RawEditorFindRequest } from './RawEditorFindBar'
import { resolvePendingRawExitContent, resolveRawModeContent } from './editorRawModeSync'
import { useRegisterEditorContentFlushes, type EditorIdleCheck } from './editorContentFlushRegistration'
import { useRawModeWithFlush } from './useRawModeWithFlush'
import { createImeCompositionKeyGuardExtension } from './imeCompositionKeyGuardExtension'
import { createMarkdownHighlightShortcutExtension } from './markdownHighlightShortcutExtension'
import { handleRemoteRichEditorPaste } from './richEditorPaste'
import { createRichEditorMarkdownInputTransformExtension } from './richEditorInputTransformExtension'
import { createRichEditorTextDirectionExtension } from './richEditorTextDirection'
import { createRichEditorTransformErrorRecoveryExtension } from './richEditorTransformErrorRecoveryExtension'
import { createRichEditorBlockSelectionExtension } from './richEditorBlockSelectionExtension'
import { createTodoBlockShortcutExtension } from './todoBlockShortcutExtension'
import { createRichEditorCodeBlockTabExtension } from './richEditorCodeBlockTabExtension'
import { createRichEditorCodeBlockShortcutExtension } from './richEditorCodeBlockShortcutExtension'
import { createRichEditorCodeBlockArrowNavigationExtension } from './richEditorCodeBlockArrowNavigationExtension'
import { createRichEditorEmptyListNavigationExtension } from './richEditorEmptyListNavigationExtension'
import { createRichEditorListTabExtension } from './richEditorListTabExtension'
import { useFilenameAutolinkGuard } from './useFilenameAutolinkGuard'
import { useEditorPdfExport } from './useEditorPdfExport'
import type { NotePdfExportSource } from '../utils/notePdfExport'
import type { RichEditorBlockTypeDefinition } from '../utils/richEditorBlockTypes'
import { useRichEditorContentReadiness, useRichEditorSheetSwapState } from './useRichEditorSheetTransition'
import { installRichEditorMarkdownSerializer } from '../utils/richEditorMarkdown'
import { installRichEditorDispatchPerformanceProbe } from './richEditorDispatchPerformance'
import { RICH_EDITOR_BLOCKNOTE_PERFORMANCE_OPTIONS } from './richEditorBlockNoteOptions'
import { markStartupPhase } from '../lib/startupPerformance'
import { useTurnCurrentBlockIntoCommand } from './useTurnCurrentBlockIntoCommand'
import './Editor.css'
import './EditorTheme.css'

const RICH_EDITOR_BIDI_DOM_ATTRIBUTES = {
  blockContent: { dir: 'auto' },
  inlineContent: { dir: 'auto' },
}

interface Tab {
  entry: VaultEntry
  content: string
}

export interface EditorProps {
  tabs: Tab[]
  activeTabPath: string | null
  isVaultLoading?: boolean
  entries: VaultEntry[]
  onNavigateWikilink: (target: string) => void
  /** Opens a backlink source by its exact entry; resolves whether it is now shown. */
  onOpenEntry?: (entry: VaultEntry) => Promise<boolean>
  /** Scrolls the Inspector's backlinks into view once, then calls onBacklinksRevealed. */
  revealBacklinks?: boolean
  onBacklinksRevealed?: () => void
  /** Shown under Backlinks when no other page lists this one. */
  backlinksEmptyLabel?: string
  onUnsupportedAiPaste?: (message: string) => void
  onLoadDiff?: (path: string) => Promise<string>
  onLoadDiffAtCommit?: (path: string, commitHash: string) => Promise<string>
  pendingCommitDiffRequest?: CommitDiffRequest | null
  onPendingCommitDiffHandled?: (requestId: number) => void
  getNoteStatus?: (path: string) => NoteStatus
  onCreateNote?: () => void
  inspectorCollapsed: boolean
  onToggleInspector: () => void
  inspectorWidth: number
  /** Too narrow to share: the Inspector floats over the page instead of shrinking it. */
  inspectorOverlay?: boolean
  defaultAiAgent?: AiAgentId
  defaultAiTarget?: AiTarget
  defaultAiAgentReadiness?: AiAgentReadiness
  defaultAiAgentReady?: boolean
  onInspectorResize: (delta: number) => void
  inspectorEntry: VaultEntry | null
  inspectorContent: string | null
  gitHistory: GitCommit[]
  onUpdateFrontmatter?: (
    path: string,
    key: string,
    value: FrontmatterValue,
    options?: FrontmatterOpOptions,
  ) => Promise<void>
  onDeleteProperty?: (path: string, key: string, options?: FrontmatterOpOptions) => Promise<void>
  onAddProperty?: (path: string, key: string, value: FrontmatterValue, options?: FrontmatterOpOptions) => Promise<void>
  onCreateMissingType?: (path: string, missingType: string, nextTypeName: string) => Promise<boolean | undefined>
  onCreateAndOpenNote?: (title: string) => Promise<boolean>
  onChangeWorkspace?: (entry: VaultEntry, workspace: WorkspaceIdentity) => Promise<void> | void
  onInitializeProperties?: (path: string) => void
  showAIChat?: boolean
  onToggleAIChat?: () => void
  aiWorkspaceSurface?: ReactNode
  vaultPath?: string
  vaultPaths?: string[]
  noteList?: NoteListItem[]
  noteListFilter?: { type: string | null; query: string }
  onToggleFavorite?: (path: string) => void
  onToggleOrganized?: (path: string) => void
  onEnterNeighborhood?: (entry: VaultEntry) => void
  onRevealFile?: (path: string) => void
  onCopyFilePath?: (path: string) => void
  onCopyDeepLink?: (entry: VaultEntry) => void
  onCopyGitUrl?: (entry: VaultEntry) => void
  onOpenExternalFile?: (path: string) => void
  onDeleteNote?: (path: string) => void
  onArchiveNote?: (path: string) => void
  onUnarchiveNote?: (path: string) => void
  onContentChange?: (path: string, content: string) => ContentReceipt | null | void
  onSave?: () => void
  /** Called when the user explicitly renames the filename from the breadcrumb. */
  onRenameFilename?: (path: string, newFilenameStem: string) => void
  noteWidth?: NoteWidthMode
  onToggleNoteWidth?: () => void
  canGoBack?: boolean
  canGoForward?: boolean
  onGoBack?: () => void
  onGoForward?: () => void
  leftPanelsCollapsed?: boolean
  /** Mutable ref that Editor registers its raw-mode toggle into, for command palette access. */
  editorModeControl?: PaneEditorModeControl
  rawToggleRef?: React.MutableRefObject<() => void>
  /** Mutable ref that Editor registers editor find commands into, for shortcuts and menus. */
  findInNoteRef?: React.MutableRefObject<((options?: { replace?: boolean }) => void) | null>
  /** Mutable ref that Editor registers its diff-mode toggle into, for command palette access. */
  diffToggleRef?: React.MutableRefObject<() => void>
  /** Mutable ref that Editor registers its table-of-contents toggle into, for app shortcuts and menus. */
  tableOfContentsToggleRef?: React.MutableRefObject<() => void>
  /** Mutable ref that Editor registers the PDF export command into, for command palette and native menu access. */
  pdfExportRef?: React.MutableRefObject<((source?: NotePdfExportSource) => void) | null>
  /** Mutable ref that Editor registers focused-block type changes into, for command palette access. */
  turnCurrentBlockIntoRef?: React.MutableRefObject<((target: RichEditorBlockTypeDefinition) => void) | null>
  /** Emits short user-visible messages for editor actions. */
  onToast?: (message: string | null) => void
  onFileCreated?: (relativePath: string) => void
  onFileModified?: (relativePath: string) => void
  onVaultChanged?: () => void
  workspaces?: WorkspaceIdentity[]
  /** Whether the active note has a merge conflict. */
  isConflicted?: boolean
  /** Resolve conflict by keeping the local version. */
  onKeepMine?: (path: string) => void
  /** Resolve conflict by keeping the remote version. */
  onKeepTheirs?: (path: string) => void
  /** Registers a hook that flushes pending rich-editor changes into app state before external actions. */
  flushPendingEditorContentRef?: React.MutableRefObject<((path: string) => void) | null>
  /** Registers a hook that flushes the raw editor buffer into app state before external actions. */
  flushPendingRawContentRef?: React.MutableRefObject<((path: string) => void) | null>
  /** Registers whether the editor's buffers hold only the given text, before a final recovery choice. */
  editorIdleRef?: React.MutableRefObject<EditorIdleCheck | null>
  locale?: AppLocale
}

type ImageImportErrorHandler = (error: ImageImportError) => void

function useEditorModeExclusion({
  diffMode,
  rawMode,
  handleToggleDiff,
  handleToggleRaw,
  rawToggleRef,
  diffToggleRef,
}: {
  diffMode: boolean
  rawMode: boolean
  handleToggleDiff: () => void | Promise<void>
  handleToggleRaw: () => Promise<boolean>
  rawToggleRef?: React.MutableRefObject<() => void>
  diffToggleRef?: React.MutableRefObject<() => void>
}) {
  const handleToggleDiffExclusive = useCallback(async () => {
    if (!diffMode && rawMode && !await handleToggleRaw()) return
    await handleToggleDiff()
  }, [diffMode, rawMode, handleToggleDiff, handleToggleRaw])

  const handleToggleRawExclusive = useCallback(async () => {
    if (!await handleToggleRaw()) return
    if (!rawMode && diffMode) await handleToggleDiff()
  }, [rawMode, diffMode, handleToggleDiff, handleToggleRaw])

  useEffect(() => {
    if (rawToggleRef) rawToggleRef.current = handleToggleRawExclusive
  }, [rawToggleRef, handleToggleRawExclusive])

  useEffect(() => {
    if (diffToggleRef) diffToggleRef.current = handleToggleDiffExclusive
  }, [diffToggleRef, handleToggleDiffExclusive])

  return { handleToggleDiffExclusive, handleToggleRawExclusive }
}

function EditorEmptyState({ locale = 'en' }: { locale?: AppLocale }) {
  const breadcrumbBarHeight = 52
  const { onMouseDown } = useDragRegion()
  const quickOpenShortcut = formatShortcutDisplay({ display: '⌘P / ⌘O' })
  const newNoteShortcut = formatShortcutDisplay({ display: '⌘N' })

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div
        aria-hidden="true"
        data-tauri-drag-region
        data-testid="editor-empty-state-drag-region"
        className="shrink-0"
        onMouseDown={onMouseDown}
        style={{ height: breadcrumbBarHeight }}
      />
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
        <p className="m-0 text-[15px]">{translate(locale, 'editor.empty.selectNote')}</p>
        <span className="text-xs text-muted-foreground">
          {translate(locale, 'editor.empty.shortcuts', {
            quickOpen: quickOpenShortcut,
            newNote: newNoteShortcut,
          })}
        </span>
      </div>
    </div>
  )
}

interface EditorSetupParams {
  tabs: Tab[]
  activeTabPath: string | null
  vaultPath?: string
  onContentChange?: (path: string, content: string) => ContentReceipt | null | void
  onLoadDiff?: (path: string) => Promise<string>
  onLoadDiffAtCommit?: (path: string, commitHash: string) => Promise<string>
  pendingCommitDiffRequest?: CommitDiffRequest | null
  onPendingCommitDiffHandled?: (requestId: number) => void
  getNoteStatus?: (path: string) => NoteStatus
  editorModeControl?: PaneEditorModeControl
  onModeError?: (error: unknown) => void
  rawToggleRef?: React.MutableRefObject<() => void>
  diffToggleRef?: React.MutableRefObject<() => void>
  onImageImportError?: ImageImportErrorHandler
}

function imageImportErrorMessage(error: ImageImportError, locale: AppLocale | undefined): string {
  if (error.kind === 'remote-download') {
    return translate(locale ?? 'en', 'editor.imageImport.remoteDownloadFailed', {
      failedCount: error.failedCount,
      totalCount: error.totalCount,
    })
  }
  if (error.kind === 'copy-failed') {
    return translate(locale ?? 'en', 'editor.imageImport.copyFailed', { filename: error.fileName })
  }
  return translate(locale ?? 'en', 'editor.imageImport.unsupportedHeic', {
    filename: error.fileName,
  })
}

function handleEditorImageUploadFailure(
  file: File,
  error: unknown,
  onImageImportError: ImageImportErrorHandler | undefined,
): UploadImageFileResult {
  if (!isUnsupportedImageFormatError(error)) throw error

  onImageImportError?.(error)
  return emptyImageUploadResult(file)
}

function useEditorSetup(options: EditorSetupParams) {
  const {
    tabs,
    activeTabPath,
    vaultPath,
    onContentChange,
    onLoadDiff,
    onLoadDiffAtCommit,
    pendingCommitDiffRequest,
    onPendingCommitDiffHandled,
    getNoteStatus,
    editorModeControl,
    onModeError,
    rawToggleRef,
    diffToggleRef,
    onImageImportError,
  } = options
  const vaultPathRef = useRef(vaultPath)
  const activeTabPathRef = useRef(activeTabPath)
  const onImageImportErrorRef = useRef(onImageImportError)
  const flushPendingEditorChangeRef = useRef<(() => boolean) | null>(null)
  const sheetFlushRef = useRef<((path: string) => void) | null>(null)
  useEffect(() => {
    vaultPathRef.current = vaultPath
  }, [vaultPath])
  useEffect(() => {
    activeTabPathRef.current = activeTabPath
  }, [activeTabPath])
  useEffect(() => {
    onImageImportErrorRef.current = onImageImportError
  }, [onImageImportError])

  const editor = useCreateBlockNote({
    ...RICH_EDITOR_BLOCKNOTE_PERFORMANCE_OPTIONS,
    schema,
    domAttributes: RICH_EDITOR_BIDI_DOM_ATTRIBUTES,
    uploadFile: async (file: File) => {
      try {
        return await trackEditorWork(uploadImageFile(file, vaultPathRef.current))
      } catch (error) {
        return handleEditorImageUploadFailure(file, error, onImageImportErrorRef.current)
      }
    },
    pasteHandler: (context) => {
      const pastePath = activeTabPathRef.current
      return handleRemoteRichEditorPaste(context, {
        canApply: () => activeTabPathRef.current === pastePath,
        vaultPath: vaultPathRef.current,
        onImportResult: ({ failedCount, totalCount }) => {
          if (failedCount > 0) {
            onImageImportErrorRef.current?.({
              failedCount,
              kind: 'remote-download',
              totalCount,
            })
          }
        },
      })
    },
    tabBehavior: 'prefer-indent',
    _tiptapOptions: { injectNonce: RUNTIME_STYLE_NONCE },
    extensions: [
      createRichEditorTransformErrorRecoveryExtension(),
      createImeCompositionKeyGuardExtension(),
      createRichEditorCodeBlockArrowNavigationExtension(),
      createRichEditorEmptyListNavigationExtension(),
      createRichEditorCodeBlockTabExtension(),
      createRichEditorListTabExtension(),
      createRichEditorCodeBlockShortcutExtension(),
      createMarkdownHighlightShortcutExtension(),
      createTodoBlockShortcutExtension(),
      createRichEditorMarkdownInputTransformExtension(),
      createRichEditorTextDirectionExtension(),
      createRichEditorBlockSelectionExtension(),
    ],
  })
  installRichEditorMarkdownSerializer(editor)
  useEffect(() => {
    installRichEditorDispatchPerformanceProbe(editor, () => activeTabPathRef.current)
  }, [editor])
  useFilenameAutolinkGuard(editor)
  const activeTab = tabs.find((t) => t.entry.path === activeTabPath) ?? null
  const {
        rawMode,
        handleToggleRaw,
        rawLatestContentRef,
        pendingRawExitContent,
        setPendingRawExitContent,
        rawModeContentOverride,
      } = useRawModeWithFlush(
        editor,
        activeTabPath,
        activeTab?.content ?? null,
        onContentChange,
        vaultPath,
        flushPendingEditorChangeRef,
        editorModeControl,
        onModeError,
      )
      const rawModeContent = resolveRawModeContent({
        activeTab,
        rawModeContentOverride,
      })

      useEffect(() => {
        setPendingRawExitContent((current) =>
          resolvePendingRawExitContent({
          activeTabPath,
          tabs,
          pendingRawExitContent: current,
          }),
        )
      }, [activeTabPath, setPendingRawExitContent, tabs])

      const { activeTabIsSheet, richEditorActiveTabPath, tabsForEditorSwap } = useRichEditorSheetSwapState({
        activeTab,
        activeTabPath,
        tabs,
        pendingRawExitContent,
      })

      // What the editor last sent to the save queue and the queue's own receipt for it.
      const handedRef = useRef<{ path: string; content: string; receipt: ContentReceipt | null } | null>(null)
      const trackedContentChange = useCallback((path: string, content: string) => {
        handedRef.current = { path, content, receipt: onContentChange?.(path, content) || null }
      }, [onContentChange])
      const { editorContentPath, handleEditorChange, flushPendingEditorChange, hasPendingEditorChange, editorMountedRef, documentSessionRef } = useEditorTabSwap({
        tabs: tabsForEditorSwap,
        activeTabPath: richEditorActiveTabPath,
        editor,
        onContentChange: trackedContentChange,
        rawMode,
        vaultPath,
      })
      const richEditorContentReady = useRichEditorContentReadiness({
        activeTab,
        activeTabIsSheet,
        editorContentPath,
      })
      useEffect(() => {
        if (richEditorContentReady) markStartupPhase('editor_interactive')
      }, [richEditorContentReady])
      useEffect(() => {
        flushPendingEditorChangeRef.current = flushPendingEditorChange
        return () => {
          if (flushPendingEditorChangeRef.current === flushPendingEditorChange) {
            flushPendingEditorChangeRef.current = null
          }
        }
      }, [flushPendingEditorChange])
      // Raw, diff and preview views unmount the rich canvas; the focus endpoint refuses those.
      const readyPath = richEditorContentReady && !rawMode && !activeTabIsSheet && editorContentPath === activeTabPath
        ? activeTabPath
        : null
      const takeDraft = useCallback((text: string): ContentReceipt => {
        if (!onContentChange || !readyPath) throw new Error('This page has no save queue')
        handedRef.current = null
        insertDraftAtEnd(editor, text)
        handleEditorChange()
        flushPendingEditorChange()
        const handed = handedRef.current as { path: string; content: string; receipt: ContentReceipt | null } | null
        // Only the queue's receipt for this page and exactly the document just sent counts.
        if (!handed?.receipt || handed.path !== readyPath || handed.receipt.content !== handed.content) {
          throw new Error('The save queue did not take the draft')
        }
        return handed.receipt
      }, [editor, flushPendingEditorChange, handleEditorChange, onContentChange, readyPath])
      useEditorFocus(editor, editorMountedRef, activeTabPath, readyPath, takeDraft)

      const { diffMode, diffContent, diffLoading, handleToggleDiff, handleViewCommitDiff } = useDiffMode({
        activeTabPath,
        onLoadDiff,
        onLoadDiffAtCommit,
        pendingCommitDiffRequest,
        onPendingCommitDiffHandled,
      })

      const { handleToggleDiffExclusive, handleToggleRawExclusive } = useEditorModeExclusion({
        diffMode,
        rawMode,
        handleToggleDiff,
        handleToggleRaw,
        rawToggleRef,
        diffToggleRef,
      })

      const isLoadingNewTab = activeTabPath !== null && !activeTab
      const activeStatus = activeTab ? (getNoteStatus?.(activeTab.entry.path) ?? 'clean') : 'clean'
      const showDiffToggle = !!(activeTab && (diffMode || activeStatus === 'modified'))

      return {
        editor,
        activeTab,
        rawLatestContentRef,
        rawModeContent,
        rawMode,
        diffMode,
        diffContent,
        diffLoading,
        handleToggleDiffExclusive,
        handleToggleRawExclusive,
        handleEditorChange,
        flushPendingEditorChange,
        hasPendingEditorChange,
        handleViewCommitDiff,
        isLoadingNewTab,
        activeStatus,
        showDiffToggle,
        sheetFlushRef,
        richEditorContentReady,
        editorDocumentSessionRef: documentSessionRef,
      }
    }

    function useEditorFindCommand({
      activeTab,
      findInNoteRef,
      handleToggleRawExclusive,
      rawMode,
    }: {
      activeTab: Tab | null
      findInNoteRef?: EditorProps['findInNoteRef']
      handleToggleRawExclusive: () => void
      rawMode: boolean
    }): RawEditorFindRequest | null {
      const [findRequest, setFindRequest] = useState<RawEditorFindRequest | null>(null)
      const handleFindInNote = useCallback(
        (options: { replace?: boolean } = {}) => {
        if (!activeTab || activeTab.entry.fileKind === 'binary') return
        if (!rawMode) handleToggleRawExclusive()

        setFindRequest((current) => ({
          id: (current?.id ?? 0) + 1,
          path: activeTab.entry.path,
          replace: options.replace === true,
        }))
        },
        [activeTab, handleToggleRawExclusive, rawMode],
      )

      useEffect(() => {
        if (!findInNoteRef) return

        findInNoteRef.current = handleFindInNote
        return () => {
          if (findInNoteRef.current === handleFindInNote) {
            findInNoteRef.current = null
          }
        }
      }, [findInNoteRef, handleFindInNote])

      return findRequest
    }

    function EditorLayout(options: {
      editorModeControl?: PaneEditorModeControl
      tabs: Tab[]
      activeTabPath: string | null
      activeTab: Tab | null
      isLoadingNewTab: boolean
      isVaultLoading?: boolean
      entries: VaultEntry[]
      editor: ReturnType<typeof useCreateBlockNote>
      diffMode: boolean
      diffContent: string | null
      diffLoading: boolean
      richEditorContentReady: boolean
      editorDocumentSessionRef: React.RefObject<number>
      handleToggleDiffExclusive: () => void | Promise<void>
      rawMode: boolean
      handleToggleRawExclusive: () => void
      onContentChange?: (path: string, content: string) => ContentReceipt | null | void
      onSave?: () => void
      activeStatus: NoteStatus
      showDiffToggle: boolean
      showAIChat?: boolean
      onToggleAIChat?: () => void
      aiWorkspaceSurface?: ReactNode
      showTableOfContents?: boolean
      onToggleTableOfContents?: () => void
      inspectorCollapsed: boolean
      onToggleInspector: () => void
      onNavigateWikilink: (target: string) => void
      onOpenEntry?: (entry: VaultEntry) => Promise<boolean>
      revealBacklinks?: boolean
      onBacklinksRevealed?: () => void
      backlinksEmptyLabel?: string
      handleEditorChange: () => void
      onToggleFavorite?: (path: string) => void
      onToggleOrganized?: (path: string) => void
      onEnterNeighborhood?: (entry: VaultEntry) => void
      onRevealFile?: (path: string) => void
      onCopyFilePath?: (path: string) => void
      onCopyDeepLink?: (entry: VaultEntry) => void
      onCopyGitUrl?: (entry: VaultEntry) => void
      onOpenExternalFile?: (path: string) => void
      onDeleteNote?: (path: string) => void
      onArchiveNote?: (path: string) => void
      onUnarchiveNote?: (path: string) => void
      vaultPath?: string
      vaultPaths?: string[]
      rawModeContent: string | null
      findRequest?: RawEditorFindRequest | null
      rawLatestContentRef: React.MutableRefObject<string | null>
      sheetFlushRef: React.MutableRefObject<((path: string) => void) | null>
      onRenameFilename?: (path: string, newFilenameStem: string) => void
      noteWidth?: NoteWidthMode
      onToggleNoteWidth?: () => void
      isConflicted?: boolean
      onKeepMine?: (path: string) => void
      onKeepTheirs?: (path: string) => void
      onInspectorResize: (delta: number) => void
      inspectorWidth: number
      inspectorOverlay?: boolean
      defaultAiAgent: AiAgentId
      defaultAiTarget?: AiTarget
      defaultAiAgentReadiness?: AiAgentReadiness
      defaultAiAgentReady: boolean
      inspectorEntry: VaultEntry | null
      inspectorContent: string | null
      gitHistory: GitCommit[]
      noteList?: NoteListItem[]
      noteListFilter?: { type: string | null; query: string }
      handleViewCommitDiff: (commitHash: string) => Promise<void>
      onUpdateFrontmatter?: (
        path: string,
        key: string,
        value: FrontmatterValue,
        options?: FrontmatterOpOptions,
      ) => Promise<void>
      onDeleteProperty?: (path: string, key: string, options?: FrontmatterOpOptions) => Promise<void>
      onAddProperty?: (path: string, key: string, value: FrontmatterValue, options?: FrontmatterOpOptions) => Promise<void>
      onCreateMissingType?: (path: string, missingType: string, nextTypeName: string) => Promise<boolean | undefined>
      onCreateAndOpenNote?: (title: string) => Promise<boolean>
      onChangeWorkspace?: (entry: VaultEntry, workspace: WorkspaceIdentity) => Promise<void> | void
      onInitializeProperties?: (path: string) => void
      onFileCreated?: (relativePath: string) => void
      onFileModified?: (relativePath: string) => void
      onVaultChanged?: () => void
      workspaces?: WorkspaceIdentity[]
      onUnsupportedAiPaste?: (message: string) => void
      onImageImportError?: ImageImportErrorHandler
      locale?: AppLocale
      onExportPdf?: (source?: NotePdfExportSource) => void
    }) {
      const {
      tabs,
      activeTabPath,
      activeTab,
      isLoadingNewTab,
      isVaultLoading,
      entries,
      editor,
      diffMode,
      diffContent,
      diffLoading,
      richEditorContentReady,
      editorDocumentSessionRef,
      handleToggleDiffExclusive,
      rawMode,
      handleToggleRawExclusive,
      onContentChange,
      onSave,
      activeStatus,
      showDiffToggle,
      showAIChat,
      onToggleAIChat,
      aiWorkspaceSurface,
      showTableOfContents,
      onToggleTableOfContents,
      inspectorCollapsed,
      onToggleInspector,
      onNavigateWikilink,
      onOpenEntry,
      revealBacklinks,
      onBacklinksRevealed,
      backlinksEmptyLabel,
      handleEditorChange,
      onToggleFavorite,
      onToggleOrganized,
      onEnterNeighborhood,
      onRevealFile,
      onCopyFilePath,
      onCopyDeepLink,
      onCopyGitUrl,
      onExportPdf,
      onOpenExternalFile,
      onDeleteNote,
      onArchiveNote,
      onUnarchiveNote,
      vaultPath,
      vaultPaths,
      rawModeContent,
      findRequest,
      rawLatestContentRef,
      sheetFlushRef,
      onRenameFilename,
      noteWidth,
      onToggleNoteWidth,
      isConflicted,
      onKeepMine,
      onKeepTheirs,
      onInspectorResize,
      inspectorWidth,
      inspectorOverlay,
      defaultAiAgent,
      defaultAiTarget,
      defaultAiAgentReadiness,
      defaultAiAgentReady,
      inspectorEntry,
      inspectorContent,
      gitHistory,
      noteList,
      noteListFilter,
      handleViewCommitDiff,
      onUpdateFrontmatter,
      onDeleteProperty,
      onAddProperty,
      onCreateMissingType,
      onCreateAndOpenNote,
      onChangeWorkspace,
      onInitializeProperties,
      onFileCreated,
      onFileModified,
      onVaultChanged,
      workspaces,
      onUnsupportedAiPaste,
      onImageImportError,
      locale,
  } = options
  const activeBinaryTab = activeTab?.entry.fileKind === 'binary' ? activeTab : null
  const showEmptyState = tabs.length === 0 && activeTabPath === null && !isVaultLoading

  return (
    <div className="editor flex flex-col min-h-0 overflow-hidden bg-background text-foreground">
      <div className="relative flex flex-1 min-h-0">
        {showEmptyState ? (
          <EditorEmptyState locale={locale} />
        ) : activeBinaryTab ? (
                <FilePreview
                  key={activeBinaryTab.entry.path}
                  entry={activeBinaryTab.entry}
                  locale={locale}
                  onCopyFilePath={onCopyFilePath}
                  onCopyDeepLink={onCopyDeepLink}
                  onOpenExternalFile={onOpenExternalFile}
                  onRevealFile={onRevealFile}
                />
        ) : (
          <EditorContent
              editorModeControl={options.editorModeControl}
              activeTab={activeTab}
              activeTabPath={activeTabPath}
              isLoadingNewTab={isLoadingNewTab}
              isVaultLoading={isVaultLoading}
              entries={entries}
              editor={editor}
              diffMode={diffMode}
              diffContent={diffContent}
              diffLoading={diffLoading}
              richEditorContentReady={richEditorContentReady}
              editorDocumentSessionRef={editorDocumentSessionRef}
              onToggleDiff={handleToggleDiffExclusive}
              rawMode={rawMode}
              onToggleRaw={handleToggleRawExclusive}
              onRawContentChange={onContentChange}
              onSave={onSave}
              activeStatus={activeStatus}
              showDiffToggle={showDiffToggle}
              showAIChat={showAIChat}
              onToggleAIChat={onToggleAIChat}
              showTableOfContents={showTableOfContents}
              onToggleTableOfContents={onToggleTableOfContents}
              inspectorCollapsed={inspectorCollapsed}
              onToggleInspector={onToggleInspector}
              onNavigateWikilink={onNavigateWikilink}
              onEditorChange={handleEditorChange}
              onToggleFavorite={onToggleFavorite}
              onToggleOrganized={onToggleOrganized}
              onEnterNeighborhood={onEnterNeighborhood}
              onRevealFile={onRevealFile}
              onCopyFilePath={onCopyFilePath}
              onCopyDeepLink={onCopyDeepLink}
              onCopyGitUrl={onCopyGitUrl}
              onExportPdf={() => onExportPdf?.('breadcrumb')}
              onDeleteNote={onDeleteNote}
              onArchiveNote={onArchiveNote}
              onUnarchiveNote={onUnarchiveNote}
              vaultPath={vaultPath}
              rawModeContent={rawModeContent}
              findRequest={findRequest}
              rawLatestContentRef={rawLatestContentRef}
              sheetFlushRef={sheetFlushRef}
              onRenameFilename={onRenameFilename}
              noteWidth={noteWidth}
              onToggleNoteWidth={onToggleNoteWidth}
              isConflicted={isConflicted}
              onKeepMine={onKeepMine}
              onKeepTheirs={onKeepTheirs}
              onImageImportError={onImageImportError}
              locale={locale}
            />
        )}
        {(showTableOfContents || !inspectorCollapsed) && (
          // Hidden, not unmounted, while floating: a drag that crosses into floating still ends cleanly.
          <div className={inspectorOverlay && !inspectorCollapsed ? 'hidden' : 'contents'}><ResizeHandle onResize={onInspectorResize} /></div>
        )}
        <EditorRightPanel
          showAIChat={false}
          showTableOfContents={showTableOfContents}
          inspectorCollapsed={inspectorCollapsed}
          inspectorWidth={inspectorWidth}
          inspectorOverlay={inspectorOverlay}
          editor={editor}
          defaultAiAgent={defaultAiAgent}
          defaultAiTarget={defaultAiTarget}
          defaultAiAgentReadiness={defaultAiAgentReadiness}
          defaultAiAgentReady={defaultAiAgentReady}
          onUnsupportedAiPaste={onUnsupportedAiPaste}
          inspectorEntry={inspectorEntry}
          inspectorContent={inspectorContent}
          entries={entries}
          gitHistory={gitHistory}
          vaultPath={vaultPath ?? ''}
          vaultPaths={vaultPaths}
          noteList={noteList}
          noteListFilter={noteListFilter}
          onToggleInspector={onToggleInspector}
          onToggleAIChat={onToggleAIChat}
          onToggleTableOfContents={onToggleTableOfContents}
          onNavigateWikilink={onNavigateWikilink}
          onOpenEntry={onOpenEntry}
          revealBacklinks={revealBacklinks}
          onBacklinksRevealed={onBacklinksRevealed}
          backlinksEmptyLabel={backlinksEmptyLabel}
          onViewCommitDiff={handleViewCommitDiff}
          onUpdateFrontmatter={onUpdateFrontmatter}
          onDeleteProperty={onDeleteProperty}
          onAddProperty={onAddProperty}
          onCreateMissingType={onCreateMissingType}
          onCreateAndOpenNote={onCreateAndOpenNote}
          onChangeWorkspace={onChangeWorkspace}
          onInitializeProperties={onInitializeProperties}
          onToggleRawEditor={handleToggleRawExclusive}
          onOpenNote={onNavigateWikilink}
          onFileCreated={onFileCreated}
          onFileModified={onFileModified}
          onVaultChanged={onVaultChanged}
          workspaces={workspaces}
          locale={locale}
        />
        {showAIChat && aiWorkspaceSurface}
      </div>
      <EditorMemoryProbe entries={entries} vaultPath={vaultPath} locale={locale} />
    </div>
  )
}

type EditorRuntime = ReturnType<typeof useEditorSetup>
type EditorLayoutProps = Parameters<typeof EditorLayout>[0]

function buildEditorLayoutProps(
  props: EditorProps,
  runtime: EditorRuntime,
  findRequest: RawEditorFindRequest | null,
): EditorLayoutProps {
  return {
    ...props,
    ...runtime,
    activeTabPath: props.activeTabPath,
    defaultAiAgent: props.defaultAiAgent ?? DEFAULT_AI_AGENT,
    defaultAiAgentReady: props.defaultAiAgentReady ?? true,
    findRequest,
  }
}

export const Editor = memo(function Editor(props: EditorProps) {
  const { locale, onToast } = props
  const handleImageImportError = useCallback(
    (error: ImageImportError) => {
    onToast?.(imageImportErrorMessage(error, locale))
    },
    [locale, onToast],
  )
  const runtime = useEditorSetup({
    tabs: props.tabs,
    activeTabPath: props.activeTabPath,
    vaultPath: props.vaultPath,
    onContentChange: props.onContentChange,
    onLoadDiff: props.onLoadDiff,
    onLoadDiffAtCommit: props.onLoadDiffAtCommit,
    pendingCommitDiffRequest: props.pendingCommitDiffRequest,
    onPendingCommitDiffHandled: props.onPendingCommitDiffHandled,
    getNoteStatus: props.getNoteStatus,
    editorModeControl: props.editorModeControl,
    onModeError: error => props.onToast?.(String(error)),
    rawToggleRef: props.rawToggleRef,
    diffToggleRef: props.diffToggleRef,
    onImageImportError: handleImageImportError,
  })
  const findRequest = useEditorFindCommand({
    activeTab: runtime.activeTab,
    findInNoteRef: props.findInNoteRef,
    handleToggleRawExclusive: runtime.handleToggleRawExclusive,
    rawMode: runtime.rawMode,
  })
  useTurnCurrentBlockIntoCommand({
    activeTab: runtime.activeTab,
    diffMode: runtime.diffMode,
    editor: runtime.editor,
    rawMode: runtime.rawMode,
    turnCurrentBlockIntoRef: props.turnCurrentBlockIntoRef,
  })
  const handleExportPdf = useEditorPdfExport({
    activeTab: runtime.activeTab,
    diffMode: runtime.diffMode,
    handleToggleDiffExclusive: runtime.handleToggleDiffExclusive,
    handleToggleRawExclusive: runtime.handleToggleRawExclusive,
    locale: props.locale,
    onToast: props.onToast,
    pdfExportRef: props.pdfExportRef,
    rawMode: runtime.rawMode,
  })
  useRegisterEditorContentFlushes({
    activeTab: runtime.activeTab,
    flushPendingEditorChange: runtime.flushPendingEditorChange,
    flushPendingEditorContentRef: props.flushPendingEditorContentRef,
    sheetFlushRef: runtime.sheetFlushRef,
    rawLatestContentRef: runtime.rawLatestContentRef,
    rawMode: runtime.rawMode,
    onContentChange: props.onContentChange,
    flushPendingRawContentRef: props.flushPendingRawContentRef,
    hasPendingEditorChange: runtime.hasPendingEditorChange,
    editorIdleRef: props.editorIdleRef,
  })
  const rightPanel = useRightPanelExclusion(props)
  const { tableOfContentsToggleRef } = props
  useEffect(() => {
    if (tableOfContentsToggleRef) {
      tableOfContentsToggleRef.current = rightPanel.handleToggleTableOfContents
    }
  }, [tableOfContentsToggleRef, rightPanel.handleToggleTableOfContents])

  return (
    <EditorLayout
      {...buildEditorLayoutProps(props, runtime, findRequest)}
      onImageImportError={handleImageImportError}
      onToggleInspector={rightPanel.handleToggleInspectorPanel}
      showAIChat={props.showAIChat}
      onToggleAIChat={props.onToggleAIChat ? rightPanel.handleToggleAIChatPanel : undefined}
      showTableOfContents={rightPanel.showTableOfContents}
      onToggleTableOfContents={rightPanel.handleToggleTableOfContents}
      onExportPdf={handleExportPdf}
    />
  )
})
