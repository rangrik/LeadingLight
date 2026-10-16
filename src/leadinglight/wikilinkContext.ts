import type { VaultEntry } from '../types'
import { normalizeNotePathForIdentity } from '../utils/notePathIdentity'

type PathEntry = Pick<VaultEntry, 'path' | 'fileKind'>

function relativeVaultPath(path: string, vaultPath?: string): string | undefined {
  if (!vaultPath) return undefined
  const root = `${normalizeNotePathForIdentity(vaultPath)}/`
  const normalized = normalizeNotePathForIdentity(path)
  if (!normalized.startsWith(root)) return undefined
  const relative = normalized.slice(root.length)
  return relative && !relative.split('/').some(part => part === '..' || part === '.') ? relative : undefined
}

/** Preferences are metadata for existing pages, never new link candidates. */
export function contextualWikilinkPaths(options: {
  entries: readonly PathEntry[]
  vaultPath?: string
  sourcePath?: string | null
  otherPanePath?: string | null
  recentPaths?: readonly string[]
}): string[] {
  const source = options.sourcePath ? normalizeNotePathForIdentity(options.sourcePath) : null
  const eligible = new Map(options.entries
    .filter(entry => entry.fileKind !== 'binary' && relativeVaultPath(entry.path, options.vaultPath))
    .map(entry => [normalizeNotePathForIdentity(entry.path), entry.path]))
  const result: string[] = []
  for (const path of [options.otherPanePath, ...options.recentPaths ?? []]) {
    if (!path) continue
    const key = normalizeNotePathForIdentity(path)
    const eligiblePath = eligible.get(key)
    if (key === source || !eligiblePath) continue
    result.push(eligiblePath)
    eligible.delete(key)
  }
  return result
}

/** Stable promotion before the normal result limit; all fallback candidates remain. */
export function orderWikilinkSuggestions<T extends { path: string }>(items: T[], preferredPaths: readonly string[]): T[] {
  const ranks = new Map(preferredPaths.map((path, index) => [normalizeNotePathForIdentity(path), index]))
  const rank = (item: T) => ranks.get(normalizeNotePathForIdentity(item.path)) ?? preferredPaths.length
  return [...items].sort((left, right) => rank(left) - rank(right))
}

/** Display-only folder cues; never fall back to an absolute path. */
export function withWikilinkFolderCues<T extends { title: string; path: string }>(
  items: T[], vaultPath: string,
): Array<T & { secondaryLabel?: string }> {
  const paths = items.map(item => relativeVaultPath(item.path, vaultPath))
  const folder = (path: string) => path.split('/').slice(0, -1).join('/') || '.'
  return items.map((item, index) => {
    const relative = paths[index]
    const peers = items.filter(peer => peer.title === item.title)
    if (!relative || peers.length < 2) return item
    const parent = folder(relative)
    const sameFolder = peers.filter(peer => {
      const peerPath = relativeVaultPath(peer.path, vaultPath)
      return peerPath && folder(peerPath) === parent
    }).length > 1
    return { ...item, secondaryLabel: sameFolder ? relative : parent }
  })
}
