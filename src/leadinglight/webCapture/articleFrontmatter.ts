// Frontmatter for a captured note: a few ordinary properties and one hidden provenance record.
//
//   source     the page's final URL, the only URL any code reads back (one authority)
//   author     the page's byline, when it has a short one
//   site       the page's site name, when it has a short one
//   published  YYYY-MM-DD, only from an ISO-8601 date on the page
//   captured   UTC timestamp of the fetch, injected by the caller
//   _leadinglight_capture   version, kind, requested (only when redirected), extractor, converter
//
// Values are written the way the app's own property writer would quote them, so re-saving an
// unchanged value from the properties panel keeps the line. Each value is then read back with the
// app's frontmatter reader (the properties panel) and a YAML parser (as the native reader does);
// an optional value either reader would see differently is left out rather than written wrong.
import { parse as parseYaml } from 'yaml'
import { parseFrontmatter } from '../../utils/frontmatter'
import { WebCaptureRefusalError } from './articleText'
import {
  WEB_CAPTURE_ARTICLE_CONVERTER, WEB_CAPTURE_EXTRACTOR, WEB_CAPTURE_LINK_CONVERTER, WEB_CAPTURE_PROVENANCE_KEY,
  WEB_CAPTURE_PROVENANCE_VERSION, type WebCaptureArticleMetadata, type WebCaptureSource,
} from './webCaptureContract'

export type CaptureKind = 'article' | 'link'

interface Field {
  readonly key: string
  readonly value: string
  readonly required: boolean
}

// The native writer quotes a value with `:` or `#`, a leading `[` or `{`, true/false/null, or
// anything Rust parses as a float.
const NATIVE_NUMBER = /^[+-]?(?:inf|infinity|nan|(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)$/iu
const NATIVE_WORDS = new Set(['true', 'false', 'null'])
// Plain YAML scalars that would not read back as the same string.
const PLAIN_INDICATOR_START = /^[-?:,[\]{}#&*!|>'"%@`\s]/u
const YAML_WORDS = new Set(['true', 'false', 'null', '~', 'yes', 'no', 'on', 'off', 'y', 'n'])
const YAML_NUMBER = /^(?:[-+]?(?:\.\d+|\d[\d_]*(?:\.\d*)?)(?:e[-+]?\d+)?|0x[0-9a-f]+|0o[0-7]+|0b[01]+|[-+]?\.inf|\.nan)$/iu

function nativeQuotes(value: string): boolean {
  return value.includes(':') || value.includes('#') || value.startsWith('[') || value.startsWith('{')
    || NATIVE_WORDS.has(value) || NATIVE_NUMBER.test(value)
}

function plainHazard(value: string): boolean {
  return value === '' || PLAIN_INDICATOR_START.test(value) || /\s$/u.test(value)
    || YAML_WORDS.has(value.toLowerCase()) || YAML_NUMBER.test(value)
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true
  }
  return false
}

/** A single-line YAML scalar both readers return as `value`, or `null` when none exists. */
export function yamlScalar(value: string): string | null {
  if (hasControlCharacter(value)) return null
  if (!nativeQuotes(value) && !plainHazard(value)) return value
  if (!value.includes('"') && !value.includes('\\')) return `"${value}"`
  return value.includes("'") ? null : `'${value}'`
}

function fieldsFor(source: WebCaptureSource, metadata: WebCaptureArticleMetadata | null): Field[] {
  const optional = (key: string, value: string | null | undefined): Field[] => (value ? [{ key, value, required: false }] : [])
  return [
    { key: 'source', value: source.sourceUrl, required: true },
    ...optional('author', metadata?.byline),
    ...optional('site', metadata?.siteName),
    ...optional('published', metadata?.published),
    { key: 'captured', value: source.capturedAt, required: true },
  ]
}

function provenanceFor(source: WebCaptureSource, kind: CaptureKind): Record<string, string | number> {
  return {
    version: WEB_CAPTURE_PROVENANCE_VERSION,
    kind,
    ...(source.requestedUrl !== source.sourceUrl ? { requested: source.requestedUrl } : {}),
    ...(kind === 'article' ? { extractor: WEB_CAPTURE_EXTRACTOR } : {}),
    converter: kind === 'article' ? WEB_CAPTURE_ARTICLE_CONVERTER : WEB_CAPTURE_LINK_CONVERTER,
  }
}

function render(fields: readonly Field[], provenance: Record<string, string | number>): string {
  const line = (key: string, value: string | number, indent = ''): string => {
    const scalar = typeof value === 'number' ? String(value) : yamlScalar(value)
    if (scalar === null) throw new WebCaptureRefusalError('invalidInput')
    return `${indent}${key}: ${scalar}`
  }
  const lines = [
    ...fields.map(field => line(field.key, field.value)),
    `${WEB_CAPTURE_PROVENANCE_KEY}:`,
    ...Object.entries(provenance).map(([key, value]) => line(key, value, '  ')),
  ]
  return `---\n${lines.join('\n')}\n---\n`
}

function readsBack(frontmatter: string, fields: readonly Field[], provenance: Record<string, string | number>): Set<string> {
  const wrong = new Set<string>()
  const panel = parseFrontmatter(`${frontmatter}# x\n`)
  let yaml: unknown
  try {
    yaml = parseYaml(frontmatter.slice(4, -4), { uniqueKeys: true })
  } catch {
    return new Set(fields.map(field => field.key))
  }
  const record = typeof yaml === 'object' && yaml !== null ? yaml as Record<string, unknown> : {}
  for (const field of fields) {
    if (panel[field.key] !== field.value || record[field.key] !== field.value) wrong.add(field.key)
  }
  const written = record[WEB_CAPTURE_PROVENANCE_KEY]
  if (JSON.stringify(written) !== JSON.stringify(provenance)) wrong.add(WEB_CAPTURE_PROVENANCE_KEY)
  return wrong
}

/** Values that fit in a single YAML line; optional ones that do not are left out. */
function writable(field: Field): boolean {
  return field.required || yamlScalar(field.value) !== null
}

/**
 * The frontmatter block, `---\n…\n---\n`. Refuses as `invalidInput` only if a required value
 * (source URL, capture time) cannot be written exactly, which normalized input never causes.
 */
export function buildFrontmatter(source: WebCaptureSource, metadata: WebCaptureArticleMetadata | null, kind: CaptureKind): string {
  const provenance = provenanceFor(source, kind)
  let fields = fieldsFor(source, metadata).filter(writable)
  let frontmatter = render(fields, provenance)
  const wrong = readsBack(frontmatter, fields, provenance)
  if (wrong.size === 0) return frontmatter
  if (wrong.has(WEB_CAPTURE_PROVENANCE_KEY) || fields.some(field => field.required && wrong.has(field.key))) {
    throw new WebCaptureRefusalError('invalidInput')
  }
  fields = fields.filter(field => !wrong.has(field.key))
  frontmatter = render(fields, provenance)
  if (readsBack(frontmatter, fields, provenance).size > 0) throw new WebCaptureRefusalError('invalidInput')
  return frontmatter
}
