// Run-bound page handles. The dialog registers what a Fetch produced (or what Save link only
// keeps) under a fresh opaque token; the recipe layer only ever sees that token and four bounded
// values. A token resolves only while it is the dialog's current page: a new Fetch, an address
// edit or Stop invalidates it, and revoking the run closes the store for good.
import type { WebPageCapture } from '../extensions/extensionContract'
import { readWebPageCapture } from '../extensions/extensionWebPage'
import { isOpaqueToken } from '../proposals/proposalContract'
import { hostLabel } from './articleUrls'
import type { WebCaptureConversion, WebCaptureSource } from './webCaptureContract'

export type ConvertedCapture = Extract<WebCaptureConversion, { status: 'converted' }>

export type WebCapturePageEntry =
  | { readonly kind: 'article'; readonly conversion: ConvertedCapture }
  /** No article body: the address and, when one was read safely, the page's own title. */
  | { readonly kind: 'linkOnly'; readonly source: WebCaptureSource; readonly pageTitle: string | null }

export interface WebCapturePageStore {
  /** A fresh opaque token for `entry`; every earlier token stops resolving. */
  register(entry: WebCapturePageEntry): string
  resolve(token: string): WebCapturePageEntry | null
  invalidate(token: string): void
  /** Every token, now and later, resolves to nothing. */
  close(): void
}

/** The domain's `WebPageCapture`, the only page value the recipe layer accepts. */
export type WebPageCaptureValue = WebPageCapture

const defaultToken = () => `page-${crypto.randomUUID()}`

export function createWebCapturePageStore(newToken: () => string = defaultToken): WebCapturePageStore {
  let current: { token: string; entry: WebCapturePageEntry } | null = null
  let closed = false
  return {
    register(entry) {
      if (closed) throw new Error('The web capture run has ended')
      const token = newToken()
      if (!isOpaqueToken(token) || token === current?.token) throw new Error('Unusable page token')
      current = { token, entry }
      return token
    },
    resolve: token => (!closed && current?.token === token ? current.entry : null),
    invalidate(token) {
      if (current?.token === token) current = null
    },
    close() {
      closed = true
      current = null
    },
  }
}

export function entrySource(entry: WebCapturePageEntry): WebCaptureSource {
  return entry.kind === 'article' ? entry.conversion.source : entry.source
}

/** The page's own title, when it had a usable one. */
export function entryPageTitle(entry: WebCapturePageEntry): string | null {
  return entry.kind === 'article' ? entry.conversion.metadata.title : entry.pageTitle
}

/**
 * The four values the recipe may use, for the current token, checked by the domain's own reader.
 * `pageTitle` is the person's title (blank means the host name); `siteName` falls back to the host
 * name. Null when the title is not one bounded line.
 */
export function webPageCaptureValue(token: string, entry: WebCapturePageEntry, pageTitle: string): WebPageCaptureValue | null {
  const source = entrySource(entry)
  const host = hostLabel(source.sourceUrl)
  const siteName = entry.kind === 'article' ? entry.conversion.metadata.siteName : null
  const byline = entry.kind === 'article' ? entry.conversion.metadata.byline : null
  return readWebPageCapture({
    page: token,
    kind: entry.kind,
    pageTitle: pageTitle.trim() || host,
    pageUrl: source.sourceUrl,
    siteName: siteName ?? host,
    byline,
  })
}
