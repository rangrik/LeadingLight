// The pure seam between website recipes and the trusted host (contract: extensionContract.ts).
// The host fetches and converts a page in its own dialog, on the person's explicit Fetch; this module
// only checks what the host hands the recipe layer, and splits a composed document back into the
// host's page handle and the package's own blocks. It fetches nothing, converts nothing and writes
// no Markdown.
import { isOpaqueToken } from '../proposals/proposalContract'
import {
  EXTENSION_LIMITS, WEB_PAGE_KINDS,
  type ComposedDocument, type DocumentBlock, type WebPageCapture, type WebPageKind,
} from './extensionContract'
import { utf8Bytes } from './extensionSchema'

const KEYS = ['page', 'kind', 'pageTitle', 'pageUrl', 'siteName', 'byline'] as const
const URL_PROTOCOLS = new Set(['http:', 'https:'])

type Fields = Record<string, unknown>
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value)

/** C0 and C1 controls, line and paragraph separators, lone surrogates. */
function isLineBreaking(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) return true
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}

/** One visible line within the page text limit. */
function isPageLine(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !isLineBreaking(value) && utf8Bytes(value) <= EXTENSION_LIMITS.pageTextBytes
}

/** An absolute http(s) address without credentials or fragment, one line, within the limit. */
export function isWebPageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.includes('#') || /\s/u.test(value) || isLineBreaking(value)) return false
  if (utf8Bytes(value) > EXTENSION_LIMITS.pageUrlBytes) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return URL_PROTOCOLS.has(url.protocol) && url.hostname !== '' && url.username === '' && url.password === ''
}

/**
 * What the host hands the recipe layer for its current page, checked: exactly the six keys, an
 * opaque handle, a known kind and bounded single-line values. Returns a frozen copy, or null.
 * A passage capture or any other object is never a web page.
 */
export function readWebPageCapture(value: unknown): WebPageCapture | null {
  if (!isFields(value)) return null
  const keys = Object.keys(value)
  if (keys.length !== KEYS.length || !KEYS.every(key => Object.hasOwn(value, key))) return null
  const { page, kind, pageTitle, pageUrl, siteName, byline } = value
  if (!isOpaqueToken(page) || !(WEB_PAGE_KINDS as readonly unknown[]).includes(kind)) return null
  if (!isPageLine(pageTitle) || !isPageLine(siteName) || !(byline === null || isPageLine(byline)) || !isWebPageUrl(pageUrl)) return null
  return Object.freeze({ page, kind: kind as WebPageKind, pageTitle, pageUrl, siteName, byline })
}

/** What the host needs to write a composed website note. */
export interface WebArticleComposition {
  /** The run-bound handle to resolve to the converted page and its provenance. */
  readonly page: string
  /** The composed note title (the H1); blank only when the recipe's title was blank. */
  readonly title: string
  /** The package's own blocks, after the host's page, for `packageBlocksMarkdown`. */
  readonly blocks: readonly DocumentBlock[]
}

/**
 * The composed document as the host's page plus the package's blocks: exactly one leading
 * `webArticle` block with a valid handle, a title, and no other host block. Null for anything else,
 * which the host must refuse rather than write.
 */
export function webArticleComposition(document: ComposedDocument): WebArticleComposition | null {
  const [first, ...rest] = document.blocks
  if (first?.type !== 'webArticle' || !isOpaqueToken(first.page) || typeof document.title !== 'string') return null
  if (rest.some(block => block.type === 'webArticle' || block.type === 'source')) return null
  return { page: first.page, title: document.title, blocks: rest }
}
