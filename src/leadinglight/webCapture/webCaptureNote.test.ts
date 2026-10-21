import { describe, expect, it } from 'vitest'
import { PROPOSAL_LIMITS } from '../proposals/proposalContract'
import { canonicalSave, convert, fixture, flat, open, textOf } from './webCapture.test-utils'
import { findSavedCopies, savedSourceEntries } from './webCaptureDuplicates'
import { matchPreparedNote, notWrittenReasonFor, numberedFileName, prepareWebCaptureNote } from './webCaptureNote'
import { createWebCapturePageStore, webPageCaptureValue, type WebCapturePageEntry } from './webCapturePageStore'
import { captureSource } from './webCapturePipeline'

const URL = 'https://harbour.example.org/2026/10/lighthouse-log'
// What the host's literal encoder writes for a recipe's "My notes" heading and answer.
const PARTS = ['## My notes', 'Wanted this for the chapter on \\[rest\\].']

async function articleEntry(): Promise<WebCapturePageEntry> {
  return { kind: 'article', conversion: await convert(fixture('article'), {}, { requestedUrl: 'https://harbour.example.org/a', finalUrl: URL }) }
}

describe('the whole note', () => {
  it('is the verified article under the composed title, then the recipe blocks, reopening exactly and saving unchanged', async () => {
    const prepared = await prepareWebCaptureNote({ entry: await articleEntry(), title: 'Lighthouse logs', packageParts: PARTS })
    if (prepared.status !== 'ready') throw new Error(prepared.reason)
    expect(prepared.title).toBe('Lighthouse logs')
    expect(prepared.fileName).toBe('lighthouse-logs.md')
    expect(prepared.content.endsWith('\n\n## My notes\n\nWanted this for the chapter on \\[rest\\].\n')).toBe(true)
    const blocks = flat(await open(prepared.content))
    expect(textOf(blocks[0].content)).toBe('Lighthouse logs')
    expect(blocks.slice(-2).map(block => [block.type, textOf(block.content)])).toEqual([['heading', 'My notes'], ['paragraph', 'Wanted this for the chapter on [rest].']])
    expect(blocks.filter(block => block.type === 'htmlBlock')).toEqual([])
    expect(await canonicalSave(prepared.content)).toBe(prepared.content)
    expect(prepared.contentBytes).toBeLessThanOrEqual(PROPOSAL_LIMITS.contentBytes)
  })

  it('falls back to the page title for a blank composed title', async () => {
    const prepared = await prepareWebCaptureNote({ entry: await articleEntry(), title: '  ', packageParts: [] })
    expect(prepared).toMatchObject({ status: 'ready', title: 'Keeping a Lighthouse Log', fileName: 'keeping-a-lighthouse-log.md' })
  })

  it('builds a link-only note with the host\'s notice and no article', async () => {
    const source = captureSource({ requestedUrl: 'https://pages.example.org/members', capturedAt: '2026-10-20T15:00:00Z' })!
    const prepared = await prepareWebCaptureNote({
      entry: { kind: 'linkOnly', source, pageTitle: 'Members area' }, title: '', packageParts: PARTS,
      intro: [[{ text: 'The page\'s text couldn\'t be saved from the website. Paste it here if you want it in this note.' }]],
    })
    if (prepared.status !== 'ready') throw new Error(prepared.reason)
    expect(prepared.content).toContain('kind: link')
    expect(flat(await open(prepared.content)).map(block => textOf(block.content))).toEqual([
      'Members area', 'The page\'s text couldn\'t be saved from the website. Paste it here if you want it in this note.', 'My notes', 'Wanted this for the chapter on [rest].',
    ])
  })

  it('refuses recipe blocks that would change how the page or they themselves read', async () => {
    const entry = await articleEntry()
    // An unescaped fence would swallow everything after it; raw syntax is never what the host's encoder writes.
    for (const parts of [['```html', '<b>x</b>'], ['[[Private]] note'], ['$x$ and $y$'], ['**bold**'], ['  ']]) {
      expect((await prepareWebCaptureNote({ entry, title: 'T', packageParts: parts })).status).toBe('refused')
    }
  })

  it('refuses a note over the 1 MiB proposal limit instead of cutting it', async () => {
    const huge = Array.from({ length: 1100 }, () => 'x'.repeat(1000))
    expect(await prepareWebCaptureNote({ entry: await articleEntry(), title: 'T', packageParts: huge })).toEqual({ status: 'refused', reason: 'tooLarge' })
  })

  it('stops when the signal has aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await prepareWebCaptureNote({ entry: await articleEntry(), title: 'T', packageParts: [] }, { signal: controller.signal }))
      .toEqual({ status: 'refused', reason: 'cancelled' })
  })
})

describe('the synchronous prepare answer', () => {
  it('returns the verified bytes only for exactly what was verified', async () => {
    const prepared = await prepareWebCaptureNote({ entry: await articleEntry(), title: 'Lighthouse logs', packageParts: PARTS })
    if (prepared.status !== 'ready') throw new Error(prepared.reason)
    expect(matchPreparedNote(prepared, { title: 'Lighthouse logs', packageParts: PARTS, fileName: 'lighthouse-logs.md' })).toEqual({ status: 'ready', content: prepared.content })
    expect(matchPreparedNote(prepared, { title: 'Lighthouse logs', packageParts: PARTS, fileName: 'lighthouse-logs-2.md' }).status).toBe('ready')
    for (const changed of [
      { title: 'Lighthouse logs!', packageParts: PARTS, fileName: 'lighthouse-logs.md' },
      { title: 'Lighthouse logs', packageParts: [...PARTS, 'More.'], fileName: 'lighthouse-logs.md' },
      { title: 'Lighthouse logs', packageParts: PARTS, fileName: 'other.md' },
    ]) expect(matchPreparedNote(prepared, changed)).toEqual({ status: 'refused', reason: 'internal' })
    expect(matchPreparedNote({ status: 'refused', reason: 'notExact' }, { title: '', packageParts: [], fileName: 'x.md' }).status).toBe('refused')
    expect(notWrittenReasonFor('tooLarge')).toBe('tooLarge')
    expect(notWrittenReasonFor('notExact')).toBe('unavailable')
  })

  it('numbers another copy within the file name limit, and gives up past the limit', () => {
    const taken = new Set(['note.md', 'note-2.md'])
    expect(numberedFileName('fresh.md', name => taken.has(name))).toBe('fresh.md')
    expect(numberedFileName('note.md', name => taken.has(name))).toBe('note-3.md')
    expect(numberedFileName('note.md', () => true, 5)).toBeNull()
    const long = `${'a'.repeat(PROPOSAL_LIMITS.fileNameBytes - 3)}.md`
    expect(new TextEncoder().encode(numberedFileName(long, name => name === long)!).length).toBeLessThanOrEqual(PROPOSAL_LIMITS.fileNameBytes)
  })
})

describe('run-bound pages', () => {
  it('gives the recipe four bounded values and an opaque token that stops resolving when replaced or closed', async () => {
    const store = createWebCapturePageStore()
    const entry = await articleEntry()
    const token = store.register(entry)
    expect(webPageCaptureValue(token, entry, ' Lighthouse logs ')).toEqual({
      page: token, kind: 'article', pageTitle: 'Lighthouse logs', pageUrl: URL, siteName: 'Harbour Notes', byline: 'Ada Example',
    })
    expect(webPageCaptureValue(token, entry, '   ')?.pageTitle).toBe('harbour.example.org')
    // The domain's reader refuses a title that is not one bounded line.
    expect(webPageCaptureValue(token, entry, 'x'.repeat(1001))).toBeNull()
    const next = store.register(entry)
    expect(store.resolve(token)).toBeNull()
    expect(store.resolve(next)).toBe(entry)
    store.close()
    expect(store.resolve(next)).toBeNull()
  })
})

describe('saved copies', () => {
  const entries = savedSourceEntries([
    { path: '/v/Web/a.md', title: 'A', properties: { source: 'https://Harbour.Example.org/2026/10/lighthouse-log#top' } },
    { path: '/v/Web/b.md', title: 'B', properties: { source: ['https://harbour.example.org/2026/10/lighthouse-log'] } },
    { path: '/v/Web/c.md', title: 'C', properties: { source: 'https://harbour.example.org/other' } },
    { path: '/v/Web/d.md', title: 'D', properties: {} },
    { path: '/v/Web/e.md', title: 'E' },
  ])

  it('finds notes whose source is the page, after the capture\'s own normalization', () => {
    expect(findSavedCopies([URL, 'https://harbour.example.org/a'], entries, { listingComplete: true })).toEqual({
      status: 'complete', matches: [{ path: '/v/Web/a.md', title: 'A' }, { path: '/v/Web/b.md', title: 'B' }],
    })
    expect(findSavedCopies(['https://harbour.example.org/nothing'], entries, { listingComplete: true })).toEqual({ status: 'complete', matches: [] })
  })

  it('says incomplete when the listing is, or a bound stopped the scan', () => {
    expect(findSavedCopies([URL], entries, { listingComplete: false }).status).toBe('incomplete')
    expect(findSavedCopies([URL], entries, { listingComplete: true, maxEntries: 1 })).toEqual({ status: 'incomplete', matches: [{ path: '/v/Web/a.md', title: 'A' }] })
    expect(findSavedCopies([URL], entries, { listingComplete: true, maxMatches: 1 })).toEqual({ status: 'incomplete', matches: [{ path: '/v/Web/a.md', title: 'A' }] })
    expect(findSavedCopies(['not a url'], entries, { listingComplete: true })).toEqual({ status: 'complete', matches: [] })
  })
})
