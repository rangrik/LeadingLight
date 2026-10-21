// Commentary note format 1: the record in frontmatter, the structural Source line, and the exact
// bytes of a new or extended note. Pure; paths are vault-relative and given by the caller.
// Every byte outside the record's own lines and the appended entry is preserved as it was.
import { isAlias, isMap, isScalar, isSeq, parseDocument, type Node as YamlNode } from 'yaml'
import { encodeLiteralMarkdownInline } from '../extensions/extensionMarkdownText'
import { splitFrontmatter } from '../../utils/wikilinks'
import {
  COMMENTARY_LIMITS, COMMENTARY_RECORD_KEY, COMMENTARY_RECORD_VERSION, PASSAGE_PROJECTION, SOURCE_LINK_LABEL,
  type CommentaryCaptureRecord, type CommentaryNote, type CommentaryRecord, type PassageSelector, type RecordState,
  type SourceLinkProblem, type SourceLinkState,
} from './commentaryContract'
import { MarkdownBody, childrenOf, visibleTextOf, type MarkdownNode } from './passageProjection'
import { selectorProblem } from './passageSelector'

// --- Wire-safe text -------------------------------------------------------------------------------

const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u
const CHUNK = 0x8000

/**
 * Standard padded base64 of the text's UTF-8 bytes. Its alphabet has no bracket, pipe, colon, hash
 * or space, so no wikilink rewrite, YAML requoting or line edit can change it. The text must be
 * well-formed UTF-16 (`isWellFormedText`), or the bytes would not round-trip.
 */
export function encodeRecordText(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let index = 0; index < bytes.length; index += CHUNK) binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK))
  return btoa(binary)
}

/** The text of canonical base64 of valid UTF-8, or null for anything else. */
export function decodeRecordText(value: unknown): string | null {
  if (typeof value !== 'string' || !BASE64_RE.test(value)) return null
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return null
  }
  return encodeRecordText(text) === value ? text : null
}

// --- Frontmatter and the record -------------------------------------------------------------------

/** The note after its frontmatter, by the editor's own frontmatter boundary. */
export function sourceBodyOf(content: string): string {
  return splitFrontmatter(content)[1]
}

/** The first line ending a note uses; new lines follow it. */
export function lineEndingOf(content: string): '\n' | '\r\n' {
  const index = content.indexOf('\n')
  return index > 0 && content.charAt(index - 1) === '\r' ? '\r\n' : '\n'
}

interface Frontmatter {
  /** Offset of the YAML text in the note, after the opening `---` line. */
  readonly start: number
  readonly yaml: string
}

function frontmatterOf(content: string): Frontmatter | null {
  const [block] = splitFrontmatter(content)
  if (!block) return null
  const start = block.startsWith('---\r\n') ? 5 : 4
  let end = block.length - (block.endsWith('\r\n') ? 2 : block.endsWith('\n') ? 1 : 0) - 3
  // The line ending before the closing `---` belongs to it, unless it follows the opening line directly.
  if (end > start) end -= block.startsWith('\r\n', end - 2) ? 2 : block.charAt(end - 1) === '\n' ? 1 : 0
  return { start, yaml: content.slice(start, Math.max(start, end)) }
}

/** Where the record's lines are in the frontmatter YAML: its key line through its last indented line. */
export interface RecordLocation {
  /** Offsets in the note. */
  readonly from: number
  readonly to: number
  /** Whether the last record line ends with a line break inside the range. */
  readonly endsWithLineBreak: boolean
}

interface SourceLine { readonly start: number; readonly text: string; readonly next: number }

function linesOf(text: string): SourceLine[] {
  const lines: SourceLine[] = []
  let start = 0
  while (start < text.length) {
    const newline = text.indexOf('\n', start)
    const next = newline === -1 ? text.length : newline + 1
    lines.push({ start, text: text.slice(start, newline === -1 ? text.length : newline).replace(/\r$/u, ''), next })
    start = next
  }
  return lines
}

/** A top-level YAML key the way native frontmatter editing reads and compares one. */
function topLevelKey(line: string): string | null {
  if (line === '' || line.startsWith(' ') || line.startsWith('\t') || line.startsWith('#')) return null
  const quote = line.charAt(0)
  if (quote === '"' || quote === "'") {
    const close = line.indexOf(quote, 1)
    return close !== -1 && line.slice(close + 1).trimStart().startsWith(':') ? line.slice(1, close) : null
  }
  const colon = line.indexOf(':')
  return colon > 0 ? line.slice(0, colon).trim() : null
}

const normalizedKey = (key: string) => key.trim().toLowerCase().replaceAll(' ', '_')
const RECORD_KEY_LINE = `${COMMENTARY_RECORD_KEY}:`

type Located = { readonly kind: 'none' } | { readonly kind: 'malformed' } | { readonly kind: 'found'; readonly yaml: string; readonly location: RecordLocation }

function locateRecord(content: string): Located {
  const frontmatter = frontmatterOf(content)
  if (!frontmatter) return { kind: 'none' }
  const lines = linesOf(frontmatter.yaml)
  const keyed = lines.filter(line => {
    const key = topLevelKey(line.text)
    return key !== null && normalizedKey(key) === COMMENTARY_RECORD_KEY
  })
  if (keyed.length === 0) return { kind: 'none' }
  const [keyLine] = keyed
  if (keyed.length > 1 || keyLine.text.trimEnd() !== RECORD_KEY_LINE) return { kind: 'malformed' }
  const index = lines.indexOf(keyLine)
  let last = index
  for (let next = index + 1; next < lines.length; next += 1) {
    const { text } = lines[next]
    if (text.trim() === '') continue
    if (!text.startsWith(' ') && !text.startsWith('\t')) break
    last = next
  }
  const end = lines[last].next
  const yaml = frontmatter.yaml.slice(keyLine.start, end)
  return {
    kind: 'found',
    yaml,
    location: { from: frontmatter.start + keyLine.start, to: frontmatter.start + end, endsWithLineBreak: yaml.endsWith('\n') },
  }
}

const INVALID = Symbol('invalid')
type Plain = string | Plain[] | { [key: string]: Plain }

/** Plain strings, lists and maps only: no aliases, anchors, tags or null values. */
function plainValue(node: unknown): Plain | typeof INVALID {
  if (!node || isAlias(node)) return INVALID
  const yamlNode = node as YamlNode
  if (yamlNode.anchor || yamlNode.tag) return INVALID
  if (isScalar(node)) return typeof node.value === 'string' ? node.value : INVALID
  if (isSeq(node)) {
    const items: Plain[] = []
    for (const item of node.items) {
      const value = plainValue(item)
      if (value === INVALID) return INVALID
      items.push(value)
    }
    return items
  }
  if (isMap(node)) {
    const result: { [key: string]: Plain } = Object.create(null)
    for (const pair of node.items) {
      const key = plainValue(pair.key)
      const value = plainValue(pair.value)
      if (typeof key !== 'string' || value === INVALID || Object.hasOwn(result, key)) return INVALID
      result[key] = value
    }
    return result
  }
  return INVALID
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const OFFSET_RE = /^(?:0|[1-9][0-9]{0,15})$/u
export const isCommentaryUuid = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value)

const isObject = (value: Plain | undefined): value is { [key: string]: Plain } => typeof value === 'object' && value !== null && !Array.isArray(value)
const hasOnly = (value: { [key: string]: Plain }, allowed: readonly string[], required: readonly string[]) =>
  Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key))

const CAPTURE_REQUIRED = ['id', 'projection', 'sourceBodySha256', 'exact', 'prefix', 'suffix'] as const
const CAPTURE_KEYS = [...CAPTURE_REQUIRED, 'start', 'end'] as const

function offset(value: Plain | undefined): number | null | typeof INVALID {
  if (value === undefined) return null
  return typeof value === 'string' && OFFSET_RE.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : INVALID
}

function captureOf(value: Plain): CommentaryCaptureRecord | null {
  if (!isObject(value) || !hasOnly(value, CAPTURE_KEYS, CAPTURE_REQUIRED)) return null
  const start = offset(value.start)
  const end = offset(value.end)
  const exact = decodeRecordText(value.exact)
  const prefix = decodeRecordText(value.prefix)
  const suffix = decodeRecordText(value.suffix)
  if (start === INVALID || end === INVALID || exact === null || prefix === null || suffix === null) return null
  if (!isCommentaryUuid(value.id) || value.projection !== PASSAGE_PROJECTION || typeof value.sourceBodySha256 !== 'string') return null
  const selector: PassageSelector = { projection: PASSAGE_PROJECTION, exact, prefix, suffix, sourceBodySha256: value.sourceBodySha256, start, end }
  return selectorProblem(selector) === null ? { id: value.id, ...selector } : null
}

function recordOf(value: Plain): RecordState {
  if (!isObject(value)) return { status: 'malformed' }
  const { version } = value
  if (typeof version === 'string' && version !== String(COMMENTARY_RECORD_VERSION)) return { status: 'unsupported', version }
  if (!hasOnly(value, ['version', 'id', 'captures'], ['version', 'id', 'captures']) || !isCommentaryUuid(value.id)) return { status: 'malformed' }
  const { captures } = value
  if (!Array.isArray(captures) || captures.length === 0 || captures.length > COMMENTARY_LIMITS.captures) return { status: 'malformed' }
  const parsed: CommentaryCaptureRecord[] = []
  for (const item of captures) {
    const capture = captureOf(item)
    if (!capture || parsed.some(other => other.id === capture.id)) return { status: 'malformed' }
    parsed.push(capture)
  }
  return { status: 'ready', record: { version: COMMENTARY_RECORD_VERSION, id: value.id, captures: parsed } }
}

interface ReadRecord { readonly state: RecordState; readonly location: RecordLocation | null }

/** The record of a note and, when it has one, where its lines are. YAML parsing is bounded by the content limit. */
export function readCommentaryRecord(content: string): ReadRecord {
  const located = locateRecord(content)
  if (located.kind === 'none') return { state: { status: 'none' }, location: null }
  if (located.kind === 'malformed' || located.yaml.length > COMMENTARY_LIMITS.contentBytes) return { state: { status: 'malformed' }, location: null }
  const document = parseDocument(located.yaml, { schema: 'failsafe', uniqueKeys: true, strict: true, prettyErrors: false })
  if (document.errors.length > 0) return { state: { status: 'malformed' }, location: located.location }
  const top = plainValue(document.contents)
  if (top === INVALID || !isObject(top) || Object.keys(top).length !== 1 || !Object.hasOwn(top, COMMENTARY_RECORD_KEY)) {
    return { state: { status: 'malformed' }, location: located.location }
  }
  return { state: recordOf(top[COMMENTARY_RECORD_KEY]), location: located.location }
}

/** The record's canonical lines, key line first, joined by `lineEnding` with no final line break. */
export function serializeCommentaryRecord(record: CommentaryRecord, lineEnding = '\n'): string {
  const lines = [RECORD_KEY_LINE, `  version: ${record.version}`, `  id: ${record.id}`, '  captures:']
  for (const capture of record.captures) {
    lines.push(
      `    - id: ${capture.id}`,
      `      projection: ${capture.projection}`,
      `      sourceBodySha256: ${capture.sourceBodySha256}`,
    )
    if (capture.start !== null && capture.end !== null) lines.push(`      start: ${capture.start}`, `      end: ${capture.end}`)
    lines.push(
      `      exact: "${encodeRecordText(capture.exact)}"`,
      `      prefix: "${encodeRecordText(capture.prefix)}"`,
      `      suffix: "${encodeRecordText(capture.suffix)}"`,
    )
  }
  return lines.join(lineEnding)
}

// --- The Source line ------------------------------------------------------------------------------

const ENTITY_RE = /&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/u
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/u
const CONTROL_RE = /\p{Cc}/u

/** Percent-decoding as native relocation does: a malformed escape or invalid UTF-8 keeps the text as written. */
function decodePercent(value: string): string {
  if (!value.includes('%')) return value
  const bytes: number[] = []
  const encoder = new TextEncoder()
  for (let index = 0; index < value.length;) {
    const hex = value.slice(index + 1, index + 3)
    if (value.charAt(index) === '%' && /^[0-9A-Fa-f]{2}$/u.test(hex)) {
      bytes.push(Number.parseInt(hex, 16))
      index += 3
      continue
    }
    const char = String.fromCodePoint(value.codePointAt(index) ?? 0)
    bytes.push(...encoder.encode(char))
    index += char.length
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(new Uint8Array(bytes))
  } catch {
    return value
  }
}

function folderOf(path: string): string[] {
  return path.split('/').slice(0, -1)
}

const unreadable = (reason: SourceLinkProblem): SourceLinkState => ({ status: 'unreadable', reason })

/**
 * The vault-relative note a Source destination names, resolved from the commentary's own folder (a
 * leading `/` is the vault root, as native relocation reads it). Escapes, entities, queries and
 * fragments are refused rather than interpreted; leaving the vault is refused.
 */
export function resolveSourceDestination(commentaryPath: string, destination: string): SourceLinkState {
  let target = destination
  if (target.startsWith('<')) {
    if (!target.endsWith('>') || target.length < 3) return unreadable('malformed')
    target = target.slice(1, -1)
    if (/[<>\n]/u.test(target)) return unreadable('malformed')
  } else if (/\s/u.test(target)) {
    return unreadable('malformed')
  }
  if (target === '' || target.includes('\\') || ENTITY_RE.test(target) || CONTROL_RE.test(target)) return unreadable('malformed')
  if (SCHEME_RE.test(target) || target.startsWith('//')) return unreadable('external')
  if (/[?#]/u.test(target)) return unreadable('malformed')
  const decoded = decodePercent(target)
  if (CONTROL_RE.test(decoded)) return unreadable('malformed')
  const segments = target.startsWith('/') ? [] : folderOf(commentaryPath)
  for (const part of decoded.split(/[\\/]/u)) {
    if (part === '' || part === '.') continue
    if (part !== '..') segments.push(part)
    else if (segments.pop() === undefined) return unreadable('outsideVault')
  }
  const name = segments.at(-1)
  if (!name || name.length <= 3 || !name.toLowerCase().endsWith('.md')) return unreadable('notNote')
  return { status: 'linked', sourcePath: segments.join('/'), destination }
}

const RAW_DESTINATION_RE = /^[A-Za-z0-9._-]$/u
const VISIBLE_UNICODE_RE = /^[\p{L}\p{M}\p{N}\p{P}\p{S}]$/u

/** One path segment for a link destination: ASCII outside `A-Za-z0-9-._` and invisible Unicode are %-encoded. */
function encodeDestinationSegment(segment: string): string {
  let encoded = ''
  const encoder = new TextEncoder()
  for (const char of segment) {
    if (RAW_DESTINATION_RE.test(char) || ((char.codePointAt(0) ?? 0) > 0x7f && VISIBLE_UNICODE_RE.test(char))) {
      encoded += char
      continue
    }
    for (const byte of encoder.encode(char)) encoded += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return encoded
}

/** A vault-relative `.md` path: `/`-separated, no empty, `.` or `..` segment, no backslash or control character. */
export const isVaultNotePath = (path: unknown): path is string => {
  if (typeof path !== 'string') return false
  const segments = path.split('/')
  return segments.every(segment => segment !== '' && segment !== '.' && segment !== '..' && !CONTROL_RE.test(segment) && !segment.includes('\\'))
    && segments[segments.length - 1].toLowerCase().endsWith('.md')
}

/** The relative destination from a commentary to its source, e.g. `./page.md` or `../Topics/page.md`; null for an invalid path. */
export function sourceLinkDestination(commentaryPath: string, sourcePath: string): string | null {
  if (!isVaultNotePath(commentaryPath) || !isVaultNotePath(sourcePath)) return null
  const from = folderOf(commentaryPath)
  const to = sourcePath.split('/')
  let common = 0
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common += 1
  const parts = [...Array.from({ length: from.length - common }, () => '..'), ...to.slice(common).map(encodeDestinationSegment)]
  return parts[0] === '..' ? parts.join('/') : `./${parts.join('/')}`
}

const HEADINGS = new Set(['ATXHeading1', 'SetextHeading1'])

function linkCount(node: MarkdownNode): number {
  let count = 0
  const cursor = node.cursor()
  while (cursor.next() && cursor.from < node.to) if (cursor.name === 'Link') count += 1
  return count
}

/** The first block after an optional H1 must be exactly `[Source](destination)`. */
function sourceLineOf(body: MarkdownBody, commentaryPath: string): { title: string | null; source: SourceLinkState } {
  const blocks = childrenOf(body.top)
  const heading = blocks[0] && HEADINGS.has(blocks[0].name) ? blocks[0] : null
  const title = heading ? visibleTextOf(body, heading) : null
  const paragraph = blocks[heading ? 1 : 0]
  if (paragraph?.name !== 'Paragraph') return { title, source: { status: 'missing' } }
  const links = linkCount(paragraph)
  if (links === 0) return { title, source: { status: 'missing' } }
  if (links > 1) return { title, source: unreadable('multiple') }
  const link = paragraph.firstChild
  const parts = link ? childrenOf(link) : []
  const mark = (index: number, text: string) => parts[index]?.name === 'LinkMark' && body.slice(parts[index].from, parts[index].to) === text
  const shaped = link?.name === 'Link' && link.nextSibling === null
    && body.slice(paragraph.from, paragraph.to).trim() === body.slice(link.from, link.to)
    && parts.length === 5 && mark(0, '[') && mark(1, ']') && mark(2, '(') && parts[3].name === 'URL' && mark(4, ')')
    && body.slice(parts[0].to, parts[1].from) === SOURCE_LINK_LABEL
  if (!shaped || !link) return { title, source: unreadable('malformed') }
  return { title, source: resolveSourceDestination(commentaryPath, body.slice(parts[3].from, parts[3].to)) }
}

/** Everything the domain reads from one note: its record, its Source line and its title. */
export function readCommentaryNote(path: string, content: string): CommentaryNote {
  const { state } = readCommentaryRecord(content)
  const { title, source } = sourceLineOf(new MarkdownBody(sourceBodyOf(content)), path)
  return { path, title, record: state, source }
}

/** A cheap pre-filter: only notes whose text names the record key can be commentaries. */
export function mayHaveCommentaryRecord(content: string): boolean {
  return content.startsWith('---') && content.includes(COMMENTARY_RECORD_KEY)
}

// --- Writing --------------------------------------------------------------------------------------

/** The body with the entry appended after one blank line, and where the entry starts. */
function appendToBody(body: string, entry: string, lineEnding: string): { text: string; entryStart: number } {
  let prefix = body
  if (prefix.trim() !== '') {
    if (!/\n$/u.test(prefix)) prefix += lineEnding
    if (!/(?:^|\n)[ \t]*\r?\n$/u.test(prefix)) prefix += lineEnding
  }
  return { text: `${prefix}${entry.replaceAll('\n', lineEnding)}${lineEnding}`, entryStart: prefix.length }
}

/**
 * Whether the entry starts its own top-level quote and no earlier block runs into it. False when the
 * note ends inside a fence, an HTML block or another construct that would swallow appended text.
 */
function entryStandsAlone(text: string, entryStart: number): boolean {
  const body = new MarkdownBody(text)
  const start = body.normalized(entryStart)
  for (const block of childrenOf(body.top)) {
    if (block.from < start && block.to > start) return false
    if (block.from >= start) return block.from === start && block.name === 'Blockquote'
  }
  return false
}

/** Whether a quoted entry can be added at the end of this note without being swallowed by its tail. */
export function canAppendAfter(content: string): boolean {
  const { text, entryStart } = appendToBody(sourceBodyOf(content), '> x', lineEndingOf(content))
  return entryStandsAlone(text, entryStart)
}

export interface NewCommentaryParts {
  readonly record: CommentaryRecord
  /** Literal title text; encoded here. */
  readonly title: string
  readonly sourceDestination: string
  /** Entry Markdown with `\n` line breaks. */
  readonly entry: string
}

/** A new commentary note. Throws `LiteralMarkdownTextError` when the title cannot be written literally. */
export function composeNewCommentary(parts: NewCommentaryParts): string {
  const heading = encodeLiteralMarkdownInline(parts.title)
  return `---\n${serializeCommentaryRecord(parts.record)}\n---\n# ${heading}\n\n[${SOURCE_LINK_LABEL}](${parts.sourceDestination})\n\n${parts.entry}\n`
}

/**
 * The note with its record replaced by `record` and `entry` appended, or null when the entry would
 * not stand alone. The record's own lines are the only bytes before the body's end that change.
 */
export function composeAppendedCommentary(content: string, location: RecordLocation, record: CommentaryRecord, entry: string): string | null {
  const lineEnding = lineEndingOf(content)
  const serialized = serializeCommentaryRecord(record, lineEnding) + (location.endsWithLineBreak ? lineEnding : '')
  const updated = `${content.slice(0, location.from)}${serialized}${content.slice(location.to)}`
  const [frontmatter, body] = splitFrontmatter(updated)
  const { text, entryStart } = appendToBody(body, entry, lineEnding)
  return entryStandsAlone(text, entryStart) ? `${frontmatter}${text}` : null
}
