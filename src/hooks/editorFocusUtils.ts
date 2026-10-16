import { editorScopeForEditor } from '../leadinglight/editorScope'
import { trySelectFirstHeading } from './editorTitleSelection'
import type { TitleHeadingTextBlock } from './editorTitleHeadingText'
import { canEditorClaimFocus } from './editorFocusOwnership'

const ROOT_EDITABLE_SELECTOR = '.ProseMirror[contenteditable="true"]'
const FALLBACK_EDITABLE_SELECTOR = '.bn-editor [contenteditable="true"]'
const MAX_FOCUS_ATTEMPTS = 12
const MAX_TITLE_SELECTION_ATTEMPTS = 12

interface FocusableHeadingBlock extends TitleHeadingTextBlock {
  id?: unknown
  type?: string
  props?: { level?: number } & Record<string, unknown>
}

interface TiptapChain {
  setTextSelection: (pos: { from: number; to: number }) => TiptapChain
  run: () => void
}

export interface TiptapEditor {
  state: { doc: { descendants: (cb: (node: { type: { name: string }; nodeSize: number }, pos: number) => boolean | undefined) => void } }
  chain: () => TiptapChain
}

export interface FocusableEditor {
  prosemirrorView?: { dom?: HTMLElement }
  focus: () => void
  _tiptapEditor?: TiptapEditor
  document?: FocusableHeadingBlock[]
  setTextCursorPosition?: (targetBlock: string, placement?: 'start' | 'end') => void
}

function hasEditableFocus(editor: FocusableEditor): boolean {
  const scope = editorScopeForEditor(editor)
  const activeElement = document.activeElement
  return activeElement instanceof Element
    && scope.contains(activeElement)
    && (Reflect.get(activeElement, 'isContentEditable') === true || activeElement.closest('[contenteditable="true"]') !== null)
}

function canFocusWindow(): boolean {
  return !navigator.userAgent.toLowerCase().includes('jsdom')
}

function focusEditableCandidate(editable: HTMLElement, editor: FocusableEditor): boolean {
  if (canFocusWindow()) {
    window.focus?.()
  }
  editable.focus()

  if (hasEditableFocus(editor)) return true

  const selection = window.getSelection()
  if (selection && editable.isContentEditable) {
    const range = document.createRange()
    range.selectNodeContents(editable)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    editable.focus()
  }

  return hasEditableFocus(editor)
}

function focusEditableNode(editor: FocusableEditor): boolean {
  const scope = editorScopeForEditor(editor)
  const rootEditable = scope.querySelector<HTMLElement>(ROOT_EDITABLE_SELECTOR)
  if (rootEditable && focusEditableCandidate(rootEditable, editor)) {
    return true
  }

  const fallbackEditable = scope.querySelector<HTMLElement>(FALLBACK_EDITABLE_SELECTOR)
  if (fallbackEditable && focusEditableCandidate(fallbackEditable, editor)) {
    return true
  }

  return false
}

function ensureEditableFocus(editor: FocusableEditor): boolean {
  if (hasEditableFocus(editor)) return true
  focusEditableNode(editor)
  return hasEditableFocus(editor)
}

function logFocusTiming(t0: number | undefined, label: 'focus' | 'focus+select'): void {
  if (!t0) return
  console.debug(`[perf] createNote → ${label}: ${(performance.now() - t0).toFixed(1)}ms`)
}

function selectTitleWithRetries(
  editor: FocusableEditor,
  t0: number | undefined,
  attempt = 0,
): void {
  const selectedHeading = ensureEditableFocus(editor) && trySelectFirstHeading(editor)

  if (selectedHeading || attempt >= MAX_TITLE_SELECTION_ATTEMPTS) {
    logFocusTiming(t0, 'focus+select')
    return
  }

  requestAnimationFrame(() => selectTitleWithRetries(editor, t0, attempt + 1))
}

function placeCursorAtEnd(editor: FocusableEditor): void {
  const lastBlockId = editor.document?.at(-1)?.id
  if (typeof lastBlockId !== 'string') return
  try {
    editor.setTextCursorPosition?.(lastBlockId, 'end')
  } catch (error) {
    console.warn('[editor] Could not place the caret at the end:', error)
  }
}

export function focusEditorWithRetries(
  editor: FocusableEditor,
  selectTitle: boolean,
  t0: number | undefined,
  attempt = 0,
  cursorAtEnd = false,
): void {
  const scope = editorScopeForEditor(editor)
  if (scope instanceof HTMLElement && scope.dataset.paneActive === 'false') return
  if (!canEditorClaimFocus()) return
  editor.focus()
  const hasFocus = ensureEditableFocus(editor)
  if (!hasFocus && attempt < MAX_FOCUS_ATTEMPTS) {
    requestAnimationFrame(() => focusEditorWithRetries(editor, selectTitle, t0, attempt + 1, cursorAtEnd))
    return
  }
  if (hasFocus && cursorAtEnd) placeCursorAtEnd(editor)
  if (!selectTitle) {
    logFocusTiming(t0, 'focus')
    return
  }
  // The first heading can arrive a frame or two later than the initial focus
  // on slower CI and native tab-swap paths, so keep retrying until it exists.
  requestAnimationFrame(() => selectTitleWithRetries(editor, t0))
}
