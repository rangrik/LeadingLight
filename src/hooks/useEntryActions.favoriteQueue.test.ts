import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEntryActions } from './useEntryActions'
import type { ActionHistoryController, ActionHistoryEntry } from './useActionHistory'
import type { ApplyFavoriteState, FavoriteOutcome, FavoriteState } from '../leadinglight/favoriteTransaction'
import type { VaultEntry } from '../types'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({ isTauri: () => false, mockInvoke: vi.fn() }))

const path = '/vault/plan.md'
const entry = { path, title: 'Plan', favorite: false, favoriteIndex: null } as unknown as VaultEntry
const ON: FavoriteState = { favorite: true, favoriteIndex: 1 }
const OFF: FavoriteState = { favorite: false, favoriteIndex: null }

function committed(overrides: Partial<Extract<FavoriteOutcome, { status: 'committed' }>> = {}): FavoriteOutcome {
  return { status: 'committed', path, state: ON, written: true, durable: true, integration: 'rebased', current: true, ...overrides }
}

function setup(outcomes: FavoriteOutcome[]) {
  const records: ActionHistoryEntry[] = []
  const actionHistory = { record: (item: ActionHistoryEntry) => { records.push(item); return () => {} } } as unknown as ActionHistoryController
  const updateEntry = vi.fn()
  const setToastMessage = vi.fn()
  const gates: Array<() => void> = []
  const applyFavoriteState = vi.fn<ApplyFavoriteState>(() => {
    const outcome = outcomes.shift() ?? committed()
    return { status: 'admitted', path, done: new Promise(resolve => { gates.push(() => resolve(outcome)) }) }
  })
  const { result } = renderHook(() => useEntryActions({
    entries: [entry],
    updateEntry,
    handleUpdateFrontmatter: vi.fn(),
    handleDeleteProperty: vi.fn(),
    setToastMessage,
    createTypeEntry: vi.fn(),
    actionHistory,
    applyFavoriteState,
  }))
  /** Starts a call, then settles every admitted change and waits for the call to finish. */
  const start = (call: () => Promise<void> | void) => {
    let running: Promise<void> = Promise.resolve()
    act(() => { running = Promise.resolve(call()) })
    return () => act(async () => { gates.splice(0).forEach(open => open()); await running })
  }
  const toggle = () => start(() => result.current.handleToggleFavorite(path))
  return { toggle, start, records, updateEntry, setToastMessage, applyFavoriteState }
}

describe('Favorites through the save queue (T6)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('records history only after the commit, and undo goes through the same queue', async () => {
    const { toggle, start, records, updateEntry, applyFavoriteState } = setup([committed(), committed({ state: OFF })])
    const finish = toggle()
    expect(updateEntry).toHaveBeenCalledWith(path, ON)
    expect(records).toHaveLength(0)
    await finish()
    expect(records).toHaveLength(1)

    await start(() => records[0].undo())()

    expect(applyFavoriteState).toHaveBeenLastCalledWith(path, OFF)
    expect(updateEntry).toHaveBeenLastCalledWith(path, OFF)
  })

  it('keeps the requested state but records no history when a newer draft is unmerged', async () => {
    const { toggle, records, updateEntry, setToastMessage } = setup([committed({ integration: 'unmergedDraft', written: false })])
    await toggle()()

    expect(records).toHaveLength(0)
    expect(updateEntry).toHaveBeenLastCalledWith(path, ON)
    expect(setToastMessage).toHaveBeenCalledWith("Favorite saved. Your latest edits won't save until the page's properties are fixed.")
    expect(setToastMessage).not.toHaveBeenCalledWith(expect.stringContaining('rolled back'))
  })

  it('restores the earlier state with no history when the change failed', async () => {
    const { toggle, records, updateEntry, setToastMessage } = setup([{ status: 'failed', reason: 'publish', current: true }])
    await toggle()()

    expect(records).toHaveLength(0)
    expect(updateEntry).toHaveBeenLastCalledWith(path, OFF)
    expect(setToastMessage).toHaveBeenCalledWith('Failed to favorite — rolled back')
  })

  it('shows what the page holds after an uncertain outcome, without claiming rollback', async () => {
    const onDisk = { favorite: true as const, favoriteIndex: 7 }
    const { toggle, records, updateEntry, setToastMessage } = setup([{ status: 'uncertain', path, originalAt: '/vault/.moved', stagedAt: null, onDisk, current: true }])
    await toggle()()

    expect(records).toHaveLength(0)
    expect(updateEntry).toHaveBeenLastCalledWith(path, onDisk)
    expect(setToastMessage).not.toHaveBeenCalledWith(expect.stringContaining('rolled back'))
  })

  it.each<FavoriteOutcome>([
    committed({ current: false }),
    { status: 'failed', reason: 'publish', current: false },
    { status: 'refused', reason: 'changedOnDisk', current: false },
    { status: 'uncertain', path, originalAt: null, stagedAt: null, onDisk: OFF, current: false },
  ])('leaves the list, history and toasts alone for a result from a closed session ($status, L1)', async outcome => {
    const { toggle, records, updateEntry, setToastMessage } = setup([outcome])
    await toggle()()

    expect(updateEntry).toHaveBeenCalledTimes(1) // Only the optimistic state from before the switch.
    expect(records).toHaveLength(0)
    expect(setToastMessage).not.toHaveBeenCalled()
  })

  it('ignores a toggle while one is running, and an undo that is not committed fails', async () => {
    const { toggle, start, records, setToastMessage, applyFavoriteState } = setup([committed(), { status: 'failed', reason: 'saveFailed', current: true }])
    const first = toggle()
    applyFavoriteState.mockReturnValueOnce({ status: 'refused', reason: 'busy' })
    await toggle()()
    expect(setToastMessage).not.toHaveBeenCalled()
    await first()

    await expect(start(() => records[0].undo())()).rejects.toThrow('not saved')
  })
})
