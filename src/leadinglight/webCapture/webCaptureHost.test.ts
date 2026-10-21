import { afterEach, describe, expect, it, vi } from 'vitest'
import { CAPABILITIES, E1_HOST_CAPABILITIES, E2_HOST_CAPABILITIES, type Capability } from '../extensions/extensionContract'
import { WEBSITE_FRONTEND_QUALIFIED, offersWebCapture, websiteHostCapabilities } from './webCaptureHost'

const BASES: readonly (readonly Capability[])[] = [E1_HOST_CAPABILITIES, E2_HOST_CAPABILITIES]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the window host list', () => {
  it('is qualified in this build, while the E1 and E2 lists stay exactly as they were', () => {
    expect(WEBSITE_FRONTEND_QUALIFIED).toBe(true)
    expect(E1_HOST_CAPABILITIES).toEqual(['document.create', 'document.open'])
    expect(E2_HOST_CAPABILITIES).toEqual(['selection.read', 'association.resolve', 'document.create', 'document.append', 'document.open'])
    expect(CAPABILITIES.at(-1)).toBe('web.capture')
  })

  it('offers web.capture in the qualified desktop window or a browser with the dev fixture, never an ordinary browser', () => {
    // [native, fixture installed, qualified] → offered
    const cases: Array<[boolean, boolean, boolean, boolean]> = [
      [true, false, true, true],
      [true, true, true, true],
      [true, false, false, false],
      // The fixture is a browser stand-in for the fetch, never access in the desktop window.
      [true, true, false, false],
      [false, true, true, true],
      [false, true, false, true],
      // The ordinary browser: no native fetch, no fixture.
      [false, false, true, false],
      [false, false, false, false],
    ]
    for (const [native, fixture, qualified, offered] of cases) {
      expect({ native, fixture, qualified, offered: offersWebCapture(native, fixture, qualified) }).toEqual({ native, fixture, qualified, offered })
    }
  })

  it('adds only web.capture, after the base list, and never grows anything else', () => {
    for (const base of BASES) {
      for (const native of [true, false]) {
        for (const fixture of [true, false]) {
          const host = websiteHostCapabilities(base, fixture, native)
          const offered = offersWebCapture(native, fixture)
          expect(host).toEqual(offered ? [...base, 'web.capture'] : base)
          if (!offered) expect(host).toBe(base)
        }
      }
      expect(base).not.toContain('web.capture')
    }
    const withWeb = websiteHostCapabilities(E2_HOST_CAPABILITIES, false, true)
    expect(websiteHostCapabilities(withWeb, false, true)).toBe(withWeb)
  })

  it('reads the window from the existing native check when the caller does not say, as App calls it', () => {
    expect(websiteHostCapabilities(E2_HOST_CAPABILITIES, false)).toBe(E2_HOST_CAPABILITIES)
    expect(websiteHostCapabilities(E2_HOST_CAPABILITIES)).toBe(E2_HOST_CAPABILITIES)
    expect(websiteHostCapabilities(E2_HOST_CAPABILITIES, true)).toEqual([...E2_HOST_CAPABILITIES, 'web.capture'])
    vi.stubGlobal('isTauri', true)
    expect(websiteHostCapabilities(E2_HOST_CAPABILITIES, false)).toEqual([...E2_HOST_CAPABILITIES, 'web.capture'])
    expect(websiteHostCapabilities(E1_HOST_CAPABILITIES)).toEqual(['document.create', 'document.open', 'web.capture'])
  })
})
