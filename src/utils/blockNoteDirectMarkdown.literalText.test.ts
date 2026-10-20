import { describe, expect, it, vi } from 'vitest'
import {
  blocksToMarkdownDirect,
  installBlockNoteDirectMarkdown,
  type DirectMarkdownCapableSerializer,
} from './blockNoteDirectMarkdown'
import { serializeDurableEditorBlocks } from './editorDurableMarkdown'
import { preProcessHtmlBlockMarkdown } from './htmlBlockMarkdown'
import { preProcessMathMarkdown } from './mathMarkdown'
import { extractOutgoingLinks, preProcessWikilinks } from './wikilinks'

/**
 * Literal text nodes must survive canonical serialization as text. A paragraph serialized without a
 * source baseline (copied into another note, split, or saved canonically) is re-parsed from these
 * exact bytes, so anything left unescaped here reactivates on reopen.
 */
function literal(text: string): string {
  return blocksToMarkdownDirect([{
    type: 'paragraph',
    content: [{ type: 'text', text, styles: {} }],
    children: [],
  }]).markdown
}

/** A serializer wired exactly like the editor's, so ordinary blocks take the direct path. */
function directEditor(): DirectMarkdownCapableSerializer {
  const editor: DirectMarkdownCapableSerializer = {
    blocksToMarkdownLossy: vi.fn(() => 'legacy markdown\n'),
  }
  installBlockNoteDirectMarkdown(editor)
  return editor
}

describe('literal text escaping in canonical Markdown serialization', () => {
  it('escapes tilde fences, which are the executable reopen case', () => {
    expect(literal('~~~html scripts=sandboxed')).toBe('\\~\\~\\~html scripts=sandboxed')
    expect(literal('~~~~html scripts="sandboxed"')).toBe('\\~\\~\\~\\~html scripts="sandboxed"')
    expect(literal('~~strike~~')).toBe('\\~\\~strike\\~\\~')

    const fenceText = '~~~html scripts=sandboxed\n<script>alert(1)</script>\n~~~'
    expect(preProcessHtmlBlockMarkdown({ markdown: fenceText })).not.toBe(fenceText)
    expect(preProcessHtmlBlockMarkdown({ markdown: literal(fenceText) })).toBe(literal(fenceText))
  })

  // Only the opening `<` is escaped, so a closing `>` stays readable and `3 > 2` is untouched.
  it('escapes raw HTML tags, which are otherwise dropped and lose the visible text', () => {
    expect(literal('<script>alert(1)</script>')).toBe('\\<script>alert(1)\\</script>')
    expect(literal('<iframe src="//evil.example/f"></iframe>'))
      .toBe('\\<iframe src="//evil.example/f">\\</iframe>')
    expect(literal('<!-- hidden comment -->')).toBe('\\<!-- hidden comment -->')
    expect(literal('<https://example.test/auto>')).toBe('\\<https://example.test/auto>')
    expect(literal('Literal *stars* `ticks` #tag! {ok} <T>'))
      .toBe('Literal \\*stars\\* \\`ticks\\` #tag! {ok} \\<T>')
  })

  it('keeps comparison and arrow prose unescaped', () => {
    expect(literal('a < b and 3 > 2')).toBe('a < b and 3 > 2')
    expect(literal('x <- y -> z')).toBe('x <- y -> z')
  })

  it('escapes link, image, wikilink and footnote syntax', () => {
    expect(literal('[[Private Page]]')).toBe('\\[\\[Private Page\\]\\]')
    expect(literal('[[Page|alias]]')).toBe('\\[\\[Page|alias\\]\\]')
    expect(literal('![pixel](//evil.example/p.png)')).toBe('!\\[pixel\\](//evil.example/p.png)')
    expect(literal('[click](javascript:alert(1))')).toBe('\\[click\\](javascript:alert(1))')
    expect(literal('see [^1] note')).toBe('see \\[^1\\] note')
    expect(literal('![not an image]')).toBe('!\\[not an image\\]')
    expect(literal('Keep [[Project Alpha]] fast.')).toBe('Keep \\[\\[Project Alpha\\]\\] fast.')

    expect(preProcessWikilinks(literal('[[Private Page]]'))).toBe(literal('[[Private Page]]'))
    expect(extractOutgoingLinks(literal('[[Private Page]]'))).toEqual([])
  })

  // A raw `&` is decoded by the next parse, so one canonical save per decoding step would both
  // change the visible text and let reference text reassemble reserved markers.
  it('escapes character-reference text so repeated saves decode it only once', () => {
    expect(literal('&#64;')).toBe('\\&#64;')
    expect(literal('&lt;b&gt; &amp; &copy;')).toBe('\\&lt;b\\&gt; \\&amp; \\&copy;')
    // A backslash cannot protect a hex reference, because compactMarkdown decodes `&#x..;` even
    // when escaped; the decimal form of `&` keeps the text and leaves no `&#x` to decode.
    expect(literal('&#x41;')).toBe('&#38;#x41;')
    expect(literal('&#X41;')).toBe('&#38;#X41;')
    expect(literal('&#x41')).toBe('&#x41')
    expect(literal('&#64;&#64;TOLARIA_HTML_BLOCK:%7B%22html%22%3A%22x%22%7D&#64;&#64;'))
      .toBe('\\&#64;\\&#64;TOLARIA_HTML_BLOCK:%7B%22html%22%3A%22x%22%7D\\&#64;\\&#64;')
  })

  it('leaves ordinary ampersand prose and bare URL targets untouched', () => {
    expect(literal('Q&A with R&D, a & b, 1&2, AT&T')).toBe('Q&A with R&D, a & b, 1&2, AT&T')
    expect(literal('&notareference and & ')).toBe('&notareference and & ')
    // A backslash here would end up inside the autolinked target, so the URL must stay verbatim.
    expect(literal('https://example.test/?a=1&amp;b=2&copy;x'))
      .toBe('https://example.test/?a=1&amp;b=2&copy;x')
    expect(literal('www.example.test/?x=1&amp;y=2')).toBe('www.example.test/?x=1&amp;y=2')
  })

  it('escapes math delimiters', () => {
    expect(literal('$x^2$')).toBe('\\$x^2\\$')
    expect(preProcessMathMarkdown({ markdown: literal('$x^2$') })).toBe(literal('$x^2$'))
  })

  // Math needs two `$` on a line, so a block with one cannot form math and keeps it as written.
  it('leaves a lone dollar as written and decides across the whole block', () => {
    expect(literal('costs $5 total')).toBe('costs $5 total')
    expect(literal('Path: {Server}$\\{Instance}')).toBe('Path: {Server}$\\{Instance}')

    const splitPair = blocksToMarkdownDirect([{
      type: 'paragraph',
      content: [
        { type: 'text', text: 'from $a ', styles: {} },
        { type: 'text', text: 'to b$', styles: { bold: true } },
      ],
      children: [],
    }]).markdown
    expect(splitPair).toBe('from \\$a **to b\\$**')
    expect(preProcessMathMarkdown({ markdown: splitPair })).toBe(splitPair)

    const besideMath = blocksToMarkdownDirect([{
      type: 'paragraph',
      content: [
        { type: 'text', text: 'price $', styles: {} },
        { type: 'mathInline', props: { latex: 'x' } },
      ],
      children: [],
    }]).markdown
    expect(besideMath).toBe('price \\$$x$')
  })

  it('escapes line-start block syntax', () => {
    expect(literal('- item')).toBe('\\- item')
    expect(literal('+ item')).toBe('\\+ item')
    expect(literal('1. item')).toBe('1\\. item')
    expect(literal('2) item')).toBe('2\\) item')
    expect(literal('---')).toBe('\\---')
    // Every `=` in a run is escaped, so the highlight injector cannot pair them later.
    expect(literal('===')).toBe('\\=\\=\\=')
    expect(literal('a ==b== c')).toBe('a \\=\\=b\\=\\= c')
    expect(literal('x = y')).toBe('x = y')
    expect(literal('| a | b |')).toBe('\\| a | b |')
    expect(literal('first\n- second')).toBe('first\n\\- second')
  })

  it('keeps ordinary prose and punctuation readable in the saved file', () => {
    for (const prose of [
      'Priced at 5 dollars; see item 1. Then 2 - 1 = 1',
      'Use citations (Smith, 2024) and braces {ok}',
      'Email a@b.test or visit https://example.test/page',
      'Ranked #216 and tagged #done!',
      'snake_case_name stays intact',
    ]) {
      expect(literal(prose)).toBe(prose)
    }
  })

  it('keeps authored HTML and code blocks on their dedicated typed serialization', () => {
    const blocks = [
      {
        type: 'htmlBlock',
        props: { height: '320', html: '<button onclick="run()">Go</button>\n', scripts: 'sandboxed' },
        children: [],
      },
      {
        type: 'codeBlock',
        props: { language: 'html' },
        content: [{ type: 'text', text: '<script>authored()</script>\n~~~ and `ticks`', styles: {} }],
        children: [],
      },
    ]

    expect(serializeDurableEditorBlocks(directEditor(), blocks)).toBe([
      '```html height="320" scripts="sandboxed"',
      '<button onclick="run()">Go</button>',
      '```',
      '',
      '```html',
      '<script>authored()</script>',
      '~~~ and `ticks`',
      '```',
    ].join('\n'))
  })

  it('keeps structural links, wikilinks, emphasis and code spans intact', () => {
    const blocks = [{
      type: 'paragraph',
      content: [
        { type: 'text', text: 'See ', styles: {} },
        { type: 'wikilink', props: { target: 'Team/Beta|Beta' } },
        { type: 'text', text: ' and ', styles: {} },
        {
          type: 'link',
          props: { href: 'https://example.test/docs' },
          content: [{ type: 'text', text: 'the [docs]', styles: {} }],
        },
        { type: 'text', text: ' plus ', styles: {} },
        { type: 'text', text: 'bold', styles: { bold: true } },
        { type: 'text', text: ' and ', styles: {} },
        { type: 'text', text: 'strike', styles: { strike: true } },
        { type: 'text', text: ' and ', styles: {} },
        { type: 'text', text: 'code_span(x)', styles: { code: true } },
        { type: 'text', text: '.', styles: {} },
      ],
      children: [],
    }]

    expect(blocksToMarkdownDirect(blocks).markdown).toBe(
      'See [[Team/Beta|Beta]] and [the \\[docs\\]](https://example.test/docs) plus **bold** and ~~strike~~ and `code_span(x)`.',
    )
  })

  it('keeps media blocks and headings on their structural renderers', () => {
    const blocks = [
      { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Monday #216', styles: {} }], children: [] },
      { type: 'image', props: { name: 'Launch shot.png', url: 'attachments/Launch shot.png' }, children: [] },
      { type: 'divider', children: [] },
    ]

    expect(blocksToMarkdownDirect(blocks).markdown).toBe([
      '## Monday #216',
      '',
      '![Launch shot.png](<attachments/Launch shot.png>)',
      '',
      '---',
    ].join('\n'))
  })
})
