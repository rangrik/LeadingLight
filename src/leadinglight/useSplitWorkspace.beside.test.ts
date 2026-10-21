import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useSplitWorkspace } from './useSplitWorkspace'
import { clearPrefetchCache } from '../hooks/useTabManagement'
import type { VaultEntry } from '../types'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({ isTauri: () => false, mockInvoke: vi.fn(async (_command, args) => `# ${args.path}`) }))
const entry = (name: string): VaultEntry => ({ path: `/vault/${name}.md`, filename: `${name}.md`, title: name,
  isA: 'Note', aliases: [], belongsTo: [], relatedTo: [], status: 'Active', archived: false,
  modifiedAt: 1, createdAt: 1, fileSize: 1, snippet: '', wordCount: 0, relationships: {},
  icon: null, color: null, order: null, template: null, sort: null, outgoingLinks: [] })
const [source, other, commentary] = ['source', 'other', 'commentary'].map(entry)
const setup = (beforeNavigate = vi.fn(async () => {})) => ({
  beforeNavigate,
  hook: renderHook(() => useSplitWorkspace({ vaultPath: '/vault', entries: [source, other, commentary], beforeNavigate })),
})
const wanted = () => true

beforeEach(() => { localStorage.clear(); clearPrefetchCache() })

describe('opening a commentary beside its source', () => {
  it('opens the split after the source when it was closed, stacked when asked, and focuses the new page', async () => {
    const { hook: { result } } = setup()
    await act(() => result.current.handleSelectNote(source))
    const beside = result.current.splitWorkspace.reserveBeside(0)
    expect(beside.pane).toBe(1)
    expect(beside.effect(commentary.path)).toEqual({ kind: 'beside' })
    await act(async () => { expect(await beside.open(commentary, '# Commentary', wanted, { stacked: true })).toBe(true) })
    const workspace = result.current.splitWorkspace
    expect(workspace.paths).toEqual([source.path, commentary.path])
    expect(workspace.split).toBe(true)
    expect(workspace.orientation).toBe('vertical')
    expect(workspace.activePane).toBe(1)
  })

  it('names and saves the page it replaces in the other pane, never the source', async () => {
    const { hook: { result }, beforeNavigate } = setup()
    await act(() => result.current.handleSelectNote(source))
    act(() => result.current.splitWorkspace.openSplit('horizontal'))
    await act(() => result.current.handleSelectNote(other))
    act(() => result.current.splitWorkspace.focusPane(0))
    const beside = result.current.splitWorkspace.reserveBeside(0)
    expect(beside.effect(commentary.path)).toEqual({ kind: 'replaces', path: other.path })
    await act(async () => { await beside.open(commentary, '# Commentary', wanted, { stacked: false }) })
    expect(beforeNavigate).toHaveBeenCalledWith(other.path, commentary.path)
    expect(result.current.splitWorkspace.paths).toEqual([source.path, commentary.path])
    expect(result.current.splitWorkspace.orientation).toBe('horizontal')
  })

  it('focuses a commentary already open instead of opening it twice', async () => {
    const { hook: { result } } = setup()
    await act(() => result.current.handleSelectNote(source))
    act(() => result.current.splitWorkspace.openSplit('horizontal'))
    await act(() => result.current.handleSelectNote(commentary))
    act(() => result.current.splitWorkspace.focusPane(0))
    const beside = result.current.splitWorkspace.reserveBeside(0)
    expect(beside.effect(commentary.path)).toEqual({ kind: 'shown' })
    await act(async () => { expect(await beside.open(commentary, '# Changed', wanted, { stacked: false })).toBe(true) })
    expect(result.current.splitWorkspace.activePane).toBe(1)
    expect(result.current.tabs.find(tab => tab.entry.path === commentary.path)?.content).not.toBe('# Changed')
  })

  it('places nothing once the person navigated the reserved pane or the caller no longer wants it', async () => {
    const { hook: { result } } = setup()
    await act(() => result.current.handleSelectNote(source))
    act(() => result.current.splitWorkspace.openSplit('horizontal'))
    await act(() => result.current.handleSelectNote(other))
    act(() => result.current.splitWorkspace.focusPane(0))
    const beside = result.current.splitWorkspace.reserveBeside(0)
    await act(() => result.current.splitWorkspace.selectNoteInPane(source, 1).catch(() => {}))
    act(() => result.current.splitWorkspace.focusPane(0))
    await act(() => result.current.splitWorkspace.selectNoteInPane(other, 1))
    await act(async () => { expect(await beside.open(commentary, '# Commentary', wanted, { stacked: false })).toBe(false) })
    const again = result.current.splitWorkspace.reserveBeside(0)
    await act(async () => { expect(await again.open(commentary, '# Commentary', () => false, { stacked: false })).toBe(false) })
    expect(result.current.splitWorkspace.paths).toEqual([source.path, other.path])
  })
})
