import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import type { VaultEntry } from '../types'
import { useNoteActions, type NoteActionsConfig } from './useNoteActions'
import { clearNoteContentCache } from './noteContentCache'
import { RAPID_CREATE_NOTE_SETTLE_MS } from './useNoteCreation'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({ isTauri: () => true, addMockEntry: vi.fn(), mockInvoke: vi.fn() }))

const note = (name: string): VaultEntry => ({ path: `/vault/${name}.md`, filename: `${name}.md`, title: name,
  isA: 'Note', aliases: [], belongsTo: [], relatedTo: [], status: null, archived: false, modifiedAt: 1, createdAt: 1,
  fileSize: 1, snippet: '', wordCount: 0, relationships: {}, icon: null, color: null, order: null, template: null,
  sort: null, outgoingLinks: [] })
const [a, b] = [note('a'), note('b')]
const addEntry = vi.fn()
const setToastMessage = vi.fn()
const focusRequests: (string | null)[] = []
window.addEventListener('laputa:focus-editor', event => focusRequests.push((event as CustomEvent).detail.path))
type Write = { path: string; vaultPath?: string; finish: () => void; fail: (error: Error) => void }
let writes: Write[] = []
let heldReads: Set<string>
let reads: Map<string, () => void>

function setup(flush: (path: string) => Promise<void> = async () => {}, restoreWorkspace = false, loading = false) {
  const config = (vaultPath: string, isVaultLoading?: boolean): NoteActionsConfig => ({ addEntry, removeEntry: vi.fn(),
    updateEntry: vi.fn(), setToastMessage, vaultPath, entries: vaultPath === '/vault' ? [a, b] : [], restoreWorkspace,
    isVaultLoading, flushBeforeNoteSwitch: flush })
  return renderHook(({ vaultPath, loading }: { vaultPath: string; loading?: boolean }) => useNoteActions(config(vaultPath, loading)),
    { initialProps: { vaultPath: '/vault', loading } })
}
type Hook = ReturnType<typeof setup>
const paths = (hook: Hook) => hook.result.current.splitWorkspace.paths
const created = (index = 0) => addEntry.mock.calls[index]?.[0]?.path
const settle = (ms = 0) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) })
const deferred = () => {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

async function splitAB(hook: Hook) {
  await act(() => hook.result.current.handleSelectNote(a))
  act(() => hook.result.current.splitWorkspace.openSplit('horizontal'))
  await act(() => hook.result.current.handleSelectNote(b))
  act(() => hook.result.current.splitWorkspace.focusPane(0))
}
function leaveVault(hook: Hook, ...route: string[]) {
  act(() => hook.result.current.closeAllTabs())
  for (const vaultPath of route) hook.rerender({ vaultPath })
}

beforeEach(() => {
  vi.clearAllMocks()
  clearNoteContentCache()
  localStorage.clear()
  focusRequests.length = 0
  writes = []
  heldReads = new Set()
  reads = new Map()
  vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
    const request = args as { path: string; vaultPath?: string }
    if (command === 'create_note_content') {
      return new Promise<void>((resolve, reject) => writes.push({ ...request, finish: resolve, fail: reject }))
    }
    if (command === 'get_note_content' && heldReads.delete(request.path)) {
      return new Promise<string>(resolve => reads.set(request.path, () => resolve(`# ${request.path}`)))
    }
    if (command === 'get_note_content') return `# ${request.path}`
    return undefined
  })
})

describe('immediate creation destination', () => {
  it('focuses only after the new page is actually shown', async () => {
    const save = deferred()
    const hook = setup(() => save.promise)
    await act(() => hook.result.current.handleSelectNote(a))
    act(() => hook.result.current.handleCreateNoteImmediate())
    await act(async () => writes[0].finish())
    await settle()
    expect(paths(hook)).toEqual([a.path, null])
    expect(focusRequests).toEqual([])
    await act(async () => save.resolve())
    await settle()
    expect(paths(hook)).toEqual([created(), null])
    expect(focusRequests).toEqual([created()])
  })

  it('opens in its own pane without taking focus when only focus moved', async () => {
    const hook = setup()
    await splitAB(hook)
    act(() => hook.result.current.handleCreateNoteImmediate())
    act(() => hook.result.current.splitWorkspace.focusPane(1))
    await act(async () => writes[0].finish())
    await settle()
    expect(paths(hook)).toEqual([created(), b.path])
    expect(hook.result.current.splitWorkspace.activePane).toBe(1)
    expect(focusRequests).toEqual([])
  })

  it('keeps a page opened in the same pane meanwhile and still lists the note', async () => {
    const hook = setup()
    await act(() => hook.result.current.handleSelectNote(a))
    act(() => hook.result.current.handleCreateNoteImmediate())
    await act(() => hook.result.current.handleSelectNote(b))
    await act(async () => writes[0].finish())
    await settle()
    expect(paths(hook)).toEqual([b.path, null])
    expect(addEntry).toHaveBeenCalledOnce()
    expect(focusRequests).toEqual([])
  })

  it('reports nothing opened when the outgoing page cannot be saved', async () => {
    const hook = setup(async () => { throw new Error('disk full') })
    await act(() => hook.result.current.handleSelectNote(a))
    act(() => hook.result.current.handleCreateNoteImmediate())
    await act(async () => writes[0].finish())
    await settle()
    expect(paths(hook)).toEqual([a.path, null])
    expect(addEntry).toHaveBeenCalledOnce()
    expect(focusRequests).toEqual([])
    expect(setToastMessage).not.toHaveBeenCalled()
  })

  it('does not reopen into a pane closed and reopened meanwhile', async () => {
    const hook = setup()
    await splitAB(hook)
    act(() => hook.result.current.handleCreateNoteImmediate())
    await act(() => hook.result.current.splitWorkspace.closePane(0))
    act(() => hook.result.current.splitWorkspace.openSplit('horizontal'))
    await act(async () => writes[0].finish())
    await settle()
    expect(paths(hook)).toEqual([a.path, b.path])
    expect(addEntry).toHaveBeenCalledOnce()
  })

  it.each([[['/other']], [['/other', '/vault']]])('does not open or list it after leaving the vault via %j', async route => {
    const hook = setup()
    await act(() => hook.result.current.handleSelectNote(a))
    act(() => hook.result.current.handleCreateNoteImmediate())
    leaveVault(hook, ...route)
    await act(async () => writes[0].finish())
    await settle()
    expect(hook.result.current.tabs).toEqual([])
    expect(addEntry).not.toHaveBeenCalled()
    expect(setToastMessage).not.toHaveBeenCalled()
  })

  it('a queued create keeps the pane it was requested in', async () => {
    const hook = setup()
    await splitAB(hook)
    act(() => {
      hook.result.current.handleCreateNoteImmediate()
      hook.result.current.handleCreateNoteImmediate()
    })
    await act(async () => writes[0].finish())
    await settle()
    act(() => hook.result.current.splitWorkspace.focusPane(1))
    await settle(RAPID_CREATE_NOTE_SETTLE_MS + 20)
    await act(async () => writes[1].finish())
    await settle()
    expect(paths(hook)).toEqual([created(1), b.path])
    expect(focusRequests).toEqual([created(0)])
  })

  it('a queued create keeps its vault and is written there', async () => {
    const hook = setup()
    await act(() => hook.result.current.handleSelectNote(a))
    act(() => {
      hook.result.current.handleCreateNoteImmediate()
      hook.result.current.handleCreateNoteImmediate()
    })
    leaveVault(hook, '/other')
    await act(async () => writes[0].finish())
    await settle(RAPID_CREATE_NOTE_SETTLE_MS + 20)
    expect(writes[1]).toMatchObject({ vaultPath: '/vault', path: expect.stringMatching(/^\/vault\//) })
    await act(async () => writes[1].finish())
    await settle()
    expect(hook.result.current.tabs).toEqual([])
    expect(addEntry).not.toHaveBeenCalled()
  })

  it('a burst opens each note in turn and ends on the newest', async () => {
    const hook = setup()
    await act(() => hook.result.current.handleSelectNote(a))
    act(() => {
      hook.result.current.handleCreateNoteImmediate()
      hook.result.current.handleCreateNoteImmediate()
    })
    await act(async () => writes[0].finish())
    await settle(RAPID_CREATE_NOTE_SETTLE_MS + 20)
    await act(async () => writes[1].finish())
    await settle()
    expect(addEntry).toHaveBeenCalledTimes(2)
    expect(paths(hook)).toEqual([created(1), null])
    expect(focusRequests).toEqual([created(0), created(1)])
  })
})

describe('creation during startup restore', () => {
  const saveLayout = () => localStorage.setItem('leadinglight.workspace:/vault', JSON.stringify({ paths: [a.path, null], active: 0 }))
  const finishWrite = async () => { await act(async () => writes[0].finish()); await settle() }
  const finishRestoreRead = async () => { await act(async () => reads.get(a.path)!()); await settle() }
  // The new page owns the pane once, restore settles, and no stale reservation or pending state is left.
  function expectCreationWon(hook: Hook) {
    expect(paths(hook)).toEqual([created(), null])
    expect(hook.result.current.tabs.map(tab => tab.entry.path)).toEqual([created()])
    expect(hook.result.current.requestedActiveTabPathRef.current).toBe(created())
    expect(hook.result.current.splitWorkspace.pendingPanes).toEqual([false, false])
    expect(hook.result.current.splitWorkspace.readyForVisits).toBe(true)
  }

  it.each([['its write finishes first', true], ['the restored page loads first', false]])(
    'the new page wins its pane when %s', async (_name, writeFirst) => {
      saveLayout()
      heldReads.add(a.path)
      const hook = setup(undefined, true)
      await waitFor(() => expect(reads.has(a.path)).toBe(true))
      act(() => hook.result.current.handleCreateNoteImmediate())
      if (writeFirst) {
        await finishWrite()
        await finishRestoreRead()
      } else {
        await finishRestoreRead()
        await finishWrite()
      }
      expectCreationWon(hook)
    })

  it('the new page wins when it was requested before the listing was ready', async () => {
    saveLayout()
    const hook = setup(undefined, true, true)
    act(() => hook.result.current.handleCreateNoteImmediate())
    hook.rerender({ vaultPath: '/vault', loading: false })
    await waitFor(() => expect(paths(hook)).toEqual([a.path, null]))
    await finishWrite()
    expectCreationWon(hook)
  })
})

describe('named (finder) creation', () => {
  const create = (hook: Hook) => hook.result.current.handleCreateNote('Trip', 'Note', 'quick_open')

  it('writes the file before showing the page, then reports it opened', async () => {
    const hook = setup()
    await act(() => hook.result.current.handleSelectNote(a))
    let result: Promise<boolean> = Promise.resolve(false)
    await act(async () => { result = create(hook) })
    expect(paths(hook)).toEqual([a.path, null])
    await act(async () => writes[0].finish())
    await expect(result).resolves.toBe(true)
    expect(paths(hook)).toEqual(['/vault/trip.md', null])
  })

  it('never shows an existing file when the write is refused', async () => {
    const hook = setup()
    await act(() => hook.result.current.handleSelectNote(a))
    let result: Promise<boolean> = Promise.resolve(true)
    act(() => { result = create(hook) })
    await act(async () => writes[0].fail(new Error('File already exists')))
    await expect(result).resolves.toBe(false)
    expect(paths(hook)).toEqual([a.path, null])
    expect(setToastMessage).toHaveBeenCalledWith('Cannot create note "Trip" because trip.md already exists')
  })

  it('reports not opened when the outgoing page cannot be saved', async () => {
    const hook = setup(async () => { throw new Error('disk full') })
    await act(() => hook.result.current.handleSelectNote(a))
    let result: Promise<boolean> = Promise.resolve(true)
    act(() => { result = create(hook) })
    await act(async () => writes[0].finish())
    await expect(result).resolves.toBe(false)
    expect(paths(hook)).toEqual([a.path, null])
    expect(addEntry).toHaveBeenCalledOnce()
  })

  it.each([
    ['opened', async () => {}, (write: Write) => write.finish()],
    ['created', async () => { throw new Error('disk full') }, (write: Write) => write.finish()],
    ['failed', async () => {}, (write: Write) => write.fail(new Error('disk full'))],
  ] as const)('createPage tells the finder it %s', async (outcome, flush, settleWrite) => {
    const hook = setup(flush)
    await act(() => hook.result.current.handleSelectNote(a))
    let result: Promise<string> = Promise.resolve('')
    act(() => { result = hook.result.current.createPage('Trip') })
    await act(async () => settleWrite(writes[0]))
    await expect(result).resolves.toBe(outcome)
  })

  it('reports not opened after a vault switch and adds nothing to the new list', async () => {
    const hook = setup()
    await act(() => hook.result.current.handleSelectNote(a))
    let result: Promise<boolean> = Promise.resolve(true)
    act(() => { result = create(hook) })
    leaveVault(hook, '/other')
    await act(async () => writes[0].finish())
    await expect(result).resolves.toBe(false)
    expect(hook.result.current.tabs).toEqual([])
    expect(addEntry).toHaveBeenCalledOnce()
  })
})
