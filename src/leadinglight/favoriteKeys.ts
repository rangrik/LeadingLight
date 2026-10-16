import { isMap, parseDocument } from 'yaml'

// Pure text helpers only: the browser mock and server build import this, so no app hooks here.

export type FavoriteState = { favorite: true; favoriteIndex: number } | { favorite: false; favoriteIndex: null }

export type NativeRefusal = 'missing' | 'link' | 'changedOnDisk' | 'invalidFrontmatter' | 'outsideVault'

export type NativeFavoriteResult =
  | { status: 'committed'; content: string; written: boolean; durable: boolean }
  | { status: 'refused'; reason: NativeRefusal }
  | { status: 'failed'; reason: 'stage' | 'publish' }
  | { status: 'uncertain'; originalAt: string | null; stagedAt: string | null }

const DELIMITER = /^---[ \t]*$/
const BLANK_OR_COMMENT = /^[ \t]*(?:#|$)/
const COMMENT = /^[ \t]*#/
const CONTINUATION = /^(?:[ \t]|-(?:[ \t]|$)|$)/
const KEYS = [
  ['_favorite', /^(?:_favorite|"_favorite"|'_favorite')[ \t]*:(?:[ \t]|$)/],
  ['_favorite_index', /^(?:_favorite_index|"_favorite_index"|'_favorite_index')[ \t]*:(?:[ \t]|$)/],
] as const

interface Line { text: string; end: string }
interface FrontmatterBlock { head: string; lines: Line[]; tail: string; lineEnding: string }
type Metadata = Record<string, unknown>

function lineEnd(content: string, start: number): number {
  for (let index = start; index < content.length; index++) {
    const char = content[index]
    if (char === '\n' || char === '\r') return index
  }
  return content.length
}

function lineBreak(content: string, index: number): string | null {
  if (content.startsWith('\r\n', index)) return '\r\n'
  const char = content[index]
  return char === '\n' || char === '\r' ? char : null
}

/** Mirrors the native parser: `null` without a block, `'unclosed'` when the block never ends. */
function splitBlock(content: string): FrontmatterBlock | null | 'unclosed' {
  const openingEnd = lineEnd(content, 0)
  const lineEnding = lineBreak(content, openingEnd)
  if (!DELIMITER.test(content.slice(0, openingEnd)) || lineEnding === null) return null
  const bodyStart = openingEnd + lineEnding.length
  const lines: Line[] = []
  let lineStart = bodyStart
  while (lineStart < content.length) {
    const end = lineEnd(content, lineStart)
    const text = content.slice(lineStart, end)
    if (DELIMITER.test(text)) return { head: content.slice(0, bodyStart), lines, tail: content.slice(lineStart), lineEnding }
    const next = lineBreak(content, end)
    if (next === null) break
    lines.push({ text, end: next })
    lineStart = end + next.length
  }
  return 'unclosed'
}

const textOf = (lines: Line[]) => lines.map(line => line.text + line.end).join('')

/** The block as plain data, `{}` when empty; null unless it is one valid mapping with unique keys. */
function metadataOf(lines: Line[]): Metadata | null {
  const doc = parseDocument(textOf(lines), { uniqueKeys: true })
  if (doc.errors.length > 0) return null
  try {
    const data: unknown = doc.toJS()
    if (data == null) return {}
    return isMap(doc.contents) ? (data as Metadata) : null
  } catch {
    return null // Too many aliases to expand.
  }
}

function readMetadata(content: string): { block: FrontmatterBlock | null; data: Metadata } | null {
  const block = splitBlock(content)
  if (block === 'unclosed') return null
  const data = block ? metadataOf(block.lines) : {}
  return data && { block, data }
}

function hasState(data: Metadata, state: FavoriteState): boolean {
  if (!state.favorite) return data._favorite === undefined && data._favorite_index === undefined
  return data._favorite === true && data._favorite_index === state.favoriteIndex
}

function othersOf(data: Metadata): string {
  const others = { ...data }
  delete others._favorite
  delete others._favorite_index
  return JSON.stringify(others)
}

interface Span { start: number; end: number }

/** End of the value whose key is on line `start`, without trailing blank or comment lines. */
function valueEnd(lines: Line[], start: number): number {
  let end = start + 1
  while (end < lines.length && CONTINUATION.test(lines[end].text)) end++
  while (end > start + 1 && BLANK_OR_COMMENT.test(lines[end - 1].text)) end--
  return end
}

/** Lines [start, end) of a top-level key and its value. */
function keySpan(lines: Line[], pattern: RegExp): Span | null {
  const start = lines.findIndex(line => pattern.test(line.text))
  return start === -1 ? null : { start, end: valueEnd(lines, start) }
}

const holdsComment = (lines: Line[], { start, end }: Span) => lines.slice(start + 1, end).some(line => COMMENT.test(line.text))

/** Null when a comment sits inside a Favorite value, since replacing the value would drop it. */
function patchLines(lines: Line[], state: FavoriteState, lineEnding: string): Line[] | null {
  const line = (key: string, end: string) => ({ text: `${key}: ${key === '_favorite' ? 'true' : state.favoriteIndex}`, end })
  const spans = KEYS.map(([key, pattern]) => ({ key, span: keySpan(lines, pattern) }))
  const found = spans.flatMap(({ key, span }) => (span ? [{ key, ...span }] : [])).sort((a, b) => a.start - b.start)
  if (found.some(span => holdsComment(lines, span))) return null
  const next: Line[] = []
  let index = 0
  for (const { key, start, end } of found) {
    next.push(...lines.slice(index, start))
    if (state.favorite) next.push(line(key, lines[end - 1].end))
    index = end
  }
  next.push(...lines.slice(index))
  if (state.favorite) for (const { key, span } of spans) if (!span) next.push(line(key, lineEnding))
  return next
}

/**
 * Changes only the two Favorite keys, the same way the native command does. Null when the block
 * is not one valid mapping, or when a reparse shows anything else would change.
 */
export function patchFavoriteKeys(content: string, state: FavoriteState): string | null {
  const page = readMetadata(content)
  if (!page) return null
  if (hasState(page.data, state)) return content
  const block = page.block ?? { head: '---\n', lines: [], tail: `---\n${content}`, lineEnding: '\n' }
  const lines = patchLines(block.lines, state, block.lineEnding)
  if (!lines) return null
  const after = metadataOf(lines)
  if (!after || !hasState(after, state) || othersOf(after) !== othersOf(page.data)) return null
  return block.head + textOf(lines) + block.tail
}

const TOP_LEVEL_KEY = /^(?:"([^"]*)"|'([^']*)'|([^\s#'"?:-][^:]*?))[ \t]*:(?:[ \t]|$)/

function groupSpans(lines: Line[], inGroup: (key: string) => boolean): Span[] {
  const spans: Span[] = []
  for (let start = 0; start < lines.length; start++) {
    const match = TOP_LEVEL_KEY.exec(lines[start].text)
    if (!match || !inGroup(match[1] ?? match[2] ?? match[3])) continue
    spans.push({ start, end: valueEnd(lines, start) })
    start = spans[spans.length - 1].end - 1
  }
  return spans
}

const entriesOf = (data: Metadata, inGroup: (key: string) => boolean, wanted: boolean) =>
  JSON.stringify(Object.entries(data).filter(([key]) => inGroup(key) === wanted))

/**
 * The draft with the committed text's lines for one group of top-level keys, every other byte kept.
 * Null when that can't be done exactly, so the caller keeps the draft unsaved instead.
 */
export function carryTopLevelKeys(draft: string, committed: string, inGroup: (key: string) => boolean): string | null {
  const source = readMetadata(committed)
  const target = readMetadata(draft)
  if (!source || !target) return null
  const block = target.block ?? { head: '---\n', lines: [], tail: `---\n${draft}`, lineEnding: '\n' }
  const from = source.block?.lines ?? []
  const carried = groupSpans(from, inGroup).flatMap(({ start, end }) => from.slice(start, end))
  const spans = groupSpans(block.lines, inGroup)
  if (spans.some(span => holdsComment(block.lines, span))) return null
  if (!target.block && carried.length === 0) return draft
  const kept = block.lines.filter((_, index) => !spans.some(({ start, end }) => index >= start && index < end))
  const at = spans.length > 0 ? spans[0].start : kept.length
  const lines = [...kept.slice(0, at), ...carried.map(({ text }) => ({ text, end: block.lineEnding })), ...kept.slice(at)]
  const after = metadataOf(lines)
  if (!after || entriesOf(after, inGroup, false) !== entriesOf(target.data, inGroup, false)) return null
  if (entriesOf(after, inGroup, true) !== entriesOf(source.data, inGroup, true)) return null
  return block.head + textOf(lines) + block.tail
}

/** Reads both keys from a page's text, or null when its block can't be read. */
export function favoriteStateOf(content: string): FavoriteState | null {
  const data = readMetadata(content)?.data
  if (!data) return null
  if (data._favorite !== true) return { favorite: false, favoriteIndex: null }
  const index = data._favorite_index
  return { favorite: true, favoriteIndex: typeof index === 'number' && Number.isFinite(index) ? index : 1 }
}
