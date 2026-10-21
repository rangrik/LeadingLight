// Website capture conversion: a fetched page in, a note's exact bytes or a fixed refusal out.
//
//   size and tag-count prechecks -> inert parse with the final URL as the only base
//   -> element and nesting limits -> Readability 0.6.0 -> DOMPurify -> block model -> minimal HTML
//   -> the editor's HTML parser (default schema) -> normalizer -> literal checks
//   -> frontmatter + title + article -> reopen check and canonical-save fixed point
//
// It runs on the main thread (DOMParser is not available in workers). Each stage is bounded by the
// limits checked before it, and between stages it yields to the event loop, then refuses as
// `cancelled` when the caller's signal aborted, or as `tooComplex` past the time budget.
import { extractArticle, assertDocumentWithinLimits, countRawStartTags, documentTitle, parseInertDocument } from './articleDocument'
import { articleNoteBlocks, parseArticleHtml, type BlockCounts, type NoteBlock } from './articleBlocks'
import { resolveTitle, settleCapturedNote, settledBlocksOf, usableTitle } from './articleMarkdown'
import { DEFAULT_MEDIA_LABELS, blocksHtml, canonicalArticle, sanitizeArticle, type WebCaptureMediaLabels } from './articleSanitize'
import { WebCaptureRefusalError, utf8Length } from './articleText'
import { normalizeCaptureUrl } from './articleUrls'
import { noteStartsWithBlocks, type CreateVerifyEditor, type VerifyCheckpoint } from './articleVerify'
import {
  WEB_CAPTURE_LIMITS, type CapturedNote, type CapturedPage, type WebCaptureArticleBody, type WebCaptureArticleMetadata,
  type WebCaptureConversion, type WebCaptureIntroParagraph, type WebCaptureRefusal, type WebCaptureRefused,
  type WebCaptureSource,
} from './webCaptureContract'

export type { WebCaptureMediaLabels } from './articleSanitize'
export type { CreateVerifyEditor } from './articleVerify'

export interface WebCaptureOptions {
  /** Aborting refuses the conversion as `cancelled` at the next stage boundary. */
  readonly signal?: AbortSignal
  /** Words for media links, from the host's locale. Default English. */
  readonly mediaLabels?: WebCaptureMediaLabels
  /** Host paragraphs placed after the title, such as a "Saved from" line. None by default. */
  readonly intro?: readonly WebCaptureIntroParagraph[]
  /** The editor the reopen check uses; the app may pass one built with its own schema. */
  readonly createVerifyEditor?: CreateVerifyEditor
  readonly timeBudgetMs?: number
  /** Monotonic milliseconds, for tests. Default `performance.now`. */
  readonly clock?: () => number
}

export type WebCaptureNoteResult = { readonly status: 'built'; readonly note: CapturedNote } | WebCaptureRefused

const RFC3339_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/u

/** UTC `YYYY-MM-DDTHH:MM:SSZ` for a valid RFC 3339 UTC time, or `null`. */
export function normalizeCapturedAt(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = RFC3339_UTC.exec(value)
  if (!match) return null
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number)
  const time = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (year < 1000 || time.getUTCMonth() !== month - 1 || time.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return null
  return `${match.slice(1, 4).join('-')}T${match.slice(4, 7).join(':')}Z`
}

/**
 * The retained address facts of a capture, also for a link-only note after a failed fetch (pass
 * the typed URL as both). `null` when a URL or the time is unusable.
 */
export function captureSource(input: { readonly requestedUrl: unknown; readonly finalUrl?: unknown; readonly capturedAt: unknown }): WebCaptureSource | null {
  const requestedUrl = normalizeCaptureUrl(input.requestedUrl)
  const sourceUrl = input.finalUrl === undefined ? requestedUrl : normalizeCaptureUrl(input.finalUrl)
  const capturedAt = normalizeCapturedAt(input.capturedAt)
  return requestedUrl && sourceUrl && capturedAt ? { sourceUrl, requestedUrl, capturedAt } : null
}

function refused(reason: WebCaptureRefusal, source: WebCaptureSource | null, title: string | null): WebCaptureRefused {
  return { status: 'refused', reason, source, title }
}

function refusalReason(error: unknown): WebCaptureRefusal {
  if (error instanceof WebCaptureRefusalError) return error.reason
  // A stack overflow means the page nests deeper than any stage can walk.
  return error instanceof RangeError ? 'tooComplex' : 'notExact'
}

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function createCheckpoint(options: WebCaptureOptions): { checkpoint: VerifyCheckpoint; elapsed: () => number } {
  const clock = options.clock ?? (() => performance.now())
  const started = clock()
  const budget = options.timeBudgetMs ?? WEB_CAPTURE_LIMITS.timeBudgetMs
  return {
    elapsed: () => clock() - started,
    checkpoint: async () => {
      await yieldToEventLoop()
      if (options.signal?.aborted) throw new WebCaptureRefusalError('cancelled')
      if (clock() - started > budget) throw new WebCaptureRefusalError('tooComplex')
    },
  }
}

function emptyCounts(): BlockCounts {
  return { droppedLinks: 0, splitCodeBlocks: 0, degradedTables: 0, plainBlocks: 0 }
}

const ARTICLE_BODIES = new WeakMap<WebCaptureArticleBody, readonly NoteBlock[]>()

function articleBody(blocks: readonly NoteBlock[]): WebCaptureArticleBody {
  const body: WebCaptureArticleBody = Object.freeze({ kind: 'webCaptureArticle' })
  ARTICLE_BODIES.set(body, structuredClone(blocks))
  return body
}

/** Without a page title, an article that opens with a heading takes that heading as its title. */
function titleFromLeadingHeading(title: string | null, article: NoteBlock[]): { title: string | null; article: NoteBlock[] } {
  const first = article[0]
  if (title || first?.type !== 'heading') return { title, article }
  const heading = usableTitle(first.runs.map(run => run.text).join(''))
  return heading ? { title: heading, article: article.slice(1) } : { title, article }
}

/** Converts a fetched page. Never throws for page content; every failure is a refusal. */
export async function convertWebCapture(page: CapturedPage, options: WebCaptureOptions = {}): Promise<WebCaptureConversion> {
  const source = captureSource({ requestedUrl: page.requestedUrl, finalUrl: page.finalUrl, capturedAt: page.fetchedAt })
  if (!source || typeof page.html !== 'string') return refused('invalidInput', source, null)
  const { checkpoint, elapsed } = createCheckpoint(options)
  const timed = <T>(work: () => T): [T, number] => {
    const start = elapsed()
    const value = work()
    return [value, elapsed() - start]
  }
  let pageTitle: string | null = null
  try {
    if (utf8Length(page.html) > WEB_CAPTURE_LIMITS.htmlBytes) throw new WebCaptureRefusalError('tooLarge')
    if (countRawStartTags(page.html) > WEB_CAPTURE_LIMITS.rawStartTags) throw new WebCaptureRefusalError('tooComplex')
    await checkpoint()

    const [doc, parseMs] = timed(() => {
      const parsed = parseInertDocument(page.html, source.sourceUrl)
      assertDocumentWithinLimits(parsed)
      pageTitle = documentTitle(parsed)
      return parsed
    })
    await checkpoint()

    const [extracted, extractMs] = timed(() => extractArticle(doc))
    pageTitle = extracted.title ?? pageTitle
    await checkpoint()

    const [canonical, sanitizeMs] = timed(() => canonicalArticle(sanitizeArticle(extracted.content), source.sourceUrl, options.mediaLabels ?? DEFAULT_MEDIA_LABELS))
    await checkpoint()

    const counts = emptyCounts()
    const [parsed, blocksMs] = timed(() => articleNoteBlocks(parseArticleHtml(blocksHtml(canonical.blocks)), counts))
    const { title: pageHeading, article } = titleFromLeadingHeading(extracted.title, parsed)
    if (article.length === 0) throw new WebCaptureRefusalError('unreadable')

    const metadata: WebCaptureArticleMetadata = {
      title: pageHeading, byline: extracted.byline, siteName: extracted.siteName, published: extracted.published, lang: extracted.lang,
    }
    const title = resolveTitle(null, pageHeading, source.sourceUrl)
    const verifyStart = elapsed()
    const note = await settleCapturedNote({
      source, metadata, kind: 'article', title, intro: options.intro ?? [], article, counts,
      createEditor: options.createVerifyEditor, checkpoint,
    })
    const verifyMs = elapsed() - verifyStart
    return {
      status: 'converted',
      source,
      metadata,
      note,
      adjustments: {
        mediaLinks: canonical.counts.mediaLinks,
        droppedLinks: canonical.counts.droppedLinks + counts.droppedLinks,
        degradedTables: canonical.counts.degradedTables + counts.degradedTables,
        splitCodeBlocks: counts.splitCodeBlocks,
        plainBlocks: counts.plainBlocks,
        removedControlCharacters: canonical.counts.removedControlCharacters,
        titleShortened: extracted.titleShortened && title === extracted.title,
      },
      timings: { parseMs, extractMs, sanitizeMs, blocksMs, verifyMs, totalMs: elapsed() },
      article: articleBody(article),
    }
  } catch (error) {
    return refused(refusalReason(error), source, pageTitle)
  }
}

/**
 * Rebuilds a converted note with the person's title (blank falls back to the host name) and host
 * paragraphs, through the same checks. The conversion's article is not changed.
 */
export async function buildCapturedNote(
  conversion: Extract<WebCaptureConversion, { status: 'converted' }>,
  request: { readonly title?: string | null; readonly intro?: readonly WebCaptureIntroParagraph[] },
  options: WebCaptureOptions = {},
): Promise<WebCaptureNoteResult> {
  const stored = ARTICLE_BODIES.get(conversion.article)
  if (!stored) return refused('invalidInput', conversion.source, conversion.metadata.title)
  const { checkpoint } = createCheckpoint(options)
  try {
    const title = resolveTitle(request.title, conversion.metadata.title, conversion.source.sourceUrl)
    const note = await settleCapturedNote({
      source: conversion.source, metadata: conversion.metadata, kind: 'article', title, intro: request.intro ?? [],
      article: structuredClone(stored) as NoteBlock[], counts: emptyCounts(), createEditor: options.createVerifyEditor, checkpoint,
    })
    return { status: 'built', note }
  } catch (error) {
    return refused(refusalReason(error), conversion.source, conversion.metadata.title)
  }
}

/**
 * The link-only note offered after a refusal or a failed fetch: provenance, title and host
 * paragraphs (the caller's notice that the page text was not saved), and no article body.
 */
export async function buildLinkOnlyNote(
  request: { readonly source: WebCaptureSource; readonly title?: string | null; readonly pageTitle?: string | null; readonly intro?: readonly WebCaptureIntroParagraph[] },
  options: WebCaptureOptions = {},
): Promise<WebCaptureNoteResult> {
  const { checkpoint } = createCheckpoint(options)
  try {
    const title = resolveTitle(request.title, request.pageTitle ?? null, request.source.sourceUrl)
    const note = await settleCapturedNote({
      source: request.source, metadata: null, kind: 'link', title, intro: request.intro ?? [], article: [],
      counts: emptyCounts(), createEditor: options.createVerifyEditor, checkpoint,
    })
    return { status: 'built', note }
  } catch (error) {
    return refused(refusalReason(error), request.source, request.pageTitle ?? null)
  }
}

/**
 * For the bytes about to be written: whether `content` (the built note, possibly with the host's
 * own blocks appended after it) still opens with exactly the built title, host paragraphs and
 * article first. One reopen; call once at Save, not per keystroke.
 */
export async function noteOpensAsBuilt(
  content: string,
  built: CapturedNote,
  options: Pick<WebCaptureOptions, 'createVerifyEditor'> = {},
): Promise<boolean> {
  const blocks = settledBlocksOf(built)
  if (!blocks || !content.startsWith(built.frontmatter)) return false
  try {
    return await noteStartsWithBlocks(content, blocks, options.createVerifyEditor)
  } catch {
    return false
  }
}
