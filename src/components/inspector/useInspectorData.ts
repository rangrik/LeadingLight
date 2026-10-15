import type { VaultEntry } from '../../types'
import { resolveEntry, wikilinkTarget } from '../../utils/wikilink'
import type { ReferencedByItem, BacklinkItem } from '../InspectorPanels'

export interface InspectorLinkSummary {
  referencedBy: ReferencedByItem[]
  backlinks: BacklinkItem[]
}

const EMPTY_SUMMARY: InspectorLinkSummary = { referencedBy: [], backlinks: [] }
const summaryCache = new WeakMap<VaultEntry[], Map<string, InspectorLinkSummary>>()

// The path basename covers resolveEntry's case-insensitive path-suffix match, e.g. [[a/topic]] → a/TOPIC.MD.
function nameKeys(entry: VaultEntry): Set<string> {
  const basename = (entry.path.replace(/\\/g, '/').split('/').pop() ?? '').toLowerCase()
  const names = [entry.filename.replace(/\.md$/, ''), entry.title, ...entry.aliases].map((key) => key.toLowerCase())
  return new Set([...names, basename, basename.replace(/\.md$/, '')])
}

// Every name form resolveEntry compares, so this cheap check never skips a real match.
function nameForms(target: string): string[] {
  const whole = target.split('|')[0].toLowerCase()
  const segments = whole.split('/').filter(Boolean)
  const last = segments.at(-1) ?? ''
  const suffixes = segments.map((_, index) => segments.slice(index).join('/'))
  return [whole, ...suffixes, last.replace(/\.md$/, ''), last.replace(/-/g, ' ')]
}

// Credit only what a click on the link would open; unresolved forms such as [[page#heading]] count for nothing.
function linkOpens(target: VaultEntry, keys: Set<string>, entries: VaultEntry[], source: VaultEntry) {
  return (link: string): boolean =>
    nameForms(link).some((form) => keys.has(form)) && resolveEntry(entries, link, source)?.path === target.path
}

function buildSummary(target: VaultEntry, entries: VaultEntry[]): InspectorLinkSummary {
  const keys = nameKeys(target)
  const referencedBy: ReferencedByItem[] = []
  const backlinks: BacklinkItem[] = []

  for (const source of entries) {
    if (source.path === target.path) continue
    const opensTarget = linkOpens(target, keys, entries, source)
    const viaKeys = Object.entries(source.relationships)
      .filter(([viaKey, refs]) => viaKey !== 'Type' && refs.some((ref) => opensTarget(wikilinkTarget(ref))))
      .map(([viaKey]) => viaKey)
    for (const viaKey of viaKeys) referencedBy.push({ entry: source, viaKey })
    if (viaKeys.length === 0 && source.outgoingLinks.some(opensTarget)) backlinks.push({ entry: source, context: null })
  }

  return { referencedBy, backlinks }
}

/** Pages linking to `entry`; a page linking by property and body is listed once, under referencedBy. */
export function getInspectorLinkSummary(entry: VaultEntry | null, entries: VaultEntry[]): InspectorLinkSummary {
  if (!entry) return EMPTY_SUMMARY
  let byPath = summaryCache.get(entries)
  if (!byPath) {
    byPath = new Map()
    summaryCache.set(entries, byPath)
  }

  const cached = byPath.get(entry.path)
  if (cached) return cached

  const target = entries.find((candidate) => candidate.path === entry.path)
  const summary = target ? buildSummary(target, entries) : EMPTY_SUMMARY
  byPath.set(entry.path, summary)
  return summary
}
