// Stage 2 of website capture: the extracted article is sanitized with a private DOMPurify instance
// (strict allowlist, no data/aria attributes, http(s) addresses only), then walked into a small
// block model whose structure the note's Markdown can hold. The model is written out as minimal
// HTML for the editor's own HTML parser: only these tags, only `href` on links and a language class
// on code, every text escaped here. Images and other media become text links; nothing is fetched.
import DOMPurify, { type Config, type DOMPurify as Purifier } from 'dompurify'
import { settleCodeLanguage } from './articleBlocks'
import { CODE_LANGUAGE_CLASS_PREFIX } from './articleDocument'
import { articleHref } from './articleUrls'
import { WebCaptureRefusalError, removeControlCharacters, singleLine, visibleLength } from './articleText'
import { WEB_CAPTURE_LIMITS } from './webCaptureContract'

export type ArticleMark = 'strong' | 'em' | 's' | 'code'

export type ArticleInline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'break' }
  | { readonly kind: 'mark'; readonly mark: ArticleMark; readonly children: readonly ArticleInline[] }
  | { readonly kind: 'link'; readonly href: string; readonly children: readonly ArticleInline[] }

export interface ArticleListItem {
  readonly inline: readonly ArticleInline[]
  readonly children: readonly ArticleBlock[]
}

export type ArticleBlock =
  | { readonly kind: 'paragraph'; readonly inline: readonly ArticleInline[] }
  | { readonly kind: 'heading'; readonly level: number; readonly inline: readonly ArticleInline[] }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: readonly ArticleListItem[] }
  | { readonly kind: 'quote'; readonly inline: readonly ArticleInline[] }
  | { readonly kind: 'code'; readonly language: string | null; readonly text: string }
  | { readonly kind: 'table'; readonly rows: readonly (readonly (readonly ArticleInline[])[])[] }
  | { readonly kind: 'divider' }

/** Words that introduce a media link, e.g. `Image: A lighthouse`. Supplied by the host's locale. */
export interface WebCaptureMediaLabels {
  readonly image: string
  readonly video: string
  readonly audio: string
}

export const DEFAULT_MEDIA_LABELS: WebCaptureMediaLabels = { image: 'Image', video: 'Video', audio: 'Audio' }

export interface CanonicalCounts {
  mediaLinks: number
  droppedLinks: number
  degradedTables: number
  removedControlCharacters: number
  blocks: number
}

interface WalkContext {
  readonly pageUrl: string
  readonly labels: WebCaptureMediaLabels
  readonly counts: CanonicalCounts
  readonly blockHolders: WeakSet<Element>
}

type Wrapper = { readonly kind: 'mark'; readonly mark: ArticleMark } | { readonly kind: 'link'; readonly href: string }

const LANGUAGE_CLASS = new RegExp(`^${CODE_LANGUAGE_CLASS_PREFIX}[a-z0-9][a-z0-9+#.-]{0,23}$`, 'u')
const HTTP_ADDRESS = /^https?:\/\//iu
const ALLOWED_TAGS = [
  'p', 'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'nav', 'address', 'center',
  'figure', 'figcaption', 'details', 'summary', 'dl', 'dt', 'dd',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'hr',
  'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'a', 'strong', 'b', 'em', 'i', 'cite', 'dfn', 'var', 's', 'del', 'strike', 'u', 'ins', 'mark',
  'small', 'big', 'sub', 'sup', 'span', 'abbr', 'time', 'q', 'bdi', 'bdo', 'font', 'wbr', 'br',
  'code', 'kbd', 'samp', 'tt', 'img', 'picture', 'video', 'audio', 'source',
]
const PURIFY_CONFIG: Config = {
  ALLOWED_TAGS,
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'class'],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  ALLOWED_URI_REGEXP: HTTP_ADDRESS,
  // Control labels and option text read as junk once their control is gone.
  ADD_FORBID_CONTENTS: ['button', 'select', 'option', 'optgroup', 'datalist', 'textarea', 'form', 'label', 'fieldset', 'legend', 'dialog', 'menu'],
  KEEP_CONTENT: true,
  WHOLE_DOCUMENT: false,
  RETURN_DOM: true,
}

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'ASIDE', 'NAV', 'ADDRESS', 'CENTER',
  'FIGURE', 'FIGCAPTION', 'DETAILS', 'SUMMARY', 'DL', 'DT', 'DD', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'HR', 'TABLE', 'CAPTION', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD',
])
const HEADING_LEVEL: Readonly<Record<string, number>> = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 }
const MARK_TAGS: Readonly<Record<string, ArticleMark>> = {
  STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', CITE: 'em', DFN: 'em', VAR: 'em', S: 's', DEL: 's', STRIKE: 's',
}
const CODE_TAGS = new Set(['CODE', 'KBD', 'SAMP', 'TT'])
// Nesting of the walk itself; the page was already refused above WEB_CAPTURE_LIMITS.depth.
const MAX_WALK_DEPTH = WEB_CAPTURE_LIMITS.depth + 16

let purifier: Purifier | null = null

function articlePurifier(): Purifier {
  if (purifier) return purifier
  // A private instance, so this hook never affects the app's other sanitizers.
  const instance = DOMPurify(window)
  instance.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName === 'class') data.keepAttr = node.nodeName === 'PRE' && LANGUAGE_CLASS.test(data.attrValue)
    // DOMPurify allows `data:` on media by default, outside ALLOWED_URI_REGEXP.
    else if (data.attrName === 'src' || data.attrName === 'href') data.keepAttr = HTTP_ADDRESS.test(data.attrValue)
  })
  purifier = instance
  return instance
}

/** Sanitizes the article into a body element of DOMPurify's own inert document. */
export function sanitizeArticle(content: Element): HTMLElement {
  return articlePurifier().sanitize(content, PURIFY_CONFIG) as unknown as HTMLElement
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1
}

/** Every element with a block-level descendant, found in one bottom-up pass. */
function findBlockHolders(root: Element): WeakSet<Element> {
  const holders = new WeakSet<Element>()
  const elements = Array.from(root.querySelectorAll('*'))
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index]
    const parent = element.parentElement
    if (parent && (BLOCK_TAGS.has(element.tagName) || holders.has(element))) holders.add(parent)
  }
  return holders
}

function countBlock(ctx: WalkContext, amount = 1): void {
  ctx.counts.blocks += amount
  if (ctx.counts.blocks > WEB_CAPTURE_LIMITS.blocks) throw new WebCaptureRefusalError('tooComplex')
}

function guardDepth(depth: number): void {
  if (depth > MAX_WALK_DEPTH) throw new WebCaptureRefusalError('tooComplex')
}

function cleanText(text: string, ctx: WalkContext): string {
  const clean = removeControlCharacters(text)
  ctx.counts.removedControlCharacters += clean.removed
  return clean.text
}

/**
 * Text as a browser lays it out outside `<pre>`: each run of HTML whitespace is one space. The
 * editor's HTML parser keeps whitespace as written, so source line breaks would become breaks.
 * Non-breaking spaces are not HTML whitespace and stay.
 */
function flowText(text: string, ctx: WalkContext): string {
  return cleanText(text, ctx).replace(/[ \t\n\r\f]+/gu, ' ')
}

// --- Inline content ---

const SPACE: ArticleInline = { kind: 'text', text: ' ' }

/** A media element as `Label: caption`, linked to its http(s) address when it has one. */
function mediaInline(kind: keyof WebCaptureMediaLabels, caption: string | null, src: string | null, ctx: WalkContext, insideLink: boolean): ArticleInline[] {
  const label = singleLine(cleanText(caption ?? '', ctx))
  const text: ArticleInline = { kind: 'text', text: label ? `${ctx.labels[kind]}: ${label}` : ctx.labels[kind] }
  const href = insideLink ? null : articleHref(src, ctx.pageUrl)
  if (href) {
    ctx.counts.mediaLinks += 1
    return [SPACE, { kind: 'link', href, children: [text] }, SPACE]
  }
  return label ? [SPACE, text, SPACE] : []
}

function mediaSource(element: Element): string | null {
  return element.getAttribute('src') ?? element.querySelector('source[src]')?.getAttribute('src') ?? null
}

function elementInline(element: Element, ctx: WalkContext, insideLink: boolean, depth: number): ArticleInline[] {
  const tag = element.tagName
  if (tag === 'BR') return [{ kind: 'break' }]
  if (tag === 'WBR' || tag === 'SOURCE') return []
  if (CODE_TAGS.has(tag)) return [{ kind: 'mark', mark: 'code', children: [{ kind: 'text', text: flowText(element.textContent ?? '', ctx) }] }]
  const mark = MARK_TAGS[tag]
  if (mark) return [{ kind: 'mark', mark, children: inlineChildren(element, ctx, insideLink, depth) }]
  if (tag === 'A') return linkInline(element, ctx, insideLink, depth)
  if (tag === 'Q') return [{ kind: 'text', text: '“' }, ...inlineChildren(element, ctx, insideLink, depth), { kind: 'text', text: '”' }]
  if (tag === 'IMG') return mediaInline('image', element.getAttribute('alt'), element.getAttribute('src'), ctx, insideLink)
  if (tag === 'PICTURE') {
    const image = element.querySelector('img')
    return image ? mediaInline('image', image.getAttribute('alt'), image.getAttribute('src'), ctx, insideLink) : []
  }
  if (tag === 'VIDEO' || tag === 'AUDIO') {
    return mediaInline(tag === 'VIDEO' ? 'video' : 'audio', element.getAttribute('title'), mediaSource(element), ctx, insideLink)
  }
  return inlineChildren(element, ctx, insideLink, depth)
}

function linkInline(element: Element, ctx: WalkContext, insideLink: boolean, depth: number): ArticleInline[] {
  const raw = element.getAttribute('href')
  const href = insideLink ? null : articleHref(raw, ctx.pageUrl)
  const children = inlineChildren(element, ctx, insideLink || href !== null, depth)
  if (href) return [{ kind: 'link', href, children }]
  if (raw && !insideLink) ctx.counts.droppedLinks += 1
  return children
}

function nodeInline(node: Node, ctx: WalkContext, insideLink: boolean, depth: number): ArticleInline[] {
  guardDepth(depth)
  if (node.nodeType === 3) return [{ kind: 'text', text: flowText((node as Text).data, ctx) }]
  return isElement(node) ? elementInline(node, ctx, insideLink, depth + 1) : []
}

function inlineChildren(element: Element, ctx: WalkContext, insideLink: boolean, depth: number): ArticleInline[] {
  return Array.from(element.childNodes).flatMap(child => nodeInline(child, ctx, insideLink, depth))
}

function inlineText(inline: readonly ArticleInline[]): string {
  return inline.map((item) => {
    if (item.kind === 'text') return item.text
    if (item.kind === 'break') return '\n'
    return inlineText(item.children)
  }).join('')
}

function hasContent(inline: readonly ArticleInline[]): boolean {
  return visibleLength(inlineText(inline)) > 0
}

function stripLinks(inline: readonly ArticleInline[]): ArticleInline[] {
  return inline.flatMap((item): ArticleInline[] => {
    if (item.kind === 'link') return stripLinks(item.children)
    if (item.kind === 'mark') return [{ ...item, children: stripLinks(item.children) }]
    return [item]
  })
}

function wrapInline(inline: readonly ArticleInline[], wrappers: readonly Wrapper[]): ArticleInline[] {
  return wrappers.reduceRight<ArticleInline[]>((children, wrapper) => (wrapper.kind === 'link'
    ? [{ kind: 'link', href: wrapper.href, children: stripLinks(children) }]
    : [{ kind: 'mark', mark: wrapper.mark, children }]), [...inline])
}

// --- Blocks ---

interface Flow {
  readonly ctx: WalkContext
  readonly out: ArticleBlock[]
  readonly wrappers: readonly Wrapper[]
  /** Nesting of the list that holds this content; 0 outside lists. */
  readonly listLevel: number
}

function pushBlock(flow: Flow, block: ArticleBlock): void {
  countBlock(flow.ctx)
  flow.out.push(block)
}

function flushParagraph(nodes: Node[], flow: Flow, depth: number): void {
  if (nodes.length === 0) return
  const inline = nodes.flatMap(node => nodeInline(node, flow.ctx, flow.wrappers.some(w => w.kind === 'link'), depth))
  if (hasContent(inline)) pushBlock(flow, { kind: 'paragraph', inline: wrapInline(inline, flow.wrappers) })
}

function isInlineNode(node: Node, ctx: WalkContext): boolean {
  if (node.nodeType === 3) return true
  return isElement(node) && !BLOCK_TAGS.has(node.tagName) && !ctx.blockHolders.has(node)
}

function flowChildren(container: Element, flow: Flow, depth: number): void {
  flowNodes(Array.from(container.childNodes), flow, depth)
}

function flowNodes(nodes: readonly Node[], flow: Flow, depth: number): void {
  guardDepth(depth)
  let run: Node[] = []
  for (const child of nodes) {
    if (isInlineNode(child, flow.ctx)) {
      run.push(child)
      continue
    }
    if (!isElement(child)) continue
    flushParagraph(run, flow, depth)
    run = []
    blockElement(child, flow, depth + 1)
  }
  flushParagraph(run, flow, depth)
}

function flowInto(nodes: readonly Node[], ctx: WalkContext, depth: number, listLevel = 0): ArticleBlock[] {
  const out: ArticleBlock[] = []
  flowNodes(nodes, { ctx, out, wrappers: [], listLevel }, depth)
  return out
}

const childNodes = (element: Element): Node[] => Array.from(element.childNodes)

function blockInline(block: ArticleBlock): ArticleInline[] {
  if (block.kind === 'paragraph' || block.kind === 'heading' || block.kind === 'quote') return [...block.inline]
  if (block.kind === 'code') return [{ kind: 'text', text: block.text }]
  if (block.kind === 'list') return block.items.flatMap((item, index) => [...(index > 0 ? [{ kind: 'break' } as const] : []), ...item.inline])
  if (block.kind === 'table') return block.rows.flatMap((row, index) => [...(index > 0 ? [{ kind: 'break' } as const] : []), ...joinCells(row)])
  return []
}

/** One line of inline content from blocks: their text joined by spaces. */
function flattenInline(blocks: readonly ArticleBlock[]): ArticleInline[] {
  return blocks.flatMap((block, index) => [...(index > 0 ? [{ kind: 'text', text: ' ' } as const] : []), ...blockInline(block)])
}

function headingBlock(element: Element, level: number, flow: Flow, depth: number): void {
  const inline = flow.ctx.blockHolders.has(element)
    ? flattenInline(flowInto(childNodes(element), flow.ctx, depth))
    : inlineChildren(element, flow.ctx, flow.wrappers.some(w => w.kind === 'link'), depth)
  if (hasContent(inline)) pushBlock(flow, { kind: 'heading', level, inline: wrapInline(inline, flow.wrappers) })
}

function trimBlankLines(text: string): string {
  const lines = text.split('\n')
  let start = 0
  let end = lines.length
  while (start < end && lines[start].trim() === '') start += 1
  while (end > start && lines[end - 1].trim() === '') end -= 1
  return lines.slice(start, end).join('\n')
}

function codeBlock(pre: Element, flow: Flow): void {
  const text = trimBlankLines(cleanText(pre.textContent ?? '', flow.ctx))
  if (!text) return
  const name = pre.getAttribute('class') ?? ''
  const language = LANGUAGE_CLASS.test(name) ? name.slice(CODE_LANGUAGE_CLASS_PREFIX.length) : null
  pushBlock(flow, { kind: 'code', language, text })
}

function listItemFrom(blocks: ArticleBlock[], level: number, ctx: WalkContext): ArticleListItem {
  const [first, ...rest] = blocks
  const inline = first?.kind === 'paragraph' ? first.inline : []
  const others = first?.kind === 'paragraph' ? rest : blocks
  return { inline, children: others.flatMap(block => listItemChild(block, level, ctx)) }
}

/** Blocks a list item can hold in the note; anything else becomes paragraphs inside the item. */
function listItemChild(block: ArticleBlock, level: number, ctx: WalkContext): ArticleBlock[] {
  if (block.kind === 'paragraph' || block.kind === 'code') return [block]
  if (block.kind === 'list') return level < WEB_CAPTURE_LIMITS.listDepth ? [block] : listAsParagraphs(block)
  if (block.kind === 'divider') return []
  if (block.kind === 'table') {
    ctx.counts.degradedTables += 1
    return block.rows.map(row => ({ kind: 'paragraph', inline: joinCells(row) }))
  }
  return [{ kind: 'paragraph', inline: blockInline(block) }]
}

function listAsParagraphs(list: Extract<ArticleBlock, { kind: 'list' }>): ArticleBlock[] {
  return list.items.flatMap(item => [
    ...(hasContent(item.inline) ? [{ kind: 'paragraph', inline: item.inline } as const] : []),
    ...item.children.flatMap(child => (child.kind === 'list' ? listAsParagraphs(child) : [child])),
  ])
}

/**
 * A list at nesting `level` (1 at the top). Its items' own lists are one level deeper; past
 * `listDepth` they become paragraphs inside the deepest kept item.
 */
function listBlock(element: Element, flow: Flow, depth: number, level: number): ArticleBlock {
  const items: ArticleListItem[] = []
  const ctx = flow.ctx
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 3) {
      const text = flowText((child as Text).data, ctx)
      if (visibleLength(text) > 0) items.push({ inline: [{ kind: 'text', text }], children: [] })
      continue
    }
    if (!isElement(child)) continue
    if (child.tagName === 'UL' || child.tagName === 'OL') {
      // A list placed directly in a list belongs to the item before it.
      const nested = listBlock(child, flow, depth + 1, level + 1)
      const previous = items.pop() ?? { inline: [], children: [] }
      items.push({ inline: previous.inline, children: [...previous.children, ...listItemChild(nested, level, ctx)] })
      continue
    }
    const blocks = flowInto(child.tagName === 'LI' ? childNodes(child) : [child], ctx, depth + 1, level)
    if (blocks.length > 0) items.push(listItemFrom(blocks, level, ctx))
  }
  countBlock(ctx, items.length)
  return { kind: 'list', ordered: element.tagName === 'OL', items: items.map(item => ({ ...item, inline: wrapInline(item.inline, flow.wrappers) })) }
}

function quoteLines(blocks: readonly ArticleBlock[], flow: Flow): void {
  for (const block of blocks) {
    if (block.kind === 'paragraph' || block.kind === 'heading') pushBlock(flow, { kind: 'quote', inline: block.inline })
    else if (block.kind === 'quote') pushBlock(flow, block)
    else if (block.kind === 'list') quoteList(block, flow)
    else pushBlock(flow, block)
  }
}

/** A list inside a quote becomes quoted lines, each starting with its visible marker. */
function quoteList(list: Extract<ArticleBlock, { kind: 'list' }>, flow: Flow): void {
  list.items.forEach((item, index) => {
    const marker = list.ordered ? `${index + 1}. ` : '• '
    if (hasContent(item.inline)) pushBlock(flow, { kind: 'quote', inline: [{ kind: 'text', text: marker }, ...item.inline] })
    quoteLines(item.children, flow)
  })
}

function quoteBlock(element: Element, flow: Flow, depth: number): void {
  const inner = flowInto(childNodes(element), flow.ctx, depth, flow.listLevel)
  const wrapped = inner.map(block => (block.kind === 'paragraph' || block.kind === 'heading' || block.kind === 'quote'
    ? { ...block, inline: wrapInline(block.inline, flow.wrappers) }
    : block))
  quoteLines(wrapped, flow)
}

function cellHoldsBlocks(cell: Element, ctx: WalkContext): boolean {
  if (!ctx.blockHolders.has(cell)) return false
  const children = Array.from(cell.children)
  const blockChildren = children.filter(child => BLOCK_TAGS.has(child.tagName) || ctx.blockHolders.has(child))
  return !(blockChildren.length === 1 && blockChildren[0].tagName === 'P' && !ctx.blockHolders.has(blockChildren[0]))
}

/** A cell's inline content; a single paragraph inside it reads as part of that content. */
function cellInline(cell: Element, ctx: WalkContext, depth: number): ArticleInline[] {
  return Array.from(cell.childNodes).flatMap(child => (isElement(child) && child.tagName === 'P'
    ? [SPACE, ...inlineChildren(child, ctx, false, depth), SPACE]
    : nodeInline(child, ctx, false, depth)))
}

function joinCells(row: readonly (readonly ArticleInline[])[]): ArticleInline[] {
  return row.flatMap((cell, index) => [...(index > 0 ? [{ kind: 'text', text: ' | ' } as const] : []), ...cell])
}

function spanOf(cell: Element, name: 'colspan' | 'rowspan'): number {
  const value = Number.parseInt(cell.getAttribute(name) ?? '1', 10)
  return Number.isFinite(value) && value > 1 ? value : 1
}

function tableBlock(table: HTMLTableElement, flow: Flow, depth: number): void {
  const ctx = flow.ctx
  if (table.caption) flowChildren(table.caption, flow, depth)
  const rows = Array.from(table.rows)
  const cells = rows.map(row => Array.from(row.cells))
  if (cells.some(row => row.some(cell => cellHoldsBlocks(cell, ctx)))) {
    // A layout table: its cells are page sections, so they are walked in reading order.
    ctx.counts.degradedTables += 1
    for (const cell of cells.flat()) flowChildren(cell, flow, depth + 1)
    return
  }
  const grid = cells.map(row => row.map(cell => cellInline(cell, ctx, depth + 1)))
  const width = grid[0]?.length ?? 0
  const rectangular = width > 0 && grid.every(row => row.length === width)
    && cells.every(row => row.every(cell => spanOf(cell, 'colspan') === 1 && spanOf(cell, 'rowspan') === 1))
  if (rectangular) {
    countBlock(ctx, grid.length)
    flow.out.push({ kind: 'table', rows: grid.map(row => row.map(cell => wrapInline(cell, flow.wrappers))) })
    return
  }
  ctx.counts.degradedTables += 1
  for (const row of grid) {
    const inline = joinCells(row)
    if (hasContent(inline)) pushBlock(flow, { kind: 'paragraph', inline: wrapInline(inline, flow.wrappers) })
  }
}

function inlineWrapper(element: Element, ctx: WalkContext, insideLink: boolean): Wrapper | null {
  const mark = MARK_TAGS[element.tagName]
  if (mark) return { kind: 'mark', mark }
  if (element.tagName !== 'A' || insideLink) return null
  const href = articleHref(element.getAttribute('href'), ctx.pageUrl)
  return href ? { kind: 'link', href } : null
}

function blockElement(element: Element, flow: Flow, depth: number): void {
  guardDepth(depth)
  const tag = element.tagName
  const level = HEADING_LEVEL[tag]
  if (level) return headingBlock(element, level, flow, depth)
  switch (tag) {
    case 'UL':
    case 'OL':
      pushBlock(flow, listBlock(element, flow, depth, flow.listLevel + 1))
      return
    case 'IMG':
    case 'PICTURE':
    case 'VIDEO':
    case 'AUDIO':
      // Media with fallback content: the fallback is for browsers without the player, not text.
      return flushParagraph([element], flow, depth)
    case 'BLOCKQUOTE':
      return quoteBlock(element, flow, depth)
    case 'PRE':
      return codeBlock(element, flow)
    case 'TABLE':
      return tableBlock(element as HTMLTableElement, flow, depth)
    case 'HR':
      return pushBlock(flow, { kind: 'divider' })
    default: {
      // Containers, and inline elements that hold blocks (a link around a card, say).
      const wrapper = BLOCK_TAGS.has(tag) ? null : inlineWrapper(element, flow.ctx, flow.wrappers.some(w => w.kind === 'link'))
      flowChildren(element, wrapper ? { ...flow, wrappers: [...flow.wrappers, wrapper] } : flow, depth)
    }
  }
}

export interface CanonicalArticle {
  readonly blocks: readonly ArticleBlock[]
  readonly counts: CanonicalCounts
}

/** Walks the sanitized article into the block model. */
export function canonicalArticle(body: HTMLElement, pageUrl: string, labels: WebCaptureMediaLabels = DEFAULT_MEDIA_LABELS): CanonicalArticle {
  const counts: CanonicalCounts = { mediaLinks: 0, droppedLinks: 0, degradedTables: 0, removedControlCharacters: 0, blocks: 0 }
  const ctx: WalkContext = { pageUrl, labels, counts, blockHolders: findBlockHolders(body) }
  return { blocks: flowInto(childNodes(body), ctx, 0), counts }
}

// --- Minimal HTML for the editor's parser ---

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character] ?? character)
}

const MARK_HTML: Readonly<Record<ArticleMark, string>> = { strong: 'strong', em: 'em', s: 's', code: 'code' }

function inlineHtml(inline: readonly ArticleInline[]): string {
  return inline.map((item) => {
    if (item.kind === 'text') return escapeHtml(item.text)
    if (item.kind === 'break') return '<br>'
    if (item.kind === 'link') return `<a href="${escapeHtml(item.href)}">${inlineHtml(item.children)}</a>`
    const tag = MARK_HTML[item.mark]
    return `<${tag}>${inlineHtml(item.children)}</${tag}>`
  }).join('')
}

function itemHtml(item: ArticleListItem): string {
  return `<li><p>${inlineHtml(item.inline)}</p>${blocksHtml(item.children)}</li>`
}

function blockHtml(block: ArticleBlock): string {
  switch (block.kind) {
    case 'paragraph':
      return `<p>${inlineHtml(block.inline)}</p>`
    case 'heading':
      return `<h${block.level}>${inlineHtml(block.inline)}</h${block.level}>`
    case 'quote':
      return `<blockquote><p>${inlineHtml(block.inline)}</p></blockquote>`
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul'
      return `<${tag}>${block.items.map(itemHtml).join('')}</${tag}>`
    }
    case 'code': {
      // The page's hint is settled first: where the app schema is loaded (BlockNote's `extend`
      // adds its blocks to the shared default specs), `language-html` or `language-mermaid` on
      // a <pre><code> parses straight into a live HTML or Mermaid block.
      const language = settleCodeLanguage(block.language, block.text)
      const label = language === 'text' ? '' : ` class="${CODE_LANGUAGE_CLASS_PREFIX}${escapeHtml(language)}"`
      return `<pre><code${label}>${escapeHtml(block.text)}</code></pre>`
    }
    case 'table':
      return `<table><tbody>${block.rows.map((row, index) => `<tr>${row.map(cell => (index === 0
        ? `<th>${inlineHtml(cell)}</th>`
        : `<td>${inlineHtml(cell)}</td>`)).join('')}</tr>`).join('')}</tbody></table>`
    case 'divider':
      return '<hr>'
  }
}

export function blocksHtml(blocks: readonly ArticleBlock[]): string {
  return blocks.map(blockHtml).join('')
}
