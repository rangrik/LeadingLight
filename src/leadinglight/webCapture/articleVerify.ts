// Stage 4 of website capture: the note is not trusted to be exact by construction. Its bytes are
// opened through the editor's real resolution path (the same code that opens a note, including the
// fast parser above 16 KiB and every post-parse injector), compared block by block with what was
// meant, and saved again with the editor's canonical serializer. A block that reopens differently
// loses its marks, then its links; anything still different refuses the page as `notExact`. The
// bytes returned are a fixed point: opening and canonically saving them gives the same bytes.
import { BlockNoteEditor } from '@blocknote/core'
import { repairMalformedEditorBlocks } from '../../hooks/editorBlockRepair'
import { resolveBlocksForTarget } from '../../hooks/editorBlockResolution'
import { tryParseFastMarkdownBlocks } from '../../hooks/editorFastMarkdownBlocks'
import { parseMarkdownBlocksWithFallback } from '../../hooks/editorMarkdownParseFallback'
import { clearParsedNoteBlockCache } from '../../hooks/editorParsedBlockCache'
import { extractEditorBody } from '../../hooks/editorTabContent'
import { blocksToMarkdownDirect, type DirectMarkdownCapableSerializer } from '../../utils/blockNoteDirectMarkdown'
import { inferCodeBlockLanguages } from '../../utils/codeBlockLanguage'
import { extractH1TitleFromContent } from '../../utils/noteTitle'
import {
  injectRichEditorMarkdownBlocks, installRichEditorMarkdownSerializer, preProcessRichEditorMarkdown,
  serializeRichEditorBlocksToMarkdown,
} from '../../utils/richEditorMarkdown'
import {
  degradeRuns, flattenBlocks, summarizeEditorBlocks, toEditorBlocks, type BlockCounts, type NoteBlock,
} from './articleBlocks'
import { WebCaptureRefusalError, utf8Length } from './articleText'
import { WEB_CAPTURE_LIMITS } from './webCaptureContract'

/** A headless editor used only to reopen and save; never mounted. */
export interface VerifyEditor extends DirectMarkdownCapableSerializer {
  tryParseMarkdownToBlocks: (markdown: string) => unknown
}

/** Creates the editor the check reopens with. Default: a headless default-schema editor. */
export type CreateVerifyEditor = () => VerifyEditor

/** Between rounds: throws a refusal when the caller cancelled or the time budget is spent. */
export type VerifyCheckpoint = () => Promise<void>

// Cannot collide with a note: real note paths never contain this scheme. Cleared after each use.
const VERIFY_PATH = 'leadinglight-web-capture://verify.md'
// The editor offers notes from this size to its fast parser (editorBlockResolution's
// DIRECT_MARKDOWN_PARSE_MIN_BYTES); below it, BlockNote's own Markdown parser reads them.
const FAST_PARSER_MIN_BYTES = 16 * 1024
// Plain words appended to a small note so the check also reads it the way a grown note is read.
const LARGE_NOTE_FILLER = `\n\n${'Filler words for the large note check. '.repeat(460).trimEnd()}\n`

export const createDefaultVerifyEditor: CreateVerifyEditor = () => BlockNoteEditor.create() as unknown as VerifyEditor

interface Reopened {
  readonly editor: VerifyEditor
  readonly blocks: unknown[]
}

type ResolveEditor = Parameters<typeof resolveBlocksForTarget>[0]['editor']

async function reopen(content: string, createEditor: CreateVerifyEditor): Promise<Reopened> {
  const editor = createEditor()
  installRichEditorMarkdownSerializer(editor)
  clearParsedNoteBlockCache(VERIFY_PATH)
  try {
    const resolved = await resolveBlocksForTarget({
      editor: editor as unknown as ResolveEditor, cache: new Map(), content, targetPath: VERIFY_PATH,
    })
    return { editor, blocks: resolved.blocks }
  } finally {
    clearParsedNoteBlockCache(VERIFY_PATH)
  }
}

/**
 * What `resolveBlocksForTarget` does for a note the fast parser does not read, from the same
 * exported steps, for a large note checked as it would read once it shrinks below 16 KiB.
 */
async function reopenWithBlockNoteParser(content: string, createEditor: CreateVerifyEditor): Promise<unknown[]> {
  const editor = createEditor()
  const body = extractEditorBody(content)
  const parsed = await parseMarkdownBlocksWithFallback({
    parseMarkdownBlocks: markdown => editor.tryParseMarkdownToBlocks(markdown) as unknown[] | Promise<unknown[]>,
    preprocessed: preProcessRichEditorMarkdown(body, undefined, VERIFY_PATH),
    sourceMarkdown: body,
    context: VERIFY_PATH,
  })
  if (parsed.usedSourceFallback) return []
  return inferCodeBlockLanguages(repairMalformedEditorBlocks(injectRichEditorMarkdownBlocks(repairMalformedEditorBlocks(parsed.blocks))))
}

/**
 * Mismatches when the note is read by the parser it does not use at its current size: a small
 * note grown past 16 KiB, a large note read by BlockNote's parser.
 */
async function otherParserMismatches(content: string, expected: readonly string[], createEditor: CreateVerifyEditor): Promise<number[]> {
  if (utf8Length(content) < FAST_PARSER_MIN_BYTES) {
    const { blocks } = await reopen(`${content.replace(/\n+$/u, '')}${LARGE_NOTE_FILLER}`, createEditor)
    const actual = summarizeEditorBlocks(blocks)
    const filler = summarizeEditorBlocks([{ type: 'paragraph', content: [{ type: 'text', text: LARGE_NOTE_FILLER.trim(), styles: {} }], children: [] }])
    return mismatchIndexes([...expected, ...filler], actual).map(index => Math.min(index, expected.length - 1))
  }
  // Already read by BlockNote's parser when the fast parser declined it.
  if (!tryParseFastMarkdownBlocks(preProcessRichEditorMarkdown(extractEditorBody(content))).supported) return []
  return mismatchIndexes(expected, summarizeEditorBlocks(await reopenWithBlockNoteParser(content, createEditor)))
}

function canonicalSave(editor: VerifyEditor, blocks: unknown[]): string {
  const markdown = serializeRichEditorBlocksToMarkdown({ editor, blocks })
  // The lossy fallback is not the canonical form, so its bytes are never accepted.
  if (editor.__tolariaLastDirectMarkdownMetrics?.fallbackReason) throw new WebCaptureRefusalError('notExact')
  return markdown
}

function mismatchIndexes(expected: readonly string[], actual: readonly string[]): number[] {
  if (expected.length === actual.length) return expected.flatMap((entry, index) => (entry === actual[index] ? [] : [index]))
  const length = Math.min(expected.length, actual.length)
  for (let index = 0; index < length; index += 1) if (expected[index] !== actual[index]) return [index]
  return [Math.max(0, length - 1)]
}

/** Lowers the formatting of the blocks at `indexes`; false when none can go lower. */
function degradeBlocks(blocks: NoteBlock[], indexes: readonly number[], levels: Map<NoteBlock, number>, counts: BlockCounts): boolean {
  const flat = flattenBlocks(blocks)
  let changed = false
  for (const index of indexes) {
    const block = flat[index]?.block
    if (!block || block.type === 'codeBlock' || block.type === 'divider') continue
    const level = (levels.get(block) ?? 0) + 1
    if (level > 2) continue
    levels.set(block, level)
    if (block.type === 'table') block.rows = block.rows.map(row => row.map(cell => degradeRuns(cell, level as 1 | 2)))
    else block.runs = degradeRuns(block.runs, level as 1 | 2)
    if (level === 1) counts.plainBlocks += 1
    changed = true
  }
  return changed
}

export interface SettledNote {
  readonly body: string
}

/**
 * Settles `blocks` (title heading first) under `frontmatter` into bytes the editor reopens as
 * exactly these blocks and canonically saves unchanged. Mutates `blocks` only to lower formatting.
 */
export async function settleNote(input: {
  readonly frontmatter: string
  readonly blocks: NoteBlock[]
  readonly title: string
  readonly counts: BlockCounts
  readonly createEditor?: CreateVerifyEditor
  readonly checkpoint: VerifyCheckpoint
}): Promise<SettledNote> {
  const { frontmatter, blocks, title, counts, checkpoint } = input
  const createEditor = input.createEditor ?? createDefaultVerifyEditor
  const levels = new Map<NoteBlock, number>()
  for (let round = 0; round < WEB_CAPTURE_LIMITS.verifyRounds; round += 1) {
    await checkpoint()
    const editorBlocks = toEditorBlocks(blocks)
    if (!blocksToMarkdownDirect(editorBlocks).supported) throw new WebCaptureRefusalError('notExact')
    const expected = summarizeEditorBlocks(editorBlocks)
    const writer = createEditor()
    installRichEditorMarkdownSerializer(writer)
    const body = canonicalSave(writer, editorBlocks)
    const first = await reopen(`${frontmatter}${body}`, createEditor)
    const mismatches = mismatchIndexes(expected, summarizeEditorBlocks(first.blocks))
    if (mismatches.length > 0) {
      if (!degradeBlocks(blocks, mismatches, levels, counts)) throw new WebCaptureRefusalError('notExact')
      continue
    }
    const settled = await fixedPoint({ frontmatter, body, first, expected, createEditor, checkpoint })
    if (extractH1TitleFromContent(`${frontmatter}${settled}`) !== title) throw new WebCaptureRefusalError('notExact')
    await checkpoint()
    const other = await otherParserMismatches(`${frontmatter}${settled}`, expected, createEditor)
    if (other.length > 0) {
      if (!degradeBlocks(blocks, other, levels, counts)) throw new WebCaptureRefusalError('notExact')
      continue
    }
    return { body: settled }
  }
  throw new WebCaptureRefusalError('notExact')
}

/** The canonical save of the reopened note, accepted once it reproduces itself. */
async function fixedPoint(input: {
  readonly frontmatter: string
  readonly body: string
  readonly first: Reopened
  readonly expected: readonly string[]
  readonly createEditor: CreateVerifyEditor
  readonly checkpoint: VerifyCheckpoint
}): Promise<string> {
  const { frontmatter, body, first, expected, createEditor, checkpoint } = input
  const saved = canonicalSave(first.editor, first.blocks)
  if (saved === body) return body
  // The first canonical save may still write differently (a bare address becomes an explicit
  // link); those bytes must reopen the same and then reproduce themselves.
  await checkpoint()
  const second = await reopen(`${frontmatter}${saved}`, createEditor)
  const summary = summarizeEditorBlocks(second.blocks)
  if (summary.length !== expected.length || summary.some((entry, index) => entry !== expected[index])) {
    throw new WebCaptureRefusalError('notExact')
  }
  if (canonicalSave(second.editor, second.blocks) !== saved) throw new WebCaptureRefusalError('notExact')
  return saved
}

/**
 * Whether `content` (for example the note after the host appended its own blocks) still opens with
 * exactly the given article blocks first. For a final check of the bytes about to be written.
 */
export async function noteStartsWithBlocks(content: string, blocks: readonly NoteBlock[], createEditor: CreateVerifyEditor = createDefaultVerifyEditor): Promise<boolean> {
  const expected = summarizeEditorBlocks(toEditorBlocks(blocks))
  const { blocks: reopened } = await reopen(content, createEditor)
  const actual = summarizeEditorBlocks(reopened)
  // Compare only top-level-aligned entries: appended blocks follow the article's last block.
  return expected.every((entry, index) => entry === actual[index])
}
