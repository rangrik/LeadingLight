// A pane editor's passage capture endpoint. Registered by Editor; read synchronously when the
// person asks to comment, while the editor still holds the selection. It hands pending text to the
// save queue first, so the captured page text is the text that queue saves next.
import { useCallback, useEffect, useLayoutEffect, type MutableRefObject } from 'react'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorPassageRead, PassageCaptureEndpoint } from './commentaryContext'
import { rawSelectionReaderFor } from './rawPassageAdapter'
import { readRichSelection } from './richPassageAdapter'

interface RichEditorLike {
  readonly prosemirrorState: { readonly doc: ProseMirrorNode; readonly selection: { readonly from: number; readonly to: number; readonly empty: boolean } }
  readonly isEditable: boolean
}

export interface HandedContent { path: string; content: string }

export interface CaptureEndpointOptions {
  endpointRef: MutableRefObject<PassageCaptureEndpoint | null> | undefined
  editor: RichEditorLike
  /** The pane's page as the editor's props give it. */
  activeTab: { entry: { path: string }; content: string } | null
  /** The rich canvas shows exactly this page; null while loading, swapping, raw, diff or a sheet. */
  readyPath: string | null
  rawMode: boolean
  diffMode: boolean
  documentSessionRef: MutableRefObject<number>
  hasPendingEditorChange: () => boolean
  flushPendingEditorChange: () => boolean
  /** What the rich editor last handed to the save queue. */
  handedRef: MutableRefObject<HandedContent | null>
  /** The raw editor's buffer ref, under which a mounted raw editor registers its reader. */
  rawBufferRef: object
}

const NOT_READY: EditorPassageRead = { status: 'notReady' }
const EMPTY: EditorPassageRead = { status: 'empty' }

/**
 * Text the editor last handed over is newer than a tab that has not caught up with it; a reload
 * that replaced the page since makes the tab text the newer one, so the hand-over is forgotten.
 */
export function useForgetStaleHandover(handedRef: MutableRefObject<HandedContent | null>, activeTab: CaptureEndpointOptions['activeTab']) {
  const path = activeTab?.entry.path ?? null
  const content = activeTab?.content ?? null
  useLayoutEffect(() => {
    const handed = handedRef.current
    if (handed && (handed.path !== path || handed.content !== content)) handedRef.current = null
  }, [handedRef, path, content])
}

export function usePassageCaptureEndpoint(options: CaptureEndpointOptions) {
  const { endpointRef, editor, activeTab, readyPath, rawMode, diffMode, documentSessionRef, hasPendingEditorChange, flushPendingEditorChange, handedRef, rawBufferRef } = options
  useForgetStaleHandover(handedRef, activeTab)

  const captureRich = useCallback((path: string): EditorPassageRead => {
    if (readyPath !== path || !editor.isEditable) return NOT_READY
    const state = editor.prosemirrorState
    const selection = readRichSelection(state.doc, state.selection)
    if (!selection) return EMPTY
    if (hasPendingEditorChange()) flushPendingEditorChange()
    const handed = handedRef.current
    const markdown = handed && handed.path === path ? handed.content : activeTab?.content
    if (markdown === undefined) return NOT_READY
    return { status: 'ok', passage: { path, documentSession: documentSessionRef.current, markdown, selection } }
  }, [activeTab, documentSessionRef, editor, flushPendingEditorChange, handedRef, hasPendingEditorChange, readyPath])

  const captureRaw = useCallback((path: string): EditorPassageRead => {
    const read = rawSelectionReaderFor(rawBufferRef)?.() ?? null
    if (read === null || read === 'unsynced') return NOT_READY
    if (read === 'empty') return EMPTY
    return { status: 'ok', passage: { path, documentSession: documentSessionRef.current, markdown: read.markdown, selection: read.selection } }
  }, [documentSessionRef, rawBufferRef])

  const capture = useCallback<PassageCaptureEndpoint>(() => {
    const path = activeTab?.entry.path
    if (!path || diffMode) return NOT_READY
    try {
      return rawMode ? captureRaw(path) : captureRich(path)
    } catch (error) {
      // A composition in progress or an editor between documents: nothing is captured.
      console.warn('[commentary] The selection could not be read:', error)
      return NOT_READY
    }
  }, [activeTab, captureRaw, captureRich, diffMode, rawMode])

  useEffect(() => {
    if (!endpointRef) return
    endpointRef.current = capture
    return () => {
      if (endpointRef.current === capture) endpointRef.current = null
    }
  }, [capture, endpointRef])
}
