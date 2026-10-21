// Finding the commentaries of one source: a bounded pass over notes the host names, through a
// reader the host injects. No index and no filesystem authority: a note is linked only when its own
// structural Source line, resolved from its own folder, names exactly this source.
import { utf8Bytes } from '../extensions/extensionSchema'
import {
  COMMENTARY_LIMITS,
  type CommentaryDiscovery, type DestinationPlan, type LinkedCommentary,
} from './commentaryContract'
import { isVaultNotePath, mayHaveCommentaryRecord, readCommentaryNote } from './commentaryFormat'

export interface DiscoveryCandidate {
  /** Vault-relative note path. */
  readonly path: string
  /** Last modification time in milliseconds, for ordering; null when unknown. */
  readonly modifiedAt: number | null
}

export interface DiscoveryRequest {
  /** Vault-relative path of the source page. */
  readonly sourcePath: string
  /** Notes to examine, in the order to examine them; the host chooses which (every Markdown note, or a marker search's hits). */
  readonly candidates: readonly DiscoveryCandidate[]
  /** False when the host's own list was cut short, e.g. by a search limit; then the result is never complete. */
  readonly candidatesComplete?: boolean
  /** The note's current saved text, or null when it cannot be read. A rejection counts as null. */
  read(path: string): Promise<string | null>
  /** Checked before every read; once false, discovery stops and reports itself incomplete. */
  isCurrent?(): boolean
  readonly limits?: { readonly notes?: number; readonly totalBytes?: number }
}

/** Most recently modified first, unknown times last, then by path, so the order never depends on reads. */
function byRecency(left: LinkedCommentary, right: LinkedCommentary): number {
  const leftTime = left.modifiedAt ?? Number.NEGATIVE_INFINITY
  const rightTime = right.modifiedAt ?? Number.NEGATIVE_INFINITY
  if (leftTime !== rightTime) return rightTime > leftTime ? 1 : -1
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0
}

function linkedOf(candidate: DiscoveryCandidate, content: string, sourcePath: string): LinkedCommentary | null {
  if (!mayHaveCommentaryRecord(content)) return null
  const note = readCommentaryNote(candidate.path, content)
  if (note.record.status === 'none' || note.source.status !== 'linked' || note.source.sourcePath !== sourcePath) return null
  return {
    path: candidate.path,
    title: note.title,
    modifiedAt: typeof candidate.modifiedAt === 'number' && Number.isFinite(candidate.modifiedAt) ? candidate.modifiedAt : null,
    appendable: note.record.status === 'ready',
    record: note.record.status,
    captures: note.record.status === 'ready' ? note.record.record.captures.length : 0,
  }
}

/**
 * The notes linked to `sourcePath`, read one at a time within the limits. `complete` is true only
 * when every candidate was read, so an empty result proves nothing unless it is complete.
 */
export async function discoverLinkedCommentaries(request: DiscoveryRequest): Promise<CommentaryDiscovery> {
  const { sourcePath } = request
  if (!isVaultNotePath(sourcePath)) return { sourcePath, complete: false, linked: [], skipped: request.candidates.length }
  const maxNotes = Math.min(request.limits?.notes ?? COMMENTARY_LIMITS.discoveryNotes, COMMENTARY_LIMITS.discoveryNotes)
  const maxBytes = Math.min(request.limits?.totalBytes ?? COMMENTARY_LIMITS.discoveryTotalBytes, COMMENTARY_LIMITS.discoveryTotalBytes)
  const seen = new Set<string>([sourcePath])
  const candidates: DiscoveryCandidate[] = []
  for (const candidate of request.candidates) {
    if (!isVaultNotePath(candidate.path) || seen.has(candidate.path)) continue
    seen.add(candidate.path)
    candidates.push(candidate)
  }
  const linked: LinkedCommentary[] = []
  let read = 0
  let bytes = 0
  let skipped = 0
  for (const candidate of candidates) {
    if (read >= maxNotes || bytes > maxBytes || request.isCurrent?.() === false) {
      skipped += 1
      continue
    }
    read += 1
    const content = await request.read(candidate.path).catch(() => null)
    if (typeof content !== 'string') {
      skipped += 1
      continue
    }
    bytes += utf8Bytes(content)
    if (utf8Bytes(content) > COMMENTARY_LIMITS.contentBytes) {
      skipped += 1
      continue
    }
    const note = linkedOf(candidate, content, sourcePath)
    if (note) linked.push(note)
  }
  const complete = skipped === 0 && request.candidatesComplete !== false && request.isCurrent?.() !== false
  return { sourcePath, complete, linked: linked.sort(byRecency), skipped }
}

/**
 * What the dialog proposes for this source. One complete, unambiguous answer is proposed directly;
 * anything else is shown for explicit review, never decided silently. A separate note is always a create.
 */
export function planCommentaryDestination(discovery: CommentaryDiscovery, options: { readonly separate: boolean }): DestinationPlan {
  if (options.separate) return { kind: 'create', separate: true }
  const appendable = discovery.linked.filter(note => note.appendable)
  const blocked = discovery.linked.filter(note => !note.appendable)
  if (discovery.complete && discovery.linked.length === 0) return { kind: 'create', separate: false }
  if (discovery.complete && blocked.length === 0 && appendable.length === 1) return { kind: 'append', target: appendable[0] }
  return { kind: 'choose', options: appendable, blocked, incomplete: !discovery.complete }
}
