// A rename settles its source under the autosave hold: words typed meanwhile take the receipt's
// proven change, or stay pending as unmerged so they are neither dropped nor saved on the old base.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { AUTO_SAVE_DEBOUNCE_MS, UnmergedDraftError, useEditorSave } from './useEditorSave'

const COMMITTED = { status: 'committed', written: true, durable: true, history: null }
const writes = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>(() => Promise.resolve(COMMITTED))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: (cmd: string, args?: Record<string, unknown>) => writes(cmd, args),
  updateMockContent: vi.fn(),
}))

const page = '/vault/renamed.md'
const BEFORE = '# Plan\n\nSee [Self](./old.md).\n'
const AFTER = '# Plan\n\nSee [Self](./renamed.md).\n'
/** The receipt's proven change: the same self-link edit, applied only where the old link still is. */
const receiptRebase = (draft: string) => (draft.includes('(./old.md)') ? draft.replace('(./old.md)', '(./renamed.md)') : null)
const written = () => writes.mock.calls.map(([, args]) => args?.content)

function setup() {
  const setTabs = vi.fn()
  const hook = renderHook(() => useEditorSave({ updateVaultContent: vi.fn(), setTabs, setToastMessage: vi.fn(), persistenceScope: '/vault' }))
  return { save: hook.result, setTabs }
}

beforeEach(() => {
  vi.useFakeTimers()
  writes.mockReset()
  writes.mockResolvedValue(COMMITTED)
})
afterEach(() => { vi.useRealTimers() })

describe('a held draft after a committed rename', () => {
  it('takes the receipt change, then saves the new words with the new link once the hold lifts', async () => {
    const { save } = setup()
    act(() => { save.current.holdAutosave([page]) })
    act(() => { save.current.handleContentChange(page, `${BEFORE}\nTyped during the rename.\n`) })
    expect(save.current.rebaseHeldDraft(page, receiptRebase)).toBe('rebased')
    act(() => { save.current.releaseAutosave([page], 'resume') })
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS + 10) })
    expect(written()).toEqual([`${AFTER}\nTyped during the rename.\n`])
  })

  it('keeps a draft that cannot take the change pending and unsaved: autosave skips it, Save reports it', async () => {
    const { save } = setup()
    act(() => { save.current.holdAutosave([page]) })
    act(() => { save.current.handleContentChange(page, '# Plan\n\nThe link was rewritten by hand.\n') })
    expect(save.current.rebaseHeldDraft(page, receiptRebase)).toBe('unmergedDraft')
    act(() => { save.current.releaseAutosave([page], 'resume') })
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS + 10) })
    expect(written()).toEqual([])
    expect(save.current.hasPendingWrite(page)).toBe(true)
    await expect(save.current.savePendingForPath(page)).rejects.toBeInstanceOf(UnmergedDraftError)
    expect(written()).toEqual([])
  })

  it('answers none when nothing was typed, and applies an earlier retained change first', () => {
    const { save } = setup()
    expect(save.current.rebaseHeldDraft(page, receiptRebase)).toBe('none')
    act(() => { save.current.holdAutosave([page]) })
    act(() => { save.current.handleContentChange(page, 'no link here') })
    expect(save.current.rebaseHeldDraft(page, () => null)).toBe('unmergedDraft')
    act(() => { save.current.handleContentChange(page, `${BEFORE}draft`) })
    // The earlier retained change (refused) still holds the draft; the new one waits behind it.
    expect(save.current.rebaseHeldDraft(page, receiptRebase)).toBe('unmergedDraft')
  })
})
