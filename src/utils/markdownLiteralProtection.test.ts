import { describe, expect, it } from 'vitest'
import { tryParseFastMarkdownBlocks } from '../hooks/editorFastMarkdownBlocks'
import {
  hasProtectedLiteral,
  protectedLiteralIndex,
  protectEscapedLiterals,
  restoreProtectedLiteralsInBlocks,
  restoreProtectedLiteralText,
} from './markdownLiteralProtection'

const char = (code: number) => String.fromCharCode(code)
const START = char(0xe000)
const END = char(0xe001)

describe('markdown literal protection', () => {
  it('protects an escaped callout bracket and an escaped equals run, then restores them', () => {
    const protected_ = protectEscapedLiterals('\\[!NOTE] and \\=\\=x\\=\\=')
    expect(hasProtectedLiteral(protected_)).toBe(true)
    expect(protected_).not.toContain('[!')
    expect(protected_).not.toContain('=')
    expect(restoreProtectedLiteralText(protected_)).toBe('[!NOTE] and ==x==')
  })

  it('leaves escapes that no injector depends on as ordinary escapes', () => {
    for (const source of ['\\[link\\]', 'a \\= b', '\\*x\\*', 'x\\', '\\[[Page]]']) {
      expect(protectEscapedLiterals(source)).toBe(source)
    }
  })

  it('keeps a literal backslash before a brace', () => {
    const protected_ = protectEscapedLiterals('C:\\Users\\x\\{y}')
    expect(restoreProtectedLiteralText(protected_)).toBe('C:\\Users\\x\\{y}')
  })

  it('keeps an escaped backslash escaped, so following syntax stays authored', () => {
    expect(protectEscapedLiterals('\\\\[!NOTE] x')).toBe('\\\\[!NOTE] x')
    expect(protectEscapedLiterals('\\\\==x==')).toBe('\\\\==x==')
    expect(protectEscapedLiterals('\\\\\\[!NOTE] x')).not.toContain('[!NOTE]')
  })

  it('does not touch escapes inside code spans or fenced code', () => {
    expect(protectEscapedLiterals('`\\[!literal\\] \\=\\= \\{`')).toBe('`\\[!literal\\] \\=\\= \\{`')
    const fence = ['```', '\\[!NOTE\\] and \\=\\= and \\{', '```'].join('\n')
    expect(protectEscapedLiterals(fence)).toBe(fence)
  })

  it('leaves an earlier preprocessor placeholder exactly as written', () => {
    const placeholder = `${char(0x2039)}WIKILINK:Page \\=\\= x \\{y${char(0x203a)}`
    const protected_ = protectEscapedLiterals(`see ${placeholder} and \\=\\=`)
    expect(protected_.startsWith(`see ${placeholder} and `)).toBe(true)
    expect(protected_.endsWith('\\=\\=')).toBe(false)
    expect(protectEscapedLiterals(`see ${placeholder}`)).toBe(`see ${placeholder}`)
  })

  it('protects prose after a code span that began on an earlier line of the paragraph', () => {
    const protected_ = protectEscapedLiterals('see `a\nb` \\=\\= c `d`')
    expect(protected_.startsWith('see `a\nb` ')).toBe(true)
    expect(protected_).not.toContain('\\=')
    // A heading is a block of its own, so its backtick cannot pair with one on the next line.
    expect(protectEscapedLiterals('# H `x\n\\=\\=a `y`')).not.toContain('\\=')
  })

  it('never rewrites raw sentinel-shaped text, in any context', () => {
    for (const hex of ['5B', '3D', '5C', 'FFFFFF', '110000', 'D800', '0']) {
      const raw = `${START}${hex}${END}`
      expect(protectEscapedLiterals(raw)).toBe(raw)
      expect(restoreProtectedLiteralText(raw)).toBe(raw)
      expect(restoreProtectedLiteralsInBlocks([{ type: 'codeBlock', props: { language: raw }, content: [{ text: raw }] }]))
        .toEqual([{ type: 'codeBlock', props: { language: raw }, content: [{ text: raw }] }])
    }
  })

  it('restores a live token the URI normalizer percent-encoded, as that normalizer writes the character', () => {
    // What a Markdown link target holds after normalization: the delimiters percent-encoded.
    const uriEncode = (text: string) => text.replaceAll(START, '%EE%80%80').replaceAll(END, '%EE%80%81')
    expect(restoreProtectedLiteralText(uriEncode(protectEscapedLiterals('?q\\=\\=v')))).toBe('?q==v')
    expect(restoreProtectedLiteralText(uriEncode(protectEscapedLiterals('a\\{b')))).toBe('a%5C{b')
    // Not this session's nonce, so it is user data and stays exactly as written.
    expect(restoreProtectedLiteralText('?x=%EE%80%80deadbeefdeadbeef3D%EE%80%81')).toBe('?x=%EE%80%80deadbeefdeadbeef3D%EE%80%81')
  })

  it('restores the original escape inside parsed code, which keeps backslashes literally', () => {
    const protected_ = protectEscapedLiterals('a \\=\\= b \\[!x \\{ y')
    expect(restoreProtectedLiteralText(protected_, 'source')).toBe('a \\=\\= b \\[!x \\{ y')
    expect(restoreProtectedLiteralsInBlocks([
      { type: 'paragraph', content: [{ type: 'text', text: protected_, styles: { code: true } }] },
      { type: 'codeBlock', content: [{ type: 'text', text: protected_, styles: {} }] },
      { type: 'paragraph', content: [{ type: 'text', text: protected_, styles: {} }] },
    ])).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'a \\=\\= b \\[!x \\{ y', styles: { code: true } }] },
      { type: 'codeBlock', content: [{ type: 'text', text: 'a \\=\\= b \\[!x \\{ y', styles: {} }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'a == b [!x \\{ y', styles: {} }] },
    ])
  })

  it('reports a live token in either representation, so the encoder can refuse it', () => {
    const live = protectEscapedLiterals('\\=\\=')
    expect(protectedLiteralIndex(`ab ${live}`)).toBe(3)
    expect(protectedLiteralIndex(`ab ${live.replaceAll(START, '%EE%80%80').replaceAll(END, '%EE%80%81')}`)).toBe(3)
    expect(protectedLiteralIndex('ab %EE%80%80deadbeefdeadbeef3D%EE%80%81')).toBe(-1)
  })

  it('restores the same protected form identically however many times it is parsed', () => {
    const first = protectEscapedLiterals('a \\=\\=b\\=\\= c')
    expect(protectEscapedLiterals('a \\=\\=b\\=\\= c')).toBe(first)
  })

  it('produces a representation the large-note parser carries through as plain text', () => {
    const protected_ = protectEscapedLiterals('a \\=\\=b\\=\\= c and \\[!NOTE] d')
    const parsed = tryParseFastMarkdownBlocks(protected_)
    expect(parsed.supported).toBe(true)
    const [block] = parsed.blocks as Array<{ content: Array<{ text?: string, styles?: Record<string, unknown> }> }>
    expect(block.content).toHaveLength(1)
    expect(block.content[0]?.styles).toEqual({})
    expect(restoreProtectedLiteralText(block.content[0]?.text ?? '')).toBe('a ==b== c and [!NOTE] d')
  })
})

describe('large-note parser fallbacks', () => {
  const reasonFor = (markdown: string) => tryParseFastMarkdownBlocks(markdown).metrics.fallbackReason

  it('handles an escaped reference itself and declines an unescaped one', () => {
    expect(reasonFor('\\&amp; and \\&#64; stay escaped')).toBeNull()
    expect(reasonFor('plain text with AT&T and a & b')).toBeNull()
    expect(reasonFor('&copy; needs decoding')).toBe('character-reference')
    expect(reasonFor('&#38;#x41; needs decoding')).toBe('character-reference')
    expect(reasonFor('first line\nsecond &#64; line')).toBe('character-reference')
  })

  it('declines prose whose intraword underscores the inline parser would pair', () => {
    expect(reasonFor('snake_case_name')).toBe('intraword-underscore')
    expect(reasonFor('a_b on one line\nand c_d on the next')).toBe('intraword-underscore')
    expect(reasonFor('https://a.test/x_y and https://b.test/p_q')).toBe('intraword-underscore')
  })

  it('keeps the fast path where underscores are already safe', () => {
    expect(reasonFor('one_two alone')).toBeNull()
    expect(reasonFor('escaped snake\\_case\\_name')).toBeNull()
    expect(reasonFor('`snake_case_name` in code')).toBeNull()
    expect(reasonFor('```\nsnake_case_name\nother_name\n```')).toBeNull()
    expect(reasonFor('@@TOLARIA_HTML_BLOCK:%7B%7D@@')).toBeNull()
  })

  it('keeps a backslash before a letter, as CommonMark does', () => {
    const [block] = tryParseFastMarkdownBlocks('C:\\Users\\name and \\*literal\\* and end\\').blocks as Array<{
      content: Array<{ text?: string }>
    }>
    expect(block.content.map(item => item.text ?? '').join('')).toBe('C:\\Users\\name and *literal* and end\\')
  })

  it('reads consecutive quote lines as one quote, but not across a nested marker', () => {
    const blocks = tryParseFastMarkdownBlocks('> line one\n> line two\n> > nested\n\n> after').blocks as Array<{
      type: string
      content: Array<{ text?: string }>
    }>
    expect(blocks.map(block => [block.type, block.content.map(item => item.text ?? '').join('')])).toEqual([
      ['quote', 'line one\nline two'],
      ['quote', '> nested'],
      ['quote', 'after'],
    ])
  })

  it('declines a code span opened by two or more unescaped backticks', () => {
    expect(reasonFor('see ``a `b` c`` here')).toBe('multi-backtick-code')
    expect(reasonFor('a literal \\\\``code`` after a backslash')).toBe('multi-backtick-code')
    expect(reasonFor('see `single` code and \\`\\` escaped ticks')).toBeNull()
    expect(reasonFor('```\nfenced ``code``\n```')).toBeNull()
  })

  it('keeps hashes in headings instead of reading them as a closing sequence', () => {
    const headingText = (markdown: string) => {
      const [block] = tryParseFastMarkdownBlocks(markdown).blocks as Array<{
        type: string
        content: Array<{ text?: string }>
      }>
      expect(block.type).toBe('heading')
      return block.content.map(item => item.text ?? '').join('')
    }

    expect(headingText('## C#')).toBe('C#')
    expect(headingText('## C##')).toBe('C##')
    expect(headingText('## Rank \\#')).toBe('Rank #')
    expect(headingText('## F# and C#')).toBe('F# and C#')
    expect(headingText('## Title ##')).toBe('Title')
    expect(headingText('## Title')).toBe('Title')
  })
})
