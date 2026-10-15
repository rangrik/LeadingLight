import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Tab } from '../hooks/useTabManagement'
import type { VaultEntry } from '../types'
import { notePathsMatch } from '../utils/notePathIdentity'
import { readRecentPages, renameRecentPage, touchRecentPage, writeRecentPages, type RecentPage } from './recentPages'
import type { SplitWorkspaceController } from './useSplitWorkspace'

interface Options {
  vaultPath: string
  /** True only once this vault's own listing has loaded. */
  ready: boolean
  entries: VaultEntry[]
  tabs: Tab[]
  workspace: Pick<SplitWorkspaceController, 'activePane' | 'paths' | 'pendingPanes' | 'readyForVisits'>
}

/** Remembers pages the user actually saw: the focused pane, settled, with its content loaded. */
export function useRecentPages({ vaultPath, ready, entries, tabs, workspace }: Options) {
  const stored = useMemo(() => readRecentPages(vaultPath), [vaultPath])
  const [updates, setUpdates] = useState<{ vaultPath: string, pages: RecentPage[] } | null>(null)
  const pages = updates?.vaultPath === vaultPath ? updates.pages : stored
  const update = useCallback((change: (pages: RecentPage[]) => RecentPage[]) => setUpdates(current => {
    const base = current?.vaultPath === vaultPath ? current.pages : stored
    const next = change(base)
    return next === base ? current : { vaultPath, pages: next }
  }), [stored, vaultPath])
  useEffect(() => { if (updates) writeRecentPages(updates.vaultPath, updates.pages) }, [updates])

  const { activePane } = workspace
  const activePath = workspace.paths[activePane]
  // Until restore settles, a page loaded behind the pane being restored is not a visit.
  const visible = ready && workspace.readyForVisits && !!activePath && !workspace.pendingPanes[activePane]
    && tabs.some(tab => notePathsMatch(tab.entry.path, activePath))
    && entries.some(entry => notePathsMatch(entry.path, activePath))
  const visit = visible ? JSON.stringify([vaultPath, activePane, activePath]) : null
  const lastVisitRef = useRef<string | null>(null)
  useEffect(() => {
    if (!visit || !activePath || visit === lastVisitRef.current) return
    lastVisitRef.current = visit
    update(current => touchRecentPage(current, activePath, Date.now()))
  }, [visit, activePath, update])

  const recentPaths = useMemo(() => pages.map(page => page.path), [pages])
  const renamePage = useCallback((oldPath: string, newPath: string) => {
    update(current => renameRecentPage(current, oldPath, newPath))
  }, [update])
  return { recentPaths, renamePage }
}
