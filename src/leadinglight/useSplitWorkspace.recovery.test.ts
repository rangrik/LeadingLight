import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useSplitWorkspace } from './useSplitWorkspace'
import { clearPrefetchCache } from '../hooks/useTabManagement'
import type { OpenReservation } from '../hooks/useNoteCreation'
import { mockInvoke } from '../mock-tauri'
import type { VaultEntry } from '../types'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({ isTauri: () => false, mockInvoke: vi.fn() }))

const note = (name: string): VaultEntry => ({ path: `/vault/${name}.md`, filename: `${name}.md`,
  title: name, isA: 'Note', aliases: [], belongsTo: [], relatedTo: [], status: null, archived: false, modifiedAt: 1, createdAt: 1,
  fileSize: 1, snippet: '', wordCount: 0, relationships: {}, icon: null, color: null, order: null, sidebarLabel: null, template: null, sort: null,
  view: null, visible: null, organized: false, favorite: false, favoriteIndex: null, listPropertiesDisplay: [], properties: {}, hasH1: true,
  outgoingLinks: [] })
const [a, b, c] = ['a', 'b', 'c'].map(note)
// The kept copy is not in the listing yet; the reservation must not need it there.
const copy = note('a-2')
let holding: Set<string>
let held: Map<string, (content: string) => void>

beforeEach(() => {
  localStorage.clear()
  clearPrefetchCache()
  holding = new Set()
  held = new Map()
  vi.mocked(mockInvoke).mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    const path = String(args?.path)
    if (command === 'get_note_content' && holding.delete(path)) return new Promise(resolve => held.set(path, resolve))
    return `# ${path}`
  })
})

const setup = () => renderHook(({ vaultPath }) => useSplitWorkspace({ vaultPath, entries: [a, b, c], restoreWorkspace: false }),
  { initialProps: { vaultPath: '/vault' } })
type Hook = ReturnType<typeof setup>

/** Original `a` in pane 0; the person has moved on to `b` in pane 1, which is active. */
async function originalBesideActiveOther() {
  const hook = setup()
  await act(() => hook.result.current.handleSelectNote(a))
  act(() => hook.result.current.splitWorkspace.openSplit('horizontal'))
  await act(() => hook.result.current.handleSelectNote(b))
  return hook
}
function closeAndReserve(hook: Hook, path: string) {
  let target: OpenReservation | null = null
  act(() => { target = hook.result.current.splitWorkspace.closePageAndReserveOpen(path) })
  return target as OpenReservation | null
}
async function openIn(target: OpenReservation | null) {
  let opened: boolean | undefined
  await act(async () => { opened = await target?.open(copy, '# copy') })
  return opened
}

// Seam: recovery's close-and-reserve in the split controller. Catches the replacement landing in
// whichever pane is active, its own close cancelling it, or it surviving later navigation.
describe('recovery close and reserve', () => {
  it('closes the original in its own pane and opens the copy there, leaving the active other pane alone', async () => {
    const hook = await originalBesideActiveOther()
    const target = closeAndReserve(hook, a.path)
    expect(hook.result.current.splitWorkspace.paths).toEqual([null, b.path])
    expect(target?.isActive()).toBe(false)

    expect(await openIn(target)).toBe(true)
    expect(hook.result.current.splitWorkspace.paths).toEqual([copy.path, b.path])
    expect(hook.result.current.splitWorkspace.activePane).toBe(1)
    expect(hook.result.current.activeTabPath).toBe(b.path)
    expect(hook.result.current.tabs).toContainEqual(expect.objectContaining({ entry: b, content: `# ${b.path}` }))
  })

  it.each([
    ['navigation in that pane', async (hook: Hook) => { await act(() => hook.result.current.splitWorkspace.selectNoteInPane(c, 0)) }],
    ['closing that pane', async (hook: Hook) => { await act(() => hook.result.current.splitWorkspace.closePane(0)) }],
    ['leaving and returning to the vault', async (hook: Hook) => { hook.rerender({ vaultPath: '/other' }); hook.rerender({ vaultPath: '/vault' }) }],
  ])('is canceled by %s', async (_name, interrupt) => {
    const hook = await originalBesideActiveOther()
    const target = closeAndReserve(hook, a.path)
    await interrupt(hook)
    expect(await openIn(target)).toBe(false)
    expect(hook.result.current.splitWorkspace.paths).not.toContain(copy.path)
  })

  it('returns no reservation when no pane shows the page, still canceling its pending open', async () => {
    const hook = await originalBesideActiveOther()
    holding.add(c.path)
    let selecting: Promise<void> = Promise.resolve()
    act(() => { selecting = hook.result.current.splitWorkspace.selectNoteInPane(c, 1) })
    await waitFor(() => expect(held.has(c.path)).toBe(true))

    expect(closeAndReserve(hook, c.path)).toBeNull()
    await act(async () => { held.get(c.path)?.('# c'); await selecting })
    expect(hook.result.current.splitWorkspace.paths).toEqual([a.path, b.path])
    expect(hook.result.current.splitWorkspace.activePane).toBe(1)
  })

  it('leaves the creation reservation on the active pane', async () => {
    const hook = await originalBesideActiveOther()
    let opened = false
    await act(async () => { opened = await hook.result.current.reserveOpen().open(copy, '# copy') })
    expect(opened).toBe(true)
    expect(hook.result.current.splitWorkspace.paths).toEqual([a.path, copy.path])
  })
})
