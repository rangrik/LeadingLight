import { describe, expect, it } from 'vitest'
import type { VaultEntry } from '../types'
import { cueFor, duplicateCues, isGeneratedCapture, pageLabel } from './pageLabel'

const page = (path: string, extra: Partial<VaultEntry> = {}) => {
  const filename = path.split('/').pop() ?? path
  return { path, filename, title: 'Untitled Page 1797000000', snippet: '', titleSource: 'filename', ...extra } as VaultEntry
}

describe('pageLabel', () => {
  // Seam: generated New page files must never show their timestamp, and real titles must never be hidden.
  it.each([
    ['blank capture', page('/v/untitled-page-1797000000.md'), 'Untitled'],
    ['body capture', page('/v/untitled-page-1797000000.md', { snippet: 'first  thought\nhere' }), 'first thought here'],
    ['collision suffix', page('/v/untitled-page-1797000000-2.md', { snippet: 'second' }), 'second'],
    ['H1 wins', page('/v/untitled-page-1797000000.md', { title: 'Plan', titleSource: 'h1', snippet: 'old' }), 'Plan'],
    ['frontmatter title equal to the fallback stays', page('/v/untitled-page-1797000000.md', { titleSource: 'frontmatter', snippet: 'hello' }), 'Untitled Page 1797000000'],
    ['unknown source keeps the stored title', page('/v/untitled-page-1797000000.md', { titleSource: undefined, snippet: 'hello' }), 'Untitled Page 1797000000'],
    ['manual rename', page('/v/harbor.md', { title: 'Harbor', snippet: 'hello' }), 'Harbor'],
    ['contextual typed page', page('/v/untitled-note-1797000000.md', { title: 'Untitled Note 1797000000', snippet: 'hello' }), 'Untitled Note 1797000000'],
    ['lookalike user name', page('/v/my-untitled-page-1.md', { title: 'My Untitled Page 1', snippet: 'hello' }), 'My Untitled Page 1'],
  ])('%s', (_name, entry, expected) => {
    expect(pageLabel(entry, 'en')).toBe(expected)
  })

  it('keeps long previews short and plain', () => {
    const snippet = `${'é'.repeat(70)} ${'語'.repeat(30)}`
    const label = pageLabel(page('/v/untitled-page-1.md', { snippet }), 'en')
    expect(Array.from(label)).toHaveLength(81)
    expect(label.endsWith('…')).toBe(true)
    expect(isGeneratedCapture(page('/v/untitled-page-1.md'))).toBe(true)
  })
})

describe('duplicateCues', () => {
  it('gives same-label pages their relative path and leaves unique labels alone', () => {
    const lantern = page('/v/lantern.md', { title: 'Lantern', titleSource: 'h1' })
    const harborLantern = page('/v/harbor/lantern.md', { title: 'lantern', titleSource: 'h1' })
    const garden = page('/v/garden.md', { title: 'Garden', titleSource: 'h1' })
    const cues = duplicateCues([lantern, harborLantern, garden], '/v', 'en')
    expect(cueFor(cues, lantern)).toBe('lantern')
    expect(cueFor(cues, harborLantern)).toBe('harbor/lantern')
    expect(cueFor(cues, garden)).toBeUndefined()
  })
})
