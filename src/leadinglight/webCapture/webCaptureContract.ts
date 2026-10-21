// Website capture: the native fetch wire mirrored from W1's frozen `web-capture-native-contract.md`
// (`src-tauri/src/leadinglight_web_capture/wire.rs` owns the declarations), plus the frozen shapes
// and limits of the conversion leaf in this folder. No DOM, editor or network code lives here.

// --- Native fetch wire (W1). Change only through a numbered amendment of the native contract. ---

export interface WebCaptureFetchArgs {
  /** Canonical lowercase hyphenated UUID. */
  readonly attemptId: string
  readonly url: string
}

export interface WebCaptureCancelArgs {
  readonly attemptId: string
}

export const WEB_CAPTURE_CONTENT_TYPES = ['text/html', 'application/xhtml+xml'] as const
export type WebCaptureContentType = (typeof WEB_CAPTURE_CONTENT_TYPES)[number]

export const WEB_CAPTURE_ENCODING_SOURCES = ['bom', 'header', 'meta', 'detected', 'fallback'] as const
export type WebCaptureEncodingSource = (typeof WEB_CAPTURE_ENCODING_SOURCES)[number]

export const WEB_CAPTURE_FAILURE_REASONS = [
  'invalidUrl',
  'unsupportedScheme',
  'credentialsInUrl',
  'notPublicAddress',
  'dnsFailed',
  'connectFailed',
  'tlsFailed',
  'timedOut',
  'networkError',
  'tooManyRedirects',
  'insecureRedirect',
  'invalidRedirect',
  'accessDenied',
  'notFound',
  'rateLimited',
  'serverError',
  'unexpectedStatus',
  'notHtml',
  'compressedResponse',
  'tooLarge',
  'unsupportedCharset',
] as const
export type WebCaptureFailureReason = (typeof WEB_CAPTURE_FAILURE_REASONS)[number]

export interface WebCaptureFetched {
  readonly status: 'fetched'
  readonly attemptId: string
  /** The request URL after parsing, fragment removed. */
  readonly requestedUrl: string
  /** The URL of the 200 response after redirects, fragment removed. */
  readonly finalUrl: string
  /** UTC RFC 3339, whole seconds: `2026-10-20T14:03:11Z`. */
  readonly fetchedAt: string
  readonly contentType: WebCaptureContentType
  /** WHATWG encoding name actually used, e.g. `UTF-8`. */
  readonly encoding: string
  readonly encodingSource: WebCaptureEncodingSource
  /** Decoded text, at most 5 MiB of UTF-8. */
  readonly html: string
  /** Some bytes were not valid in `encoding` and became U+FFFD. */
  readonly hadReplacements: boolean
}

export type WebCaptureFetchReply =
  | WebCaptureFetched
  | { readonly status: 'failed'; readonly attemptId: string; readonly reason: WebCaptureFailureReason }
  | { readonly status: 'cancelled'; readonly attemptId: string }

export type WebCaptureCancelReply =
  | { readonly status: 'cancelled'; readonly attemptId: string }
  | { readonly status: 'notActive'; readonly attemptId: string }

// --- Conversion leaf (W2) ---

/** What the conversion reads from a `fetched` reply. A `WebCaptureFetched` value satisfies it. */
export type CapturedPage = Pick<WebCaptureFetched, 'requestedUrl' | 'finalUrl' | 'fetchedAt' | 'html' | 'hadReplacements'>

export const WEB_CAPTURE_EXTRACTOR = 'readability-0.6.0'
export const WEB_CAPTURE_ARTICLE_CONVERTER = 'leadinglight-article-v1'
export const WEB_CAPTURE_LINK_CONVERTER = 'leadinglight-link-v1'
export const WEB_CAPTURE_PROVENANCE_VERSION = 1
/** The hidden frontmatter key holding provenance. `_` keys are system metadata in both readers. */
export const WEB_CAPTURE_PROVENANCE_KEY = '_leadinglight_capture'

/**
 * Every bound the conversion enforces. Inputs over a bound are refused, never truncated.
 * `timeBudgetMs` is checked between stages; each stage's own work is bounded by the size and
 * complexity limits that precede it, so no stage is an unbounded loop.
 */
export const WEB_CAPTURE_LIMITS = {
  /** UTF-8 bytes of the decoded page, as W1 already bounds it. */
  htmlBytes: 5 * 1024 * 1024,
  /** Start tags counted in the raw text before parsing. */
  rawStartTags: 150_000,
  /** Elements in the parsed page; also Readability's `maxElemsToParse`. */
  elements: 50_000,
  /** Element nesting in the parsed page. */
  depth: 400,
  /** Blocks in the converted article, nested blocks and table rows included. */
  blocks: 20_000,
  /** List and quote nesting kept in the note; deeper items join the deepest kept level. */
  listDepth: 8,
  /** UTF-8 bytes of the whole note (frontmatter, title and body). */
  noteBytes: 768 * 1024,
  /** UTF-8 bytes of the title; a longer title is cut at a character boundary and marked. */
  titleBytes: 1000,
  /** UTF-8 bytes of `author` and `site`; a longer value is left out rather than cut. */
  metadataBytes: 256,
  /** Characters of extracted text below which a page counts as unreadable. */
  minArticleChars: 140,
  /** Characters of article text below which a page with a password field counts as a sign-in page. */
  signInArticleChars: 1500,
  /** Wall-clock budget for one conversion, checked between stages. */
  timeBudgetMs: 15_000,
  /** Repair rounds of the reopen check before refusing. */
  verifyRounds: 4,
} as const

export const WEB_CAPTURE_REFUSALS = [
  'invalidInput',
  'tooLarge',
  'tooComplex',
  'unreadable',
  'unsafeText',
  'notExact',
  'cancelled',
] as const
/**
 * - `invalidInput`: a URL or timestamp in the input is not usable (never from page content).
 * - `tooLarge`: the page or the note would exceed a byte limit.
 * - `tooComplex`: element, nesting or block limits, or the time budget.
 * - `unreadable`: no article text, too little, script-only or a sign-in page.
 * - `unsafeText`: text holds an internal editor marker or other text the literal checks refuse.
 * - `notExact`: the note would not reopen in the editor as exactly the converted article.
 * - `cancelled`: the caller's signal aborted the conversion.
 */
export type WebCaptureRefusal = (typeof WEB_CAPTURE_REFUSALS)[number]

/** Suggested locale keys for W3; the conversion carries no user-facing copy itself. */
export const WEB_CAPTURE_REFUSAL_MESSAGE_KEYS: Readonly<Record<WebCaptureRefusal, string>> = {
  invalidInput: 'webCapture.refusal.invalidInput',
  tooLarge: 'webCapture.refusal.tooLargeOrComplex',
  tooComplex: 'webCapture.refusal.tooLargeOrComplex',
  unreadable: 'webCapture.refusal.unreadable',
  unsafeText: 'webCapture.refusal.tooLargeOrComplex',
  notExact: 'webCapture.refusal.tooLargeOrComplex',
  cancelled: 'webCapture.refusal.cancelled',
}

/** Page facts, each single-line, control-free and bounded. `null` when absent or unusable. */
export interface WebCaptureArticleMetadata {
  /** The page's title as extracted, or `null` when it had none usable. */
  readonly title: string | null
  readonly byline: string | null
  readonly siteName: string | null
  /** `YYYY-MM-DD`, only when the page gave an ISO-8601 date. */
  readonly published: string | null
  readonly lang: string | null
}

/** Where a capture came from. URLs are absolute http(s) without fragment or credentials. */
export interface WebCaptureSource {
  readonly sourceUrl: string
  readonly requestedUrl: string
  /** UTC, `YYYY-MM-DDTHH:MM:SSZ`. */
  readonly capturedAt: string
}

/**
 * What the conversion changed so that the note is exact and safe. Counts, never content.
 * `titleShortened`: the title was cut to `titleBytes`.
 */
export interface WebCaptureAdjustments {
  readonly mediaLinks: number
  readonly droppedLinks: number
  readonly degradedTables: number
  readonly splitCodeBlocks: number
  readonly plainBlocks: number
  readonly removedControlCharacters: number
  readonly titleShortened: boolean
}

export interface WebCaptureStageTimings {
  readonly parseMs: number
  readonly extractMs: number
  readonly sanitizeMs: number
  readonly blocksMs: number
  readonly verifyMs: number
  readonly totalMs: number
}

/** A run inside an optional host paragraph: literal text, or literal text linked to `sourceUrl`. */
export type WebCaptureIntroRun = { readonly text: string } | { readonly sourceLink: string }
export type WebCaptureIntroParagraph = readonly WebCaptureIntroRun[]

export interface CapturedNote {
  /** The H1 text. */
  readonly title: string
  /** One path segment from the existing title-to-filename rule, ending in `.md`. */
  readonly fileName: string
  /** `---\n…\n---\n`, ready to prefix the body. */
  readonly frontmatter: string
  /** `# Title\n\n…`, the bytes the editor's canonical save reproduces exactly. */
  readonly body: string
  /** `frontmatter + body`. */
  readonly content: string
  readonly contentBytes: number
}

export type WebCaptureConversion =
  | {
    readonly status: 'converted'
    readonly source: WebCaptureSource
    readonly metadata: WebCaptureArticleMetadata
    readonly note: CapturedNote
    readonly adjustments: WebCaptureAdjustments
    readonly timings: WebCaptureStageTimings
    /** Opaque, frozen; pass to `buildCapturedNote` to re-title or add host paragraphs. */
    readonly article: WebCaptureArticleBody
  }
  | WebCaptureRefused

export interface WebCaptureRefused {
  readonly status: 'refused'
  readonly reason: WebCaptureRefusal
  /** Retained for a link-only note; `null` only when the input URLs were unusable. */
  readonly source: WebCaptureSource | null
  /** The page title when one was read safely before the refusal, for a link-only note. */
  readonly title: string | null
}

/**
 * An opaque handle to the verified article blocks, held in memory by the conversion module so the
 * note can be re-titled without converting again. Not serializable; valid for this session only.
 */
export interface WebCaptureArticleBody {
  readonly kind: 'webCaptureArticle'
}
