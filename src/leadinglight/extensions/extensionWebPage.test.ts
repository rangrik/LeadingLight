import { describe, expect, it } from 'vitest'
import { EXTENSION_LIMITS, type ComposedDocument, type WebPageCapture } from './extensionContract'
import { isWebPageUrl, readWebPageCapture, webArticleComposition } from './extensionWebPage'

const page: WebPageCapture = {
  page: 'web-page-1', kind: 'linkOnly', pageTitle: 'Ünïcode 漢字 title', pageUrl: 'https://例え.jp/パス?q=1',
  siteName: 'example.org', byline: null,
}

describe('reading what the host offers for a page', () => {
  it('returns a frozen copy with exactly the six keys', () => {
    const read = readWebPageCapture({ ...page })
    expect(read).toEqual(page)
    expect(Object.isFrozen(read)).toBe(true)
    expect(read).not.toBe(page)
  })

  it('bounds the single-line values at their limits', () => {
    const at = (length: number) => readWebPageCapture({ ...page, pageTitle: 'é'.repeat(length) })
    expect(at(EXTENSION_LIMITS.pageTextBytes / 2)).not.toBeNull()
    expect(at(EXTENSION_LIMITS.pageTextBytes / 2 + 1)).toBeNull()
    for (const text of ['a\u0007b', 'a\u2028b', 'a\u0085b', 'a\uD800b', 'a\r\nb', '  ']) expect(readWebPageCapture({ ...page, siteName: text })).toBeNull()
    expect(readWebPageCapture({ ...page, byline: 'Ada Example' })).toMatchObject({ byline: 'Ada Example' })
  })

  it('accepts only absolute http(s) addresses without credentials or fragments', () => {
    for (const url of ['http://example.org', 'https://example.org/a?b=c', 'https://[2001:db8::1]/x', `https://example.org/${'a'.repeat(EXTENSION_LIMITS.pageUrlBytes - 20)}`]) {
      expect(isWebPageUrl(url)).toBe(true)
    }
    for (const url of [
      'example.org', '//example.org', 'mailto:a@example.org', 'data:text/html,x', 'file:///etc/passwd', 'leadinglight://x',
      'https://a:b@example.org/', 'https://user@example.org/', 'https://example.org/#x', 'https://example.org/ a', '',
      `https://example.org/${'a'.repeat(EXTENSION_LIMITS.pageUrlBytes)}`, 42, null,
    ]) expect(isWebPageUrl(url)).toBe(false)
  })

  it('is never a passage capture, an array or anything with prototype keys', () => {
    expect(readWebPageCapture({ passage: 'p', quote: 'q', sourceTitle: 't' })).toBeNull()
    expect(readWebPageCapture([page])).toBeNull()
    expect(readWebPageCapture(Object.assign(Object.create({ kind: 'article' }), { ...page, kind: undefined }))).toBeNull()
    expect(readWebPageCapture(JSON.parse(`{"page":"p","kind":"article","pageTitle":"t","pageUrl":"https://e.org/","siteName":"s","byline":null,"__proto__":{}}`))).toBeNull()
  })
})

describe('splitting a composed website note for the host', () => {
  const document = (blocks: ComposedDocument['blocks'], title: string | null = 'Title'): ComposedDocument => ({ title, blocks, textBytes: 0 })

  it('needs exactly one leading page block and a title', () => {
    const blocks = [{ type: 'webArticle', page: 'web-page-1' }, { type: 'paragraph', text: 'Mine.' }] as const
    expect(webArticleComposition(document([...blocks]))).toEqual({ page: 'web-page-1', title: 'Title', blocks: [blocks[1]] })
    expect(webArticleComposition(document([blocks[1], blocks[0]]))).toBeNull()
    expect(webArticleComposition(document([blocks[0], blocks[0]]))).toBeNull()
    expect(webArticleComposition(document([blocks[0], { type: 'source', passage: 'p', quote: 'q' }]))).toBeNull()
    expect(webArticleComposition(document([{ type: 'webArticle', page: 'bad handle' }]))).toBeNull()
    expect(webArticleComposition(document([...blocks], null))).toBeNull()
    expect(webArticleComposition(document([]))).toBeNull()
  })
})
