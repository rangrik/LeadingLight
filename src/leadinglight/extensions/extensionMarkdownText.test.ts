import { BlockNoteEditor } from '@blocknote/core'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { describe, expect, it } from 'vitest'
import { resolveBlocksForTarget } from '../../hooks/editorBlockResolution'
import { tryParseFastMarkdownBlocks } from '../../hooks/editorFastMarkdownBlocks'
import { preProcessDurableEditorMarkdown } from '../../utils/editorDurableMarkdown'
import { preProcessHtmlBlockMarkdown } from '../../utils/htmlBlockMarkdown'
import { preProcessLinkedCodeMarkdown } from '../../utils/linkedCodeMarkdown'
import { preProcessMathMarkdown } from '../../utils/mathMarkdown'
import {
  installRichEditorMarkdownSerializer,
  preProcessRichEditorMarkdown,
  serializeRichEditorBlocksToMarkdown,
  serializeRichEditorDocumentToMarkdown,
  type RichEditorMarkdownSerializer,
} from '../../utils/richEditorMarkdown'
import { extractOutgoingLinks, preProcessWikilinks, splitFrontmatter } from '../../utils/wikilinks'
import { TemplatePreview } from '../templates/TemplatePreview'
import {
  encodeLiteralMarkdownInline,
  encodeLiteralMarkdownLines,
  LITERAL_MARKDOWN_TEXT_MAX_LENGTH,
  LiteralMarkdownTextError,
} from './extensionMarkdownText'

interface InlineNode {
  type: string
  text?: string
  href?: string
  styles?: Record<string, unknown>
  content?: unknown
}

interface BlockNode {
  type: string
  content?: unknown
  props?: Record<string, unknown>
  children?: BlockNode[]
}

interface BlockSummary {
  type: string
  text: string
  marks: string[]
}

/** Callout type and title live in props, so assertions check the real block, not the summary. */
interface CalloutBlockNode extends BlockNode {
  props?: Record<string, unknown>
}

const char = (code: number) => String.fromCharCode(code)
const BOM = char(0xfeff)
const NOTE_PATH = '/vault/Generated.md'
const LARGE_NOTE_FILLER = `\n\n${'Filler words that make this note large. '.repeat(500)}`
const SCRIPT_FENCE = [
  '```html scripts=sandboxed height="400"',
  '<script>parent.document.title = "pwned"</script>',
  '```',
].join('\n')

// Host builders exactly as documented in the module contract.
const paragraph = (text: string) => encodeLiteralMarkdownLines(text).join('\n')
const quote = (text: string) => encodeLiteralMarkdownLines(text).map(line => line ? `> ${line}` : '>').join('\n')
const listItem = (marker: string, text: string) => encodeLiteralMarkdownLines(text)
  .map((line, index) => index === 0 ? `${marker}${line}` : line && `${' '.repeat(marker.length)}${line}`)
  .join('\n')

/** What a reader sees: each line without the leading/trailing spaces Markdown drops anyway. */
const readable = (text: string) => text.split('\n').map(line => line.trim()).join('\n')

function inlineItems(content: unknown): InlineNode[] {
  return Array.isArray(content) ? content as InlineNode[] : []
}

function inlineText(content: unknown): string {
  return inlineItems(content).map(item => item.type === 'text' ? item.text ?? '' : inlineText(item.content)).join('')
}

function inlineMarks(content: unknown): string[] {
  return inlineItems(content).flatMap(item => item.type === 'text'
    ? Object.entries(item.styles ?? {}).filter(([, value]) => value).map(([style]) => `style:${style}`)
    : [item.href ? `${item.type}:${item.href}` : item.type, ...inlineMarks(item.content)])
}

function summarize(blocks: BlockNode[]): BlockSummary[] {
  return blocks.flatMap(block => [
    { type: block.type, text: inlineText(block.content), marks: inlineMarks(block.content) },
    ...summarize(block.children ?? []),
  ])
}

async function richEditorBlocks(markdown: string, editor = BlockNoteEditor.create()): Promise<BlockNode[]> {
  const { blocks } = await resolveBlocksForTarget({ editor, cache: new Map(), content: markdown, targetPath: NOTE_PATH })
  return blocks as BlockNode[]
}

/** The same note past 16 KiB, which the editor parses with its own fast Markdown parser. */
async function largeNoteBlocks(markdown: string, expectedFallback: string | null = null): Promise<BlockNode[]> {
  // The filler is joined with exactly one blank line, so a saved file's final newline does not
  // turn into an extra blank paragraph that only this harness created.
  const content = `${markdown.replace(/\n+$/u, '')}${LARGE_NOTE_FILLER}`
  // Either the fast parser handles it, or it deliberately declines and the ordinary parser runs.
  const parsed = tryParseFastMarkdownBlocks(preProcessRichEditorMarkdown(content))
  expect(parsed.metrics.fallbackReason).toBe(expectedFallback)
  return (await richEditorBlocks(content)).slice(0, -1)
}

async function editorViews(markdown: string, largeFallback: string | null = null): Promise<BlockSummary[][]> {
  return [summarize(await richEditorBlocks(markdown)), summarize(await largeNoteBlocks(markdown, largeFallback))]
}

function expectLiteral(summary: BlockSummary[], type: string, text: string): void {
  expect(summary.map(block => block.type)).toEqual(summary.map(() => type))
  expect(summary.flatMap(block => block.marks)).toEqual([])
  expect(summary.map(block => block.text).join('\n')).toBe(text)
}

function passivePreviewText(markdown: string): string {
  const view = render(createElement(TemplatePreview, { content: markdown, locale: 'en' }))
  const text = view.getByTestId('template-preview-formatted').textContent ?? ''
  view.unmount()
  return text
}

/** A generic CommonMark + GFM renderer, without the preview's link and image masking. */
function standardRendering(markdown: string): { tags: string[]; text: string } {
  const view = render(createElement(Markdown, { remarkPlugins: [remarkGfm] }, markdown))
  const tags = [...new Set([...view.container.querySelectorAll('*')].map(element => element.tagName.toLowerCase()))]
  const text = view.container.textContent ?? ''
  view.unmount()
  return { tags, text }
}

function failureOf(encode: () => unknown): Pick<LiteralMarkdownTextError, 'reason' | 'index'> | null {
  try {
    encode()
    return null
  } catch (error) {
    if (!(error instanceof LiteralMarkdownTextError)) throw error
    return { reason: error.reason, index: error.index }
  }
}

function asSerializer(editor: BlockNoteEditor): RichEditorMarkdownSerializer {
  installRichEditorMarkdownSerializer(editor)
  return editor as unknown as RichEditorMarkdownSerializer
}

async function repeatedCanonicalSaves(markdown: string, passes: number): Promise<string> {
  let saved = markdown
  for (let pass = 0; pass < passes; pass += 1) saved = await canonicalSave(saved)
  return saved
}

/** Canonical serialization with no source baseline: copying a block, splitting, or a fresh save. */
async function canonicalSave(markdown: string): Promise<string> {
  const editor = BlockNoteEditor.create()
  const serializer = asSerializer(editor)
  const blocks = await richEditorBlocks(markdown, editor)
  return serializeRichEditorBlocksToMarkdown({ editor: serializer, blocks })
}

describe('encodeLiteralMarkdownLines in paragraphs and quotes', () => {
  it('keeps a selected script-enabled HTML fence literal instead of creating an executable block', async () => {
    expect(await richEditorBlocks(SCRIPT_FENCE)).toContainEqual(expect.objectContaining({
      type: 'htmlBlock',
      props: expect.objectContaining({ scripts: 'sandboxed' }),
    }))

    const selection = [
      'Selected:',
      SCRIPT_FENCE,
      '~~~~html scripts="sandboxed"',
      '<script>alert(1)</script>',
      '~~~~',
      '  ````html scripts=sandboxed',
      '  <iframe srcdoc="<script>alert(1)</script>"></iframe>',
      '  ````',
      '```mermaid',
      'graph TD; A-->B',
      '```',
    ].join('\n')
    for (const [type, markdown] of [['paragraph', paragraph(selection)], ['quote', quote(selection)]]) {
      for (const summary of await editorViews(markdown)) expectLiteral(summary, type, readable(selection))
    }
  })

  it('cannot close or open host structure around a quoted passage', async () => {
    const passage = ['```', '~~~', '</blockquote>', '```html scripts=sandboxed', '<script>alert(1)</script>'].join('\n')
    const note = ['# Reading notes', '', quote(passage), '', 'Host paragraph after the quote.'].join('\n')
    expect(summarize(await richEditorBlocks(note))).toEqual([
      { type: 'heading', text: 'Reading notes', marks: [] },
      { type: 'quote', text: passage, marks: [] },
      { type: 'paragraph', text: 'Host paragraph after the quote.', marks: [] },
    ])
    const large = summarize(await largeNoteBlocks(note))
    expect(large.at(0)).toEqual({ type: 'heading', text: 'Reading notes', marks: [] })
    expectLiteral(large.slice(1, -1), 'quote', passage)
    expect(large.at(-1)).toEqual({ type: 'paragraph', text: 'Host paragraph after the quote.', marks: [] })
  })

  it('keeps HTML, comments, entities and character references as visible text', async () => {
    const html = [
      '<iframe src="//evil.example/frame"></iframe>',
      '<script>alert(1)</script> <img src=x onerror=alert(1)>',
      '<!-- hidden comment --> <div onclick="steal()">block</div>',
      '&amp; &lt;b&gt; &#60;script&#62; &#x3C;img&#x3E; &copy; AT&T &',
    ].join('\n')
    const markdown = paragraph(html)
    for (const summary of await editorViews(markdown)) expectLiteral(summary, 'paragraph', html)
    expect(passivePreviewText(markdown)).toBe(html)
    expect(standardRendering(markdown)).toEqual({ tags: ['p'], text: html })
  })

  it('keeps links, remote images, autolinks and wikilinks from becoming instructions', async () => {
    const image = '![remote](https://evil.example/remote.png)'
    expect(summarize(await richEditorBlocks(image)).map(block => block.type)).toEqual(['image'])
    expect(summarize(await richEditorBlocks('[[Private Page]]')).flatMap(block => block.marks)).toEqual(['wikilink'])

    const links = [
      '[click](javascript:alert(1)) [data](data:text/html;base64,PHNjcmlwdD4=)',
      '<https://evil.example/auto> <javascript:alert(1)> <mailto:a@evil.example>',
      '[ref]: //evil.example/ref.png',
      '![ref] ![[embed.png]] [[Private Page]] [[Page|alias]] [^1]',
      '',
      image,
      '',
      '![pixel](//evil.example/pixel.png)',
    ].join('\n')
    const visible = links.replaceAll('\n\n', '\n')
    const markdown = paragraph(links)
    for (const summary of await editorViews(markdown)) {
      expect(summary.map(block => block.type)).toEqual(['paragraph', 'paragraph', 'paragraph'])
      expect(summary.map(block => block.text).join('\n')).toBe(visible)
      // Bare https and email text still becomes a link (see the pinned limitation below).
      expect(summary.flatMap(block => block.marks).filter(mark => (
        !mark.startsWith('link:https://evil.example/') && mark !== 'link:mailto:a@evil.example'
      ))).toEqual([])
    }
    expect(extractOutgoingLinks(markdown)).toEqual([])
    expect(passivePreviewText(markdown)).toBe(visible)
    const standard = standardRendering(markdown)
    expect(standard.text).toBe(visible)
    expect(standard.tags.filter(tag => tag !== 'p' && tag !== 'a')).toEqual([])
  })

  it('keeps URLs and email addresses readable where the rich editor links them', async () => {
    const url = 'https://example.com/some_page?a=1&b=2'
    const email = 'first_last@example.com'
    const markdown = [paragraph(`Read ${url}.`), paragraph(`Mail ${email}`)].join('\n\n')
    expect(summarize(await richEditorBlocks(markdown))).toEqual([
      { type: 'paragraph', text: `Read ${url}.`, marks: [`link:${url}`] },
      { type: 'paragraph', text: `Mail ${email}`, marks: [`link:mailto:${email}`] },
    ])
    expect(summarize(await largeNoteBlocks(markdown))).toEqual([
      { type: 'paragraph', text: `Read ${url}.`, marks: [] },
      { type: 'paragraph', text: `Mail ${email}`, marks: [] },
    ])
    expect(passivePreviewText(markdown)).toBe(`Read ${url}.\nMail ${email}`)
  })

  // Two raw underscores in one block would pair in the large-note inline parser, so that note
  // takes the ordinary parser; the visible text and both link targets stay exact either way.
  it('keeps underscores in two URLs on one line', async () => {
    const text = 'see https://a.test/one_two and https://b.test/three_four now'
    const markdown = paragraph(text)
    for (const summary of await editorViews(markdown, 'intraword-underscore')) {
      expect(summary.map(block => block.text).join('\n'), 'text').toBe(text)
      expect(summary.flatMap(block => block.marks)).toEqual([
        'link:https://a.test/one_two',
        'link:https://b.test/three_four',
      ])
    }
  })

  it('keeps identifier underscores after a canonical save at both note sizes', async () => {
    const text = 'call snake_case_name with first_arg and keep __dunder__ literal'
    const saved = await canonicalSave(paragraph(text))
    expectLiteral(summarize(await richEditorBlocks(saved)), 'paragraph', text)
    expectLiteral(summarize(await largeNoteBlocks(saved, 'intraword-underscore')), 'paragraph', text)
  })

  it('neutralizes line-start syntax, frontmatter delimiters, tables and math blocks', async () => {
    const structure = [
      '---', 'title: injected', 'icon: //evil.example/icon.png', '---',
      '# Heading', '###### Six', '- item', '+ plus', '* star', '1. one', '2) two', '> quote', '>> nested',
      'Setext', '===', '***', '___', '    indented code', '\tTabbed', '| a | b |', '| --- | --- |', ':--- | ---:',
      'x | y', '--- | ---', 'p | q', '|---|---|',
      '- [ ] task', ':::note', '$$', 'x^2', '$$', '[^1]: footnote', '#tag', '1.5 is not a list',
    ].join('\n')
    expect(splitFrontmatter(structure).at(0)).not.toBe('')

    const markdown = paragraph(structure)
    expect(splitFrontmatter(markdown).at(0)).toBe('')
    for (const summary of await editorViews(markdown)) expectLiteral(summary, 'paragraph', readable(structure))
    expect(passivePreviewText(markdown)).toBe(readable(structure))
    expect(standardRendering(markdown)).toEqual({ tags: ['p'], text: readable(structure) })
  })

  it('keeps a byte-order mark before a frontmatter delimiter from hiding text in the passive preview', () => {
    const text = `${BOM}---\ntitle: hidden?\n---\nbody`
    expect(passivePreviewText(text)).not.toContain('title: hidden?')
    // Markdown parsers drop an invisible byte-order mark at the very start of a document.
    expect(passivePreviewText(paragraph(text))).toBe(text.slice(1))
  })

  it('keeps emphasis, code, strikethrough, math and backslashes literal', async () => {
    const text = [
      '*a* _b_ **c** __d__ ~~e~~ ~f~ `code` ``more`` snake_case_name',
      '$x^2$ $$y$$ \\(z\\) \\[w\\] 10$ and $20',
      'C:\\Users\\name\\{draft} trailing\\',
      '\\*already escaped\\* \\\\ double \\{ brace',
    ].join('\n')
    const markdown = paragraph(text)
    for (const summary of await editorViews(markdown)) expectLiteral(summary, 'paragraph', text)
    // Passive previews are plain CommonMark, where `\{` is an ordinary escape.
    expect(passivePreviewText(markdown)).toBe(text.replaceAll('\\{', '{'))
  })

  it('normalizes Unicode line breaks and keeps blank lines as paragraph breaks', async () => {
    const text = `one\r\ntwo\rthree${char(0x2028)}four${char(0x2029)}five${char(0x0b)}six${char(0x0c)}seven${char(0x85)}eight\n\n\nnine\n \t \nten`
    expect(encodeLiteralMarkdownLines(text)).toEqual(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', '', '', 'nine', '', 'ten'])
    for (const summary of await editorViews(paragraph(text))) {
      expect(summary.filter(block => block.text).map(block => block.text))
        .toEqual(['one\ntwo\nthree\nfour\nfive\nsix\nseven\neight', 'nine', 'ten'])
    }
    expect(encodeLiteralMarkdownLines(`\n\n${' '.repeat(100_000)}x${' '.repeat(100_000)}y\n\n`)).toEqual([`x${' '.repeat(100_000)}y`])
  })

  it('preserves Unicode text exactly', async () => {
    const text = [
      `${String.fromCodePoint(0x1f469, 0x1f3fd, 0x200d, 0x1f4bb)} cafe${char(0x0301)} ${String.fromCodePoint(0x1f1ee, 0x1f1f3)}`,
      'שלום عربي 日本語 한국어',
      `${char(0x202e)}reversed${char(0x202c)} zero${char(0x200d)}width${char(0x00a0)}nbsp ＜script＞ ［link］`,
    ].join('\n')
    const markdown = paragraph(text)
    for (const summary of await editorViews(markdown)) expectLiteral(summary, 'paragraph', text)
    expect(passivePreviewText(markdown)).toBe(text)
  })

  it('keeps repeated quote markers inside a single host quote', async () => {
    const text = ['> already quoted', '>> twice', '> > spaced', '>', 'last'].join('\n')
    expectLiteral(summarize(await richEditorBlocks(quote(text))), 'quote', readable(text))
    expectLiteral(summarize(await largeNoteBlocks(quote(text))), 'quote', readable(text))
  })
})

describe('literal text in headings, list items and link labels', () => {
  it('keeps heading text literal at both note sizes', async () => {
    const title = 'Rank #1 [draft] <b>bold</b> *x* ![i](//evil.example/p.png) [[Page]] $5 & me #'
    const note = `## ${encodeLiteralMarkdownInline(title)}\n\nBody`
    for (const summary of await editorViews(note)) {
      expect(summary).toEqual([
        { type: 'heading', text: title, marks: [] },
        { type: 'paragraph', text: 'Body', marks: [] },
      ])
    }
  })

  it('keeps language names and trailing hashes in headings', async () => {
    for (const title of ['C#', 'C##', 'Rank #', 'F# and C#', 'Sharp # ## ###', 'Done #']) {
      const note = `## ${encodeLiteralMarkdownInline(title)}\n\nBody`
      for (const summary of await editorViews(note)) {
        expect(summary.at(0), title).toEqual({ type: 'heading', text: title, marks: [] })
      }
      expectLiteral(
        [summarize(await richEditorBlocks(await repeatedCanonicalSaves(note, 2))).at(0)!],
        'heading',
        title,
      )
    }
  })

  it('keeps an authored closing hash sequence working', async () => {
    expect(summarize(await richEditorBlocks('## Title ##')).at(0))
      .toEqual({ type: 'heading', text: 'Title', marks: [] })
    expect(summarize(await largeNoteBlocks('## Title ##')).at(0))
      .toEqual({ type: 'heading', text: 'Title', marks: [] })
  })

  it('keeps a title-only generated note literal through the H1 shortcut', async () => {
    for (const title of ['C#', 'Rank #', 'a ==b== c', '[!NOTE] not a callout', 'path C:\\Users\\x\\{y}']) {
      const note = `# ${encodeLiteralMarkdownInline(title)}`
      const summary = summarize(await richEditorBlocks(note))
      expect(summary.at(0), title).toEqual({ type: 'heading', text: title, marks: [] })
      expect(summarize(await richEditorBlocks(await repeatedCanonicalSaves(note, 2))).at(0), title)
        .toEqual({ type: 'heading', text: title, marks: [] })
    }
  })

  it('keeps multi-line answers inside one list item', async () => {
    const answer = ['First line', '- not a nested item', '1. not ordered', SCRIPT_FENCE, '', 'second paragraph'].join('\n')
    const [firstParagraph, secondParagraph] = answer.split('\n\n')
    for (const [marker, type] of [['- ', 'bulletListItem'], ['1. ', 'numberedListItem']]) {
      const markdown = listItem(marker, answer)
      expect(summarize(await richEditorBlocks(markdown))).toEqual([
        { type, text: firstParagraph, marks: [] },
        { type: 'paragraph', text: secondParagraph, marks: [] },
      ])
      const large = summarize(await largeNoteBlocks(markdown))
      expect(large.at(0)).toEqual({ type, text: 'First line', marks: [] })
      expectLiteral(large.slice(1), 'paragraph', answer.split('\n').slice(1).filter(Boolean).join('\n'))
    }
  })

  it('keeps a hostile label inside the host link', async () => {
    const label = 'x](//evil.example/p.png) ![y](//evil.example/i.png) [[z]] <b>'
    const markdown = `See [${encodeLiteralMarkdownInline(label)}](./Reading/Source.md) here`
    for (const summary of await editorViews(markdown)) {
      expect(summary).toEqual([{ type: 'paragraph', text: `See ${label} here`, marks: ['link:./Reading/Source.md'] }])
    }
  })

  it('leaves ordinary prose unescaped in the raw note', () => {
    const prose = 'Meeting notes: Q&A with R&D | Plan #2 - it\'s 3.14 (draft), 50% done; see a.b/c? "Yes."'
    expect(encodeLiteralMarkdownInline(prose)).toBe(prose)
    expect(encodeLiteralMarkdownLines(`${prose}\nNext steps: ask Sam, then 2. review. Great job!`))
      .toEqual([prose, 'Next steps: ask Sam, then 2. review. Great job!'])
  })

  it('rejects line breaks in single-line text', () => {
    for (const lineBreak of ['\n', '\r', char(0x0b), char(0x0c), char(0x85), char(0x2028), char(0x2029)]) {
      expect(failureOf(() => encodeLiteralMarkdownInline(`Title${lineBreak}next`))).toEqual({ reason: 'lineBreak', index: 5 })
    }
    expect(encodeLiteralMarkdownInline(' \t ')).toBe('')
    expect(encodeLiteralMarkdownLines(' \n\t\n ')).toEqual([])
  })
})

describe('literal text validation', () => {
  it('rejects the rich editor placeholders that Markdown escaping cannot neutralize', async () => {
    const htmlToken = preProcessHtmlBlockMarkdown({ markdown: SCRIPT_FENCE }).trim()
    const emphasisStrippedToken = htmlToken.replace('@@TOLARIA_HTML_BLOCK:', '@@TOLARIAHTMLBLOCK:')
    for (const token of [htmlToken, emphasisStrippedToken]) {
      expect(await richEditorBlocks(token)).toContainEqual(expect.objectContaining({
        type: 'htmlBlock',
        props: expect.objectContaining({ scripts: 'sandboxed' }),
      }))
    }

    const placeholders = [
      htmlToken,
      emphasisStrippedToken,
      preProcessDurableEditorMarkdown({ markdown: '```mermaid\ngraph TD; A-->B\n```' }).trim(),
      preProcessMathMarkdown({ markdown: '$x^2$' }),
      preProcessWikilinks('[[Private Page]]'),
      preProcessLinkedCodeMarkdown('[`code`](https://example.test)').slice(1),
      preProcessRichEditorMarkdown('\\{').slice(0, -1),
      // The same live token as a link target holds it after URI normalization.
      preProcessRichEditorMarkdown('\\{').slice(0, -1)
        .replaceAll(char(0xe000), '%EE%80%80').replaceAll(char(0xe001), '%EE%80%81'),
    ]
    for (const placeholder of placeholders) {
      expect(placeholder).not.toBe('')
      expect(failureOf(() => encodeLiteralMarkdownLines(`Quote: ${placeholder}`))).toEqual({ reason: 'reservedMarker', index: 7 })
      expect(failureOf(() => encodeLiteralMarkdownInline(placeholder))).toEqual({ reason: 'reservedMarker', index: 0 })
    }
  })

  it('rejects control characters but keeps tabs and line breaks', () => {
    for (const code of [0x00, 0x07, 0x08, 0x0e, 0x1b, 0x1f, 0x7f, 0x80, 0x9b, 0x9f]) {
      expect(failureOf(() => encodeLiteralMarkdownLines(`ab${char(code)}cd`))).toEqual({ reason: 'controlCharacter', index: 2 })
    }
    expect(encodeLiteralMarkdownLines('a\tb\nc')).toEqual(['a\tb', 'c'])
  })

  it('rejects unpaired surrogates and keeps paired ones', () => {
    for (const text of [`ab${char(0xd800)}`, `ab${char(0xdc00)}cd`, `ab${char(0xd83d)}${char(0xd83d)}`]) {
      expect(failureOf(() => encodeLiteralMarkdownInline(text))).toEqual({ reason: 'malformedUnicode', index: 2 })
    }
    expect(encodeLiteralMarkdownInline(String.fromCodePoint(0x1f600))).toBe(String.fromCodePoint(0x1f600))
  })

  it('refuses oversized text instead of truncating it', () => {
    const limit = 'a'.repeat(LITERAL_MARKDOWN_TEXT_MAX_LENGTH)
    expect(encodeLiteralMarkdownLines(limit)).toEqual([limit])
    expect(failureOf(() => encodeLiteralMarkdownLines(`${limit}a`))).toEqual({ reason: 'tooLong', index: null })
  })
})

describe('literal text after rich-editor editing', () => {
  it('stays inert after an edit saved through the source-preserving path', async () => {
    const passage = ['~~~html scripts=sandboxed', '<script>alert(1)</script>', '~~~', '[[Private Page]] ![p](//evil.example/p.png)'].join('\n')
    const source = ['# Commentary', '', quote(passage), '', 'My reflection.'].join('\n')
    const editor = BlockNoteEditor.create()
    const serializer = asSerializer(editor)
    editor.replaceBlocks(editor.document, await richEditorBlocks(source, editor) as never)
    const quoted = editor.document.find(block => block.type === 'quote')
    if (!quoted) throw new Error('Expected the quote block')
    editor.updateBlock(quoted, { content: inlineItems(quoted.content).map(item => (
      item.type === 'text' ? { ...item, text: (item.text ?? '').replace('<script>', '<script> edited') } : item
    )) as never })

    const saved = serializeRichEditorDocumentToMarkdown({ editor: serializer, tabContent: source, notePath: NOTE_PATH })
    expect(summarize(await richEditorBlocks(saved))).toEqual([
      { type: 'heading', text: 'Commentary', marks: [] },
      { type: 'quote', text: passage.replace('<script>', '<script> edited'), marks: [] },
      { type: 'paragraph', text: 'My reflection.', marks: [] },
    ])
  })

  // Regression for the canonical-save hazard: a block serialized without a source baseline (copied
  // into another note, split, or saved canonically) must not come back as an executable block.
  it('keeps literal fence text inert through canonical re-serialization and reopen', async () => {
    const editor = BlockNoteEditor.create()
    const serializer = asSerializer(editor)
    const text = ['Copied passage:', '', '~~~html scripts=sandboxed', '<script>alert(1)</script>', '~~~'].join('\n')
    const blocks = await richEditorBlocks(paragraph(text), editor)
    const saved = serializeRichEditorBlocksToMarkdown({ editor: serializer, blocks })
    const reopened = summarize(await richEditorBlocks(saved))

    expect(reopened.map(block => block.type)).not.toContain('htmlBlock')
    expectLiteral(reopened, 'paragraph', text.replace('\n\n', '\n'))
  })

  it('keeps character-reference text inert and stable across repeated canonical saves', async () => {
    // Reference text that would decode into the reserved placeholder the injector acts on. The
    // encoder accepts it because it contains no literal `@@TOLARIA`.
    const token = preProcessHtmlBlockMarkdown({ markdown: SCRIPT_FENCE }).trim()
    // Decimal and hexadecimal both decode to `@`; the hex form additionally survived the
    // `compactMarkdown` entity pass, so it reassembled the placeholder after one save.
    for (const reference of ['&#64;', '&#x40;']) {
      const disguised = token.replaceAll('@', reference)
      expect(disguised).not.toContain('@')
      expect(disguised).toContain('TOLARIA_HTML_BLOCK')

      let markdown = paragraph(disguised)
      for (let pass = 0; pass < 3; pass += 1) {
        const reopened = summarize(await richEditorBlocks(markdown))
        expect(reopened.map(block => block.type), `${reference} pass ${pass}`).not.toContain('htmlBlock')
        expectLiteral(reopened, 'paragraph', disguised)
        markdown = await canonicalSave(markdown)
      }
    }
  })


  it('keeps entity text showing the same characters across repeated canonical saves', async () => {
    const entities = '&lt;b&gt; &amp;amp; &#x41; &#64; &copy; AT&T Q&A'
    let markdown = paragraph(entities)
    for (let pass = 0; pass < 3; pass += 1) {
      expectLiteral(summarize(await richEditorBlocks(markdown)), 'paragraph', entities)
      markdown = await canonicalSave(markdown)
    }
  })

  it('keeps literal wikilink, math, image and placeholder text inert through canonical re-serialization', async () => {
    const editor = BlockNoteEditor.create()
    const serializer = asSerializer(editor)
    const text = [
      '[[Private Page]] and [[Page|alias]]',
      '![pixel](//evil.example/p.png) and [click](javascript:alert(1))',
      '$x^2$ and <script>alert(1)</script>',
      '- not a list item',
      '| not | a table |',
      '--- not a break',
    ].join('\n')
    const blocks = await richEditorBlocks(paragraph(text), editor)
    const saved = serializeRichEditorBlocksToMarkdown({ editor: serializer, blocks })
    const reopened = summarize(await richEditorBlocks(saved))

    expect(extractOutgoingLinks(saved)).toEqual([])
    expectLiteral(reopened, 'paragraph', text)
  })
})

describe('pinned rich-editor limitations that act on decoded text', () => {
  it('links bare https and mailto text, never other schemes', async () => {
    const text = 'Visit https://evil.example/a.png or mail a@evil.example, not javascript:alert(1) or data:text/html,x'
    expect(summarize(await richEditorBlocks(paragraph(text)))).toEqual([{
      type: 'paragraph',
      text,
      marks: ['link:https://evil.example/a.png', 'link:mailto:a@evil.example'],
    }])
  })

})

describe('literal callout markers and equality operators', () => {
  it('keeps a quoted callout marker as a literal quote at both note sizes', async () => {
    const passage = '[!WARNING] Title\nbody'
    const markdown = quote(passage)
    for (const summary of await editorViews(markdown)) expectLiteral(summary, 'quote', passage)
    for (const pass of [1, 2]) {
      const saved = await repeatedCanonicalSaves(markdown, pass)
      expectLiteral(summarize(await richEditorBlocks(saved)), 'quote', passage)
    }
  })

  it('keeps paired equality operators visible, including a colour-prefix emoji', async () => {
    const samples = [
      'a ==b== c',
      'assert x ==y== z',
      `budget ==${String.fromCodePoint(0x1f534)}over== by 2`,
      'if a ==b and c== d then',
      '===',
    ]
    for (const text of samples) {
      const markdown = paragraph(text)
      for (const summary of await editorViews(markdown)) expectLiteral(summary, 'paragraph', text)
      expectLiteral(summarize(await richEditorBlocks(await repeatedCanonicalSaves(markdown, 2))), 'paragraph', text)
    }
  })

  it('still converts an authored callout, keeping its type, title and body', async () => {
    const blocks = await richEditorBlocks('> [!WARNING] Be careful\n> body text') as CalloutBlockNode[]
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.type).toBe('calloutBlock')
    expect(blocks[0]?.props).toMatchObject({ calloutType: 'warning', title: 'Be careful' })
    expect(inlineText(blocks[0]?.content)).toBe('body text')
  })

  it('still converts an authored highlight, keeping code spans excluded', async () => {
    expect(summarize(await richEditorBlocks('a ==b== c'))).toEqual([
      { type: 'paragraph', text: 'a b c', marks: ['style:highlight'] },
    ])
    expect(summarize(await richEditorBlocks('`a ==b== c`'))).toEqual([
      { type: 'paragraph', text: 'a ==b== c', marks: ['style:code'] },
    ])
    expect(summarize(await richEditorBlocks('```\na ==b== c\nnot [!NOTE] either\n```'))).toEqual([
      { type: 'codeBlock', text: 'a ==b== c\nnot [!NOTE] either', marks: [] },
    ])
  })

  it('keeps escape parity for a genuine literal backslash', async () => {
    // `\\` is a literal backslash, so the text keeps it and the marker is no longer at line start.
    // Protection must not change this either way.
    expectLiteral(
      summarize(await richEditorBlocks('> \\\\[!WARNING] Title\n> body')),
      'quote',
      '\\[!WARNING] Title\nbody',
    )
    // One escape protects the bracket; two mean a literal backslash plus authored syntax.
    const authored = await richEditorBlocks('> [!WARNING] Title\n> body') as CalloutBlockNode[]
    expect(authored[0]?.type).toBe('calloutBlock')
  })
})

describe('literal text that collides with the protection sentinel', () => {
  const START = char(0xe000)
  const END = char(0xe001)
  const sentinelShaped = (hex: string) => `${START}${hex}${END}`

  it('keeps sentinel-shaped literal text exact in prose, quotes and repeated saves', async () => {
    for (const hex of ['5B', '3D', '5C', 'FFFFFF', '110000', 'D800']) {
      const text = `before ${sentinelShaped(hex)} after and [!NOTE] x`
      expect(failureOf(() => encodeLiteralMarkdownLines(text))).toBeNull()
      for (const [type, markdown] of [['paragraph', paragraph(text)], ['quote', quote(text)]]) {
        for (const summary of await editorViews(markdown)) expectLiteral(summary, type, text)
        expectLiteral(summarize(await richEditorBlocks(await repeatedCanonicalSaves(markdown, 2))), type, text)
      }
    }
  })

  it('keeps sentinel-shaped text exact inside fenced code, inline code and an HTML block', async () => {
    const shaped = sentinelShaped('5B')
    const invalid = sentinelShaped('FFFFFF')

    const fenced = summarize(await richEditorBlocks(['```', `body ${shaped} and ${invalid}`, '```'].join('\n')))
    expect(fenced).toEqual([{ type: 'codeBlock', text: `body ${shaped} and ${invalid}`, marks: [] }])

    const inline = summarize(await richEditorBlocks(`see \`${invalid} and ${shaped}\` here`))
    expect(inline).toEqual([{
      type: 'paragraph',
      text: `see ${invalid} and ${shaped} here`,
      marks: ['style:code'],
    }])

    const html = await richEditorBlocks(['```html', `<p>${shaped}</p>`, '```'].join('\n'))
    expect(html[0]?.type).toBe('htmlBlock')
    expect(html[0]?.props?.html).toBe(`<p>${shaped}</p>\n`)

    const [linked] = await richEditorBlocks(`see [[Page ${shaped}]] now`)
    const wikilink = inlineItems(linked?.content).find(item => item.type === 'wikilink') as
      { props?: { target?: string } } | undefined
    expect(wikilink?.props?.target).toBe(`Page ${shaped}`)
  })

  it('keeps sentinel delimiters decoded from authored character references exact', async () => {
    // The Markdown parser itself turns these references into the raw delimiter characters.
    const authored = '&#57344;5B&#57345; and &#xE000;3D&#xE001;'
    const expected = `${sentinelShaped('5B')} and ${sentinelShaped('3D')}`
    expect(summarize(await richEditorBlocks(authored))).toEqual([{ type: 'paragraph', text: expected, marks: [] }])

    // Through the encoder the same characters are literal reference text instead. Escaped
    // references stay on the fast path, which keeps their spelling.
    const markdown = paragraph(authored)
    for (const summary of await editorViews(markdown)) expectLiteral(summary, 'paragraph', authored)
    expectLiteral(summarize(await richEditorBlocks(await repeatedCanonicalSaves(markdown, 2))), 'paragraph', authored)
  })
})

describe('equality runs after supplementary characters', () => {
  // Each sample has an even number of `==`, which is what the highlight injector needs to act.
  it('keeps operators after emoji through repeated canonical saves', async () => {
    const smile = String.fromCodePoint(0x1f642)
    const samples = [
      `${smile.repeat(3)} ==foo==`,
      `${smile.repeat(40)} ==foo==`,
      `${String.fromCodePoint(0x1f469, 0x200d, 0x1f4bb)} ==a== and ==b==`,
      `x ${smile} y ==${smile}== z`,
    ]
    for (const text of samples) {
      const markdown = paragraph(text)
      for (const summary of await editorViews(markdown)) expectLiteral(summary, 'paragraph', text)
      for (const passes of [1, 2, 3]) {
        expectLiteral(summarize(await richEditorBlocks(await repeatedCanonicalSaves(markdown, passes))), 'paragraph', text)
      }
    }
  })
})
