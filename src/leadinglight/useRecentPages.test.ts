import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '../types'
import { clearPrefetchCache } from '../hooks/useTabManagement'
import { readRecentPages } from './recentPages'
import { useRecentPages } from './useRecentPages'
import { useSplitWorkspace } from './useSplitWorkspace'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({ isTauri: () => false, mockInvoke: vi.fn() }))
import { mockInvoke } from '../mock-tauri'

const A = '/vault/a.md'
const B = '/vault/b.md'
const entry = (path: string) => ({ path, title: path, archived: false }) as VaultEntry
const tab = (path: string, content = '') => ({ entry: entry(path), content })
type Props = Parameters<typeof useRecentPages>[0]
const props = (overrides: Partial<Props> = {}): Props => ({
  vaultPath: '/vault', ready: true, entries: [entry(A), entry(B)], tabs: [],
  workspace: { activePane: 0, paths: [null, null], pendingPanes: [false, false], readyForVisits: true }, ...overrides,
})
const pane = (activePane: 0 | 1, paths: [string | null, string | null], pending = false, readyForVisits = true) =>
  ({ activePane, paths, pendingPanes: [pending, pending] as [boolean, boolean], readyForVisits })

describe('useRecentPages', () => {
  beforeEach(() => {
    localStorage.clear()
    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => ++now)
  })
  afterEach(() => vi.restoreAllMocks())

  it('records a visit only once the focused pane shows loaded content', () => {
    const { result, rerender } = renderHook(useRecentPages, { initialProps: props() })
    // Selection sets the path before its read finishes; a pending pane is not a visit either.
    rerender(props({ workspace: pane(0, [A, null]) }))
    rerender(props({ workspace: pane(0, [A, null], true), tabs: [tab(A)] }))
    expect(result.current.recentPaths).toEqual([])

    rerender(props({ workspace: pane(0, [A, null]), tabs: [tab(A)] }))
    const visited = readRecentPages('/vault')
    rerender(props({ workspace: pane(0, [A, null]), tabs: [tab(A, 'typing')] }))
    expect(visited.map(page => page.path)).toEqual([A])
    expect(readRecentPages('/vault')).toEqual(visited)

    rerender(props({ workspace: pane(1, [A, B]), tabs: [tab(A), tab(B)] }))
    expect(result.current.recentPaths).toEqual([B, A])
    rerender(props({ workspace: pane(0, [A, B]), tabs: [tab(A), tab(B)] }))
    expect(result.current.recentPaths).toEqual([A, B])
  })

  it('ignores loading or stale listings and keeps vaults separate', () => {
    const { result, rerender } = renderHook(useRecentPages, {
      initialProps: props({ ready: false, workspace: pane(0, [A, null]), tabs: [tab(A)] }),
    })
    expect(result.current.recentPaths).toEqual([])
    rerender(props({ workspace: pane(0, [A, null]), tabs: [tab(A)] }))
    expect(result.current.recentPaths).toEqual([A])

    // The new vault's listing has not arrived; the old page is still on screen.
    rerender(props({ vaultPath: '/other', workspace: pane(0, [A, null]), tabs: [tab(A)], entries: [] }))
    expect(result.current.recentPaths).toEqual([])
    expect(readRecentPages('/other')).toEqual([])
    rerender(props({ workspace: pane(0, [A, null]), tabs: [tab(A)] }))
    expect(result.current.recentPaths).toEqual([A])
  })

  it('waits for restore to settle, then counts only the page left in focus', () => {
    const { result, rerender } = renderHook(useRecentPages, { initialProps: props() })
    rerender(props({ workspace: pane(0, [A, null], false, false), tabs: [tab(A)] }))
    expect(result.current.recentPaths).toEqual([])
    // A page skipped while restoring still counts once it is the settled, focused page.
    rerender(props({ workspace: pane(0, [A, B]), tabs: [tab(A), tab(B)] }))
    expect(result.current.recentPaths).toEqual([A])
  })

  it('returns the same visit order after a restart', () => {
    const first = renderHook(useRecentPages, { initialProps: props() })
    first.rerender(props({ workspace: pane(0, [A, null]), tabs: [tab(A)] }))
    first.rerender(props({ workspace: pane(0, [B, null]), tabs: [tab(B)] }))
    first.rerender(props({ workspace: pane(0, [A, null]), tabs: [tab(A)] }))
    first.unmount()

    // The next launch shows nothing yet; history alone carries the order.
    const second = renderHook(useRecentPages, { initialProps: props({ ready: false }) })
    expect(second.result.current.recentPaths).toEqual([A, B])
  })

  it('keeps recency through a rename', () => {
    const { result, rerender } = renderHook(useRecentPages, { initialProps: props() })
    rerender(props({ workspace: pane(0, [A, null]), tabs: [tab(A)] }))
    const [{ openedAt }] = readRecentPages('/vault')
    act(() => result.current.renamePage(A, '/vault/a2.md'))
    expect(readRecentPages('/vault')).toEqual([{ path: '/vault/a2.md', openedAt }])
  })
})

describe('useRecentPages with the split workspace restoring two pages', () => {
  const page = (path: string) => ({
    path, filename: path.split('/').pop(), title: path, isA: 'Note', aliases: [], belongsTo: [], relatedTo: [],
    status: null, archived: false, modifiedAt: 1, createdAt: 1, fileSize: 1, snippet: '', wordCount: 0,
    relationships: {}, icon: null, color: null, order: null, template: null, sort: null, outgoingLinks: [],
  }) as unknown as VaultEntry
  const pages = [page(A), page(B)]

  // Saved layout: A left, B right and focused. B's read is held open.
  function restore() {
    localStorage.setItem('leadinglight.workspace:/vault', JSON.stringify({ paths: [A, B], active: 1, split: true }))
    let finishB!: (content: string) => void
    vi.mocked(mockInvoke).mockImplementation((_command, args) => (args as { path?: string } | undefined)?.path === B
      ? new Promise(resolve => { finishB = resolve })
      : Promise.resolve('# a'))
    const hook = renderHook(() => {
      const notes = useSplitWorkspace({ vaultPath: '/vault', entries: pages, isVaultLoading: false })
      return { notes, recents: useRecentPages({ vaultPath: '/vault', ready: true, entries: pages, tabs: notes.tabs, workspace: notes.splitWorkspace }) }
    })
    return { ...hook, finishB: () => act(async () => { finishB('# b') }) }
  }

  beforeEach(() => {
    localStorage.clear()
    clearPrefetchCache()
    vi.mocked(mockInvoke).mockReset()
  })

  it('does not count the left page that loaded first while restoring', async () => {
    const { result, finishB } = restore()
    await waitFor(() => expect(result.current.notes.tabs.map(item => item.entry.path)).toContain(A))
    await finishB()
    expect(result.current.notes.splitWorkspace.activePane).toBe(1)
    expect(result.current.recents.recentPaths).toEqual([B])
  })

  it('counts the left page when the user chose it during restore', async () => {
    const { result, finishB } = restore()
    await waitFor(() => expect(result.current.notes.tabs.map(item => item.entry.path)).toContain(A))
    act(() => result.current.notes.splitWorkspace.focusPane(0))
    await finishB()
    expect(result.current.notes.splitWorkspace.activePane).toBe(0)
    expect(result.current.recents.recentPaths).toEqual([A])
  })
})
