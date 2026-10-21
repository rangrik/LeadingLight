// Stage 1 of website capture: the fetched HTML becomes an inert document and Readability picks the
// article out of it. The document comes from `DOMParser`, so it has no browsing context: no script
// runs and no resource loads, and nothing here touches the app's own document. Every original
// `<base>` is removed and the captured final URL is the only base, so links resolve against the
// page that was actually fetched, never against the app.
import { Readability } from '@mozilla/readability'
import { WEB_CAPTURE_LIMITS } from './webCaptureContract'
import { WebCaptureRefusalError, clipUtf8, metadataText, singleLine, visibleLength } from './articleText'

const SHOW_ELEMENT = 0x1
const LANGUAGE_TOKEN = /^[a-z0-9][a-z0-9+#.-]{0,23}$/u
const LANGUAGE_CLASS_PREFIXES = ['language-', 'lang-', 'highlight-source-'] as const
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/u
const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u
const READABILITY_LIMIT_MESSAGE = 'Aborting parsing document'
// Readability's own default: below this, it retries with looser rules before giving its best try.
const READABILITY_CHAR_THRESHOLD = 500

/** Marks the code-language hint a `<pre>` carries; the sanitizer keeps only this class. */
export const CODE_LANGUAGE_CLASS_PREFIX = 'language-'
// Readability turns every H1 into an H2, which merges the page's two top heading levels. Marked
// H1s are turned back after it ran, and the converter then moves all headings below the title.
const TOP_HEADING_CLASS = 'leadinglight-capture-h1'

export interface ExtractedArticle {
  /** The article element, still inside the inert document. */
  readonly content: Element
  readonly textLength: number
  readonly title: string | null
  readonly titleShortened: boolean
  readonly byline: string | null
  readonly siteName: string | null
  readonly published: string | null
  readonly lang: string | null
}

/** Start tags in raw text, counted before parsing so a pathological page is refused cheaply. */
export function countRawStartTags(html: string): number {
  let count = 0
  for (let index = html.indexOf('<'); index !== -1; index = html.indexOf('<', index + 1)) {
    const next = html.charCodeAt(index + 1)
    if ((next >= 0x41 && next <= 0x5a) || (next >= 0x61 && next <= 0x7a)) count += 1
  }
  return count
}

/** Parses into a document with no browsing context, with the final URL as its only base. */
export function parseInertDocument(html: string, finalUrl: string): Document {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const base of Array.from(doc.querySelectorAll('base'))) base.remove()
  const base = doc.createElement('base')
  base.setAttribute('href', finalUrl)
  doc.head.prepend(base)
  return doc
}

/** Deepest element nesting under `root`, without recursion. */
export function elementDepth(root: Element): number {
  const walker = root.ownerDocument.createTreeWalker(root, SHOW_ELEMENT)
  let depth = 0
  let deepest = 0
  for (;;) {
    if (walker.firstChild()) {
      depth += 1
      if (depth > deepest) deepest = depth
      continue
    }
    while (!walker.nextSibling()) {
      if (!walker.parentNode() || walker.currentNode === root) return deepest
      depth -= 1
    }
  }
}

/** Refuses a document over the element or nesting limits before any heavier work. */
export function assertDocumentWithinLimits(doc: Document): void {
  if (doc.getElementsByTagName('*').length > WEB_CAPTURE_LIMITS.elements) throw new WebCaptureRefusalError('tooComplex')
  if (elementDepth(doc.documentElement) > WEB_CAPTURE_LIMITS.depth) throw new WebCaptureRefusalError('tooComplex')
}

/** The page's own `<title>`, safe for a link-only note, or `null`. */
export function documentTitle(doc: Document): string | null {
  return metadataText(clipUtf8(singleLine(doc.title), WEB_CAPTURE_LIMITS.titleBytes), WEB_CAPTURE_LIMITS.titleBytes)
}

function languageToken(value: string | null | undefined): string | null {
  const token = value?.trim().toLowerCase().replace(/;$/u, '') ?? ''
  return LANGUAGE_TOKEN.test(token) ? token : null
}

function classLanguage(element: Element | null): string | null {
  if (!element) return null
  const classes = Array.from(element.classList)
  for (const name of classes) {
    const lower = name.toLowerCase()
    const prefix = LANGUAGE_CLASS_PREFIXES.find(candidate => lower.startsWith(candidate))
    const token = prefix ? languageToken(lower.slice(prefix.length)) : null
    if (token) return token
  }
  // SyntaxHighlighter writes `brush: js;`, pandoc writes `sourceCode python`.
  const brush = classes.indexOf('brush:')
  if (brush !== -1) return languageToken(classes[brush + 1])
  if (classes.includes('sourceCode')) return languageToken(classes.find(name => name !== 'sourceCode'))
  return null
}

function attributeLanguage(element: Element | null): string | null {
  return languageToken(element?.getAttribute('data-lang')) ?? languageToken(element?.getAttribute('data-language'))
}

function preLanguage(pre: Element): string | null {
  const code = pre.querySelector('code')
  return attributeLanguage(pre) ?? attributeLanguage(code) ?? classLanguage(code) ?? classLanguage(pre)
    ?? classLanguage(pre.parentElement) ?? classLanguage(pre.parentElement?.parentElement ?? null)
}

/**
 * Rewrites each `<pre>` so its only class is `language-<token>` for a recognised hint, and returns
 * those classes for Readability to keep. The token is a hint only; the converter decides the label.
 */
export function markCodeLanguages(doc: Document): string[] {
  const preserved = new Set<string>()
  for (const pre of Array.from(doc.querySelectorAll('pre'))) {
    const token = preLanguage(pre)
    pre.removeAttribute('class')
    for (const code of Array.from(pre.querySelectorAll('[class]'))) code.removeAttribute('class')
    if (!token) continue
    const name = `${CODE_LANGUAGE_CLASS_PREFIX}${token}`
    pre.setAttribute('class', name)
    preserved.add(name)
  }
  return [...preserved]
}

/** `YYYY-MM-DD` from an ISO-8601 date or date-time, only for a real calendar date. */
export function publishedDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = ISO_DATE.exec(value.trim())
  if (!match) return null
  const [, year, month, day] = match.map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  const valid = year >= 1000 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  return valid ? match[0].slice(0, 10) : null
}

function languageTag(value: unknown): string | null {
  return typeof value === 'string' && LANGUAGE_TAG.test(value.trim()) ? value.trim() : null
}

function articleTitle(value: unknown): { title: string | null; shortened: boolean } {
  if (typeof value !== 'string') return { title: null, shortened: false }
  const full = singleLine(value)
  const clipped = clipUtf8(full, WEB_CAPTURE_LIMITS.titleBytes - 3)
  const shortened = clipped.length < full.length
  const title = metadataText(shortened ? `${clipped.trimEnd()}…` : full, WEB_CAPTURE_LIMITS.titleBytes)
  return { title, shortened: title !== null && shortened }
}

function markTopHeadings(doc: Document): void {
  for (const heading of Array.from(doc.querySelectorAll('h1'))) heading.classList.add(TOP_HEADING_CLASS)
}

/** Gives the marked headings their H1 back, inside the inert document, and drops the marker. */
function restoreTopHeadings(content: Element): void {
  for (const heading of Array.from(content.querySelectorAll(`.${TOP_HEADING_CLASS}`))) {
    heading.classList.remove(TOP_HEADING_CLASS)
    if (heading.tagName !== 'H2') continue
    const replacement = heading.ownerDocument.createElement('h1')
    replacement.append(...Array.from(heading.childNodes))
    heading.replaceWith(replacement)
  }
}

function runReadability(doc: Document, classesToPreserve: string[]) {
  const reader = new Readability<Node>(doc, {
    maxElemsToParse: WEB_CAPTURE_LIMITS.elements,
    charThreshold: READABILITY_CHAR_THRESHOLD,
    classesToPreserve,
    serializer: node => node,
  })
  try {
    return reader.parse()
  } catch (error) {
    if (error instanceof RangeError) throw new WebCaptureRefusalError('tooComplex')
    if (error instanceof Error && error.message.startsWith(READABILITY_LIMIT_MESSAGE)) throw new WebCaptureRefusalError('tooComplex')
    throw new WebCaptureRefusalError('unreadable')
  }
}

/**
 * Picks the article with Readability 0.6.0, which mutates `doc`. Refuses as `unreadable` when no
 * article is found, when its text is too short, or when a page with a password field yields only a
 * little text (a sign-in page): no body is ever fabricated from page chrome.
 */
export function extractArticle(doc: Document): ExtractedArticle {
  const hasPasswordField = doc.querySelector('input[type="password" i]') !== null
  const classesToPreserve = markCodeLanguages(doc)
  markTopHeadings(doc)
  const result = runReadability(doc, [...classesToPreserve, TOP_HEADING_CLASS])
  const content = result?.content
  if (!result || !content || content.nodeType !== 1) throw new WebCaptureRefusalError('unreadable')
  restoreTopHeadings(content as Element)
  const textLength = visibleLength(result.textContent ?? '')
  if (textLength < WEB_CAPTURE_LIMITS.minArticleChars) throw new WebCaptureRefusalError('unreadable')
  // Visible characters are a lower bound of the note's bytes, so this refuses before any heavy stage.
  if (textLength > WEB_CAPTURE_LIMITS.noteBytes) throw new WebCaptureRefusalError('tooLarge')
  if (hasPasswordField && textLength < WEB_CAPTURE_LIMITS.signInArticleChars) throw new WebCaptureRefusalError('unreadable')
  const { title, shortened } = articleTitle(result.title)
  return {
    content: content as Element,
    textLength,
    title,
    titleShortened: shortened,
    byline: metadataText(result.byline, WEB_CAPTURE_LIMITS.metadataBytes),
    siteName: metadataText(result.siteName, WEB_CAPTURE_LIMITS.metadataBytes),
    published: publishedDate(result.publishedTime),
    lang: languageTag(result.lang),
  }
}
