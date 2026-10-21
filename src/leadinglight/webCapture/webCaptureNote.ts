// The whole note a website command writes: W2's verified article (or link-only) note under the
// person's title, then the recipe's own blocks, as the host's encoder wrote them, after one blank
// line. Built and verified in the dialog before Save, because the controller's `prepare` must answer
// synchronously; `matchPreparedNote` is that answer, and only for exactly what was verified.
import { BlockNoteEditor } from '@blocknote/core'
import { resolveBlocksForTarget } from '../../hooks/editorBlockResolution'
import { clearParsedNoteBlockCache } from '../../hooks/editorParsedBlockCache'
import { PROPOSAL_LIMITS } from '../proposals/proposalContract'
import { summarizeEditorBlocks } from './articleBlocks'
import { clipUtf8, utf8Length } from './articleText'
import type { CreateVerifyEditor } from './articleVerify'
import type { CapturedNote, WebCaptureIntroParagraph, WebCaptureRefusal } from './webCaptureContract'
import type { WebCapturePageEntry } from './webCapturePageStore'
import { buildCapturedNote, buildLinkOnlyNote, type WebCaptureNoteResult } from './webCapturePipeline'

export type WebCaptureNoteRefusal = 'tooLarge' | 'unsafeText' | 'notExact' | 'invalidPage' | 'cancelled'

export type PreparedWebCaptureNote =
  | {
    readonly status: 'ready'
    /** The H1 as written: the composed title, or its fallback. */
    readonly title: string
    readonly fileName: string
    readonly content: string
    readonly contentBytes: number
    /** What was verified, compared by `matchPreparedNote`. */
    readonly composedTitle: string
    readonly packageParts: readonly string[]
  }
  | { readonly status: 'refused'; readonly reason: WebCaptureNoteRefusal }

export interface WebCaptureNoteRequest {
  readonly entry: WebCapturePageEntry
  /** The recipe's composed title; blank means the page title, then the host name. */
  readonly title: string
  /** The recipe's own blocks as Markdown (`packageBlocksMarkdown`), in order. */
  readonly packageParts: readonly string[]
  readonly intro?: readonly WebCaptureIntroParagraph[]
}

export interface WebCaptureNoteOptions {
  readonly signal?: AbortSignal
  readonly createVerifyEditor?: CreateVerifyEditor
}

const WHOLE_PATH = 'leadinglight-web-capture://whole.md'
const MD = '.md'
const REFUSALS: Readonly<Record<WebCaptureRefusal, WebCaptureNoteRefusal>> = {
  invalidInput: 'invalidPage', tooLarge: 'tooLarge', tooComplex: 'notExact', unreadable: 'notExact',
  unsafeText: 'unsafeText', notExact: 'notExact', cancelled: 'cancelled',
}

type OpenEditor = Parameters<typeof resolveBlocksForTarget>[0]['editor']

/** Opens `content` the way the editor opens a note, under a key no note can have, then forgets it. */
async function reopenSummary(content: string, createEditor: CreateVerifyEditor | undefined): Promise<string[]> {
  const editor = (createEditor?.() ?? BlockNoteEditor.create()) as unknown as OpenEditor
  clearParsedNoteBlockCache(WHOLE_PATH)
  try {
    const { blocks } = await resolveBlocksForTarget({ editor, cache: new Map(), content, targetPath: WHOLE_PATH })
    return summarizeEditorBlocks(blocks)
  } finally {
    clearParsedNoteBlockCache(WHOLE_PATH)
  }
}

/** The note bytes with the package parts after the page. */
function wholeContent(note: CapturedNote, packageParts: readonly string[]): string {
  if (packageParts.length === 0) return note.content
  return `${note.content.replace(/\n+$/u, '')}\n\n${packageParts.join('\n\n')}\n`
}

// Package blocks the host's literal encoder writes: plain text in these block kinds, no marks, links,
// wikilinks or math (a bare address the editor links by itself counts as plain text).
const PACKAGE_BLOCK_TYPES = new Set(['heading', 'paragraph', 'quote', 'bulletListItem', 'numberedListItem'])

function isLiteralEntry(entry: string): boolean {
  const parsed: unknown = JSON.parse(entry)
  if (!Array.isArray(parsed) || !PACKAGE_BLOCK_TYPES.has(parsed[1])) return false
  const runs: unknown = parsed[1] === 'heading' ? parsed[3] : parsed[2]
  return Array.isArray(runs) && runs.every(run => Array.isArray(run) && run[1] === '')
}

/**
 * Whether the whole note opens as the page alone followed by the package blocks alone, and the
 * package blocks are literal text: neither part changes how the other reads, in the parser the
 * whole note's size selects, and nothing of the recipe's becomes structure.
 */
async function opensAsParts(content: string, note: CapturedNote, packageParts: readonly string[], createEditor: CreateVerifyEditor | undefined): Promise<boolean> {
  // One after another: each open uses and clears the same cache key.
  const whole = await reopenSummary(content, createEditor)
  const page = await reopenSummary(note.content, createEditor)
  const ownBlocks = await reopenSummary(`# Package blocks\n\n${packageParts.join('\n\n')}\n`, createEditor)
  const own = ownBlocks.slice(1)
  if (!own.every(isLiteralEntry)) return false
  const expected = [...page, ...own]
  return whole.length === expected.length && whole.every((entry, index) => entry === expected[index])
}

function built(result: WebCaptureNoteResult): CapturedNote | WebCaptureNoteRefusal {
  return result.status === 'built' ? result.note : REFUSALS[result.reason]
}

/** Builds and verifies the whole note; every refusal means nothing may be written. */
export async function prepareWebCaptureNote(request: WebCaptureNoteRequest, options: WebCaptureNoteOptions = {}): Promise<PreparedWebCaptureNote> {
  const { entry, packageParts } = request
  const refused = (reason: WebCaptureNoteRefusal): PreparedWebCaptureNote => ({ status: 'refused', reason })
  if (options.signal?.aborted) return refused('cancelled')
  if (packageParts.some(part => typeof part !== 'string' || part.trim() === '')) return refused('invalidPage')
  const title = request.title.trim() === '' ? null : request.title
  const intro = request.intro ?? []
  const noteOptions = { signal: options.signal, createVerifyEditor: options.createVerifyEditor }
  const note = built(entry.kind === 'article'
    ? await buildCapturedNote(entry.conversion, { title, intro }, noteOptions)
    : await buildLinkOnlyNote({ source: entry.source, title, pageTitle: entry.pageTitle, intro }, noteOptions))
  if (typeof note === 'string') return refused(note)
  const content = wholeContent(note, packageParts)
  const contentBytes = utf8Length(content)
  if (contentBytes > PROPOSAL_LIMITS.contentBytes) return refused('tooLarge')
  if (options.signal?.aborted) return refused('cancelled')
  if (packageParts.length > 0 && !await opensAsParts(content, note, packageParts, options.createVerifyEditor)) return refused('notExact')
  return Object.freeze({
    status: 'ready', title: note.title, fileName: note.fileName, content, contentBytes,
    composedTitle: request.title, packageParts: Object.freeze([...packageParts]),
  })
}

function sameParts(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((part, index) => part === b[index])
}

function fileStem(fileName: string): string {
  return fileName.endsWith(MD) ? fileName.slice(0, -MD.length) : fileName
}

/** Whether `fileName` is the prepared name or one of its numbered copies (`name-2.md`). */
function isPreparedFileName(prepared: string, fileName: string): boolean {
  if (fileName === prepared) return true
  const match = /^(.*)-(\d{1,3})\.md$/u.exec(fileName)
  return match !== null && Number(match[2]) >= 2 && fileStem(prepared).startsWith(match[1])
}

/**
 * The host's synchronous `prepare`: the verified bytes when the composed title, the package parts
 * and the file name are still what was verified, else a refusal that writes nothing.
 */
export function matchPreparedNote(
  prepared: PreparedWebCaptureNote,
  expected: { readonly title: string; readonly packageParts: readonly string[]; readonly fileName: string },
): { readonly status: 'ready'; readonly content: string } | { readonly status: 'refused'; readonly reason: 'internal' } {
  const same = prepared.status === 'ready' && prepared.composedTitle === expected.title
    && sameParts(prepared.packageParts, expected.packageParts) && isPreparedFileName(prepared.fileName, expected.fileName)
  return same && prepared.status === 'ready' ? { status: 'ready', content: prepared.content } : { status: 'refused', reason: 'internal' }
}

/** The controller's not-written reason for a refused preparation. */
export function notWrittenReasonFor(refusal: WebCaptureNoteRefusal): 'tooLarge' | 'unsafeText' | 'unavailable' {
  if (refusal === 'tooLarge') return 'tooLarge'
  return refusal === 'unsafeText' ? 'unsafeText' : 'unavailable'
}

/**
 * `fileName` when it is free, else `name-2.md` up to `name-<limit>.md`, kept within the proposal's
 * file name limit; null when every candidate is taken. `taken` is the host's listing hint; native
 * still refuses any existing name.
 */
export function numberedFileName(fileName: string, taken: (candidate: string) => boolean, limit = 99): string | null {
  if (!taken(fileName)) return fileName
  const stem = fileStem(fileName)
  for (let number = 2; number <= limit; number += 1) {
    const suffix = `-${number}${MD}`
    const candidate = `${clipUtf8(stem, PROPOSAL_LIMITS.fileNameBytes - utf8Length(suffix)).replace(/-+$/u, '')}${suffix}`
    if (!taken(candidate)) return candidate
  }
  return null
}
