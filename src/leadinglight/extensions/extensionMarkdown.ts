// Host-only Markdown for an extension's typed document. The structure (title heading, headings,
// blank-line block separation, quote and list markers) is written here; every piece of text,
// whether package literal or person's answer, goes through the accepted literal encoder in exactly
// the contexts it documents. There are no templates: a package never supplies Markdown.
import { PROPOSAL_LIMITS } from '../proposals/proposalContract'
import { sha256Hex } from '../saveOutcome'
import { slugifyNoteStem } from '../../utils/noteSlug'
import type { ComposedDocument, DocumentBlock } from './extensionContract'
import {
  LiteralMarkdownTextError, encodeLiteralMarkdownInline, encodeLiteralMarkdownLines, type LiteralMarkdownTextFailure,
} from './extensionMarkdownText'
import { utf8Bytes } from './extensionSchema'

/**
 * `source`: a captured-passage block, which E1 cannot prepare (association is E2), so it is refused
 * rather than guessed. `unsafeText`: the encoder refused some text (control characters, malformed
 * Unicode, an internal marker). `tooLarge`: the encoded page is over the proposal limit.
 */
export type MarkdownRefusal = 'source' | 'unsafeText' | 'tooLarge'

export interface HostMarkdown {
  /** The title the page's first heading shows; the fallback when the recipe's title is blank. */
  readonly title: string
  /** One path segment from the existing title-to-filename rule, ending in `.md`. */
  readonly fileName: string
  /** The exact page bytes, as text. */
  readonly content: string
  readonly contentBytes: number
}

export type MarkdownBuild =
  | { readonly status: 'built'; readonly markdown: HostMarkdown }
  | { readonly status: 'refused'; readonly reason: MarkdownRefusal; readonly failure: LiteralMarkdownTextFailure | null }

const FILE_EXTENSION = '.md'
// Names Windows reserves for devices; harmless elsewhere, but never a portable file name.
const DEVICE_NAMES = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/

/** Keeps whole code points and leaves no trailing hyphen. */
function clipToBytes(stem: string, maxBytes: number): string {
  let clipped = ''
  for (const char of stem) {
    if (utf8Bytes(clipped + char) > maxBytes) break
    clipped += char
  }
  return clipped.replace(/-+$/u, '')
}

/** The same slug the app's rename pipeline uses for titles, bounded to one portable path segment. */
export function fileNameForTitle(title: string): string {
  const maxStemBytes = PROPOSAL_LIMITS.fileNameBytes - utf8Bytes(FILE_EXTENSION)
  let stem = clipToBytes(slugifyNoteStem(title), maxStemBytes) || 'untitled'
  if (DEVICE_NAMES.test(stem)) stem = `${stem}-note`
  return `${stem}${FILE_EXTENSION}`
}

class SourceBlockRefused extends Error {}

function listItem(marker: string, text: string): string {
  return encodeLiteralMarkdownLines(text)
    .map((line, index) => (index === 0 ? `${marker}${line}` : line && `${' '.repeat(marker.length)}${line}`))
    .join('\n')
}

/** One block's Markdown, or '' when its text is blank and the block would be empty. */
function blockMarkdown(block: DocumentBlock): string {
  switch (block.type) {
    case 'source':
      throw new SourceBlockRefused()
    case 'heading': {
      const text = encodeLiteralMarkdownInline(block.text)
      return text ? `${'#'.repeat(block.level)} ${text}` : ''
    }
    case 'paragraph':
      return encodeLiteralMarkdownLines(block.text).join('\n')
    case 'quote':
      return encodeLiteralMarkdownLines(block.text).map(line => (line ? `> ${line}` : '>')).join('\n')
    case 'list': {
      const items = block.items.filter(item => encodeLiteralMarkdownLines(item).length > 0)
      return items.map((item, index) => listItem(block.style === 'bullet' ? '- ' : `${index + 1}. `, item)).join('\n')
    }
  }
}

function titleOf(document: ComposedDocument, fallbackTitle: string): string {
  const title = document.title ?? ''
  return encodeLiteralMarkdownInline(title) ? title.trim() : fallbackTitle.trim()
}

/**
 * The page a create proposal would write. `fallbackTitle` (the command's own title) names a page
 * whose composed title is blank. Pure and synchronous, so the live preview shows these exact bytes.
 */
export function buildExtensionMarkdown(document: ComposedDocument, fallbackTitle: string): MarkdownBuild {
  try {
    const title = titleOf(document, fallbackTitle)
    const heading = encodeLiteralMarkdownInline(title)
    const parts = [`# ${heading}`, ...document.blocks.map(blockMarkdown).filter(part => part !== '')]
    const content = `${parts.join('\n\n')}\n`
    const contentBytes = utf8Bytes(content)
    if (!heading || contentBytes > PROPOSAL_LIMITS.contentBytes) return { status: 'refused', reason: heading ? 'tooLarge' : 'unsafeText', failure: null }
    return { status: 'built', markdown: { title, fileName: fileNameForTitle(title), content, contentBytes } }
  } catch (error) {
    if (error instanceof SourceBlockRefused) return { status: 'refused', reason: 'source', failure: null }
    if (error instanceof LiteralMarkdownTextError) {
      return { status: 'refused', reason: error.reason === 'tooLong' ? 'tooLarge' : 'unsafeText', failure: error.reason }
    }
    throw error
  }
}

/** Lowercase hex SHA-256 of the content's UTF-8 bytes, as the proposal carries it. */
export const markdownSha256 = (markdown: HostMarkdown): Promise<string> => sha256Hex(markdown.content)

/** Whether one answer can be written literally; the run dialog checks each field before Create. */
export function answerTextProblem(text: string, multiline: boolean): LiteralMarkdownTextFailure | null {
  try {
    if (multiline) encodeLiteralMarkdownLines(text)
    else encodeLiteralMarkdownInline(text)
    return null
  } catch (error) {
    if (error instanceof LiteralMarkdownTextError) return error.reason
    throw error
  }
}
