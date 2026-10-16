import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEditorSave } from './useEditorSave'

// Seam: a committed reply's history note -> the UI. Catches a note changing how the save settles, or a broken callback doing so.
const NOT_KEPT = { status: 'notKept', reason: 'lowSpace' }
const committed = (history: unknown) => ({ status: 'committed', written: true, durable: true, history })
const replies: Record<string, unknown[]> = {}
const mockInvokeFn = vi.fn(async (command: string) => replies[command]?.shift() ?? null)

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: (command: string) => mockInvokeFn(command),
  updateMockContent: vi.fn(),
}))

const PAGE = '/vault/plan.md'

function setup(onHistoryNote: (vaultPath: string, note: unknown) => void) {
  const onNotePersisted = vi.fn()
  const hook = renderHook(() => useEditorSave({
    persistenceScope: ['/vault'], updateVaultContent: vi.fn(), setTabs: vi.fn(), setToastMessage: vi.fn(), onNotePersisted, onHistoryNote,
  }))
  return { page: () => hook.result.current, onNotePersisted }
}

beforeEach(() => {
  for (const key of Object.keys(replies)) delete replies[key]
  mockInvokeFn.mockClear()
})

describe('committed history notes', () => {
  it.each([
    ['a working callback', vi.fn()],
    ['a throwing callback', vi.fn(() => { throw new Error('ui broke') })],
  ])('settle a not-kept save normally with %s', async (_label, onHistoryNote) => {
    replies.save_page_content = [committed(NOT_KEPT)]
    const h = setup(onHistoryNote)
    const receipt = h.page().handleContentChange(PAGE, 'kept words')!
    await act(async () => { await h.page().savePendingForPath(PAGE) })
    expect(onHistoryNote).toHaveBeenCalledWith('/vault', NOT_KEPT)
    expect(h.onNotePersisted).toHaveBeenCalledWith(PAGE, 'kept words')
    expect(h.page().receiptStatus(receipt)).toBe('settled')
    expect(h.page().recovery.getSnapshot().holds).toEqual([])
  })

  it('passes a note proven by Check again, and says nothing for null history', async () => {
    replies.save_page_content = [null, committed(null)]
    replies.check_save_outcome = [{ state: 'done', outcome: committed(NOT_KEPT) }]
    const onHistoryNote = vi.fn()
    const h = setup(onHistoryNote)
    h.page().handleContentChange(PAGE, 'v1')
    await act(async () => { await h.page().savePendingForPath(PAGE).catch(() => false) })
    expect(onHistoryNote).not.toHaveBeenCalled()
    expect(await act(() => h.page().recovery.checkAgain(PAGE))).toMatchObject({ state: 'done', held: false })
    expect(onHistoryNote).toHaveBeenCalledTimes(1)
    expect(h.onNotePersisted).toHaveBeenCalledWith(PAGE, 'v1')

    h.page().handleContentChange(PAGE, 'v2')
    await act(async () => { await h.page().savePendingForPath(PAGE) })
    expect(onHistoryNote).toHaveBeenCalledTimes(1)
  })
})
