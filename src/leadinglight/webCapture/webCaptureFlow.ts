// The website dialog's Fetch / Stop / convert machine, without React. Only `fetch()` contacts the
// network, and only through the injected transport; setting the address never does. Every Fetch,
// address edit, Stop and revoke advances a generation, and work started under an older generation
// can finish but never changes the state or registers a page. Stop and revoke also cancel the
// native attempt and abort the conversion.
import { useSyncExternalStore } from 'react'
import { hostLabel, normalizeCaptureUrl } from './articleUrls'
import type { WebCaptureFailureReason, WebCaptureRefusal, WebCaptureSource } from './webCaptureContract'
import { createWebCapturePageStore, type WebCapturePageEntry, type WebCapturePageStore } from './webCapturePageStore'
import { captureSource, convertWebCapture, type WebCaptureOptions } from './webCapturePipeline'
import type { WebCaptureTransport } from './webCaptureTransport'

export type WebCaptureFailure =
  | 'unusableAddress' | 'refusedAddress' | 'redirectRefused' | 'notFound' | 'accessDenied' | 'unreadable'
  | 'notHtml' | 'unsupportedPage' | 'tooLargeOrComplex' | 'rateLimited' | 'unreachable' | 'tlsFailed' | 'unavailable'

export type WebCaptureFlowState =
  | { readonly step: 'address'; readonly stopped: boolean }
  | { readonly step: 'fetching'; readonly url: string; readonly host: string }
  | { readonly step: 'preparing'; readonly url: string; readonly host: string }
  /** `requestedUrl`: what Fetch asked for, shown as "Was …" when a redirect moved the page. */
  | { readonly step: 'ready'; readonly token: string; readonly entry: WebCapturePageEntry; readonly requestedUrl: string | null }
  | { readonly step: 'failed'; readonly url: string | null; readonly failure: WebCaptureFailure; readonly linkOnly: boolean; readonly openInBrowser: boolean }
  | { readonly step: 'revoked' }

/** One immutable view per change, for `useSyncExternalStore`. */
export interface WebCaptureFlowSnapshot {
  readonly state: WebCaptureFlowState
  /** The address field's text; the final address once a fetched page is ready. */
  readonly address: string
}

export interface WebCaptureFlow {
  state(): WebCaptureFlowState
  snapshot(): WebCaptureFlowSnapshot
  subscribe(listener: () => void): () => void
  address(): string
  /** An edit invalidates the current page and cancels work in flight; it never fetches. */
  setAddress(text: string): void
  /** What Fetch would request: `https://` added to a bare name; null when unusable. */
  requestUrl(): string | null
  /** The one explicit request. */
  fetch(): Promise<void>
  stop(): void
  /** From a failure that offers it: keeps the address and title only. */
  saveLinkOnly(): void
  /** The run ended (workspace switched, recipe off or replaced, dialog closed): nothing more happens. */
  revoke(): void
  readonly store: WebCapturePageStore
}

export interface WebCaptureFlowDeps {
  readonly transport: WebCaptureTransport
  readonly convert?: typeof convertWebCapture
  /** A lowercase hyphenated UUID per attempt, as the native command requires. */
  readonly newAttemptId?: () => string
  /** The capture time of a link-only note after a failed fetch. */
  readonly now?: () => Date
  readonly convertOptions?: Pick<WebCaptureOptions, 'mediaLabels' | 'createVerifyEditor'>
  readonly store?: WebCapturePageStore
}

const FAILURES: Readonly<Record<WebCaptureFailureReason | Exclude<WebCaptureRefusal, 'cancelled'>, WebCaptureFailure>> = {
  invalidUrl: 'unusableAddress',
  unsupportedScheme: 'unusableAddress',
  credentialsInUrl: 'unusableAddress',
  notPublicAddress: 'refusedAddress',
  dnsFailed: 'unreachable',
  connectFailed: 'unreachable',
  tlsFailed: 'tlsFailed',
  timedOut: 'unreachable',
  networkError: 'unreachable',
  tooManyRedirects: 'redirectRefused',
  insecureRedirect: 'redirectRefused',
  invalidRedirect: 'redirectRefused',
  accessDenied: 'accessDenied',
  notFound: 'notFound',
  rateLimited: 'rateLimited',
  serverError: 'unreachable',
  unexpectedStatus: 'unreachable',
  notHtml: 'notHtml',
  compressedResponse: 'unsupportedPage',
  tooLarge: 'tooLargeOrComplex',
  unsupportedCharset: 'unsupportedPage',
  invalidInput: 'unsupportedPage',
  tooComplex: 'tooLargeOrComplex',
  unreadable: 'unreadable',
  unsafeText: 'tooLargeOrComplex',
  notExact: 'tooLargeOrComplex',
}

// Fable's table: no link-only note for an address that cannot or will not be fetched, or a page
// that does not exist; the browser only where reading it there is the next step.
const NO_LINK_ONLY = new Set<WebCaptureFailure>(['unusableAddress', 'refusedAddress', 'redirectRefused', 'notFound'])
const OPEN_IN_BROWSER = new Set<WebCaptureFailure>(['accessDenied', 'unreadable'])

export function failureFor(reason: WebCaptureFailureReason | Exclude<WebCaptureRefusal, 'cancelled'>): WebCaptureFailure {
  return FAILURES[reason]
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//iu

/** The address Fetch requests for what was typed: `https://` is added to a bare name. */
export function requestUrlFor(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  return normalizeCaptureUrl(HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`)
}

export function createWebCaptureFlow(deps: WebCaptureFlowDeps): WebCaptureFlow {
  const { transport } = deps
  const convert = deps.convert ?? convertWebCapture
  const newAttemptId = deps.newAttemptId ?? (() => crypto.randomUUID())
  const now = deps.now ?? (() => new Date())
  const store = deps.store ?? createWebCapturePageStore()
  const listeners = new Set<() => void>()

  let address = ''
  let state: WebCaptureFlowState = { step: 'address', stopped: false }
  let snapshot: WebCaptureFlowSnapshot = { state, address }
  let generation = 0
  let attemptId: string | null = null
  let conversion: AbortController | null = null
  let token: string | null = null
  let linkOffer: { source: WebCaptureSource; pageTitle: string | null } | null = null

  const publish = () => {
    snapshot = { state, address }
    for (const listener of listeners) listener()
  }
  const set = (next: WebCaptureFlowState) => {
    state = next
    publish()
  }
  const revoked = () => state.step === 'revoked'

  /** Ends whatever the current generation started, and drops its page. */
  function retire() {
    generation += 1
    if (attemptId) void transport.cancel(attemptId)
    attemptId = null
    conversion?.abort()
    conversion = null
    if (token) store.invalidate(token)
    token = null
    linkOffer = null
  }

  function fail(url: string | null, failure: WebCaptureFailure, offer: typeof linkOffer) {
    linkOffer = NO_LINK_ONLY.has(failure) ? null : offer
    set({ step: 'failed', url, failure, linkOnly: linkOffer !== null, openInBrowser: OPEN_IN_BROWSER.has(failure) })
  }

  function typedSource(url: string): typeof linkOffer {
    const source = captureSource({ requestedUrl: url, capturedAt: now().toISOString() })
    return source ? { source, pageTitle: null } : null
  }

  async function prepare(current: number, url: string, reply: Parameters<typeof convert>[0]) {
    const host = hostLabel(url)
    set({ step: 'preparing', url, host })
    const controller = new AbortController()
    conversion = controller
    const result = await convert(reply, { ...deps.convertOptions, signal: controller.signal })
    if (current !== generation || revoked()) return
    conversion = null
    if (result.status === 'converted') {
      token = store.register({ kind: 'article', conversion: result })
      // The field now shows the page that was saved; editing it starts over.
      address = result.source.sourceUrl
      set({ step: 'ready', token, entry: store.resolve(token)!, requestedUrl: url })
      return
    }
    if (result.reason === 'cancelled') {
      set({ step: 'address', stopped: true })
      return
    }
    fail(url, failureFor(result.reason), result.source ? { source: result.source, pageTitle: result.title } : typedSource(url))
  }

  async function fetchPage() {
    if (revoked() || state.step === 'fetching' || state.step === 'preparing') return
    const url = requestUrlFor(address)
    retire()
    if (!url) {
      fail(null, 'unusableAddress', null)
      return
    }
    const current = generation
    const id = newAttemptId()
    attemptId = id
    set({ step: 'fetching', url, host: hostLabel(url) })
    let reply: Awaited<ReturnType<WebCaptureTransport['fetch']>>
    try {
      reply = await transport.fetch(id, url)
    } catch {
      reply = { status: 'unavailable' }
    }
    if (current !== generation || revoked()) return
    attemptId = null
    switch (reply.status) {
      case 'fetched':
        return prepare(current, url, reply)
      case 'failed':
        return fail(url, failureFor(reply.reason), typedSource(url))
      case 'cancelled':
        // Native stopped it (a newer attempt in this window, or the page reloading).
        return set({ step: 'address', stopped: true })
      case 'unavailable':
        return fail(url, 'unavailable', typedSource(url))
    }
  }

  return {
    store,
    state: () => state,
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    address: () => address,
    setAddress(text) {
      if (revoked() || text === address) return
      address = text
      if (state.step === 'address' && !state.stopped) {
        publish()
        return
      }
      retire()
      set({ step: 'address', stopped: false })
    },
    requestUrl: () => requestUrlFor(address),
    fetch: fetchPage,
    stop() {
      if (state.step !== 'fetching' && state.step !== 'preparing') return
      retire()
      set({ step: 'address', stopped: true })
    },
    saveLinkOnly() {
      if (state.step !== 'failed' || !linkOffer) return
      const offer = linkOffer
      linkOffer = null
      token = store.register({ kind: 'linkOnly', source: offer.source, pageTitle: offer.pageTitle })
      set({ step: 'ready', token, entry: store.resolve(token)!, requestedUrl: null })
    },
    revoke() {
      if (revoked()) return
      retire()
      store.close()
      set({ step: 'revoked' })
    },
  }
}

/** The flow's state and address in a component, updated as they change. */
export function useWebCaptureFlow(flow: WebCaptureFlow): WebCaptureFlowSnapshot {
  return useSyncExternalStore(flow.subscribe, flow.snapshot)
}
