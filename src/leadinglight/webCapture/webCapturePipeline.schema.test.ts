import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it } from 'vitest'
import { schema } from '../../components/editorSchema'
import type { VerifyEditor } from './articleVerify'
import { canonicalSave, convert, fixture, flat, inlineOf, largeVersion, marksOf, open, textOf } from './webCapture.test-utils'

/**
 * Captured notes under the app's own editor schema (HTML, Mermaid, math, whiteboard, callout and
 * attachment blocks, wikilinks and inline math), both as the conversion's own reopen check and as a
 * note the editor opens, below and above 16 KiB, and saved canonically. Like
 * extensionMarkdown.schema.test.ts, this may need the integrated primary checkout, where the IronCalc
 * WASM asset the schema imports resolves inside the Vite root.
 */

const ALLOWED_BLOCKS = new Set(['heading', 'paragraph', 'bulletListItem', 'numberedListItem', 'quote', 'codeBlock', 'table', 'divider'])
const createAppEditor = () => BlockNoteEditor.create({ schema })
type OpenEditor = Parameters<typeof open>[1]

async function appOpen(content: string) {
  return flat(await open(content, createAppEditor() as unknown as OpenEditor))
}

function expectOnlyLiteralBlocks(blocks: Awaited<ReturnType<typeof appOpen>>) {
  expect(blocks.map(block => block.type).filter(type => !ALLOWED_BLOCKS.has(type))).toEqual([])
  const kinds = blocks.flatMap(block => marksOf(inlineOf(block)))
  expect(kinds.filter(kind => !kind.startsWith('link:') && !['bold', 'italic', 'strike', 'code'].includes(kind))).toEqual([])
}

const LABELLED_CODE = `<html><head><title>Embedding diagrams</title></head><body><article><h1>Embedding diagrams</h1>
  <p>${'Pages about diagrams and markup label their code, and those labels are live blocks in a note. '.repeat(3)}</p>
  <pre><code class="language-html">&lt;div onclick="alert(1)"&gt;x&lt;/div&gt;</code></pre>
  <pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre>
  <pre><code class="language-tldraw">{"document":{"store":{}}}</code></pre>
  <pre><code data-lang="xhtml">&lt;p&gt;y&lt;/p&gt;</code></pre>
  <pre><code>&lt;iframe src="https://e.org/"&gt;&lt;/iframe&gt;</code></pre></article></body></html>`

describe('captured notes under the app editor schema', () => {
  it('parses page code labelled html, mermaid or tldraw as plain code even where the default editor carries the app blocks', async () => {
    const { note } = await convert(LABELLED_CODE, { createVerifyEditor: () => createAppEditor() as unknown as VerifyEditor })
    const blocks = await appOpen(note.content)
    expectOnlyLiteralBlocks(blocks)
    const codes = blocks.filter(block => block.type === 'codeBlock')
    expect(codes.map(block => [block.props?.language, textOf(block.content)])).toEqual([
      ['xml', '<div onclick="alert(1)">x</div>'],
      ['txt', 'graph TD; A-->B'],
      ['json', '{"document":{"store":{}}}'],
      ['xml', '<p>y</p>'],
      ['xml', '<iframe src="https://e.org/"></iframe>'],
    ])
    expect(await canonicalSave(note.content, createAppEditor)).toBe(note.content)
    expect((await convert(LABELLED_CODE)).note.content).toBe(note.content)
  })

  it.each(['article', 'literals', 'hostile'])('the %s page converts with the app schema in the reopen check, and reopens as the same blocks', async (name) => {
    const withApp = await convert(fixture(name), { createVerifyEditor: () => createAppEditor() as unknown as VerifyEditor })
    const withDefault = await convert(fixture(name))
    expect(withApp.note.content).toBe(withDefault.note.content)
    const blocks = await appOpen(withApp.note.content)
    expectOnlyLiteralBlocks(blocks)
    expect(blocks.map(block => [block.type, textOf(block.content)])).toEqual(flat(await open(withApp.note.content)).map(block => [block.type, textOf(block.content)]))
  })

  it('keeps HTML code as code and syntax text literal past 16 KiB and after canonical saves', async () => {
    for (const name of ['article', 'literals']) {
      const { note } = await convert(fixture(name))
      const large = largeVersion(note.content)
      expectOnlyLiteralBlocks((await appOpen(large.content)).slice(0, -1))
      expect(await canonicalSave(note.content, createAppEditor)).toBe(note.content)
      expect(await canonicalSave(large.content, createAppEditor)).toBe(large.content)
    }
    const markup = (await appOpen((await convert(fixture('article'))).note.content)).filter(block => block.type === 'codeBlock')
    expect(markup.map(block => block.props?.language)).toEqual(['js', 'python', 'xml', 'xml', 'txt'])
  })
})
