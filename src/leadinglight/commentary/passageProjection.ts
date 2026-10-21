// Projection `leadinglight-text-v1`: the visible text of a note body, shared by the rich and raw
// editors, with a map back to the body for raw selections. Pure and deterministic. Structure comes
// from the CommonMark + GFM parser the raw editor already uses (lezer, via @codemirror/lang-markdown);
// the app's own constructs (wikilinks, callouts, durable blocks, blank paragraphs) follow the rich
// editor's preprocessing rules. Rules: docs/leadinglight/commentary-format.md.
import { markdownLanguage } from '@codemirror/lang-markdown'
import { advanceMarkdownFence, type MarkdownFence } from '../../utils/markdownFences'
import { splitFrontmatter } from '../../utils/wikilinks'
import {
  PASSAGE_PROJECTION, type PassageProjection, type ProjectionSegment, type SourceRangeMapping,
} from './commentaryContract'

/** Stands for an image, diagram, embedded HTML, math block or divider: one character, never text. */
export const PROJECTION_OBJECT = '￼'

type MarkdownParser = typeof markdownLanguage.parser
type MarkdownTree = ReturnType<MarkdownParser['parse']>
export type MarkdownNode = MarkdownTree['topNode']
interface ConfigurableParser { configure(spec: { remove: readonly string[] }): MarkdownParser }

let configuredParser: MarkdownParser | null = null
/** GFM as the rich renderer reads it: no subscript, superscript or emoji shortcodes. */
function markdownParser(): MarkdownParser {
  configuredParser ??= (markdownLanguage.parser as unknown as ConfigurableParser)
    .configure({ remove: ['Subscript', 'Superscript', 'Emoji'] })
  return configuredParser
}

// --- The parsed body ------------------------------------------------------------------------------

function lowerBound(sorted: readonly number[], value: number): number {
  let low = 0
  let high = sorted.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (sorted[middle] < value) low = middle + 1
    else high = middle
  }
  return low
}

/**
 * A body with every line ending as `\n` (the parser reads only `\n`), its syntax tree and the way
 * back to the exact body offsets. `\r\n` collapses to one character; a lone `\r` stays one.
 */
export class MarkdownBody {
  readonly text: string
  readonly top: MarkdownNode
  /** Normalized offsets of each `\n` that was `\r\n` in the body. */
  private readonly collapsed: number[] = []
  private readonly lineStarts: number[] = [0]

  constructor(body: string) {
    this.text = body.includes('\r')
      ? body.replace(/\r\n?/gu, (ending, offset: number) => {
        if (ending.length === 2) this.collapsed.push(offset - this.collapsed.length)
        return '\n'
      })
      : body
    for (let index = this.text.indexOf('\n'); index !== -1; index = this.text.indexOf('\n', index + 1)) {
      this.lineStarts.push(index + 1)
    }
    this.top = markdownParser().parse(this.text).topNode
  }

  /** The body offset of a normalized offset. */
  original(index: number): number {
    return index + lowerBound(this.collapsed, index)
  }

  /** The normalized offset of a body offset; inside a `\r\n`, the offset of its `\n`. */
  normalized(index: number): number {
    let low = 0
    let high = this.collapsed.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (this.collapsed[middle] + middle < index) low = middle + 1
      else high = middle
    }
    return index - low
  }

  lineOf(position: number): number {
    return lowerBound(this.lineStarts, position + 1) - 1
  }

  lineStart(line: number): number {
    return this.lineStarts[line]
  }

  /** Offset of the line's `\n`, or the end of the text for the last line. */
  lineEnd(line: number): number {
    return line + 1 < this.lineStarts.length ? this.lineStarts[line + 1] - 1 : this.text.length
  }

  get lineCount(): number {
    return this.lineStarts.length
  }

  slice(from: number, to: number): string {
    return this.text.slice(from, to)
  }
}

export function childrenOf(node: MarkdownNode): MarkdownNode[] {
  const children: MarkdownNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) children.push(child)
  return children
}

// --- Pieces of one leaf block ---------------------------------------------------------------------

/**
 * `text` is plain source text, trimmed at line edges; `code` is kept exactly; `value` replaces its
 * source range (an escape, entity, wikilink or object); `break` is one line break, or for a hard
 * break the two the rich editor shows (its `<br>` plus the source line ending).
 */
type Piece =
  | { readonly kind: 'text' | 'code'; readonly from: number; readonly to: number }
  | { readonly kind: 'value'; readonly from: number; readonly to: number; readonly value: string }
  | { readonly kind: 'break'; readonly from: number; readonly to: number; readonly hard?: boolean }

const SKIPPED_INLINE = new Set([
  'EmphasisMark', 'StrikethroughMark', 'CodeMark', 'LinkMark', 'HeaderMark', 'QuoteMark', 'ListMark', 'TaskMarker',
  'LinkTitle', 'LinkLabel', 'CodeInfo', 'HTMLTag', 'Comment', 'ProcessingInstruction',
])

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', middot: '·', bull: '•', deg: '°', plusmn: '±', times: '×',
  divide: '÷', frac12: '½', frac14: '¼', frac34: '¾', euro: '€', pound: '£', yen: '¥',
  cent: '¢', sect: '§', para: '¶', shy: '­', ensp: ' ', emsp: ' ', thinsp: ' ',
  zwj: '‍', zwnj: '‌', larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔',
}

/** CommonMark's reading of a character reference; null when it names no known character. */
function decodeEntity(source: string): string | null {
  const numeric = /^&#(?:x([0-9a-f]{1,6})|(\d{1,7}));$/iu.exec(source)
  if (numeric) {
    const code = Number.parseInt(numeric[1] ?? numeric[2], numeric[1] ? 16 : 10)
    const invalid = code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
    return String.fromCodePoint(invalid ? 0xfffd : code)
  }
  const named = /^&([A-Za-z][A-Za-z0-9]*);$/u.exec(source)
  return named && Object.hasOwn(NAMED_ENTITIES, named[1]) ? NAMED_ENTITIES[named[1]] : null
}

const normalizeLabel = (label: string) => label.trim().replace(/\s+/gu, ' ').toLowerCase()

class InlineReader {
  private readonly source: MarkdownBody
  private readonly references: ReadonlySet<string>

  constructor(source: MarkdownBody, references: ReadonlySet<string>) {
    this.source = source
    this.references = references
  }

  /** Pieces of the node's content between `from` and `to`, with wikilinks and highlights applied. */
  read(node: MarkdownNode, from = node.from, to = node.to): Piece[] {
    const pieces: Piece[] = []
    this.walk(node, from, to, pieces)
    return applyHighlights(this.source, applyWikilinks(this.source, node, from, to, pieces))
  }

  private walk(node: MarkdownNode, from: number, to: number, out: Piece[]): void {
    let cursor = from
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.to <= from || child.from >= to) continue
      if (child.from > cursor) this.gap(cursor, child.from, out)
      this.inline(child, out)
      cursor = Math.max(cursor, child.to)
    }
    if (cursor < to) this.gap(cursor, to, out)
  }

  private gap(from: number, to: number, out: Piece[]): void {
    const { text } = this.source
    let start = from
    for (let index = text.indexOf('\n', from); index !== -1 && index < to; index = text.indexOf('\n', index + 1)) {
      if (index > start) out.push({ kind: 'text', from: start, to: index })
      out.push({ kind: 'break', from: index, to: index + 1 })
      start = index + 1
    }
    if (start < to) out.push({ kind: 'text', from: start, to })
  }

  private inline(node: MarkdownNode, out: Piece[]): void {
    const { name, from, to } = node
    if (SKIPPED_INLINE.has(name)) return
    switch (name) {
      case 'Escape':
        // The rich editor keeps a backslash before `{` literal (markdownLiteralProtection).
        if (this.source.slice(from + 1, to) === '{') out.push({ kind: 'text', from, to })
        else out.push({ kind: 'value', from, to, value: this.source.slice(from + 1, to) })
        return
      case 'Entity': {
        const value = decodeEntity(this.source.slice(from, to))
        out.push(value === null ? { kind: 'text', from, to } : { kind: 'value', from, to, value })
        return
      }
      case 'HardBreak':
        out.push({ kind: 'break', from, to, hard: true })
        return
      case 'InlineCode':
        this.code(node, out)
        return
      case 'Link':
      case 'Image':
        this.link(node, out)
        return
      case 'Autolink': {
        const url = node.getChild('URL')
        if (url) out.push({ kind: 'code', from: url.from, to: url.to })
        return
      }
      case 'URL':
        out.push({ kind: 'code', from, to })
        return
      default:
        this.walk(node, from, to, out)
    }
  }

  /** CommonMark code span content: line endings become spaces, one edge space strips from each side. */
  private code(node: MarkdownNode, out: Piece[]): void {
    const marks = node.getChildren('CodeMark')
    if (marks.length < 2) {
      this.gap(node.from, node.to, out)
      return
    }
    let from = marks[0].to
    let to = marks[marks.length - 1].from
    const content = this.source.slice(from, to)
    if (content.includes('\n')) {
      const spaced = content.replaceAll('\n', ' ')
      const value = spaced.length >= 2 && spaced.startsWith(' ') && spaced.endsWith(' ') && spaced.trim() !== '' ? spaced.slice(1, -1) : spaced
      out.push({ kind: 'value', from: node.from, to: node.to, value })
      return
    }
    if (content.length >= 2 && content.startsWith(' ') && content.endsWith(' ') && content.trim() !== '') {
      from += 1
      to -= 1
    }
    if (to > from) out.push({ kind: 'code', from, to })
  }

  /** A link shows its label; an image is one object; an undefined reference is literal text. */
  private link(node: MarkdownNode, out: Piece[]): void {
    const children = childrenOf(node)
    const open = children[0]
    const closeIndex = children.findIndex((child, index) => index > 0 && child.name === 'LinkMark' && this.source.slice(child.from, child.to) === ']')
    if (open?.name !== 'LinkMark' || closeIndex === -1) {
      this.walk(node, node.from, node.to, out)
      return
    }
    const close = children[closeIndex]
    const after = children[closeIndex + 1]
    const inline = after?.name === 'LinkMark' && this.source.slice(after.from, after.to) === '('
    const label = after?.name === 'LinkLabel' ? this.source.slice(after.from + 1, after.to - 1) : ''
    const reference = normalizeLabel(label || this.source.slice(open.to, close.from))
    if (inline || this.references.has(reference)) {
      if (node.name === 'Image') out.push({ kind: 'value', from: node.from, to: node.to, value: PROJECTION_OBJECT })
      else this.walk(node, open.to, close.from, out)
      return
    }
    out.push({ kind: 'text', from: open.from, to: open.to })
    this.walk(node, open.to, close.from, out)
    this.gap(close.from, node.to, out)
  }
}

const WIKILINK_RE = /\[\[([^\]]+)\]\]/gu

/** `[[target|label]]` shows `label`; `[[target]]` shows `target`. Never inside code. */
export function wikilinkText(inner: string): string {
  const pipe = inner.indexOf('|')
  if (pipe === -1) return inner
  return inner.slice(pipe + 1) || inner.slice(0, pipe)
}

function codeRanges(node: MarkdownNode): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const cursor = node.cursor()
  while (cursor.next() && cursor.from < node.to) {
    if (cursor.name === 'InlineCode') ranges.push([cursor.from, cursor.to])
  }
  return ranges
}

function wikilinksIn(source: MarkdownBody, node: MarkdownNode, from: number, to: number): Array<{ from: number; to: number; value: string }> {
  const raw = source.slice(from, to)
  if (!raw.includes('[[')) return []
  const code = codeRanges(node)
  const found: Array<{ from: number; to: number; value: string }> = []
  let lineStart = 0
  for (const line of raw.split('\n')) {
    for (const match of line.matchAll(WIKILINK_RE)) {
      const start = from + lineStart + (match.index ?? 0)
      const end = start + match[0].length
      if (!code.some(([codeFrom, codeTo]) => start < codeTo && end > codeFrom)) found.push({ from: start, to: end, value: wikilinkText(match[1]) })
    }
    lineStart += line.length + 1
  }
  return found
}

function applyWikilinks(source: MarkdownBody, node: MarkdownNode, from: number, to: number, pieces: Piece[]): Piece[] {
  const links = wikilinksIn(source, node, from, to)
  if (links.length === 0) return pieces
  const result: Piece[] = []
  let next = 0
  const placeLinksEndingBy = (position: number) => {
    for (; next < links.length && links[next].to <= position; next += 1) result.push({ kind: 'value', ...links[next] })
  }
  for (const original of pieces) {
    let piece: Piece | null = original
    while (piece) {
      placeLinksEndingBy(piece.from)
      const link = links.at(next)
      if (!link || link.from >= piece.to) {
        result.push(piece)
        break
      }
      // Overlapping a wikilink: only literal text outside it remains; everything inside is the link.
      if (piece.kind !== 'text' && piece.kind !== 'code') break
      if (piece.from < link.from) result.push({ ...piece, to: link.from })
      piece = piece.to > link.to ? { ...piece, from: link.to } : null
    }
  }
  placeLinksEndingBy(Number.POSITIVE_INFINITY)
  return result
}

/** `MARKDOWN_HIGHLIGHT_COLOR_OPTIONS` prefixes (markdownHighlightMarkdown.ts), read after an opening `==`. */
export const HIGHLIGHT_COLOR_PREFIXES = ['🟢', '🔴', '🔵', '🟣'] as const

/**
 * The rich editor's highlight rule: in a block's plain text, an even number of `==` delimiters
 * toggles highlighting and every delimiter disappears, with a colour prefix after each opening one;
 * an odd number leaves the text as written. Escaped, entity and code `=` are never delimiters.
 */
function applyHighlights(source: MarkdownBody, pieces: Piece[]): Piece[] {
  const cuts: Array<[number, number]> = []
  for (const piece of pieces) {
    if (piece.kind !== 'text') continue
    for (let at = source.text.indexOf('==', piece.from); at !== -1 && at + 2 <= piece.to; at = source.text.indexOf('==', at + 2)) {
      cuts.push([at, at + 2])
    }
  }
  if (cuts.length === 0 || cuts.length % 2 === 1) return pieces
  for (let index = 0; index < cuts.length; index += 2) {
    const end = cuts[index][1]
    const prefix = HIGHLIGHT_COLOR_PREFIXES.find(candidate => source.text.startsWith(candidate, end))
    const owner = pieces.find(piece => piece.kind === 'text' && piece.from <= end && end + (prefix?.length ?? 0) <= piece.to)
    if (prefix && owner) cuts[index] = [cuts[index][0], end + prefix.length]
  }
  const result: Piece[] = []
  let cut = 0
  for (const piece of pieces) {
    if (piece.kind !== 'text') {
      result.push(piece)
      continue
    }
    let from = piece.from
    for (; cut < cuts.length && cuts[cut][1] <= piece.to; cut += 1) {
      if (cuts[cut][0] > from) result.push({ ...piece, from, to: cuts[cut][0] })
      from = cuts[cut][1]
    }
    if (from < piece.to) result.push({ ...piece, from })
  }
  return result
}

// --- Output ---------------------------------------------------------------------------------------

class ProjectionBuilder {
  text = ''
  readonly segments: ProjectionSegment[] = []
  private blocks = 0
  private readonly source: MarkdownBody

  constructor(source: MarkdownBody) {
    this.source = source
  }

  block(): void {
    if (this.blocks > 0) this.text += '\n'
    this.blocks += 1
  }

  push(from: number, to: number, value: string, literal: boolean): void {
    if (value === '') return
    const sourceFrom = this.source.original(from)
    const sourceTo = this.source.original(to)
    const exact = literal && sourceTo - sourceFrom === value.length
    const textFrom = this.text.length
    this.text += value
    const last = this.segments.at(-1)
    if (exact && last?.literal && last.sourceTo === sourceFrom && last.textTo === textFrom) {
      this.segments[this.segments.length - 1] = { ...last, sourceTo, textTo: this.text.length }
      return
    }
    this.segments.push({ sourceFrom, sourceTo, textFrom, textTo: this.text.length, literal: exact })
  }

  piece(piece: Piece): void {
    if (piece.kind === 'value') this.push(piece.from, piece.to, piece.value, false)
    else if (piece.kind === 'break') this.push(piece.from, piece.to, piece.hard ? '\n\n' : '\n', !piece.hard && piece.to - piece.from === 1)
    else this.push(piece.from, piece.to, this.source.slice(piece.from, piece.to), true)
  }
}

const isHorizontalSpace = (code: number) => code === 0x20 || code === 0x09

/** Drops spaces and tabs at the edges of every line, as CommonMark does for paragraph text. */
function trimLines(source: MarkdownBody, pieces: readonly Piece[]): Piece[] {
  const lines: Piece[][] = [[]]
  for (const piece of pieces) {
    if (piece.kind === 'break') lines.push([piece])
    else lines[lines.length - 1].push(piece)
  }
  return lines.flatMap(line => {
    const head = line[0]?.kind === 'break' ? [line[0]] : []
    const body = line.slice(head.length)
    trimLineStart(source, body)
    trimLineEnd(source, body)
    return [...head, ...body]
  })
}

type Span = Extract<Piece, { kind: 'text' | 'code' }>
const isTrimmable = (piece: Piece | undefined): piece is Span => piece?.kind === 'text'

function trimLineStart(source: MarkdownBody, line: Piece[]): void {
  for (let piece = line[0]; isTrimmable(piece); piece = line[0]) {
    let { from } = piece
    while (from < piece.to && isHorizontalSpace(source.text.charCodeAt(from))) from += 1
    if (from < piece.to) {
      line[0] = { ...piece, from }
      return
    }
    line.shift()
  }
}

function trimLineEnd(source: MarkdownBody, line: Piece[]): void {
  for (let piece = line.at(-1); isTrimmable(piece); piece = line.at(-1)) {
    let { to } = piece
    while (to > piece.from && isHorizontalSpace(source.text.charCodeAt(to - 1))) to -= 1
    if (to > piece.from) {
      line[line.length - 1] = { ...piece, to }
      return
    }
    line.pop()
  }
}

// --- Blocks ---------------------------------------------------------------------------------------

const DURABLE_FENCE_LANGUAGES = new Set(['html', 'mermaid', 'tldraw'])
const DURABLE_FENCE_RE = /^ {0,3}(?:`{3,}|~{3,})[ \t]*(\S*)/u
const CALLOUT_MARKER_RE = /^\[!([a-z][a-z0-9_-]*)\](?![+-])/iu
const QUOTE_LINE_RE = /^[ \t]{0,3}>/u

/** The rest of a source line after its blockquote markers, as the rich editor's preprocessor reads it. */
function quoteLineContent(line: string): string | null {
  const match = QUOTE_LINE_RE.exec(line)
  if (!match) return null
  let cursor = match[0].length
  for (;;) {
    if (line.charAt(cursor) === ' ' || line.charAt(cursor) === '\t') cursor += 1
    if (line.charAt(cursor) !== '>') break
    cursor += 1
  }
  return line.slice(cursor)
}

/**
 * Where the rich editor inserts empty paragraphs: each blank line beyond the first in a run between
 * content (outside fences), and a bare `>` line between two quoted lines with content.
 */
function emptyBlockPositions(source: MarkdownBody): number[] {
  const positions: number[] = []
  let fence: MarkdownFence | null = null
  let pending: number[] = []
  let preceding = false
  const lineText = (line: number) => source.slice(source.lineStart(line), source.lineEnd(line))
  const quotedContent = (line: number) => line >= 0 && line < source.lineCount && (quoteLineContent(lineText(line))?.trim() ?? '') !== ''
  for (let line = 0; line < source.lineCount; line += 1) {
    const content = lineText(line)
    if (fence) {
      fence = advanceMarkdownFence(content, fence)
      if (!fence) preceding = true
      continue
    }
    if (content.trim() === '') {
      pending.push(source.lineStart(line))
      continue
    }
    if (pending.length >= 2 && preceding) positions.push(...pending.slice(1))
    pending = []
    preceding = true
    const quoted = quoteLineContent(content)
    if (quoted !== null && quoted.trim() === '' && quotedContent(line - 1) && quotedContent(line + 1)) positions.push(source.lineStart(line))
    fence = advanceMarkdownFence(content, null)
  }
  return positions
}

function referenceLabels(source: MarkdownBody): Set<string> {
  const labels = new Set<string>()
  const cursor = source.top.cursor()
  while (cursor.next()) {
    if (cursor.name !== 'LinkReference') continue
    const label = cursor.node.getChild('LinkLabel')
    if (label) labels.add(normalizeLabel(source.slice(label.from + 1, label.to - 1)))
  }
  return labels
}

class BlockWalker {
  private readonly source: MarkdownBody
  private readonly out: ProjectionBuilder
  private readonly inline: InlineReader
  private readonly empties: number[]
  private nextEmpty = 0

  constructor(source: MarkdownBody, out: ProjectionBuilder) {
    this.source = source
    this.out = out
    this.inline = new InlineReader(source, referenceLabels(source))
    this.empties = emptyBlockPositions(source)
  }

  private begin(position: number): void {
    while (this.nextEmpty < this.empties.length && this.empties[this.nextEmpty] < position) {
      this.out.block()
      this.nextEmpty += 1
    }
    this.out.block()
  }

  private leaf(position: number, pieces: readonly Piece[], trim = true): void {
    this.begin(position)
    for (const piece of trim ? trimLines(this.source, pieces) : pieces) this.out.piece(piece)
  }

  private object(node: MarkdownNode): void {
    this.begin(node.from)
    this.out.push(node.from, node.to, PROJECTION_OBJECT, false)
  }

  blocks(node: MarkdownNode, quoteStart = false): void {
    let first = quoteStart
    for (const child of childrenOf(node)) {
      if (child.name === 'QuoteMark' || child.name === 'ListMark') continue
      this.block(child, first)
      first = false
    }
  }

  private block(node: MarkdownNode, quoteStart: boolean): void {
    switch (node.name) {
      case 'Paragraph':
        this.paragraph(node, quoteStart)
        return
      case 'ATXHeading1': case 'ATXHeading2': case 'ATXHeading3':
      case 'ATXHeading4': case 'ATXHeading5': case 'ATXHeading6':
      case 'Task':
        this.leaf(node.from, this.inline.read(node))
        return
      case 'SetextHeading1':
      case 'SetextHeading2':
        this.leaf(node.from, this.inline.read(node, node.from, setextContentEnd(this.source, node)))
        return
      case 'Blockquote':
      case 'ListItem':
        if (blockChildren(node).length === 0) this.leaf(node.from, [])
        else this.blocks(node, node.name === 'Blockquote')
        return
      case 'BulletList':
      case 'OrderedList':
        this.blocks(node)
        return
      case 'FencedCode':
        if (isDurableFence(this.source, node)) this.object(node)
        else this.leaf(node.from, codePieces(this.source, node, true), false)
        return
      case 'CodeBlock':
        this.leaf(node.from, codePieces(this.source, node, false), false)
        return
      case 'Table':
        this.table(node)
        return
      case 'HorizontalRule':
        this.object(node)
        return
      case 'HTMLBlock': case 'CommentBlock': case 'ProcessingInstructionBlock': case 'LinkReference':
        return
      default:
        if (node.firstChild) this.blocks(node)
    }
  }

  private paragraph(node: MarkdownNode, quoteStart: boolean): void {
    if (isMathBlock(this.source.slice(node.from, node.to))) {
      this.object(node)
      return
    }
    let pieces = this.inline.read(node)
    // A callout's marker and title line are block properties in the rich editor, not text.
    if (quoteStart && CALLOUT_MARKER_RE.test(this.source.slice(node.from, node.to))) {
      const lineBreak = pieces.findIndex(piece => piece.kind === 'break')
      pieces = lineBreak === -1 ? [] : pieces.slice(lineBreak + 1)
    }
    this.leaf(node.from, pieces)
  }

  /** Every cell is its own leaf block; rows take the header's cell count. */
  private table(node: MarkdownNode): void {
    const rows = childrenOf(node).filter(child => child.name === 'TableHeader' || child.name === 'TableRow')
    const columns = rows[0] ? tableCells(this.source, rows[0]).length : 0
    for (const row of rows) {
      const cells = tableCells(this.source, row)
      for (let column = 0; column < columns; column += 1) {
        const cell = cells.at(column)
        if (cell?.node) this.leaf(cell.node.from, this.inline.read(cell.node))
        else this.leaf(cell?.from ?? row.to, [])
      }
    }
  }
}

const BLOCK_MARKS = new Set(['QuoteMark', 'ListMark'])
const blockChildren = (node: MarkdownNode) => childrenOf(node).filter(child => !BLOCK_MARKS.has(child.name))

function setextContentEnd(source: MarkdownBody, node: MarkdownNode): number {
  const underline = node.getChildren('HeaderMark').at(-1)
  if (!underline) return node.to
  return Math.max(node.from, source.lineStart(source.lineOf(underline.from)) - 1)
}

function isDurableFence(source: MarkdownBody, node: MarkdownNode): boolean {
  const line = source.lineOf(node.from)
  const match = DURABLE_FENCE_RE.exec(source.slice(source.lineStart(line), source.lineEnd(line)))
  return match !== null && DURABLE_FENCE_LANGUAGES.has((match[1] ?? '').toLowerCase())
}

/** `$$` on its own first and last lines, or `$$…$$` on one line: the rich editor's block math. */
function isMathBlock(raw: string): boolean {
  const lines = raw.split('\n').map(line => line.trim())
  if (lines.length === 1) return /^\$\$(.+)\$\$$/u.test(lines[0])
  return lines[0] === '$$' && lines[lines.length - 1] === '$$'
}

/** Content lines of a code block, joined by their line breaks; fence lines are not content. */
function codePieces(source: MarkdownBody, node: MarkdownNode, fenced: boolean): Piece[] {
  const texts = node.getChildren('CodeText')
  let first = source.lineOf(node.from)
  let last = source.lineOf(Math.max(node.from, node.to - 1))
  if (fenced) {
    const marks = node.getChildren('CodeMark')
    first += 1
    if (marks.length >= 2) last = source.lineOf(marks[marks.length - 1].from) - 1
    else if (node.to === source.lineStart(source.lineOf(node.to)) && node.to > node.from) last = source.lineOf(node.to) - 1
    else last = source.lineOf(node.to)
  }
  const pieces: Piece[] = []
  for (let line = first; line <= last; line += 1) {
    if (line > first) pieces.push({ kind: 'break', from: source.lineEnd(line - 1), to: source.lineEnd(line - 1) + 1 })
    const start = source.lineStart(line)
    const end = source.lineEnd(line)
    for (const text of texts) {
      const from = Math.max(text.from, start)
      const to = Math.min(text.to, end)
      if (to > from) pieces.push({ kind: 'code', from, to })
    }
  }
  return pieces
}

function tableCells(source: MarkdownBody, row: MarkdownNode): Array<{ from: number; node: MarkdownNode | null }> {
  const delimiters = row.getChildren('TableDelimiter')
  const cells = row.getChildren('TableCell')
  const ranges: Array<[number, number]> = []
  let cursor = row.from
  for (const delimiter of delimiters) {
    ranges.push([cursor, delimiter.from])
    cursor = delimiter.to
  }
  ranges.push([cursor, row.to])
  // A leading or trailing pipe leaves nothing outside it, which is not a cell.
  const blank = (range: [number, number] | undefined) => range !== undefined && source.slice(range[0], range[1]).trim() === ''
  if (delimiters.length > 0 && blank(ranges[0])) ranges.shift()
  if (delimiters.length > 0 && blank(ranges.at(-1))) ranges.pop()
  return ranges.map(([from, to]) => ({ from, node: cells.find(cell => cell.from >= from && cell.to <= to) ?? null }))
}

// --- Public ---------------------------------------------------------------------------------------

/** Visible text of a body (the note after its frontmatter) and the map back to it. */
export function projectMarkdownBody(body: string): PassageProjection {
  const source = new MarkdownBody(body)
  const out = new ProjectionBuilder(source)
  new BlockWalker(source, out).blocks(source.top)
  return { version: PASSAGE_PROJECTION, text: out.text, segments: out.segments }
}

/** Visible text of one block node of an already parsed body, e.g. a title heading. */
export function visibleTextOf(source: MarkdownBody, node: MarkdownNode): string {
  const out = new ProjectionBuilder(source)
  const reader = new InlineReader(source, referenceLabels(source))
  const to = node.name.startsWith('SetextHeading') ? setextContentEnd(source, node) : node.to
  out.block()
  for (const piece of trimLines(source, reader.read(node, node.from, to))) out.piece(piece)
  return out.text
}

function firstSegmentEndingAfter(segments: readonly ProjectionSegment[], position: number, key: 'sourceTo' | 'textTo'): number {
  let low = 0
  let high = segments.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (segments[middle][key] <= position) low = middle + 1
    else high = middle
  }
  return low
}

const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff

/**
 * A raw selection `[from, to)` in body offsets, as projected text. A replaced construct (escape,
 * entity, wikilink, object, `\r\n`) counts only when wholly selected; cutting one leaves the quote
 * without an anchor. Markup between segments projects to nothing either way.
 */
export function projectSourceRange(projection: PassageProjection, from: number, to: number): SourceRangeMapping {
  const { segments, text } = projection
  let start = -1
  let end = -1
  let anchored = true
  for (let index = firstSegmentEndingAfter(segments, from, 'sourceTo'); index < segments.length; index += 1) {
    const segment = segments[index]
    if (segment.sourceFrom >= to) break
    let textFrom = segment.textFrom
    let textTo = segment.textTo
    if (segment.literal) {
      textFrom += Math.max(0, from - segment.sourceFrom)
      textTo -= Math.max(0, segment.sourceTo - to)
    } else if (segment.sourceFrom < from || segment.sourceTo > to) {
      anchored = false
      continue
    }
    if (start === -1) start = textFrom
    end = textTo
  }
  if (start === -1 || end <= start) return { exact: '', start: 0, end: 0, anchored: false }
  if (isLowSurrogate(text.charCodeAt(start))) start -= 1
  if (isLowSurrogate(text.charCodeAt(end))) end += 1
  return { exact: text.slice(start, end), start, end, anchored }
}

/**
 * The exact-text offset of a raw editor position. CodeMirror counts every line ending as one
 * position, while `\r\n` is two characters of the note, as in `applyRawMarkdownChanges`.
 */
export function noteOffsetOfEditorPosition(content: string, position: number): number {
  let extra = 0
  for (let index = content.indexOf('\r\n'); index !== -1 && index - extra < position; index = content.indexOf('\r\n', index + 2)) extra += 1
  return position + extra
}

/**
 * A raw editor selection over the whole note `content` (CodeMirror positions, front matter included)
 * as projected body text. Null when the selection lies wholly in the front matter; a selection that
 * starts there is cut at the body and left without an anchor.
 */
export function projectRawEditorSelection(content: string, from: number, to: number, projection?: PassageProjection): SourceRangeMapping | null {
  const bodyStart = splitFrontmatter(content)[0].length
  const start = noteOffsetOfEditorPosition(content, Math.min(from, to))
  const end = noteOffsetOfEditorPosition(content, Math.max(from, to))
  if (end <= bodyStart) return null
  const mapping = projectSourceRange(projection ?? projectMarkdownBody(content.slice(bodyStart)), Math.max(0, start - bodyStart), end - bodyStart)
  return start < bodyStart ? { ...mapping, anchored: false } : mapping
}

/** The body range showing projected text `[start, end)`, widened to whole replaced constructs. */
export function sourceRangeOfText(projection: PassageProjection, start: number, end: number): { from: number; to: number } | null {
  const { segments, text } = projection
  if (!(start >= 0 && end > start && end <= text.length)) return null
  const first = segments[firstSegmentEndingAfter(segments, start, 'textTo')]
  const lastIndex = firstSegmentEndingAfter(segments, end - 1, 'textTo')
  const last = segments.at(lastIndex)
  if (!first || !last) return null
  const from = first.literal && start > first.textFrom ? first.sourceFrom + (start - first.textFrom) : first.sourceFrom
  const to = last.literal && end < last.textTo && end > last.textFrom ? last.sourceFrom + (end - last.textFrom) : last.sourceTo
  return to > from ? { from, to } : null
}
