/**
 * Byte-preserving Markdown destination updates for a managed page rename or move.
 *
 * TypeScript port of `src-tauri/src/leadinglight_relocation_links.rs` for the browser disk
 * bridge, the memory preview and for proving draft rebases against native receipts. It never
 * reads files. Destinations are located with the installed Lezer Markdown parser; only their
 * spans change. Native remains the authority: callers prove a transform reproduces a native
 * receipt's before -> after bytes before applying it to newer text.
 */
import { markdownLanguage } from '@codemirror/lang-markdown'

type SyntaxNode = ReturnType<ReturnType<typeof markdownLanguage.parser.parse>['cursor']>['node']

type Kind = 'link' | 'image'

interface Destination {
  start: number
  end: number
  value: string
  kind: Kind
  wiki: boolean
}

interface Context {
  vault: string[]
  source: string[]
  old: string[]
  next: string[]
  outgoing: boolean
}

export class RelocationRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RelocationRefusal'
  }
}

const refuse = (message: string): never => { throw new RelocationRefusal(message) }

/** Preserve the outgoing page's relative references and explicit self-links. */
export function rebaseOutgoing(content: string, vault: string, oldNote: string, newNote: string): string {
  return transform(content, context(vault, oldNote, oldNote, newNote, true))
}

/** Retarget ordinary Markdown links in another page that identify `oldTarget`. */
export function retargetIncoming(content: string, vault: string, sourceNote: string, oldTarget: string, newTarget: string): string {
  return transform(content, context(vault, sourceNote, oldTarget, newTarget, false))
}

function context(vault: string, source: string, old: string, next: string, outgoing: boolean): Context {
  const result = { vault: nativeSegments(vault), source: nativeSegments(source), old: nativeSegments(old), next: nativeSegments(next), outgoing }
  for (const path of [result.source, result.old, result.next]) {
    if (!startsWith(path, result.vault) || path.length <= result.vault.length) refuse('A page relocation path is outside the local vault.')
  }
  return result
}

function nativeSegments(path: string): string[] {
  if (!path.startsWith('/')) refuse('Page relocation requires absolute native paths.')
  const result = ['']
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') { if (result.length > 1) result.pop() } else result.push(segment)
  }
  return result
}

const startsWith = (path: readonly string[], prefix: readonly string[]) => prefix.every((segment, index) => path[index] === segment)
const sameSegments = (left: readonly string[], right: readonly string[]) => left.length === right.length && startsWith(left, right)

function transform(content: string, ctx: Context): string {
  if (sameSegments(ctx.old, ctx.next)) return content
  const changes = new Map<string, { start: number; end: number; text: string }>()
  for (const destination of destinations(content)) {
    const raw = content.slice(destination.start, destination.end)
    const replacement = (destination.wiki && destination.kind === 'link'
      ? selfWikilink(destination.value, ctx)
      : relocateDestination(raw, destination, ctx)) ?? raw
    const key = `${destination.start}:${destination.end}`
    const previous = changes.get(key)
    if (previous && previous.text !== replacement) {
      refuse('A shared Markdown reference has different image and link meanings; use separate reference definitions before moving this page.')
    }
    changes.set(key, { start: destination.start, end: destination.end, text: replacement })
  }
  let result = content
  let followingStart = content.length
  for (const change of [...changes.values()].sort((left, right) => right.start - left.start || right.end - left.end)) {
    if (change.end > followingStart) refuse('Overlapping Markdown destinations cannot be relocated safely.')
    result = result.slice(0, change.start) + change.text + result.slice(change.end)
    followingStart = change.start
  }
  return result
}

/** Start of the Markdown body after optional YAML front matter. */
export function bodyStart(content: string): number {
  const bom = content.startsWith('﻿') ? 1 : 0
  const lines = content.slice(bom).split(/(?<=\n)/)
  if (lines.length === 0 || lines[0].replace(/[\r\n]+$/, '') !== '---') return bom
  let offset = bom + lines[0].length
  for (const line of lines.slice(1)) {
    offset += line.length
    const bare = line.replace(/[\r\n]+$/, '')
    if (bare === '---' || bare === '...') return offset
  }
  return refuse('The page has unclosed YAML frontmatter; close it before moving the page.')
}

const CODE_OR_HTML = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'HTMLBlock', 'HTMLTag', 'CommentBlock', 'Comment', 'ProcessingInstructionBlock', 'ProcessingInstruction', 'Autolink', 'URL'])
const HTML_NODES = new Set(['HTMLBlock', 'HTMLTag', 'CommentBlock', 'Comment', 'ProcessingInstructionBlock', 'ProcessingInstruction'])

/** CommonMark label matching: whitespace collapsed and Unicode case folded. */
const normalizeLabel = (label: string) => label.replace(/[\t\n\r ]+/g, ' ').trim().toLowerCase().toUpperCase()

interface Definition { start: number; end: number; value: string; used: boolean }

function destinations(content: string): Destination[] {
  const offset = bodyStart(content)
  const body = content.slice(offset)
  const tree = markdownLanguage.parser.parse(body)
  const definitions = new Map<string, Definition>()
  const uses: { node: SyntaxNode; kind: Kind; label: string }[] = []
  const result: Destination[] = []
  const cursor = tree.cursor()
  do {
    const name = cursor.name
    if (HTML_NODES.has(name) && hasHtmlDestinationAttribute(body.slice(cursor.from, cursor.to))) {
      refuse('HTML link or image attributes cannot be relocated safely; use Markdown links and images before moving this page.')
    }
    if (name === 'LinkReference') {
      const node = cursor.node
      const label = node.getChild('LinkLabel')
      const url = node.getChild('URL')
      if (!label || !url) continue
      const text = body.slice(label.from + 1, label.to - 1)
      // A footnote definition is not a link reference.
      if (text.startsWith('^')) continue
      const key = normalizeLabel(text)
      // The first definition of a label wins, as in CommonMark.
      if (key && !definitions.has(key)) definitions.set(key, { ...destinationSpan(body, url.from, url.to), used: false })
      continue
    }
    if (name !== 'Link' && name !== 'Image') continue
    const node = cursor.node
    const kind: Kind = name === 'Image' ? 'image' : 'link'
    const url = node.getChild('URL')
    if (url) {
      result.push({ ...destinationSpan(body, url.from, url.to), kind, wiki: false })
      continue
    }
    // `[text]()` is an inline link with an empty destination, not a reference use.
    if (node.getChildren('LinkMark').some(mark => body[mark.from] === '(')) continue
    const label = node.getChild('LinkLabel')
    const labelText = label && label.to - label.from > 2
      ? body.slice(label.from + 1, label.to - 1)
      : linkText(body, node)
    if (labelText !== null) uses.push({ node, kind, label: normalizeLabel(labelText) })
  } while (cursor.next())
  for (const use of uses) {
    const definition = definitions.get(use.label)
    if (!definition) continue
    definition.used = true
    result.push({ start: definition.start, end: definition.end, value: definition.value, kind: use.kind, wiki: false })
  }
  for (const definition of definitions.values()) {
    const value = definition.value.trim()
    if (!definition.used && value && !value.startsWith('#') && !value.startsWith('?') && !external(value)) {
      refuse('An unused local Markdown reference has no known image or link meaning; remove it or use it explicitly before moving this page.')
    }
  }
  result.push(...wikiDestinations(body, tree.topNode))
  return result.map(item => ({ ...item, start: item.start + offset, end: item.end + offset }))
}

function linkText(body: string, node: SyntaxNode): string | null {
  const marks = node.getChildren('LinkMark')
  if (marks.length < 2) return null
  return body.slice(marks[0].to, marks[1].from)
}

function destinationSpan(body: string, from: number, to: number): { start: number; end: number; value: string } {
  const angle = body[from] === '<' && body[to - 1] === '>'
  const start = angle ? from + 1 : from
  const end = angle ? to - 1 : to
  return { start, end, value: decodeEntities(unescapeMarkdown(body.slice(start, end))) }
}

/** `[[target|label]]` and `![[image|size]]` outside code and HTML. */
function wikiDestinations(body: string, top: SyntaxNode): Destination[] {
  const result: Destination[] = []
  for (const match of body.matchAll(/(!?)\[\[([^[\]\n]+?)\]\]/g)) {
    const start = match.index ?? 0
    if (insideCodeOrHtml(top, start)) continue
    const opening = match[1].length + 2
    const inner = match[2]
    const pipe = inner.indexOf('|')
    const target = pipe === -1 ? inner : inner.slice(0, pipe)
    const leading = target.length - target.trimStart().length
    const trailing = target.trimEnd().length
    if (trailing <= leading) continue
    const from = start + opening + leading
    const to = start + opening + trailing
    result.push({ start: from, end: to, value: body.slice(from, to), kind: match[1] ? 'image' : 'link', wiki: true })
  }
  return result
}

function insideCodeOrHtml(top: SyntaxNode, position: number): boolean {
  for (let node: SyntaxNode | null = top.resolveInner(position, 1); node; node = node.parent) {
    if (CODE_OR_HTML.has(node.name)) return true
  }
  return false
}

export function hasHtmlDestinationAttribute(html: string): boolean {
  const lower = html.toLowerCase()
  return ['href', 'src', 'srcset', 'poster'].some(name => {
    for (let index = lower.indexOf(name); index !== -1; index = lower.indexOf(name, index + 1)) {
      if (index > 0 && !/\s/.test(lower[index - 1])) continue
      let after = index + name.length
      while (after < lower.length && /\s/.test(lower[after])) after += 1
      if (lower[after] === '=') return true
    }
    return false
  })
}

function selfWikilink(value: string, ctx: Context): string | null {
  if (!ctx.outgoing) return null
  const old = ctx.old.slice(ctx.vault.length).join('/')
  const next = ctx.next.slice(ctx.vault.length).join('/')
  const trimmed = value.trim()
  let replacement: string | null = null
  if (trimmed === old && (trimmed.includes('/') || trimmed.endsWith('.md'))) replacement = next
  else if (trimmed === noteStem(old) && trimmed.includes('/')) replacement = noteStem(next)
  if (replacement !== null && /[|[\]\n\r]/.test(replacement)) {
    refuse('The destination folder cannot be represented safely in this self-wikilink.')
  }
  return replacement
}

function noteStem(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.markdown')) return path.slice(0, -9)
  if (lower.endsWith('.md')) return path.slice(0, -3)
  return path
}

function external(value: string): boolean {
  if (value.startsWith('//') || value.startsWith('\\\\')) return true
  const colon = value.indexOf(':')
  if (colon === -1) return false
  const scheme = value.slice(0, colon)
  return /^[A-Za-z][A-Za-z0-9+.-]*$/.test(scheme)
}

const portableImage = (value: string) => value.startsWith('attachments/') || value.startsWith('./attachments/') || value.startsWith('/attachments/')

function isImagePath(value: string): boolean {
  const extension = (value.split('.').pop() ?? '').toLowerCase()
  return ['avif', 'bmp', 'gif', 'jpg', 'jpeg', 'png', 'svg', 'webp', 'tif', 'tiff'].includes(extension)
}

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/

export function unescapeMarkdown(value: string): string {
  let result = ''
  for (let index = 0; index < value.length; index += 1) {
    const next = value[index + 1]
    if (value[index] === '\\' && next !== undefined && ASCII_PUNCTUATION.test(next)) {
      result += next
      index += 1
    } else result += value[index]
  }
  return result
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(value: string): string {
  return value.replace(/&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]*);/g, (match, name: string) => {
    if (name.startsWith('#')) {
      const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10)
      return code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : '�'
    }
    return NAMED_ENTITIES[name] ?? match
  })
}

const suffixStart = (value: string) => {
  const index = value.search(/[?#]/)
  return index === -1 ? value.length : index
}

const IMAGE_RESERVED = ';/?:@&=+$,#'
const encoder = new TextEncoder()
const strictDecoder = new TextDecoder('utf-8', { fatal: true })

function decodePath(value: string, image: boolean): string {
  const bytes = encoder.encode(value)
  const decoded: number[] = []
  const hex = (byte: number) => {
    const digit = Number.parseInt(String.fromCharCode(byte), 16)
    return Number.isNaN(digit) ? null : digit
  }
  for (let index = 0; index < bytes.length;) {
    if (bytes[index] !== 0x25) {
      decoded.push(bytes[index])
      index += 1
      continue
    }
    if (index + 3 > bytes.length) return value
    const high = hex(bytes[index + 1])
    const low = hex(bytes[index + 2])
    if (high === null || low === null) return value
    const byte = high * 16 + low
    if (image && IMAGE_RESERVED.includes(String.fromCharCode(byte))) decoded.push(...bytes.slice(index, index + 3))
    else decoded.push(byte)
    index += 3
  }
  try { return strictDecoder.decode(new Uint8Array(decoded)) } catch { return value }
}

function resolve(base: readonly string[], path: string): string[] {
  const target = [...base]
  for (const segment of path.split(/[/\\]/)) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') { if (target.length > 1) target.pop() } else target.push(segment)
  }
  return target
}

function relocateDestination(raw: string, destination: Destination, ctx: Context): string | null {
  const image = destination.kind === 'image'
  const value = destination.value.trim()
  if (!value || (!image && (value.startsWith('#') || value.startsWith('?'))) || external(value)) return null
  if (image && (portableImage(value) || value.startsWith('/'))) return null
  // Bare wiki image names are vault attachments, not note-relative paths.
  if (destination.wiki && (!isImagePath(value) || (!/[/\\]/.test(value) && !value.startsWith('.')))) return null
  // The image preprocessor decodes the complete raw destination as a native path.
  const pathEnd = image ? value.length : suffixStart(value)
  const path = value.slice(0, pathEnd)
  const rooted = path.startsWith('/')
  const decoded = decodePath(path, image)
  const isNote = noteStem(decoded) !== decoded
  if (rooted && !isNote) return null
  const sourceParent = ctx.source.slice(0, -1)
  const base = rooted ? ctx.vault : sourceParent
  const original = resolve(base, decoded)
  let target = original
  if (sameSegments(target, ctx.old) && (!image || isNote)) target = [...ctx.next]
  else if (!ctx.outgoing) return null
  if (!ctx.outgoing && image) return null
  const newParent = ctx.outgoing ? ctx.next.slice(0, -1) : sourceParent
  if (sameSegments(target, original) && (rooted || sameSegments(newParent, sourceParent))) return null
  const unescaped = unescapeMarkdown(raw)
  if (unescaped !== value || (image && raw !== value)) {
    refuse('A local Markdown destination uses escaping or character entities that cannot be relocated safely; use a percent-encoded destination first.')
  }
  const rawPathEnd = image ? raw.length : suffixStart(raw)
  const rawPath = raw.slice(0, rawPathEnd)
  const suffix = raw.slice(rawPathEnd)
  let relative: string
  if (rooted) {
    if (!startsWith(target, ctx.vault)) refuse('A vault-root link escaped the local vault.')
    relative = `/${spellSegments(target.slice(ctx.vault.length), rawPath, image)}`
  } else {
    let common = 0
    while (common < newParent.length && common < target.length && newParent[common] === target[common]) common += 1
    if (common === 0) refuse('A local destination is on a different filesystem root.')
    const parts = [...Array<string>(newParent.length - common).fill('..'), ...target.slice(common)]
    const spelled = spellSegments(parts, rawPath, image)
    relative = parts[0] === '..' ? spelled : `./${spelled}`
    // ./attachments is a special vault-root image form; an extra dot keeps the relative meaning.
    if (image && portableImage(relative)) relative = `./${relative}`
  }
  return `${relative}${suffix}`
}

function spellSegments(parts: readonly string[], rawPath: string, image: boolean): string {
  const rawParts = rawPath.split('/')
  let suffixCount = 0
  for (let index = 0; index < Math.min(parts.length, rawParts.length); index += 1) {
    const part = parts[parts.length - 1 - index]
    const raw = rawParts[rawParts.length - 1 - index]
    if (decodePath(unescapeMarkdown(raw), image) !== part) break
    suffixCount += 1
  }
  return parts.map((part, index) => index >= parts.length - suffixCount
    ? rawParts[rawParts.length - (parts.length - index)]
    : encodeSegment(part, image)).join('/')
}

function encodeSegment(value: string, image: boolean): string {
  let result = ''
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    // decodeURI keeps escapes for its reserved set; those stay literal for image paths.
    const imageReserved = image && IMAGE_RESERVED.includes(ch)
    const ascii = code < 0x80
    if (!imageReserved && ascii && (code < 0x20 || code === 0x7F || /\s/.test(ch) || '%#?[]()<>\\|`"\'&:'.includes(ch))) {
      result += `%${code.toString(16).toUpperCase().padStart(2, '0')}`
    } else result += ch
  }
  return result
}

/**
 * Whether a page the exact transform refused could still name `target` in a local link:
 * its filename, case-folded, in any percent, character-reference or backslash spelling.
 * `false` proves the refusal cannot hide a reference to the target.
 */
export function mayNameTarget(content: string, target: string): boolean {
  const filename = target.split('/').pop()
  if (!filename) return true
  const needle = filename.toLowerCase()
  const lower = content.toLowerCase()
  if (lower.includes(needle)) return true
  const references = decodeReferences(lower)
  if (references === null) return true
  return [
    unescapeMarkdown(decodePercent(references)),
    decodePercent(unescapeMarkdown(references)),
    decodePercent(lower),
    unescapeMarkdown(lower),
  ].some(spelling => spelling.toLowerCase().includes(needle))
}

function decodeReferences(text: string): string | null {
  let unknown = false
  const decoded = text.replace(/&([A-Za-z0-9#]+);/g, (match, name: string) => {
    if (name.startsWith('#x')) {
      const code = Number.parseInt(name.slice(2), 16)
      return Number.isNaN(code) || code > 0x10FFFF ? match : String.fromCodePoint(code)
    }
    if (name.startsWith('#')) {
      const code = Number.parseInt(name.slice(1), 10)
      return Number.isNaN(code) || code > 0x10FFFF ? match : String.fromCodePoint(code)
    }
    const known = NAMED_ENTITIES[name]
    if (known === undefined) unknown = true
    return known ?? match
  })
  return unknown ? null : decoded
}

function decodePercent(text: string): string {
  const bytes = encoder.encode(text)
  const decoded: number[] = []
  for (let index = 0; index < bytes.length;) {
    const pair = bytes[index] === 0x25 ? String.fromCharCode(bytes[index + 1] ?? 0, bytes[index + 2] ?? 0) : ''
    if (/^[0-9a-fA-F]{2}$/.test(pair)) {
      decoded.push(Number.parseInt(pair, 16))
      index += 3
    } else {
      decoded.push(bytes[index])
      index += 1
    }
  }
  return new TextDecoder().decode(new Uint8Array(decoded))
}

/** Legacy page wikilinks: `[[old]]` or `[[old|label]]` for each old target. */
export function legacyWikilinkPattern(targets: readonly string[]): RegExp | null {
  const unique = [...new Set(targets.filter(Boolean))]
  if (unique.length === 0) return null
  const escaped = unique.map(target => target.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&'))
  return new RegExp(`\\[\\[(?:${escaped.join('|')})(\\|[^\\]]*?)?\\]\\]`, 'g')
}

export function replaceLegacyWikilinks(content: string, pattern: RegExp | null, newTarget: string): string {
  if (!pattern) return content
  return content.replace(pattern, (_match, pipe: string | undefined) => `[[${newTarget}${pipe ?? ''}]]`)
}

export function legacyWikilinkTargets(oldTitle: string, oldPathStem: string): string[] {
  const filenameStem = oldPathStem.split('/').pop() ?? oldPathStem
  return [...new Set([oldTitle, oldPathStem, filenameStem].filter(Boolean))]
}

/** One committed rename, as every linked page sees it. */
export interface LinkRetarget {
  vault: string
  oldPath: string
  newPath: string
  /** Legacy wikilink targets: old title, vault-relative stem and filename stem. */
  oldTargets: readonly string[]
  newTarget: string
}

/**
 * A linked page's text after the rename: exact Markdown retarget, then legacy wikilinks.
 * A page the parser refuses keeps its Markdown; `unverified` when it may still name the old file.
 */
export function retargetLinkedPage(content: string, pagePath: string, retarget: LinkRetarget): { content: string; unverified: boolean } {
  let markdown = content
  let unverified = false
  try {
    markdown = retargetIncoming(content, retarget.vault, pagePath, retarget.oldPath, retarget.newPath)
  } catch {
    unverified = mayNameTarget(content, retarget.oldPath)
  }
  return { content: replaceLegacyWikilinks(markdown, legacyWikilinkPattern(retarget.oldTargets), retarget.newTarget), unverified }
}

/** A rename within one folder: only explicit self-links change; a refused page keeps its bytes. */
export function rebaseInPlace(content: string, vault: string, oldPath: string, newPath: string): { content: string; unverified: boolean } {
  try {
    return { content: rebaseOutgoing(content, vault, oldPath, newPath), unverified: false }
  } catch {
    return { content, unverified: mayNameTarget(content, oldPath) }
  }
}

/** Vault-relative path without `.md`, the legacy wikilink target spelling. */
export function vaultRelativeStem(path: string, vault: string): string {
  const root = vault.replace(/\/+$/, '')
  const relative = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path.split('/').pop() ?? path
  return relative.replace(/\.md$/i, '')
}
