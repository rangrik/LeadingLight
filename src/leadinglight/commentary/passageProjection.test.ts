import { describe, expect, it } from 'vitest'
import { MARKDOWN_HIGHLIGHT_COLOR_OPTIONS } from '../../utils/markdownHighlightMarkdown'
import {
  HIGHLIGHT_COLOR_PREFIXES, PROJECTION_OBJECT as OBJ, noteOffsetOfEditorPosition, projectMarkdownBody, projectRawEditorSelection, projectSourceRange,
  sourceRangeOfText,
} from './passageProjection'

const text = (body: string) => projectMarkdownBody(body).text

describe('projection leadinglight-text-v1', () => {
  const cases: Array<[string, string, string]> = [
    ['headings without markers', '# Title #\n\nSetext\n---\n\n### Three', 'Title\nSetext\nThree'],
    ['paragraph line edges trimmed, inner spaces kept', '  one   two \n   three\t', 'one   two\nthree'],
    ['soft breaks as one line break, hard breaks as two like the rich editor', 'a  \nb\\\nc\nd', 'a\n\nb\n\nc\nd'],
    ['emphasis and strike marks dropped', '*a* **b** _c_ ~~d~~', 'a b c d'],
    ['single tildes, sub/superscript and shortcodes stay literal', '~a~ ^b^ :smile:', '~a~ ^b^ :smile:'],
    ['escapes and entities decoded, a backslash before { kept', '\\{x \\*not\\* &amp; &#169; &#x1F9ED; &unknown; &nbsp;.', '\\{x *not* & © 🧭 &unknown;  .'],
    ['inline code kept exactly with one edge space stripped', '`` a `b` `` and ` x ` and `  `', 'a `b` and x and   '],
    ['links show labels, autolinks show URLs', '[label *x*](https://e.com) <https://a.b> www.c.d', 'label x https://a.b www.c.d'],
    ['undefined references stay literal', '[one] [two][x] [def]\n\n[def]: ./a.md', '[one] [two][x] def'],
    ['wikilinks show label or target, not inside code', '[[Target]] [[T|Label]] [[T|]] `[[code]]`', 'Target Label T [[code]]'],
    ['images are one object', '![alt](a.png) text', `${OBJ} text`],
    ['quotes, nested quotes and lists drop markers', '> a\n> > b\n\n- c\n  - d\n1. e\n- [x] f', 'a\nb\nc\nd\ne\nf'],
    ['callout marker line is not text', '> [!note] Title\n> body\n\n> [!tip]+ Folded\n> x', 'body\n[!tip]+ Folded\nx'],
    ['fenced and indented code keep lines', '```js\n  let a\n\nb\n```\n\n    code\n      more', '  let a\n\nb\ncode\n  more'],
    ['durable fences, math blocks and rules are objects', '```mermaid\ng\n```\n\n$$\nx\n$$\n\n$$y$$\n\n***', `${OBJ}\n${OBJ}\n${OBJ}\n${OBJ}`],
    ['html blocks, comments and tags contribute nothing', '<div>\nx\n</div>\n\n<!-- c -->\n\na <b>b</b>', 'a b'],
    ['each table cell is a block, padded to the header', '| a | b |\n|---|---|\n| 1 |\n| \\| | 2 | 3 |', 'a\nb\n1\n\n|\n2'],
    ['extra blank lines become empty blocks like rich blank paragraphs', 'a\n\n\n\nb\n\n> c\n>\n> d', 'a\n\n\nb\nc\n\nd'],
    ['empty list items and quotes are empty blocks', '- \n- x\n\n>', '\nx\n'],
    ['blank lines inside fences are not empty blocks', '```\na\n\n\nb\n```', 'a\n\n\nb'],
    ['CJK, emoji and combining marks are kept', '漢字 👩🏽‍💻 é', '漢字 👩🏽‍💻 é'],
    ['highlight delimiters and colour prefixes dropped in pairs', '==a== ==🔴b== `==c==` \\==d', 'a b ==c== ==d'],
    ['an odd number of highlight delimiters stays literal', 'a == b ==c== d', 'a == b ==c== d'],
  ]
  it.each(cases)('%s', (_name, body, expected) => {
    expect(text(body)).toBe(expected)
  })

  it('reads highlight colour prefixes from the rich editor list', () => {
    expect([...HIGHLIGHT_COLOR_PREFIXES]).toEqual(MARKDOWN_HIGHLIGHT_COLOR_OPTIONS.map(option => option.markdownPrefix).filter(Boolean))
  })

  it('reads CRLF and CR line endings like LF', () => {
    const body = '# T\n\npara one\nline two  \nthree\n\n```\ncode\n```\n'
    expect(text(body.replaceAll('\n', '\r\n'))).toBe(text(body))
    expect(text(body.replaceAll('\n', '\r'))).toBe(text(body))
  })

  it('is deterministic and maps every literal segment one to one', () => {
    const body = '# T\r\n\r\nSome *text* &amp; [[Link|label]] `code`\r\n> q\r\n'
    const first = projectMarkdownBody(body)
    expect(projectMarkdownBody(body)).toEqual(first)
    for (const segment of first.segments) {
      const projected = first.text.slice(segment.textFrom, segment.textTo)
      if (segment.literal) expect(body.slice(segment.sourceFrom, segment.sourceTo)).toBe(projected)
      else expect(segment.sourceTo).toBeGreaterThan(segment.sourceFrom)
    }
    for (let index = 1; index < first.segments.length; index += 1) {
      expect(first.segments[index].sourceFrom).toBeGreaterThanOrEqual(first.segments[index - 1].sourceTo)
      expect(first.segments[index].textFrom).toBeGreaterThanOrEqual(first.segments[index - 1].textTo)
    }
  })
})

describe('raw selections', () => {
  const body = 'Hello **bold** &amp; [[Target|label]] world.\n\nNext para.'
  const projection = projectMarkdownBody(body)
  const select = (from: string, to: string) => projectSourceRange(projection, body.indexOf(from), body.indexOf(to) + to.length)

  it('maps a selection through markup to visible text', () => {
    expect(select('**bold**', '**bold**')).toEqual({ exact: 'bold', start: 6, end: 10, anchored: true })
    expect(select('Hello', 'world.')).toMatchObject({ exact: 'Hello bold & label world.', anchored: true })
    expect(select('world.', 'Next')).toMatchObject({ exact: 'world.\nNext', anchored: true })
  })

  it('keeps cutting through emphasis markers anchored, but not cutting a replaced construct', () => {
    const start = body.indexOf('bold') - 1
    expect(projectSourceRange(projection, start, start + 4)).toMatchObject({ exact: 'bol', anchored: true })
    const entity = body.indexOf('&amp;')
    expect(projectSourceRange(projection, entity + 2, entity + 8)).toMatchObject({ exact: ' ', anchored: false })
    const link = body.indexOf('[[')
    expect(projectSourceRange(projection, link + 3, body.indexOf(' world'))).toEqual({ exact: '', start: 0, end: 0, anchored: false })
  })

  it('finds the body range of projected text, widening to whole constructs', () => {
    const start = projection.text.indexOf('& label')
    const range = sourceRangeOfText(projection, start, start + '& label'.length)
    expect(range && body.slice(range.from, range.to)).toBe('&amp; [[Target|label]]')
    const bold = sourceRangeOfText(projection, 6, 10)
    expect(bold && body.slice(bold.from, bold.to)).toBe('bold')
    expect(sourceRangeOfText(projection, 5, 5)).toBeNull()
  })

  it('maps CRLF selections in exact body offsets', () => {
    const crlf = 'one\r\ntwo\r\n\r\nthree'
    const crlfProjection = projectMarkdownBody(crlf)
    expect(crlfProjection.text).toBe('one\ntwo\nthree')
    expect(projectSourceRange(crlfProjection, 0, crlf.indexOf('two') + 3)).toMatchObject({ exact: 'one\ntwo', anchored: true })
    expect(projectSourceRange(crlfProjection, 2, 4)).toMatchObject({ exact: 'e', anchored: false })
    const range = sourceRangeOfText(crlfProjection, 0, 7)
    expect(range && crlf.slice(range.from, range.to)).toBe('one\r\ntwo')
  })
})

describe('raw editor positions', () => {
  /** CodeMirror's text: every line ending is one position. */
  const editorText = (content: string) => content.replace(/\r\n?/gu, '\n')
  const select = (content: string, quote: string) => {
    const from = editorText(content).indexOf(quote)
    return projectRawEditorSelection(content, from, from + quote.length)
  }

  it('counts each CRLF as one editor position', () => {
    const content = '# A\r\n\r\nhello'
    expect(noteOffsetOfEditorPosition(content, 5)).toBe(7)
    expect(select(content, 'hello')).toEqual({ exact: 'hello', start: 2, end: 7, anchored: true })
  })

  it('maps LF, CRLF and mixed notes with and without front matter to the same passage', () => {
    const lf = '---\ntitle: x\nother: y\n---\n# A\n\nfirst line\nthe passage here\n'
    for (const content of [lf, lf.replaceAll('\n', '\r\n'), lf.replace('\n# A', '\r\n# A'), lf.replace(/^---[\s\S]*?---\n/u, '')]) {
      expect(select(content, 'passage here')).toMatchObject({ exact: 'passage here', anchored: true })
      expect(select(content, 'line\nthe')).toMatchObject({ exact: 'line\nthe', anchored: true })
    }
  })

  it('is null in the front matter and unanchored when starting there', () => {
    const content = '---\r\ntitle: x\r\n---\r\nbody text\r\n'
    expect(select(content, 'title')).toBeNull()
    const from = editorText(content).indexOf('x')
    expect(projectRawEditorSelection(content, from, editorText(content).indexOf('body') + 4)).toEqual({ exact: 'body', start: 0, end: 4, anchored: false })
  })
})
