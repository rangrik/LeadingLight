import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import type { VaultEntry } from '../types'
import { useNoteActions, type NoteActionsConfig } from '../hooks/useNoteActions'
import { clearNoteContentCache } from '../hooks/noteContentCache'
import type { ExactPageOutcome } from './exactPage'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({ isTauri: () => true, addMockEntry: vi.fn(), mockInvoke: vi.fn() }))

const note = (path: string): VaultEntry => ({ path, filename: path.split('/').pop()!, title: 'Old', isA: null,
  aliases: [], belongsTo: [], relatedTo: [], status: null, archived: false, modifiedAt: 1, createdAt: 1, fileSize: 1,
  snippet: '', wordCount: 0, relationships: {}, icon: null, color: null, order: null, template: null, sort: null,
  outgoingLinks: [] } as unknown as VaultEntry)
const a = note('/vault/a.md')
const today = '/vault/Daily/2026-10-15.md'
const request = { vaultPath: '/vault', relativePath: 'Daily/2026-10-15.md', title: 'October 15, 2026', content: '# October 15, 2026\n\n' }
const addEntry = vi.fn()
const removeEntry = vi.fn()
const persisted = vi.fn()
const internalWrite = vi.fn()
type Write = { finish: () => void, fail: (error: Error) => void }
let writes: Write[]
let disk: Map<string, string>
let save: (path: string) => Promise<void>

function setup() {
  const config = (vaultPath: string): NoteActionsConfig => ({ addEntry, removeEntry, updateEntry: vi.fn(),
    setToastMessage: vi.fn(), vaultPath, entries: vaultPath === '/vault' ? [a] : [], restoreWorkspace: false,
    flushBeforeNoteSwitch: path => save(path), onNewNotePersisted: persisted, onInternalVaultWrite: internalWrite })
  return renderHook(({ vaultPath }: { vaultPath: string }) => useNoteActions(config(vaultPath)), { initialProps: { vaultPath: '/vault' } })
}
type Hook = ReturnType<typeof setup>
const paths = (hook: Hook) => hook.result.current.splitWorkspace.paths
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
function start(hook: Hook) {
  let outcome: ExactPageOutcome | undefined
  act(() => { void hook.result.current.createPageAt(request).then(value => { outcome = value }) })
  return () => outcome
}

beforeEach(() => {
  vi.clearAllMocks()
  clearNoteContentCache()
  localStorage.clear()
  writes = []
  disk = new Map([[a.path, '# A']])
  save = async () => {}
  vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
    const { path } = args as { path: string }
    if (command === 'create_note_content') return new Promise<void>((finish, fail) => writes.push({ finish, fail }))
    if (command === 'get_note_content') {
      if (!disk.has(path)) throw new Error('missing')
      return disk.get(path)
    }
    if (command === 'reload_vault_entry') {
      if (!disk.has(path)) throw new Error('missing')
      return note(path)
    }
    return undefined
  })
})

describe('exact page creation', () => {
  it('lists and binds the page only after the disk write succeeds', async () => {
    const hook = setup()
    await act(() => hook.result.current.handleSelectNote(a))
    const outcome = start(hook)
    await settle()
    expect(addEntry).not.toHaveBeenCalled()
    expect(paths(hook)).toEqual([a.path, null])
    await act(async () => writes[0].finish())
    await settle()
    expect(addEntry).toHaveBeenCalledWith(expect.objectContaining({ path: today, isA: null }))
    expect(persisted).toHaveBeenCalledWith(today)
    expect(paths(hook)).toEqual([today, null])
    expect(outcome()).toBe('opened')
  })

  it('opens the file already at the path instead of replacing it', async () => {
    const hook = setup()
    const outcome = start(hook)
    disk.set(today, '# Written elsewhere')
    await act(async () => writes[0].fail(new Error('File already exists')))
    await settle()
    expect(removeEntry).not.toHaveBeenCalled()
    expect(persisted).not.toHaveBeenCalled()
    expect(addEntry).toHaveBeenCalledWith(expect.objectContaining({ path: today, title: 'Old' }))
    expect(hook.result.current.tabs.find(tab => tab.entry.path === today)?.content).toBe('# Written elsewhere')
    expect(outcome()).toBe('opened')
  })

  it('reports a refused write with no file as failed and changes nothing', async () => {
    const hook = setup()
    await act(() => hook.result.current.handleSelectNote(a))
    const outcome = start(hook)
    await act(async () => writes[0].fail(new Error('Permission denied')))
    await settle()
    expect(addEntry).not.toHaveBeenCalled()
    expect(removeEntry).not.toHaveBeenCalled()
    expect(paths(hook)).toEqual([a.path, null])
    expect(outcome()).toBe('failed')
  })

  it.each([
    ['succeeds', (write: Write) => write.finish()],
    ['collides', (write: Write) => { disk.set(today, '# Elsewhere'); write.fail(new Error('exists')) }],
  ])('keeps a write that %s after leaving and returning to the vault out of the new session', async (_, finish) => {
    const hook = setup()
    const outcome = start(hook)
    act(() => hook.result.current.closeAllTabs())
    hook.rerender({ vaultPath: '/other' })
    hook.rerender({ vaultPath: '/vault' })
    await act(async () => finish(writes[0]))
    await settle()
    expect(addEntry).not.toHaveBeenCalled()
    expect(removeEntry).not.toHaveBeenCalled()
    expect(persisted).not.toHaveBeenCalled()
    expect(paths(hook)).toEqual([null, null])
    expect(outcome()).toBe('created')
  })

  it('keeps the current page when it cannot be saved first, and says the page was only created', async () => {
    const hook = setup()
    await act(() => hook.result.current.handleSelectNote(a))
    save = async () => { throw new Error('disk full') }
    const outcome = start(hook)
    await act(async () => writes[0].finish())
    await settle()
    expect(paths(hook)).toEqual([a.path, null])
    expect(addEntry).toHaveBeenCalledWith(expect.objectContaining({ path: today }))
    expect(outcome()).toBe('created')
  })
})
