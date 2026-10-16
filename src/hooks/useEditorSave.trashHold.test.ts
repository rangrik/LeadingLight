import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { AUTO_SAVE_DEBOUNCE_MS, useEditorSave } from './useEditorSave'

const writes = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<null>>(() => Promise.resolve(null))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: (cmd: string, args?: Record<string, unknown>) => writes(cmd, args),
  updateMockContent: vi.fn(),
}))

const page = '/vault/plan.md'
const written = () => writes.mock.calls.map(([, args]) => args?.content)

function setup() {
  return renderHook(() => useEditorSave({ updateVaultContent: vi.fn(), setTabs: vi.fn(), setToastMessage: vi.fn() })).result
}

beforeEach(() => {
  vi.useFakeTimers()
  writes.mockReset()
  writes.mockResolvedValue(null)
})
afterEach(() => { vi.useRealTimers() })

describe('save hold while a page moves to Trash', () => {
  it('lets only the move\'s own drain write a held page, not autosave, Save or a navigation flush', async () => {
    const save = setup()
    act(() => { save.current.holdAutosave([page]) })
    act(() => { save.current.handleContentChange(page, 'typed') })
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS + 10) })
    await act(async () => { await save.current.savePending() })
    await act(async () => { await save.current.savePendingForPath(page) })
    await act(async () => { await save.current.handleSave({ path: page, content: 'tab text' }) })
    expect(written()).toEqual([])
    expect(save.current.hasPendingWrite(page)).toBe(true)
    await act(async () => { await save.current.drainHeld(page) })
    expect(written()).toEqual(['typed'])
  })

  it('drops held text once the move is confirmed, and saves it again after a failed move', async () => {
    const save = setup()
    act(() => { save.current.holdAutosave([page, '/vault/other.md']) })
    act(() => {
      save.current.handleContentChange(page, 'moved copy')
      save.current.handleContentChange('/vault/other.md', 'still here')
    })
    expect(save.current.hasPendingWrite(page)).toBe(true)
    act(() => {
      save.current.releaseAutosave([page], 'discard')
      save.current.releaseAutosave(['/vault/other.md'], 'resume')
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS + 10) })
    expect(written()).toEqual(['still here'])
    expect(save.current.hasPendingWrite(page)).toBe(false)
  })

  it('a plain release keeps the text pending for the next save', async () => {
    const save = setup()
    act(() => { save.current.holdAutosave([page]) })
    act(() => { save.current.handleContentChange(page, 'kept') })
    act(() => { save.current.releaseAutosave([page], 'release') })
    expect(save.current.hasPendingWrite(page)).toBe(true)
    await act(async () => { await save.current.savePending() })
    expect(written()).toEqual(['kept'])
  })
})
