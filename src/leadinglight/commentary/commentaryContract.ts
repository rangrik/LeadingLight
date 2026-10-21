// Passage commentary, format 1: the shapes the commentary domain, the extension host, native and UI
// share. A leaf: types and constants only. The public reference is docs/leadinglight/commentary-format.md.
// A commentary is an ordinary Markdown note. Its one structural `[Source](relative path)` link is the
// only source location; the namespaced record holds immutable capture evidence and never a path.
import type { LiteralMarkdownTextFailure } from '../extensions/extensionMarkdownText'
import { EXTENSION_LIMITS } from '../extensions/extensionContract'
import { PROPOSAL_LIMITS } from '../proposals/proposalContract'

/** Top-level frontmatter key of the record. Native reserves underscore keys, so it is never a property. */
export const COMMENTARY_RECORD_KEY = '_leadinglight_commentary'
export const COMMENTARY_RECORD_VERSION = 1
/** The one visible-text projection selectors are measured in. */
export const PASSAGE_PROJECTION = 'leadinglight-text-v1'
/** The fixed label of the source line's only link. */
export const SOURCE_LINK_LABEL = 'Source'

export const COMMENTARY_LIMITS = {
  /** Captures in one record; adding past this is refused. */
  captures: 256,
  /** Code points of projected text kept before and after a passage. */
  contextCodePoints: 64,
  /** UTF-8 bytes of one captured passage. */
  quoteBytes: EXTENSION_LIMITS.quoteBytes,
  /** UTF-8 bytes of a whole commentary note, as a guarded proposal carries it. */
  contentBytes: PROPOSAL_LIMITS.contentBytes,
  /** Notes discovery reads for one source. */
  discoveryNotes: 2000,
  /** UTF-8 bytes discovery reads for one source, all notes together. */
  discoveryTotalBytes: 32 * 1024 * 1024,
} as const

// --- Passages -------------------------------------------------------------------------------------

/**
 * Where a passage was, measured in the projection of the source body it was captured from. Text is
 * exact; `start`/`end` are UTF-16 hints into that projection, present only when the capture anchored,
 * and never an identity. The source itself is named only by the commentary's Source link.
 */
export interface PassageSelector {
  readonly projection: typeof PASSAGE_PROJECTION
  readonly exact: string
  /** Up to `contextCodePoints` of projected text right before; shorter only at the document start. */
  readonly prefix: string
  /** Up to `contextCodePoints` of projected text right after; shorter only at the document end. */
  readonly suffix: string
  /** SHA-256 of the source body (after frontmatter) the selector was measured in. */
  readonly sourceBodySha256: string
  readonly start: number | null
  readonly end: number | null
}

/** One request-time capture, held by the host for its run. `sourcePath` is never written to metadata. */
export interface CapturedPassage {
  /** Lowercase UUID v4, one per capture. */
  readonly id: string
  /** Vault-relative path of the source note at capture time. */
  readonly sourcePath: string
  /** Historical display title, for the recipe's `sourceTitle`; never an identity. */
  readonly sourceTitle: string
  readonly selector: PassageSelector
}

export interface ProjectionSegment {
  /** UTF-16 range in the body. */
  readonly sourceFrom: number
  readonly sourceTo: number
  /** UTF-16 range in the projected text. */
  readonly textFrom: number
  readonly textTo: number
  /** True when every source character is its own projected character, one to one. */
  readonly literal: boolean
}

/** The visible text of one body, with segments mapping it back to the body for the raw editor. */
export interface PassageProjection {
  readonly version: typeof PASSAGE_PROJECTION
  readonly text: string
  /** Ordered and non-overlapping on both sides; markup between segments projects to nothing. */
  readonly segments: readonly ProjectionSegment[]
}

/** What an editor adapter saw: its own visible text before, inside and after the selection. */
export interface ObservedPassage {
  readonly before: string
  readonly exact: string
  readonly after: string
}

export type AnchorResult =
  | { readonly status: 'anchored'; readonly start: number; readonly end: number }
  | { readonly status: 'unanchored'; readonly reason: 'missing' | 'ambiguous' | 'empty' }

/** A raw-editor selection in projection terms; `anchored` is false when an end cut a replaced construct. */
export interface SourceRangeMapping {
  readonly exact: string
  readonly start: number
  readonly end: number
  readonly anchored: boolean
}

/**
 * `exact`: same body, and the hint still holds the passage. `possible`: one compatible match in a
 * changed body; never proof that it is the same passage. `changed`: the text exists but not in its
 * captured context. `invalid`: an unknown projection or a malformed selector.
 */
export type PassageResolution =
  | { readonly status: 'exact' | 'possible'; readonly start: number; readonly end: number }
  | { readonly status: 'ambiguous'; readonly count: number }
  | { readonly status: 'changed' | 'missing' | 'invalid' }

// --- Notes ----------------------------------------------------------------------------------------

export interface CommentaryCaptureRecord extends PassageSelector {
  readonly id: string
}

export interface CommentaryRecord {
  readonly version: typeof COMMENTARY_RECORD_VERSION
  /** Lowercase UUID v4 of this commentary. */
  readonly id: string
  readonly captures: readonly CommentaryCaptureRecord[]
}

/** `none`: an ordinary note. `unsupported`: another record version; the note stays readable, assistance off. */
export type RecordState =
  | { readonly status: 'none' }
  | { readonly status: 'unsupported'; readonly version: string }
  | { readonly status: 'malformed' }
  | { readonly status: 'ready'; readonly record: CommentaryRecord }

export type SourceLinkProblem = 'multiple' | 'external' | 'outsideVault' | 'notNote' | 'malformed'

/** From the structural Source line only; `sourcePath` is vault-relative, resolved from the note's own folder. */
export type SourceLinkState =
  | { readonly status: 'linked'; readonly sourcePath: string; readonly destination: string }
  | { readonly status: 'missing' }
  | { readonly status: 'unreadable'; readonly reason: SourceLinkProblem }

export interface CommentaryNote {
  readonly path: string
  /** The H1's visible text, or null without one. */
  readonly title: string | null
  readonly record: RecordState
  readonly source: SourceLinkState
}

// --- Preparing one write --------------------------------------------------------------------------

/**
 * Every refusal is decided before anything is sent, so nothing was written and the input is kept.
 * `unsafeText`: the literal encoder refused some text (`detail` says why). `otherSource`: the note is
 * linked to a different page. `unsafeTail`: the note ends inside a construct that would swallow the entry.
 */
export type PreparationRefusal =
  | 'invalidCapture' | 'unsafeText' | 'tooLarge' | 'missingTitle'
  | 'notCommentary' | 'unsupportedRecord' | 'malformedRecord' | 'sourceUnreadable' | 'otherSource'
  | 'unsafeTail' | 'duplicateCapture' | 'tooManyCaptures'

/** The whole reviewed page: a new note beside the source, or a guarded replacement of one baseline. */
export type CommentaryWrite =
  | {
      readonly kind: 'create'; readonly path: string; readonly folder: string; readonly fileName: string
      readonly title: string; readonly content: string
    }
  | { readonly kind: 'append'; readonly path: string; readonly expectedSha256: string; readonly content: string }

/** `entry` is the Markdown of the one new entry, for the passive preview. */
export type CommentaryPreparation =
  | { readonly status: 'ready'; readonly write: CommentaryWrite; readonly entry: string }
  | { readonly status: 'refused'; readonly reason: PreparationRefusal; readonly detail: LiteralMarkdownTextFailure | null }

// --- Finding a source's commentaries --------------------------------------------------------------

export interface LinkedCommentary {
  readonly path: string
  readonly title: string | null
  readonly modifiedAt: number | null
  /** A ready record and a readable Source link to this source; only these may be added to. */
  readonly appendable: boolean
  readonly record: RecordState['status']
  readonly captures: number
}

export interface CommentaryDiscovery {
  readonly sourcePath: string
  /** False when a limit was reached or a read failed: a missing note cannot be ruled out. */
  readonly complete: boolean
  /** Notes whose Source line resolves to `sourcePath`, most recently modified first. */
  readonly linked: readonly LinkedCommentary[]
  /** Candidates not read because of a limit or a failed read. */
  readonly skipped: number
}

/** What the run dialog proposes. `choose` always needs the person's explicit review. */
export type DestinationPlan =
  | { readonly kind: 'create'; readonly separate: boolean }
  | { readonly kind: 'append'; readonly target: LinkedCommentary }
  | {
      readonly kind: 'choose'; readonly options: readonly LinkedCommentary[]
      readonly blocked: readonly LinkedCommentary[]; readonly incomplete: boolean
    }
