// The browser's stand-in for the native page fetch (web-capture-native-integration-contract.md §1),
// only for a test that installed the synthetic fixture at page load on the dev server. It answers
// from the fixture's own pages under one reserved `.invalid` origin and never opens a connection:
// no proxy, no real site. Without the fixture the commands are not registered, so the dialog reads
// `unavailable`, as a build without native fetch must.
import {
  WEB_CAPTURE_CONTENT_TYPES, WEB_CAPTURE_FAILURE_REASONS, WEB_CAPTURE_LIMITS,
  type WebCaptureCancelReply, type WebCaptureContentType, type WebCaptureFailureReason, type WebCaptureFetchReply,
} from '../leadinglight/webCapture/webCaptureContract'

export const WEB_CAPTURE_FIXTURE_FORMAT = 'leadinglight.web-capture-fixture/1'
/** The test-written fixture; tests/helpers/webCaptureFixture.ts writes it once per tab. */
export const WEB_CAPTURE_FIXTURE_KEY = 'leadinglight.webCaptureFixture'
/** The only origin the fixture answers; any other address fails as an unknown host would. */
export const WEB_CAPTURE_FIXTURE_ORIGIN = 'https://fixtures.leadinglight.invalid'
export const WEB_CAPTURE_FIXTURE_LIMITS = { pages: 32, delayMs: 10_000, requests: 64 } as const
/** The transport's two commands (webCaptureTransport.ts), named here so the mock never imports the app's bridge. */
export const WEB_CAPTURE_FIXTURE_COMMANDS = { fetch: 'web_capture_fetch', cancel: 'web_capture_cancel' } as const

export interface WebCaptureFixturePage {
  readonly url: string
  /** Where redirects ended; the requested address when absent. */
  readonly finalUrl?: string
  readonly html?: string
  readonly contentType?: WebCaptureContentType
  readonly hadReplacements?: boolean
  /** A native failure instead of a page. */
  readonly failure?: WebCaptureFailureReason
  /** How long the answer takes, so a test can Stop it. */
  readonly delayMs?: number
}

export interface WebCaptureFixture {
  readonly fixture: typeof WEB_CAPTURE_FIXTURE_FORMAT
  readonly pages: readonly WebCaptureFixturePage[]
}

/** What a test reads back: every address the dialog asked for, in order. */
export interface WebCaptureFixtureControl {
  requests(): readonly string[]
}

declare global {
  interface Window { __leadinglightWebCaptureFixture?: WebCaptureFixtureControl }
}

type Fields = Record<string, unknown>
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value)
const hasOnly = (value: Fields, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key))
const hasExactly = (value: Fields, keys: readonly string[]) => hasOnly(value, keys) && keys.every(key => Object.hasOwn(value, key))
const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T => (values as readonly unknown[]).includes(value)
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const PAGE_KEYS = ['url', 'finalUrl', 'html', 'contentType', 'hadReplacements', 'failure', 'delayMs']

/** The address without its fragment, as native reports it; `null` when it does not parse. */
function withoutFragment(text: string): URL | null {
  try {
    const url = new URL(text)
    url.hash = ''
    return url
  } catch {
    return null
  }
}

const isFixtureAddress = (value: unknown): value is string =>
  typeof value === 'string' && withoutFragment(value)?.origin === WEB_CAPTURE_FIXTURE_ORIGIN

function readPage(value: unknown): WebCaptureFixturePage | null {
  if (!isFields(value) || !hasOnly(value, PAGE_KEYS) || !isFixtureAddress(value.url)) return null
  const { finalUrl, html, contentType, hadReplacements, failure, delayMs } = value
  if (finalUrl !== undefined && !isFixtureAddress(finalUrl)) return null
  if (contentType !== undefined && !oneOf(WEB_CAPTURE_CONTENT_TYPES, contentType)) return null
  if (hadReplacements !== undefined && typeof hadReplacements !== 'boolean') return null
  if (delayMs !== undefined && !(Number.isInteger(delayMs) && (delayMs as number) >= 0 && (delayMs as number) <= WEB_CAPTURE_FIXTURE_LIMITS.delayMs)) return null
  // Exactly one of a page and a failure.
  if (failure === undefined) {
    if (typeof html !== 'string' || new TextEncoder().encode(html).length > WEB_CAPTURE_LIMITS.htmlBytes) return null
  } else if (html !== undefined || !oneOf(WEB_CAPTURE_FAILURE_REASONS, failure)) {
    return null
  }
  return value as unknown as WebCaptureFixturePage
}

/** The fixture, or `null` when the text breaks any rule of the format. */
export function readWebCaptureFixture(text: string): WebCaptureFixture | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isFields(value) || !hasExactly(value, ['fixture', 'pages']) || value.fixture !== WEB_CAPTURE_FIXTURE_FORMAT) return null
  if (!Array.isArray(value.pages) || value.pages.length > WEB_CAPTURE_FIXTURE_LIMITS.pages) return null
  const pages = value.pages.map(readPage)
  if (pages.some(page => page === null)) return null
  const keys = pages.map(page => withoutFragment((page as WebCaptureFixturePage).url)?.href)
  if (new Set(keys).size !== keys.length) return null
  return { fixture: WEB_CAPTURE_FIXTURE_FORMAT, pages: pages as WebCaptureFixturePage[] }
}

/** Native's `Err`: unreadable arguments start nothing. */
export class WebCaptureArgumentError extends Error {}

function readArgs(value: unknown, keys: readonly string[]): Fields {
  const args = isFields(value) ? value.args : undefined
  if (!isFields(value) || !hasExactly(value, ['args']) || !isFields(args) || !hasExactly(args, keys)) {
    throw new WebCaptureArgumentError('The arguments could not be read.')
  }
  if (typeof args.attemptId !== 'string' || !CANONICAL_UUID.test(args.attemptId)) throw new WebCaptureArgumentError('The attempt id could not be read.')
  if (keys.includes('url') && typeof args.url !== 'string') throw new WebCaptureArgumentError('The address could not be read.')
  return args
}

const fetchedAt = (now: Date) => now.toISOString().replace(/\.\d{3}Z$/u, 'Z')

/** Native's address checks before any connection, then the fixture's host as the only reachable one. */
function failureBeforeFetch(text: string): WebCaptureFailureReason | null {
  const url = withoutFragment(text)
  if (!url) return 'invalidUrl'
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'unsupportedScheme'
  if (url.username || url.password) return 'credentialsInUrl'
  return url.origin === WEB_CAPTURE_FIXTURE_ORIGIN ? null : 'dnsFailed'
}

/**
 * One window's fetch, as native keeps it: one attempt at a time, a new fetch supersedes the last
 * (which answers `cancelled`), and cancel must name the live attempt.
 */
export class WebCaptureFixtureHost {
  private readonly pages: ReadonlyMap<string, WebCaptureFixturePage>
  private readonly now: () => Date
  private readonly requested: string[] = []
  private live: { attemptId: string; finish: (reply: WebCaptureFetchReply) => void } | null = null

  constructor(fixture: WebCaptureFixture, now: () => Date = () => new Date()) {
    this.pages = new Map(fixture.pages.map(page => [withoutFragment(page.url)?.href ?? page.url, page]))
    this.now = now
  }

  requests(): readonly string[] {
    return [...this.requested]
  }

  /** Unreadable arguments reject, as native's `Err`; every expected outcome is a reply. */
  async handle(command: string, args: unknown): Promise<WebCaptureFetchReply | WebCaptureCancelReply> {
    if (command === WEB_CAPTURE_FIXTURE_COMMANDS.fetch) {
      const { attemptId, url } = readArgs(args, ['attemptId', 'url'])
      return this.fetch(attemptId as string, url as string)
    }
    if (command === WEB_CAPTURE_FIXTURE_COMMANDS.cancel) return this.cancel(readArgs(args, ['attemptId']).attemptId as string)
    throw new WebCaptureArgumentError(`Unknown command ${command}.`)
  }

  private fetch(attemptId: string, text: string): Promise<WebCaptureFetchReply> {
    this.supersede()
    if (this.requested.length < WEB_CAPTURE_FIXTURE_LIMITS.requests) this.requested.push(text)
    const refused = failureBeforeFetch(text)
    if (refused) return Promise.resolve({ status: 'failed', attemptId, reason: refused })
    const requestedUrl = (withoutFragment(text) as URL).href
    const page = this.pages.get(requestedUrl)
    const reply: WebCaptureFetchReply = !page
      ? { status: 'failed', attemptId, reason: 'notFound' }
      : page.failure
        ? { status: 'failed', attemptId, reason: page.failure }
        : {
            status: 'fetched', attemptId, requestedUrl,
            finalUrl: withoutFragment(page.finalUrl ?? requestedUrl)?.href ?? requestedUrl,
            fetchedAt: fetchedAt(this.now()),
            contentType: page.contentType ?? 'text/html', encoding: 'UTF-8', encodingSource: 'header',
            html: page.html ?? '', hadReplacements: page.hadReplacements ?? false,
          }
    return new Promise(resolve => {
      // `timer` is read only once the answer comes, after it is set below.
      const finish = (answer: WebCaptureFetchReply) => {
        clearTimeout(timer)
        if (this.live?.attemptId === attemptId) this.live = null
        resolve(answer)
      }
      this.live = { attemptId, finish }
      const timer = setTimeout(() => finish(reply), page?.delayMs ?? 0)
    })
  }

  private supersede(): void {
    const live = this.live
    if (live) live.finish({ status: 'cancelled', attemptId: live.attemptId })
  }

  private cancel(attemptId: string): WebCaptureCancelReply {
    if (this.live?.attemptId !== attemptId) return { status: 'notActive', attemptId }
    this.supersede()
    return { status: 'cancelled', attemptId }
  }
}

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

/**
 * The page's fixture host: only when a test wrote the fixture and the page runs on the dev server
 * outside native; anything else has none. Read once: a fixture written later takes a reload.
 */
export function browserWebCaptureHost(
  dev: boolean = import.meta.env.DEV, native = false, storage: Storage | null = sessionStore(),
): WebCaptureFixtureHost | null {
  let text: string | null = null
  try {
    text = dev && !native && storage ? storage.getItem(WEB_CAPTURE_FIXTURE_KEY) : null
  } catch {
    text = null
  }
  if (text === null) return null
  const fixture = readWebCaptureFixture(text)
  if (!fixture) {
    console.warn(`[mock-tauri] The website fixture breaks a rule of ${WEB_CAPTURE_FIXTURE_FORMAT}, so website fetch is unavailable.`)
    return null
  }
  const host = new WebCaptureFixtureHost(fixture)
  if (typeof window !== 'undefined') window.__leadinglightWebCaptureFixture = { requests: () => host.requests() }
  return host
}

// The page's own host, installed once by mock-tauri/index.ts as the page loads.
let pageHost: WebCaptureFixtureHost | null | undefined

/** Reads the fixture for this page once; later calls answer the same host. */
export function installPageWebCaptureHost(native: boolean): WebCaptureFixtureHost | null {
  if (pageHost === undefined) pageHost = browserWebCaptureHost(import.meta.env.DEV, native)
  return pageHost
}

/** This page answers website fetches: the window may then offer `web.capture`, as the memory backend does. */
export const webCaptureFixtureInstalled = (): boolean => pageHost != null
