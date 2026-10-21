// The captured note's Markdown: frontmatter, the title as the only H1, optional host paragraphs,
// then the article, settled through the reopen check into the editor's canonical bytes.
import { fileNameForTitle } from '../extensions/extensionMarkdown'
import { assertBlocksLiteral, type BlockCounts, type NoteBlock, type NoteRun } from './articleBlocks'
import { buildFrontmatter, type CaptureKind } from './articleFrontmatter'
import { WebCaptureRefusalError, literalTextFailure, singleLine, utf8Length } from './articleText'
import { encodeLinkDestination, hostLabel } from './articleUrls'
import { settleNote, type CreateVerifyEditor, type VerifyCheckpoint } from './articleVerify'
import {
  WEB_CAPTURE_LIMITS, type CapturedNote, type WebCaptureArticleMetadata, type WebCaptureIntroParagraph,
  type WebCaptureSource,
} from './webCaptureContract'

/** A title the note can hold as written: single line, literal-safe, within `titleBytes`. */
export function usableTitle(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const title = singleLine(value)
  if (!title || utf8Length(title) > WEB_CAPTURE_LIMITS.titleBytes || literalTextFailure(title) !== null) return null
  return title
}

/**
 * The note title. Without a typed title, the page's title, else the host name. A typed title must
 * be usable as typed (`unsafeText` otherwise); a typed blank title means the host name.
 */
export function resolveTitle(typed: string | null | undefined, pageTitle: string | null, sourceUrl: string): string {
  if (typeof typed !== 'string') return usableTitle(pageTitle) ?? hostLabel(sourceUrl)
  if (typed.trim() === '') return hostLabel(sourceUrl)
  const title = usableTitle(typed)
  if (!title) throw new WebCaptureRefusalError('unsafeText')
  return title
}

function titleBlock(title: string): NoteBlock {
  return { type: 'heading', level: 1, runs: [{ text: title, styles: [], href: null }] }
}

/** Host paragraphs: literal single-line text, and labels linked only to the source URL. */
function introBlocks(intro: readonly WebCaptureIntroParagraph[], sourceUrl: string): NoteBlock[] {
  const href = encodeLinkDestination(sourceUrl)
  return intro.flatMap((paragraph) => {
    const runs = paragraph.map((run): NoteRun => ('sourceLink' in run
      ? { text: run.sourceLink.replace(/\s+/gu, ' '), styles: [], href }
      : { text: run.text.replace(/\s+/gu, ' '), styles: [], href: null }))
    const first = runs.at(0)
    const last = runs.at(-1)
    if (first) runs[0] = { ...first, text: first.text.trimStart() }
    if (last) runs[runs.length - 1] = { ...runs[runs.length - 1], text: runs[runs.length - 1].text.trimEnd() }
    const kept = runs.filter(run => run.text !== '')
    return kept.length > 0 ? [{ type: 'paragraph', runs: kept } as NoteBlock] : []
  })
}

function blocksTextBytes(blocks: readonly NoteBlock[]): number {
  return blocks.reduce((total, block) => {
    if (block.type === 'codeBlock') return total + utf8Length(block.code)
    if (block.type === 'table') return total + block.rows.flat(2).reduce((sum, run) => sum + utf8Length(run.text), 0)
    if (block.type === 'divider') return total
    const own = block.runs.reduce((sum, run) => sum + utf8Length(run.text), 0)
    return total + own + ('children' in block ? blocksTextBytes(block.children) : 0)
  }, 0)
}

export interface NoteRequest {
  readonly source: WebCaptureSource
  readonly metadata: WebCaptureArticleMetadata | null
  readonly kind: CaptureKind
  readonly title: string
  readonly intro: readonly WebCaptureIntroParagraph[]
  /** Settled in place when formatting must be lowered; pass a copy to keep the original. */
  readonly article: NoteBlock[]
  readonly counts: BlockCounts
  readonly createEditor?: CreateVerifyEditor
  readonly checkpoint: VerifyCheckpoint
}

const SETTLED_BLOCKS = new WeakMap<CapturedNote, readonly NoteBlock[]>()

/** The blocks a built note was settled from, title first; for the final check of written bytes. */
export function settledBlocksOf(note: CapturedNote): readonly NoteBlock[] | null {
  return SETTLED_BLOCKS.get(note) ?? null
}

/** Builds and settles the note; `tooLarge` past `noteBytes`, never truncated. */
export async function settleCapturedNote(request: NoteRequest): Promise<CapturedNote> {
  const { source, metadata, kind, title, intro, article, counts, createEditor, checkpoint } = request
  const frontmatter = buildFrontmatter(source, metadata, kind)
  const blocks = [titleBlock(title), ...introBlocks(intro, source.sourceUrl), ...article]
  assertBlocksLiteral(blocks)
  if (utf8Length(frontmatter) + blocksTextBytes(blocks) > WEB_CAPTURE_LIMITS.noteBytes) throw new WebCaptureRefusalError('tooLarge')
  const { body } = await settleNote({ frontmatter, blocks, title, counts, createEditor, checkpoint })
  const content = `${frontmatter}${body}`
  const contentBytes = utf8Length(content)
  if (contentBytes > WEB_CAPTURE_LIMITS.noteBytes) throw new WebCaptureRefusalError('tooLarge')
  const note: CapturedNote = Object.freeze({ title, fileName: fileNameForTitle(title), frontmatter, body, content, contentBytes })
  SETTLED_BLOCKS.set(note, structuredClone(blocks))
  return note
}
