// Passage selectors in projection `leadinglight-text-v1`: made at capture, anchored from what an
// editor observed, and resolved later against a page's current text. Exact text and bounded context
// decide; offsets are hints. Nothing here guesses across notes, titles or fuzzy matches.
import { utf8Bytes } from '../extensions/extensionSchema'
import {
  COMMENTARY_LIMITS, PASSAGE_PROJECTION,
  type AnchorResult, type ObservedPassage, type PassageProjection, type PassageResolution, type PassageSelector,
} from './commentaryContract'

const CONTEXT = COMMENTARY_LIMITS.contextCodePoints
/** Context compared when anchoring what an editor observed. */
const ANCHOR_CONTEXT = 256
/** Occurrences examined for one passage; more is treated as ambiguous. */
const MAX_OCCURRENCES = 10_000
const SHA256 = /^[0-9a-f]{64}$/u

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff

/** Whether every surrogate is paired, so the text survives UTF-8 exactly. */
export function isWellFormedText(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (isHigh(code) && isLow(text.charCodeAt(index + 1))) index += 1
    else if (isHigh(code) || isLow(code)) return false
  }
  return true
}

/** The last `count` code points of `text`. */
export function lastCodePoints(text: string, count = CONTEXT): string {
  let start = text.length
  for (let taken = 0; taken < count && start > 0; taken += 1) {
    start -= isLow(text.charCodeAt(start - 1)) && isHigh(text.charCodeAt(start - 2)) ? 2 : 1
  }
  return text.slice(start)
}

/** The first `count` code points of `text`. */
export function firstCodePoints(text: string, count = CONTEXT): string {
  let end = 0
  for (let taken = 0; taken < count && end < text.length; taken += 1) {
    end += isHigh(text.charCodeAt(end)) && isLow(text.charCodeAt(end + 1)) ? 2 : 1
  }
  return text.slice(0, end)
}

const splitsPair = (text: string, index: number) => index > 0 && index < text.length && isLow(text.charCodeAt(index)) && isHigh(text.charCodeAt(index - 1))

/** Why a selector cannot be stored or resolved, or null when it is sound. */
export function selectorProblem(selector: PassageSelector): string | null {
  if (typeof selector !== 'object' || selector === null) return 'notSelector'
  const { projection, exact, prefix, suffix, sourceBodySha256, start, end } = selector
  if (projection !== PASSAGE_PROJECTION) return 'projection'
  if (typeof exact !== 'string' || typeof prefix !== 'string' || typeof suffix !== 'string') return 'text'
  if (exact.trim() === '' || utf8Bytes(exact) > COMMENTARY_LIMITS.quoteBytes) return 'exact'
  if (![exact, prefix, suffix].every(isWellFormedText)) return 'malformedText'
  if (lastCodePoints(prefix) !== prefix || firstCodePoints(suffix) !== suffix) return 'context'
  if (typeof sourceBodySha256 !== 'string' || !SHA256.test(sourceBodySha256)) return 'digest'
  if (start === null && end === null) return null
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start === null || end === null) return 'hint'
  return start >= 0 && end - start === exact.length ? null : 'hint'
}

/** A selector for projected text `[start, end)`, or null for an empty or misaligned range. */
export function selectorAt(projection: PassageProjection, start: number, end: number, sourceBodySha256: string): PassageSelector | null {
  const { text } = projection
  if (!(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start && end <= text.length)) return null
  if (splitsPair(text, start) || splitsPair(text, end)) return null
  const selector: PassageSelector = {
    projection: PASSAGE_PROJECTION,
    exact: text.slice(start, end),
    prefix: lastCodePoints(text.slice(Math.max(0, start - 2 * CONTEXT), start)),
    suffix: firstCodePoints(text.slice(end, end + 2 * CONTEXT)),
    sourceBodySha256,
    start,
    end,
  }
  return selectorProblem(selector) === null ? selector : null
}

/** A historical snapshot of what an editor showed, with no anchor in the projection. */
export function unanchoredSelector(observed: ObservedPassage, sourceBodySha256: string): PassageSelector | null {
  const selector: PassageSelector = {
    projection: PASSAGE_PROJECTION,
    exact: observed.exact,
    prefix: lastCodePoints(observed.before),
    suffix: firstCodePoints(observed.after),
    sourceBodySha256,
    start: null,
    end: null,
  }
  return selectorProblem(selector) === null ? selector : null
}

function occurrences(text: string, exact: string): number[] | null {
  const found: number[] = []
  for (let index = text.indexOf(exact); index !== -1; index = text.indexOf(exact, index + 1)) {
    if (found.length === MAX_OCCURRENCES) return null
    found.push(index)
  }
  return found
}

function commonSuffix(left: string, right: string): number {
  let length = 0
  while (length < left.length && length < right.length && left.charCodeAt(left.length - 1 - length) === right.charCodeAt(right.length - 1 - length)) length += 1
  return length
}

function commonPrefix(left: string, right: string): number {
  let length = 0
  while (length < left.length && length < right.length && left.charCodeAt(length) === right.charCodeAt(length)) length += 1
  return length
}

/**
 * Finds what an editor observed in the projection. Identical text anchors directly; otherwise the
 * one occurrence with the most surrounding agreement wins, and a tie is ambiguous.
 */
export function anchorObservedPassage(projection: PassageProjection, observed: ObservedPassage): AnchorResult {
  const { text } = projection
  const { before, exact, after } = observed
  if (exact === '') return { status: 'unanchored', reason: 'empty' }
  if (text.length === before.length + exact.length + after.length && text.startsWith(before) && text.startsWith(exact, before.length) && text.endsWith(after)) {
    return { status: 'anchored', start: before.length, end: before.length + exact.length }
  }
  const found = occurrences(text, exact)
  if (found === null) return { status: 'unanchored', reason: 'ambiguous' }
  if (found.length === 0) return { status: 'unanchored', reason: 'missing' }
  if (found.length === 1) return { status: 'anchored', start: found[0], end: found[0] + exact.length }
  const near = before.slice(-ANCHOR_CONTEXT)
  const far = after.slice(0, ANCHOR_CONTEXT)
  let best = -1
  let bestStart = -1
  let tied = false
  for (const start of found) {
    const end = start + exact.length
    const score = commonSuffix(text.slice(Math.max(0, start - ANCHOR_CONTEXT), start), near) + commonPrefix(text.slice(end, end + ANCHOR_CONTEXT), far)
    if (score > best) {
      best = score
      bestStart = start
      tied = false
    } else if (score === best) {
      tied = true
    }
  }
  return tied ? { status: 'unanchored', reason: 'ambiguous' } : { status: 'anchored', start: bestStart, end: bestStart + exact.length }
}

/**
 * Where the passage is in the page now. `currentBodySha256` is the digest of the body `projection`
 * was made from. Only the captured context distinguishes repeated text; nothing is chosen by nearness.
 */
export function resolvePassage(projection: PassageProjection, currentBodySha256: string, selector: PassageSelector): PassageResolution {
  if (projection.version !== PASSAGE_PROJECTION || selectorProblem(selector) !== null) return { status: 'invalid' }
  const { text } = projection
  const { exact, prefix, suffix, start, end } = selector
  const sameBody = currentBodySha256 === selector.sourceBodySha256
  if (sameBody && start !== null && end !== null && text.slice(start, end) === exact) return { status: 'exact', start, end }
  const found = occurrences(text, exact)
  if (found === null) return { status: 'ambiguous', count: MAX_OCCURRENCES }
  if (found.length === 0) return { status: 'missing' }
  const full: number[] = []
  const compatible: number[] = []
  for (const at of found) {
    const after = at + exact.length
    const prefixHolds = lastCodePoints(text.slice(Math.max(0, at - 2 * CONTEXT), at)) === prefix
    const suffixHolds = firstCodePoints(text.slice(after, after + 2 * CONTEXT)) === suffix
    if (prefixHolds && suffixHolds) full.push(at)
    if (prefixHolds || suffixHolds) compatible.push(at)
  }
  const one = (at: number, status: 'exact' | 'possible'): PassageResolution => ({ status, start: at, end: at + exact.length })
  if (full.length === 1) return one(full[0], sameBody ? 'exact' : 'possible')
  if (full.length > 1) return { status: 'ambiguous', count: full.length }
  if (compatible.length === 1) return one(compatible[0], 'possible')
  if (compatible.length > 1) return { status: 'ambiguous', count: compatible.length }
  return { status: 'changed' }
}
