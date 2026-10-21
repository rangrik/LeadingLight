import { describe, expect, it } from 'vitest'
import { articleHref, encodeLinkDestination, hostLabel, normalizeCaptureUrl } from './articleUrls'

const PAGE = 'https://pages.example.org/docs/page'

describe('the capture\'s own addresses', () => {
  it.each([
    ['https://pages.example.org/a?b=1#frag', 'https://pages.example.org/a?b=1'],
    ['http://Pages.Example.org', 'http://pages.example.org/'],
    ['https://0x7f.0.0.1/', 'https://127.0.0.1/'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeCaptureUrl(input)).toBe(expected)
  })

  it.each([
    'javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'ftp://example.org/', '/relative', 'https://user:pw@example.org/',
    ' https://example.org/', `https://example.org/${'a'.repeat(2048)}`, 42, null,
  ])('refuses %s', (input) => {
    expect(normalizeCaptureUrl(input)).toBeNull()
  })
})

describe('article links', () => {
  it('resolves against the captured page only and keeps absolute http(s)', () => {
    expect(articleHref('next', PAGE)).toBe('https://pages.example.org/docs/next')
    expect(articleHref('/root', PAGE)).toBe('https://pages.example.org/root')
    expect(articleHref('//cdn.example.net/x', PAGE)).toBe('https://cdn.example.net/x')
    expect(articleHref('https://other.example/a#part', PAGE)).toBe('https://other.example/a#part')
    expect(articleHref(PAGE, PAGE)).toBe(PAGE)
  })

  it.each([
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'mailto:a@example.org', 'tel:123', 'blob:https://x/1',
    'https://user:pw@example.org/', '#section', '', `${PAGE}#section`, `${PAGE}#`, 'https://example.org/@@TOLARIA_HTML_BLOCK:1@@',
  ])('leaves %j unlinked', (input) => {
    expect(articleHref(input, PAGE)).toBeNull()
  })

  it('percent-encodes what the note\'s preprocessors would read as syntax, and nothing else', () => {
    expect(encodeLinkDestination('https://e.org/a_(b)/[[w]]/$1/x`y`/a\\b/{c}|d^e~f*g!h\'i;j:k@l&m=n+o,p#q'))
      .toBe('https://e.org/a_%28b%29/%5B%5Bw%5D%5D/%241/x%60y%60/a%5Cb/%7Bc%7D%7Cd%5Ee~f*g!h\'i;j:k@l&m=n+o,p#q')
    expect(encodeLinkDestination('https://e.org/100%/%41%zz')).toBe('https://e.org/100%25/%41%25zz')
    expect(articleHref('https://e.org/ü?q=日本', PAGE)).toBe('https://e.org/%C3%BC?q=%E6%97%A5%E6%9C%AC')
  })

  it('names a page without a title by its host', () => {
    expect(hostLabel(PAGE)).toBe('pages.example.org')
  })
})
