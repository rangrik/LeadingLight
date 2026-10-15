import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { readWorkspaceSnapshot, useSplitWorkspace } from './useSplitWorkspace'
import { clearPrefetchCache } from '../hooks/useTabManagement'
import { mockInvoke } from '../mock-tauri'
import type { VaultEntry } from '../types'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({ isTauri: () => false, mockInvoke: vi.fn(async (_command, args) => `# ${args.path}`) }))
const entry = (name: string): VaultEntry => ({ path: `/vault/${name}.md`, filename: `${name}.md`, title: name,
  isA: 'Note', aliases: [], belongsTo: [], relatedTo: [], status: 'Active', archived: false,
  modifiedAt: 1, createdAt: 1, fileSize: 1, snippet: '', wordCount: 0, relationships: {},
  icon: null, color: null, order: null, template: null, sort: null, outgoingLinks: [] })
const entries = ['one', 'two', 'three'].map(entry)
const setup = (beforeNavigate = vi.fn(async () => {})) => renderHook(() => useSplitWorkspace({ vaultPath: '/vault', entries, beforeNavigate }))

beforeEach(() => { localStorage.clear(); clearPrefetchCache() })
describe('split workspace', () => {
  it('keeps two arbitrary pages and changes only the active pane', async () => {
    const { result } = setup()
    await act(() => result.current.handleSelectNote(entries[0]))
    act(() => result.current.splitWorkspace.openSplit('horizontal'))
    await act(() => result.current.handleSelectNote(entries[1]))
    expect(result.current.splitWorkspace.paths).toEqual([entries[0].path, entries[1].path])
    await act(() => result.current.handleSelectNote(entries[2]))
    expect(result.current.splitWorkspace.paths).toEqual([entries[0].path, entries[2].path])
    expect(result.current.tabs).toHaveLength(2)
  })
  it('focuses the existing editor when the same page is opened again', async () => {
    const { result } = setup()
    await act(() => result.current.handleSelectNote(entries[0]))
    act(() => result.current.splitWorkspace.openSplit('horizontal'))
    await act(() => result.current.handleSelectNote(entries[1]))
    await act(() => result.current.handleSelectNote(entries[0]))
    expect(result.current.splitWorkspace.activePane).toBe(0)
    expect(result.current.splitWorkspace.paths).toEqual([entries[0].path, entries[1].path])
  })
  it('flushes a closing pane, retains it for reopening, and preserves orientation and ratio', async () => {
    const flush = vi.fn(async () => {})
    const { result } = setup(flush)
    await act(() => result.current.handleSelectNote(entries[0]))
    act(() => result.current.splitWorkspace.openSplit('vertical'))
    await act(() => result.current.handleSelectNote(entries[1]))
    act(() => result.current.splitWorkspace.resize(64))
    await act(() => result.current.splitWorkspace.closePane(1))
    expect(flush).toHaveBeenCalledWith(entries[1].path, '')
    expect(result.current.splitWorkspace.split).toBe(false)
    act(() => result.current.splitWorkspace.openSplit('vertical'))
    expect(result.current.splitWorkspace.paths).toEqual([entries[0].path, entries[1].path])
    expect(result.current.splitWorkspace.ratio).toBe(64)
  })
  it('keeps a pane visible when its save fails', async () => {
    const { result } = setup(vi.fn(async () => { throw new Error('Disk full') }))
    act(() => result.current.splitWorkspace.openSplit('horizontal'))
    await act(() => result.current.handleSelectNote(entries[1]))
    await act(async () => { await expect(result.current.splitWorkspace.closePane(1)).rejects.toThrow('Disk full') })
    expect(result.current.splitWorkspace.split).toBe(true)
    expect(result.current.activeTabPath).toBe(entries[1].path)
  })
  it('restores both pages, active pane, stacking and divider after remount', async () => {
    localStorage.setItem('leadinglight.workspace:/vault', JSON.stringify({ paths: entries.slice(0, 2).map(item => item.path), active: 1, split: true, orientation: 'vertical', ratio: 61 }))
    const { result } = setup()
    await waitFor(() => expect(result.current.tabs).toHaveLength(2))
    expect(result.current.activeTabPath).toBe(entries[1].path)
    expect(result.current.splitWorkspace.orientation).toBe('vertical')
    expect(result.current.splitWorkspace.ratio).toBe(61)
  })
  it('routes rename metadata updates to the owning pane without changing the other page', async () => {
    const { result } = setup()
    await act(() => result.current.handleSelectNote(entries[0]))
    act(() => result.current.splitWorkspace.openSplit('horizontal'))
    await act(() => result.current.handleSelectNote(entries[1]))
    act(() => result.current.setTabs(tabs => tabs.map(tab => tab.entry.path === entries[0].path ? { ...tab, entry: { ...tab.entry, path: '/vault/renamed.md' } } : tab)))
    expect(result.current.splitWorkspace.paths).toEqual(['/vault/renamed.md', entries[1].path])
    expect(result.current.activeTabPath).toBe(entries[1].path)
  })
  it('keeps history independent and navigates the active pane', async () => {
    const { result } = setup()
    await act(() => result.current.handleSelectNote(entries[0]))
    await act(() => result.current.handleSelectNote(entries[2]))
    act(() => result.current.splitWorkspace.openSplit('horizontal'))
    await act(() => result.current.handleSelectNote(entries[1]))
    expect(result.current.splitWorkspace.canGoBack).toBe(false)
    act(() => result.current.splitWorkspace.focusPane(0))
    expect(result.current.splitWorkspace.canGoBack).toBe(true)
    act(() => result.current.splitWorkspace.goBack())
    await waitFor(() => expect(result.current.activeTabPath).toBe(entries[0].path))
    expect(result.current.splitWorkspace.paths[1]).toBe(entries[1].path)
  })
  it('sanitizes corrupt restore data and eliminates duplicate documents', () => {
    localStorage.setItem('leadinglight.workspace:/vault', JSON.stringify({ paths: ['/vault/one.md', '/vault/one.md'], active: 1, split: true, orientation: 'invalid', ratio: 99 }))
    expect(readWorkspaceSnapshot('/vault')).toMatchObject({ paths: ['/vault/one.md', null], orientation: 'horizontal', ratio: 75 })
  })
})

it('merges simultaneous functional content updates for both panes without reverting either', async () => {
  const { result } = setup()
  await act(() => result.current.handleSelectNote(entries[0]))
  act(() => result.current.splitWorkspace.openSplit('horizontal'))
  await act(() => result.current.handleSelectNote(entries[1]))
  act(() => {
    result.current.setTabs(tabs => tabs.map(tab => tab.entry.path === entries[0].path ? { ...tab, content: 'left changed' } : tab))
    result.current.setTabs(tabs => tabs.map(tab => tab.entry.path === entries[1].path ? { ...tab, content: 'right changed' } : tab))
  })
  expect(result.current.tabs.map(tab => tab.content)).toEqual(['left changed', 'right changed'])
})

it('waits for the vault entries before restoring and does not erase stored page paths', async () => {
  localStorage.setItem('leadinglight.workspace:/vault', JSON.stringify({ paths: entries.slice(0, 2).map(item => item.path), active: 1, split: true, orientation: 'vertical', ratio: 61 }))
  const { result, rerender } = renderHook(({ ready }) => useSplitWorkspace({ vaultPath: '/vault', entries: ready ? entries : [], isVaultLoading: !ready }), { initialProps: { ready: false } })
  expect(result.current.tabs).toHaveLength(0)
  expect(readWorkspaceSnapshot('/vault').paths).toEqual(entries.slice(0, 2).map(item => item.path))
  rerender({ ready: true })
  await waitFor(() => expect(result.current.tabs).toHaveLength(2))
  expect(readWorkspaceSnapshot('/vault').paths).toEqual(entries.slice(0, 2).map(item => item.path))
})

it('does not let asynchronous startup restoration reset an immediate split action', async () => {
  const { result } = setup()
  act(() => result.current.splitWorkspace.openSplit('vertical'))
  await act(() => result.current.handleSelectNote(entries[1]))
  expect(result.current.splitWorkspace.split).toBe(true)
  expect(result.current.splitWorkspace.orientation).toBe('vertical')
})

it('keeps detached note windows from restoring or overwriting the main window layout', async () => {
  const saved = { paths: entries.slice(0, 2).map(item => item.path), active: 1, split: true, orientation: 'vertical', ratio: 61 }
  localStorage.setItem('leadinglight.workspace:/vault', JSON.stringify(saved))
  const { result } = renderHook(() => useSplitWorkspace({ vaultPath: '/vault', entries, restoreWorkspace: false }))
  await act(() => result.current.handleSelectNote(entries[2]))
  expect(result.current.tabs).toHaveLength(1)
  expect(readWorkspaceSnapshot('/vault')).toEqual(saved)
})

it('reserves a page requested by another pane while its previous page is still saving', async () => {
  let release!: () => void
  const flush = vi.fn(() => new Promise<void>(resolve => { release = resolve }))
  const { result } = setup(flush)
  await act(() => result.current.handleSelectNote(entries[0]))
  act(() => result.current.splitWorkspace.openSplit('horizontal'))
  await act(() => result.current.handleSelectNote(entries[1]))
  let pending!: Promise<void>
  act(() => { pending = result.current.splitWorkspace.selectNoteInPane(entries[2], 0) })
  await act(() => result.current.splitWorkspace.selectNoteInPane(entries[2], 1))
  expect(result.current.splitWorkspace.activePane).toBe(0)
  await act(async () => { release(); await pending })
  expect(result.current.splitWorkspace.paths).toEqual([entries[2].path, entries[1].path])
})

describe('placing a page by drag', () => {
  it('moves a sole page to an edge and reveals an empty pane without loading or saving', async () => {
    const flush = vi.fn(async () => {})
    const { result } = setup(flush)
    await act(() => result.current.handleSelectNote(entries[0]))
    const loads = vi.mocked(mockInvoke).mock.calls.length
    const tab = result.current.tabs[0]
    act(() => { expect(result.current.splitWorkspace.placePane(0, 'right')).toBe(true) })
    expect(result.current.splitWorkspace).toMatchObject({ split: true, orientation: 'horizontal', order: [1, 0], activePane: 0, paths: [entries[0].path, null] })
    expect(result.current.tabs[0]).toBe(tab)
    expect(flush).not.toHaveBeenCalled()
    expect(vi.mocked(mockInvoke).mock.calls.length).toBe(loads)
  })

  it('reveals a retained closed page with its edited content instead of clearing it', async () => {
    const flush = vi.fn(async () => {})
    const { result } = setup(flush)
    await act(() => result.current.handleSelectNote(entries[0]))
    act(() => result.current.splitWorkspace.openSplit('horizontal'))
    await act(() => result.current.handleSelectNote(entries[1]))
    await act(() => result.current.splitWorkspace.closePane(1))
    act(() => result.current.setTabs(tabs => tabs.map(tab => tab.entry.path === entries[0].path ? { ...tab, content: 'unsaved edit' } : tab)))
    flush.mockClear()
    const [visible, retained] = result.current.tabs
    act(() => { result.current.splitWorkspace.placePane(0, 'bottom') })
    expect(result.current.splitWorkspace).toMatchObject({ split: true, orientation: 'vertical', order: [1, 0], paths: [entries[0].path, entries[1].path] })
    expect(result.current.tabs[0]).toBe(visible)
    expect(result.current.tabs[1]).toBe(retained)
    expect(result.current.tabs[0].content).toBe('unsaved edit')
    expect(flush).not.toHaveBeenCalled()
  })

  it('swaps sides or stacking across two panes and ignores a drop on its own side', async () => {
    const { result } = setup()
    await act(() => result.current.handleSelectNote(entries[0]))
    act(() => result.current.splitWorkspace.openSplit('horizontal'))
    await act(() => result.current.handleSelectNote(entries[1]))
    act(() => { expect(result.current.splitWorkspace.placePane(0, 'left')).toBe(false) })
    expect(result.current.splitWorkspace).toMatchObject({ order: [0, 1], activePane: 1 })
    act(() => { result.current.splitWorkspace.placePane(0, 'right') })
    expect(result.current.splitWorkspace).toMatchObject({ orientation: 'horizontal', order: [1, 0], activePane: 0, paths: [entries[0].path, entries[1].path] })
    act(() => { result.current.splitWorkspace.placePane(1, 'bottom') })
    expect(result.current.splitWorkspace).toMatchObject({ orientation: 'vertical', order: [0, 1], activePane: 1 })
  })

  it('saves the visual order and restores the same sides after a restart', async () => {
    const first = setup()
    await act(() => first.result.current.handleSelectNote(entries[0]))
    act(() => first.result.current.splitWorkspace.openSplit('horizontal'))
    await act(() => first.result.current.handleSelectNote(entries[1]))
    act(() => { first.result.current.splitWorkspace.placePane(0, 'right') })
    await waitFor(() => expect(readWorkspaceSnapshot('/vault')).toMatchObject({ paths: [entries[1].path, entries[0].path], active: 1, split: true }))
    first.unmount()
    const { result } = setup()
    await waitFor(() => expect(result.current.tabs).toHaveLength(2))
    expect(result.current.splitWorkspace).toMatchObject({ order: [0, 1], paths: [entries[1].path, entries[0].path], activePane: 1 })
    expect(result.current.activeTabPath).toBe(entries[0].path)
  })

  it('opens the toolbar split after the current page', async () => {
    const { result } = setup()
    await act(() => result.current.handleSelectNote(entries[0]))
    act(() => result.current.splitWorkspace.openSplit('horizontal'))
    await act(() => result.current.handleSelectNote(entries[1]))
    await act(() => result.current.splitWorkspace.closePane(0))
    act(() => result.current.splitWorkspace.openSplit('horizontal'))
    expect(result.current.splitWorkspace).toMatchObject({ order: [1, 0], activePane: 0 })
  })
})

describe('restoring only from an authoritative listing', () => {
  const saved = { paths: [entries[0].path, entries[1].path], active: 1, split: true, orientation: 'vertical', ratio: 60 }
  // `ready` mirrors App: the loader finished an authoritative listing of this exact vault.
  const startup = () => {
    localStorage.setItem('leadinglight.workspace:/vault', JSON.stringify(saved))
    return renderHook(({ vault, list, ready }) => useSplitWorkspace({ vaultPath: vault, entries: list, isVaultLoading: !ready }),
      { initialProps: { vault: '/vault', list: [] as VaultEntry[], ready: false } })
  }

  it('waits through an early cached listing at startup, then restores pages and layout', async () => {
    const { result, rerender } = startup()
    rerender({ vault: '/vault', list: [entries[0]], ready: false })
    expect(result.current.tabs).toHaveLength(0)
    rerender({ vault: '/vault', list: entries, ready: true })
    // Pages show as soon as their reads start; the layout follows once all reads settle.
    await waitFor(() => expect(result.current.splitWorkspace).toMatchObject({ paths: saved.paths, split: true, orientation: 'vertical', ratio: 60, activePane: 1 }))
    expect(readWorkspaceSnapshot('/vault').paths).toEqual(saved.paths)
  })

  it('does not restore a switched-to vault from the previous vault listing', async () => {
    const other = ['four', 'five'].map(name => ({ ...entry(name), path: `/other/${name}.md` }))
    localStorage.setItem('leadinglight.workspace:/other', JSON.stringify({ ...saved, paths: other.map(item => item.path) }))
    const { result, rerender } = startup()
    rerender({ vault: '/vault', list: entries, ready: true })
    await waitFor(() => expect(result.current.tabs).toHaveLength(2))
    act(() => { result.current.splitWorkspace.suspendPersistence(); result.current.closeAllTabs() })
    rerender({ vault: '/other', list: entries, ready: false })
    expect(result.current.tabs).toHaveLength(0)
    rerender({ vault: '/other', list: other, ready: true })
    await waitFor(() => expect(result.current.splitWorkspace.paths).toEqual(other.map(item => item.path)))
    expect(readWorkspaceSnapshot('/vault').paths).toEqual(saved.paths)
  })

  it.each([
    ['selects', (hook: { current: ReturnType<typeof useSplitWorkspace> }) => hook.current.handleSelectNote(entries[2])],
    ['creates', (hook: { current: ReturnType<typeof useSplitWorkspace> }) => { hook.current.openTabWithContent(entries[2], '# three') }],
  ])('keeps a page the user %s before the vault is ready', async (_action, userAction) => {
    const { result, rerender } = startup()
    rerender({ vault: '/vault', list: entries, ready: false })
    await act(async () => { await userAction(result) })
    await waitFor(() => expect(result.current.activeTabPath).toBe(entries[2].path))
    rerender({ vault: '/vault', list: entries, ready: true })
    await waitFor(() => expect(readWorkspaceSnapshot('/vault').paths).toEqual([entries[2].path, entries[1].path]))
    expect(result.current.splitWorkspace).toMatchObject({ activePane: 0, split: false })
    expect(result.current.activeTabPath).toBe(entries[2].path)
  })

  it('drops saved pages that the authoritative listing no longer has', async () => {
    const { result, rerender } = startup()
    rerender({ vault: '/vault', list: [entries[0], entries[2]], ready: true })
    await waitFor(() => expect(readWorkspaceSnapshot('/vault').paths).toEqual([entries[0].path, null]))
    expect(result.current.splitWorkspace.paths).toEqual([entries[0].path, null])
  })

  it('keeps a layout change made while a restore read is still pending', async () => {
    const read = vi.mocked(mockInvoke).getMockImplementation()!
    let finish!: (content: string) => void
    const gate = new Promise<string>(resolve => { finish = resolve })
    vi.mocked(mockInvoke).mockImplementation((command, args) => ((args as { path?: string } | undefined)?.path === entries[1].path ? gate : read(command, args)))
    try {
      const { result, rerender } = startup()
      rerender({ vault: '/vault', list: entries, ready: true })
      await waitFor(() => expect(result.current.tabs.map(tab => tab.entry.path)).toContain(entries[0].path))
      act(() => { result.current.splitWorkspace.placePane(0, 'right') })
      await act(async () => { finish('# two') })
      await waitFor(() => expect(result.current.tabs).toHaveLength(2))
      expect(result.current.splitWorkspace).toMatchObject({ orientation: 'horizontal', order: [1, 0], activePane: 0, ratio: 50 })
    } finally {
      vi.mocked(mockInvoke).mockImplementation(read)
    }
  })

  it('keeps storing a saved page while its restore read is pending and after it fails', async () => {
    const read = vi.mocked(mockInvoke).getMockImplementation()!
    let fail!: (error: Error) => void
    // Every read of the page (prefetch or open) waits on the same gate.
    const gate = new Promise<never>((_resolve, reject) => { fail = reject })
    gate.catch(() => {})
    const isGated = (args: unknown) => (args as { path?: string } | undefined)?.path === entries[1].path
    vi.mocked(mockInvoke).mockImplementation((command, args) => (isGated(args) ? gate : read(command, args)))
    try {
      const { result, rerender } = startup()
      rerender({ vault: '/vault', list: entries, ready: true })
      await waitFor(() => expect(vi.mocked(mockInvoke).mock.calls.some(([, args]) => isGated(args))).toBe(true))
      expect(readWorkspaceSnapshot('/vault').paths).toEqual(saved.paths)
      await act(async () => { fail(new Error('disk busy')) })
      // The content loader retries for about 1.2 s before giving up.
      await waitFor(() => expect(result.current.splitWorkspace.paths[1]).toBeNull(), { timeout: 3000 })
      expect(readWorkspaceSnapshot('/vault').paths).toEqual(saved.paths)
      await act(() => result.current.splitWorkspace.selectNoteInPane(entries[2], 1))
      await waitFor(() => expect(readWorkspaceSnapshot('/vault').paths).toEqual([entries[0].path, entries[2].path]))
    } finally {
      vi.mocked(mockInvoke).mockImplementation(read)
    }
  })
})

describe('placing a note dragged from the list', () => {
  // Holds every read of one page until the test releases it.
  function holdRead(path: string) {
    const read = vi.mocked(mockInvoke).getMockImplementation()!
    let release!: (content: string) => void
    const gate = new Promise<string>(resolve => { release = resolve })
    vi.mocked(mockInvoke).mockImplementation((command, args) => ((args as { path?: string } | undefined)?.path === path ? gate : read(command, args)))
    return { release, restore: () => vi.mocked(mockInvoke).mockImplementation(read) }
  }
  async function twoPanes(flush = vi.fn(async () => {}), onUnreadableNoteContent?: () => void) {
    const hook = renderHook(() => useSplitWorkspace({ vaultPath: '/vault', entries, beforeNavigate: flush, onUnreadableNoteContent }))
    await act(() => hook.result.current.handleSelectNote(entries[0]))
    act(() => hook.result.current.splitWorkspace.openSplit('horizontal'))
    await act(() => hook.result.current.handleSelectNote(entries[1]))
    return hook
  }

  it('opens a note beside a single page only once it has loaded', async () => {
    const read = holdRead(entries[2].path)
    try {
      const { result } = setup()
      await act(() => result.current.handleSelectNote(entries[0]))
      let placing!: Promise<boolean>
      act(() => { placing = result.current.splitWorkspace.placeNote(entries[2], { edge: 'left' }) })
      expect(result.current.splitWorkspace).toMatchObject({ split: false, activePane: 0 })
      await act(async () => { read.release('# three'); await placing })
      await expect(placing).resolves.toBe(true)
      expect(result.current.splitWorkspace).toMatchObject({ split: true, orientation: 'horizontal', order: [1, 0], activePane: 1, paths: [entries[0].path, entries[2].path] })
    } finally { read.restore() }
  })

  it('replaces the dropped visual slot or pane after saving it, keeping the other page and ratio', async () => {
    const flush = vi.fn(async () => {})
    const { result } = await twoPanes(flush)
    act(() => result.current.splitWorkspace.resize(60))
    await act(() => result.current.splitWorkspace.placeNote(entries[2], { edge: 'left' }))
    expect(flush).toHaveBeenLastCalledWith(entries[0].path, entries[2].path)
    expect(result.current.splitWorkspace).toMatchObject({ paths: [entries[2].path, entries[1].path], ratio: 60, order: [0, 1], activePane: 0 })
    await act(() => result.current.splitWorkspace.placeNote(entries[0], { pane: 1 }))
    expect(result.current.splitWorkspace).toMatchObject({ paths: [entries[2].path, entries[0].path], activePane: 1 })
  })

  it('moves an already-open note instead of loading a second copy', async () => {
    const flush = vi.fn(async () => {})
    const { result } = await twoPanes(flush)
    const tabs = result.current.tabs
    const loads = vi.mocked(mockInvoke).mock.calls.length
    flush.mockClear()
    await act(() => result.current.splitWorkspace.placeNote(entries[1], { edge: 'left' }))
    expect(result.current.splitWorkspace).toMatchObject({ order: [1, 0], activePane: 1, paths: [entries[0].path, entries[1].path] })
    expect(result.current.tabs).toEqual(tabs)
    expect(vi.mocked(mockInvoke).mock.calls.length).toBe(loads)
    expect(flush).not.toHaveBeenCalled()
  })

  it('reveals a retained page beside the current one for a centre drop instead of replacing it on screen', async () => {
    const flush = vi.fn(async () => {})
    const { result } = await twoPanes(flush)
    await act(() => result.current.splitWorkspace.closePane(1))
    expect(result.current.splitWorkspace).toMatchObject({ split: false, activePane: 0 })
    const [current, retained] = result.current.tabs
    const loads = vi.mocked(mockInvoke).mock.calls.length
    flush.mockClear()
    await act(() => result.current.splitWorkspace.placeNote(entries[1], { pane: 0 }))
    expect(result.current.splitWorkspace).toMatchObject({ split: true, activePane: 1, paths: [entries[0].path, entries[1].path] })
    expect(result.current.tabs[0]).toBe(current)
    expect(result.current.tabs[1]).toBe(retained)
    expect(flush).not.toHaveBeenCalled()
    expect(vi.mocked(mockInvoke).mock.calls.length).toBe(loads)
  })

  it('keeps every page, the layout and the active pane when saving the replaced page fails', async () => {
    const flush = vi.fn(async () => {})
    const { result } = await twoPanes(flush)
    flush.mockRejectedValue(new Error('Disk full'))
    let placed: boolean | undefined
    await act(async () => { placed = await result.current.splitWorkspace.placeNote(entries[2], { edge: 'top' }) })
    expect(placed).toBe(false)
    expect(result.current.splitWorkspace).toMatchObject({ paths: [entries[0].path, entries[1].path], orientation: 'horizontal', activePane: 1 })
  })

  it('keeps the replaced page when the dropped note cannot be read', async () => {
    const read = vi.mocked(mockInvoke).getMockImplementation()!
    vi.mocked(mockInvoke).mockImplementation((command, args) => ((args as { path?: string } | undefined)?.path === entries[2].path
      ? Promise.reject(new Error('read failed'))
      : read(command, args)))
    try {
      const flush = vi.fn(async () => {})
      const onUnreadableNoteContent = vi.fn()
      const { result } = await twoPanes(flush, onUnreadableNoteContent)
      const replacedTab = result.current.tabs[1]
      let placed: boolean | undefined
      await act(async () => { placed = await result.current.splitWorkspace.placeNote(entries[2], { edge: 'right' }) })
      expect(placed).toBe(false)
      expect(flush).toHaveBeenLastCalledWith(entries[1].path, entries[2].path)
      expect(onUnreadableNoteContent).toHaveBeenCalledWith(expect.objectContaining({ path: entries[2].path }), expect.any(Error))
      expect(result.current.splitWorkspace.paths).toEqual([entries[0].path, entries[1].path])
      expect(result.current.tabs[1]).toBe(replacedTab)
    } finally { vi.mocked(mockInvoke).mockImplementation(read) }
  }, 10_000)

  it('stays quiet when a dropped note fails to load after its drop was superseded', async () => {
    const read = vi.mocked(mockInvoke).getMockImplementation()!
    let fail!: (error: Error) => void
    const gate = new Promise<string>((_resolve, reject) => { fail = reject })
    gate.catch(() => {})
    vi.mocked(mockInvoke).mockImplementation((command, args) => ((args as { path?: string } | undefined)?.path === entries[2].path ? gate : read(command, args)))
    try {
      const onUnreadableNoteContent = vi.fn()
      const { result } = await twoPanes(vi.fn(async () => {}), onUnreadableNoteContent)
      let placing!: Promise<boolean>
      act(() => { placing = result.current.splitWorkspace.placeNote(entries[2], { edge: 'right' }) })
      await waitFor(() => expect(vi.mocked(mockInvoke).mock.calls.some(([, args]) => (args as { path?: string }).path === entries[2].path)).toBe(true))
      act(() => { result.current.splitWorkspace.placePane(0, 'right') })
      await act(async () => { fail(new Error('read failed')); await placing })
      await expect(placing).resolves.toBe(false)
      expect(onUnreadableNoteContent).not.toHaveBeenCalled()
    } finally { vi.mocked(mockInvoke).mockImplementation(read) }
  }, 10_000)

  it('keeps the replaced page showing while the dropped note is still loading', async () => {
    const read = holdRead(entries[2].path)
    try {
      const { result } = await twoPanes()
      const replacedTab = result.current.tabs[1]
      let placing!: Promise<boolean>
      act(() => { placing = result.current.splitWorkspace.placeNote(entries[2], { edge: 'right' }) })
      await waitFor(() => expect(vi.mocked(mockInvoke).mock.calls.some(([, args]) => (args as { path?: string }).path === entries[2].path)).toBe(true))
      expect(result.current.splitWorkspace.paths).toEqual([entries[0].path, entries[1].path])
      expect(result.current.tabs[1]).toBe(replacedTab)
      await act(async () => { read.release('# three'); await placing })
      expect(result.current.splitWorkspace.paths).toEqual([entries[0].path, entries[2].path])
    } finally { read.restore() }
  })

  it('lets a newer request for the same pane win over a slower drop', async () => {
    const read = holdRead(entries[2].path)
    try {
      const flush = vi.fn(async () => {})
      const { result } = await twoPanes(flush)
      let placing!: Promise<boolean>
      act(() => { placing = result.current.splitWorkspace.placeNote(entries[2], { edge: 'right' }) })
      await waitFor(() => expect(vi.mocked(mockInvoke).mock.calls.some(([, args]) => (args as { path?: string }).path === entries[2].path)).toBe(true))
      // The newer request is still saving the current page when the slow drop finishes.
      let releaseSave!: () => void
      flush.mockImplementationOnce(() => new Promise<void>(resolve => { releaseSave = resolve }))
      const later = entry('four')
      let selecting!: Promise<void>
      act(() => { selecting = result.current.splitWorkspace.selectNoteInPane(later, 1) })
      await act(async () => { read.release('# three'); await placing })
      await expect(placing).resolves.toBe(false)
      expect(result.current.splitWorkspace.paths[1]).not.toBe(entries[2].path)
      // The cancelled drop must not free the pane while the newer request is still saving.
      expect(result.current.splitWorkspace.pendingPanes[1]).toBe(true)
      await act(async () => { releaseSave(); await selecting })
      expect(result.current.splitWorkspace.paths).toEqual([entries[0].path, later.path])
      expect(result.current.splitWorkspace.pendingPanes[1]).toBe(false)
    } finally { read.restore() }
  })

  it('never lets a cancelled drop release a newer request for the same note', async () => {
    const read = holdRead(entries[2].path)
    try {
      const flush = vi.fn(async () => {})
      const { result } = await twoPanes(flush)
      let placing!: Promise<boolean>
      act(() => { placing = result.current.splitWorkspace.placeNote(entries[2], { edge: 'right' }) })
      await waitFor(() => expect(vi.mocked(mockInvoke).mock.calls.some(([, args]) => (args as { path?: string }).path === entries[2].path)).toBe(true))
      let releaseSave!: () => void
      flush.mockImplementationOnce(() => new Promise<void>(resolve => { releaseSave = resolve }))
      let selecting!: Promise<void>
      act(() => { selecting = result.current.splitWorkspace.selectNoteInPane(entries[2], 1) })
      await act(async () => { read.release('# three'); await placing })
      // The newer request still owns the note, so the other pane must not open a second copy.
      await act(() => result.current.splitWorkspace.selectNoteInPane(entries[2], 0))
      expect(result.current.splitWorkspace.paths[0]).toBe(entries[0].path)
      await act(async () => { releaseSave(); await selecting })
      expect(result.current.splitWorkspace.paths).toEqual([entries[0].path, entries[2].path])
    } finally { read.restore() }
  })

  it.each([
    ['removed', entries.slice(0, 2)],
    ['renamed', [...entries.slice(0, 2), { ...entries[2], path: '/vault/three-renamed.md' }]],
  ])('does not open a dropped note that was %s while it was loading', async (_change, changed) => {
    const read = holdRead(entries[2].path)
    try {
      const { result, rerender } = renderHook(({ list }) => useSplitWorkspace({ vaultPath: '/vault', entries: list }), { initialProps: { list: entries } })
      await act(() => result.current.handleSelectNote(entries[0]))
      let placing!: Promise<boolean>
      act(() => { placing = result.current.splitWorkspace.placeNote(entries[2], { edge: 'right' }) })
      rerender({ list: changed })
      await act(async () => { read.release('# three'); await placing })
      await expect(placing).resolves.toBe(false)
      expect(result.current.splitWorkspace).toMatchObject({ split: false, activePane: 0, paths: [entries[0].path, null] })
    } finally { read.restore() }
  })

  it('drops a placement that finishes after the vault was switched', async () => {
    const read = holdRead(entries[2].path)
    try {
      const { result, rerender } = renderHook(({ vault }) => useSplitWorkspace({ vaultPath: vault, entries }), { initialProps: { vault: '/vault' } })
      await act(() => result.current.handleSelectNote(entries[0]))
      let placing!: Promise<boolean>
      act(() => { placing = result.current.splitWorkspace.placeNote(entries[2], { edge: 'right' }) })
      act(() => { result.current.splitWorkspace.suspendPersistence(); result.current.closeAllTabs() })
      rerender({ vault: '/other' })
      await act(async () => { read.release('# three'); await placing })
      await expect(placing).resolves.toBe(false)
      expect(result.current.splitWorkspace).toMatchObject({ split: false, activePane: 0 })
    } finally { read.restore() }
  })
})
