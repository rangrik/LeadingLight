/**
 * Display text of a note title's inline Markdown (the text after `# `).
 *
 * One implementation for the live title (noteTitle.ts) and the browser disk bridge
 * (scripts/vault-api-data.ts); native vault parsing mirrors it in
 * src-tauri/src/vault/parsing/title_text.rs. All three assert src/shared/titleSourceContract.json.
 * Kept free of imports so Node's type stripping can load it from scripts/.
 *
 * A bounded CommonMark subset, linear in the input (docs/leadinglight/title-literal-text.md):
 * backslash escapes, character references and code spans first become literal text that can never
 * open, close or split syntax; a lone backslash before `{` stays, and `_` and `&` inside bare
 * http(s), www and email words stay as written. Wikilinks, links, `~~strikethrough~~`, `*` and non-intraword `_` runs are then
 * unwrapped as titles always were. Inline HTML, `<...>` autolinks and images get no special handling.
 */

/**
 * `source` text may act as Markdown syntax. `escaped` and `literal` text never does, except that an
 * escaped `|` or `]` still bounds a wikilink, as the editor's raw `[[...]]` match sees them.
 */
type TitleUnitOrigin = 'source' | 'escaped' | 'literal'

interface TitleUnit {
  glyph: string
  origin: TitleUnitOrigin
}

interface DecodedReference {
  glyph: string
  end: number
}

interface TextRange {
  start: number
  end: number
}

interface TitleSpan extends TextRange {
  next: number
}

interface PlainTitleText {
  text: string
  next: number
}

/** Next index at or after each position holding the unit, or the unit count. */
interface TitleSyntaxIndex {
  closeBracket: Int32Array
  rawCloseBracket: Int32Array
  closeParen: Int32Array
  aliasPipe: Int32Array
  tilde: Int32Array
}

type CodeSpanCloser = (after: number, length: number) => number

const ASCII_PUNCTUATION = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~')
const ASCII_ALPHANUMERIC_RE = /^[A-Za-z0-9]$/u
const DECIMAL_DIGIT_RE = /^[0-9]$/u
const HEX_DIGIT_RE = /^[0-9A-Fa-f]$/u
const ALPHANUMERIC_RE = /^[\p{Alphabetic}\p{N}]$/u
const WHITESPACE_RE = /^\s$/u
const EMAIL_LOCAL_RE = /^[A-Za-z0-9._+-]$/u
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd)
const MAX_NAMED_REFERENCE_LENGTH = 32
// Same automatic-link words and trailing punctuation as the extension literal-text encoder.
const AUTOMATIC_LINK_PREFIXES = ['https://', 'http://', 'www.']
const TRAILING_LINK_PUNCTUATION = new Set('!"&\')*,.:;?]_}~')
const LINK_SAFE_GLYPHS = new Set(['_', '&'])

// Names Markdown writers commonly emit; any other name stays literal. Native keeps the same table.
const NAMED_REFERENCE_CODE_POINTS: ReadonlyArray<readonly [string, number]> = [
  ['amp', 0x26], ['AMP', 0x26], ['lt', 0x3c], ['LT', 0x3c], ['gt', 0x3e], ['GT', 0x3e],
  ['quot', 0x22], ['QUOT', 0x22], ['apos', 0x27], ['nbsp', 0xa0], ['ensp', 0x2002],
  ['emsp', 0x2003], ['thinsp', 0x2009], ['copy', 0xa9], ['COPY', 0xa9], ['reg', 0xae],
  ['REG', 0xae], ['trade', 0x2122], ['TRADE', 0x2122], ['hellip', 0x2026], ['mdash', 0x2014],
  ['ndash', 0x2013], ['lsquo', 0x2018], ['rsquo', 0x2019], ['sbquo', 0x201a], ['ldquo', 0x201c],
  ['rdquo', 0x201d], ['bdquo', 0x201e], ['laquo', 0xab], ['raquo', 0xbb], ['bull', 0x2022],
  ['middot', 0xb7], ['deg', 0xb0], ['times', 0xd7], ['divide', 0xf7], ['plusmn', 0xb1],
  ['minus', 0x2212], ['euro', 0x20ac], ['pound', 0xa3], ['yen', 0xa5], ['cent', 0xa2],
  ['sect', 0xa7], ['para', 0xb6], ['larr', 0x2190], ['uarr', 0x2191], ['rarr', 0x2192],
  ['darr', 0x2193], ['harr', 0x2194],
]

export const NAMED_CHARACTER_REFERENCES: ReadonlyMap<string, string> = new Map(
  NAMED_REFERENCE_CODE_POINTS.map(([name, code]) => [name, String.fromCodePoint(code)]),
)

function literalUnit(glyph: string): TitleUnit {
  return { glyph, origin: 'literal' }
}

function runEnd(source: string[], start: number, maxLength: number, accept: (glyph: string) => boolean): number {
  const limit = Math.min(source.length, start + maxLength)
  let index = start
  while (index < limit && accept(source[index])) index += 1
  return index
}

function isBacktick(glyph: string): boolean {
  return glyph === '`'
}

function isWhitespace(glyph: string): boolean {
  return WHITESPACE_RE.test(glyph)
}

function startsWithIgnoringAsciiCase(word: string[], index: number, prefix: string): boolean {
  return Array.from(prefix).every((expected, offset) => word[index + offset]?.toLowerCase() === expected)
}

function urlStart(word: string[]): number {
  for (let index = 0; index < word.length; index += 1) {
    const boundary = index === 0 || !ASCII_ALPHANUMERIC_RE.test(word[index - 1])
    if (boundary && AUTOMATIC_LINK_PREFIXES.some(prefix => startsWithIgnoringAsciiCase(word, index, prefix))) {
      return index
    }
  }
  return -1
}

function emailStart(word: string[]): number {
  const at = word.indexOf('@')
  if (at <= 0 || !word.includes('.', at)) return -1
  let start = at
  while (start > 0 && EMAIL_LOCAL_RE.test(word[start - 1])) start -= 1
  return start < at ? start : -1
}

function automaticLinkRange(word: string[]): TextRange | null {
  const starts = [urlStart(word), emailStart(word)].filter(start => start !== -1)
  if (starts.length === 0) return null
  const start = Math.min(...starts)
  let end = word.length
  while (end > start && TRAILING_LINK_PUNCTUATION.has(word[end - 1])) end -= 1
  return end > start ? { start, end } : null
}

function markLinkSafe(source: string[], safe: boolean[], range: TextRange): void {
  for (let index = range.start; index < range.end; index += 1) safe[index] = LINK_SAFE_GLYPHS.has(source[index])
}

// The encoder leaves `_` and `&` raw inside the words remark-gfm links, since a backslash would
// land in the link text and target; here they stay text, never emphasis or a reference.
function linkSafePositions(source: string[]): boolean[] {
  const safe = new Array<boolean>(source.length).fill(false)
  let start = 0
  while (start < source.length) {
    if (isWhitespace(source[start])) {
      start += 1
      continue
    }
    const end = runEnd(source, start, source.length - start, glyph => !isWhitespace(glyph))
    const range = automaticLinkRange(source.slice(start, end))
    if (range) markLinkSafe(source, safe, { start: start + range.start, end: start + range.end })
    start = end
  }
  return safe
}

// Same code points micromark (the editor's parser) replaces; whitespace controls show as a space.
function isReplacedReferenceCode(code: number): boolean {
  return code < 0x09 || code === 0x0b || (code >= 0x0e && code < 0x20) || (code >= 0x7f && code < 0xa0)
    || (code >= 0xd800 && code < 0xe000) || (code >= 0xfdd0 && code < 0xfdf0)
    || code % 0x10000 >= 0xfffe || code > 0x10ffff
}

function numericReferenceGlyph(code: number): string {
  if (code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) return ' '
  return isReplacedReferenceCode(code) ? REPLACEMENT_CHARACTER : String.fromCodePoint(code)
}

function numericReference(source: string[], start: number): DecodedReference | null {
  const hex = source[start] === 'x' || source[start] === 'X'
  const digitsStart = hex ? start + 1 : start
  const digit = hex ? HEX_DIGIT_RE : DECIMAL_DIGIT_RE
  const digitsEnd = runEnd(source, digitsStart, hex ? 6 : 7, glyph => digit.test(glyph))
  if (digitsEnd === digitsStart || source[digitsEnd] !== ';') return null
  const code = Number.parseInt(source.slice(digitsStart, digitsEnd).join(''), hex ? 16 : 10)
  return { glyph: numericReferenceGlyph(code), end: digitsEnd + 1 }
}

function namedReference(source: string[], start: number): DecodedReference | null {
  const end = runEnd(source, start, MAX_NAMED_REFERENCE_LENGTH, glyph => ASCII_ALPHANUMERIC_RE.test(glyph))
  if (end === start || source[end] !== ';') return null
  const glyph = NAMED_CHARACTER_REFERENCES.get(source.slice(start, end).join(''))
  return glyph === undefined ? null : { glyph, end: end + 1 }
}

// LeadingLight's rich parser keeps a lone backslash before `{` (markdownLiteralProtection), and the
// extension encoder relies on it. Backslashes still pair left to right, so `\\{` shows `\{`.
function pushBackslash(source: string[], index: number, units: TitleUnit[]): number {
  const next = source[index + 1]
  if (ASCII_PUNCTUATION.has(next) && next !== '{') {
    units.push({ glyph: next, origin: 'escaped' })
    return index + 2
  }
  units.push(literalUnit('\\'))
  return index + 1
}

function pushReference(source: string[], index: number, units: TitleUnit[]): number {
  const reference = source[index + 1] === '#'
    ? numericReference(source, index + 2)
    : namedReference(source, index + 1)
  if (!reference) {
    units.push({ glyph: '&', origin: 'source' })
    return index + 1
  }
  units.push(literalUnit(reference.glyph))
  return reference.end
}

// Closing runs are found in the raw text, where backslashes do not escape. Openers are met left to
// right, so one cursor per run length keeps the whole scan linear.
function codeSpanCloser(source: string[]): CodeSpanCloser {
  const runStarts = new Map<number, number[]>()
  const cursors = new Map<number, number>()
  let index = 0
  while (index < source.length) {
    if (!isBacktick(source[index])) {
      index += 1
      continue
    }
    const end = runEnd(source, index, source.length - index, isBacktick)
    const starts = runStarts.get(end - index)
    if (starts) starts.push(index)
    else runStarts.set(end - index, [index])
    index = end
  }
  return (after, length) => {
    const starts = runStarts.get(length) ?? []
    let cursor = cursors.get(length) ?? 0
    while (cursor < starts.length && starts[cursor] < after) cursor += 1
    cursors.set(length, cursor)
    return cursor < starts.length ? starts[cursor] : -1
  }
}

function codeSpanText(content: string[]): string[] {
  const padded = content.length >= 2 && content[0] === ' ' && content[content.length - 1] === ' '
  return padded && content.some(glyph => glyph !== ' ') ? content.slice(1, -1) : content
}

function pushBackticks(source: string[], index: number, closeCodeSpan: CodeSpanCloser, units: TitleUnit[]): number {
  const openEnd = runEnd(source, index, source.length - index, isBacktick)
  const close = closeCodeSpan(openEnd, openEnd - index)
  const text = close === -1 ? source.slice(index, openEnd) : codeSpanText(source.slice(openEnd, close))
  for (const glyph of text) units.push(literalUnit(glyph))
  return close === -1 ? openEnd : close + openEnd - index
}

function pushTitleToken(source: string[], index: number, closeCodeSpan: CodeSpanCloser, units: TitleUnit[]): number {
  switch (source[index]) {
    case '\\': return pushBackslash(source, index, units)
    case '&': return pushReference(source, index, units)
    case '`': return pushBackticks(source, index, closeCodeSpan, units)
    default:
      units.push({ glyph: source[index], origin: 'source' })
      return index + 1
  }
}

function literalTitleUnits(source: string[]): TitleUnit[] {
  const units: TitleUnit[] = []
  const closeCodeSpan = codeSpanCloser(source)
  const linkSafe = linkSafePositions(source)
  let index = 0
  while (index < source.length) {
    if (linkSafe[index]) {
      units.push(literalUnit(source[index]))
      index += 1
    } else {
      index = pushTitleToken(source, index, closeCodeSpan, units)
    }
  }
  return units
}

function isSyntax(unit: TitleUnit, glyph: string): boolean {
  return unit.origin === 'source' && unit.glyph === glyph
}

/** Written in the raw source, escaped or not: what the editor's `[[...]]` match sees. */
function isRaw(unit: TitleUnit, glyph: string): boolean {
  return unit.origin !== 'literal' && unit.glyph === glyph
}

function syntaxAt(units: TitleUnit[], position: number, end: number, glyph: string): boolean {
  return position < end && isSyntax(units[position], glyph)
}

function nextPositions(units: TitleUnit[], isTarget: (unit: TitleUnit) => boolean): Int32Array {
  const next = new Int32Array(units.length + 1).fill(units.length)
  for (let index = units.length - 1; index >= 0; index -= 1) {
    next[index] = isTarget(units[index]) ? index : next[index + 1]
  }
  return next
}

function titleSyntaxIndex(units: TitleUnit[]): TitleSyntaxIndex {
  return {
    closeBracket: nextPositions(units, unit => isSyntax(unit, ']')),
    rawCloseBracket: nextPositions(units, unit => isRaw(unit, ']')),
    closeParen: nextPositions(units, unit => isSyntax(unit, ')')),
    aliasPipe: nextPositions(units, unit => isRaw(unit, '|')),
    tilde: nextPositions(units, unit => isSyntax(unit, '~')),
  }
}

// Like the editor's `[[...]]` match, no raw `]` inside. A raw or table-escaped `\|` names the
// alias; a pipe from a character reference or code span is text.
function wikilinkSpan(units: TitleUnit[], index: TitleSyntaxIndex, start: number, end: number): TitleSpan | null {
  if (!syntaxAt(units, start + 1, end, '[')) return null
  const inner = start + 2
  const close = index.rawCloseBracket[inner]
  if (close <= inner || !syntaxAt(units, close, end, ']') || !syntaxAt(units, close + 1, end, ']')) return null
  const pipe = index.aliasPipe[inner]
  const aliased = pipe > inner && pipe + 1 < close
  return { start: aliased ? pipe + 1 : inner, end: close, next: close + 2 }
}

function linkSpan(units: TitleUnit[], index: TitleSyntaxIndex, start: number, end: number): TitleSpan | null {
  const label = start + 1
  const labelEnd = index.closeBracket[label]
  if (labelEnd <= label || !syntaxAt(units, labelEnd + 1, end, '(')) return null
  const destination = labelEnd + 2
  const destinationEnd = index.closeParen[destination]
  if (destinationEnd <= destination || destinationEnd >= end) return null
  return { start: label, end: labelEnd, next: destinationEnd + 1 }
}

function strikethroughSpan(units: TitleUnit[], index: TitleSyntaxIndex, start: number, end: number): TitleSpan | null {
  if (!syntaxAt(units, start + 1, end, '~')) return null
  const content = start + 2
  const close = index.tilde[content]
  if (close <= content || !syntaxAt(units, close + 1, end, '~')) return null
  if (isWhitespace(units[content].glyph) || isWhitespace(units[close - 1].glyph)) return null
  return { start: content, end: close, next: close + 2 }
}

function titleSpanAt(units: TitleUnit[], index: TitleSyntaxIndex, position: number, end: number): TitleSpan | null {
  const unit = units[position]
  if (unit.origin !== 'source') return null
  if (unit.glyph === '[') return wikilinkSpan(units, index, position, end) ?? linkSpan(units, index, position, end)
  if (unit.glyph === '~') return strikethroughSpan(units, index, position, end)
  return null
}

function underscoreRun(units: TitleUnit[], position: number, start: number, end: number): PlainTitleText {
  let next = position
  while (next < end && isSyntax(units[next], '_')) next += 1
  const before = position > start ? units[position - 1].glyph : ''
  const after = next < end ? units[next].glyph : ''
  const intraword = ALPHANUMERIC_RE.test(before) && ALPHANUMERIC_RE.test(after)
  return { text: intraword ? '_'.repeat(next - position) : '', next }
}

function plainTitleText(units: TitleUnit[], position: number, start: number, end: number): PlainTitleText {
  const unit = units[position]
  if (unit.origin !== 'source') return { text: unit.glyph, next: position + 1 }
  if (unit.glyph === '*') return { text: '', next: position + 1 }
  if (unit.glyph === '_') return underscoreRun(units, position, start, end)
  return { text: unit.glyph, next: position + 1 }
}

// Spans cannot nest deeper than three levels: a wikilink holds no raw `]`, a link label no syntax
// `]`, and strikethrough no syntax `~`.
function renderTitleUnits(units: TitleUnit[], index: TitleSyntaxIndex, start: number, end: number): string {
  let text = ''
  let position = start
  while (position < end) {
    const span = titleSpanAt(units, index, position, end)
    if (span) {
      text += renderTitleUnits(units, index, span.start, span.end)
      position = span.next
      continue
    }
    const plain = plainTitleText(units, position, start, end)
    text += plain.text
    position = plain.next
  }
  return text
}

/** Plain display text for a title's inline Markdown; the caller trims it. */
export function titleTextFromMarkdown(markdown: string): string {
  const units = literalTitleUnits(Array.from(markdown))
  return renderTitleUnits(units, titleSyntaxIndex(units), 0, units.length)
}
