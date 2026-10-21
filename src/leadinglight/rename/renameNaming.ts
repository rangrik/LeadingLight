/**
 * Native rename naming rules for the browser bridges: `title_to_slug`, `validate_filename_stem`,
 * the `title:` front matter writer and the untitled filename test, ported from `src-tauri`.
 */

export class RenameNameError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RenameNameError'
  }
}

/** Lowercase; Unicode letters and digits kept; every other run becomes one hyphen. */
export function titleToSlug(title: string): string {
  const slug = [...title.toLowerCase()]
    .map(ch => (/[\p{Alphabetic}\p{N}]/u.test(ch) ? ch : '-'))
    .join('')
    .split('-')
    .filter(Boolean)
    .join('-')
  return slug || 'untitled'
}

const RESERVED = new Set(['CON', 'PRN', 'AUX', 'NUL', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap(n => [`COM${n}`, `LPT${n}`])])

/** A portable single path segment without `.md`, or the native refusal message. */
export function normalizeFilenameStem(value: unknown): string {
  const trimmed = String(value ?? '').trim()
  const stem = (trimmed.endsWith('.md') ? trimmed.slice(0, -3) : trimmed).trim()
  if (!stem) throw new RenameNameError('New filename cannot be empty')
  const invalid = stem === '.' || stem === '..' || stem.endsWith('.') || stem.endsWith(' ')
    || /[\p{Cc}<>:"/\\|?*]/u.test(stem) || RESERVED.has((stem.split('.')[0] ?? stem).toUpperCase())
  if (invalid) throw new RenameNameError('Invalid filename')
  return stem
}

/** `untitled-note-1700000000.md` and the like: the one-shot automatic rename's candidates. */
export function isUntitledFilename(filename: string): boolean {
  const stem = filename.endsWith('.md') ? filename.slice(0, -3) : filename
  return stem.startsWith('untitled-') && /^\d+$/.test(stem.split('-').pop() ?? '')
}

const lineEnd = (content: string, start: number) => {
  const index = content.slice(start).search(/[\r\n]/)
  return index === -1 ? content.length : start + index
}
const lineBreak = (content: string, index: number): [string, number] | null => {
  if (content.startsWith('\r\n', index)) return ['\r\n', 2]
  if (content[index] === '\n') return ['\n', 1]
  return content[index] === '\r' ? ['\r', 1] : null
}
const isDelimiter = (line: string) => line.startsWith('---') && /^[ \t]*$/.test(line.slice(3))

function yamlString(value: string): string {
  const rustFloat = /^[+-]?(inf|infinity|nan|\d+\.?\d*(e[+-]?\d+)?|\.\d+(e[+-]?\d+)?)$/i
  const needsQuoting = value.includes(':') || value.includes('#') || value.startsWith('[') || value.startsWith('{')
    || ['true', 'false', 'null'].includes(value) || rustFloat.test(value)
  return needsQuoting ? `"${value.replaceAll('"', '\\"')}"` : value
}

function frontmatterKey(line: string): string | null {
  const trimmed = line.trimStart()
  for (const quote of ['"', "'"]) {
    if (!trimmed.startsWith(quote)) continue
    const close = trimmed.indexOf(quote, 1)
    return close !== -1 && trimmed.slice(close + 1).trimStart().startsWith(':') ? trimmed.slice(1, close) : null
  }
  const colon = trimmed.indexOf(':')
  const key = colon === -1 ? '' : trimmed.slice(0, colon).trim()
  return key || null
}

/** Native `update_frontmatter_content(content, "title", title)`; unchanged when front matter is unclosed. */
export function setFrontmatterTitle(content: string, title: string): string {
  const field = title.includes('\n')
    ? `title: |\n${title.split('\n').map(line => line ? `  ${line}` : '').join('\n')}`
    : `title: ${yamlString(title)}`
  const openingEnd = lineEnd(content, 0)
  const opening = lineBreak(content, openingEnd)
  if (!isDelimiter(content.slice(0, openingEnd)) || !opening) return `---\n${field}\n---\n${content}`
  const [ending, openingBreak] = opening
  const bodyStart = openingEnd + openingBreak
  for (let lineStart = bodyStart; lineStart < content.length;) {
    const end = lineEnd(content, lineStart)
    if (isDelimiter(content.slice(lineStart, end))) {
      const lines = content.slice(bodyStart, lineStart).split(ending)
      if (lines.at(-1) === '') lines.pop()
      const result: string[] = []
      let found = false
      for (let index = 0; index < lines.length; index += 1) {
        if (frontmatterKey(lines[index]) !== 'title') {
          result.push(lines[index])
          continue
        }
        found = true
        while (index + 1 < lines.length && /^(| {2}.*|\t.*)$/.test(lines[index + 1])) index += 1
        result.push(field)
      }
      if (!found) result.push(field)
      return `---${ending}${result.join(ending)}${ending}---${content.slice(end)}`
    }
    const next = lineBreak(content, end)
    if (!next) break
    lineStart = end + next[1]
  }
  return content
}

/** Native `slug_to_title`, the filename fallback title. */
export const slugToTitle = (stem: string) =>
  stem.split('-').filter(Boolean).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
