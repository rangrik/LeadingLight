// The commentary host's ports: what its UI needs from the commentary domain and the app's local
// reads, as one injected object. Types and small path helpers only, so UI code and its tests never
// load the domain binding (CommentaryServices.ts) unless they mean to.
import type { VaultEntry } from '../../types'
import { normalizeNotePathForIdentity } from '../../utils/notePathIdentity'
import type { ComposedDocument, PassageCapture } from '../extensions/extensionContract'
import type { NotWrittenReason } from '../extensions/extensionSessionController'
import type {
  CapturedPassage, CommentaryDiscovery, CommentaryNote, CommentaryPreparation, DestinationPlan, PreparationRefusal,
} from './commentaryContract'
import type { EditorPassage } from './commentaryContext'

/** Why a capture is not taken; each is a status in the source pane, never a dialog. */
export type CaptureRefusal = 'stale' | 'empty' | 'tooLong' | 'unsafeText'

export type CaptureBuild =
  | { readonly status: 'ready'; readonly captured: CapturedPassage; readonly capture: PassageCapture }
  | { readonly status: 'refused'; readonly reason: CaptureRefusal }

export interface NoteName { readonly title: string; readonly fileName: string }

/** The commentary host's needs, bound to the domain here and to fakes in tests. */
export interface CommentaryServices {
  /**
   * The capture for a passage whose page settled to `settled`. `stale` when the page saved as
   * anything but the text the editor held at the request.
   */
  buildCapture(input: { passage: EditorPassage; settled: string; sourcePath: string; sourceTitle: string; token: string }): Promise<CaptureBuild>
  /**
   * Cheap and bounded, safe on every keystroke: false proves the text has no commentary record (it
   * looks no further than the front matter); true means `readNote` is worth running.
   */
  mayBeCommentary(content: string): boolean
  /** A note read structurally from its own path; vault-relative. Parses the whole body: never per keystroke. */
  readNote(path: string, content: string): CommentaryNote
  /**
   * Notes linked to `sourcePath` (vault-relative), bounded; `complete` false when any bound was hit
   * or `isCurrent` turned false before every candidate was read.
   */
  discover(input: { vaultPath: string; sourcePath: string; entries: readonly VaultEntry[]; isCurrent?: () => boolean }): Promise<CommentaryDiscovery>
  plan(discovery: CommentaryDiscovery, separate: boolean): DestinationPlan
  /** A new note's name beside the source: the recipe title, numbered for a separate note. */
  name(baseTitle: string, folder: string, separate: boolean, input: { vaultPath: string; entries: readonly VaultEntry[] }): NoteName | null
  /** Whether a page with exactly this name already exists in the folder (a listing hint; native decides). */
  isTaken(folder: string, fileName: string, input: { vaultPath: string; entries: readonly VaultEntry[] }): boolean
  prepareCreate(input: { captured: CapturedPassage; document: ComposedDocument; commentaryId: string; folder: string; name: NoteName }): CommentaryPreparation
  prepareAppend(input: { captured: CapturedPassage; document: ComposedDocument; path: string; baseline: string; baselineSha256: string }): CommentaryPreparation
  /** Whether more can be added after this note's end without being swallowed. */
  canAppendAfter(content: string): boolean
}

/** How a domain refusal reads to the controller: every one proves nothing was written. */
export const PREPARATION_REASONS: Record<PreparationRefusal, NotWrittenReason> = {
  invalidCapture: 'internal', unsafeText: 'unsafeText', tooLarge: 'tooLarge', missingTitle: 'invalidName',
  notCommentary: 'notAssociated', unsupportedRecord: 'notAssociated', malformedRecord: 'notAssociated',
  sourceUnreadable: 'notAssociated', otherSource: 'notAssociated', unsafeTail: 'unsafeTail',
  duplicateCapture: 'internal', tooManyCaptures: 'tooLarge',
}

/** The vault-relative form of an absolute page path inside `vaultPath`, or null. */
export function relativeTo(vaultPath: string, path: string): string | null {
  const root = normalizeNotePathForIdentity(vaultPath)
  const identity = normalizeNotePathForIdentity(path)
  return identity.startsWith(`${root}/`) ? identity.slice(root.length + 1) : null
}

/** The folder of a vault-relative page path; '' for the vault root. */
export const folderOf = (relative: string) => relative.split('/').slice(0, -1).join('/')
