import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it } from 'vitest'
import { extractOutgoingLinks } from '../../utils/wikilinks'
import { extractH1TitleFromContent } from '../../utils/noteTitle'
import { parseFrontmatter } from '../../utils/frontmatter'
import {
  CAPTURED_AT, canonicalSave, convert, fixture, flat, inlineOf, largeVersion, marksOf, open, page, textOf, type BlockNode,
} from './webCapture.test-utils'
import type { VerifyEditor } from './articleVerify'
import { WEB_CAPTURE_LIMITS } from './webCaptureContract'
import { buildCapturedNote, buildLinkOnlyNote, captureSource, convertWebCapture, noteOpensAsBuilt } from './webCapturePipeline'

/**
 * The conversion through the editor's real readers: every note is opened with the same resolution
 * path the editor uses (default schema here; webCapturePipeline.schema.test.ts repeats the core
 * cases with the app's own schema), below and above 16 KiB, and saved again canonically.
 */

const ALLOWED_BLOCKS = new Set(['heading', 'paragraph', 'bulletListItem', 'numberedListItem', 'quote', 'codeBlock', 'table', 'divider'])
const ARTICLE_URL = 'https://harbour.example.org/2026/10/lighthouse-log'

function outline(blocks: BlockNode[]): Array<[string, string | number | null, string]> {
  return flat(blocks).map((block) => {
    const props = block.props ?? {}
    const attribute = block.type === 'heading' ? Number(props.level) : block.type === 'codeBlock' ? String(props.language) : null
    if (block.type === 'table') {
      const rows = (block.content as { rows: Array<{ cells: Array<{ content: unknown }> }> }).rows
      return [block.type, attribute, rows.map(row => row.cells.map(cell => textOf(cell.content)).join(' ¦ ')).join(' / ')]
    }
    return [block.type, attribute, textOf(block.content)]
  })
}

function links(blocks: BlockNode[]): string[] {
  return flat(blocks).flatMap(block => marksOf(inlineOf(block)).filter(mark => mark.startsWith('link:')))
}

async function article() {
  return convert(fixture('article'), {}, { requestedUrl: 'https://harbour.example.org/a', finalUrl: ARTICLE_URL })
}

describe('an article page', () => {
  it('keeps the article, its metadata and its provenance, and nothing around it', async () => {
    const result = await article()
    expect(result.metadata).toEqual({
      title: 'Keeping a Lighthouse Log', byline: 'Ada Example', siteName: 'Harbour Notes', published: '2026-10-01', lang: 'en-GB',
    })
    expect(result.source).toEqual({ sourceUrl: ARTICLE_URL, requestedUrl: 'https://harbour.example.org/a', capturedAt: CAPTURED_AT })
    expect(result.note.frontmatter).toBe([
      '---',
      `source: "${ARTICLE_URL}"`,
      'author: Ada Example',
      'site: Harbour Notes',
      'published: 2026-10-01',
      `captured: "${CAPTURED_AT}"`,
      '_leadinglight_capture:',
      '  version: 1',
      '  kind: article',
      '  requested: "https://harbour.example.org/a"',
      '  extractor: readability-0.6.0',
      '  converter: leadinglight-article-v1',
      '---',
      '',
    ].join('\n'))
    expect(result.note.title).toBe('Keeping a Lighthouse Log')
    expect(result.note.fileName).toBe('keeping-a-lighthouse-log.md')
    expect(result.note.content).toBe(`${result.note.frontmatter}${result.note.body}`)
    expect(extractH1TitleFromContent(result.note.content)).toBe('Keeping a Lighthouse Log')
    for (const chrome of ['Popular posts', 'Sidebar link', 'Advertisement', 'Great post', 'Privacy', 'Subscribe', 'changed by script', 'Your browser cannot']) {
      expect(result.note.content).not.toContain(chrome)
    }
  })

  it('reopens as the page structure: headings, lists, quotes, code, tables and media links', async () => {
    const blocks = await open((await article()).note.content)
    expect(outline(blocks)).toEqual([
      ['heading', 1, 'Keeping a Lighthouse Log'],
      ['paragraph', null, 'By Ada Example'],
      ['paragraph', null, expect.stringContaining('A lighthouse log is a plain record of what the keeper saw')],
      ['paragraph', null, 'Jump to the tables section, read the interactive version, or write to the keeper. The style guide lives at the nautical log article.'],
      ['heading', 2, 'The watch'],
      ['paragraph', null, expect.stringContaining('Each watch begins with three entries.')],
      ['bulletListItem', null, 'Time, in the harbour\'s own clock'],
      ['bulletListItem', null, 'Ship\'s bells are noted separately'],
      ['bulletListItem', null, 'Clock drift is noted weekly'],
      ['bulletListItem', null, 'Weather, in plain words'],
      ['bulletListItem', null, 'The lamp: lit, dim or out'],
      ['numberedListItem', null, 'Third step: trim the wick'],
      ['numberedListItem', null, 'Fourth step: polish the lens'],
      ['numberedListItem', null, 'Use the soft cloth'],
      ['heading', 3, 'What the old keepers said'],
      ['quote', null, 'Write it down while it is still true.'],
      ['quote', null, 'Write it down again in the morning.'],
      ['quote', null, '• Never trust memory'],
      ['quote', null, '• Never trust the barometer alone'],
      ['heading', 2, 'Recording equipment'],
      ['paragraph', null, 'Modern keepers often record the lamp state with a small script. The first example is labelled, the second is not:'],
      ['codeBlock', 'js', 'const lamp = { state: \'lit\' }\nif (lamp.state !== \'lit\') alert(\'Check the lamp\')'],
      ['codeBlock', 'python', 'def check_lamp(lamp):\n    return lamp.state == "lit"'],
      ['paragraph', null, 'Some logs are published as web pages. This is the markup, which must stay code:'],
      ['codeBlock', 'xml', '<div class="log"><script>alert(1)</script></div>'],
      ['codeBlock', 'xml', '<section><p>Unlabelled markup</p></section>'],
      ['codeBlock', 'txt', 'graph TD; Lamp-->Lens'],
      ['heading', 2, 'Tables'],
      ['table', null, 'Hour ¦ Weather | wind / 21:00 ¦ Clear | calm / 22:00 ¦ Fog rolling in'],
      ['paragraph', null, 'Night summary'],
      ['paragraph', null, 'Ships seen | 3'],
      ['paragraph', null, 'Image: The lamp room at dusk'],
      ['paragraph', null, 'The lamp room, photographed at dusk.'],
      ['paragraph', null, 'An inline icon Image: anchor and a clip:'],
      ['paragraph', null, 'Video: The beam turning'],
      ['divider', null, ''],
      ['paragraph', null, expect.stringContaining('Thanks for reading.')],
    ])
    expect(flat(blocks).filter(block => block.type === 'bulletListItem').map(block => (block.children ?? []).length)).toEqual([2, 0, 0, 0, 0])
  })

  it('keeps marks and only absolute http(s) links, with media as text links and never images', async () => {
    const result = await article()
    const blocks = await open(result.note.content)
    expect(links(blocks)).toEqual([
      'link:https://harbour.example.org/guides/watches',
      'link:https://archive.example.net/logs?year=1890&kind=weather',
      'link:https://example.org/wiki/Log_%28nautical%29',
      'link:https://harbour.example.org/forecast',
      'link:https://harbour.example.org/images/lamp.jpg',
      'link:https://media.example.org/beam.mp4',
    ])
    expect(marksOf(flat(blocks)[2].content).filter(mark => !mark.startsWith('link'))).toEqual(['bold', 'italic', 'strike'])
    expect(marksOf(flat(blocks)[10].content)).toEqual(['code', 'code', 'code'])
    expect(result.note.content).not.toMatch(/!\[|<img|srcset|lamp-2x|poster|javascript:|mailto:|data:image/u)
    expect(result.adjustments).toMatchObject({ mediaLinks: 2, degradedTables: 1 })
  })

  it('saves canonically to the very same bytes, and converts the same page to the same bytes', async () => {
    const first = await article()
    expect(await canonicalSave(first.note.content)).toBe(first.note.content)
    const second = await article()
    expect(second.note.content).toBe(first.note.content)
  })

  it('reopens the same way past 16 KiB, through the fast parser', async () => {
    const result = await article()
    const { content, fastParser } = largeVersion(result.note.content)
    expect(fastParser).toBeNull()
    expect(outline(await open(content)).slice(0, -1)).toEqual(outline(await open(result.note.content)))
  })
})

describe('text that is syntax in a note', () => {
  async function literals() {
    return convert(fixture('literals'))
  }

  function expectLiteral(blocks: BlockNode[]) {
    const all = flat(blocks)
    expect(all.filter(block => !ALLOWED_BLOCKS.has(block.type))).toEqual([])
    const kinds = all.flatMap(block => marksOf(block.content))
    expect(kinds.filter(kind => !kind.startsWith('link:') && kind !== 'code')).toEqual([])
    const texts = all.map(block => textOf(block.content))
    expect(texts).toContain('Wikilinks look like [[Private note]] and [[Folder/Note|alias]]. Highlights look like ==important== or ==red==warning==. Inline math looks like $a$ and $b$, and prices like $5 or $10 are not math.')
    expect(texts).toContain('A callout starts with [!note] and a footnote with [^1]. HTML such as <script>alert(1)</script> and <img src=x onerror=alert(1)> is only text here. Entities like &amp; &#x3c; &#60; &copy; and AT&T stay as typed.')
    expect(texts).toContain('Fences: ``` and ~~~ and `code` and **bold** and __under__ and ~strike~ and *star* are literal.\n# not a heading\n> not a quote\n- not a list\n1. not ordered\n| not | a | table |\n--- not a rule\n===')
    expect(texts).toContain('Across elements: a==b, [[x]], $a$, C:\\*x, wow!link after bang, x==y and == alone.')
    expect(texts).toContain('[ ] not a task')
    expect(texts).toContain('[x] not done either')
    expect(all.filter(block => block.type === 'heading').map(block => textOf(block.content))).toEqual(['Notes on Markdown Syntax', 'Rank #', 'C# and F# ##'])
    const codes = all.filter(block => block.type === 'codeBlock')
    expect(codes.map(block => textOf(block.content))).toEqual([
      '<script>parent.document.title = \'pwned\'</script>',
      '$$\nx^2\n$$\n[[x]] ==y== $a$ $b$',
      '[!note] inside code',
      '$$\ny^2\n$$\n@@ not a marker',
    ])
    expect(codes.map(block => block.props?.language)).toEqual(['markdown', 'markdown', 'markdown', 'text'])
    expect(all.filter(block => block.type === 'paragraph' && marksOf(block.content).includes('code')).map(block => textOf(block.content)))
      .toEqual(['```html scripts=sandboxed', '```', '~~~'])
    const table = all.find(block => block.type === 'table')
    const rows = (table?.content as { rows: Array<{ cells: Array<{ content: unknown }> }> }).rows
    expect(rows.map(row => row.cells.map(cell => textOf(cell.content)))).toEqual([
      ['Syntax', 'Meaning'], ['a | b', '[[x]] and ==y== and $1 $2'], ['a|b', '<b>bold</b>'],
    ])
  }

  it('reopens every character literally, with no HTML block, wikilink, math, highlight or callout', async () => {
    const result = await literals()
    expectLiteral(await open(result.note.content))
    expect(extractOutgoingLinks(result.note.content)).toEqual([])
    expect(result.adjustments).toMatchObject({ splitCodeBlocks: 1, droppedLinks: 1 })
  })

  it('reopens literally past 16 KiB, and survives canonical saves byte for byte', async () => {
    const result = await literals()
    const large = largeVersion(result.note.content)
    expectLiteral((await open(large.content)).slice(0, -1))
    expect(await canonicalSave(result.note.content)).toBe(result.note.content)
    const largeSaved = await canonicalSave(large.content)
    expect(largeSaved).toBe(large.content)
  })

  it('links a bare address only to its own text, as the editor does', async () => {
    const blocks = flat(await open((await literals()).note.content))
    const last = blocks.at(-1)
    expect(textOf(last?.content)).toBe('Bare addresses such as https://example.org/a_b?x=1&y=2 and www.example.org and person@example.org become links by themselves.')
    expect(marksOf(last?.content)).toEqual(['link:https://example.org/a_b?x=1&y=2', 'link:http://www.example.org', 'link:mailto:person@example.org'])
  })

  it('writes link destinations that the wikilink and math readers leave alone', async () => {
    const html = `<article><h1>Destinations</h1><p>${'Words before the links make this an article. '.repeat(6)}</p>
      <p>Only $5 here, then <a href="https://e.org/a$b">dollar</a>, <a href="https://e.org/[[w]]">brackets</a>, <a href="https://e.org/?q=\`x\`">backtick</a>, <a href="https://e.org/?q=a\\b">backslash</a>, <a href="https://e.org/{a}|b^">braces</a>, <a href="https://e.org/a_(b)">parens</a> and <a href="https://e.org/?q==v==">equals</a>.</p></article>`
    const blocks = await open((await convert(html)).note.content)
    expect(links(blocks)).toEqual([
      'link:https://e.org/a%24b', 'link:https://e.org/%5B%5Bw%5D%5D', 'link:https://e.org/?q=%60x%60', 'link:https://e.org/?q=a%5Cb',
      'link:https://e.org/%7Ba%7D%7Cb%5E', 'link:https://e.org/a_%28b%29', 'link:https://e.org/?q==v==',
    ])
    expect(flat(blocks).map(block => textOf(block.content))).toContain('Only $5 here, then dollar, brackets, backtick, backslash, braces, parens and equals.')
  })
})

describe('headings', () => {
  it('moves every heading down a level when the article has its own H1, so the title is the only H1', async () => {
    const html = `<html><head><title>Main title</title></head><body><article><h1>Main title</h1><p>${'An opening paragraph with enough words to count as an article. '.repeat(4)}</p>
      <h1>Part one</h1><p>${'Text of part one. '.repeat(10)}</p><h2>Detail</h2><p>${'Detail text. '.repeat(10)}</p><h6>Deepest</h6><p>${'Deep text. '.repeat(10)}</p></article></body></html>`
    const blocks = flat(await open((await convert(html)).note.content)).filter(block => block.type === 'heading')
    expect(blocks.map(block => [block.props?.level, textOf(block.content)])).toEqual([[1, 'Main title'], [2, 'Part one'], [3, 'Detail'], [6, 'Deepest']])
  })
})

describe('pages that are not readable articles', () => {
  it.each(['script-only', 'sign-in', 'short'])('refuses %s as unreadable, keeping the address and page title for a link-only note', async (name) => {
    const result = await convertWebCapture(page(fixture(name)))
    expect(result.status).toBe('refused')
    if (result.status !== 'refused') return
    expect(result.reason).toBe('unreadable')
    expect(result.source).toEqual({ sourceUrl: 'https://pages.example.org/2026/10/page', requestedUrl: 'https://pages.example.org/a', capturedAt: CAPTURED_AT })
    expect(result.title).toEqual(expect.any(String))
    expect(JSON.stringify(result)).not.toContain('Hidden in a script')
  })

  it('refuses a page holding an internal editor marker as unsafeText', async () => {
    const result = await convertWebCapture(page(fixture('reserved-marker')))
    expect(result).toMatchObject({ status: 'refused', reason: 'unsafeText', title: 'A Page With an Editor Marker' })
  })

  it.each([
    ['WIKILINK', '\u2039WIKILINK:secret\u203a'],
    ['LINKED_CODE', '\u2039LINKED_CODE:1\u203a'],
  ])('refuses the %s placeholder in page text', async (_name, marker) => {
    const html = `<article><h1>Markers</h1><p>${'Ordinary words that make an article. '.repeat(6)}</p><p>Text with ${marker} inside.</p></article>`
    expect(await convertWebCapture(page(html))).toMatchObject({ status: 'refused', reason: 'unsafeText' })
  })

  it('refuses an article whose text is over the note limit instead of cutting it', async () => {
    const paragraph = `<p>${'A long sentence that repeats until the article is far too large. '.repeat(40)}</p>`
    const html = `<article><h1>Too long</h1>${paragraph.repeat(Math.ceil(WEB_CAPTURE_LIMITS.noteBytes / 2400) + 10)}</article>`
    expect(await convertWebCapture(page(html))).toMatchObject({ status: 'refused', reason: 'tooLarge' })
  })

  it('refuses unusable addresses or times without reading the page', async () => {
    for (const overrides of [{ finalUrl: 'javascript:alert(1)' }, { requestedUrl: 'https://user:pw@pages.example.org/' }, { finalUrl: '/relative' }, { fetchedAt: 'yesterday' }, { fetchedAt: '2026-02-30T00:00:00Z' }]) {
      expect(await convertWebCapture(page(fixture('article'), overrides))).toEqual({ status: 'refused', reason: 'invalidInput', source: null, title: null })
    }
  })
})

describe('bounds and cancellation', () => {
  it('stops at the next stage once the signal aborts', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await convertWebCapture(page(fixture('article')), { signal: controller.signal })).toMatchObject({ status: 'refused', reason: 'cancelled' })
  })

  it('refuses as tooComplex once the time budget is spent', async () => {
    let now = 0
    const clock = () => (now += 1000)
    expect(await convertWebCapture(page(fixture('article')), { clock, timeBudgetMs: 3500 })).toMatchObject({ status: 'refused', reason: 'tooComplex' })
  })

  it('refuses a page over the element or nesting limits before extraction', async () => {
    const deep = `<article><p>${'Words. '.repeat(40)}</p>${'<div>'.repeat(WEB_CAPTURE_LIMITS.depth + 5)}deep${'</div>'.repeat(WEB_CAPTURE_LIMITS.depth + 5)}</article>`
    expect(await convertWebCapture(page(deep))).toMatchObject({ status: 'refused', reason: 'tooComplex' })
    const wide = `<article>${'<span>x</span>'.repeat(WEB_CAPTURE_LIMITS.elements + 10)}</article>`
    expect(await convertWebCapture(page(wide))).toMatchObject({ status: 'refused', reason: 'tooComplex' })
    const tags = `<article>${'<b>'.repeat(WEB_CAPTURE_LIMITS.rawStartTags + 1)}</article>`
    expect(await convertWebCapture(page(tags))).toMatchObject({ status: 'refused', reason: 'tooComplex' })
  })

  it('refuses decoded text over 5 MiB as tooLarge', async () => {
    const html = `<article><p>${'x'.repeat(WEB_CAPTURE_LIMITS.htmlBytes)}</p></article>`
    expect(await convertWebCapture(page(html))).toMatchObject({ status: 'refused', reason: 'tooLarge' })
  })
})

describe('building the note the person saves', () => {
  it('re-titles a conversion and adds host paragraphs linked only to the source, through the same checks', async () => {
    const result = await article()
    const built = await buildCapturedNote(result, {
      title: 'Lighthouse logs [draft] #1',
      intro: [[{ text: 'Saved from ' }, { sourceLink: 'Harbour Notes' }, { text: ' on 2026-10-20.' }]],
    })
    expect(built.status).toBe('built')
    if (built.status !== 'built') return
    const blocks = flat(await open(built.note.content))
    expect(textOf(blocks[0].content)).toBe('Lighthouse logs [draft] #1')
    expect(extractH1TitleFromContent(built.note.content)).toBe('Lighthouse logs [draft] #1')
    expect(textOf(blocks[1].content)).toBe('Saved from Harbour Notes on 2026-10-20.')
    expect(marksOf(blocks[1].content)).toEqual([`link:${ARTICLE_URL}`])
    expect(outline(blocks.slice(2) as BlockNode[])).toEqual(outline(flat(await open(result.note.content)).slice(1) as BlockNode[]))
    expect(await canonicalSave(built.note.content)).toBe(built.note.content)
  })

  it('falls back to the host name for a blank title and refuses a title that cannot be written literally', async () => {
    const result = await article()
    const blank = await buildCapturedNote(result, { title: '   ' })
    expect(blank.status === 'built' && blank.note.title).toBe('harbour.example.org')
    expect(await buildCapturedNote(result, { title: 'Bad @@TOLARIA_MATH:1@@ title' })).toMatchObject({ status: 'refused', reason: 'unsafeText' })
  })

  it('checks the final bytes after the host appends its own blocks', async () => {
    const result = await article()
    const content = `${result.note.content.replace(/\n+$/u, '')}\n\n## My notes\n\nWanted this for the chapter on rest.\n`
    expect(await noteOpensAsBuilt(content, result.note)).toBe(true)
    expect(await noteOpensAsBuilt(result.note.content.replace('Third step', 'Changed step'), result.note)).toBe(false)
  })

  it('builds a link-only note with provenance, title and the caller\'s notice, and no article', async () => {
    const source = captureSource({ requestedUrl: 'https://pages.example.org/members/article', capturedAt: CAPTURED_AT })
    expect(source).not.toBeNull()
    const built = await buildLinkOnlyNote({
      source: source!,
      pageTitle: 'Members: the "best" article #1',
      intro: [[{ text: 'Saved from ' }, { sourceLink: 'pages.example.org' }, { text: '.' }], [{ text: 'The page\'s text couldn\'t be saved from the website. Paste it here if you want it in this note.' }]],
    })
    expect(built.status).toBe('built')
    if (built.status !== 'built') return
    expect(built.note.frontmatter).toBe([
      '---', 'source: "https://pages.example.org/members/article"', `captured: "${CAPTURED_AT}"`, '_leadinglight_capture:',
      '  version: 1', '  kind: link', '  converter: leadinglight-link-v1', '---', '',
    ].join('\n'))
    expect(outline(await open(built.note.content))).toEqual([
      ['heading', 1, 'Members: the "best" article #1'],
      ['paragraph', null, 'Saved from pages.example.org.'],
      ['paragraph', null, 'The page\'s text couldn\'t be saved from the website. Paste it here if you want it in this note.'],
    ])
    expect(parseFrontmatter(built.note.content).source).toBe('https://pages.example.org/members/article')
    expect(await canonicalSave(built.note.content)).toBe(built.note.content)
  })
})

describe('the reopen check', () => {
  it('lowers formatting only in a block that reopens differently, then accepts the exact text', async () => {
    const html = `<article><h1>Flanking</h1><p>${'Ordinary words that make this page an article. '.repeat(5)}</p><p>Kept <strong>bold</strong> here.</p><p>x<em>=</em>=y and more</p></article>`
    const result = await convert(html)
    const blocks = flat(await open(result.note.content))
    const texts = blocks.map(block => [textOf(block.content), marksOf(block.content)])
    expect(texts).toContainEqual(['x==y and more', []])
    expect(texts).toContainEqual(['Kept bold here.', ['bold']])
    expect(result.adjustments.plainBlocks).toBe(1)
    expect(await canonicalSave(result.note.content)).toBe(result.note.content)
  })

  it('refuses as notExact, and returns no bytes, when the note never reopens as converted', async () => {
    const createVerifyEditor = () => {
      const editor = BlockNoteEditor.create()
      const parse = editor.tryParseMarkdownToBlocks.bind(editor)
      editor.tryParseMarkdownToBlocks = (markdown: string) => {
        const blocks = parse(markdown)
        for (const block of blocks) {
          if (block.type === 'paragraph' && JSON.stringify(block.content).includes('Thanks for reading')) block.content = [{ type: 'text', text: 'Altered', styles: {} }]
        }
        return blocks
      }
      return editor as unknown as VerifyEditor
    }
    const result = await convertWebCapture(page(fixture('article')), { createVerifyEditor })
    expect(result).toEqual({ status: 'refused', reason: 'notExact', source: expect.any(Object), title: 'Keeping a Lighthouse Log' })
  })
})
