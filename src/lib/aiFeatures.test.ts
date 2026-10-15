import { describe, expect, it } from 'vitest'
import { areAiFeaturesEnabled } from './aiFeatures'

describe('areAiFeaturesEnabled', () => {
  it('keeps AI disabled regardless of stored preference', () => {
    expect(areAiFeaturesEnabled(undefined)).toBe(false)
    expect(areAiFeaturesEnabled({ ai_features_enabled: null })).toBe(false)
    expect(areAiFeaturesEnabled({ ai_features_enabled: true })).toBe(false)
    expect(areAiFeaturesEnabled({ ai_features_enabled: false })).toBe(false)
  })
})
