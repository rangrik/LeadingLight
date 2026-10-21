// The raw editor's side of passage capture. CodeMirror positions are kept as they are (CodeMirror
// counts every line break as one position, whatever the page's own endings); the domain's
// `projectRawEditorSelection` maps them to exact note offsets and the body, so the UI converts nothing.
import type { EditorState } from '@codemirror/state'
import type { PaneSelection } from './commentaryContext'

export interface RawSelectionRead {
  /** The raw editor's whole page text, with the page's own line endings. */
  readonly markdown: string
  /** CodeMirror positions in that page. */
  readonly selection: Extract<PaneSelection, { mode: 'raw' }>
}

const editorText = (page: string) => page.replace(/\r\n?/g, '\n')

/**
 * The main selection of a raw editor over its page text. `empty` when collapsed; `unsynced` when
 * the editor and the page text it reports do not agree (a sync in flight): never a guessed position.
 */
export function readRawSelection(state: Pick<EditorState, 'doc' | 'selection'>, page: string): RawSelectionRead | 'empty' | 'unsynced' {
  const { from, to } = state.selection.main
  if (from >= to) return 'empty'
  if (editorText(page) !== state.doc.toString()) return 'unsynced'
  return { markdown: page, selection: { mode: 'raw', from, to } }
}

/** The selected text as the editor shows it, for a quick size check before anything is projected. */
export const rawSelectedText = (page: string, selection: Extract<PaneSelection, { mode: 'raw' }>) =>
  editorText(page).slice(selection.from, selection.to)

/** Synchronous reader a mounted raw editor registers under its buffer ref. */
export type RawSelectionReader = () => ReturnType<typeof readRawSelection> | null

// Keyed by the raw buffer ref the pane's Editor already owns, so no prop has to cross the layout.
const readers = new WeakMap<object, RawSelectionReader>()

export function registerRawSelectionReader(bufferRef: object, reader: RawSelectionReader): () => void {
  readers.set(bufferRef, reader)
  return () => {
    if (readers.get(bufferRef) === reader) readers.delete(bufferRef)
  }
}

export const rawSelectionReaderFor = (bufferRef: object): RawSelectionReader | null => readers.get(bufferRef) ?? null
