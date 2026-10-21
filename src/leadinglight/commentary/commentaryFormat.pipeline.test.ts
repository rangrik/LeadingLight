import { BlockNoteEditor } from '@blocknote/core'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { resolveBlocksForTarget } from '../../hooks/editorBlockResolution'
import { tryParseFastMarkdownBlocks } from '../../hooks/editorFastMarkdownBlocks'
import {
  installRichEditorMarkdownSerializer, preProcessRichEditorMarkdown, serializeRichEditorDocumentToMarkdown, type RichEditorMarkdownSerializer,
} from '../../utils/richEditorMarkdown'
import { extractOutgoingLinks, splitFrontmatter } from '../../utils/wikilinks'
import { TemplatePreview } from '../templates/TemplatePreview'
import { readCommentaryNote, sourceBodyOf } from './commentaryFormat'
import { prepareCommentaryAppend, prepareCommentaryCreate } from './commentaryPreparation'
import { PROJECTION_OBJECT, projectMarkdownBody, wikilinkText } from './passageProjection'
import { BASELINE_SHA, captureOf, composedFor, uuid } from './commentary.test-utils'

/**
 * Commentary notes through the real readers of a page: the rich editor's parse (and its >= 16 KiB
 * fast parser), a canonical save and reopen, the passive preview, and the outgoing-link reader.
 * Default BlockNote schema, as extensionMarkdown.pipeline.test.ts; the app schema runs in the
 * integrated checkout. Also qualifies projection v1 against the rich editor's own blocks.
 */

interface InlineNode { type: string; text?: string; href?: string; styles?: Record<string, unknown>; content?: unknown; props?: Record<string, string> }
interface BlockNode { type: string; content?: unknown; props?: Record<string, unknown>; children?: BlockNode[] }

const NOTE_PATH = '/vault/Topics/commentary-on-example.md'
const FILLER = `\n\n${'Filler words that make this note large. '.repeat(500)}`
const items = (content: unknown): InlineNode[] => (Array.isArray(content) ? content as InlineNode[] : [])
const flat = (blocks: BlockNode[]): BlockNode[] => blocks.flatMap(block => [block, ...flat(block.children ?? [])])

/** The rich editor's visible text by the projection's rules: leaf blocks joined by line breaks. */
function inlineText(content: unknown): string {
  return items(content).map(item => {
    if (item.type === 'text') return item.text ?? ''
    if (item.type === 'wikilink') return wikilinkText(item.props?.target ?? '')
    if (item.type === 'mathInline') return `$${item.props?.latex ?? ''}$`
    return inlineText(item.content)
  }).join('')
}
const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'quote', 'bulletListItem', 'numberedListItem', 'checkListItem', 'codeBlock', 'calloutBlock'])
function richText(blocks: BlockNode[]): string {
  return flat(blocks).flatMap(block => {
    if (TEXT_BLOCKS.has(block.type)) return [inlineText(block.content)]
    const table = block.content as { type?: string; rows?: Array<{ cells: unknown[] }> } | undefined
    if (table?.type === 'tableContent') return (table.rows ?? []).flatMap(row => row.cells.map(cell => inlineText((cell as { content?: unknown }).content ?? cell)))
    return [PROJECTION_OBJECT]
  }).join('\n')
}

async function open(markdown: string, editor = BlockNoteEditor.create()): Promise<BlockNode[]> {
  const { blocks } = await resolveBlocksForTarget({ editor, cache: new Map(), content: markdown, targetPath: NOTE_PATH })
  return blocks as BlockNode[]
}

async function openLarge(markdown: string): Promise<BlockNode[]> {
  const content = `${markdown.replace(/\n+$/u, '')}${FILLER}`
  expect(tryParseFastMarkdownBlocks(preProcessRichEditorMarkdown(sourceBodyOf(content))).metrics.fallbackReason).toBeNull()
  return (await open(content)).slice(0, -1)
}

/** A canonical save of the whole note, frontmatter included, as the rich editor writes it. */
async function canonicalSave(markdown: string): Promise<string> {
  const editor = BlockNoteEditor.create()
  installRichEditorMarkdownSerializer(editor)
  const blocks = await open(markdown, editor)
  return serializeRichEditorDocumentToMarkdown({ editor: editor as unknown as RichEditorMarkdownSerializer, blocks, tabContent: markdown })
}

function preview(markdown: string) {
  const view = render(createElement(TemplatePreview, { content: markdown, locale: 'en' }))
  const formatted = view.getByTestId('template-preview-formatted')
  const result = {
    text: formatted.textContent ?? '',
    live: [...formatted.querySelectorAll('img, script, iframe, object, embed, input, form, style')].map(element => element.tagName.toLowerCase()),
  }
  view.unmount()
  return result
}

const SOURCE = '# Example\n\nsource text\n'
const HOSTILE_PASSAGE = [
  '```html scripts=sandboxed', '<script>parent.document.title = "pwned"</script>', '```',
  '---', 'title: injected', '---', '[Source](../../secret.md)', 'See [[Weekly Review|the review]] and ![x](https://evil.example/p.png)',
  '<img src=https://evil.example/q.png> <iframe srcdoc="x"></iframe> &lt;b&gt; AT&T', '$x$ and ==mark== and \\{brace\\}', '> [!note] not a callout',
  '| a | b |', '| --- | --- |', '- item', '1. ordered', '# heading',
].join('\n')
const THOUGHT = 'Thinking about *this* and [[that]].\nSecond line.'

function hostileNote(): string {
  const capture = captureOf(SOURCE, HOSTILE_PASSAGE)
  const prepared = prepareCommentaryCreate({
    capture, document: composedFor(capture, { thought: THOUGHT, question: 'Is <b>this</b> [[safe]]?' }, 'create'),
    commentaryId: uuid(0xe0), folder: 'Topics', title: 'Commentary on Example', fileName: 'commentary-on-example.md',
  })
  if (prepared.status !== 'ready') throw new Error(prepared.reason)
  return prepared.write.content
}

function expectHostile(blocks: BlockNode[]) {
  const all = flat(blocks)
  expect(all[0]).toMatchObject({ type: 'heading', props: { level: 1 } })
  expect(inlineText(all[0].content)).toBe('Commentary on Example')
  expect(all[1].type).toBe('paragraph')
  expect(items(all[1].content)).toEqual([expect.objectContaining({ type: 'link', href: './example.md' })])
  expect(inlineText(all[1].content)).toBe('Source')
  const quotes = all.filter(block => block.type === 'quote')
  expect(quotes.map(block => inlineText(block.content)).join('\n')).toBe(HOSTILE_PASSAGE)
  expect(all.filter(block => block.type === 'paragraph').slice(1).map(block => inlineText(block.content)).join('\n')).toBe(THOUGHT)
  expect(all.filter(block => block.type === 'bulletListItem').map(block => inlineText(block.content))).toEqual(['Question: Is <b>this</b> [[safe]]?'])
  const types = new Set(all.map(block => block.type))
  for (const type of types) expect(['heading', 'paragraph', 'quote', 'bulletListItem']).toContain(type)
  // The encoder's pinned limitation: bare http(s) text still autolinks, its target matching its text.
  const inline = all.flatMap(block => items(block.content))
  const autolink = (item: InlineNode) => item.type === 'link' && /^https:\/\//u.test(item.href ?? '') && decodeURI(item.href ?? '') === inlineText(item.content)
  expect(inline.filter(item => item.type !== 'text' && !autolink(item) && !(item.type === 'link' && item.href === './example.md'))).toEqual([])
  expect(inline.filter(item => item.type === 'link' && item.href === './example.md')).toHaveLength(1)
  expect(inline.flatMap(item => Object.entries(item.styles ?? {}).filter(([, on]) => on))).toEqual([])
}

describe('a commentary with a hostile passage, through the real readers', () => {
  it('opens as title, one Source link, the literal quote and the literal entry', async () => {
    const content = hostileNote()
    expectHostile(await open(content))
    expect(extractOutgoingLinks(content)).toEqual([])
  })

  it('opens the same way past 16 KiB through the fast parser', async () => {
    expectHostile(await openLarge(hostileNote()))
  })

  it('keeps the record and the Source line through two canonical saves', async () => {
    const content = hostileNote()
    const first = await canonicalSave(content)
    const second = await canonicalSave(first)
    for (const saved of [first, second]) {
      expect(splitFrontmatter(saved)[0]).toBe(splitFrontmatter(content)[0])
      expect(readCommentaryNote('Topics/commentary-on-example.md', saved)).toEqual(readCommentaryNote('Topics/commentary-on-example.md', content))
      expectHostile(await open(saved))
    }
  })

  it('shows the passage as text in the passive preview with nothing live', () => {
    const { text, live } = preview(hostileNote())
    expect(live).toEqual([])
    for (const line of HOSTILE_PASSAGE.split('\n').filter(line => !line.includes('\\{'))) expect(text).toContain(line)
  })

  it('stays one note with one Source line after an append and a save', async () => {
    const created = hostileNote()
    const capture = captureOf(SOURCE, 'source text', { id: 2 })
    const appended = prepareCommentaryAppend({
      capture, document: composedFor(capture, { thought: 'Later.' }, 'append'),
      target: { path: 'Topics/commentary-on-example.md', content: created, contentSha256: BASELINE_SHA },
    })
    if (appended.status !== 'ready') throw new Error(appended.reason)
    const saved = await canonicalSave(appended.write.content)
    const note = readCommentaryNote('Topics/commentary-on-example.md', saved)
    expect(note.source).toMatchObject({ status: 'linked', sourcePath: 'Topics/example.md' })
    expect(note.record.status === 'ready' && note.record.record.captures.map(item => item.exact)).toEqual([HOSTILE_PASSAGE, 'source text'])
    const blocks = flat(await open(saved))
    expect(blocks.filter(block => items(block.content).some(item => item.type === 'link' && item.href === './example.md'))).toHaveLength(1)
    expect(blocks.filter(block => block.type === 'quote').map(block => inlineText(block.content)).at(-1)).toBe('source text')
  })
})

describe('projection v1 against the rich editor', () => {
  const parity: Array<[string, string]> = [
    ['a commentary note', `${sourceBodyOf(hostileNote())}`],
    ['headings, paragraphs and breaks', '# One\n\nPara *em* **strong** ~~del~~ `code` [link](x.md)\nsoft line\n\n## Two\n\nhard  \nbreak'],
    ['lists and tasks', '- a\n- b\n  - c\n\n1. one\n2. two\n\n- [ ] todo\n- [x] done'],
    ['quotes', '> one\n> two\n\n> a\n>\n> b'],
    ['code blocks', '```js\nlet a = 1\n\nlet b\n```\n\ntext'],
    ['escapes, entities and wikilinks', 'a \\* b &amp; c &copy; [[Note]] [[Note|Label]] \\{x\\}'],
    ['extra blank lines', 'a\n\n\n\nb'],
    ['CJK and emoji', '漢字かな 👩🏽‍💻 é'],
    ['tables with short rows', '| a | b |\n|---|---|\n| 1 | 2 |\n| x |'],
    ['references, code spans and setext headings', '[ref][r] and [r]\n\n[r]: ./x.md\n\n` spaced ` `` a`b ``\n\nSetext\n===\n\n    indented'],
    ['objects and dropped HTML', '![img](a.png)\n\n***\n\n<div>\nhtml\n</div>\n\na <b>b</b> c\n\n```mermaid\ngraph\n```'],
    ['highlights, including colour prefixes, and odd delimiters', '==mark== and ==🟢green== text\n\nodd == stays'],
    ['CRLF line endings', 'one\r\ntwo\r\n\r\nthree'],
    ['callouts, whose marker line is a block property', '> [!note] Title\n> body text\n\n> [!tip]\n> body\n>\n> more'],
    ['inline math as its source', 'Area $x^2$ grows.'],
  ]
  it.each(parity)('agrees for %s', async (_name, body) => {
    expect(richText(await open(body))).toBe(projectMarkdownBody(body).text)
  })
})
