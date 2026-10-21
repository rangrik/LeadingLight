// Shared helpers for the website capture tests: synthetic fixtures, and the editor's real readers
// of a note (its resolution path, both parsers, and its canonical save), independent of the
// summary the conversion uses for its own check.
import { BlockNoteEditor } from '@blocknote/core'
import { expect } from 'vitest'
import { resolveBlocksForTarget } from '../../hooks/editorBlockResolution'
import { clearParsedNoteBlockCache } from '../../hooks/editorParsedBlockCache'
import { tryParseFastMarkdownBlocks } from '../../hooks/editorFastMarkdownBlocks'
import { extractEditorBody } from '../../hooks/editorTabContent'
import {
  installRichEditorMarkdownSerializer, preProcessRichEditorMarkdown, serializeRichEditorBlocksToMarkdown, type RichEditorMarkdownSerializer,
} from '../../utils/richEditorMarkdown'
import type { CapturedPage, WebCaptureConversion } from './webCaptureContract'
import { convertWebCapture, type WebCaptureOptions } from './webCapturePipeline'
import articleHtml from './fixtures/article.html?raw'
import hostileHtml from './fixtures/hostile.html?raw'
import literalsHtml from './fixtures/literals.html?raw'
import reservedMarkerHtml from './fixtures/reserved-marker.html?raw'
import scriptOnlyHtml from './fixtures/script-only.html?raw'
import shortHtml from './fixtures/short.html?raw'
import signInHtml from './fixtures/sign-in.html?raw'

export interface InlineNode { type: string; text?: string; href?: string; styles?: Record<string, unknown>; content?: unknown; props?: Record<string, unknown> }
export interface BlockNode { type: string; content?: unknown; props?: Record<string, unknown>; children?: BlockNode[] }

export const CAPTURED_AT = '2026-10-20T14:03:11Z'
const NOTE_PATH = '/vault/Web/captured.md'
type TestEditor = Parameters<typeof resolveBlocksForTarget>[0]['editor']

const FIXTURES: Readonly<Record<string, string>> = {
  article: articleHtml,
  hostile: hostileHtml,
  literals: literalsHtml,
  'reserved-marker': reservedMarkerHtml,
  'script-only': scriptOnlyHtml,
  short: shortHtml,
  'sign-in': signInHtml,
}

/** A synthetic fixture page from `fixtures/`, as text. */
export function fixture(name: string): string {
  const html = FIXTURES[name]
  if (html === undefined) throw new Error(`no fixture ${name}`)
  return html
}

export function page(html: string, overrides: Partial<CapturedPage> = {}): CapturedPage {
  return {
    requestedUrl: 'https://pages.example.org/a',
    finalUrl: 'https://pages.example.org/2026/10/page',
    fetchedAt: CAPTURED_AT,
    html,
    hadReplacements: false,
    ...overrides,
  }
}

export type Converted = Extract<WebCaptureConversion, { status: 'converted' }>

export async function convert(html: string, options: WebCaptureOptions = {}, overrides: Partial<CapturedPage> = {}): Promise<Converted> {
  const result = await convertWebCapture(page(html, overrides), options)
  if (result.status !== 'converted') throw new Error(`refused: ${result.reason}`)
  return result
}

export const items = (content: unknown): InlineNode[] => (Array.isArray(content) ? content as InlineNode[] : [])

export function textOf(content: unknown): string {
  return items(content).map(item => (item.type === 'text' ? item.text ?? '' : textOf(item.content))).join('')
}

/** Marks and inline kinds other than plain text, e.g. `bold`, `link:https://…`, `wikilink`. */
export function marksOf(content: unknown): string[] {
  return items(content).flatMap(item => (item.type === 'text'
    ? Object.entries(item.styles ?? {}).filter(([, on]) => on).map(([style]) => style)
    : [item.href ? `${item.type}:${item.href}` : item.type, ...marksOf(item.content)]))
}

/** A block's inline content; a table's cells, row by row. */
export function inlineOf(block: BlockNode | undefined): InlineNode[] {
  if (block?.type !== 'table') return items(block?.content)
  const rows = (block.content as { rows?: Array<{ cells?: Array<{ content?: unknown }> }> }).rows ?? []
  return rows.flatMap(row => (row.cells ?? []).flatMap(cell => items(cell.content)))
}

export function flat(blocks: BlockNode[]): BlockNode[] {
  return blocks.flatMap(block => [block, ...flat(block.children ?? [])])
}

export async function open(content: string, editor: TestEditor = BlockNoteEditor.create() as unknown as TestEditor): Promise<BlockNode[]> {
  clearParsedNoteBlockCache(NOTE_PATH)
  const { blocks } = await resolveBlocksForTarget({ editor, cache: new Map(), content, targetPath: NOTE_PATH })
  clearParsedNoteBlockCache(NOTE_PATH)
  return blocks as BlockNode[]
}

/** Opening a note, then the editor's canonical save of exactly what it opened. */
export async function canonicalSave(content: string, createEditor: () => unknown = () => BlockNoteEditor.create()): Promise<string> {
  const editor = createEditor()
  installRichEditorMarkdownSerializer(editor)
  const blocks = await open(content, editor as TestEditor)
  const [frontmatter] = content.match(/^---\n[\s\S]*?\n---\n/u) ?? ['']
  return `${frontmatter}${serializeRichEditorBlocksToMarkdown({ editor: editor as unknown as RichEditorMarkdownSerializer, blocks })}`
}

export const LARGE_FILLER = `\n\n${'Filler words that only make this note large. '.repeat(420).trimEnd()}\n`

/** The note grown past 16 KiB, so the editor offers it to its fast parser first. */
export function largeVersion(content: string): { content: string; fastParser: string | null } {
  const large = `${content.replace(/\n+$/u, '')}${LARGE_FILLER}`
  expect(new TextEncoder().encode(large).length).toBeGreaterThan(16 * 1024)
  const reason = tryParseFastMarkdownBlocks(preProcessRichEditorMarkdown(extractEditorBody(large))).metrics.fallbackReason
  return { content: large, fastParser: reason }
}
