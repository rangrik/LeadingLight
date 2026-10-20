import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useSplitWorkspace } from './useSplitWorkspace'
import { clearPrefetchCache } from '../hooks/useTabManagement'
import { mockInvoke } from '../mock-tauri'
import type { VaultEntry } from '../types'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({ isTauri: () => false, mockInvoke: vi.fn() }))

const note = (name: string, extra: Partial<VaultEntry> = {}): VaultEntry => ({ path: `/vault/${name}.md`, filename: `${name}.md`,
  title: name, isA: 'Note', aliases: [], belongsTo: [], relatedTo: [], status: null, archived: false, modifiedAt: 1, createdAt: 1,
  fileSize: 1, snippet: '', wordCount: 0, relationships: {}, icon: null, color: null, order: null, sidebarLabel: null, template: null, sort: null,
  view: null, visible: null, organized: false, favorite: false, favoriteIndex: null, listPropertiesDisplay: [], properties: {}, hasH1: true,
  outgoingLinks: [], ...extra })
const [a, b, c] = ['a', 'b', 'c'].map(name => note(name))
const entries = [a, b, c]
type Read = { resolve: (content: string) => void; reject: (error: Error) => void }
let holding: Set<string>
let failing: Set<string>
let held: Map<string, Read>
const hold = (path: string) => holding.add(path)

beforeEach(() => {
  localStorage.clear()
  clearPrefetchCache()
  holding = new Set()
  failing = new Set()
  held = new Map()
  vi.mocked(mockInvoke).mockImplementation(async (command: string, args?: unknown) => {
    const path = (args as { path: string }).path
    if (command === 'get_note_content' && failing.has(path)) throw new Error('unreadable')
    if (command !== 'get_note_content' || !holding.delete(path)) return `# ${path}`
    return new Promise((resolve, reject) => held.set(path, { resolve, reject }))
  })
})

describe('finder selection', () => {
  const setup = (beforeNavigate = vi.fn(async () => {})) =>
    renderHook(() => useSplitWorkspace({ vaultPath: '/vault', entries, beforeNavigate, restoreWorkspace: false }))
  type Hook = ReturnType<typeof setup>
  const select = (hook: Hook, entry: VaultEntry) => hook.result.current.splitWorkspace.openNoteWhenLoaded(entry)
  async function pendingDrop(hook: Hook, entry: VaultEntry) {
    hold(entry.path)
    let pending: Promise<boolean> = Promise.resolve(false)
    act(() => { pending = hook.result.current.splitWorkspace.placeNote(entry, { pane: 0 }) })
    await waitFor(() => expect(held.has(entry.path)).toBe(true))
    return { pending }
  }
  const choose = async (hook: Hook, entry: VaultEntry) => {
    let chosen: boolean | undefined
    await act(async () => { chosen = await select(hook, entry) })
    return chosen
  }

  it('does not report a page that is still loading as opened', async () => {
    const hook = setup()
    await act(() => hook.result.current.handleSelectNote(a))
    const { pending } = await pendingDrop(hook, b)
    expect(await choose(hook, b)).toBe(false)
    failing.add(b.path)
    await act(async () => { held.get(b.path)!.reject(new Error('unreadable')); await pending })
    expect(hook.result.current.splitWorkspace.paths).toEqual([a.path, null])
    expect(hook.result.current.splitWorkspace.pendingPanes).toEqual([false, false])
  })

  it('choosing the page already shown cancels its pending replacement', async () => {
    const hook = setup()
    await act(() => hook.result.current.handleSelectNote(a))
    const { pending } = await pendingDrop(hook, b)
    expect(await choose(hook, a)).toBe(true)
    await act(async () => { held.get(b.path)!.resolve('# b'); await pending })
    expect(hook.result.current.splitWorkspace.paths).toEqual([a.path, null])
    expect(hook.result.current.activeTabPath).toBe(a.path)
    expect(hook.result.current.splitWorkspace.pendingPanes).toEqual([false, false])
  })

  it('keeps the current page when it cannot be saved', async () => {
    const hook = setup(vi.fn(async () => { throw new Error('disk full') }))
    await act(() => hook.result.current.handleSelectNote(a))
    expect(await choose(hook, b)).toBe(false)
    expect(hook.result.current.splitWorkspace.paths).toEqual([a.path, null])
    expect(hook.result.current.splitWorkspace.pendingPanes).toEqual([false, false])
  })

  it('focuses the other pane when it already shows the page', async () => {
    const hook = setup()
    await act(() => hook.result.current.handleSelectNote(a))
    act(() => hook.result.current.splitWorkspace.openSplit('horizontal'))
    await act(() => hook.result.current.handleSelectNote(b))
    act(() => hook.result.current.splitWorkspace.focusPane(0))
    expect(await choose(hook, b)).toBe(true)
    expect(hook.result.current.splitWorkspace.activePane).toBe(1)
    expect(hook.result.current.splitWorkspace.paths).toEqual([a.path, b.path])
  })

  it('a keyboard command commits the switch to the pane already showing the page before it returns', async () => {
    const hook = setup()
    await act(() => hook.result.current.handleSelectNote(a))
    act(() => hook.result.current.splitWorkspace.openSplit('horizontal'))
    await act(() => hook.result.current.handleSelectNote(b))
    act(() => hook.result.current.splitWorkspace.focusPane(0))
    let activeOnReturn: number | undefined
    act(() => {
      void hook.result.current.splitWorkspace.openNoteWhenLoaded(b, { commitNow: true })
      activeOnReturn = hook.result.current.splitWorkspace.activePane
    })
    expect(activeOnReturn).toBe(1)
  })

  it.each([['a binary file', { ...c, fileKind: 'binary' as const }], ['an unlisted page', note('gone')]])('reports %s as not opened', async (_name, entry) => {
    const hook = setup()
    await act(() => hook.result.current.handleSelectNote(a))
    expect(await choose(hook, entry)).toBe(false)
    expect(hook.result.current.splitWorkspace.paths).toEqual([a.path, null])
  })
})

describe('rename provenance', () => {
  it('marks an in-place rename with its previous path, and a navigation without one', async () => {
    const hook = renderHook(() => useSplitWorkspace({ vaultPath: '/vault', entries, restoreWorkspace: false }))
    await act(() => hook.result.current.handleSelectNote(a))
    act(() => hook.result.current.setTabs(tabs => tabs.map(tab => ({ ...tab, entry: { ...tab.entry, path: '/vault/trip.md' } }))))
    expect(hook.result.current.tabs).toMatchObject([{ entry: { path: '/vault/trip.md' }, renamedFrom: a.path }])
    await act(() => hook.result.current.handleSelectNote(b))
    expect(hook.result.current.tabs[0].renamedFrom).toBeUndefined()
  })
})

describe('reserved creation open', () => {
  const created = note('created')
  const all = [...entries, created]

  it('supersedes an older read still loading in the pane', async () => {
    const hook = renderHook(() => useSplitWorkspace({ vaultPath: '/vault', entries: all, restoreWorkspace: false }))
    await act(() => hook.result.current.handleSelectNote(a))
    hold(b.path)
    let selecting: Promise<void> = Promise.resolve()
    act(() => { selecting = hook.result.current.handleSelectNote(b) })
    await waitFor(() => expect(held.has(b.path)).toBe(true))
    const target = hook.result.current.reserveOpen()
    await act(async () => { expect(await target.open(created, '# created')).toBe(true) })
    await act(async () => { held.get(b.path)!.resolve('# b'); await selecting })
    expect(hook.result.current.activeTabPath).toBe(created.path)
    expect(hook.result.current.tabs.map(tab => tab.entry.path)).toEqual([created.path])
  })

  it('places nothing when the caller’s own guard turns false while the outgoing page saves', async () => {
    const saves: (() => void)[] = []
    const beforeNavigate = () => new Promise<void>(resolve => { saves.push(resolve) })
    const hook = renderHook(() => useSplitWorkspace({ vaultPath: '/vault', entries: all, restoreWorkspace: false, beforeNavigate }))
    await act(() => hook.result.current.handleSelectNote(a))
    let wanted = true
    let opening: Promise<boolean> = Promise.resolve(true)
    act(() => { opening = hook.result.current.reserveOpen().open(created, '# created', () => wanted) })
    // Page a is being saved before the swap; placement waits for it.
    await waitFor(() => expect(saves.length).toBe(1))
    // An extension run revoked or cancelled before placement: the reservation's own checks still pass.
    wanted = false
    let shown = true
    await act(async () => { saves[0](); shown = await opening })
    expect(shown).toBe(false)
    expect(hook.result.current.splitWorkspace.paths).toEqual([a.path, null])
    expect(hook.result.current.activeTabPath).toBe(a.path)
    expect(hook.result.current.splitWorkspace.pendingPanes).toEqual([false, false])
  })

  it('opens when the caller’s guard still holds at placement, and refuses one already false', async () => {
    const hook = renderHook(() => useSplitWorkspace({ vaultPath: '/vault', entries: all, restoreWorkspace: false }))
    await act(() => hook.result.current.handleSelectNote(a))
    let refused = true
    await act(async () => { refused = await hook.result.current.reserveOpen().open(created, '# created', () => false) })
    expect(refused).toBe(false)
    expect(hook.result.current.activeTabPath).toBe(a.path)
    let shown = false
    await act(async () => { shown = await hook.result.current.reserveOpen().open(created, '# created', () => true) })
    expect(shown).toBe(true)
    expect(hook.result.current.activeTabPath).toBe(created.path)
  })

  it('a cancelled open does not release a newer request for the same page', async () => {
    const saves: (() => void)[] = []
    const beforeNavigate = () => new Promise<void>(resolve => { saves.push(resolve) })
    const hook = renderHook(() => useSplitWorkspace({ vaultPath: '/vault', entries: all, restoreWorkspace: false, beforeNavigate }))
    await act(() => hook.result.current.handleSelectNote(a))
    act(() => hook.result.current.splitWorkspace.openSplit('horizontal'))
    act(() => hook.result.current.splitWorkspace.focusPane(0))
    const target = hook.result.current.reserveOpen()
    let opening: Promise<boolean> = Promise.resolve(false)
    let selecting: Promise<void> = Promise.resolve()
    act(() => { opening = target.open(created, '# created') })
    act(() => { selecting = hook.result.current.splitWorkspace.selectNoteInPane(created, 0) })
    await act(async () => { saves[0](); await opening })
    act(() => hook.result.current.splitWorkspace.focusPane(1))
    let duplicate = true
    await act(async () => { duplicate = await hook.result.current.splitWorkspace.openNoteWhenLoaded(created) })
    await act(async () => { saves[1](); await selecting })
    expect(duplicate).toBe(false)
    expect(hook.result.current.splitWorkspace.paths).toEqual([created.path, null])
  })
})

// Seam: a draft may hand over only while the command still owns its pane; a later visit must not count.
describe('command navigation mark', () => {
  const created = note('created')
  const setup = () => renderHook(({ vaultPath }) => useSplitWorkspace({ vaultPath, entries: [...entries, created], restoreWorkspace: false }),
    { initialProps: { vaultPath: '/vault' } })

  it('survives its own creation open but not navigation, closing the pane or leaving and returning to the vault', async () => {
    const hook = setup()
    await act(() => hook.result.current.handleSelectNote(a))
    const mark = hook.result.current.splitWorkspace.markNavigation()
    await act(async () => { await hook.result.current.reserveOpen().open(created, '') })
    expect(mark.current()).toBe(true)
    await act(() => hook.result.current.handleSelectNote(b))
    await act(() => hook.result.current.handleSelectNote(created))
    expect(mark.current()).toBe(false)

    act(() => hook.result.current.splitWorkspace.openSplit('horizontal'))
    const second = hook.result.current.splitWorkspace.markNavigation()
    await act(() => hook.result.current.splitWorkspace.closePane(second.pane as 0 | 1))
    expect(second.current()).toBe(false)

    const returning = hook.result.current.splitWorkspace.markNavigation()
    hook.rerender({ vaultPath: '/other' })
    hook.rerender({ vaultPath: '/vault' })
    expect(returning.current()).toBe(false)
  })
})

describe('restore readiness', () => {
  const saveLayout = () => localStorage.setItem('leadinglight.workspace:/vault', JSON.stringify({ paths: [a.path, b.path], active: 1, split: true }))
  const restoring = (ready = true) => renderHook(({ vaultPath, ready }) => useSplitWorkspace({ vaultPath, entries, isVaultLoading: !ready }),
    { initialProps: { vaultPath: '/vault', ready } })
  type Hook = ReturnType<typeof restoring>
  const ready = (hook: Hook) => hook.result.current.splitWorkspace.readyForVisits
  async function leaveAndReturn(hook: Hook) {
    act(() => {
      hook.result.current.splitWorkspace.suspendPersistence()
      hook.result.current.closeAllTabs()
    })
    // The app's vault switch clears cached and in-flight note reads.
    clearPrefetchCache()
    hook.rerender({ vaultPath: '/other', ready: false })
    expect(ready(hook)).toBe(false)
    await act(async () => { hook.rerender({ vaultPath: '/vault', ready: true }) })
  }

  it('stays unready until restore settles and keeps a page the user chose meanwhile', async () => {
    saveLayout()
    hold(b.path)
    const hook = restoring()
    await waitFor(() => expect(hook.result.current.tabs.map(tab => tab.entry.path)).toEqual([a.path]))
    expect(ready(hook)).toBe(false)
    act(() => hook.result.current.splitWorkspace.focusPane(0))
    await act(async () => { held.get(b.path)!.resolve('# b') })
    await waitFor(() => expect(ready(hook)).toBe(true))
    expect(hook.result.current.splitWorkspace.activePane).toBe(0)
    expect(hook.result.current.activeTabPath).toBe(a.path)
  })

  it('restores again after leaving for an unready vault and returning', async () => {
    saveLayout()
    const hook = restoring()
    await waitFor(() => expect(hook.result.current.tabs).toHaveLength(2))
    await leaveAndReturn(hook)
    await waitFor(() => expect(hook.result.current.tabs).toHaveLength(2))
    expect(hook.result.current.activeTabPath).toBe(b.path)
    expect(ready(hook)).toBe(true)
  })

  it('ignores a restore from an earlier visit that finishes after returning', async () => {
    saveLayout()
    hold(b.path)
    const hook = restoring()
    await waitFor(() => expect(held.has(b.path)).toBe(true))
    const earlier = held.get(b.path)!
    held.delete(b.path)
    hold(b.path)
    await leaveAndReturn(hook)
    await waitFor(() => expect(held.has(b.path)).toBe(true))
    await act(async () => { earlier.resolve('# b') })
    expect(ready(hook)).toBe(false)
    await act(async () => { held.get(b.path)!.resolve('# b') })
    await waitFor(() => expect(ready(hook)).toBe(true))
    expect(hook.result.current.splitWorkspace.paths).toEqual([a.path, b.path])
  })

  it.each([
    ['nothing was saved', () => {}, async () => {}],
    ['a saved page cannot be read', () => { saveLayout(); hold(b.path) }, async () => {
      await waitFor(() => expect(held.has(b.path)).toBe(true))
      await act(async () => { held.get(b.path)!.reject(new Error('unreadable')) })
    }],
  ])('becomes ready when %s', async (_name, arrange, settle) => {
    arrange()
    const hook = restoring()
    await settle()
    await waitFor(() => expect(ready(hook)).toBe(true))
  })

  it('becomes ready after restore skips a pane the user filled before the listing was ready', async () => {
    saveLayout()
    const hook = restoring(false)
    await act(() => hook.result.current.handleSelectNote(c))
    hook.rerender({ vaultPath: '/vault', ready: true })
    await waitFor(() => expect(ready(hook)).toBe(true))
    expect(hook.result.current.splitWorkspace.paths[0]).toBe(c.path)
  })

  it('is always ready when restoration is off', () => {
    const hook = renderHook(() => useSplitWorkspace({ vaultPath: '/vault', entries, restoreWorkspace: false }))
    expect(hook.result.current.splitWorkspace.readyForVisits).toBe(true)
  })
})
