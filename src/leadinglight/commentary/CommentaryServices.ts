// The commentary host's one binding of the pure commentary domain and the app's local reads. Every
// other UI file depends on the CommentaryServices port (CommentaryPorts.ts), so tests inject fakes and
// the domain's frozen exports are named in exactly this file. Nothing here writes; reads are local
// and bounded.
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../../mock-tauri'
import type { VaultEntry } from '../../types'
import { joinVaultPath, normalizeNotePathForIdentity, notePathsCollide } from '../../utils/notePathIdentity'
import { E2_HOST_CAPABILITIES } from '../extensions/extensionContract'
import { utf8Bytes } from '../extensions/extensionSchema'
import { sha256Hex } from '../saveOutcome'
import { canAppendAfter, mayHaveCommentaryRecord, readCommentaryNote, sourceBodyOf } from './commentaryFormat'
import { COMMENTARY_LIMITS, COMMENTARY_RECORD_KEY, type CapturedPassage, type CommentaryDiscovery, type PassageSelector } from './commentaryContract'
import { relativeTo, type CaptureBuild, type CommentaryServices } from './CommentaryPorts'
import { commentaryName, prepareCommentaryAppend, prepareCommentaryCreate } from './commentaryPreparation'
import { discoverLinkedCommentaries, planCommentaryDestination } from './commentaryDiscovery'
import { projectMarkdownBody, projectRawEditorSelection } from './passageProjection'
import { anchorObservedPassage, selectorAt, unanchoredSelector } from './passageSelector'
import { observedPassage, RICH_CONTEXT_CHARS } from './richPassageAdapter'

/**
 * What the desktop window performs once these services are bound: E1's create and open, plus
 * passage capture and association (host services) and guarded append (native).
 */
export const COMMENTARY_HOST_CAPABILITIES = E2_HOST_CAPABILITIES

// --- Local reads ------------------------------------------------------------------------------------

function local<T>(command: string, args: Record<string, unknown>): Promise<T> {
  return isTauri() ? invoke<T>(command, args) : mockInvoke<T>(command, args)
}

interface SearchReply { results?: { path?: unknown }[] }

/** Pages whose text names the record key: the cheap first filter before exact reads. */
async function markedPages(vaultPath: string, limit: number): Promise<{ paths: string[]; complete: boolean } | null> {
  try {
    const reply = await local<SearchReply>('search_vault', { vaultPath, query: COMMENTARY_RECORD_KEY, limit, excludeFrontmatter: false })
    const paths = (reply.results ?? []).flatMap(item => (typeof item.path === 'string' ? [item.path] : []))
    return { paths, complete: paths.length < limit }
  } catch {
    return null
  }
}

/** A page's bytes on disk, read locally; null when it cannot be read. */
export async function readCommentaryPage(vaultPath: string, path: string): Promise<string | null> {
  try {
    const content = await local<unknown>('get_note_content', { path, vaultPath })
    return typeof content === 'string' ? content : null
  } catch {
    return null
  }
}

// --- The domain binding -----------------------------------------------------------------------------

async function buildCapture({ passage, settled, sourcePath, sourceTitle, token }: Parameters<CommentaryServices['buildCapture']>[0]): Promise<CaptureBuild> {
  if (settled !== passage.markdown) return { status: 'refused', reason: 'stale' }
  const body = sourceBodyOf(settled)
  const sha = await sha256Hex(body)
  const projection = projectMarkdownBody(body)
  let selector: PassageSelector | null
  if (passage.selection.mode === 'raw') {
    // CodeMirror positions over the whole note; the domain maps them and removes the front matter.
    const mapped = projectRawEditorSelection(settled, passage.selection.from, passage.selection.to, projection)
    if (!mapped || mapped.exact.trim() === '') return { status: 'refused', reason: 'empty' }
    const observed = {
      before: projection.text.slice(Math.max(0, mapped.start - RICH_CONTEXT_CHARS), mapped.start),
      exact: mapped.exact,
      after: projection.text.slice(mapped.end, mapped.end + RICH_CONTEXT_CHARS),
    }
    selector = (mapped.anchored ? selectorAt(projection, mapped.start, mapped.end, sha) : null) ?? unanchoredSelector(observed, sha)
  } else {
    const observed = observedPassage(passage.selection)
    const anchor = anchorObservedPassage(projection, observed)
    // Anchored only by the domain's own comparison with the saved text; otherwise the quote is kept
    // exactly as selected, with no place to jump to.
    selector = (anchor.status === 'anchored' ? selectorAt(projection, anchor.start, anchor.end, sha) : null) ?? unanchoredSelector(observed, sha)
  }
  // No selector the format accepts: text that cannot be kept literally (ill-formed or reserved).
  if (!selector) return { status: 'refused', reason: 'unsafeText' }
  if (utf8Bytes(selector.exact) > COMMENTARY_LIMITS.quoteBytes) return { status: 'refused', reason: 'tooLong' }
  const captured: CapturedPassage = { id: crypto.randomUUID(), sourcePath, sourceTitle, selector }
  return { status: 'ready', captured, capture: { passage: token, quote: selector.exact, sourceTitle } }
}

async function discover({ vaultPath, sourcePath, entries, isCurrent }: Parameters<CommentaryServices['discover']>[0]): Promise<CommentaryDiscovery> {
  const marked = await markedPages(vaultPath, COMMENTARY_LIMITS.discoveryNotes)
  if (!marked) return { sourcePath, complete: false, linked: [], skipped: 0 }
  const modified = new Map(entries.map(entry => [normalizeNotePathForIdentity(entry.path), entry.modifiedAt]))
  const candidates = marked.paths.flatMap(path => {
    const relative = relativeTo(vaultPath, path)
    return relative ? [{ path: relative, modifiedAt: modified.get(normalizeNotePathForIdentity(path)) ?? null }] : []
  })
  // A truncated search can never rule a note out, so the plan never creates silently after one.
  return discoverLinkedCommentaries({
    sourcePath, candidates, candidatesComplete: marked.complete, isCurrent,
    read: path => readCommentaryPage(vaultPath, joinVaultPath(vaultPath, path)),
  })
}

/**
 * The record can only be in front matter, so only the front matter is looked at: an ordinary page
 * without it costs one comparison, and a long body is never scanned while it is typed in.
 */
export function mayBeCommentary(content: string): boolean {
  if (!content.startsWith('---')) return false
  const close = content.indexOf('\n---', 3)
  return mayHaveCommentaryRecord(close === -1 ? content : content.slice(0, close))
}

function isTaken(folder: string, fileName: string, { vaultPath, entries }: { vaultPath: string; entries: readonly VaultEntry[] }): boolean {
  const target = joinVaultPath(vaultPath, [folder, fileName].filter(Boolean).join('/'))
  return entries.some(entry => notePathsCollide(entry.path, target))
}

export const commentaryServices: CommentaryServices = {
  buildCapture,
  mayBeCommentary,
  readNote: (path, content) => readCommentaryNote(path, content),
  discover,
  plan: (discovery, separate) => planCommentaryDestination(discovery, { separate }),
  // The default name is said even when taken, so the dialog can name the unlinked note and offer a
  // separate one; native's no-clobber create is what refuses it. A separate note skips taken names.
  name: (baseTitle, folder, separate, listing) => commentaryName(baseTitle, separate ? fileName => isTaken(folder, fileName, listing) : () => false, separate),
  isTaken,
  prepareCreate: ({ captured, document, commentaryId, folder, name }) =>
    prepareCommentaryCreate({ capture: captured, document, commentaryId, folder, title: name.title, fileName: name.fileName }),
  prepareAppend: ({ captured, document, path, baseline, baselineSha256 }) =>
    prepareCommentaryAppend({ capture: captured, document, target: { path, content: baseline, contentSha256: baselineSha256 } }),
  canAppendAfter: content => canAppendAfter(content),
}
