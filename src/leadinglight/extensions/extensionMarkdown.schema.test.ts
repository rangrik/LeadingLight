import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it } from 'vitest'
import { schema } from '../../components/editorSchema'
import { resolveBlocksForTarget } from '../../hooks/editorBlockResolution'
import {
  installRichEditorMarkdownSerializer, serializeRichEditorBlocksToMarkdown, type RichEditorMarkdownSerializer,
} from '../../utils/richEditorMarkdown'
import type { DocumentBlock } from './extensionContract'
import { buildExtensionMarkdown } from './extensionMarkdown'

/**
 * The host builder through the app's own editor schema (HTML, Mermaid, math, tldraw, callout and
 * attachment blocks). A worktree cannot load this schema (its symlinked dependencies put the
 * IronCalc WASM asset outside the Vite root), so this runs in the integrated primary checkout.
 */

interface InlineNode { type: string; text?: string; styles?: Record<string, unknown>; content?: unknown }
interface BlockNode { type: string; content?: unknown; props?: Record<string, unknown>; children?: BlockNode[] }

const NOTE_PATH = '/vault/Meetings/generated.md'
const items = (content: unknown): InlineNode[] => (Array.isArray(content) ? content as InlineNode[] : [])
const textOf = (content: unknown): string => items(content).map(item => (item.type === 'text' ? item.text ?? '' : textOf(item.content))).join('')
const marksOf = (content: unknown): string[] => items(content).flatMap(item => item.type === 'text'
  ? Object.entries(item.styles ?? {}).filter(([, on]) => on).map(([style]) => style) : [item.type, ...marksOf(item.content)])
const flat = (blocks: BlockNode[]): BlockNode[] => blocks.flatMap(block => [block, ...flat(block.children ?? [])])

async function open(markdown: string, editor = BlockNoteEditor.create({ schema })): Promise<BlockNode[]> {
  const { blocks } = await resolveBlocksForTarget({ editor, cache: new Map(), content: markdown, targetPath: NOTE_PATH })
  return flat(blocks as BlockNode[])
}

async function reopenAfterSave(markdown: string): Promise<BlockNode[]> {
  const editor = BlockNoteEditor.create({ schema })
  installRichEditorMarkdownSerializer(editor)
  const blocks = await open(markdown, editor)
  return open(serializeRichEditorBlocksToMarkdown({ editor: editor as unknown as RichEditorMarkdownSerializer, blocks }))
}

function build(title: string, blocks: DocumentBlock[]): string {
  const built = buildExtensionMarkdown({ title, blocks, textBytes: 0 }, 'Fallback')
  if (built.status !== 'built') throw new Error(`refused: ${built.reason}`)
  return built.markdown.content
}

const PLACEHOLDERS = ['```mermaid\ngraph TD; A-->B\n```', '```html scripts=sandboxed\n<script>alert(1)</script>\n```', '$$\nx^2\n$$', '```tldraw\n{}\n```']

describe('host Markdown under the app editor schema', () => {
  it('never becomes an HTML, Mermaid, math, whiteboard or callout block', async () => {
    const text = [...PLACEHOLDERS, '[!note] Not a callout', '==not highlighted=='].join('\n')
    const markdown = build('Schema check', [{ type: 'paragraph', text }, { type: 'quote', text }])
    for (const blocks of [await open(markdown), await reopenAfterSave(markdown)]) {
      expect(blocks.map(block => block.type).filter(type => !['heading', 'paragraph', 'quote'].includes(type))).toEqual([])
      expect(blocks.flatMap(block => marksOf(block.content))).toEqual([])
      const paragraphs = blocks.filter(block => block.type === 'paragraph').map(block => textOf(block.content)).join('\n')
      const quotes = blocks.filter(block => block.type === 'quote').map(block => textOf(block.content)).join('\n')
      expect(paragraphs).toBe(text)
      expect(quotes).toBe(text)
    }
  })

  it('keeps headings and list items as the typed structure', async () => {
    const markdown = build('Debrief: *literal* [title]', [
      { type: 'heading', level: 3, text: '## not deeper' },
      { type: 'list', style: 'numbered', items: ['1. not nested', '- not a bullet'] },
    ])
    const blocks = await reopenAfterSave(markdown)
    expect(blocks.map(block => [block.type, textOf(block.content)])).toEqual([
      ['heading', 'Debrief: *literal* [title]'],
      ['heading', '## not deeper'],
      ['numberedListItem', '1. not nested'],
      ['numberedListItem', '- not a bullet'],
    ])
    expect(blocks.map(block => block.props?.level).slice(0, 2)).toEqual([1, 3])
  })
})
