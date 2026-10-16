import { translate, type AppLocale } from '../lib/i18n'
import type { VaultEntry } from '../types'
import { normalizeNotePathForIdentity } from '../utils/notePathIdentity'
import { relativePathStem } from '../utils/wikilink'
import { vaultPathForEntry, workspaceLabelForEntry } from '../utils/workspaces'

// Filenames made by New page; contextual creation uses untitled-<type>-… instead.
const GENERATED_CAPTURE_STEM = /^untitled-page-\d+(?:-\d+)?$/
const PREVIEW_LIMIT = 80

type LabelSource = Pick<VaultEntry, 'filename' | 'snippet' | 'title' | 'titleSource'>

/** Pages the finder and Resume can open. Binary files open through other routes. */
export const isFindable = (entry: VaultEntry) => !entry.archived && entry.isA !== 'Config' && entry.fileKind !== 'binary'

/** A New page file whose title still comes only from its generated filename. */
export function isGeneratedCapture(entry: LabelSource): boolean {
  if (entry.titleSource !== 'filename') return false
  return GENERATED_CAPTURE_STEM.test(entry.filename.replace(/\.md$/i, ''))
}

function bodyPreview(snippet: string | undefined): string {
  const text = (snippet ?? '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(text)
  if (chars.length <= PREVIEW_LIMIT) return text
  return `${chars.slice(0, PREVIEW_LIMIT).join('').trimEnd()}…`
}

/** What to call a page on screen. Display only: never stored, searched or used to navigate. */
export function pageLabel(entry: LabelSource, locale: AppLocale): string {
  if (!isGeneratedCapture(entry)) return entry.title || entry.filename
  return bodyPreview(entry.snippet) || translate(locale, 'leadinglight.page.untitled')
}

/** Path hints for pages whose label another page shares, keyed by normalized page path. */
export function duplicateCues(entries: readonly VaultEntry[], vaultPath: string, locale: AppLocale): Map<string, string> {
  const groups = new Map<string, VaultEntry[]>()
  for (const entry of entries) {
    const key = pageLabel(entry, locale).trim().toLocaleLowerCase()
    const group = groups.get(key)
    if (group) group.push(entry)
    else groups.set(key, [entry])
  }

  const cues = new Map<string, string>()
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const spansWorkspaces = new Set(group.map(entry => vaultPathForEntry(entry, vaultPath))).size > 1
    for (const entry of group) {
      const path = relativePathStem(entry.path, vaultPathForEntry(entry, vaultPath))
      const workspace = spansWorkspaces ? workspaceLabelForEntry(entry) : null
      cues.set(normalizeNotePathForIdentity(entry.path), workspace ? `${workspace}: ${path}` : path)
    }
  }
  return cues
}

export function cueFor(cues: ReadonlyMap<string, string>, entry: Pick<VaultEntry, 'path'>): string | undefined {
  return cues.get(normalizeNotePathForIdentity(entry.path))
}
