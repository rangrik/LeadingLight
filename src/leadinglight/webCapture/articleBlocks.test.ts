import { describe, expect, it } from 'vitest'
import { articleNoteBlocks, parseArticleHtml, settleCodeLanguage, summarizeEditorBlocks, toEditorBlocks, type BlockCounts, type NoteBlock } from './articleBlocks'
import { WebCaptureRefusalError } from './articleText'
import { htmlBlockMarkdownCodec } from '../../utils/htmlBlockMarkdown'
import { mermaidMarkdownCodec } from '../../utils/mermaidMarkdown'
import { tldrawMarkdownCodec } from '../../utils/tldrawMarkdown'

function counts(): BlockCounts {
  return { droppedLinks: 0, splitCodeBlocks: 0, degradedTables: 0, plainBlocks: 0 }
}

function blocksOf(html: string, tally = counts()): NoteBlock[] {
  return articleNoteBlocks(parseArticleHtml(html), tally)
}

describe('code labels', () => {
  it.each([
    ['js', 'const a = 1', 'js'],
    ['sh', 'echo hi', 'bash'],
    ['html', '<p>x</p>', 'xml'],
    ['HTM', '<p>x</p>', 'xml'],
    ['xhtml', 'text', 'xml'],
    [null, '<section><p>x</p></section>', 'xml'],
    [null, 'def run():\n    pass', 'python'],
    [null, 'npm install', 'bash'],
    [null, 'just words here', 'text'],
    [null, 'graph TD; A-->B', 'txt'],
    ['mermaid', 'graph TD; A-->B', 'txt'],
    ['plaintext', 'pie title Pets', 'txt'],
    ['tldraw', '{"document":{}}', 'json'],
    ['text', 'timeline of the voyage', 'txt'],
  ])('labels %s code %j as %s, the editor\'s own settled label', (hint, code, expected) => {
    expect(settleCodeLanguage(hint, code)).toBe(expected)
  })

  it('never leaves a label the editor turns into an HTML, Mermaid or whiteboard block', () => {
    for (const hint of ['html', 'mermaid', 'tldraw', 'text', 'plain', null]) {
      for (const code of ['<div>x</div>', '<!doctype html><p>x</p>', 'graph TD; A-->B', 'flowchart LR', 'sequenceDiagram', '{"a":1}']) {
        const language = settleCodeLanguage(hint, code)
        const block = { type: 'codeBlock', props: { language }, content: [{ type: 'text', text: code, styles: {} }] }
        for (const codec of [htmlBlockMarkdownCodec, mermaidMarkdownCodec, tldrawMarkdownCodec]) {
          expect(codec.readFenceMetadata(language)).toBeNull()
          expect(codec.readCodeBlock?.(block) ?? null).toBeNull()
        }
      }
    }
  })

  it('splits out each line that starts like a fence, in order and in code style', () => {
    const tally = counts()
    const blocks = blocksOf('<pre><code class="language-md">intro\n```js\nbody\n   ~~~\nend</code></pre>', tally)
    expect(blocks).toEqual([
      { type: 'codeBlock', language: 'md', code: 'intro' },
      { type: 'paragraph', runs: [{ text: '```js', styles: ['code'], href: null }] },
      { type: 'codeBlock', language: 'md', code: 'body' },
      { type: 'paragraph', runs: [{ text: '   ~~~', styles: ['code'], href: null }] },
      { type: 'codeBlock', language: 'md', code: 'end' },
    ])
    expect(tally.splitCodeBlocks).toBe(1)
  })
})

describe('normalizing the parsed article', () => {
  it('keeps one space between words and no space around line breaks or at block edges', () => {
    const [block] = blocksOf('<p>  a <strong> b </strong>  c<br>   d  </p>')
    expect(block).toEqual({ type: 'paragraph', runs: [
      { text: 'a ', styles: [], href: null }, { text: 'b ', styles: ['bold'], href: null }, { text: 'c\nd', styles: [], href: null },
    ] })
  })

  it('splits paragraphs and quotes at blank lines, and joins list item lines', () => {
    const blocks = blocksOf('<p>one<br><br>two</p><blockquote><p>q1<br><br>q2</p></blockquote><ul><li><p>a<br><br>b</p></li></ul>')
    expect(blocks.map(block => [block.type, 'runs' in block ? block.runs.map(run => run.text).join('') : ''])).toEqual([
      ['paragraph', 'one'], ['paragraph', 'two'], ['quote', 'q1'], ['quote', 'q2'], ['bulletListItem', 'a\nb'],
    ])
  })

  it('drops marks the canonical serializer would write as syntax: a lone == and a trailing backslash', () => {
    const tally = counts()
    const blocks = blocksOf('<p><em>x</em>==<strong>y</strong></p><p>path\\<em>*x</em></p>', tally)
    expect(blocks.map(block => ('runs' in block ? block.runs : []))).toEqual([
      [{ text: 'x==y', styles: [], href: null }],
      [{ text: 'path\\*x', styles: [], href: null }],
    ])
    expect(tally.plainBlocks).toBe(2)
  })

  it('unlinks a link right after `!`, which would reopen as an image', () => {
    const tally = counts()
    const [block] = blocksOf('<p>Look!<a href="https://e.org/x">here</a> and <a href="https://e.org/y">there</a></p>', tally)
    expect(block).toEqual({ type: 'paragraph', runs: [{ text: 'Look!here and ', styles: [], href: null }, { text: 'there', styles: [], href: 'https://e.org/y' }] })
    expect(tally.droppedLinks).toBe(1)
  })

  it('refuses any reserved editor marker, in text, code or a link', () => {
    for (const html of ['<p>@@TOLARIA_X@@</p>', '<pre><code>@@TOLARIA_MATH:1@@</code></pre>', '<p>a ‹WIKILINK:x›</p>', '<p><a href="https://e.org/@@TOLARIA">x</a></p>']) {
      expect(() => blocksOf(html)).toThrow(WebCaptureRefusalError)
    }
  })

  it('summarizes the same note the same way, and a changed character, mark or link differently', () => {
    const blocks = blocksOf('<h2>Head</h2><p>a <strong>b</strong> <a href="https://e.org/">c</a></p><table><tr><th>x</th></tr><tr><td>y</td></tr></table>')
    const summary = summarizeEditorBlocks(toEditorBlocks(blocks))
    expect(summarizeEditorBlocks(toEditorBlocks(blocks))).toEqual(summary)
    const variants = [
      blocks.map(block => (block.type === 'heading' ? { ...block, level: 3 } : block)),
      blocks.map(block => (block.type === 'paragraph' ? { ...block, runs: block.runs.map(run => ({ ...run, styles: [] })) } : block)),
      blocks.map(block => (block.type === 'paragraph' ? { ...block, runs: block.runs.map(run => ({ ...run, href: run.href ? 'https://e.org/other' : null })) } : block)),
      blocks.map(block => (block.type === 'paragraph' ? { ...block, runs: [{ text: 'a b c.', styles: [], href: null }] } : block)),
    ]
    for (const variant of variants) expect(summarizeEditorBlocks(toEditorBlocks(variant as NoteBlock[]))).not.toEqual(summary)
  })
})
