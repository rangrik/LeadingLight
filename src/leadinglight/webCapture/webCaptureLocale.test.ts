import { describe, expect, it } from 'vitest'
import en from '../../lib/locales/en.json'
import { translator } from '../extensions/extensionUiText'
import type { WebCaptureFailure } from './webCaptureFlow'
import { webCaptureLabels, webCaptureMediaLabels } from './webCaptureLocale'

const FAILURES: readonly WebCaptureFailure[] = [
  'unusableAddress', 'refusedAddress', 'redirectRefused', 'notFound', 'accessDenied', 'unreadable',
  'notHtml', 'unsupportedPage', 'tooLargeOrComplex', 'rateLimited', 'unreachable', 'tlsFailed', 'unavailable',
]

/** Every string the labels give, functions called with sample values. */
function everyString(labels: Record<string, unknown>): string[] {
  return Object.entries(labels).flatMap(([key, value]) => {
    if (typeof value === 'string') return [value]
    if (typeof value !== 'function') return Object.values(value as Record<string, string>)
    if (key === 'savedBefore') return [value({ path: '/vault/Clippings/a.md', title: 'A' })]
    if (key === 'uncertain') return ['noReply', 'running', 'unknown'].map(detail => value(detail))
    if (key === 'revoked') return ['workspace', 'package'].map(reason => value(reason))
    return [value('x', 'y')]
  })
}

describe('website dialog words', () => {
  const t = translator('en')
  const labels = webCaptureLabels(t, path => (path.includes('/Clippings/') ? 'Clippings' : 'Workspace folder'))

  it('come from the locale, every one of them', () => {
    const values = new Set(Object.values(en as Record<string, string>))
    for (const text of everyString(labels as unknown as Record<string, unknown>)) {
      expect(text).not.toMatch(/leadinglight\./)
      expect(text.trim()).not.toBe('')
    }
    expect(values.has(labels.fetch)).toBe(true)
    expect(Object.keys(labels.failure).sort()).toEqual([...FAILURES].sort())
    expect(labels.failure.unavailable).toBe('Fetching web pages needs the LeadingLight desktop app.')
  })

  it('fill in their values', () => {
    expect(labels.fetching('example.org')).toBe('Fetching example.org…')
    expect(labels.savedBefore({ path: '/vault/Clippings/a.md', title: 'Lighthouse log' })).toBe('You saved this page before: Lighthouse log, in Clippings.')
    expect(labels.exists('lighthouse-log.md', 'Clippings')).toBe('A note named “lighthouse-log.md” already exists in Clippings. Change the title, then save again.')
    expect(labels.uncertain('running')).toBe(t('leadinglight.extensions.uncertainRunning'))
    expect(labels.revoked('package')).toBe(t('leadinglight.extensions.revokedPackage'))
  })

  it('say an unknown not-written reason as the general one', () => {
    expect(labels.notWritten('tooLarge')).toBe(t('leadinglight.extensions.notWritten.tooLarge'))
    expect(labels.notWritten('somethingNew')).toBe(t('leadinglight.extensions.notWritten.unavailable'))
  })

  it('name media links from the locale', () => {
    expect(webCaptureMediaLabels(t)).toEqual({ image: 'Image', video: 'Video', audio: 'Audio' })
  })

  it('include the capability and review sentence for web.capture', () => {
    expect(t('leadinglight.extensions.capability.web.capture')).toBe('fetching one web page you enter, only when you choose Fetch')
    expect(t('leadinglight.extensions.does.fetchPage')).toBe('Fetches one web page you enter, only when you choose Fetch.')
  })
})
