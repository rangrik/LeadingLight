// Stage 3 of website capture: the editor's own HTML parser (a headless default-schema BlockNote
// editor, the same parser paste uses) reads the minimal HTML, and this normalizer turns its blocks
// into the note's block model: only paragraphs, headings, list items, quotes, code, simple tables
// and dividers; only bold, italic, strike and code marks; only links the URL policy accepted.
// It also produces the comparable summary the reopen check uses, for both sides of that check.
import { BlockNoteEditor } from '@blocknote/core'
import { inferCodeBlockLanguage } from '../../utils/codeBlockLanguage'
import { canonicalKnownCodeBlockLanguage } from '../../utils/codeBlockLanguageCatalog'
import { htmlBlockMarkdownCodec } from '../../utils/htmlBlockMarkdown'
import { readMarkdownHighlightPrefix } from '../../utils/markdownHighlightMarkdown'
import { mermaidMarkdownCodec } from '../../utils/mermaidMarkdown'
import { tldrawMarkdownCodec } from '../../utils/tldrawMarkdown'
import { WebCaptureRefusalError, assertLiteralText } from './articleText'
import { WEB_CAPTURE_LIMITS } from './webCaptureContract'

export type NoteStyle = 'bold' | 'code' | 'italic' | 'strike'

export interface NoteRun {
  readonly text: string
  /** Sorted. */
  readonly styles: readonly NoteStyle[]
  readonly href: string | null
}

export type NoteBlock =
  | { readonly type: 'paragraph' | 'quote'; runs: NoteRun[] }
  | { readonly type: 'bulletListItem' | 'numberedListItem'; runs: NoteRun[]; readonly children: NoteBlock[] }
  | { readonly type: 'heading'; readonly level: number; runs: NoteRun[] }
  | { readonly type: 'codeBlock'; readonly language: string; readonly code: string }
  | { readonly type: 'table'; rows: NoteRun[][][] }
  | { readonly type: 'divider' }

export interface BlockCounts {
  droppedLinks: number
  splitCodeBlocks: number
  degradedTables: number
  plainBlocks: number
}

type JsonRecord = Record<string, unknown>

const NOTE_STYLES: readonly NoteStyle[] = ['bold', 'code', 'italic', 'strike']
const PLAIN_LANGUAGES = new Set(['', 'none', 'plain', 'plaintext', 'text', 'txt'])
// HTML source is shown as markup code and never labelled `html`, which the editor runs as a block.
const MARKUP_LANGUAGES = new Set(['html', 'htm', 'xhtml', 'html5', 'markup'])
const MARKUP_LABEL = 'xml'
// Labels whose fence is a live diagram or board in the editor; their source stays plain code.
const DIAGRAM_LANGUAGES = new Set(['mermaid', 'tldraw'])
const DURABLE_CODECS = [htmlBlockMarkdownCodec, mermaidMarkdownCodec, tldrawMarkdownCodec] as const
const HORIZONTAL_SPACE = /[^\S\n]/u
const WHITESPACE = /\s/u

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function items(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function notExact(): WebCaptureRefusalError {
  return new WebCaptureRefusalError('notExact')
}

// --- Runs ---

function sameFormat(a: NoteRun, b: NoteRun): boolean {
  return a.href === b.href && a.styles.length === b.styles.length && a.styles.every((style, index) => style === b.styles[index])
}

function mergeRuns(runs: readonly NoteRun[]): NoteRun[] {
  const merged: NoteRun[] = []
  for (const run of runs) {
    if (!run.text) continue
    const last = merged.at(-1)
    if (last && sameFormat(last, run)) merged[merged.length - 1] = { ...last, text: last.text + run.text }
    else merged.push(run)
  }
  return merged
}

function runsText(runs: readonly NoteRun[]): string {
  return runs.map(run => run.text).join('')
}

/** Rebuilds runs from their joined text, keeping only the positions `keep` marks. */
function maskRuns(runs: readonly NoteRun[], keep: Uint8Array): NoteRun[] {
  let offset = 0
  const masked = runs.map((run) => {
    let text = ''
    for (let index = 0; index < run.text.length; index += 1) if (keep[offset + index]) text += run.text[index]
    offset += run.text.length
    return { ...run, text }
  })
  return mergeRuns(masked)
}

/**
 * Removes whitespace the note's Markdown cannot hold: at the start and end of the block, and
 * around each line break. Blank lines collapse to one (`keepBlankLines`), or disappear.
 */
function trimRuns(runs: readonly NoteRun[], keepBlankLines: boolean): NoteRun[] {
  const text = runsText(runs)
  const keep = new Uint8Array(text.length).fill(1)
  let start = 0
  while (start < text.length && WHITESPACE.test(text[start])) keep[start++] = 0
  let end = text.length
  while (end > start && WHITESPACE.test(text[end - 1])) keep[--end] = 0
  for (let index = start; index < end; index += 1) {
    if (text[index] !== '\n') continue
    for (let scan = index - 1; scan >= start && HORIZONTAL_SPACE.test(text[scan]); scan -= 1) keep[scan] = 0
    for (let scan = index + 1; scan < end && HORIZONTAL_SPACE.test(text[scan]); scan += 1) keep[scan] = 0
  }
  const maxBreaks = keepBlankLines ? 2 : 1
  let breaks = 0
  let previous = ''
  for (let index = start; index < end; index += 1) {
    if (!keep[index]) continue
    breaks = text[index] === '\n' ? breaks + 1 : 0
    // One space between words, across runs too, as a browser shows them.
    if (breaks > maxBreaks || (text[index] === ' ' && previous === ' ')) keep[index] = 0
    else previous = text[index]
  }
  return maskRuns(runs, keep)
}

function replaceBreaks(runs: readonly NoteRun[]): NoteRun[] {
  return mergeRuns(runs.map(run => ({ ...run, text: run.text.replace(/\n/gu, ' ') })))
}

function sliceRuns(runs: readonly NoteRun[], from: number, to: number): NoteRun[] {
  const sliced: NoteRun[] = []
  let offset = 0
  for (const run of runs) {
    const runStart = offset
    offset += run.text.length
    const text = run.text.slice(Math.max(0, from - runStart), Math.max(0, to - runStart))
    if (text) sliced.push({ ...run, text })
  }
  return sliced
}

/** Splits trimmed runs at their blank lines into separate blocks' runs. */
function splitAtBlankLines(runs: readonly NoteRun[]): NoteRun[][] {
  const text = runsText(runs)
  const parts: NoteRun[][] = []
  let from = 0
  for (let index = text.indexOf('\n\n'); index !== -1; index = text.indexOf('\n\n', from)) {
    parts.push(sliceRuns(runs, from, index))
    from = index + 2
  }
  parts.push(sliceRuns(runs, from, text.length))
  return parts.filter(part => part.length > 0)
}

function isHighlightDelimiter(text: string): boolean {
  if (!text.startsWith('==')) return false
  const prefix = text.slice(2)
  return prefix === '' || readMarkdownHighlightPrefix(prefix).text === ''
}

function endsWithOddBackslashes(text: string): boolean {
  let count = 0
  for (let index = text.length - 1; index >= 0 && text[index] === '\\'; index -= 1) count += 1
  return count % 2 === 1
}

/**
 * Cross-run constructs the canonical serializer cannot write literally, and the degrade level that
 * removes them: 1 drops marks, 2 drops links too. Measured in the reopen tests; the reopen check
 * still catches anything not listed here.
 */
function runHazardLevel(runs: readonly NoteRun[]): 0 | 1 | 2 {
  let level: 0 | 1 | 2 = 0
  runs.forEach((run, index) => {
    const next = runs.at(index + 1)
    // An unstyled `==` or `==red` alone in a run is written as a highlight delimiter.
    if (run.styles.length === 0 && isHighlightDelimiter(run.text)) level = Math.max(level, run.href ? 2 : 1) as 0 | 1 | 2
    // A trailing backslash escapes the next run's opening marker.
    if (next && endsWithOddBackslashes(run.text)) level = Math.max(level, next.href !== run.href ? 2 : 1) as 0 | 1 | 2
  })
  return level
}

/** Unlinks a link that directly follows `!`, which would reopen as an image. */
function unlinkAfterBang(runs: readonly NoteRun[], counts: BlockCounts): NoteRun[] {
  const result = [...runs]
  for (let index = 1; index < result.length; index += 1) {
    const before = result[index - 1]
    const run = result[index]
    if (run.href === null || before.href === run.href || !before.text.endsWith('!')) continue
    counts.droppedLinks += 1
    const href = run.href
    for (let scan = index; scan < result.length && result[scan].href === href; scan += 1) result[scan] = { ...result[scan], href: null }
  }
  return mergeRuns(result)
}

export function degradeRuns(runs: readonly NoteRun[], level: 1 | 2): NoteRun[] {
  return mergeRuns(runs.map(run => ({ text: run.text, styles: [], href: level === 2 ? null : run.href })))
}

function finishRuns(runs: readonly NoteRun[], counts: BlockCounts): NoteRun[] {
  const safe = unlinkAfterBang(runs, counts)
  const level = runHazardLevel(safe)
  if (level === 0) return safe
  counts.plainBlocks += 1
  return degradeRuns(safe, level)
}

// --- Reading the editor's blocks ---

function textStyles(styles: unknown): NoteStyle[] {
  if (!isRecord(styles)) return []
  return NOTE_STYLES.filter(style => styles[style] === true)
}

function textRun(item: JsonRecord, href: string | null): NoteRun {
  const styles = textStyles(item.styles)
  const text = typeof item.text === 'string' ? item.text : ''
  // A code span cannot hold a line break.
  return { text: styles.includes('code') ? text.replace(/\n/gu, ' ') : text, styles, href }
}

function editorRuns(content: unknown): NoteRun[] {
  const runs: NoteRun[] = []
  for (const item of items(content)) {
    if (!isRecord(item)) throw notExact()
    if (item.type === 'text') runs.push(textRun(item, null))
    else if (item.type === 'link' && typeof item.href === 'string') {
      for (const child of items(item.content)) {
        if (!isRecord(child) || child.type !== 'text') throw notExact()
        runs.push(textRun(child, item.href))
      }
    } else throw notExact()
  }
  return mergeRuns(runs)
}

function codeText(content: unknown): string {
  return items(content).map(item => (isRecord(item) && typeof item.text === 'string' ? item.text : '')).join('')
}

function becomesEditorBlock(language: string, code: string): boolean {
  const block = { type: 'codeBlock', props: { language }, content: [{ type: 'text', text: code, styles: {} }] }
  return DURABLE_CODECS.some(codec => codec.readFenceMetadata(language) !== null || (codec.readCodeBlock?.(block) ?? null) !== null)
}

/**
 * The label the editor itself settles on for this code, so the saved fence is already its
 * canonical form: aliases canonicalised, plain code labelled the way the editor would infer it,
 * markup never `html`, and a `txt` label where a bare fence would be read as a diagram.
 */
export function settleCodeLanguage(hint: string | null, code: string): string {
  const raw = (hint ?? '').toLowerCase()
  if (MARKUP_LANGUAGES.has(raw)) return MARKUP_LABEL
  let language = DIAGRAM_LANGUAGES.has(raw) ? '' : canonicalKnownCodeBlockLanguage(raw) ?? raw
  if (PLAIN_LANGUAGES.has(language)) {
    const inferred = inferCodeBlockLanguage(code)
    if (inferred === 'html') return MARKUP_LABEL
    language = inferred === null ? 'text' : canonicalKnownCodeBlockLanguage(inferred) ?? inferred
  }
  if (becomesEditorBlock(language, code)) language = 'txt'
  if (becomesEditorBlock(language, code)) throw new WebCaptureRefusalError('unsafeText')
  return language
}

function isFenceLikeLine(line: string): boolean {
  const trimmed = line.trimStart()
  return trimmed.startsWith('```') || trimmed.startsWith('~~~')
}

function trimBlankEdges(lines: string[]): string {
  let start = 0
  let end = lines.length
  while (start < end && lines[start].trim() === '') start += 1
  while (end > start && lines[end - 1].trim() === '') end -= 1
  return lines.slice(start, end).join('\n')
}

/**
 * Code as note blocks. A line that starts like a fence would end the note's fence early or flip
 * the math preprocessor's fence tracking, so each such line becomes its own paragraph in code
 * style and the rest stays fenced code in order.
 */
function codeBlocks(hint: string | null, code: string, counts: BlockCounts): NoteBlock[] {
  const lines = code.replace(/\n+$/u, '').split('\n')
  if (!lines.some(isFenceLikeLine)) {
    const text = trimBlankEdges(lines)
    return text ? [{ type: 'codeBlock', language: settleCodeLanguage(hint, text), code: text }] : []
  }
  counts.splitCodeBlocks += 1
  const blocks: NoteBlock[] = []
  let pending: string[] = []
  const flush = () => {
    const text = trimBlankEdges(pending)
    if (text) blocks.push({ type: 'codeBlock', language: settleCodeLanguage(hint, text), code: text })
    pending = []
  }
  for (const line of lines) {
    if (!isFenceLikeLine(line)) {
      pending.push(line)
      continue
    }
    flush()
    blocks.push({ type: 'paragraph', runs: [{ text: line, styles: ['code'], href: null }] })
  }
  flush()
  return blocks
}

function tableCell(cell: unknown): { runs: NoteRun[]; spans: boolean } {
  if (!isRecord(cell)) return { runs: [], spans: false }
  const props = isRecord(cell.props) ? cell.props : {}
  const spans = Number(props.colspan ?? 1) !== 1 || Number(props.rowspan ?? 1) !== 1
  return { runs: trimRuns(replaceBreaks(editorRuns(cell.content)), false), spans }
}

function tableBlocks(content: unknown, counts: BlockCounts): NoteBlock[] {
  const rows = isRecord(content) && content.type === 'tableContent' ? items(content.rows) : []
  const grid = rows.map(row => items(isRecord(row) ? row.cells : []).map(tableCell))
  const width = grid[0]?.length ?? 0
  const regular = width > 0 && grid.every(row => row.length === width && row.every(cell => !cell.spans))
  if (regular) return [{ type: 'table', rows: grid.map(row => row.map(cell => finishRuns(cell.runs, counts))) }]
  counts.degradedTables += 1
  return grid.flatMap((row) => {
    const runs = trimRuns(row.flatMap((cell, index) => (index > 0 ? [{ text: ' | ', styles: [], href: null }, ...cell.runs] : cell.runs)), false)
    return runs.length > 0 ? [{ type: 'paragraph', runs: finishRuns(runs, counts) } as NoteBlock] : []
  })
}

function listItemBlock(type: 'bulletListItem' | 'numberedListItem', block: JsonRecord, counts: BlockCounts): NoteBlock[] {
  let runs = finishRuns(trimRuns(editorRuns(block.content), false), counts)
  const children = noteBlocks(items(block.children), counts)
  // An item whose own line is empty takes its first paragraph, as the note's Markdown would.
  const first = children[0]
  if (runs.length === 0 && first?.type === 'paragraph') {
    runs = first.runs
    children.shift()
  }
  if (runs.length === 0 && children.length === 0) return []
  return [{ type, runs, children }]
}

function blockFrom(block: JsonRecord, counts: BlockCounts): NoteBlock[] {
  const props = isRecord(block.props) ? block.props : {}
  switch (block.type) {
    case 'paragraph':
    case 'quote': {
      const type = block.type
      return splitAtBlankLines(trimRuns(editorRuns(block.content), true)).map(runs => ({ type, runs: finishRuns(runs, counts) }))
    }
    case 'heading': {
      const runs = finishRuns(trimRuns(replaceBreaks(editorRuns(block.content)), false), counts)
      return runs.length > 0 ? [{ type: 'heading', level: Math.min(6, Math.max(1, Number(props.level) || 1)), runs }] : []
    }
    case 'bulletListItem':
    case 'numberedListItem':
      return listItemBlock(block.type, block, counts)
    case 'codeBlock':
      return codeBlocks(typeof props.language === 'string' ? props.language : null, codeText(block.content), counts)
    case 'table':
      return tableBlocks(block.content, counts)
    case 'divider':
      return [{ type: 'divider' }]
    default:
      throw notExact()
  }
}

function noteBlocks(blocks: readonly unknown[], counts: BlockCounts): NoteBlock[] {
  return blocks.flatMap((block) => {
    if (!isRecord(block)) throw notExact()
    const own = blockFrom(block, counts)
    const isList = block.type === 'bulletListItem' || block.type === 'numberedListItem'
    // Only list items hold children in the note; anything else nested follows its parent.
    return isList ? own : [...own, ...noteBlocks(items(block.children), counts)]
  })
}

/** The note keeps one H1, its title: when the article has an H1, every heading moves down one. */
function shiftHeadings(blocks: NoteBlock[]): NoteBlock[] {
  const hasTopLevel = flattenBlocks(blocks).some(({ block }) => block.type === 'heading' && block.level === 1)
  if (!hasTopLevel) return blocks
  return blocks.map(block => (block.type === 'heading' ? { ...block, level: Math.min(6, block.level + 1) } : block))
}

export interface FlatBlock {
  readonly block: NoteBlock
  readonly depth: number
}

export function flattenBlocks(blocks: readonly NoteBlock[], depth = 0): FlatBlock[] {
  return blocks.flatMap(block => [
    { block, depth },
    ...('children' in block ? flattenBlocks(block.children, depth + 1) : []),
  ])
}

function blockTexts(block: NoteBlock): string[] {
  switch (block.type) {
    case 'codeBlock':
      return [block.code]
    case 'table':
      return block.rows.flatMap(row => row.map(runsText))
    case 'divider':
      return []
    default:
      return [runsText(block.runs), ...block.runs.flatMap(run => (run.href ? [run.href] : []))]
  }
}

/** Every text in the note through the accepted literal check; any refusal refuses the page. */
export function assertBlocksLiteral(blocks: readonly NoteBlock[]): void {
  const flat = flattenBlocks(blocks)
  if (flat.length > WEB_CAPTURE_LIMITS.blocks) throw new WebCaptureRefusalError('tooComplex')
  for (const { block } of flat) for (const text of blockTexts(block)) assertLiteralText(text)
}

/** The editor's HTML parser, in a headless default-schema editor discarded after each use. */
export function parseArticleHtml(html: string): unknown[] {
  const editor = BlockNoteEditor.create()
  return editor.tryParseHTMLToBlocks(html) as unknown[]
}

/** Normalizes the editor's parse of the article into the note's block model. */
export function articleNoteBlocks(parsed: readonly unknown[], counts: BlockCounts): NoteBlock[] {
  const blocks = shiftHeadings(noteBlocks(parsed, counts))
  assertBlocksLiteral(blocks)
  return blocks
}

// --- Editor block JSON for the serializer, and the comparable summary ---

function inlineContent(runs: readonly NoteRun[]): JsonRecord[] {
  const content: JsonRecord[] = []
  const text = (run: NoteRun): JsonRecord => ({ type: 'text', text: run.text, styles: Object.fromEntries(run.styles.map(style => [style, true])) })
  for (const run of runs) {
    const last = content.at(-1)
    if (run.href === null) content.push(text(run))
    else if (last?.type === 'link' && last.href === run.href) (last.content as JsonRecord[]).push(text(run))
    else content.push({ type: 'link', href: run.href, content: [text(run)] })
  }
  return content
}

/** Plain block objects in the shape the canonical serializer and the summary read. */
export function toEditorBlocks(blocks: readonly NoteBlock[]): JsonRecord[] {
  return blocks.map((block): JsonRecord => {
    switch (block.type) {
      case 'codeBlock':
        return { type: 'codeBlock', props: { language: block.language }, content: [{ type: 'text', text: block.code, styles: {} }], children: [] }
      case 'table':
        return {
          type: 'table',
          props: {},
          content: { type: 'tableContent', rows: block.rows.map(row => ({ cells: row.map(cell => ({ type: 'tableCell', content: inlineContent(cell), props: { colspan: 1, rowspan: 1 } })) })) },
          children: [],
        }
      case 'divider':
        return { type: 'divider', props: {}, children: [] }
      case 'heading':
        return { type: 'heading', props: { level: block.level }, content: inlineContent(block.runs), children: [] }
      case 'bulletListItem':
      case 'numberedListItem':
        return { type: block.type, props: {}, content: inlineContent(block.runs), children: toEditorBlocks(block.children) }
      default:
        return { type: block.type, props: {}, content: inlineContent(block.runs), children: [] }
    }
  })
}

function styleKeys(styles: unknown): string[] {
  if (!isRecord(styles)) return []
  return Object.entries(styles)
    .filter(([, value]) => value !== false && value !== undefined && value !== null && value !== '' && value !== 'default')
    .map(([name, value]) => (value === true ? name : `${name}=${String(value)}`))
    .sort()
}

interface KeyedText {
  readonly text: string
  readonly key: string
}

function linkText(content: unknown): string {
  return items(content).map(child => (isRecord(child) && typeof child.text === 'string' ? child.text : '')).join('')
}

// A bare address, `www.` name or email the editor links by itself: its target is its own text.
function isAutolink(text: string, href: string): boolean {
  return href === text || href === `http://${text}` || href === `mailto:${text}`
}

function keyedTexts(content: unknown, link: string | null = null): KeyedText[] {
  return items(content).flatMap((item): KeyedText[] => {
    if (!isRecord(item)) return [{ text: '\u0000', key: 'invalid' }]
    if (item.type === 'text') {
      const keys = styleKeys(item.styles)
      if (link) keys.push(`link:${link}`)
      return [{ text: typeof item.text === 'string' ? item.text : '', key: keys.join('+') }]
    }
    if (item.type === 'link' && typeof item.href === 'string') {
      return keyedTexts(item.content, isAutolink(linkText(item.content), item.href) ? link : item.href)
    }
    // Wikilinks, math and anything else the editor injects: never equal to literal text.
    return [{ text: `\u0000${String(item.type)}:${JSON.stringify(item.props ?? null)}`, key: 'inline' }]
  })
}

/** Text with its formatting per visible character; whitespace carries no formatting. */
function inlineSummary(content: unknown): Array<[string, string]> {
  const runs: Array<[string, string]> = []
  for (const { text, key } of keyedTexts(content)) {
    for (const character of text) {
      const characterKey = WHITESPACE.test(character) ? '' : key
      const last = runs.at(-1)
      if (last && last[1] === characterKey) last[0] += character
      else runs.push([character, characterKey])
    }
  }
  return runs
}

function codeLanguage(props: JsonRecord): string {
  const language = typeof props.language === 'string' ? props.language : ''
  return language === '' ? 'text' : language
}

function summaryEntry(block: JsonRecord, depth: number): string {
  const props = isRecord(block.props) ? block.props : {}
  const type = String(block.type)
  switch (type) {
    case 'paragraph':
    case 'quote':
    case 'bulletListItem':
    case 'numberedListItem':
      return JSON.stringify([depth, type, inlineSummary(block.content)])
    case 'heading':
      return JSON.stringify([depth, type, Number(props.level), inlineSummary(block.content)])
    case 'codeBlock':
      return JSON.stringify([depth, type, codeLanguage(props), codeText(block.content)])
    case 'table': {
      const rows = isRecord(block.content) ? items(block.content.rows) : []
      return JSON.stringify([depth, type, rows.map(row => items(isRecord(row) ? row.cells : []).map(cell => inlineSummary(isRecord(cell) ? cell.content : cell)))])
    }
    case 'divider':
      return JSON.stringify([depth, type])
    default:
      return JSON.stringify([depth, type, props, block.content ?? null])
  }
}

/**
 * One comparable entry per block in document order, children after their parent. Equal summaries
 * mean the same blocks, nesting, levels, code and labels, visible characters, marks and links.
 */
export function summarizeEditorBlocks(blocks: readonly unknown[], depth = 0): string[] {
  return blocks.flatMap((block) => {
    if (!isRecord(block)) return [JSON.stringify([depth, 'invalid'])]
    return [summaryEntry(block, depth), ...summarizeEditorBlocks(items(block.children), depth + 1)]
  })
}
