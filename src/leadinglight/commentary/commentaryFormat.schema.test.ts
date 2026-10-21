import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it } from 'vitest'
import { schema } from '../../components/editorSchema'
import { resolveBlocksForTarget } from '../../hooks/editorBlockResolution'
import {
  installRichEditorMarkdownSerializer, serializeRichEditorDocumentToMarkdown, type RichEditorMarkdownSerializer,
} from '../../utils/richEditorMarkdown'
import { readCommentaryNote } from './commentaryFormat'
import { prepareCommentaryCreate } from './commentaryPreparation'
import { projectMarkdownBody } from './passageProjection'
import { captureOf, composedFor, uuid } from './commentary.test-utils'

/**
 * Commentary notes under the app's own editor schema (HTML, Mermaid, math, tldraw, callout and
 * attachment blocks). Like extensionMarkdown.schema.test.ts, a worktree cannot load this schema, so
 * this runs in the integrated primary checkout.
 */

interface InlineNode { type: string; text?: string; href?: string; styles?: Record<string, unknown>; content?: unknown }
interface BlockNode { type: string; content?: unknown; props?: Record<string, unknown>; children?: BlockNode[] }

const NOTE_PATH = '/vault/Topics/commentary-on-example.md'
const items = (content: unknown): InlineNode[] => (Array.isArray(content) ? content as InlineNode[] : [])
const textOf = (content: unknown): string => items(content).map(item => (item.type === 'text' ? item.text ?? '' : textOf(item.content))).join('')
const flat = (blocks: BlockNode[]): BlockNode[] => blocks.flatMap(block => [block, ...flat(block.children ?? [])])

async function open(markdown: string, editor = BlockNoteEditor.create({ schema })): Promise<BlockNode[]> {
  const { blocks } = await resolveBlocksForTarget({ editor, cache: new Map(), content: markdown, targetPath: NOTE_PATH })
  return flat(blocks as BlockNode[])
}

async function save(markdown: string): Promise<string> {
  const editor = BlockNoteEditor.create({ schema })
  installRichEditorMarkdownSerializer(editor)
  const { blocks } = await resolveBlocksForTarget({ editor, cache: new Map(), content: markdown, targetPath: NOTE_PATH })
  return serializeRichEditorDocumentToMarkdown({ editor: editor as unknown as RichEditorMarkdownSerializer, blocks, tabContent: markdown, notePath: NOTE_PATH })
}

const PASSAGE = [
  '```mermaid', 'graph TD; A-->B', '```', '```html scripts=sandboxed', '<script>alert(1)</script>', '```',
  '$$', 'x^2', '$$', '```tldraw', '{}', '```', '[!note] Not a callout', '==not highlighted==', '![[attachment.png]]',
].join('\n')

function note(): string {
  const capture = captureOf('# Example\n\nx\n', PASSAGE)
  const prepared = prepareCommentaryCreate({
    capture, document: composedFor(capture, { thought: PASSAGE }, 'create'), commentaryId: uuid(0xf0),
    folder: 'Topics', title: 'Commentary on Example', fileName: 'commentary-on-example.md',
  })
  if (prepared.status !== 'ready') throw new Error(prepared.reason)
  return prepared.write.content
}

describe('commentary notes under the app editor schema', () => {
  it('never become HTML, Mermaid, math, whiteboard, callout or attachment blocks', async () => {
    const content = note()
    for (const blocks of [await open(content), await open(await save(content))]) {
      expect(blocks.map(block => block.type).filter(type => !['heading', 'paragraph', 'quote'].includes(type))).toEqual([])
      expect(blocks.filter(block => block.type === 'quote').map(block => textOf(block.content)).join('\n')).toBe(PASSAGE)
      expect(blocks.filter(block => block.type === 'paragraph').slice(1).map(block => textOf(block.content)).join('\n')).toBe(PASSAGE)
      expect(items(blocks[1].content)).toEqual([expect.objectContaining({ type: 'link', href: './example.md' })])
    }
  })

  it('keeps the record and Source line through a save', async () => {
    const content = note()
    expect(readCommentaryNote('Topics/commentary-on-example.md', await save(content))).toEqual(readCommentaryNote('Topics/commentary-on-example.md', content))
  })

  it('projects a callout body without its marker line, as the callout block shows it', async () => {
    const body = '> [!note] Title\n> body text'
    const callout = (await open(body)).find(block => block.type !== 'paragraph')
    expect(callout && textOf(callout.content)).toBe(projectMarkdownBody(body).text)
  })
})
