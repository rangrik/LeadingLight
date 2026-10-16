import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSplitWorkspace, readWorkspaceSnapshot } from './useSplitWorkspace'
import { useVaultConfig } from '../hooks/useVaultConfig'
import { clearPrefetchCache } from '../hooks/useTabManagement'
import * as store from '../utils/vaultConfigStore'
import { mockInvoke } from '../mock-tauri'
import type { VaultEntry } from '../types'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({ isTauri: () => false, mockInvoke: vi.fn(async (_command, args) => `# ${args.path}`) }))
const entries = ['one', 'two', 'three'].map(name => ({ path: `/vault/${name}.md`, filename: `${name}.md`, title: name, fileKind: 'markdown' })) as VaultEntry[]
const key = 'leadinglight.workspace:/vault'
const seed = (editorModes: unknown) => localStorage.setItem(key, JSON.stringify({ paths: entries.slice(0, 2).map(entry => entry.path), split: true, editorModes }))
const setup = () => renderHook(() => useSplitWorkspace({ vaultPath: '/vault', entries }))
beforeEach(() => { localStorage.clear(); clearPrefetchCache(); store.resetVaultConfigStore() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); store.resetVaultConfigStore() })

describe('pane editor mode persistence and readiness', () => {
  it.each(['missing', 'invalid', 'read failure'])('settles the real config provider with %s storage', async failure => {
    if (failure === 'invalid') localStorage.setItem('laputa:vault-config:/vault', '{')
    if (failure === 'read failure') {
      const get = Storage.prototype.getItem
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
        if (key === 'laputa:vault-config:/vault') throw new Error('blocked storage')
        return get.call(this, key)
      })
    }
    const { result } = renderHook(() => {
      useVaultConfig('/vault')
      return useSplitWorkspace({ vaultPath: '/vault', entries, isVaultLoading: true })
    })
    await waitFor(() => expect(result.current.splitWorkspace.editorModesReady).toBe(true))
    expect(store.getVaultConfigPath()).toBe('/vault')
    expect(result.current.splitWorkspace.editorModes).toEqual(['preview', 'preview'])
  })

  it.each([true, false])('seeds matching legacy config once with restoreWorkspace=%s', async restoreWorkspace => {
    localStorage.setItem('laputa:vault-config:/vault', JSON.stringify({ editor_mode: 'raw' }))
    const { result } = renderHook(() => {
      useVaultConfig('/vault')
      return useSplitWorkspace({ vaultPath: '/vault', entries, restoreWorkspace })
    })
    await waitFor(() => expect(result.current.splitWorkspace.editorModesReady).toBe(true))
    expect(result.current.splitWorkspace.editorModes).toEqual(['raw', 'raw'])
    act(() => store.updateVaultConfigField('editor_mode', 'preview'))
    act(() => store.updateVaultConfigField('zoom', 1.2))
    expect(result.current.splitWorkspace.editorModes).toEqual(['raw', 'raw'])
  })

  it('rechecks config bound after the workspace subscribes and never seeds from another vault', async () => {
    store.bindVaultConfigStore({ ...store.getVaultConfig(), editor_mode: 'raw' }, vi.fn(), '/old')
    const { result } = renderHook(() => {
      const workspace = useSplitWorkspace({ vaultPath: '/vault', entries, isVaultLoading: true })
      useVaultConfig('/vault')
      return workspace
    })
    await waitFor(() => expect(result.current.splitWorkspace.editorModesReady).toBe(true))
    expect(result.current.splitWorkspace.editorModes).toEqual(['preview', 'preview'])
  })

  it('refuses transitions during a replacement read, and settles providerless preferences without awaiting it', async () => {
    seed(undefined)
    let release!: (content: string) => void
    vi.mocked(mockInvoke).mockImplementationOnce(() => new Promise<string>(resolve => { release = resolve }))
    const { result } = setup()
    await waitFor(() => expect(result.current.splitWorkspace.editorModesReady).toBe(true))
    expect(result.current.tabs.some(tab => tab.entry.path === entries[0].path)).toBe(false)
    expect(result.current.splitWorkspace.beginEditorModeChange(0)).toBeNull()
    await act(async () => { release('# one') })
    await waitFor(() => expect(result.current.tabs).toHaveLength(2))
    let finish!: (content: string) => void
    vi.mocked(mockInvoke).mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve }))
    let opening!: Promise<void>
    act(() => { opening = result.current.splitWorkspace.selectNoteInPane(entries[2], 0) })
    await waitFor(() => expect(result.current.splitWorkspace.pendingPanes[0]).toBe(true))
    expect(result.current.splitWorkspace.beginEditorModeChange(0)).toBeNull()
    await act(async () => { finish('# three'); await opening })
  })

  it.each([{ vaultPath: '/vault', restoreWorkspace: false }, { vaultPath: '', restoreWorkspace: true }])('settles providerless fallback: %j', async options => {
    const { result } = renderHook(() => useSplitWorkspace({ ...options, entries, isVaultLoading: true }))
    await waitFor(() => expect(result.current.splitWorkspace.editorModesReady).toBe(true))
    expect(result.current.splitWorkspace.editorModes).toEqual(['preview', 'preview'])
  })

  it('rejects invalid mode tuples without rejecting an old snapshot', async () => {
    for (const modes of [undefined, ['raw'], ['raw', 'bad'], ['raw', 'preview', 'raw'], 'raw']) {
      seed(modes)
      expect(readWorkspaceSnapshot('/vault').editorModes).toBeUndefined()
      expect(readWorkspaceSnapshot('/vault').paths).toEqual(entries.slice(0, 2).map(entry => entry.path))
    }
    const { result } = setup()
    await waitFor(() => expect(result.current.splitWorkspace.editorModesReady).toBe(true))
    expect(result.current.splitWorkspace.editorModes).toEqual(['preview', 'preview'])
  })

  it('keeps modes by pane through reorder, navigation, close/reopen, then restores in visual order', async () => {
    seed(['preview', 'raw'])
    const { result, unmount } = setup()
    await waitFor(() => expect(result.current.tabs).toHaveLength(2))
    act(() => result.current.splitWorkspace.placePane(1, 'left'))
    act(() => result.current.splitWorkspace.openSplit('vertical'))
    act(() => result.current.splitWorkspace.resize(61))
    await act(() => result.current.splitWorkspace.selectNoteInPane(entries[2], 1))
    await act(() => result.current.splitWorkspace.closePane(0))
    act(() => result.current.splitWorkspace.openSplit('vertical'))
    expect(result.current.splitWorkspace.editorModes).toEqual(['preview', 'raw'])
    const snapshot = readWorkspaceSnapshot('/vault')
    expect(snapshot.paths).toEqual([entries[2].path, entries[0].path])
    expect(snapshot.editorModes).toEqual(['raw', 'preview'])
    unmount()
    const restored = setup()
    await waitFor(() => expect(restored.result.current.tabs).toHaveLength(2))
    expect(restored.result.current.splitWorkspace.paths).toEqual(snapshot.paths)
    expect(restored.result.current.splitWorkspace.editorModes).toEqual(snapshot.editorModes)
  })

  it('seeds saved modes before a delayed restore and does not overwrite a newer toggle', async () => {
    seed(['preview', 'raw'])
    let release!: (content: string) => void
    vi.mocked(mockInvoke).mockImplementationOnce(() => new Promise<string>(resolve => { release = resolve }))
    const { result } = setup()
    expect(result.current.splitWorkspace.editorModesReady).toBe(true)
    expect(result.current.splitWorkspace.editorModes).toEqual(['preview', 'raw'])
    await waitFor(() => expect(result.current.splitWorkspace.paths[1]).toBe(entries[1].path))
    act(() => result.current.splitWorkspace.openSplit('vertical'))
    act(() => { expect(result.current.splitWorkspace.beginEditorModeChange(1)?.('preview')).toBe(true) })
    await act(async () => { release('# one') })
    await waitFor(() => expect(result.current.splitWorkspace.readyForVisits).toBe(true))
    expect(result.current.splitWorkspace.editorModes).toEqual(['preview', 'preview'])
    expect(result.current.splitWorkspace.orientation).toBe('vertical')
  })

  it('refuses hidden, renamed, replaced, closed and previous-session reservations', async () => {
    seed(['preview', 'raw'])
    const { result, rerender } = renderHook(({ vaultPath }) => useSplitWorkspace({ vaultPath, entries }), { initialProps: { vaultPath: '/vault' } })
    await waitFor(() => expect(result.current.tabs).toHaveLength(2))
    const reserve = () => result.current.splitWorkspace.beginEditorModeChange(0)!
    const changed = reserve()
    await act(() => result.current.splitWorkspace.selectNoteInPane(entries[2], 0))
    expect(changed('raw')).toBe(false)
    const renamed = reserve()
    act(() => result.current.setTabs(tabs => tabs.map(tab => tab.entry.path === entries[2].path ? { ...tab, entry: { ...tab.entry, path: '/vault/renamed.md' } } : tab)))
    expect(renamed('raw')).toBe(false)
    const closed = reserve()
    await act(() => result.current.splitWorkspace.closePane(0))
    expect(closed('raw')).toBe(false)
    expect(result.current.splitWorkspace.beginEditorModeChange(0)).toBeNull()
    act(() => result.current.splitWorkspace.openSplit('horizontal'))
    const oldSession = reserve()
    rerender({ vaultPath: '/other' })
    rerender({ vaultPath: '/vault' })
    expect(oldSession('raw')).toBe(false)
    await waitFor(() => expect(result.current.splitWorkspace.editorModesReady).toBe(true))
    const once = reserve()
    act(() => { expect(once('raw')).toBe(true) })
    expect(once('preview')).toBe(false)
  })
})
