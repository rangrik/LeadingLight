import { describe, expect, it } from 'vitest'
import type { PassageSelector } from './commentaryContract'
import { projectMarkdownBody } from './passageProjection'
import {
  anchorObservedPassage, firstCodePoints, lastCodePoints, resolvePassage, selectorAt, selectorProblem, unanchoredSelector,
} from './passageSelector'

const SHA = 'c'.repeat(64)
const OTHER = 'd'.repeat(64)

describe('selectors', () => {
  it('keep exact text, 64 code points of context and the hint', () => {
    const body = `${'α'.repeat(70)} target ${'🧭'.repeat(70)}`
    const projection = projectMarkdownBody(body)
    const start = projection.text.indexOf('target')
    const selector = selectorAt(projection, start, start + 6, SHA)
    expect(selector).toEqual({
      projection: 'leadinglight-text-v1', exact: 'target', prefix: `${'α'.repeat(63)} `, suffix: ` ${'🧭'.repeat(63)}`,
      sourceBodySha256: SHA, start, end: start + 6,
    })
    expect(selectorProblem(selector as PassageSelector)).toBeNull()
  })

  it('are shorter only at the document edges', () => {
    const projection = projectMarkdownBody('target and more')
    expect(selectorAt(projection, 0, 6, SHA)).toMatchObject({ prefix: '', suffix: ' and more' })
  })

  it('refuse empty, blank, misaligned and split-surrogate ranges', () => {
    const projection = projectMarkdownBody('a 🧭 b')
    expect(selectorAt(projection, 1, 1, SHA)).toBeNull()
    expect(selectorAt(projection, 1, 2, SHA)).toBeNull()
    expect(selectorAt(projection, 2, 3, SHA)).toBeNull()
    expect(selectorAt(projection, 0, 99, SHA)).toBeNull()
    expect(selectorAt(projection, 2, 4, SHA)).toMatchObject({ exact: '🧭' })
  })

  it('can be a historical snapshot without a hint', () => {
    expect(unanchoredSelector({ before: 'x'.repeat(100), exact: 'seen', after: 'tail' }, SHA)).toMatchObject({
      exact: 'seen', prefix: 'x'.repeat(64), suffix: 'tail', start: null, end: null,
    })
    expect(unanchoredSelector({ before: '', exact: ' ', after: '' }, SHA)).toBeNull()
    expect(unanchoredSelector({ before: '', exact: 'a\uD800', after: '' }, SHA)).toBeNull()
  })

  it('cut context on code-point boundaries', () => {
    expect(lastCodePoints('a🧭b', 2)).toBe('🧭b')
    expect(firstCodePoints('a🧭b', 2)).toBe('a🧭')
  })
})

describe('anchoring what an editor observed', () => {
  const body = 'One cat sat.\n\nTwo cat sat.\n\nThree cats.'
  const projection = projectMarkdownBody(body)

  it('anchors directly when the editor shows the same text', () => {
    const start = projection.text.indexOf('Two cat')
    expect(anchorObservedPassage(projection, {
      before: projection.text.slice(0, start), exact: 'Two cat', after: projection.text.slice(start + 7),
    })).toEqual({ status: 'anchored', start, end: start + 7 })
  })

  it('uses surrounding agreement when the editor text differs elsewhere', () => {
    const start = projection.text.indexOf('cat sat.\nThree')
    expect(anchorObservedPassage(projection, { before: 'EXTRA One cat sat.\nTwo ', exact: 'cat sat.', after: '\nThree cats.' })).toEqual({ status: 'anchored', start, end: start + 8 })
  })

  it('refuses ties, missing text and empty selections', () => {
    expect(anchorObservedPassage(projection, { before: 'zzz', exact: 'cat', after: 'zzz' })).toEqual({ status: 'unanchored', reason: 'ambiguous' })
    expect(anchorObservedPassage(projection, { before: '', exact: 'dog', after: '' })).toEqual({ status: 'unanchored', reason: 'missing' })
    expect(anchorObservedPassage(projection, { before: '', exact: '', after: '' })).toEqual({ status: 'unanchored', reason: 'empty' })
  })
})

describe('resolving a saved passage', () => {
  const original = 'Intro.\n\nThe quick fox jumps.\n\nThe lazy dog.'
  const projection = projectMarkdownBody(original)
  const start = projection.text.indexOf('quick fox')
  const selector = selectorAt(projection, start, start + 9, SHA) as PassageSelector

  it('is exact on the same body', () => {
    expect(resolvePassage(projection, SHA, selector)).toEqual({ status: 'exact', start, end: start + 9 })
  })

  it('is possible after an edit elsewhere, never exact', () => {
    const changed = projectMarkdownBody(`New first line.\n\n${original}`)
    const at = changed.text.indexOf('quick fox')
    expect(resolvePassage(changed, OTHER, selector)).toEqual({ status: 'possible', start: at, end: at + 9 })
  })

  it('is possible when one side of the context still holds', () => {
    const changed = projectMarkdownBody(original.replace('jumps', 'leaps'))
    expect(resolvePassage(changed, OTHER, selector)).toMatchObject({ status: 'possible' })
  })

  it('is ambiguous when the captured context matches twice', () => {
    const changed = projectMarkdownBody(`${original}\n\n${original}`)
    expect(resolvePassage(changed, OTHER, selector)).toEqual({ status: 'ambiguous', count: 2 })
  })

  it('is changed when the text remains without its context, and missing when it is gone', () => {
    expect(resolvePassage(projectMarkdownBody('Somewhere quick fox appears.'), OTHER, selector)).toEqual({ status: 'changed' })
    expect(resolvePassage(projectMarkdownBody('Nothing here.'), OTHER, selector)).toEqual({ status: 'missing' })
  })

  it('does not trust a stale hint on a changed body', () => {
    const shifted = projectMarkdownBody(original.replace('Intro.', 'Intro!'))
    expect(resolvePassage(shifted, OTHER, selector)).toMatchObject({ status: 'possible' })
  })

  it('is invalid for an unknown projection or a malformed selector', () => {
    expect(resolvePassage(projection, SHA, { ...selector, projection: 'other' as 'leadinglight-text-v1' })).toEqual({ status: 'invalid' })
    expect(resolvePassage(projection, SHA, { ...selector, end: (selector.end ?? 0) + 1 })).toEqual({ status: 'invalid' })
    expect(resolvePassage({ ...projection, version: 'x' as 'leadinglight-text-v1' }, SHA, selector)).toEqual({ status: 'invalid' })
  })
})
