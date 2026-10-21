/**
 * Newer text after a committed rename: it takes the receipt's change only when that change is
 * proven, otherwise it stays held. Nothing here writes; the save queue applies the result.
 */
import {
  legacyWikilinkPattern,
  legacyWikilinkTargets,
  rebaseOutgoing,
  replaceLegacyWikilinks,
  retargetIncoming,
  vaultRelativeStem,
} from './markdownRelocation'
import type { RenameReceipt } from './renameReceipt'

/** Newer text with the change applied, or null when it cannot take it safely. */
export type DraftRebase = (draft: string) => string | null

/**
 * `before -> after` is the authority. A draft equal to `before` becomes `after`. Any other draft
 * takes the strict `transform` only when `transform(before)` reproduces `after` byte for byte;
 * otherwise the receipt's own changed lines are replayed onto lines the draft left untouched.
 * A draft that changed a line the receipt changed differently stays unmerged (null).
 */
export function provenRebase(before: string, after: string, transform: (content: string) => string | null): DraftRebase {
  let proof: boolean | undefined
  const proven = () => {
    proof ??= safely(transform, before) === after
    return proof
  }
  return draft => {
    if (draft === before) return after
    if (before === after) return draft
    return (proven() ? safely(transform, draft) : null) ?? replayLines(before, after, draft)
  }
}

const lines = (text: string) => text === '' ? [] : text.split(/(?<=\n)/)

/** Bounded work: a rename draft that differs this much stays held instead. */
const MAX_TRACE_CELLS = 4_000_000

/** Longest common subsequence of two line lists (Myers), as index pairs; null when too different. */
function matches(left: readonly string[], right: readonly string[]): [number, number][] | null {
  const n = left.length
  const m = right.length
  const max = n + m
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  let distance = -1
  search: for (let d = 0; d <= max; d += 1) {
    if ((trace.length + 1) * v.length > MAX_TRACE_CELLS) return null
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
      let x = down ? v[offset + k + 1] : v[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && left[x] === right[y]) { x += 1; y += 1 }
      v[offset + k] = x
      if (x >= n && y >= m) { distance = d; break search }
    }
  }
  const pairs: [number, number][] = []
  let x = n
  let y = m
  for (let d = distance; d > 0; d -= 1) {
    const previous = trace[d]
    const k = x - y
    const down = k === -d || (k !== d && previous[offset + k - 1] < previous[offset + k + 1])
    const priorK = down ? k + 1 : k - 1
    const priorX = previous[offset + priorK]
    const startX = down ? priorX : priorX + 1
    while (x > startX && y > startX - k) { x -= 1; y -= 1; pairs.push([x, y]) }
    x = priorX
    y = priorX - priorK
  }
  while (x > 0 && y > 0) { x -= 1; y -= 1; pairs.push([x, y]) }
  return pairs.reverse()
}

const sameLines = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((line, index) => line === right[index])

/** Three-way line replay of `before -> after` onto `draft`; null on any overlapping change. */
export function replayLines(before: string, after: string, draft: string): string | null {
  const base = lines(before)
  const ours = lines(after)
  const theirs = lines(draft)
  const toOurs = matches(base, ours)
  const toTheirs = matches(base, theirs)
  if (!toOurs || !toTheirs) return null
  const oursAt = new Map(toOurs)
  const theirsAt = new Map(toTheirs)
  const result: string[] = []
  let i = 0
  let a = 0
  let b = 0
  const chunk = (end: number, endA: number, endB: number): boolean => {
    const original = base.slice(i, end)
    const mine = ours.slice(a, endA)
    const yours = theirs.slice(b, endB)
    if (sameLines(mine, original)) result.push(...yours)
    else if (sameLines(yours, original) || sameLines(mine, yours)) result.push(...mine)
    // Lines only inserted next to an unchanged copy of the changed lines keep their place.
    else if (original.length > 0 && sameLines(yours.slice(0, original.length), original)) result.push(...mine, ...yours.slice(original.length))
    else if (original.length > 0 && sameLines(yours.slice(yours.length - original.length), original)) result.push(...yours.slice(0, yours.length - original.length), ...mine)
    else return false
    return true
  }
  for (let s = 0; s < base.length; s += 1) {
    const sa = oursAt.get(s)
    const sb = theirsAt.get(s)
    if (sa === undefined || sb === undefined) continue
    if (!chunk(s, sa, sb)) return null
    result.push(base[s])
    i = s + 1
    a = sa + 1
    b = sb + 1
  }
  return chunk(base.length, ours.length, theirs.length) ? result.join('') : null
}

function safely(transform: (content: string) => string | null, content: string): string | null {
  try { return transform(content) } catch { return null }
}

/** YAML front matter block including its delimiters, and the rest; unclosed means none. */
export function splitFrontMatter(content: string): { frontMatter: string; body: string } {
  const bom = content.startsWith('﻿') ? 1 : 0
  const lines = content.slice(bom).split(/(?<=\n)/)
  if (lines[0]?.replace(/[\r\n]+$/, '') !== '---') return { frontMatter: '', body: content }
  let offset = bom + lines[0].length
  for (const line of lines.slice(1)) {
    offset += line.length
    const bare = line.replace(/[\r\n]+$/, '')
    if (bare === '---' || bare === '...') return { frontMatter: content.slice(0, offset), body: content.slice(offset) }
  }
  return { frontMatter: '', body: content }
}

/**
 * Replays the receipt's own front matter edit (a title rename's `title:` line) on newer text.
 * Null when the newer text's front matter is no longer the one the edit was made to.
 */
export function frontMatterReplay(before: string, after: string): (content: string) => string | null {
  const from = splitFrontMatter(before).frontMatter
  const to = splitFrontMatter(after).frontMatter
  if (from === to) return content => content
  return content => {
    const parts = splitFrontMatter(content)
    return parts.frontMatter === from ? to + parts.body : null
  }
}

export interface RenamedSource {
  vaultPath: string
  oldPath: string
}

/**
 * The source page's newer text after its own committed rename. `baseline` is the text the app
 * held when the rename started: any other native before-image is never merged into a draft.
 */
export function sourceRebase(receipt: RenameReceipt, source: RenamedSource, baseline: string | undefined): DraftRebase {
  const replay = frontMatterReplay(receipt.source_before_content, receipt.source_content)
  // Strict: a refusal means "not proven", never a silently partial rewrite of the draft.
  const transform = (content: string) => {
    const titled = replay(content)
    return titled === null ? null : rebaseOutgoing(titled, source.vaultPath, source.oldPath, receipt.new_path)
  }
  const proven = provenRebase(receipt.source_before_content, receipt.source_content, transform)
  return draft => {
    if (draft === receipt.source_before_content) return receipt.source_content
    return baseline === receipt.source_before_content ? proven(draft) : null
  }
}

export interface LinkedRenameContext {
  vaultPath: string
  oldPath: string
  /** The title native read before the rename (title hint or page title). */
  oldTitle: string
}

/**
 * A linked open page's newer text. `baseline` is the text the app held when the page's lane
 * was claimed: a native reread that differs from it is never merged into the draft.
 */
export function linkedRebase(receipt: RenameReceipt, page: { path: string; before: string; after: string; baseline: string | undefined }, context: LinkedRenameContext): DraftRebase {
  const retarget = {
    vault: context.vaultPath,
    oldPath: context.oldPath,
    newPath: receipt.new_path,
    oldTargets: legacyWikilinkTargets(context.oldTitle, vaultRelativeStem(context.oldPath, context.vaultPath)),
    newTarget: vaultRelativeStem(receipt.new_path, context.vaultPath),
  }
  const pattern = legacyWikilinkPattern(retarget.oldTargets)
  const transform = (content: string) => replaceLegacyWikilinks(
    retargetIncoming(content, retarget.vault, page.path, retarget.oldPath, retarget.newPath), pattern, retarget.newTarget)
  const proven = provenRebase(page.before, page.after, transform)
  return draft => {
    if (draft === page.before) return page.after
    return page.baseline === page.before ? proven(draft) : null
  }
}
