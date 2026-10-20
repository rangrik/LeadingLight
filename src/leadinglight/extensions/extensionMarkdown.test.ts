import { describe, expect, it, vi } from 'vitest'
import { sha256Hex } from '../saveOutcome'
import type { ComposedDocument, DocumentBlock } from './extensionContract'
import { answerTextProblem, buildExtensionMarkdown, fileNameForTitle, markdownSha256 } from './extensionMarkdown'

// Structure, limits and refusals only. The manager's encoder snapshot imports a parser-lane module
// this worktree does not have yet, so a stand-in with the encoder's documented contract (validate,
// trim, split lines, mark escapes with `\`) is used here. Literal safety under the real encoder and
// parsers is extensionMarkdown.pipeline.test.ts, run in the integrated checkout.
vi.mock('./extensionMarkdownText', () => {
  class LiteralMarkdownTextError extends Error {
    readonly reason: string
    constructor(reason: string) { super(reason); this.reason = reason }
  }
  const validate = (text: string) => {
    if (text.length > 256 * 1024) throw new LiteralMarkdownTextError('tooLong')
    if ([...text].some(char => { const code = char.codePointAt(0)!; return (code < 0x20 && code !== 9 && code !== 10 && code !== 13) || (code >= 0xd800 && code <= 0xdfff) })) {
      throw new LiteralMarkdownTextError('controlCharacter')
    }
    if (text.includes('@@TOLARIA')) throw new LiteralMarkdownTextError('reservedMarker')
  }
  const encode = (line: string) => line.replace(/[*#[\]<`-]/g, match => `\\${match}`)
  const lines = (text: string) => {
    validate(text)
    const all = text.split(/\r\n|\n|\r/).map(line => line.trim())
    const first = all.findIndex(line => line !== '')
    if (first === -1) return []
    let last = all.length - 1
    while (all[last] === '') last -= 1
    return all.slice(first, last + 1).map(line => (line ? encode(line) : ''))
  }
  return {
    LiteralMarkdownTextError,
    encodeLiteralMarkdownLines: lines,
    encodeLiteralMarkdownInline: (text: string) => {
      validate(text)
      if (/[\r\n]/.test(text)) throw new LiteralMarkdownTextError('lineBreak')
      return encode(text.trim())
    },
  }
})

const char = (code: number) => String.fromCharCode(code)
const doc = (title: string | null, blocks: DocumentBlock[]): ComposedDocument => ({ title, blocks, textBytes: 0 })
const built = (document: ComposedDocument, fallback = 'New note') => {
  const result = buildExtensionMarkdown(document, fallback)
  if (result.status !== 'built') throw new Error(`refused: ${result.reason}`)
  return result.markdown
}

describe('host Markdown structure for a composed document', () => {
  it('writes the title as the only level 1 heading and separates blocks with blank lines', () => {
    const markdown = built(doc('Debrief: Weekly sync', [
      { type: 'list', style: 'bullet', items: ['Attendees: Ana, Ben', 'Mood: Went well'] },
      { type: 'heading', level: 2, text: 'Decisions' },
      { type: 'paragraph', text: 'Ship on Friday.\nTell support.' },
      { type: 'quote', text: 'First line\n\nSecond paragraph' },
      { type: 'list', style: 'numbered', items: ['One', 'Two'] },
      { type: 'heading', level: 4, text: 'Small' },
    ]))
    expect(markdown.content).toBe([
      '# Debrief: Weekly sync', '',
      '- Attendees: Ana, Ben', '- Mood: Went well', '',
      '## Decisions', '',
      'Ship on Friday.', 'Tell support.', '',
      '> First line', '>', '> Second paragraph', '',
      '1. One', '2. Two', '',
      '#### Small', '',
    ].join('\n'))
    expect(markdown.title).toBe('Debrief: Weekly sync')
    expect(markdown.fileName).toBe('debrief-weekly-sync.md')
  })

  it('puts every piece of text through the encoder and adds only host punctuation', () => {
    const markdown = built(doc('# Not *a* title', [
      { type: 'heading', level: 2, text: '[x]' },
      { type: 'paragraph', text: '<b>' },
      { type: 'quote', text: '- quoted' },
      { type: 'list', style: 'bullet', items: ['- nested'] },
    ]))
    expect(markdown.content).toBe('# \\# Not \\*a\\* title\n\n## \\[x\\]\n\n\\<b>\n\n> \\- quoted\n\n- \\- nested\n')
  })

  it('leaves out blocks and list items whose text is blank, and renumbers what remains', () => {
    const markdown = built(doc('Note', [
      { type: 'paragraph', text: '   ' },
      { type: 'heading', level: 3, text: ' ' },
      { type: 'quote', text: '\n\n' },
      { type: 'list', style: 'numbered', items: ['', 'Kept', '  ', 'Also kept'] },
      { type: 'list', style: 'bullet', items: [' '] },
    ]))
    expect(markdown.content).toBe('# Note\n\n1. Kept\n2. Also kept\n')
  })

  it('falls back to the command title when the composed title is blank', () => {
    expect(built(doc('   ', []), 'New meeting debrief')).toMatchObject({ title: 'New meeting debrief', content: '# New meeting debrief\n', fileName: 'new-meeting-debrief.md' })
    expect(built(doc(null, []), 'Quick note').title).toBe('Quick note')
  })

  it('refuses a captured-passage source block instead of guessing its association', () => {
    expect(buildExtensionMarkdown(doc('Commentary', [{ type: 'source', passage: 'p1', quote: 'Quoted' }]), 'x'))
      .toEqual({ status: 'refused', reason: 'source', failure: null })
  })

  it('refuses text the encoder refuses, with its reason', () => {
    expect(buildExtensionMarkdown(doc('Bell', [{ type: 'paragraph', text: `ring${char(7)}` }]), 'x'))
      .toEqual({ status: 'refused', reason: 'unsafeText', failure: 'controlCharacter' })
    expect(buildExtensionMarkdown(doc('Marker', [{ type: 'paragraph', text: '@@TOLARIA_HTML_BLOCK_0@@' }]), 'x'))
      .toEqual({ status: 'refused', reason: 'unsafeText', failure: 'reservedMarker' })
    expect(buildExtensionMarkdown(doc('Too', [{ type: 'paragraph', text: 'x'.repeat(256 * 1024 + 1) }]), 'x'))
      .toEqual({ status: 'refused', reason: 'tooLarge', failure: 'tooLong' })
  })

  it('refuses a page whose encoded bytes pass the proposal limit', () => {
    const big = Array.from({ length: 6 }, () => ({ type: 'paragraph' as const, text: '*'.repeat(100 * 1024) }))
    expect(buildExtensionMarkdown(doc('Big', big), 'x')).toEqual({ status: 'refused', reason: 'tooLarge', failure: null })
  })

  it('digests the exact UTF-8 bytes of the content', async () => {
    const markdown = built(doc('Café', [{ type: 'paragraph', text: '🎉 ½' }]))
    const bytes = new TextEncoder().encode(markdown.content)
    expect(markdown.contentBytes).toBe(bytes.length)
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    const expected = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    expect(await markdownSha256(markdown)).toBe(expected)
    expect(await sha256Hex(markdown.content)).toBe(expected)
  })
})

describe('file names from titles', () => {
  it('uses the existing title-to-filename slug, keeping letters of every script', () => {
    expect(fileNameForTitle('Weekly sync')).toBe('weekly-sync.md')
    expect(fileNameForTitle('Café — 東京, “quotes” & 50%')).toBe('café-東京-quotes-50.md')
    expect(fileNameForTitle('../../etc/passwd')).toBe('etc-passwd.md')
    expect(fileNameForTitle('***')).toBe('untitled.md')
    expect(fileNameForTitle('.hidden')).toBe('hidden.md')
  })

  it('never names a Windows device and stays within one 255-byte segment', () => {
    expect(fileNameForTitle('CON')).toBe('con-note.md')
    expect(fileNameForTitle('lpt1')).toBe('lpt1-note.md')
    const long = fileNameForTitle('東'.repeat(200))
    expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(255)
    expect(long.endsWith('.md')).toBe(true)
    expect(fileNameForTitle(`${'a'.repeat(251)}-b`)).toBe(`${'a'.repeat(251)}.md`)
  })
})

describe('answer checks before Create', () => {
  it('names the encoder problem for one answer', () => {
    expect(answerTextProblem('Plain *text*', false)).toBeNull()
    expect(answerTextProblem('two\nlines', true)).toBeNull()
    expect(answerTextProblem('two\nlines', false)).toBe('lineBreak')
    expect(answerTextProblem(`bell${char(7)}`, true)).toBe('controlCharacter')
  })
})
