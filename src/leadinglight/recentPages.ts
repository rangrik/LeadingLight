import { notePathsMatch } from '../utils/notePathIdentity'

/** Paths and times only: page text never goes into app storage. */
export interface RecentPage {
  path: string
  openedAt: number
}

export const RECENT_PAGES_LIMIT = 30
const storageKey = (vaultPath: string) => `leadinglight.recentPages:${vaultPath}`

function isRecentPage(value: unknown): value is RecentPage {
  const page = value as RecentPage | null
  return typeof page?.path === 'string' && page.path.length > 0 && Number.isFinite(page.openedAt)
}

export function readRecentPages(vaultPath: string): RecentPage[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey(vaultPath)) ?? '[]')
    return Array.isArray(value) ? value.filter(isRecentPage).slice(0, RECENT_PAGES_LIMIT) : []
  } catch {
    return []
  }
}

export function writeRecentPages(vaultPath: string, pages: RecentPage[]) {
  try {
    localStorage.setItem(storageKey(vaultPath), JSON.stringify(pages))
  } catch { /* Restricted storage keeps history for this session only. */ }
}

export function touchRecentPage(pages: RecentPage[], path: string, openedAt: number): RecentPage[] {
  return [{ path, openedAt }, ...pages.filter(page => !notePathsMatch(page.path, path))].slice(0, RECENT_PAGES_LIMIT)
}

export function renameRecentPage(pages: RecentPage[], oldPath: string, newPath: string): RecentPage[] {
  if (!pages.some(page => notePathsMatch(page.path, oldPath))) return pages
  // The renamed page keeps its place; an older entry already at the new path is dropped.
  return pages
    .filter(page => notePathsMatch(page.path, oldPath) || !notePathsMatch(page.path, newPath))
    .map(page => (notePathsMatch(page.path, oldPath) ? { ...page, path: newPath } : page))
}
