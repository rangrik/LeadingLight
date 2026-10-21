import { afterEach, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { deleteMockFrontmatterProperty, updateMockFrontmatter } from '../../hooks/mockFrontmatterHelpers'
import { parseFrontmatter } from '../../utils/frontmatter'
import { buildFrontmatter, yamlScalar } from './articleFrontmatter'
import { WEB_CAPTURE_PROVENANCE_KEY, type WebCaptureArticleMetadata, type WebCaptureSource } from './webCaptureContract'
import { CAPTURED_AT, convert, fixture, open, textOf } from './webCapture.test-utils'

declare global {
  interface Window {
    __mockContent?: Record<string, string>
  }
}

const SOURCE: WebCaptureSource = {
  sourceUrl: 'https://example.org/2026/10/article', requestedUrl: 'https://example.org/a', capturedAt: CAPTURED_AT,
}
const METADATA: WebCaptureArticleMetadata = { title: 'T', byline: 'Ada Example', siteName: 'Example Site', published: '2026-10-01', lang: null }

function yamlOf(frontmatter: string): Record<string, unknown> {
  return parseYaml(frontmatter.slice(4, -4)) as Record<string, unknown>
}

afterEach(() => {
  window.__mockContent = {}
})

describe('YAML scalars', () => {
  it.each([
    ['Ada Example', 'Ada Example'],
    ['2026-10-01', '2026-10-01'],
    ['https://example.org/a', '"https://example.org/a"'],
    ['Issue #4', '"Issue #4"'],
    ['- dash first', '"- dash first"'],
    ['yes', '"yes"'],
    ['1.5', '"1.5"'],
    ['0x1F', '"0x1F"'],
    ['[bracketed]', '"[bracketed]"'],
    ['Jane "JJ" Doe: notes', '\'Jane "JJ" Doe: notes\''],
    ['C:\\Users', '\'C:\\Users\''],
    ['O\'Brien "the" # one', null],
    ['line\nbreak', null],
  ])('writes %j as %j', (value, expected) => {
    expect(yamlScalar(value)).toBe(expected)
  })

  it('reads back exactly as written in both the properties panel and YAML', () => {
    for (const value of ['Ada Example', 'https://example.org/a?x=1#y', 'Issue #4', 'Jane "JJ" Doe: notes', 'C:\\Users', 'Ünïcödé 名前 🎉', 'مقالة', '- dash first']) {
      const frontmatter = `---\nvalue: ${yamlScalar(value)}\n---\n`
      expect(parseFrontmatter(`${frontmatter}# x\n`).value).toBe(value)
      expect(yamlOf(frontmatter).value).toBe(value)
    }
  })
})

describe('captured note frontmatter', () => {
  it('writes the source as the one URL, the time, page facts and hidden provenance', () => {
    const frontmatter = buildFrontmatter(SOURCE, METADATA, 'article')
    expect(frontmatter).toBe([
      '---',
      'source: "https://example.org/2026/10/article"',
      'author: Ada Example',
      'site: Example Site',
      'published: 2026-10-01',
      `captured: "${CAPTURED_AT}"`,
      `${WEB_CAPTURE_PROVENANCE_KEY}:`,
      '  version: 1',
      '  kind: article',
      '  requested: "https://example.org/a"',
      '  extractor: readability-0.6.0',
      '  converter: leadinglight-article-v1',
      '---',
      '',
    ].join('\n'))
    expect(yamlOf(frontmatter)).toEqual({
      source: SOURCE.sourceUrl, author: 'Ada Example', site: 'Example Site', published: '2026-10-01', captured: CAPTURED_AT,
      [WEB_CAPTURE_PROVENANCE_KEY]: { version: 1, kind: 'article', requested: SOURCE.requestedUrl, extractor: 'readability-0.6.0', converter: 'leadinglight-article-v1' },
    })
  })

  it('records the requested URL only when a redirect changed it', () => {
    const frontmatter = buildFrontmatter({ ...SOURCE, requestedUrl: SOURCE.sourceUrl }, null, 'link')
    expect(yamlOf(frontmatter)[WEB_CAPTURE_PROVENANCE_KEY]).toEqual({ version: 1, kind: 'link', converter: 'leadinglight-link-v1' })
    expect(frontmatter.match(/example\.org\/2026/gu)).toHaveLength(1)
  })

  it('keeps tricky page facts exact, and leaves out any either reader would see differently', () => {
    const frontmatter = buildFrontmatter(SOURCE, { ...METADATA, byline: 'Jane "JJ" Doe: #1', siteName: 'Yes' }, 'article')
    expect(parseFrontmatter(`${frontmatter}# x\n`).author).toBe('Jane "JJ" Doe: #1')
    expect(yamlOf(frontmatter).author).toBe('Jane "JJ" Doe: #1')
    // The properties panel reads a bare or quoted `Yes` as true, so the site is left out.
    expect(frontmatter).not.toContain('site:')
    const unwritable = buildFrontmatter(SOURCE, { ...METADATA, byline: 'O\'Brien "the" # one' }, 'article')
    expect(unwritable).not.toContain('author:')
  })
})

describe('editing a captured note\'s properties', () => {
  const PATH = '/vault/Web/keeping-a-lighthouse-log.md'

  async function captured() {
    return (await convert(fixture('article'), {}, { requestedUrl: 'https://harbour.example.org/a', finalUrl: 'https://harbour.example.org/2026/10/lighthouse-log' })).note
  }

  function readers(content: string) {
    const panel = parseFrontmatter(content)
    const [frontmatter] = content.match(/^---\n[\s\S]*?\n---\n/u) ?? ['']
    return { panel, yaml: yamlOf(frontmatter) }
  }

  it('keeps every other line, the provenance and the body when one property changes or is added', async () => {
    const note = await captured()
    window.__mockContent = { [PATH]: note.content }
    const edited = updateMockFrontmatter(PATH, 'author', 'Ada E. Example')
    window.__mockContent = { [PATH]: edited }
    const added = updateMockFrontmatter(PATH, 'rating', 'good')
    window.__mockContent = { [PATH]: added }
    const removed = deleteMockFrontmatterProperty(PATH, 'site')
    expect(removed.endsWith(note.body)).toBe(true)
    const before = note.frontmatter.split('\n')
    const after = removed.slice(0, removed.length - note.body.length).split('\n')
    expect(after.filter(line => !before.includes(line))).toEqual(['author: Ada E. Example', 'rating: good'])
    expect(before.filter(line => !after.includes(line))).toEqual(['author: Ada Example', 'site: Harbour Notes'])
    const { panel, yaml } = readers(removed)
    expect(panel).toMatchObject({ source: 'https://harbour.example.org/2026/10/lighthouse-log', author: 'Ada E. Example', rating: 'good', captured: CAPTURED_AT })
    expect(yaml[WEB_CAPTURE_PROVENANCE_KEY]).toEqual(readers(note.content).yaml[WEB_CAPTURE_PROVENANCE_KEY])
    const [first, second] = await Promise.all([open(note.content), open(removed)])
    expect(second.map(block => textOf(block.content))).toEqual(first.map(block => textOf(block.content)))
  })

  it('reads a source the person replaced from the properties panel as the one source', async () => {
    const note = await captured()
    window.__mockContent = { [PATH]: note.content }
    const edited = updateMockFrontmatter(PATH, 'source', 'https://harbour.example.org/canonical')
    expect(readers(edited).panel.source).toBe('https://harbour.example.org/canonical')
    expect(readers(edited).yaml.source).toBe('https://harbour.example.org/canonical')
    expect(edited.match(/^source:/gmu)).toHaveLength(1)
  })
})
