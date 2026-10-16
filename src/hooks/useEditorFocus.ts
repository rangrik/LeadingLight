import { editorScopeForEditor, editorScopeForPath } from '../leadinglight/editorScope'
import { useEffect, useLayoutEffect } from 'react'
import { closeHistory } from '@tiptap/pm/history'
import type { Transaction } from '@tiptap/pm/state'
import { focusEditorWithRetries, type FocusableEditor } from './editorFocusUtils'
import { resumeEditorFocus } from './editorFocusOwnership'
import type { ContentReceipt } from './useEditorSave'

const TAB_SWAP_EVENT_NAME = 'laputa:editor-tab-swapped'
const FOCUS_EVENT_NAME = 'laputa:focus-editor'
const SWAP_WAIT_FALLBACK_MS = 250
const FOCUS_STABILITY_CHECK_DELAYS_MS = [160, 500, 1_000, 2_000, 4_000] as const

export interface FocusEventDetail {
  t0?: number
  selectTitle?: boolean
  path?: string | null
  /** Places the caret after the last block, ready to continue writing. */
  cursorAtEnd?: boolean
}

interface PendingFocusRequest {
  id: number
  detail: FocusEventDetail
}

const PENDING_FOCUS_TTL_MS = 6_000
let nextFocusRequestId = 0
let pendingFocusRequest: PendingFocusRequest | null = null

function rememberPendingFocusRequest(detail: FocusEventDetail): PendingFocusRequest | null {
  if (!detail.path) return null
  const request = { id: ++nextFocusRequestId, detail }
  pendingFocusRequest = request
  window.setTimeout(() => {
    if (pendingFocusRequest?.id === request.id) pendingFocusRequest = null
  }, PENDING_FOCUS_TTL_MS)
  return request
}

function clearPendingFocusRequest(path: string): void {
  if (pendingFocusRequest?.detail.path === path) pendingFocusRequest = null
}

export function requestEditorFocus(detail: FocusEventDetail): void {
  rememberPendingFocusRequest(detail)
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent(FOCUS_EVENT_NAME, { detail }))
  }, 0)
}

interface EditorFocusContext {
  editor: FocusableEditor,
  editorMountedRef: React.RefObject<boolean>,
  selectTitle: boolean,
  t0: number | undefined,
  cursorAtEnd?: boolean,
}

function scheduleEditorFocus(context: EditorFocusContext, onFocused?: () => void): void {
  const { editor, editorMountedRef, selectTitle, t0, cursorAtEnd } = context
  const focus = () => {
    focusEditorWithRetries(editor, selectTitle, t0, 0, cursorAtEnd)
    if (editorHasFocus(editor)) onFocused?.()
  }
  if (editorMountedRef.current) {
    requestAnimationFrame(focus)
    return
  }
  setTimeout(focus, 80)
}

function focusReturnedToDocumentChrome(): boolean {
  const activeElement = document.activeElement
  return activeElement === null
    || activeElement === document.body
    || activeElement === document.documentElement
}

// Only this editor's own pane counts; a focused editor in another pane must not drop the request.
function editorHasFocus(editor: FocusableEditor): boolean {
  const activeElement = document.activeElement
  return activeElement instanceof Element
    && editorScopeForEditor(editor).contains(activeElement)
    && (Reflect.get(activeElement, 'isContentEditable') === true
      || activeElement.closest('[contenteditable="true"]') !== null)
}

/**
 * `notReady`: nothing was inserted, so it may be tried again. `delivered`: the save queue holds the text
 * (`receipt`, null for an empty draft); `focused` says the page also kept the keyboard. `uncertain`: maybe inserted.
 */
export type HandOver =
  | { kind: 'notReady' }
  | { kind: 'delivered'; receipt: ContentReceipt | null; focused: boolean }
  | { kind: 'uncertain' }

export const NOT_READY: HandOver = { kind: 'notReady' }
export const UNCERTAIN: HandOver = { kind: 'uncertain' }

/** A page shown and ready right now, in a visible editor of its own pane. */
export interface ReadyPage {
  pane: () => string | null
  focus: () => boolean
  /** Takes the keyboard first, then adds the text at the end as one change the save queue confirms. */
  accept: (text: string) => HandOver
}

const readyPages = new Map<string, ReadyPage>()
const readyListeners = new Set<() => void>()

export function registerReadyPage(path: string, page: ReadyPage): () => void {
  readyPages.set(path, page)
  for (const listener of [...readyListeners]) listener()
  return () => {
    if (readyPages.get(path) === page) readyPages.delete(path)
  }
}

export function readyPageFor(path: string): ReadyPage | null {
  return readyPages.get(path) ?? null
}

export function onReadyPagesChange(listener: () => void): () => void {
  readyListeners.add(listener)
  return () => { readyListeners.delete(listener) }
}

/** Gives the keyboard now to the editor already showing this page, caret at the end; false means wait for it. */
export function tryFocusReadyPage(path: string): boolean {
  return readyPages.get(path)?.focus() ?? false
}

// A draft being written in the pending page field keeps the keyboard until it is handed over.
function pendingDraftHasKeyboard(): boolean {
  const active = document.activeElement
  return active instanceof Element && active.closest('[data-pending-capture="true"]') !== null
}

interface DraftParagraph { type: 'paragraph', content: string }
interface DraftEditor {
  document: readonly { id: string, type: string, content?: unknown, children?: readonly unknown[] }[]
  transact<T>(callback: (tr: Transaction) => T): T
  replaceBlocks(remove: string[], insert: DraftParagraph[]): { insertedBlocks: readonly { id: string }[] }
  insertBlocks(insert: DraftParagraph[], reference: string, placement: 'after'): readonly { id: string }[]
  setTextCursorPosition(block: string, placement: 'end'): void
}

/** One transaction, so one undo step; each line becomes a paragraph and the caret ends after the text. */
export function insertDraftAtEnd(editor: DraftEditor, text: string): void {
  const paragraphs = text.split(/\r\n|\r|\n/).map((line): DraftParagraph => ({ type: 'paragraph', content: line }))
  const inserted = editor.transact(tr => {
    closeHistory(tr)
    const last = editor.document.at(-1)
    const lastIsEmpty = last?.type === 'paragraph' && Array.isArray(last.content) && last.content.length === 0 && !last.children?.length
    if (!last) throw new Error('The page has no blocks')
    return lastIsEmpty ? editor.replaceBlocks([last.id], paragraphs).insertedBlocks : editor.insertBlocks(paragraphs, last.id, 'after')
  })
  const caretBlock = inserted.at(-1)?.id
  // Typing after the draft starts its own undo step.
  editor.transact(tr => {
    if (caretBlock) editor.setTextCursorPosition(caretBlock, 'end')
    closeHistory(tr)
  })
}

function placeCaretAtEnd(editor: FocusableEditor): void {
  const lastBlockId = editor.document?.at(-1)?.id
  if (typeof lastBlockId !== 'string') return
  try {
    editor.setTextCursorPosition?.(lastBlockId, 'end')
  } catch (error) {
    console.warn('[editor] Could not place the caret at the end:', error)
  }
}

// Checked at call time: a mounted view inside this page's own active pane, never a stale or other pane.
function shownHere(editor: FocusableEditor, editorMountedRef: React.RefObject<boolean>, path: string): boolean {
  const scope = editorScopeForEditor(editor)
  if (!editorMountedRef.current || !(scope instanceof HTMLElement) || scope !== editorScopeForPath(path)) return false
  return scope.dataset.paneActive === 'true'
}

function focusReadyPage(editor: FocusableEditor, editorMountedRef: React.RefObject<boolean>, path: string): boolean {
  if (!shownHere(editor, editorMountedRef, path)) return false
  resumeEditorFocus()
  editor.focus()
  if (!editorHasFocus(editor)) return false
  placeCaretAtEnd(editor)
  clearPendingFocusRequest(path)
  return true
}

interface MountedView { dom: HTMLElement; editable: boolean; focus: () => void }

function mountedView(editor: FocusableEditor): MountedView | null {
  try {
    const view = (editor as { prosemirrorView?: Partial<MountedView> }).prosemirrorView
    return view?.dom instanceof HTMLElement && view.dom.isConnected ? view as MountedView : null
  } catch {
    return null
  }
}

// BlockNote's focus() does nothing until Tiptap finishes setting up, one task after every mount,
// while the mounted view can already take the keyboard. Only real focus in this page counts.
function takeKeyboard(editor: FocusableEditor): boolean {
  const view = mountedView(editor)
  if (!view?.editable || view.dom.closest('[inert]')) return false
  resumeEditorFocus()
  view.focus()
  return editorHasFocus(editor)
}

// The keyboard moves first; the text then goes in once, and only the save queue's receipt counts.
function acceptDraft(
  editor: FocusableEditor,
  editorMountedRef: React.RefObject<boolean>,
  path: string,
  text: string,
  takeDraft?: (text: string) => ContentReceipt,
): HandOver {
  if (!shownHere(editor, editorMountedRef, path) || (text && !takeDraft)) return NOT_READY
  if (!takeKeyboard(editor)) return NOT_READY
  clearPendingFocusRequest(path)
  if (!text || !takeDraft) {
    placeCaretAtEnd(editor)
    return { kind: 'delivered', receipt: null, focused: editorHasFocus(editor) }
  }
  try {
    const receipt = takeDraft(text)
    return { kind: 'delivered', receipt, focused: editorHasFocus(editor) }
  } catch (error) {
    console.warn('[capture] The draft may be only partly in its page:', error)
    return UNCERTAIN
  }
}

function paneOf(scope: ParentNode): string | null {
  return scope instanceof HTMLElement ? scope.dataset.paneId ?? null : null
}

interface FocusStabilityOptions {
  context: EditorFocusContext
  targetPath: string
  pendingCleanups: Set<() => void>
}

function scheduleFocusStabilityChecks(options: FocusStabilityOptions): void {
  const { context, targetPath, pendingCleanups } = options
  for (const delay of FOCUS_STABILITY_CHECK_DELAYS_MS) {
    let timeoutId = 0
    const cleanup = () => {
      window.clearTimeout(timeoutId)
      pendingCleanups.delete(cleanup)
    }
    timeoutId = window.setTimeout(() => {
      pendingCleanups.delete(cleanup)
      if (editorHasFocus(context.editor)) {
        clearPendingFocusRequest(targetPath)
        return
      }
      if (!focusReturnedToDocumentChrome()) return
      resumeEditorFocus()
      focusEditorWithRetries(context.editor, context.selectTitle, context.t0)
      if (editorHasFocus(context.editor)) clearPendingFocusRequest(targetPath)
    }, delay)
    pendingCleanups.add(cleanup)
  }
}

interface TargetFocusOptions {
  context: EditorFocusContext
  detail: FocusEventDetail
  targetPath: string
  pendingCleanups: Set<() => void>
}

function handleTargetFocusRequest(options: TargetFocusOptions): void {
  const { context, detail, targetPath, pendingCleanups } = options
  if (pendingFocusRequest?.detail.path !== targetPath) rememberPendingFocusRequest(detail)
  const scheduleFocus = () => {
    if (pendingDraftHasKeyboard()) return
    if (editorHasFocus(context.editor)) {
      clearPendingFocusRequest(targetPath)
      return
    }
    resumeEditorFocus()
    scheduleEditorFocus(context, () => clearPendingFocusRequest(targetPath))
    scheduleFocusStabilityChecks({ context, targetPath, pendingCleanups })
  }
  registerPendingTabFocus(targetPath, scheduleFocus, pendingCleanups)
}

function registerPendingTabFocus(
  targetPath: string,
  scheduleFocus: () => void,
  pendingCleanups: Set<() => void>,
): void {
  const handleTabSwap = (event: Event) => {
    const swapPath = (event as CustomEvent).detail?.path
    if (swapPath !== targetPath) return
    cleanupPending()
    scheduleFocus()
  }

  const fallbackTimer = window.setTimeout(() => {
    cleanupPending()
    scheduleFocus()
  }, SWAP_WAIT_FALLBACK_MS)

  const cleanupPending = () => {
    window.clearTimeout(fallbackTimer)
    window.removeEventListener(TAB_SWAP_EVENT_NAME, handleTabSwap)
    pendingCleanups.delete(cleanupPending)
  }

  pendingCleanups.add(cleanupPending)
  window.addEventListener(TAB_SWAP_EVENT_NAME, handleTabSwap)
}

/**
 * Focus editor when a new note is created (signaled via custom event).
 * Uses adaptive timing: fast rAF path when editor is already mounted,
 * short timeout when waiting for first mount.
 * When selectTitle is true, also selects all text in the first H1 block.
 */
export function useEditorFocus(
  editor: FocusableEditor,
  editorMountedRef: React.RefObject<boolean>,
  activePath?: string | null,
  /** The page this editor shows, content ready, in its visible rich canvas. */
  readyPath?: string | null,
  /** Inserts a pending draft as one change and returns the save queue's receipt; throws when it cannot. */
  takeDraft?: (text: string) => ContentReceipt,
) {
  // Registered at commit, so an immediate command sees exactly what is on screen.
  useLayoutEffect(() => {
    if (!readyPath || readyPath !== activePath) return
    return registerReadyPage(readyPath, {
      pane: () => paneOf(editorScopeForEditor(editor)),
      focus: () => focusReadyPage(editor, editorMountedRef, readyPath),
      accept: text => acceptDraft(editor, editorMountedRef, readyPath, text, takeDraft),
    })
  }, [editor, editorMountedRef, activePath, readyPath, takeDraft])

  useEffect(() => {
    const pendingCleanups = new Set<() => void>()

    const handleFocusRequest = (detail: FocusEventDetail | undefined) => {
      if (pendingDraftHasKeyboard()) return
      if (activePath !== undefined) {
        if (detail?.path && detail.path !== activePath) return
        const scope = editorScopeForPath(activePath)
        if (scope instanceof HTMLElement && scope.dataset.paneActive !== 'true') return
      }
      const t0 = detail?.t0
      const selectTitle = detail?.selectTitle ?? false
      const targetPath = detail?.path ?? null
      const context = { editor, editorMountedRef, selectTitle, t0, cursorAtEnd: detail?.cursorAtEnd }

      if (!targetPath) {
        scheduleEditorFocus(context)
        return
      }
      handleTargetFocusRequest({ context, detail: detail ?? {}, targetPath, pendingCleanups })
    }

    const handler = (e: Event) => {
      handleFocusRequest((e as CustomEvent).detail as FocusEventDetail | undefined)
    }

    window.addEventListener(FOCUS_EVENT_NAME, handler)
    if (pendingFocusRequest) handleFocusRequest(pendingFocusRequest.detail)
    return () => {
      window.removeEventListener(FOCUS_EVENT_NAME, handler)
      for (const cleanup of pendingCleanups) {
        cleanup()
      }
      pendingCleanups.clear()
    }
  }, [editor, editorMountedRef, activePath])
}
