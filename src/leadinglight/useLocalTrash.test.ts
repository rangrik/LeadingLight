import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import type { VaultEntry } from '../types'
import { useLocalTrash, type LocalTrashOptions, type TrashMoveOutcome } from './useLocalTrash'
import { trackEditorWork } from './editorWork'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({ isTauri: () => true, mockInvoke: vi.fn() }))

const entry = (path: string) => ({ path, title: path.split('/').pop(), filename: path.split('/').pop() }) as VaultEntry
const [a, b] = ['/vault/a.md', '/vault/b.md']
type Call = { paths: string[], resolve: (value: unknown) => void, reject: (error: unknown) => void }
let calls: Call[]
let restores: { vaultPath: string, ids: string[] }[]
let pendingWrites: Set<string>

function makeOptions(overrides: Partial<LocalTrashOptions> = {}): LocalTrashOptions {
  return {
    vaultPath: '/vault', entries: [entry(a), entry(b)],
    prepare: vi.fn(async (path: string) => path),
    flushBuffers: vi.fn(),
    hasPendingWrite: vi.fn((path: string) => pendingWrites.has(path)),
    holdWrites: vi.fn(), releaseHeldWrites: vi.fn(), closePages: vi.fn(), removeEntries: vi.fn(),
    addEntry: vi.fn(), clearUnsaved: vi.fn(), markInternalWrite: vi.fn(), reloadVault: vi.fn(),
    ...overrides,
  }
}

function setup(options = makeOptions()) {
  const hook = renderHook(({ vaultPath }: { vaultPath: string }) => useLocalTrash({ ...options, vaultPath }), { initialProps: { vaultPath: '/vault' } })
  return { hook, options }
}

function start(hook: ReturnType<typeof setup>['hook'], paths: string[]) {
  let outcome: TrashMoveOutcome | null | undefined
  act(() => { void hook.result.current.moveToTrash(paths).then(value => { outcome = value }) })
  return () => outcome
}
const settle = () => act(async () => { for (let i = 0; i < 5; i += 1) await new Promise(resolve => setTimeout(resolve, 0)) })
const moved = (path: string, id = '0'.repeat(32)) => ({ path, id, originalPath: path.slice('/vault/'.length) })
const released = (options: LocalTrashOptions) => vi.mocked(options.releaseHeldWrites).mock.calls.map(([paths, action]) => [...paths, action].join(':'))

beforeEach(() => {
  calls = []
  restores = []
  pendingWrites = new Set()
  vi.mocked(invoke).mockImplementation((command: string, args?: unknown) => {
    if (command === 'restore_from_local_trash') {
      const request = args as { vaultPath: string, ids: string[] }
      restores.push(request)
      return Promise.resolve({ restored: request.ids.map(id => ({ id, path: a, relativePath: 'a.md', renamed: false, relocated: false, cleanupPending: false, entry: null })), failed: [] })
    }
    if (command !== 'move_to_local_trash') return Promise.resolve(undefined)
    return new Promise((resolve, reject) => calls.push({ paths: (args as { paths: string[] }).paths, resolve, reject }))
  })
})

describe('moving pages to local Trash', () => {
  it('saves first, then closes and forgets only pages the native move confirmed', async () => {
    const { hook, options } = setup()
    const outcome = start(hook, [a, b])
    await settle()
    expect(options.holdWrites).toHaveBeenCalledWith([a, b])
    expect(options.prepare).toHaveBeenCalledTimes(2)
    expect(calls[0].paths).toEqual([a, b])
    await act(async () => calls[0].resolve({ moved: [moved(a)], failed: [{ path: b, code: 'io', message: 'x' }] }))
    await settle()
    expect(released(options)).toEqual([`${a}:discard`, `${b}:resume`])
    expect(options.closePages).toHaveBeenCalledWith([a])
    expect(options.removeEntries).toHaveBeenCalledWith([a])
    expect(outcome()).toMatchObject({ moved: [{ path: a }], failed: [{ path: b, code: 'io' }], changed: [] })
  })

  it('keeps a page whose text changed after its last save, instead of dropping that text', async () => {
    const { hook, options } = setup()
    const outcome = start(hook, [a])
    await settle()
    pendingWrites.add(a)
    await act(async () => calls[0].resolve({ moved: [moved(a)], failed: [] }))
    await settle()
    expect(options.flushBuffers).toHaveBeenCalledWith(a)
    expect(released(options)).toEqual([`${a}:resume`])
    expect(options.closePages).not.toHaveBeenCalled()
    expect(outcome()).toMatchObject({ moved: [], changed: [{ path: a }] })
  })

  it('does not move a page whose latest text could not be saved', async () => {
    const options = makeOptions({ prepare: vi.fn(async (path: string) => { if (path === a) throw new Error('disk full'); return path }) })
    const { hook } = setup(options)
    const outcome = start(hook, [a, b])
    await settle()
    expect(calls[0].paths).toEqual([b])
    await act(async () => calls[0].resolve({ moved: [moved(b)], failed: [] }))
    await settle()
    expect(released(options)).toEqual([`${a}:resume`, `${b}:discard`])
    expect(outcome()).toMatchObject({ failed: [{ path: a, code: 'saveFailed' }] })
  })

  it('moves the renamed file and forgets both names', async () => {
    const renamed = '/vault/plan.md'
    const options = makeOptions({ prepare: vi.fn(async () => renamed) })
    const { hook } = setup(options)
    start(hook, ['/vault/untitled-1.md'])
    await settle()
    expect(calls[0].paths).toEqual([renamed])
    await act(async () => calls[0].resolve({ moved: [moved(renamed)], failed: [] }))
    await settle()
    expect(released(options)).toEqual([`/vault/untitled-1.md:discard`, `${renamed}:discard`])
  })

  it('resumes saving everything when the native move is refused', async () => {
    const { hook, options } = setup()
    const outcome = start(hook, [a])
    await settle()
    await act(async () => calls[0].reject('Local Trash is unavailable: store is a symlink'))
    await settle()
    expect(released(options)).toEqual([`${a}:resume`])
    expect(options.closePages).not.toHaveBeenCalled()
    expect(outcome()).toMatchObject({ unavailable: true, moved: [] })
  })

  it('reports a page as moved and kept open when it cannot be checked after the move, with Undo still available', async () => {
    const options = makeOptions({ flushBuffers: vi.fn(() => { throw new Error('editor gone') }) })
    const { hook } = setup(options)
    const outcome = start(hook, [a])
    await settle()
    await act(async () => calls[0].resolve({ moved: [moved(a, 'f'.repeat(32))], failed: [] }))
    await settle()
    // The page stays open and keeps saving; nothing claims that nothing moved.
    expect(released(options)).toEqual([`${a}:resume`])
    expect(options.closePages).not.toHaveBeenCalled()
    expect(outcome()).toMatchObject({ unavailable: false, moved: [], uncertain: [{ path: a, id: 'f'.repeat(32) }] })
    await act(async () => { await hook.result.current.notice?.undo() })
    expect(restores).toEqual([{ vaultPath: '/vault', ids: ['f'.repeat(32)] }])
  })

  it('never lets Undo from an earlier visit to the vault restore anything, and hides that notice', async () => {
    const { hook } = setup()
    start(hook, [a])
    await settle()
    await act(async () => calls[0].resolve({ moved: [moved(a)], failed: [] }))
    await settle()
    const notice = hook.result.current.notice
    expect(notice?.outcome.moved).toHaveLength(1)
    hook.rerender({ vaultPath: '/other' })
    expect(hook.result.current.notice).toBeNull()
    hook.rerender({ vaultPath: '/vault' })
    expect(hook.result.current.notice).toBeNull()
    await act(async () => { expect(await notice?.undo()).toBeNull() })
    expect(restores).toEqual([])
  })

  it('refuses new moves and restores while quit or a vault switch holds admission, after letting the running one finish', async () => {
    const { hook } = setup()
    start(hook, [a])
    await settle()
    let release!: () => void
    let idle = false
    act(() => {
      release = hook.result.current.holdAdmission()
      void hook.result.current.whenIdle().then(() => { idle = true })
    })
    const refused = start(hook, [b])
    await act(async () => { expect(await hook.result.current.restore(['1'.repeat(32)])).toBeNull() })
    await settle()
    expect(idle).toBe(false)
    await act(async () => calls[0].resolve({ moved: [moved(a)], failed: [] }))
    await settle()
    expect(idle).toBe(true)
    expect(refused()).toBeNull()
    expect(calls).toHaveLength(1)
    expect(restores).toEqual([])
    act(() => release())
    start(hook, [b])
    await settle()
    expect(calls).toHaveLength(2)
  })

  it('refuses new work while the app reports it is closing or switching', async () => {
    let blocked = true
    const { hook } = setup(makeOptions({ isBlocked: () => blocked }))
    const refused = start(hook, [a])
    await settle()
    expect(refused()).toBeNull()
    expect(calls).toHaveLength(0)
    blocked = false
    start(hook, [a])
    await settle()
    expect(calls).toHaveLength(1)
    expect(hook.result.current.activity).toBe('move')
  })

  it('waits for an image still copying into the editor before the last save', async () => {
    let finishImport!: () => void
    void trackEditorWork(new Promise<void>(resolve => { finishImport = resolve }))
    const { hook, options } = setup()
    start(hook, [a])
    await settle()
    expect(options.prepare).not.toHaveBeenCalled()
    expect(calls).toHaveLength(0)
    await act(async () => finishImport())
    await settle()
    expect(options.prepare).toHaveBeenCalledWith(a)
    expect(calls).toHaveLength(1)
  })

  it('lets quit and vault switches wait until the move has settled', async () => {
    const { hook } = setup()
    start(hook, [a])
    let idle = false
    act(() => { void hook.result.current.whenIdle().then(() => { idle = true }) })
    await settle()
    expect(idle).toBe(false)
    expect(hook.result.current.busy).toBe(true)
    await act(async () => calls[0].resolve({ moved: [moved(a)], failed: [] }))
    await settle()
    expect(idle).toBe(true)
    expect(hook.result.current.busy).toBe(false)
  })

  it('skips a queued request from an earlier visit to the vault, and only lifts the first one\'s hold', async () => {
    const { hook, options } = setup()
    start(hook, [a])
    const second = start(hook, [b])
    await settle()
    hook.rerender({ vaultPath: '/other' })
    hook.rerender({ vaultPath: '/vault' })
    await act(async () => calls[0].resolve({ moved: [moved(a)], failed: [] }))
    await settle()
    expect(calls).toHaveLength(1)
    expect(released(options)).toEqual([`${a}:release`])
    expect(options.closePages).not.toHaveBeenCalled()
    expect(second()).toBeNull()
  })
})
