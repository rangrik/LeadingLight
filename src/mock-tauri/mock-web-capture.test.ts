import { afterEach, describe, expect, it, vi } from 'vitest'
import { WEB_CAPTURE_COMMANDS, createWebCaptureTransport } from '../leadinglight/webCapture/webCaptureTransport'
import * as helper from '../../tests/helpers/webCaptureFixture'
import {
  WEB_CAPTURE_FIXTURE_COMMANDS, WEB_CAPTURE_FIXTURE_FORMAT, WEB_CAPTURE_FIXTURE_KEY, WEB_CAPTURE_FIXTURE_ORIGIN, WebCaptureArgumentError, WebCaptureFixtureHost,
  browserWebCaptureHost, installPageWebCaptureHost, readWebCaptureFixture, webCaptureFixtureInstalled, type WebCaptureFixturePage,
} from './mock-web-capture'

const ORIGIN = 'https://fixtures.leadinglight.invalid'
const HTML = '<!doctype html><html><head><title>Lighthouse log</title></head><body><article><h1>Lighthouse log</h1><p>The keeper wrote.</p></article></body></html>'
const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`
const NOW = new Date(Date.UTC(2026, 9, 20, 14, 3, 11, 456))

const text = (pages: readonly WebCaptureFixturePage[], extra: Record<string, unknown> = {}) => JSON.stringify({ fixture: WEB_CAPTURE_FIXTURE_FORMAT, pages, ...extra })
function host(pages: readonly WebCaptureFixturePage[]) {
  const fixture = readWebCaptureFixture(text(pages))
  if (!fixture) throw new Error('fixture refused')
  return new WebCaptureFixtureHost(fixture, () => NOW)
}
const fetch = (target: WebCaptureFixtureHost, n: number, url: string) => target.handle(WEB_CAPTURE_FIXTURE_COMMANDS.fetch, { args: { attemptId: ID(n), url } })
const cancel = (target: WebCaptureFixtureHost, n: number) => target.handle(WEB_CAPTURE_FIXTURE_COMMANDS.cancel, { args: { attemptId: ID(n) } })

afterEach(() => {
  vi.useRealTimers()
  sessionStorage.clear()
  delete window.__leadinglightWebCaptureFixture
})

describe('the website fixture format', () => {
  it('names the transport commands exactly, and the test helper repeats its names', () => {
    expect(WEB_CAPTURE_FIXTURE_COMMANDS).toEqual(WEB_CAPTURE_COMMANDS)
    expect(helper.WEB_CAPTURE_FIXTURE_FORMAT).toBe(WEB_CAPTURE_FIXTURE_FORMAT)
    expect(helper.WEB_CAPTURE_FIXTURE_KEY).toBe(WEB_CAPTURE_FIXTURE_KEY)
    expect(helper.WEB_CAPTURE_FIXTURE_ORIGIN).toBe(WEB_CAPTURE_FIXTURE_ORIGIN)
  })

  it('accepts only pages under the reserved origin, each a page or a failure', () => {
    expect(readWebCaptureFixture(text([{ url: `${ORIGIN}/a`, html: HTML }, { url: `${ORIGIN}/b`, failure: 'notFound', delayMs: 50 }]))).not.toBeNull()
    for (const pages of [
      [{ url: 'https://example.org/a', html: HTML }],
      [{ url: `${ORIGIN}/a`, html: HTML, finalUrl: 'https://example.org/b' }],
      [{ url: `${ORIGIN}/a` }],
      [{ url: `${ORIGIN}/a`, html: HTML, failure: 'notFound' }],
      [{ url: `${ORIGIN}/a`, failure: 'madeUp' }],
      [{ url: `${ORIGIN}/a`, html: HTML, delayMs: 60_000 }],
      [{ url: `${ORIGIN}/a`, html: HTML, headers: {} }],
      [{ url: `${ORIGIN}/a`, html: HTML }, { url: `${ORIGIN}/a#again`, html: HTML }],
    ]) expect(readWebCaptureFixture(text(pages as WebCaptureFixturePage[]))).toBeNull()
    expect(readWebCaptureFixture(text([], { proxy: 'http://localhost' }))).toBeNull()
    expect(readWebCaptureFixture(JSON.stringify({ fixture: 'other/1', pages: [] }))).toBeNull()
    expect(readWebCaptureFixture('not json')).toBeNull()
  })
})

describe('the fixture fetch', () => {
  it('answers a fixture page as native does, without its fragment and with whole seconds', async () => {
    const target = host([{ url: `${ORIGIN}/lighthouse`, finalUrl: `${ORIGIN}/2026/lighthouse`, html: HTML }])
    expect(await fetch(target, 1, `${ORIGIN}/lighthouse#top`)).toEqual({
      status: 'fetched', attemptId: ID(1), requestedUrl: `${ORIGIN}/lighthouse`, finalUrl: `${ORIGIN}/2026/lighthouse`,
      fetchedAt: '2026-10-20T14:03:11Z', contentType: 'text/html', encoding: 'UTF-8', encodingSource: 'header', html: HTML, hadReplacements: false,
    })
    expect(target.requests()).toEqual([`${ORIGIN}/lighthouse#top`])
  })

  it('never reaches anything else: other hosts are unknown, bad addresses refused before any fetch', async () => {
    const target = host([{ url: `${ORIGIN}/gone`, failure: 'accessDenied' }])
    expect(await fetch(target, 1, 'https://example.org/')).toEqual({ status: 'failed', attemptId: ID(1), reason: 'dnsFailed' })
    expect(await fetch(target, 2, 'ftp://example.org/')).toEqual({ status: 'failed', attemptId: ID(2), reason: 'unsupportedScheme' })
    expect(await fetch(target, 3, `https://a:b@fixtures.leadinglight.invalid/`)).toEqual({ status: 'failed', attemptId: ID(3), reason: 'credentialsInUrl' })
    expect(await fetch(target, 4, 'not a url')).toEqual({ status: 'failed', attemptId: ID(4), reason: 'invalidUrl' })
    expect(await fetch(target, 5, `${ORIGIN}/missing`)).toEqual({ status: 'failed', attemptId: ID(5), reason: 'notFound' })
    expect(await fetch(target, 6, `${ORIGIN}/gone`)).toEqual({ status: 'failed', attemptId: ID(6), reason: 'accessDenied' })
  })

  it('reads its arguments strictly, as native does', async () => {
    const target = host([])
    for (const args of [
      undefined, {}, { args: { attemptId: ID(1) } }, { args: { attemptId: ID(1), url: `${ORIGIN}/`, headers: {} } },
      { args: { attemptId: 'ABC', url: `${ORIGIN}/` } }, { args: { attemptId: 'ABCDEF00-0000-4000-8000-000000000001', url: `${ORIGIN}/` } },
      { args: { attemptId: ID(1), url: 42 } }, { args: { attemptId: ID(1), url: `${ORIGIN}/` }, owner: 'other-window' },
    ]) await expect(target.handle(WEB_CAPTURE_FIXTURE_COMMANDS.fetch, args)).rejects.toBeInstanceOf(WebCaptureArgumentError)
    await expect(target.handle(WEB_CAPTURE_FIXTURE_COMMANDS.cancel, { args: { attemptId: ID(1), url: `${ORIGIN}/` } })).rejects.toBeInstanceOf(WebCaptureArgumentError)
    expect(target.requests()).toEqual([])
  })

  it('keeps one attempt: a new fetch supersedes the last, and cancel must name the live one', async () => {
    vi.useFakeTimers()
    const target = host([{ url: `${ORIGIN}/slow`, html: HTML, delayMs: 5_000 }])
    const first = fetch(target, 1, `${ORIGIN}/slow`)
    const second = fetch(target, 2, `${ORIGIN}/slow`)
    expect(await first).toEqual({ status: 'cancelled', attemptId: ID(1) })
    expect(await cancel(target, 1)).toEqual({ status: 'notActive', attemptId: ID(1) })
    expect(await cancel(target, 2)).toEqual({ status: 'cancelled', attemptId: ID(2) })
    expect(await second).toEqual({ status: 'cancelled', attemptId: ID(2) })
    const third = fetch(target, 3, `${ORIGIN}/slow`)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await third).toMatchObject({ status: 'fetched', attemptId: ID(3) })
    expect(await cancel(target, 3)).toEqual({ status: 'notActive', attemptId: ID(3) })
  })

  it('is read by the app transport exactly like native replies', async () => {
    const target = host([{ url: `${ORIGIN}/lighthouse`, html: HTML }])
    const transport = createWebCaptureTransport((command, args) => target.handle(command, args))
    expect(await transport.fetch(ID(1), `${ORIGIN}/lighthouse`)).toMatchObject({ status: 'fetched', attemptId: ID(1), html: HTML })
    expect(await transport.cancel(ID(1))).toEqual({ status: 'notActive', attemptId: ID(1) })
  })
})

describe('the page host', () => {
  const store = (value: string | null) => {
    if (value !== null) sessionStorage.setItem(WEB_CAPTURE_FIXTURE_KEY, value)
    return sessionStorage
  }

  it('exists only on the dev server, outside native, with a valid fixture a test installed', () => {
    const valid = text([{ url: `${ORIGIN}/a`, html: HTML }])
    expect(browserWebCaptureHost(true, false, store(null))).toBeNull()
    expect(browserWebCaptureHost(false, false, store(valid))).toBeNull()
    expect(browserWebCaptureHost(true, true, store(valid))).toBeNull()
    expect(window.__leadinglightWebCaptureFixture).toBeUndefined()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(browserWebCaptureHost(true, false, store('{"fixture":"leadinglight.web-capture-fixture/1","pages":[{"url":"https://example.org/"}]}'))).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
    expect(browserWebCaptureHost(true, false, store(valid))).toBeInstanceOf(WebCaptureFixtureHost)
    expect(window.__leadinglightWebCaptureFixture?.requests()).toEqual([])
  })
})

describe("the page's host", () => {
  it('is read once as the page loads, and native never has one', () => {
    sessionStorage.setItem(WEB_CAPTURE_FIXTURE_KEY, text([{ url: `${ORIGIN}/a`, html: HTML }]))
    expect(webCaptureFixtureInstalled()).toBe(false)
    expect(installPageWebCaptureHost(true)).toBeNull()
    expect(installPageWebCaptureHost(false)).toBeNull()
    expect(webCaptureFixtureInstalled()).toBe(false)
  })
})

