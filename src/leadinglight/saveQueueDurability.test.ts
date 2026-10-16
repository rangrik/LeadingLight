import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AUTO_SAVE_DEBOUNCE_MS, useEditorSave } from '../hooks/useEditorSave'
import type { OriginalRequest } from './saveOutcome'

const COMMITTED = { status: 'committed', written: true, durable: true, history: null }
const saveNote = vi.hoisted(() => vi.fn<(request: OriginalRequest, content: string) => Promise<unknown>>())
vi.mock('../hooks/useSaveNote', () => ({ useSaveNote: () => ({ saveNote, commitSaved: vi.fn() }) }))

const page = (content: string) => [expect.objectContaining({ path: '/synthetic/note.md' }), content] as const

beforeEach(() => { vi.useFakeTimers(); saveNote.mockReset(); saveNote.mockResolvedValue(COMMITTED) })
afterEach(() => { vi.useRealTimers() })

it('autosaves newer text after its debounce expires during an earlier slow write', async () => {
  let finishFirst!: () => void
  saveNote.mockReturnValueOnce(new Promise(resolve => { finishFirst = () => resolve(COMMITTED) }))
  const { result } = renderHook(() => useEditorSave({
    updateVaultContent: vi.fn(), setTabs: vi.fn(), setToastMessage: vi.fn(), persistenceScope: '/synthetic',
  }))
  act(() => result.current.handleContentChange('/synthetic/note.md', 'first edit'))
  await act(async () => { vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS) })
  await vi.waitFor(() => expect(saveNote).toHaveBeenCalledTimes(1))
  act(() => result.current.handleContentChange('/synthetic/note.md', 'latest edit'))
  await act(async () => { vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS) })
  expect(saveNote).toHaveBeenCalledTimes(1)
  await act(async () => { finishFirst() })
  await vi.waitFor(() => expect(saveNote).toHaveBeenLastCalledWith(...page('latest edit')))
})

it('preserves the remaining idle debounce for edits newer than the queued autosave attempt', async () => {
  let finishFirst!: () => void
  saveNote.mockReturnValueOnce(new Promise(resolve => { finishFirst = () => resolve(COMMITTED) }))
  const { result } = renderHook(() => useEditorSave({
    updateVaultContent: vi.fn(), setTabs: vi.fn(), setToastMessage: vi.fn(), persistenceScope: '/synthetic',
  }))
  act(() => result.current.handleContentChange('/synthetic/note.md', 'first edit'))
  await act(async () => { vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS) })
  await vi.waitFor(() => expect(saveNote).toHaveBeenCalledTimes(1))
  act(() => result.current.handleContentChange('/synthetic/note.md', 'queued edit'))
  await act(async () => { vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS) })
  act(() => result.current.handleContentChange('/synthetic/note.md', 'still typing'))
  await act(async () => { finishFirst() })
  expect(saveNote).toHaveBeenCalledTimes(1)
  await act(async () => { vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS - 1) })
  expect(saveNote).toHaveBeenCalledTimes(1)
  await act(async () => { vi.advanceTimersByTime(1) })
  await vi.waitFor(() => expect(saveNote).toHaveBeenLastCalledWith(...page('still typing')))
})
