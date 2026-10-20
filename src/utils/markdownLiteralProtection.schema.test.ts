import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it, vi } from 'vitest'
import { schema } from '../components/editorSchema'
import { resolveBlocksForTarget } from '../hooks/editorBlockResolution'
import { tryParseFastMarkdownBlocks } from '../hooks/editorFastMarkdownBlocks'
import { preProcessMathMarkdown } from './mathMarkdown'
import { injectWikilinks, preProcessWikilinks } from './wikilinks'
import { encodeLiteralMarkdownInline, encodeLiteralMarkdownLines } from '../leadinglight/extensions/extensionMarkdownText'
import {
  installRichEditorMarkdownSerializer,
  preProcessRichEditorMarkdown,
  serializeRichEditorBlocksToMarkdown,
  type RichEditorMarkdownSerializer,
} from './richEditorMarkdown'

/**
 * Real-schema qualification for literal-text provenance. These fixtures load the app's custom
 * editor schema, which a worktree cannot do (its symlinked dependencies put the IronCalc WASM asset
 * outside the Vite root), so they are meant to run in the integrated primary checkout.
 */

interface InlineNode {
  type: string
  text?: string
  href?: string
  styles?: Record<string, unknown>
  props?: Record<string, unknown>
  content?: unknown
}

interface BlockNode {
  type: string
  props?: Record<string, unknown>
  content?: unknown
  children?: BlockNode[]
}

const NOTE_PATH = '/vault/Generated.md'
const LARGE_NOTE_FILLER = `\n\n${'Filler words that make this note large. '.repeat(500)}`
const char = (code: number) => String.fromCharCode(code)

const paragraph = (text: string) => encodeLiteralMarkdownLines(text).join('\n')
const quote = (text: string) => encodeLiteralMarkdownLines(text).map(line => line ? `> ${line}` : '>').join('\n')

function inlineItems(content: unknown): InlineNode[] {
  return Array.isArray(content) ? content as InlineNode[] : []
}

function inlineText(content: unknown): string {
  return inlineItems(content).map(item => item.type === 'text' ? item.text ?? '' : inlineText(item.content)).join('')
}

function styleNames(content: unknown): string[] {
  return inlineItems(content).flatMap(item => Object.entries(item.styles ?? {})
    .filter(([, value]) => value)
    .map(([style]) => style))
}

async function open(markdown: string, editor = BlockNoteEditor.create({ schema })): Promise<BlockNode[]> {
  const { blocks } = await resolveBlocksForTarget({ editor, cache: new Map(), content: markdown, targetPath: NOTE_PATH })
  return blocks as BlockNode[]
}

async function openLarge(markdown: string): Promise<BlockNode[]> {
  return (await open(`${markdown.replace(/\n+$/u, '')}${LARGE_NOTE_FILLER}`)).slice(0, -1)
}

/** Canonical save without a source baseline, as for a copied, split or freshly saved block. */
async function canonicalSave(markdown: string): Promise<string> {
  const editor = BlockNoteEditor.create({ schema })
  installRichEditorMarkdownSerializer(editor)
  const blocks = await open(markdown, editor)
  return serializeRichEditorBlocksToMarkdown({ editor: editor as unknown as RichEditorMarkdownSerializer, blocks })
}

async function bothSizesAndSaves(markdown: string): Promise<BlockNode[][]> {
  const saved = await canonicalSave(await canonicalSave(markdown))
  return [await open(markdown), await openLarge(markdown), await open(saved), await openLarge(saved)]
}

/** A protection sentinel delimiter, raw or as the URI normalizer percent-encodes it. */
function containsProtectionToken(value: string): boolean {
  return value.includes(char(0xe000)) || value.includes(char(0xe001)) || /%EE%80%8[01]/iu.test(value)
}

/** Canonical save of whatever blocks a reader produced, as a copy or split of that block does. */
async function canonicalSaveOf(blocks: BlockNode[]): Promise<string> {
  const editor = BlockNoteEditor.create({ schema })
  installRichEditorMarkdownSerializer(editor)
  return serializeRichEditorBlocksToMarkdown({ editor: editor as unknown as RichEditorMarkdownSerializer, blocks })
}

describe('literal provenance with the real editor schema', () => {
  it('keeps a quoted callout marker as a quote, and converts an authored one', async () => {
    const passage = '[!WARNING] Title\nbody'
    for (const blocks of await bothSizesAndSaves(quote(passage))) {
      expect(blocks.map(block => block.type)).toEqual(['quote'])
      expect(inlineText(blocks[0]?.content)).toBe(passage)
    }

    const [authored] = await open('> [!WARNING] Be careful\n> body text')
    expect(authored).toMatchObject({ type: 'calloutBlock', props: { calloutType: 'warning', title: 'Be careful' } })
    expect(inlineText(authored?.content)).toBe('body text')
  })

  it('keeps literal equality operators, and styles an authored highlight', async () => {
    const smile = String.fromCodePoint(0x1f642)
    for (const text of ['a ==b== c', `${smile.repeat(3)} ==foo==`, `budget ==${String.fromCodePoint(0x1f534)}over== by 2`]) {
      for (const blocks of await bothSizesAndSaves(paragraph(text))) {
        expect(inlineText(blocks[0]?.content)).toBe(text)
        expect(styleNames(blocks[0]?.content)).toEqual([])
      }
    }

    const [authored] = await open('a ==b== c')
    expect(inlineText(authored?.content)).toBe('a b c')
    expect(styleNames(authored?.content)).toContain('highlight')
  })

  it('keeps heading hashes and a title-only note exact', async () => {
    for (const title of ['C#', 'C##', 'Rank #', 'Sharp # ## ###']) {
      for (const blocks of await bothSizesAndSaves(`## ${encodeLiteralMarkdownInline(title)}\n\nBody`)) {
        expect(blocks[0]).toMatchObject({ type: 'heading' })
        expect(inlineText(blocks[0]?.content)).toBe(title)
      }
      const [titleOnly] = await open(`# ${encodeLiteralMarkdownInline(title)}`)
      expect(inlineText(titleOnly?.content)).toBe(title)
    }
  })

  it('keeps backslashes, references and identifier underscores at both sizes', async () => {
    for (const text of ['C:\\Users\\name\\{draft}', '&lt;b&gt; &#64; &#x41; &copy;', 'snake_case_name and https://a.test/x_y']) {
      for (const blocks of await bothSizesAndSaves(paragraph(text))) {
        expect(inlineText(blocks[0]?.content)).toBe(text)
      }
    }
  })

  it('never rewrites sentinel-shaped text in code, an HTML block, or a wikilink', async () => {
    const shaped = `${char(0xe000)}5B${char(0xe001)}`
    const invalid = `${char(0xe000)}FFFFFF${char(0xe001)}`

    const [code] = await open(['```', `body ${shaped} ${invalid}`, '```'].join('\n'))
    expect(code?.type).toBe('codeBlock')
    expect(inlineText(code?.content)).toBe(`body ${shaped} ${invalid}`)

    const [html] = await open(['```html scripts=sandboxed', `<p>${shaped}</p>`, '```'].join('\n'))
    expect(html).toMatchObject({ type: 'htmlBlock', props: { html: `<p>${shaped}</p>\n`, scripts: 'sandboxed' } })

    const [link] = await open(`see [[Page ${shaped}]] now`)
    const wikilink = inlineItems(link?.content).find(item => item.type === 'wikilink') as { props?: { target?: string } } | undefined
    expect(wikilink?.props?.target).toBe(`Page ${shaped}`)
  })

  it('keeps a multi-line quote one quote at both sizes, without a blank line on later saves', async () => {
    for (const passage of ['line one\nline two', '[!WARNING] Title\nbody', 'a ==b== c\n\\{x}']) {
      const markdown = quote(passage)
      for (const reader of [open, openLarge]) {
        const blocks = await reader(markdown)
        expect(blocks.map(block => block.type), passage).toEqual(['quote'])
        expect(inlineText(blocks[0]?.content)).toBe(passage)
        // Saving what this reader produced must write the same one quote again.
        expect(await canonicalSaveOf(blocks)).toBe(`${markdown}\n`)
      }
    }
  })

  it('keeps literal backticks around protected text exact through repeated saves', async () => {
    const samples = [
      '`a ==b== c`',
      '``a ==b== c``',
      '`C:\\Users\\x\\{y}`',
      'x `==y==` and `[!NOTE]` z',
    ]
    for (const text of samples) {
      for (const blocks of await bothSizesAndSaves(paragraph(text))) {
        expect(blocks.map(block => block.type), text).toEqual(['paragraph'])
        expect(inlineText(blocks[0]?.content), text).toBe(text)
        expect(styleNames(blocks[0]?.content), text).toEqual([])
      }
    }
  })

  it('keeps an authored code span literal and excluded from highlighting', async () => {
    for (const markdown of ['see `a ==b== c` here', 'see ``a ==b== c`` here', 'path `C:\\x\\{y}` end']) {
      for (const [reader, blocks] of [['small', await open(markdown)], ['large', await openLarge(markdown)]] as const) {
        const code = inlineItems(blocks[0]?.content).find(item => item.styles?.code === true)
        expect(code?.text, `${reader}: ${markdown}`).toBe(markdown.match(/`+([^`]*)`+/u)?.[1])
        expect(styleNames(blocks[0]?.content), `${reader}: ${markdown}`).not.toContain('highlight')
      }
    }
  })

  it('keeps escape parity: a literal backslash before a real code span', async () => {
    // `\\` is a literal backslash, so the backticks after it still open a real code span.
    const [block] = await open('see \\\\`a ==b== c` here')
    expect(inlineText(block?.content)).toBe('see \\a ==b== c here')
    expect(styleNames(block?.content)).toEqual(['code'])
  })

  it('keeps a URL with equals runs exact in text, link target and saved Markdown', async () => {
    for (const url of ['https://example.com/?q==value', 'https://example.com/?a==b&c===d', 'https://example.com/a\\{b']) {
      const text = `see ${url} now`
      let markdown = paragraph(text)
      for (let pass = 0; pass < 3; pass += 1) {
        const [block] = await open(markdown)
        expect(inlineText(block?.content), `${url} pass ${pass}`).toBe(text)
        const link = inlineItems(block?.content).find(item => item.type === 'link')
        // The target is the visible URL, percent-encoded only as the URI normalizer encodes it.
        expect(link?.href && decodeURI(link.href), `${url} pass ${pass}`).toBe(url)
        expect(containsProtectionToken(link?.href ?? '')).toBe(false)
        markdown = await canonicalSave(markdown)
        expect(containsProtectionToken(markdown), `${url} saved ${pass}`).toBe(false)
      }
    }
  })

  it('keeps a saved URL exact when reopened in a fresh session', async () => {
    const url = 'https://example.com/?q==value'
    const saved = await canonicalSave(await canonicalSave(paragraph(`see ${url} now`)))

    vi.resetModules()
    const fresh = await import('../hooks/editorBlockResolution')
    const freshSchema = await import('../components/editorSchema')
    const { BlockNoteEditor: FreshEditor } = await import('@blocknote/core')
    const { blocks } = await fresh.resolveBlocksForTarget({
      editor: FreshEditor.create({ schema: freshSchema.schema }),
      cache: new Map(),
      content: saved,
      targetPath: NOTE_PATH,
    })
    const link = inlineItems((blocks as BlockNode[])[0]?.content).find(item => item.type === 'link')
    expect(link?.href).toBe(url)
    expect(inlineText((blocks as BlockNode[])[0]?.content)).toBe(`see ${url} now`)
  })

  it('keeps a literal percent-encoded token-like string byte-exact', async () => {
    const shaped = '%EE%80%80deadbeefdeadbeef3D%EE%80%81'
    const text = `literal ${shaped} and https://example.com/?x=${shaped}`
    for (const blocks of await bothSizesAndSaves(paragraph(text))) {
      expect(inlineText(blocks[0]?.content)).toBe(text)
    }
    const link = inlineItems((await open(paragraph(text)))[0]?.content).find(item => item.type === 'link')
    expect(link?.href).toBe(`https://example.com/?x=${shaped}`)
  })

  it('keeps literal backslashes inside an authored multi-line code span', async () => {
    // CommonMark turns the line ending inside a code span into a space.
    const markdown = 'see `a \\=\\= b\nc \\{ d \\[!x` end'
    const [block] = await open(markdown)
    const code = inlineItems(block?.content).find(item => item.styles?.code === true)
    expect(code?.text).toBe('a \\=\\= b c \\{ d \\[!x')
    expect(styleNames(block?.content)).not.toContain('highlight')

    // The large-note parser keeps every symbol but writes that line ending as a newline rather
    // than CommonMark's space (inherited; reported, not hidden): compare symbols exactly.
    const [large] = await openLarge(markdown)
    const largeCode = inlineItems(large?.content).find(item => item.styles?.code === true)
    expect(largeCode?.text).toBe('a \\=\\= b\nc \\{ d \\[!x')
    expect(styleNames(large?.content)).not.toContain('highlight')
  })

  it('keeps the same literal backslashes in a single-line code span and a fence', async () => {
    const symbols = 'a \\=\\= b \\{ d \\[!x'
    for (const reader of [open, openLarge]) {
      const [span] = await reader(`see \`${symbols}\` end`)
      expect(inlineItems(span?.content).find(item => item.styles?.code === true)?.text).toBe(symbols)

      const [fence] = await reader(['```', symbols, '```'].join('\n'))
      expect(fence?.type).toBe('codeBlock')
      expect(inlineText(fence?.content)).toBe(symbols)
    }
  })

  it('keeps literal backslashes inside authored indented code', async () => {
    const [code] = await open('intro\n\n    a \\=\\= b and \\[!x and \\{ y')
      .then(blocks => blocks.filter(block => block.type === 'codeBlock'))
    expect(inlineText(code?.content)).toBe('a \\=\\= b and \\[!x and \\{ y')
  })

  it('protects prose that follows a code span closed from the previous line', async () => {
    // CommonMark: code `a b`, then prose `== c ==`, then code `d`. The prose must not be read as
    // code, or its escaped equals reach the highlight injector unprotected.
    const markdown = 'see `a\nb` \\=\\= c \\=\\= `d` end'
    for (const blocks of [await open(markdown), await open(await canonicalSave(markdown))]) {
      expect(inlineText(blocks[0]?.content)).toBe('see a b == c == d end')
      expect(styleNames(blocks[0]?.content)).toEqual(['code', 'code'])
    }
    const [large] = await openLarge(markdown)
    expect(inlineText(large?.content)).toBe('see a\nb == c == d end')
    expect(styleNames(large?.content)).toEqual(['code', 'code'])
  })

  it('does not join a code span across a heading, a table row or indented code', async () => {
    const cases = [
      ['# Heading `x\n\\=\\=a\\=\\= `y`', 'a'],
      ['| a `x | b |\n|---|---|\n| \\=\\=c\\=\\= | d` |', 'c'],
      ['intro\n\n    code `x\n\\=\\=e\\=\\= `z`', 'e'],
    ] as const
    for (const [markdown, literal] of cases) {
      const blocks = await open(markdown)
      const text = blocks.map(block => JSON.stringify(block.content)).join('')
      expect(text, markdown).toContain(`==${literal}==`)
      expect(blocks.flatMap(block => styleNames(block.content)), markdown).not.toContain('highlight')
    }
  })

  it('keeps authored inline math and highlights through repeated canonical saves', async () => {
    const green = String.fromCodePoint(0x1f7e2)
    for (const markdown of ['see $x+1$ end', 'see $a \\=\\= b$ end']) {
      const saved = await canonicalSave(await canonicalSave(markdown))
      expect(saved).toBe(`${markdown}\n`)
      for (const blocks of [await open(saved), await openLarge(saved)]) {
        expect(inlineItems(blocks[0]?.content).map(item => item.type)).toEqual(['text', 'mathInline', 'text'])
      }
    }
    for (const [markdown, visible] of [['a ==b== c', 'a b c'], [`a ==${green}b== c`, 'a b c']] as const) {
      const saved = await canonicalSave(await canonicalSave(markdown))
      expect(saved).toBe(`${markdown}\n`)
      for (const blocks of [await open(saved), await openLarge(saved)]) {
        expect(inlineText(blocks[0]?.content)).toBe(visible)
        expect(styleNames(blocks[0]?.content)).toContain('highlight')
      }
    }
  })

  it('still writes literal dollar and equals text so it stays literal', async () => {
    for (const text of ['see $x+1$ end', 'a ==b== c']) {
      for (const blocks of await bothSizesAndSaves(paragraph(text))) {
        expect(inlineText(blocks[0]?.content)).toBe(text)
        expect(inlineItems(blocks[0]?.content).map(item => item.type)).toEqual(['text'])
        expect(styleNames(blocks[0]?.content)).toEqual([])
      }
    }
  })

  it('keeps raw source in math and wikilink targets exactly as written', async () => {
    // Baseline from the unmodified math preprocessor: these raw sources are math...
    for (const source of ['see $a \\=\\= b$ end', 'see $x+\\[!y$ end']) {
      expect(preProcessMathMarkdown({ markdown: source }), source).toContain('@@TOLARIA_MATH_INLINE:')
    }
    // ...and this one never was (no math syntax), so it must stay the same text as before.
    expect(preProcessMathMarkdown({ markdown: 'see $x \\[!y$ end' })).toBe('see $x \\[!y$ end')
    expect(inlineText((await open('see $x \\[!y$ end'))[0]?.content)).toBe('see $x [!y$ end')

    for (const [markdown, latex] of [['see $a \\=\\= b$ end', 'a \\=\\= b'], ['see $x+\\[!y$ end', 'x+\\[!y']] as const) {
      for (const blocks of [await open(markdown), await open(await canonicalSave(await canonicalSave(markdown)))]) {
        const item = inlineItems(blocks[0]?.content).find(entry => entry.type === 'mathInline')
        expect(item?.props?.latex, markdown).toBe(latex)
      }
    }

    // Baseline for wikilinks, from the unmodified wikilink and BlockNote modules: the placeholder
    // carries `\=` unencoded and the Markdown parser unescapes it, so the target never kept it.
    for (const markdown of ['see [[Page \\=\\= x]] end', 'see [[Note \\[!x]] end']) {
      const baselineBlocks = injectWikilinks(
        await BlockNoteEditor.create({ schema }).tryParseMarkdownToBlocks(preProcessWikilinks(markdown)),
      ) as BlockNode[]
      const targetOf = (blocks: BlockNode[]) => inlineItems(blocks[0]?.content)
        .find(entry => entry.type === 'wikilink')?.props?.target
      const baseline = targetOf(baselineBlocks)
      expect(baseline, markdown).toBeDefined()
      for (const blocks of [await open(markdown), await open(await canonicalSave(await canonicalSave(markdown)))]) {
        expect(targetOf(blocks), markdown).toBe(baseline)
      }
    }

    const [block] = await open('$$\na \\=\\= b \\[!x\n$$')
    expect(block).toMatchObject({ type: 'mathBlock', props: { latex: 'a \\=\\= b \\[!x' } })
    const [savedBlock] = await open(await canonicalSave('$$\na \\=\\= b \\[!x\n$$'))
    expect(savedBlock).toMatchObject({ type: 'mathBlock', props: { latex: 'a \\=\\= b \\[!x' } })
  })

  it('takes the ordinary parser only where the fast parser would change text', () => {
    const reason = (markdown: string) => tryParseFastMarkdownBlocks(
      preProcessRichEditorMarkdown(`${markdown}${LARGE_NOTE_FILLER}`),
    ).metrics.fallbackReason
    expect(reason(paragraph('plain prose with AT&T and C#'))).toBeNull()
    expect(reason(paragraph('&lt;b&gt;'))).toBeNull()
    expect(reason('&copy; authored')).toBe('character-reference')
    expect(reason('snake_case_name authored')).toBe('intraword-underscore')
  })
})
