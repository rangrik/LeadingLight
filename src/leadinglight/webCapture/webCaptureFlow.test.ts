import { describe, expect, it, vi } from 'vitest'
import { CAPTURED_AT, fixture } from './webCapture.test-utils'
import type { WebCaptureConversion, WebCaptureFetched, WebCaptureFetchReply } from './webCaptureContract'
import { createWebCaptureFlow, failureFor, requestUrlFor, type WebCaptureFlowDeps } from './webCaptureFlow'
import type { WebCaptureFetchOutcome, WebCaptureTransport } from './webCaptureTransport'
import { convertWebCapture } from './webCapturePipeline'

interface Deferred<T> { promise: Promise<T>; resolve: (value: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

const ATTEMPTS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']

function fetched(attemptId: string, html = fixture('article'), finalUrl = 'https://harbour.example.org/2026/10/lighthouse-log'): WebCaptureFetched {
  return {
    status: 'fetched', attemptId, requestedUrl: 'https://harbour.example.org/a', finalUrl, fetchedAt: CAPTURED_AT,
    contentType: 'text/html', encoding: 'UTF-8', encodingSource: 'header', html, hadReplacements: false,
  }
}

function harness(overrides: Partial<WebCaptureFlowDeps> = {}) {
  const replies: Deferred<WebCaptureFetchOutcome>[] = []
  const transport: WebCaptureTransport = {
    fetch: vi.fn(async () => {
      const reply = deferred<WebCaptureFetchOutcome>()
      replies.push(reply)
      return reply.promise
    }),
    cancel: vi.fn(async (attemptId: string) => ({ status: 'cancelled' as const, attemptId })),
  }
  let attempt = 0
  const flow = createWebCaptureFlow({
    transport,
    newAttemptId: () => ATTEMPTS[attempt++],
    now: () => new Date(Date.UTC(2026, 9, 20, 15, 0, 0, 250)),
    ...overrides,
  })
  return { flow, transport, replies }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('addresses', () => {
  it('adds https to a bare name and refuses what is not a public web address', () => {
    expect(requestUrlFor(' harbour.example.org/a ')).toBe('https://harbour.example.org/a')
    expect(requestUrlFor('http://e.org/x#part')).toBe('http://e.org/x')
    for (const text of ['', '   ', 'javascript:alert(1)', 'mailto:a@b.org', 'ftp://e.org/', 'https://user:pw@e.org/', 'file:///etc/hosts']) {
      expect(requestUrlFor(text)).toBeNull()
    }
  })

  it('never contacts the network while the person types or pastes', () => {
    const { flow, transport } = harness()
    for (const text of ['h', 'harbour.example.org', 'https://harbour.example.org/a']) flow.setAddress(text)
    expect(flow.requestUrl()).toBe('https://harbour.example.org/a')
    expect(transport.fetch).not.toHaveBeenCalled()
    expect(flow.state()).toEqual({ step: 'address', stopped: false })
  })

  it('refuses an unusable address without a request and offers no link-only note', async () => {
    const { flow, transport } = harness()
    flow.setAddress('mailto:keeper@example.org')
    await flow.fetch()
    expect(flow.state()).toEqual({ step: 'failed', url: null, failure: 'unusableAddress', linkOnly: false, openInBrowser: false })
    expect(transport.fetch).not.toHaveBeenCalled()
  })
})

describe('one explicit fetch', () => {
  it('fetches once, converts, and registers the page under a fresh token', async () => {
    const { flow, transport, replies } = harness()
    flow.setAddress('harbour.example.org/a')
    const done = flow.fetch()
    expect(flow.state()).toEqual({ step: 'fetching', url: 'https://harbour.example.org/a', host: 'harbour.example.org' })
    expect(transport.fetch).toHaveBeenCalledWith(ATTEMPTS[0], 'https://harbour.example.org/a')
    replies[0].resolve(fetched(ATTEMPTS[0]))
    await done
    const state = flow.state()
    expect(state.step).toBe('ready')
    if (state.step !== 'ready') return
    expect(state.entry.kind).toBe('article')
    expect(state.requestedUrl).toBe('https://harbour.example.org/a')
    expect(flow.address()).toBe('https://harbour.example.org/2026/10/lighthouse-log')
    expect(flow.store.resolve(state.token)).toBe(state.entry)
    expect(transport.fetch).toHaveBeenCalledTimes(1)
  })

  it('ignores a second Fetch while one is running', async () => {
    const { flow, transport } = harness()
    flow.setAddress('e.org')
    void flow.fetch()
    await flow.fetch()
    expect(transport.fetch).toHaveBeenCalledTimes(1)
  })
})

describe('stale work never lands', () => {
  it('Stop while fetching cancels that attempt, and its late page is dropped', async () => {
    const { flow, transport, replies } = harness()
    const register = vi.spyOn(flow.store, 'register')
    flow.setAddress('e.org/a')
    const done = flow.fetch()
    flow.stop()
    expect(transport.cancel).toHaveBeenCalledWith(ATTEMPTS[0])
    expect(flow.state()).toEqual({ step: 'address', stopped: true })
    replies[0].resolve(fetched(ATTEMPTS[0]))
    await done
    await tick()
    expect(flow.state()).toEqual({ step: 'address', stopped: true })
    expect(register).not.toHaveBeenCalled()
  })

  it('Stop while preparing aborts the conversion, and its late result is dropped', async () => {
    const conversion = deferred<WebCaptureConversion>()
    let signal: AbortSignal | undefined
    const convert = vi.fn(async (_page: unknown, options?: { signal?: AbortSignal }) => {
      signal = options?.signal
      return conversion.promise
    }) as unknown as typeof convertWebCapture
    const { flow, replies } = harness({ convert })
    flow.setAddress('e.org/a')
    const done = flow.fetch()
    replies[0].resolve(fetched(ATTEMPTS[0]))
    await tick()
    expect(flow.state().step).toBe('preparing')
    flow.stop()
    expect(signal?.aborted).toBe(true)
    conversion.resolve(await convertWebCapture(fetched(ATTEMPTS[0])))
    await done
    expect(flow.state()).toEqual({ step: 'address', stopped: true })
  })

  it('an address edit while fetching retires the attempt; a new Fetch uses a new attempt', async () => {
    const { flow, transport, replies } = harness()
    flow.setAddress('e.org/a')
    const first = flow.fetch()
    flow.setAddress('e.org/b')
    expect(transport.cancel).toHaveBeenCalledWith(ATTEMPTS[0])
    expect(flow.state()).toEqual({ step: 'address', stopped: false })
    const second = flow.fetch()
    replies[0].resolve(fetched(ATTEMPTS[0], fixture('article'), 'https://e.org/late'))
    await first
    expect(flow.state().step).toBe('fetching')
    replies[1].resolve({ status: 'failed', attemptId: ATTEMPTS[1], reason: 'notFound' })
    await second
    expect(flow.state()).toMatchObject({ step: 'failed', url: 'https://e.org/b', failure: 'notFound' })
  })

  it('an edit or a new Fetch invalidates the page token the recipe holds', async () => {
    const { flow, replies } = harness()
    flow.setAddress('e.org/a')
    const done = flow.fetch()
    replies[0].resolve(fetched(ATTEMPTS[0]))
    await done
    const state = flow.state()
    if (state.step !== 'ready') throw new Error('not ready')
    flow.setAddress('e.org/a2')
    expect(flow.store.resolve(state.token)).toBeNull()
    expect(flow.state()).toEqual({ step: 'address', stopped: false })
  })

  it('revoking cancels work, closes every token and ignores everything after', async () => {
    const { flow, transport, replies } = harness()
    flow.setAddress('e.org/a')
    const done = flow.fetch()
    flow.revoke()
    expect(transport.cancel).toHaveBeenCalledWith(ATTEMPTS[0])
    replies[0].resolve(fetched(ATTEMPTS[0]))
    await done
    expect(flow.state()).toEqual({ step: 'revoked' })
    flow.setAddress('e.org/b')
    await flow.fetch()
    expect(transport.fetch).toHaveBeenCalledTimes(1)
    expect(() => flow.store.register({ kind: 'linkOnly', source: { sourceUrl: 'https://e.org/', requestedUrl: 'https://e.org/', capturedAt: CAPTURED_AT }, pageTitle: null })).toThrow()
  })
})

describe('failures', () => {
  async function failWith(reply: WebCaptureFetchReply | { status: 'unavailable' }) {
    const { flow, replies } = harness()
    flow.setAddress('pages.example.org/members')
    const done = flow.fetch()
    replies[0].resolve(reply)
    await done
    return flow
  }

  it.each([
    ['notPublicAddress', 'refusedAddress', false, false],
    ['insecureRedirect', 'redirectRefused', false, false],
    ['notFound', 'notFound', false, false],
    ['accessDenied', 'accessDenied', true, true],
    ['rateLimited', 'rateLimited', true, false],
    ['tlsFailed', 'tlsFailed', true, false],
    ['timedOut', 'unreachable', true, false],
    ['notHtml', 'notHtml', true, false],
    ['compressedResponse', 'unsupportedPage', true, false],
    ['tooLarge', 'tooLargeOrComplex', true, false],
  ] as const)('%s is shown as %s, link-only %s, browser %s', async (reason, failure, linkOnly, openInBrowser) => {
    const flow = await failWith({ status: 'failed', attemptId: ATTEMPTS[0], reason })
    expect(flow.state()).toEqual({ step: 'failed', url: 'https://pages.example.org/members', failure, linkOnly, openInBrowser })
  })

  it('a page with no readable article keeps its final address and title for a link-only note', async () => {
    const flow = await failWith(fetched(ATTEMPTS[0], fixture('sign-in'), 'https://pages.example.org/login?next=members'))
    expect(flow.state()).toMatchObject({ step: 'failed', failure: 'unreadable', linkOnly: true, openInBrowser: true })
    flow.saveLinkOnly()
    const state = flow.state()
    if (state.step !== 'ready') throw new Error('not ready')
    expect(state.entry).toEqual({ kind: 'linkOnly', pageTitle: 'Sign in to continue reading | Harbour Notes',
      source: { sourceUrl: 'https://pages.example.org/login?next=members', requestedUrl: 'https://harbour.example.org/a', capturedAt: CAPTURED_AT } })
  })

  it('without native fetching (the browser build) offers a link-only note for the typed address, timed now', async () => {
    const flow = await failWith({ status: 'unavailable' })
    expect(flow.state()).toMatchObject({ step: 'failed', failure: 'unavailable', linkOnly: true })
    flow.saveLinkOnly()
    expect(flow.state()).toMatchObject({ step: 'ready', requestedUrl: null, entry: { kind: 'linkOnly', pageTitle: null,
      source: { sourceUrl: 'https://pages.example.org/members', requestedUrl: 'https://pages.example.org/members', capturedAt: '2026-10-20T15:00:00Z' } } })
  })

  it('a native cancel (another attempt, a reload) returns to the address quietly', async () => {
    const flow = await failWith({ status: 'cancelled', attemptId: ATTEMPTS[0] })
    expect(flow.state()).toEqual({ step: 'address', stopped: true })
  })

  it('maps every W1 reason and every W2 refusal to a failure kind', () => {
    expect(failureFor('unsafeText')).toBe('tooLargeOrComplex')
    expect(failureFor('notExact')).toBe('tooLargeOrComplex')
    expect(failureFor('unsupportedCharset')).toBe('unsupportedPage')
  })
})
