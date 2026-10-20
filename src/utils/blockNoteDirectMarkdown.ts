import { restoreWikilinksInBlocks } from './wikilinks'
import {
  escapeInlineMarkdownText,
  wrapInlineMarkdown,
  type InlineEscapeOptions,
} from './blockNoteMarkdownInline'
// Called only at serialization time, so this module's import cycle with it is safe.
import { readMarkdownHighlightPrefix } from './markdownHighlightMarkdown'
import { normalizeUnsafeTableCardinalities } from './blockNoteTableCardinality'

interface TextStyles {
  [style: string]: string | boolean | undefined
}

interface InlineItem {
  type?: string
  text?: string
  href?: string
  props?: Record<string, string | undefined>
  styles?: TextStyles
  content?: InlineItem[]
  [key: string]: unknown
}

interface TableCellLike {
  content?: InlineItem[]
  [key: string]: unknown
}

type TableCellValue = string | TableCellLike

interface TableRowLike {
  cells?: TableCellValue[]
  [key: string]: unknown
}

interface TableContentLike {
  type?: string
  rows?: TableRowLike[]
  [key: string]: unknown
}

interface BlockLike {
  type?: string
  content?: unknown
  props?: Record<string, string | number | boolean | undefined>
  children?: BlockLike[]
  [key: string]: unknown
}

export interface BlockNoteDirectMarkdownMetrics {
  blockCount: number
  cacheHits: number
  cacheMisses: number
  durationMs: number
  fallbackReason: string | null
}

export interface BlockNoteDirectMarkdownResult {
  markdown: string
  metrics: BlockNoteDirectMarkdownMetrics
  supported: boolean
}

export interface DirectMarkdownCapableSerializer {
  blocksToMarkdownLossy: (blocks: unknown[]) => string
  blocksToMarkdownDirect?: (blocks: unknown[]) => BlockNoteDirectMarkdownResult
  __tolariaDirectMarkdownCache?: WeakMap<object, Map<string, string>>
  __tolariaLastDirectMarkdownMetrics?: BlockNoteDirectMarkdownMetrics
}

type MarkdownLinePrefix = {
  contentIndent: number
  marker: string
  indent: string
}

type MarkdownBlockIndent = {
  markdown: string
  width: number
}

interface SerializeContext {
  cache?: WeakMap<object, Map<string, string>>
  cacheHits: number
  cacheMisses: number
  fallbackReason: string | null
  indentStack: number[]
  numberedStack: number[]
}

type SerializedBlockListItem =
  | { kind: 'blankParagraph' }
  | { kind: 'empty' }
  | { kind: 'markdown'; markdown: string }

const IMAGE_MARKER_BANG_RE = /!(?=\[)/g
const LEADING_ATX_HEADING_RE = /^([ \t]{0,3})(#{1,6})(?=\s|$)/gm
const LEADING_BLOCKQUOTE_RE = /^([ \t]{0,3})>/gm
const ESCAPE_TABLE_CELL_RE = /[|\n\r]/g
// Block syntax that only reopens at the start of a line. Applied to assembled block markdown, not to
// table cells, whose pipes are escaped by their own renderer.
const LEADING_BREAK_RUN_RE = /^([ \t]{0,3})([-=])(?=[-=]*[ \t]*$)/gm
const LEADING_LIST_MARKER_RE = /^([ \t]{0,3})([-+])(?=[ \t]|$)/gm
const LEADING_ORDERED_MARKER_RE = /^([ \t]{0,3})(\d{1,9})([.)])(?=[ \t]|$)/gm
const LEADING_TABLE_PIPE_RE = /^([ \t]{0,3})\|/gm
const TRAILING_HASH_RUN_RE = /(^|[ \t])(#+)$/u
const RESTORED_INLINE_MATH_RE = /^\$[\s\S]+\$$/u
const TEXT_CONTENT_BLOCK_TYPES = new Set([
  'bulletListItem',
  'checkListItem',
  'numberedListItem',
  'paragraph',
])
const MEDIA_BLOCK_TYPES = new Set(['audio', 'file', 'image', 'video'])


function now(): number {
  return globalThis.performance.now()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function blockObject(value: unknown): BlockLike | null {
  return isRecord(value) ? value as BlockLike : null
}

function contentArray(content: unknown): InlineItem[] {
  return Array.isArray(content) ? content as InlineItem[] : []
}

function blockChildren(block: BlockLike): BlockLike[] {
  return Array.isArray(block.children) ? block.children : []
}

function isEmptyParagraphBlock(block: BlockLike): boolean {
  return block.type === 'paragraph'
    && contentArray(block.content).length === 0
    && blockChildren(block).length === 0
}

function tableContent(content: unknown): TableContentLike | null {
  return isRecord(content) && content.type === 'tableContent' && Array.isArray(content.rows)
    ? content as TableContentLike
    : null
}

/**
 * Inline math needs two `$` on a line, and a block's text is the only text on its lines, so a block
 * with fewer than two cannot form math and a lone `$` is written as is. Table rows put several cells
 * on one line, so they always escape.
 */
const ESCAPE_DOLLARS: InlineEscapeOptions = { escapeDollars: true }
const KEEP_LONE_DOLLAR: InlineEscapeOptions = { escapeDollars: false }

function dollarCount(content: InlineItem[] | undefined): number {
  return (content ?? []).reduce((count, item) => {
    // A structural math item writes its own pair of delimiters next to the block's text.
    if (item.type === 'mathInline') return count + 2
    const own = item.text?.split('$').length ?? 1
    return count + own - 1 + dollarCount(Array.isArray(item.content) ? item.content : undefined)
  }, 0)
}

function inlineEscapeFor(content: InlineItem[] | undefined): InlineEscapeOptions {
  return dollarCount(content) >= 2 ? ESCAPE_DOLLARS : KEEP_LONE_DOLLAR
}

function escapeText(text: string, options: InlineEscapeOptions): string {
  return escapeInlineMarkdownText(text, options)
    .replace(IMAGE_MARKER_BANG_RE, '\\!')
    .replace(LEADING_ATX_HEADING_RE, '$1\\$2')
    .replace(LEADING_BLOCKQUOTE_RE, '$1\\>')
}

/**
 * A heading's trailing hash run would reopen as an ATX closing sequence and be removed, so a run
 * that ends the title is escaped. `C#` needs nothing, because no whitespace precedes its hash.
 */
function escapeHeadingClosingSequence(markdown: string): string {
  return markdown.replace(TRAILING_HASH_RUN_RE, '$1\\$2')
}

/**
 * Escapes thematic breaks, list markers and table pipes that would reopen as block structure.
 * Structural markers that renderers add themselves (`#`, `>`, `- `, `1. `) are applied after this.
 */
function escapeBlockLineStarts(markdown: string): string {
  return markdown
    .replace(LEADING_BREAK_RUN_RE, '$1\\$2')
    .replace(LEADING_LIST_MARKER_RE, '$1\\$2')
    .replace(LEADING_ORDERED_MARKER_RE, '$1$2\\$3')
    .replace(LEADING_TABLE_PIPE_RE, '$1\\|')
}

function escapeLinkTarget(target: string): string {
  return target.includes(' ') || target.includes(')') ? `<${target.replace(/>/g, '%3E')}>` : target
}

function inlineText(item: InlineItem, options: InlineEscapeOptions): string {
  if (item.type === 'text') return item.text ?? ''
  if (item.type === 'link') return linkMarkdown(item, options)
  if (item.type === 'wikilink') return wikilinkMarkdown(item)
  if (item.type === 'mathInline') return item.props?.latex ? `$${item.props.latex}$` : ''
  if (Array.isArray(item.content)) return serializeInlineItems(item.content, options)
  return ''
}

function linkMarkdown(item: InlineItem, options: InlineEscapeOptions): string {
  const content = Array.isArray(item.content)
    ? serializeInlineItems(item.content, options)
    : escapeText(item.text ?? item.props?.title ?? item.props?.href ?? '', options)
  const href = item.props?.href ?? item.href
  return href ? `[${content}](${escapeLinkTarget(href)})` : content
}

function wikilinkMarkdown(item: InlineItem): string {
  const target = item.props?.target
  return target ? `[[${target}]]` : ''
}

function hasActiveStyle(styles: TextStyles | undefined): boolean {
  return Object.values(styles ?? {}).some(Boolean)
}

function isHighlightDelimiter(text: string): boolean {
  if (!text.startsWith('==')) return false
  const prefix = text.slice(2)
  return prefix === '' || readMarkdownHighlightPrefix(prefix).text === ''
}

/**
 * The math and highlight serializers turn their structure back into plain text items before this
 * serializer runs, and rely on it writing them unchanged: `$latex$` (math writes it without
 * `styles`, which editor text always has) and a bare `==` or `==<colour>` delimiter. They are
 * authored syntax, not literal text, so escaping them would turn math and highlights into text.
 */
function isStructuralMarkerText(item: InlineItem): boolean {
  const text = item.text ?? ''
  if (item.styles === undefined) return RESTORED_INLINE_MATH_RE.test(text)
  return isHighlightDelimiter(text) && !hasActiveStyle(item.styles)
}

function styledTextMarkdown(item: InlineItem, options: InlineEscapeOptions): string {
  const source = item.text ?? ''
  const styles = item.styles ?? {}
  if (isStructuralMarkerText(item)) return source
  if (styles.code === true) return codeSpan(source)
  return applyInlineStyle(
    applyInlineStyle(
      applyInlineStyle(escapeText(source, options), styles.bold, '**'),
      styles.italic,
      '*',
    ),
    styles.strike,
    '~~',
  )
}

function applyInlineStyle(text: string, enabled: string | boolean | undefined, marker: string): string {
  return enabled === true ? wrapInlineMarkdown(text, marker) : text
}

function codeSpan(text: string): string {
  const marker = text.includes('`') ? '``' : '`'
  const needsPadding = marker === '``' && (text.startsWith('`') || text.endsWith('`'))
  return needsPadding ? `${marker} ${text} ${marker}` : `${marker}${text}${marker}`
}

function serializeInlineItem(item: InlineItem, options: InlineEscapeOptions): string {
  return item.type === 'text' ? styledTextMarkdown(item, options) : inlineText(item, options)
}

function serializeInlineItems(content: InlineItem[] | undefined, options: InlineEscapeOptions): string {
  return content?.map(item => serializeInlineItem(item, options)).join('') ?? ''
}

/** Serializes one block's inline content, deciding `$` escaping across the whole block. */
export function serializeInlineContent(content: InlineItem[] | undefined): string {
  return serializeInlineItems(content, inlineEscapeFor(content))
}

function literalInlineText(item: InlineItem): string {
  if (typeof item.text === 'string') return item.text
  if (Array.isArray(item.content)) return literalTextContent(item.content)
  return ''
}

function literalTextContent(content: InlineItem[] | undefined): string {
  return content?.map(literalInlineText).join('') ?? ''
}

function blockPrefix(block: BlockLike, depth: number, context: SerializeContext): MarkdownLinePrefix | null {
  const indent = ' '.repeat(context.indentStack.at(depth) ?? 0)
  if (block.type === 'numberedListItem') return numberedListPrefix(block, depth, context, indent)
  context.numberedStack.splice(depth, 1, 1)
  switch (block.type) {
    case 'bulletListItem':
      return { contentIndent: 2, indent, marker: '- ' }
    case 'checkListItem':
      return { contentIndent: 2, indent, marker: checklistMarker(block) }
    default:
      return null
  }
}

function numberedListPrefix(
  block: BlockLike,
  depth: number,
  context: SerializeContext,
  indent: string,
): MarkdownLinePrefix {
  const next = context.numberedStack.at(depth) ?? Number(block.props?.start ?? 1)
  context.numberedStack.splice(depth, 1, next + 1)
  const marker = `${next}. `
  return { contentIndent: marker.length, indent, marker }
}

function checklistMarker(block: BlockLike): string {
  return block.props?.checked === true ? '- [x] ' : '- [ ] '
}

function advanceCachedBlockContext(block: BlockLike, depth: number, context: SerializeContext): void {
  if (block.type === 'numberedListItem') {
    const next = context.numberedStack.at(depth) ?? Number(block.props?.start ?? 1)
    context.numberedStack.splice(depth, 1, next + 1)
  } else {
    context.numberedStack.splice(depth, 1, 1)
  }
  context.indentStack.length = depth + 1
  context.numberedStack.length = depth + 1
}

function prependLinePrefix(markdown: string, prefix: MarkdownLinePrefix): string {
  const lines = markdown.split('\n')
  return lines.map((line, index) => (
    index === 0
      ? `${prefix.indent}${prefix.marker}${line}`
      : `${prefix.indent}${' '.repeat(prefix.contentIndent)}${line}`
  )).join('\n')
}

function prependBlockIndent({ markdown, width }: MarkdownBlockIndent): string {
  if (width === 0) return markdown
  const indent = ' '.repeat(width)
  return markdown.split('\n').map(line => `${indent}${line}`).join('\n')
}

function isListItemBlock(block: BlockLike | undefined): boolean {
  return block?.type === 'bulletListItem'
    || block?.type === 'checkListItem'
    || block?.type === 'numberedListItem'
}

function codeBlockMarkdown(block: BlockLike): string {
  const language = typeof block.props?.language === 'string' ? block.props.language : ''
  const code = literalTextContent(contentArray(block.content)).replace(/\n$/u, '')
  const fence = code.includes('```') ? '~~~' : '```'
  return `${fence}${language === 'text' ? '' : language}\n${code}\n${fence}`
}

function mediaLabel(name: string, url: string): string {
  if (name) return name
  return url.split('/').pop() ?? url
}

function mediaUrl(block: BlockLike): string {
  return typeof block.props?.url === 'string' ? block.props.url : ''
}

function mediaMarkdown(block: BlockLike): string {
  const url = mediaUrl(block)
  const name = typeof block.props?.name === 'string' ? block.props.name : ''
  if (!url) return name
  const label = block.type === 'image' ? name : mediaLabel(name, url)
  return block.type === 'image'
    ? `![${escapeText(label, ESCAPE_DOLLARS)}](${escapeLinkTarget(url)})`
    : `[${escapeText(label, ESCAPE_DOLLARS)}](${escapeLinkTarget(url)})`
}

function quoteMarkdown(block: BlockLike): string {
  const text = escapeBlockLineStarts(serializeInlineContent(contentArray(block.content)))
  return text.split('\n').map(line => `> ${line}`).join('\n')
}

function escapeTableCellMarkdown(markdown: string): string {
  return markdown.replace(ESCAPE_TABLE_CELL_RE, character => character === '|' ? '\\|' : ' ')
}

function tableWikilinkMarkdown(item: InlineItem): string {
  const target = item.props?.target
  if (!target) return ''

  const aliasSeparator = target.indexOf('|')
  if (aliasSeparator < 0) return `[[${target}]]`

  let targetEnd = aliasSeparator
  while (target.charAt(targetEnd - 1) === '\\') targetEnd -= 1
  return `[[${target.slice(0, targetEnd)}${target.slice(aliasSeparator)}]]`
}

function tableInlineItemMarkdown(item: InlineItem): string {
  return item.type === 'wikilink'
    ? tableWikilinkMarkdown(item)
    : escapeTableCellMarkdown(serializeInlineItem(item, ESCAPE_DOLLARS))
}

function tableCellMarkdown(cell: TableCellValue): string {
  if (typeof cell === 'string') return escapeTableCellMarkdown(cell)
  return contentArray(cell.content).map(tableInlineItemMarkdown).join('')
}

function tableMarkdown(block: BlockLike): string | null {
  const content = tableContent(block.content)
  const rows = content?.rows ?? []
  if (rows.length === 0) return ''

  const cellRows = rows.map(row => row.cells?.map(tableCellMarkdown) ?? [])
  const width = Math.max(...cellRows.map(row => row.length), 0)
  if (width === 0) return ''

  const normalizedRows = cellRows.map(row => Array.from({ length: width }, (_, index) => row.at(index) ?? ''))
  const [head, ...body] = normalizedRows
  return [
    `| ${head.join(' | ')} |`,
    `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
    ...body.map(row => `| ${row.join(' | ')} |`),
  ].join('\n')
}

function inlineBlockMarkdown(block: BlockLike): string {
  return escapeBlockLineStarts(serializeInlineContent(contentArray(block.content)))
}

function headingMarkdown(block: BlockLike): string {
  const level = Math.max(1, Math.min(6, Number(block.props?.level ?? 1)))
  const content = escapeHeadingClosingSequence(serializeInlineContent(contentArray(block.content)))
  return `${'#'.repeat(level)} ${content}`.trimEnd()
}

function unsupportedBlockMarkdown(block: BlockLike, context: SerializeContext): null {
  context.fallbackReason = typeof block.type === 'string' ? `unsupported:${block.type}` : 'unsupported:unknown'
  return null
}

function specialBlockMarkdown(block: BlockLike, context: SerializeContext): string | null {
  switch (block.type) {
    case 'codeBlock': return codeBlockMarkdown(block)
    case 'divider': return '---'
    case 'heading': return headingMarkdown(block)
    case 'quote': return quoteMarkdown(block)
    case 'table': return tableMarkdown(block)
    default: return unsupportedBlockMarkdown(block, context)
  }
}

function blockMarkdownWithoutChildren(block: BlockLike, context: SerializeContext): string | null {
  if (typeof block.type !== 'string') return unsupportedBlockMarkdown(block, context)
  if (TEXT_CONTENT_BLOCK_TYPES.has(block.type)) return inlineBlockMarkdown(block)
  if (MEDIA_BLOCK_TYPES.has(block.type)) return mediaMarkdown(block)
  return specialBlockMarkdown(block, context)
}

function serializeChildren(
  block: BlockLike,
  depth: number,
  context: SerializeContext,
  prefix: MarkdownLinePrefix | null,
): string {
  const children = blockChildren(block)
  if (children.length === 0) return ''
  const childDepth = depth + 1
  const parentIndent = context.indentStack.at(depth) ?? 0
  context.indentStack.splice(childDepth, 1, parentIndent + (prefix?.contentIndent ?? 2))
  context.numberedStack.splice(childDepth, 1, 1)
  const markdown = serializeBlockList(children, childDepth, context)
  context.indentStack.length = childDepth
  context.numberedStack.length = childDepth
  return markdown
}

function blockCacheKey(block: BlockLike, depth: number, context: SerializeContext): string {
  return [
    depth,
    block.type ?? '',
    context.indentStack.at(depth) ?? '',
    context.numberedStack.at(depth) ?? '',
  ].join(':')
}

function cachedBlockMarkdown(block: BlockLike, cacheKey: string, context: SerializeContext): string | null {
  const cached = context.cache?.get(block as object)?.get(cacheKey)
  if (cached === undefined) return null
  context.cacheHits++
  return cached
}

function storeCachedBlockMarkdown(
  block: BlockLike,
  cacheKey: string,
  markdown: string,
  context: SerializeContext,
): void {
  if (!context.cache) return
  const existing = context.cache.get(block as object)
  if (existing) {
    existing.set(cacheKey, markdown)
    return
  }
  context.cache.set(block as object, new Map([[cacheKey, markdown]]))
}

function renderUncachedBlock(block: BlockLike, depth: number, context: SerializeContext): string | null {
  context.cacheMisses++
  const ownMarkdown = blockMarkdownWithoutChildren(block, context)
  if (ownMarkdown === null) return null

  const prefix = blockPrefix(block, depth, context)
  const ownWithPrefix = prefix
    ? prependLinePrefix(ownMarkdown, prefix)
    : prependBlockIndent({ markdown: ownMarkdown, width: context.indentStack.at(depth) ?? 0 })
  const childMarkdown = serializeChildren(block, depth, context, prefix)
  if (!childMarkdown) return ownWithPrefix
  const separator = isListItemBlock(blockChildren(block).at(0)) ? '\n' : '\n\n'
  return `${ownWithPrefix}${separator}${childMarkdown}`
}

function serializeBlock(block: BlockLike, depth: number, context: SerializeContext): string | null {
  const cacheKey = blockCacheKey(block, depth, context)
  const cached = cachedBlockMarkdown(block, cacheKey, context)
  if (cached !== null) {
    advanceCachedBlockContext(block, depth, context)
    return cached
  }
  const markdown = renderUncachedBlock(block, depth, context)
  if (markdown === null) return null
  storeCachedBlockMarkdown(block, cacheKey, markdown, context)
  return markdown
}

function serializeBlockListItem(
  block: BlockLike,
  depth: number,
  context: SerializeContext,
): SerializedBlockListItem | null {
  const markdown = serializeBlock(block, depth, context)
  if (markdown === null) return null
  if (markdown) return { kind: 'markdown', markdown }
  return depth === 0 && isEmptyParagraphBlock(block)
    ? { kind: 'blankParagraph' }
    : { kind: 'empty' }
}

function appendMarkdownChunk(
  chunks: string[],
  markdown: string,
  pendingBlankParagraphs: number,
): void {
  const separator = chunks.length === 0
    ? ''
    : `\n\n${'\n'.repeat(pendingBlankParagraphs)}`
  chunks.push(`${separator}${markdown}`)
}

function serializeBlockList(blocks: BlockLike[], depth: number, context: SerializeContext): string {
  const chunks: string[] = []
  let pendingBlankParagraphs = 0

  for (const value of blocks) {
    const block = blockObject(value)
    if (!block) {
      context.fallbackReason = 'unsupported:non-object-block'
      return ''
    }

    const item = serializeBlockListItem(block, depth, context)
    if (item === null) return ''
    if (item.kind === 'blankParagraph') {
      pendingBlankParagraphs++
      continue
    }
    if (item.kind === 'empty') {
      continue
    }

    appendMarkdownChunk(chunks, item.markdown, pendingBlankParagraphs)
    pendingBlankParagraphs = 0
  }

  return chunks.join('')
}

export function blocksToMarkdownDirect(
  blocks: unknown[],
  cache?: WeakMap<object, Map<string, string>>,
): BlockNoteDirectMarkdownResult {
  const startedAt = now()
  const context: SerializeContext = {
    cache,
    cacheHits: 0,
    cacheMisses: 0,
    fallbackReason: null,
    indentStack: [0],
    numberedStack: [],
  }
  const markdown = serializeBlockList(blocks as BlockLike[], 0, context)
  const durationMs = now() - startedAt
  return {
    markdown,
    supported: context.fallbackReason === null,
    metrics: {
      blockCount: blocks.length,
      cacheHits: context.cacheHits,
      cacheMisses: context.cacheMisses,
      durationMs,
      fallbackReason: context.fallbackReason,
    },
  }
}

export function installBlockNoteDirectMarkdown(editor: DirectMarkdownCapableSerializer): void {
  if (typeof editor.blocksToMarkdownDirect === 'function') return

  const cache = new WeakMap<object, Map<string, string>>()
  editor.__tolariaDirectMarkdownCache = cache
  editor.blocksToMarkdownDirect = (blocks: unknown[]) => {
    const result = blocksToMarkdownDirect(blocks, cache)
    editor.__tolariaLastDirectMarkdownMetrics = result.metrics
    return result
  }
}

export function serializeBlockNoteMarkdown(
  editor: DirectMarkdownCapableSerializer,
  blocks: unknown[],
): string {
  const direct = editor.blocksToMarkdownDirect?.(blocks)
  if (direct?.supported) return direct.markdown
  const safeBlocks = normalizeUnsafeTableCardinalities(blocks)
  return editor.blocksToMarkdownLossy(restoreWikilinksInBlocks(safeBlocks))
}
