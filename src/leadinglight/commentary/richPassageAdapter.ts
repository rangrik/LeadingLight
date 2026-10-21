// The rich editor's side of passage capture. Reads a ProseMirror selection as the visible text the
// person saw, with bounded visible context on each side. Placing it in the shared projection is the
// domain's `anchorObservedPassage`; no ProseMirror position or block id is ever kept, since they are
// coordinates of one editor instance only.
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { ObservedPassage } from './commentaryContract'
import type { PaneSelection } from './commentaryContext'
import { PROJECTION_OBJECT, wikilinkText } from './passageProjection'

/** Visible characters kept on each side of a rich selection; the domain bounds what is stored. */
export const RICH_CONTEXT_CHARS = 256

const BLOCK_SEPARATOR = '\n'

/**
 * What a leaf shows as text under projection v1 (domain contract, amendment 1): a hard break is two
 * line breaks (BlockNote writes `<br>` and a line end), a wikilink its label or else its target,
 * inline math its `$source$`, any other leaf one object mark.
 */
export function richLeafText(node: ProseMirrorNode): string {
  switch (node.type.name) {
    case 'hardBreak':
      return '\n\n'
    case 'wikilink':
      return wikilinkText(String(node.attrs.target ?? ''))
    case 'mathInline':
      return `$${String(node.attrs.latex ?? '')}$`
    default:
      return PROJECTION_OBJECT
  }
}

const visibleText = (doc: ProseMirrorNode, from: number, to: number) => doc.textBetween(from, to, BLOCK_SEPARATOR, richLeafText)

interface SelectionLike { readonly from: number; readonly to: number; readonly empty: boolean }

/** The selection as visible text with its context, or null when nothing visible is selected. */
export function readRichSelection(doc: ProseMirrorNode, selection: SelectionLike): Extract<PaneSelection, { mode: 'rich' }> | null {
  if (selection.empty || selection.from >= selection.to) return null
  const text = visibleText(doc, selection.from, selection.to)
  if (text.trim() === '') return null
  const end = doc.content.size
  return {
    mode: 'rich',
    text,
    before: visibleText(doc, Math.max(0, selection.from - RICH_CONTEXT_CHARS), selection.from).slice(-RICH_CONTEXT_CHARS),
    after: visibleText(doc, selection.to, Math.min(end, selection.to + RICH_CONTEXT_CHARS)).slice(0, RICH_CONTEXT_CHARS),
  }
}

/** The observation the domain anchors; the quote is exactly what was selected, never trimmed. */
export function observedPassage(selection: Extract<PaneSelection, { mode: 'rich' }>): ObservedPassage {
  return { before: selection.before, exact: selection.text, after: selection.after }
}
