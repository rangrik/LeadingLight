// "You saved this page before": a bounded lookup over the note list the host already loaded. Only
// each note's `source` property is read (the one URL a captured note records); no page is opened.
// The answer says whether it is complete, so the dialog never claims "not saved before" when the
// listing was still loading or the bound stopped the scan.
import { normalizeCaptureUrl } from './articleUrls'

export interface SavedSourceEntry {
  readonly path: string
  readonly title: string
  readonly source: unknown
}

export interface SavedCopy {
  readonly path: string
  readonly title: string
}

export interface SavedCopyLookup {
  readonly status: 'complete' | 'incomplete'
  readonly matches: readonly SavedCopy[]
}

export const SAVED_COPY_LIMITS = { entries: 50_000, matches: 5 } as const

/** Each listed note's path, title and `source` property, as the host's entry list holds them. */
export function savedSourceEntries(entries: readonly { readonly path: string; readonly title: string; readonly properties?: Readonly<Record<string, unknown>> }[]): SavedSourceEntry[] {
  return entries.map(entry => ({ path: entry.path, title: entry.title, source: entry.properties?.source }))
}

/** A property value's URL: the value itself, or the single item of a one-item list. */
function sourceUrl(value: unknown): string | null {
  const text = Array.isArray(value) && value.length === 1 ? value[0] : value
  return typeof text === 'string' ? normalizeCaptureUrl(text.trim()) : null
}

/**
 * Notes whose `source` is one of `urls`, compared after the same normalization the capture uses
 * (fragment removed, scheme and host lower-cased). Bounded by `maxEntries` scanned and `maxMatches`
 * kept; reaching either bound, or an incomplete listing, makes the answer `incomplete`.
 */
export function findSavedCopies(
  urls: readonly string[],
  entries: readonly SavedSourceEntry[],
  options: { readonly listingComplete: boolean; readonly maxEntries?: number; readonly maxMatches?: number },
): SavedCopyLookup {
  const maxEntries = options.maxEntries ?? SAVED_COPY_LIMITS.entries
  const maxMatches = options.maxMatches ?? SAVED_COPY_LIMITS.matches
  const wanted = new Set(urls.flatMap(url => normalizeCaptureUrl(url) ?? []))
  const matches: SavedCopy[] = []
  let complete = options.listingComplete && entries.length <= maxEntries
  if (wanted.size === 0) return { status: complete ? 'complete' : 'incomplete', matches }
  for (const entry of entries.slice(0, maxEntries)) {
    const url = sourceUrl(entry.source)
    if (url === null || !wanted.has(url)) continue
    if (matches.length === maxMatches) {
      complete = false
      break
    }
    matches.push({ path: entry.path, title: entry.title })
  }
  return { status: complete ? 'complete' : 'incomplete', matches }
}
