// Trusted host preparation of one commentary write: a captured passage plus the recipe's composed
// output becomes the whole reviewed page, either a new note beside the source or the exact baseline of
// an existing commentary with one entry and one capture added. Synchronous and pure, so the dialog's
// preview shows the very bytes a submit would send. Native only guards the result.
import type { ComposedDocument } from '../extensions/extensionContract'
import { fileNameForTitle, packageBlocksMarkdown } from '../extensions/extensionMarkdown'
import { LiteralMarkdownTextError, encodeLiteralMarkdownInline, encodeLiteralMarkdownLines } from '../extensions/extensionMarkdownText'
import { utf8Bytes } from '../extensions/extensionSchema'
import { PROPOSAL_LIMITS, isOpaqueToken, type GuardedProposal } from '../proposals/proposalContract'
import {
  COMMENTARY_LIMITS, COMMENTARY_RECORD_VERSION,
  type CapturedPassage, type CommentaryPreparation, type CommentaryRecord, type CommentaryWrite, type PreparationRefusal,
} from './commentaryContract'
import {
  composeAppendedCommentary, composeNewCommentary, isCommentaryUuid, isVaultNotePath, readCommentaryNote,
  readCommentaryRecord, sourceLinkDestination,
} from './commentaryFormat'
import { selectorProblem } from './passageSelector'

export interface CreateCommentaryInput {
  readonly capture: CapturedPassage
  /** The recipe's composed document; its first block is the host's `source` block for this capture. */
  readonly document: ComposedDocument
  /** Lowercase UUID v4 of the new commentary, from the host. */
  readonly commentaryId: string
  /** Vault-relative folder of the new note, normally the source's; '' is the vault root. */
  readonly folder: string
  /** From `commentaryName`: the recipe's title, numbered for a separate note. */
  readonly title: string
  readonly fileName: string
}

export interface AppendCommentaryInput {
  readonly capture: CapturedPassage
  readonly document: ComposedDocument
  /** The reviewed baseline exactly as bound for the guarded write, and the digest of those bytes. */
  readonly target: { readonly path: string; readonly content: string; readonly contentSha256: string }
}

const SHA256 = /^[0-9a-f]{64}$/u
const SEPARATE_NAME_ATTEMPTS = 999

class Refused extends Error {
  readonly reason: PreparationRefusal
  readonly detail: LiteralMarkdownTextError['reason'] | null
  constructor(reason: PreparationRefusal, detail: LiteralMarkdownTextError['reason'] | null = null) {
    super(reason)
    this.reason = reason
    this.detail = detail
  }
}

/** Encoder refusals become `unsafeText`, or `tooLarge` for oversized text. */
function literal<T>(encode: () => T): T {
  try {
    return encode()
  } catch (error) {
    if (error instanceof LiteralMarkdownTextError) throw new Refused(error.reason === 'tooLong' ? 'tooLarge' : 'unsafeText', error.reason)
    throw error
  }
}

/** The new entry: the host's quote of the passage, then the recipe's blocks, blank-line separated. */
function entryOf(capture: CapturedPassage, document: ComposedDocument): string {
  if (typeof capture !== 'object' || capture === null || !isCommentaryUuid(capture.id) || !isVaultNotePath(capture.sourcePath)) {
    throw new Refused('invalidCapture')
  }
  if (selectorProblem(capture.selector) !== null) throw new Refused('invalidCapture')
  const [source, ...blocks] = document.blocks
  if (source?.type !== 'source' || source.quote !== capture.selector.exact || blocks.some(block => block.type === 'source')) {
    throw new Refused('invalidCapture')
  }
  const quote = literal(() => encodeLiteralMarkdownLines(source.quote)).map(line => (line ? `> ${line}` : '>'))
  if (quote.length === 0) throw new Refused('invalidCapture')
  return [quote.join('\n'), ...literal(() => packageBlocksMarkdown(blocks))].join('\n\n')
}

function captureRecord(capture: CapturedPassage) {
  return { id: capture.id, ...capture.selector }
}

function withinLimit(content: string): void {
  if (utf8Bytes(content) > COMMENTARY_LIMITS.contentBytes) throw new Refused('tooLarge')
}

function isFileName(name: string): boolean {
  return typeof name === 'string' && name.toLowerCase().endsWith('.md') && name.length > 3 && !/[/\\]/u.test(name)
    && utf8Bytes(name) <= PROPOSAL_LIMITS.fileNameBytes && isVaultNotePath(name)
}

function refusal(error: unknown): CommentaryPreparation {
  if (error instanceof Refused) return { status: 'refused', reason: error.reason, detail: error.detail }
  throw error
}

/** A new commentary beside the source: title, one Source line, one record with this capture, one entry. */
export function prepareCommentaryCreate(input: CreateCommentaryInput): CommentaryPreparation {
  try {
    const { capture, commentaryId, folder, title, fileName } = input
    const entry = entryOf(capture, input.document)
    if (typeof title !== 'string' || literal(() => encodeLiteralMarkdownInline(title)) === '') throw new Refused('missingTitle')
    if (!isCommentaryUuid(commentaryId) || !isFileName(fileName) || (folder !== '' && !isVaultNotePath(`${folder}/${fileName}`))) {
      throw new Refused('invalidCapture')
    }
    const path = folder ? `${folder}/${fileName}` : fileName
    const sourceDestination = sourceLinkDestination(path, capture.sourcePath)
    if (sourceDestination === null || path === capture.sourcePath) throw new Refused('invalidCapture')
    const record: CommentaryRecord = { version: COMMENTARY_RECORD_VERSION, id: commentaryId, captures: [captureRecord(capture)] }
    const content = literal(() => composeNewCommentary({ record, title: title.trim(), sourceDestination, entry }))
    withinLimit(content)
    // The page must read back as what it claims: a ready record linked to exactly this source.
    const written = readCommentaryNote(path, content)
    if (written.record.status !== 'ready' || written.source.status !== 'linked' || written.source.sourcePath !== capture.sourcePath) {
      throw new Refused('sourceUnreadable')
    }
    return { status: 'ready', write: { kind: 'create', path, folder, fileName, title: title.trim(), content }, entry }
  } catch (error) {
    return refusal(error)
  }
}

/**
 * The reviewed baseline with one capture added to its record and one entry at its end, as one whole
 * postimage for a guarded replacement of exactly `target.contentSha256`. The note must be a ready
 * commentary whose Source line names this capture's source.
 */
export function prepareCommentaryAppend(input: AppendCommentaryInput): CommentaryPreparation {
  try {
    const { capture, target } = input
    const entry = entryOf(capture, input.document)
    if (!isVaultNotePath(target.path) || typeof target.content !== 'string' || !SHA256.test(target.contentSha256)) throw new Refused('invalidCapture')
    withinLimit(target.content)
    const { state, location } = readCommentaryRecord(target.content)
    if (state.status === 'none') throw new Refused('notCommentary')
    if (state.status === 'unsupported') throw new Refused('unsupportedRecord')
    if (state.status === 'malformed' || location === null) throw new Refused('malformedRecord')
    const { source } = readCommentaryNote(target.path, target.content)
    if (source.status !== 'linked') throw new Refused('sourceUnreadable')
    if (source.sourcePath !== capture.sourcePath) throw new Refused('otherSource')
    const { record } = state
    if (record.captures.some(item => item.id === capture.id)) throw new Refused('duplicateCapture')
    if (record.captures.length >= COMMENTARY_LIMITS.captures) throw new Refused('tooManyCaptures')
    const extended: CommentaryRecord = { ...record, captures: [...record.captures, captureRecord(capture)] }
    const content = composeAppendedCommentary(target.content, location, extended, entry)
    if (content === null) throw new Refused('unsafeTail')
    withinLimit(content)
    const written = readCommentaryNote(target.path, content)
    if (written.record.status !== 'ready' || written.record.record.captures.length !== extended.captures.length
      || written.source.status !== 'linked' || written.source.sourcePath !== capture.sourcePath) {
      throw new Refused('malformedRecord')
    }
    return { status: 'ready', write: { kind: 'append', path: target.path, expectedSha256: target.contentSha256, content }, entry }
  } catch (error) {
    return refusal(error)
  }
}

/**
 * The title and file name of a new commentary. The default note uses the recipe's title and is null
 * when that name is taken (an unlinked note is never appended to). A separate note numbers from 2,
 * skipping taken names. `isTaken` should compare names the way the file system does (case-insensitively).
 */
export function commentaryName(baseTitle: string, isTaken: (fileName: string) => boolean, separate: boolean): { title: string; fileName: string } | null {
  const base = typeof baseTitle === 'string' ? baseTitle.trim() : ''
  if (base === '') return null
  for (let number = separate ? 2 : 1; number <= SEPARATE_NAME_ATTEMPTS; number += 1) {
    const title = number === 1 ? base : `${base} ${number}`
    const fileName = fileNameForTitle(title)
    if (!isTaken(fileName)) return { title, fileName }
    if (!separate) return null
  }
  return null
}

/**
 * The existing guarded proposal for a prepared write: a create in the bound folder, or a replacement of
 * the bound document's exact baseline. `handle` is the native folder or document handle bound for this
 * run; `contentSha256` is the digest of `write.content`. Null for a handle or digest that cannot be sent.
 */
export function commentaryProposal(
  write: CommentaryWrite, ids: { readonly operationId: string; readonly runId: string; readonly handle: string; readonly contentSha256: string },
): GuardedProposal | null {
  const { operationId, runId, handle, contentSha256 } = ids
  if (!isOpaqueToken(handle) || !isOpaqueToken(runId) || !SHA256.test(contentSha256)) return null
  if (write.kind === 'create') {
    return { kind: 'create', operationId, runId, folderHandle: handle, fileName: write.fileName, content: write.content, contentSha256 }
  }
  if (contentSha256 === write.expectedSha256) return null
  return { kind: 'append', operationId, runId, documentHandle: handle, expectedSha256: write.expectedSha256, content: write.content, contentSha256 }
}
