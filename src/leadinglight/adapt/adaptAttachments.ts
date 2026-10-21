// What a person explicitly attaches to an Adapt request. Every attachment is a snapshot of text the
// person chose and can see before Send: pasted text, a selected passage, a page's settled text, or
// one extension package. Nothing is attached automatically, nothing sent carries a file path, and an
// attachment removed from the list is gone from the next Send.
import { RESERVED_PACKAGE_ID_PREFIX, type ExtensionPackage } from '../extensions/extensionContract'
import type { PackageView } from '../extensions/extensionSessionController'
import {
  ADAPT_LIMITS, isPlainLine, isWellFormedText, utf8Length,
  type AdaptAttachment as WireAttachment, type AdaptAttachmentKind, type AdaptRevisionBase,
} from './adaptContract'
import type { TakenText } from './adaptPage'

/** The extension a request revises: its identity and the exact version it starts from. */
export interface RevisionBase {
  readonly packageId: string
  readonly name: string
  /** The version attached, which a revision must exceed. */
  readonly version: string
  /** The attached version's stored hash: the base the revision names. */
  readonly sha256: string
  /** The version active when it was attached; activation expects exactly this (compare-and-set). */
  readonly activeSha256: string | null
  /** Bundled packages keep their reserved id; a change becomes a new ordinary extension. */
  readonly bundled: boolean
}

export interface AdaptAttachment {
  readonly id: string
  readonly kind: AdaptAttachmentKind
  /** Shown on the chip and sent as the attachment's label: a title or name, never a path. */
  readonly label: string
  readonly text: string
  readonly bytes: number
  /** Present only for an extension attachment. */
  readonly base: RevisionBase | null
  /**
   * The page a page snapshot or passage came from, named locally (its path): the same page replaces
   * its page chip, and Ask can return to the conversation about it. Never sent or shown.
   */
  readonly source: string | null
}

/** `unsafeText`: characters that cannot be sent as text (a NUL or a broken surrogate pair). */
export type AttachmentRefusal = 'empty' | 'tooLarge' | 'tooMany' | 'totalTooLarge' | 'unsafeText'
export type AttachmentResult = { readonly status: 'ok'; readonly attachments: readonly AdaptAttachment[] } | { readonly status: 'refused'; readonly reason: AttachmentRefusal }

const newId = () => crypto.randomUUID()

/** One plain line of at most the contract's label length; a long title is shortened, not refused. */
function labelOf(label: string, fallback: string): string {
  const line = label.replace(/\s+/gu, ' ').trim()
  const short = [...line].length > ADAPT_LIMITS.labelChars ? `${[...line].slice(0, ADAPT_LIMITS.labelChars - 1).join('')}…` : line
  return isPlainLine(short, ADAPT_LIMITS.labelChars) ? short : fallback
}

function make(
  kind: AdaptAttachmentKind, label: string, fallback: string, text: string, base: RevisionBase | null = null, source: string | null = null,
): AdaptAttachment | AttachmentRefusal {
  if (text.trim() === '') return 'empty'
  if (!isWellFormedText(text)) return 'unsafeText'
  const bytes = utf8Length(text)
  if (bytes > ADAPT_LIMITS.attachmentBytes) return 'tooLarge'
  return { id: newId(), kind, label: labelOf(label, fallback), text, bytes, base, source }
}

/** The chip a new one takes the place of: the one extension, or the same page taken again. */
const replaces = (next: AdaptAttachment) => (item: AdaptAttachment) =>
  item.kind === next.kind && (next.kind === 'extension' || (next.kind === 'pageSnapshot' && item.source === next.source))

/**
 * Adds one attachment. A request revises at most one extension, and holds one snapshot of each page,
 * so a second of either replaces the first; the person sees the chip change. Several pages may be
 * attached, each by its own click.
 */
function add(list: readonly AdaptAttachment[], next: AdaptAttachment | AttachmentRefusal): AttachmentResult {
  if (typeof next === 'string') return { status: 'refused', reason: next }
  const kept = list.filter(item => !replaces(next)(item))
  if (kept.length >= ADAPT_LIMITS.attachments) return { status: 'refused', reason: 'tooMany' }
  if (kept.reduce((sum, item) => sum + item.bytes, next.bytes) > ADAPT_LIMITS.payloadBytes) return { status: 'refused', reason: 'totalTooLarge' }
  return { status: 'ok', attachments: [...kept, next] }
}

export function attachPastedText(list: readonly AdaptAttachment[], text: string, label: string): AttachmentResult {
  return add(list, make('pastedText', label, 'Pasted text', text))
}

/** A page's settled text, taken when the person chose it; the title is its label. */
export function attachCurrentPage(list: readonly AdaptAttachment[], page: TakenText): AttachmentResult {
  return add(list, make('pageSnapshot', page.title, 'Current page', page.text, null, page.key ?? null))
}

/**
 * The selected passage, taken on the person's click, sent as text with the label the host gave it
 * ("Passage from <title>"). Several passages may be attached; none replaces another.
 */
export function attachPassage(list: readonly AdaptAttachment[], passage: TakenText, label: string): AttachmentResult {
  return add(list, make('pastedText', label, passage.title, passage.text, null, passage.key ?? null))
}

/** A selected passage, as opposed to text the person pasted. */
export const isPassage = (item: AdaptAttachment) => item.kind === 'pastedText' && item.source !== null

/** The pages these chips came from, by local path, once each. */
export const pagesOf = (list: readonly AdaptAttachment[]): string[] =>
  [...new Set(list.flatMap(item => (item.source === null ? [] : [item.source])))]

/**
 * One validated extension package as the model should see it, and the identity a revision binds
 * to. The text is the package re-serialized from its validated form, so nothing outside the
 * package format travels with it.
 */
export function attachExtension(list: readonly AdaptAttachment[], extension: ExtensionPackage, stored: { sha256: string; activeSha256: string | null }): AttachmentResult {
  const base: RevisionBase = {
    packageId: extension.id, name: extension.name, version: extension.version, sha256: stored.sha256, activeSha256: stored.activeSha256,
    bundled: extension.id.startsWith(RESERVED_PACKAGE_ID_PREFIX),
  }
  return add(list, make('extension', `${extension.name} · ${extension.version}`, 'Extension', JSON.stringify(extension, null, 2), base))
}

/**
 * Adjust's starting point for a Settings row: the version that is on, else the newest readable
 * stored version, with the active hash a revision's activation must still find.
 */
export function attachExtensionFrom(list: readonly AdaptAttachment[], view: PackageView): AttachmentResult {
  const start = startOf(view)
  if (!start) return { status: 'refused', reason: 'empty' }
  return attachExtension(list, start.extension, { sha256: start.sha256, activeSha256: view.activeSha256 })
}

function startOf(view: PackageView): { extension: ExtensionPackage; sha256: string } | null {
  const on = view.activeSha256 !== null
  const load = on ? view.active : view.candidate?.load ?? null
  const sha256 = on ? view.activeSha256 : view.candidate?.stored.packageSha256 ?? null
  return load?.status === 'ready' && sha256 !== null ? { extension: load.extension, sha256 } : null
}

/** Whether Adjust, or attaching it, has a readable version to start from. */
export const canAttach = (view: PackageView) => startOf(view) !== null

export const detach = (list: readonly AdaptAttachment[], id: string): readonly AdaptAttachment[] => list.filter(item => item.id !== id)

/** The extension the request revises, if one is attached. */
export const revisionBaseOf = (list: readonly AdaptAttachment[]): RevisionBase | null => list.find(item => item.kind === 'extension')?.base ?? null

/** Exactly what Send carries for these chips: kind, label and text, nothing else. */
export const wireAttachments = (list: readonly AdaptAttachment[]): WireAttachment[] => list.map(({ kind, label, text }) => ({ kind, label, text }))

/**
 * The binding native records with a revision request: the exact version changed, and what was on
 * when it was attached. Only an ordinary extension is revised in place; a bundled one becomes a new
 * extension, so it names no base.
 */
export const wireRevision = (base: RevisionBase | null): AdaptRevisionBase | null =>
  base && !base.bundled ? { packageId: base.packageId, baseSha256: base.sha256, expectedActiveSha256: base.activeSha256 } : null
