import { describe, expect, it } from 'vitest'
import { brandCopy } from './brand'

describe('brandCopy', () => {
  it('uses the fork name for repeated display copy in any locale', () => {
    expect(brandCopy('Bienvenue dans Tolaria. Tolaria conserve vos notes.'))
      .toBe('Bienvenue dans LeadingLight. LeadingLight conserve vos notes.')
  })

  it('preserves lowercase internal identifiers and unrelated text', () => {
    expect(brandCopy('tolaria-overlay TOLARIA_API Settings')).toBe('tolaria-overlay TOLARIA_API Settings')
  })
})
