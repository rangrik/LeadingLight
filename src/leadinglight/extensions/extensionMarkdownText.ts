/**
 * Host-owned Markdown encoding for extension-generated literal text.
 *
 * Every string a run supplies (package literals, form answers, captured passages, source titles) is
 * untrusted. The result shows the same characters in LeadingLight's rich editor, below and above the
 * 16 KiB fast-parser threshold and after repeated canonical saves, and cannot become an HTML block,
 * fence, image, explicit link, wikilink, math, callout, highlight, frontmatter, table, list, heading
 * or quote. Measured exceptions, pinned in the tests:
 *
 * - Bare http(s)/www/email text still becomes an http(s)/mailto link; its target matches the visible
 *   text and nothing is fetched.
 * - The plain-CommonMark passive previews (templates, page history) show a backslash before `{` as
 *   `{`, because only the editor keeps that backslash literal.
 *
 * Callers add only trusted block punctuation, in exactly these contexts:
 *
 * - Paragraph: `encodeLiteralMarkdownLines(text).join('\n')`, separated from other blocks by a blank line.
 * - Quote: each line as `line ? `> ${line}` : '>'`, joined with '\n'.
 * - List item: `- ${first}`, then every further line indented by the marker width ('' stays '').
 * - Heading, or after a trusted prefix on one line: `## ${encodeLiteralMarkdownInline(text)}`.
 * - Link label: `[${encodeLiteralMarkdownInline(label)}](${destination})`. The destination must come
 *   from the host's validated-handle encoder; it is never encoded here.
 *
 * Never join an encoded fragment directly to other syntax or to another fragment. Not covered,
 * needing their own typed renderer: link destinations or titles, code, tables, frontmatter values,
 * wikilink targets, file names, HTML attributes, and appending after an existing note whose last
 * block is an unclosed fence or container. Leading/trailing spaces and tabs of each line are
 * dropped, and Unicode line breaks become '\n'; everything else is kept, never truncated.
 */

import { protectedLiteralIndex } from '../../utils/markdownLiteralProtection'

export const LITERAL_MARKDOWN_TEXT_MAX_LENGTH = 256 * 1024

export type LiteralMarkdownTextFailure =
  | 'tooLong'
  | 'lineBreak'
  | 'controlCharacter'
  | 'malformedUnicode'
  | 'reservedMarker'

export class LiteralMarkdownTextError extends Error {
  readonly reason: LiteralMarkdownTextFailure
  /** UTF-16 offset in the caller's original text, when the failure has one. */
  readonly index: number | null
  constructor(reason: LiteralMarkdownTextFailure, index: number | null = null) {
    super(reason)
    this.name = 'LiteralMarkdownTextError'
    this.reason = reason
    this.index = index
  }
}

// Source stays ASCII: U+2028/U+2029 are line terminators inside a JavaScript regex literal.
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff)
const PLACEHOLDER_START = String.fromCharCode(0x2039)

// The rich editor decodes these placeholders from already-parsed text, where no Markdown escape
// applies: `@@TOLARIA_...@@` alone in a block becomes an HTML/Mermaid/tldraw/attachment/math block.
const RESERVED_MARKERS = [
  '@@TOLARIA',
  `${PLACEHOLDER_START}WIKILINK:`,
  `${PLACEHOLDER_START}LINKED_CODE:`,
] as const
const ESCAPED_EVERYWHERE = new Set(['`', '*', '_', '~', '[', ']', '<', '$'])
// Every table delimiter row starts with `|`, `-` or `:`, so a pipe elsewhere cannot form a table.
const ESCAPED_AT_LINE_START = new Set(['#', '-', '+', '=', '>', ':', '|'])
const ASCII_ALPHANUMERIC_RE = /^[A-Za-z0-9]$/u
const WORD_RE = /\S+/gu
const URL_START_RE = /(?:^|[^A-Za-z0-9])(https?:\/\/|www\.)/iu
const EMAIL_LOCAL_CHARACTER_RE = /^[A-Za-z0-9._+-]$/u
const TRAILING_LINK_PUNCTUATION = new Set(['!', '"', '&', "'", ')', ',', '.', ':', ';', '?', ']', '}', '*', '_', '~'])
// remark-gfm links URLs and emails from the raw source (and again from decoded text, so escaping
// cannot prevent the link); an inserted backslash would land in its text and target. `_` and `&`
// stay raw there: at worst they become emphasis or a character reference, never markup.
const LINK_SAFE_CHARACTERS = new Set(['_', '&'])
const EQUALS_RUN_RE = /={2,}/gu

interface LineScan {
  line: string
  contentStart: number
  orderedDelimiter: number
  linkSafe: Set<number>
  equalsRuns: Set<number>
}

interface TextRange {
  start: number
  end: number
}

/** LF, VT, FF, CR, NEL, LINE SEPARATOR and PARAGRAPH SEPARATOR: Unicode's mandatory breaks. */
function isLineBreakCode(code: number): boolean {
  return (code >= 0x0a && code <= 0x0d) || code === 0x85 || code === 0x2028 || code === 0x2029
}

function isRejectedControlCode(code: number): boolean {
  if (code === 0x09 || isLineBreakCode(code)) return false
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f)
}

function unpairedSurrogateLength(text: string, index: number): number {
  const code = text.charCodeAt(index)
  if (code < 0xd800 || code > 0xdfff) return 0
  const next = text.charCodeAt(index + 1)
  return code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? -1 : 1
}

function rejectUnsafeCodeUnits(text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    if (isRejectedControlCode(text.charCodeAt(index))) throw new LiteralMarkdownTextError('controlCharacter', index)
    const surrogate = unpairedSurrogateLength(text, index)
    if (surrogate === 1) throw new LiteralMarkdownTextError('malformedUnicode', index)
    if (surrogate === -1) index += 1
  }
}

function rejectReservedMarkers(text: string): void {
  // A live literal-protection sentinel carries this session's nonce, so it can only appear if
  // parser-internal text leaked; refusing it keeps restoration from ever acting on input.
  const positions = [...RESERVED_MARKERS.map(marker => text.indexOf(marker)), protectedLiteralIndex(text)]
    .filter(index => index !== -1)
  if (positions.length > 0) throw new LiteralMarkdownTextError('reservedMarker', Math.min(...positions))
}

function validateLiteralText(text: string): void {
  if (text.length > LITERAL_MARKDOWN_TEXT_MAX_LENGTH) throw new LiteralMarkdownTextError('tooLong')
  rejectUnsafeCodeUnits(text)
  rejectReservedMarkers(text)
}

function firstLineBreakIndex(text: string): number {
  for (let index = 0; index < text.length; index += 1) {
    if (isLineBreakCode(text.charCodeAt(index))) return index
  }
  return -1
}

function splitLines(text: string): string[] {
  const lines: string[] = []
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    if (!isLineBreakCode(text.charCodeAt(index))) continue
    lines.push(text.slice(start, index))
    if (text.charAt(index) === '\r' && text.charAt(index + 1) === '\n') index += 1
    start = index + 1
  }
  lines.push(text.slice(start))
  return lines
}

function isHorizontalSpace(character: string): boolean {
  return character === ' ' || character === '\t'
}

// Index loops, not a regex: `[ \t]+$` backtracks quadratically over long inner whitespace runs.
function trimHorizontalSpace(line: string): string {
  let start = 0
  let end = line.length
  while (start < end && isHorizontalSpace(line.charAt(start))) start += 1
  while (end > start && isHorizontalSpace(line.charAt(end - 1))) end -= 1
  return line.slice(start, end)
}

function isAsciiDigit(character: string): boolean {
  return character >= '0' && character <= '9'
}

// A BOM before `---` still opens frontmatter for BOM-aware readers, so line-start rules skip it.
function contentStartIndex(line: string): number {
  let index = 0
  while (line.charAt(index) === BYTE_ORDER_MARK) index += 1
  return index
}

function orderedDelimiterIndex(line: string, start: number): number {
  let index = start
  while (isAsciiDigit(line.charAt(index))) index += 1
  const delimiter = line.charAt(index)
  if (index === start || (delimiter !== '.' && delimiter !== ')')) return -1
  const after = line.charAt(index + 1)
  return after === '' || isHorizontalSpace(after) ? index : -1
}

function urlStartIndex(word: string): number {
  const match = URL_START_RE.exec(word)
  return match ? match.index + match[0].length - (match.at(1)?.length ?? 0) : -1
}

function emailStartIndex(word: string): number {
  const at = word.indexOf('@')
  if (at <= 0 || !word.includes('.', at)) return -1
  let start = at
  while (start > 0 && EMAIL_LOCAL_CHARACTER_RE.test(word.charAt(start - 1))) start -= 1
  return start < at ? start : -1
}

function automaticLinkRange(line: string, word: string, offset: number): TextRange | null {
  const starts = [urlStartIndex(word), emailStartIndex(word)].filter(start => start !== -1)
  if (starts.length === 0) return null
  const start = offset + Math.min(...starts)
  let end = offset + word.length
  while (end > start && TRAILING_LINK_PUNCTUATION.has(line.charAt(end - 1))) end -= 1
  return end > start ? { start, end } : null
}

/** Positions of `_` and `&` inside words remark-gfm turns into automatic links. */
function linkSafeIndexes(line: string): Set<number> {
  const indexes = new Set<number>()
  for (const match of line.matchAll(WORD_RE)) {
    const range = automaticLinkRange(line, match[0], match.index ?? 0)
    if (!range) continue
    for (let index = range.start; index < range.end; index += 1) {
      if (LINK_SAFE_CHARACTERS.has(line.charAt(index))) indexes.add(index)
    }
  }
  return indexes
}

/** Positions inside a run of two or more `=`, which the highlight injector would consume. */
function equalsRunIndexes(line: string): Set<number> {
  const indexes = new Set<number>()
  for (const match of line.matchAll(EQUALS_RUN_RE)) {
    const start = match.index ?? 0
    for (let scan = start; scan < start + match[0].length; scan += 1) indexes.add(scan)
  }
  return indexes
}

function scanLine(line: string): LineScan {
  const contentStart = contentStartIndex(line)
  return {
    line,
    contentStart,
    orderedDelimiter: orderedDelimiterIndex(line, contentStart),
    linkSafe: linkSafeIndexes(line),
    equalsRuns: equalsRunIndexes(line),
  }
}

function startsNamedReference(line: string, start: number): boolean {
  let index = start
  while (ASCII_ALPHANUMERIC_RE.test(line.charAt(index))) index += 1
  return index > start && line.charAt(index) === ';'
}

function endsWithHashRun(line: string, start: number): boolean {
  let index = start
  while (line.charAt(index) === '#') index += 1
  return index === line.length
}

// `&` could start a character reference (or meet one a caller appends); a final `#` run after a
// space is a heading's closing sequence.
function needsContextualEscape(line: string, index: number, character: string): boolean {
  if (character === '&') {
    const next = line.charAt(index + 1)
    return next === '' || next === '#' || startsNamedReference(line, index + 1)
  }
  return character === '#' && isHorizontalSpace(line.charAt(index - 1)) && endsWithHashRun(line, index)
}

function needsEscape(scan: LineScan, index: number, character: string): boolean {
  if (scan.linkSafe.has(index)) return false
  if (ESCAPED_EVERYWHERE.has(character)) return true
  if (scan.equalsRuns.has(index)) return true
  if (index === scan.contentStart && ESCAPED_AT_LINE_START.has(character)) return true
  return index === scan.orderedDelimiter || needsContextualEscape(scan.line, index, character)
}

// Every backslash is doubled, which both parsers read as one literal backslash whatever follows.
// A backslash before `{` is written once, because `markdownLiteralProtection` keeps that one
// literal on both paths; in a note's source, `\{` therefore means the two characters `\{`.
function encodeCharacter(scan: LineScan, index: number): string {
  const character = scan.line.charAt(index)
  if (character === '\\') return scan.line.charAt(index + 1) === '{' ? character : '\\\\'
  return needsEscape(scan, index, character) ? `\\${character}` : character
}

function encodeLine(line: string): string {
  const scan = scanLine(line)
  let encoded = ''
  for (let index = 0; index < line.length; index += 1) encoded += encodeCharacter(scan, index)
  return encoded
}

function lastContentLineIndex(lines: string[]): number {
  let index = lines.length - 1
  while (index >= 0 && lines.at(index) === '') index -= 1
  return index
}

/**
 * Encodes one line of untrusted text for a heading, a link label or after a trusted prefix.
 * Throws `lineBreak` for multi-line text; returns '' for blank text.
 */
export function encodeLiteralMarkdownInline(text: string): string {
  validateLiteralText(text)
  const lineBreak = firstLineBreakIndex(text)
  if (lineBreak !== -1) throw new LiteralMarkdownTextError('lineBreak', lineBreak)
  const line = trimHorizontalSpace(text)
  return line ? encodeLine(line) : ''
}

/**
 * Encodes multi-line untrusted text as Markdown source lines for a paragraph, quote or list item.
 * Each line break stays a line break; '' marks a blank line (paragraph break). Leading and
 * trailing blank lines are dropped, so blank text returns [].
 */
export function encodeLiteralMarkdownLines(text: string): string[] {
  validateLiteralText(text)
  const lines = splitLines(text).map(trimHorizontalSpace)
  const first = lines.findIndex(line => line !== '')
  if (first === -1) return []
  return lines.slice(first, lastContentLineIndex(lines) + 1).map(line => line ? encodeLine(line) : '')
}
