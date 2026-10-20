import { advanceMarkdownFence, type MarkdownFence } from './markdownFences'

/**
 * Carries "this character was escaped in the source" through Markdown parsing.
 *
 * The callout and highlight injectors run after parsing, on text whose escapes the parser has
 * already removed, so they cannot tell an escaped `\[!note]` or `\=\=` from authored syntax. This
 * module rewrites exactly those escapes to a host sentinel before parsing and restores the literal
 * characters after the injectors have run. A literal backslash before `{` is carried the same way.
 *
 * Each sentinel embeds a random per-session nonce. Text from a note, whether raw, decoded from a
 * character reference, inside code or inside a durable block, cannot contain that nonce, so
 * restoration only ever rewrites sentinels this module introduced and leaves everything else
 * byte-for-byte unchanged. Every sentinel character is inert in both Markdown parsers.
 *
 * A sentinel reaches parsed blocks in two representations, and both are restored before any
 * serialization, so the nonce is never written to a note: raw in text, and percent-encoded where
 * the URI normalizer wrote it into a link target (restored as that normalizer writes the
 * character). Inside parsed code, which keeps backslashes, the original escape is restored.
 */
// Source stays ASCII so the exact bytes are reviewable.
const SENTINEL_START = String.fromCharCode(0xe000)
const SENTINEL_END = String.fromCharCode(0xe001)
const NONCE_BYTES = 8
const MAX_CODE_POINT = 0x10ffff

function createSessionNonce(): string {
  const bytes = new Uint8Array(NONCE_BYTES)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

// Lower-case hex nonce, then the upper-case hex code point of the protected character.
const SESSION_NONCE = createSessionNonce()
const SENTINEL_PREFIX = `${SENTINEL_START}${SESSION_NONCE}`
const SENTINEL_RE = new RegExp(`${SENTINEL_PREFIX}([0-9A-F]{1,6})${SENTINEL_END}`, 'gu')
// A sentinel inside a link target is percent-encoded by the Markdown URI normalizer
// (`encodeURIComponent`, upper-case hex). Only this exact encoding of this session's nonce is
// host data; any other percent-encoded text is left exactly as it is.
const ENCODED_SENTINEL_PREFIX = `${encodeURIComponent(SENTINEL_START)}${SESSION_NONCE}`
const ENCODED_SENTINEL_RE = new RegExp(
  `${ENCODED_SENTINEL_PREFIX}([0-9A-F]{1,6})${encodeURIComponent(SENTINEL_END)}`,
  'gu',
)
// The ASCII characters that normalizer leaves unencoded.
const URI_SAFE_ASCII_RE = /^[!#$&-;=?-Z_a-z~]$/u
// Wikilink and linked-code placeholders written by earlier preprocessors: U+2039 `KIND:payload`
// U+203A.
const PLACEHOLDER_START = String.fromCharCode(0x2039)
const PLACEHOLDER_END = String.fromCharCode(0x203a)
const PLACEHOLDER_HEAD_RE = new RegExp(`^${PLACEHOLDER_START}[A-Z][A-Z_]*:`, 'u')
const PLACEHOLDER_HEAD_MAX = 32
// Lines that begin a block of their own, so a code span cannot continue into or out of them.
const ATX_HEADING_RE = /^ {0,3}#{1,6}(?:[ \t]|$)/u
const THEMATIC_BREAK_RE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/u
const SETEXT_UNDERLINE_RE = /^ {0,3}(?:=+|-+)[ \t]*$/u
const LIST_ITEM_RE = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/u
const QUOTE_LINE_RE = /^ {0,3}>/u
const INDENTED_CODE_RE = /^(?: {4}|\t)/u

function sentinelFor(character: string): string {
  const codePoint = character.codePointAt(0) ?? 0
  return `${SENTINEL_PREFIX}${codePoint.toString(16).toUpperCase()}${SENTINEL_END}`
}

interface ProseScan {
  text: string
  index: number
  result: string
  /** Whether the last emitted character, raw or protected, was a visible `=`. */
  afterEquals: boolean
}

function isEscapedEqualsAt(text: string, index: number): boolean {
  return text.charAt(index) === '\\' && text.charAt(index + 1) === '='
}

/** `\=` matters only inside a run of two or more `=`, which the highlight injector would pair. */
function isEqualsRunEscape(scan: ProseScan): boolean {
  if (scan.afterEquals) return true
  const after = scan.index + 2
  return scan.text.charAt(after) === '=' || isEscapedEqualsAt(scan.text, after)
}

function emit(scan: ProseScan, output: string, consumed: number, afterEquals: boolean): void {
  scan.result += output
  scan.index += consumed
  scan.afterEquals = afterEquals
}

function protectEscape(scan: ProseScan): void {
  const next = scan.text.charAt(scan.index + 1)
  // An escaped backslash stays escaped, so whatever follows it is still authored syntax.
  if (next === '\\') return emit(scan, '\\\\', 2, false)
  if (next === '{') return emit(scan, `${sentinelFor('\\')}{`, 2, false)
  // A callout marker is `[!type]`; only that opening bracket needs provenance.
  if (next === '[' && scan.text.charAt(scan.index + 2) === '!') return emit(scan, sentinelFor('['), 2, false)
  if (next === '=' && isEqualsRunEscape(scan)) return emit(scan, sentinelFor('='), 2, true)
  if (next === '') return emit(scan, '\\', 1, false)
  return emit(scan, `\\${next}`, 2, next === '=')
}

function protectProse(text: string): string {
  const scan: ProseScan = { text, index: 0, result: '', afterEquals: false }
  while (scan.index < text.length) {
    const character = text.charAt(scan.index)
    if (character === '\\') {
      protectEscape(scan)
      continue
    }
    emit(scan, character, 1, character === '=')
  }
  return scan.result
}

/**
 * End (exclusive) of an earlier preprocessor's `KIND:payload` placeholder starting at `index`,
 * or -1. A wikilink placeholder carries its raw target, which must reach the wikilink exactly as
 * written, so protection treats the whole placeholder like code.
 */
function placeholderEndIndex(line: string, index: number): number {
  if (line.charAt(index) !== PLACEHOLDER_START) return -1
  const match = PLACEHOLDER_HEAD_RE.exec(line.slice(index, index + PLACEHOLDER_HEAD_MAX))
  if (!match) return -1
  const end = line.indexOf(PLACEHOLDER_END, index + match[0].length)
  return end === -1 ? -1 : end + 1
}

function backtickRunLength(line: string, index: number): number {
  let end = index
  while (line.charAt(end) === '`') end += 1
  return end - index
}

/** Start of the next backtick run of exactly `length`; inside a code span backslashes are literal. */
function closingBacktickRun(line: string, from: number, length: number): number {
  let index = from
  while (index < line.length) {
    if (line.charAt(index) !== '`') {
      index += 1
      continue
    }
    const run = backtickRunLength(line, index)
    if (run === length) return index
    index += run
  }
  return -1
}

/**
 * Applies `transform` to prose outside real code spans. As in CommonMark, a backslash-escaped
 * backtick is literal and cannot open a span, so escaped backticks around text cannot hide that
 * text from protection. (The shared `transformOutsideInlineCode` pairs escaped backticks too.)
 */
function transformOutsideCodeSpans(line: string, transform: (prose: string) => string): string {
  let result = ''
  let prose = ''
  let index = 0

  while (index < line.length) {
    const character = line.charAt(index)
    if (character === '\\' && index + 1 < line.length) {
      prose += line.slice(index, index + 2)
      index += 2
      continue
    }
    const placeholderEnd = placeholderEndIndex(line, index)
    if (placeholderEnd !== -1) {
      result += `${transform(prose)}${line.slice(index, placeholderEnd)}`
      prose = ''
      index = placeholderEnd
      continue
    }
    if (character !== '`') {
      prose += character
      index += 1
      continue
    }

    const run = backtickRunLength(line, index)
    const close = closingBacktickRun(line, index + run, run)
    if (close === -1) {
      prose += line.slice(index, index + run)
      index += run
      continue
    }
    result += `${transform(prose)}${line.slice(index, close + run)}`
    prose = ''
    index = close + run
  }
  return `${result}${transform(prose)}`
}

interface SourceLine {
  text: string
  ending: string
}

function sourceLines(markdown: string): SourceLine[] {
  const parts = markdown.split(/(\r?\n)/u)
  const lines: SourceLine[] = []
  for (let index = 0; index < parts.length; index += 2) {
    lines.push({ text: parts.at(index) ?? '', ending: parts.at(index + 1) ?? '' })
  }
  return lines
}

function isSingleLineBlock(line: string): boolean {
  return ATX_HEADING_RE.test(line) || THEMATIC_BREAK_RE.test(line)
}

function startsBlock(line: string, previous: string): boolean {
  if (isSingleLineBlock(line) || SETEXT_UNDERLINE_RE.test(line) || LIST_ITEM_RE.test(line)) return true
  return QUOTE_LINE_RE.test(line) && !QUOTE_LINE_RE.test(previous)
}

/**
 * Whether `line` continues the paragraph held in `run`, so that a code span may cross into it, as
 * it does for the parser. Deliberately conservative: a heading, break, list item, new quote,
 * possible table row or indented code keeps the line separate, which only falls back to the
 * line-by-line handling those blocks need anyway.
 */
function continuesParagraph(run: SourceLine[], line: string): boolean {
  const first = run.at(0)?.text ?? ''
  const previous = run.at(-1)?.text ?? ''
  if (INDENTED_CODE_RE.test(first) || isSingleLineBlock(previous)) return false
  if (startsBlock(line, previous)) return false
  return !previous.includes('|') && !line.includes('|')
}

function protectParagraph(run: SourceLine[]): string {
  return transformOutsideCodeSpans(run.map(line => `${line.text}${line.ending}`).join(''), protectProse)
}

/**
 * Rewrites protected escapes outside fenced code and code spans, where a backslash is already
 * literal and must stay exactly as written. Code spans are found across the lines of a paragraph,
 * so prose after a span that began on an earlier line is still protected.
 */
export function protectEscapedLiterals(markdown: string): string {
  let fence: MarkdownFence | null = null
  let run: SourceLine[] = []
  let result = ''
  const flush = () => {
    if (run.length > 0) result += protectParagraph(run)
    run = []
  }

  for (const line of sourceLines(markdown)) {
    const nextFence = advanceMarkdownFence(line.text, fence)
    const insideFence = nextFence !== fence || fence !== null
    fence = nextFence
    if (insideFence || line.text.trim() === '') {
      flush()
      result += `${line.text}${line.ending}`
      continue
    }
    if (run.length > 0 && !continuesParagraph(run, line.text)) flush()
    run.push(line)
  }
  flush()
  return result
}

function isRestorableCodePoint(codePoint: number): boolean {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > MAX_CODE_POINT) return false
  return codePoint < 0xd800 || codePoint > 0xdfff
}

/**
 * `text`: ordinary prose, where the parser removed the escape, so the character stands alone.
 * `source`: parsed code, which keeps backslashes literally, so the original escape comes back.
 */
type RestoreMode = 'text' | 'source'

function restoredCharacter(character: string, mode: RestoreMode): string {
  // The brace sentinel stands for the backslash itself, which is its own source spelling.
  return mode === 'source' && character !== '\\' ? `\\${character}` : character
}

/** A character exactly as the Markdown URI normalizer writes it into a link target. */
function uriCharacter(character: string): string {
  return URI_SAFE_ASCII_RE.test(character) ? character : encodeURIComponent(character)
}

function replaceTokens(text: string, pattern: RegExp, write: (character: string) => string): string {
  return text.replace(pattern, (match, hex: string) => {
    const codePoint = Number.parseInt(hex, 16)
    return isRestorableCodePoint(codePoint) ? write(String.fromCodePoint(codePoint)) : match
  })
}

export function restoreProtectedLiteralText(text: string, mode: RestoreMode = 'text'): string {
  if (protectedLiteralIndex(text) === -1) return text
  const restored = replaceTokens(text, SENTINEL_RE, character => restoredCharacter(character, mode))
  return replaceTokens(restored, ENCODED_SENTINEL_RE, uriCharacter)
}

/** Offset of the first sentinel this module introduced, raw or URI-encoded, or -1. */
export function protectedLiteralIndex(text: string): number {
  const positions = [text.indexOf(SENTINEL_PREFIX), text.indexOf(ENCODED_SENTINEL_PREFIX)]
    .filter(index => index !== -1)
  return positions.length > 0 ? Math.min(...positions) : -1
}

/** Whether the text still holds a sentinel this module introduced. */
export function hasProtectedLiteral(text: string): boolean {
  return protectedLiteralIndex(text) !== -1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Protection runs on raw lines and cannot see every code region (an indented code block, or a code
 * span that continues onto the next line), so a sentinel can land inside parsed code. Code keeps
 * backslashes literally, so there the original escape is restored instead of the bare character.
 */
function modeFor(record: Record<string, unknown>, mode: RestoreMode): RestoreMode {
  if (record.type === 'codeBlock') return 'source'
  if (record.type === 'text' && isRecord(record.styles) && record.styles.code === true) return 'source'
  return mode
}

function restoreValue(value: unknown, mode: RestoreMode): unknown {
  if (typeof value === 'string') return restoreProtectedLiteralText(value, mode)
  if (Array.isArray(value)) {
    let changed = false
    const restored = value.map((item) => {
      const next = restoreValue(item, mode)
      changed ||= next !== item
      return next
    })
    return changed ? restored : value
  }
  if (!isRecord(value)) return value

  const recordMode = modeFor(value, mode)
  let changed = false
  const restored = Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const next = restoreValue(item, recordMode)
    changed ||= next !== item
    return [key, next]
  }))
  return changed ? restored : value
}

/** Restores literal characters once the callout and highlight injectors have finished. */
export function restoreProtectedLiteralsInBlocks(blocks: unknown[]): unknown[] {
  return restoreValue(blocks, 'text') as unknown[]
}
