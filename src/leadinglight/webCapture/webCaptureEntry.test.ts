import { describe, expect, it } from 'vitest'
import type { CreatedPage } from '../extensions/extensionSessionController'
import { CAPTURED_AT, convert, fixture } from './webCapture.test-utils'
import { findSavedCopies, savedSourceEntries } from './webCaptureDuplicates'
import { webCaptureEntry } from './webCaptureEntry'
import { prepareWebCaptureNote } from './webCaptureNote'

const REQUESTED = 'https://harbour.example.org/a'
const FINAL = 'https://harbour.example.org/2026/10/lighthouse-log'

const created = (content: string, path = '/v/Web/lighthouse.md'): CreatedPage => ({ path, displayPath: path.slice(3), title: 'Lighthouse', content })
const found = (page: CreatedPage, urls: readonly string[]) =>
  findSavedCopies(urls, savedSourceEntries([webCaptureEntry(page)]), { listingComplete: true }).matches.map(match => match.path)

describe('the listing entry for a created page', () => {
  it('lists the exact note\'s properties, so its final address is found at once and its requested one is not', async () => {
    const conversion = await convert(fixture('article'), {}, { requestedUrl: REQUESTED, finalUrl: FINAL })
    const prepared = await prepareWebCaptureNote({ entry: { kind: 'article', conversion }, title: '', packageParts: [] })
    if (prepared.status !== 'ready') throw new Error(prepared.reason)
    const page = created(prepared.content, '/v/Web/keeping-a-lighthouse-log.md')
    const before = page.content
    const entry = webCaptureEntry(page)

    expect(entry.properties).toEqual({ source: FINAL, author: 'Ada Example', site: 'Harbour Notes', published: '2026-10-01', captured: CAPTURED_AT })
    expect(entry).toMatchObject({ path: page.path, filename: 'keeping-a-lighthouse-log.md', title: 'Keeping a Lighthouse Log', hasH1: true, titleSource: 'h1', isA: null, status: null })
    expect(page.content).toBe(before)
    expect(found(page, [FINAL])).toEqual([page.path])
    expect(found(page, [`${FINAL.replace('https://harbour', 'HTTPS://Harbour')}#top`])).toEqual([page.path])
    // Only `source` is an address; the hidden provenance record's redirect is not a second one.
    expect(prepared.content).toContain(`requested: "${REQUESTED}"`)
    expect(found(page, [REQUESTED])).toEqual([])
  })

  it('finds nothing in a source that is not one address in well-formed frontmatter', () => {
    const malformed = [
      '---\nsource: not a url\n---\n\n# Lighthouse\n',
      '---\nsource: "javascript:alert(1)"\n---\n\n# Lighthouse\n',
      `---\nsource:\n  - ${FINAL}\n  - ${REQUESTED}\n---\n\n# Lighthouse\n`,
      `---\nsource: "${FINAL}"\n\n# Lighthouse\n`,
      `# Lighthouse\n\nsource: ${FINAL}\n`,
      `---\n"source": ${FINAL}\n---\n\n# Lighthouse\n`,
      `---\n_leadinglight_capture:\n  source: "${FINAL}"\n---\n\n# Lighthouse\n`,
      '',
    ]
    for (const content of malformed) {
      expect(found(created(content), [FINAL, REQUESTED, 'not a url', 'javascript:alert(1)']), JSON.stringify(content)).toEqual([])
    }
    expect(webCaptureEntry(created(`---\nsource: "${FINAL}"\n\n# Lighthouse\n`)).properties).toEqual({})
    expect(webCaptureEntry(created('')).title).toBe('Lighthouse')
  })
})
