// Pane-scoped passage capture: what a pane's editor reads at the person's request, before focus
// moves, and the per-pane action the rich toolbar offers. Types and a React context only.
// Nothing here is persisted: editor positions and block ids never leave the editor.
import { createContext, useContext } from 'react'
import type { VaultEntry } from '../../types'

/**
 * The selection as the editor holds it. Raw positions are CodeMirror's own (a line break is one
 * position, whatever the page's endings); a rich selection is the visible text the person saw,
 * since ProseMirror positions are not page offsets.
 */
export type PaneSelection =
  /** CodeMirror main selection positions over `EditorPassage.markdown`, from < to. */
  | { readonly mode: 'raw'; readonly from: number; readonly to: number }
  /**
   * ProseMirror selection as visible text: blocks joined by '\n', a hard break as '\n', an atom
   * by its projected text, with bounded visible context on each side for anchoring.
   */
  | { readonly mode: 'rich'; readonly text: string; readonly before: string; readonly after: string }

export interface EditorPassage {
  /** The page path exactly as the editor shows it. */
  readonly path: string
  /** The editor's document session at capture; a page swap or reload moves it on. */
  readonly documentSession: number
  /** The whole page text the editor holds, already handed to the save queue. */
  readonly markdown: string
  readonly selection: PaneSelection
}

export type EditorPassageRead =
  | { readonly status: 'ok'; readonly passage: EditorPassage }
  /** Nothing selected. */
  | { readonly status: 'empty' }
  /** Loading, swapping, a sheet, a file preview, a diff, or another page than the pane's. */
  | { readonly status: 'notReady' }

/** Registered by a pane's editor. Synchronous: it never awaits and never changes the document. */
export type PassageCaptureEndpoint = () => EditorPassageRead

export type PaneId = 0 | 1

/** A capture bound to the pane, page and vault visit it was taken in. */
export interface PaneCapture {
  readonly pane: PaneId
  readonly vaultPath: string
  readonly entry: VaultEntry
  readonly sourceTitle: string
  readonly passage: EditorPassage
  /** Same vault visit, and the pane still shows this page in the same document session. */
  stillCurrent(): boolean
}

export type CaptureRefusal = 'empty' | 'tooLong' | 'notReady' | 'notMarkdown'

export type PaneCaptureResult =
  | { readonly status: 'captured'; readonly capture: PaneCapture }
  | { readonly status: 'refused'; readonly reason: CaptureRefusal }

/** The rich toolbar's view of its pane: whether to offer the action, and the action itself. */
export interface CommentaryPaneAction {
  /** A capture command is on and this pane can take it now. */
  readonly available: boolean
  /** The command's own title, shown as the button text and tooltip. */
  readonly title: string
  /** Narrow pane: icon only, the title stays the label and tooltip. */
  readonly compact: boolean
  /** Captures this pane's selection now and opens the run, or reports why not. */
  comment(): void
}

export const CommentaryPaneContext = createContext<CommentaryPaneAction | null>(null)
export const useCommentaryPaneAction = () => useContext(CommentaryPaneContext)
