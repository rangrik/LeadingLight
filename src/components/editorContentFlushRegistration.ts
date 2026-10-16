import { useCallback, useEffect } from 'react'
import type React from 'react'
import { noteDisplaysAsSheet } from '../utils/noteFormat'

type RawBufferRef = React.MutableRefObject<string | null>

// The raw editor's own timer, keyed by its buffer ref, so a flush here can stop it.
const rawTimerStops = new WeakMap<RawBufferRef, (handedOver: string) => void>()

/** After this flush hands text over, a late timer would send it again and undo newer settles. */
export function registerRawTimerStop(ref: RawBufferRef, stop: (handedOver: string) => void) {
  rawTimerStops.set(ref, stop)
  return () => {
    if (rawTimerStops.get(ref) === stop) rawTimerStops.delete(ref)
  }
}

type Tab = {
  entry: { path: string; display?: unknown; fileKind?: string | null }
  content: string
}

/** True when none of the editor's buffers for `path` holds text other than `content`. */
export type EditorIdleCheck = (path: string, content: string) => boolean

export function useRegisterEditorContentFlushes(options: {
  activeTab: Tab | null
  flushPendingEditorChange: () => boolean
  flushPendingEditorContentRef?: React.MutableRefObject<((path: string) => void) | null>
  sheetFlushRef?: React.MutableRefObject<((path: string) => void) | null>
  rawLatestContentRef: React.MutableRefObject<string | null>
  rawMode: boolean
  onContentChange?: (path: string, content: string) => void
  flushPendingRawContentRef?: React.MutableRefObject<((path: string) => void) | null>
  hasPendingEditorChange?: () => boolean
  editorIdleRef?: React.MutableRefObject<EditorIdleCheck | null>
}) {
  const {
    activeTab,
    flushPendingEditorChange,
    flushPendingEditorContentRef,
    sheetFlushRef,
    rawLatestContentRef,
    rawMode,
    onContentChange,
    flushPendingRawContentRef,
    hasPendingEditorChange,
    editorIdleRef,
  } = options
  useRegisterRichContentFlush({
    activeTab,
    flushPendingEditorChange,
    flushPendingEditorContentRef,
    sheetFlushRef,
  })
  useRegisterRawContentFlush({
    activeTab,
    rawLatestContentRef,
    rawMode,
    onContentChange,
    flushPendingRawContentRef,
  })
  // A final recovery choice asks this after flushing; newer words make it refuse, never drop them.
  const isIdle = useCallback<EditorIdleCheck>((path, content) => {
    if (!activeTab || activeTab.entry.path !== path) return true
    if (hasPendingEditorChange?.()) return false
    const raw = rawLatestContentRef.current
    return !rawMode || raw === null || raw === content
  }, [activeTab, hasPendingEditorChange, rawLatestContentRef, rawMode])
  useRegisteredFlushRef(editorIdleRef, isIdle)
}

function useRegisterRichContentFlush({
  activeTab,
  flushPendingEditorChange,
  flushPendingEditorContentRef,
  sheetFlushRef,
}: {
  activeTab: Tab | null
  flushPendingEditorChange: () => boolean
  flushPendingEditorContentRef?: React.MutableRefObject<((path: string) => void) | null>
  sheetFlushRef?: React.MutableRefObject<((path: string) => void) | null>
}) {
  const flushPendingEditorContent = useCallback(
    (path: string) => {
    if (!activeTab || activeTab.entry.path !== path) return
      if (
        noteDisplaysAsSheet({
      content: activeTab.content,
      display: activeTab.entry.display,
      fileKind: activeTab.entry.fileKind,
        })
      ) {
      sheetFlushRef?.current?.(path)
      return
    }
    flushPendingEditorChange()
    },
    [activeTab, flushPendingEditorChange, sheetFlushRef],
  )

  useRegisteredFlushRef(flushPendingEditorContentRef, flushPendingEditorContent)
}

function useRegisterRawContentFlush({
  activeTab,
  rawLatestContentRef,
  rawMode,
  onContentChange,
  flushPendingRawContentRef,
}: {
  activeTab: Tab | null
  rawLatestContentRef: React.MutableRefObject<string | null>
  rawMode: boolean
  onContentChange?: (path: string, content: string) => void
  flushPendingRawContentRef?: React.MutableRefObject<((path: string) => void) | null>
}) {
  const flushPendingRawContent = useCallback(
    (path: string) => {
    if (!rawMode || !activeTab || activeTab.entry.path !== path) return

    const latestContent = rawLatestContentRef.current
    if (latestContent === null || latestContent === activeTab.content) return

    onContentChange?.(path, latestContent)
    rawTimerStops.get(rawLatestContentRef)?.(latestContent)
    },
    [activeTab, onContentChange, rawLatestContentRef, rawMode],
  )

  useRegisteredFlushRef(flushPendingRawContentRef, flushPendingRawContent)
}

function useRegisteredFlushRef<T>(
  ref: React.MutableRefObject<T | null> | undefined,
  flush: T,
) {
  useEffect(() => {
    if (!ref) return

    ref.current = flush
    return () => {
      if (ref.current === flush) ref.current = null
    }
  }, [flush, ref])
}
