import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AUTO_SAVE_DEBOUNCE_MS, useEditorSave } from '../hooks/useEditorSave'

const saveNote = vi.hoisted(() => vi.fn<(path: string, content: string) => Promise<void>>())
vi.mock('../hooks/useSaveNote', () => ({ useSaveNote: () => ({ saveNote }) }))

beforeEach(() => { vi.useFakeTimers(); saveNote.mockReset(); saveNote.mockResolvedValue(undefined) })
afterEach(() => { vi.useRealTimers() })

it('autosaves newer text after its debounce expires during an earlier slow write', async () => {
  let finishFirst!: () => void
  saveNote.mockReturnValueOnce(new Promise<void>(resolve => { finishFirst = resolve }))
  const { result } = renderHook(() => useEditorSave({
    updateVaultContent: vi.fn(), setTabs: vi.fn(), setToastMessage: vi.fn(), persistenceScope: '/synthetic',
  }))
  act(() => result.current.handleContentChange('/synthetic/note.md', 'first edit'))
  await act(async () => { vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS) })
  act(() => result.current.handleContentChange('/synthetic/note.md', 'latest edit'))
  await act(async () => { vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS) })
  expect(saveNote).toHaveBeenCalledTimes(1)
  await act(async () => { finishFirst() })
  expect(saveNote).toHaveBeenLastCalledWith('/synthetic/note.md', 'latest edit')
})

it('preserves the remaining idle debounce for edits newer than the queued autosave attempt', async () => {
  let finishFirst!: () => void
  saveNote.mockReturnValueOnce(new Promise<void>(resolve => { finishFirst = resolve }))
  const { result } = renderHook(() => useEditorSave({
    updateVaultContent: vi.fn(), setTabs: vi.fn(), setToastMessage: vi.fn(), persistenceScope: '/synthetic',
  }))
  act(() => result.current.handleContentChange('/synthetic/note.md', 'first edit'))
  await act(async () => { vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS) })
  act(() => result.current.handleContentChange('/synthetic/note.md', 'queued edit'))
  await act(async () => { vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS) })
  act(() => result.current.handleContentChange('/synthetic/note.md', 'still typing'))
  await act(async () => { finishFirst() })
  expect(saveNote).toHaveBeenCalledTimes(1)
  await act(async () => { vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS - 1) })
  expect(saveNote).toHaveBeenCalledTimes(1)
  await act(async () => { vi.advanceTimersByTime(1) })
  expect(saveNote).toHaveBeenLastCalledWith('/synthetic/note.md', 'still typing')
})
