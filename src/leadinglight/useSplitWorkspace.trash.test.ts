import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import type { VaultEntry } from '../types'
import { useNoteActions, type NoteActionsConfig } from '../hooks/useNoteActions'
import { clearNoteContentCache } from '../hooks/noteContentCache'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({ isTauri: () => true, addMockEntry: vi.fn(), mockInvoke: vi.fn() }))

const note = (name: string): VaultEntry => ({ path: `/vault/${name}.md`, filename: `${name}.md`, title: name, isA: 'Note',
  aliases: [], belongsTo: [], relatedTo: [], status: null, archived: false, modifiedAt: 1, createdAt: 1, fileSize: 1,
  snippet: '', wordCount: 0, relationships: {}, icon: null, color: null, order: null, template: null, sort: null,
  outgoingLinks: [] } as unknown as VaultEntry)
const [a, b, c] = [note('a'), note('b'), note('c')]
let heldReads: Map<string, () => void>

function setup() {
  const config: NoteActionsConfig = { addEntry: vi.fn(), removeEntry: vi.fn(), updateEntry: vi.fn(), setToastMessage: vi.fn(),
    vaultPath: '/vault', entries: [a, b, c], restoreWorkspace: false }
  return renderHook(() => useNoteActions(config))
}
type Hook = ReturnType<typeof setup>
const workspace = (hook: Hook) => hook.result.current.splitWorkspace
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

beforeEach(() => {
  vi.clearAllMocks()
  clearNoteContentCache()
  localStorage.clear()
  heldReads = new Map()
  vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
    const { path } = args as { path: string }
    if (command !== 'get_note_content') return undefined
    if (path === c.path) return new Promise(resolve => heldReads.set(path, () => resolve('# c')))
    return `# ${path}`
  })
})

describe('closing pages moved to Trash', () => {
  it('empties only the pane showing the page and keeps the layout and other pane', async () => {
    const hook = setup()
    await act(() => hook.result.current.handleSelectNote(a))
    act(() => workspace(hook).openSplit('horizontal'))
    await act(() => hook.result.current.handleSelectNote(b))
    act(() => workspace(hook).closePages([a.path]))
    await settle()
    expect(workspace(hook).paths).toEqual([null, b.path])
    expect(workspace(hook).split).toBe(true)
    expect(workspace(hook).activePane).toBe(1)
    expect(workspace(hook).currentTabs().map(tab => tab.entry.path)).toEqual([b.path])
  })

  it('cancels a pending open of a moved page and keeps the page already shown', async () => {
    const hook = setup()
    await act(() => hook.result.current.handleSelectNote(a))
    act(() => { void hook.result.current.handleSelectNote(c) })
    await settle()
    act(() => workspace(hook).closePages([c.path]))
    await act(async () => heldReads.get(c.path)?.())
    await settle()
    expect(workspace(hook).paths).toEqual([a.path, null])
  })

  it('clears a moved page kept behind a closed pane, so reopening shows no stale page', async () => {
    const hook = setup()
    await act(() => hook.result.current.handleSelectNote(a))
    act(() => workspace(hook).openSplit('horizontal'))
    await act(() => hook.result.current.handleSelectNote(b))
    await act(() => workspace(hook).closePane(1))
    act(() => workspace(hook).closePages([b.path]))
    act(() => workspace(hook).openSplit('horizontal'))
    await settle()
    expect(workspace(hook).paths).toEqual([a.path, null])
  })
})
