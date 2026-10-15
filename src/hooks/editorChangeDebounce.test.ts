import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RICH_EDITOR_CHANGE_DEBOUNCE_MS, useDebouncedEditorChange } from './editorChangeDebounce'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('rich editor pending change failures', () => {
  it('retains an autosave serialization failure for an explicit retry without an uncaught timer error', () => {
    vi.useFakeTimers()
    const failure = new Error('Serialization failed')
    const onFlush = vi.fn().mockImplementationOnce(() => { throw failure })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useDebouncedEditorChange({ onFlush, suppressChangeRef: { current: false } }))
    act(() => { result.current.handleEditorChange() })
    act(() => { vi.advanceTimersByTime(RICH_EDITOR_CHANGE_DEBOUNCE_MS) })
    expect(warn).toHaveBeenCalledWith('[editor] Could not flush pending editor change:', failure)
    expect(onFlush).toHaveBeenCalledOnce()
    act(() => { expect(result.current.flushPendingEditorChange()).toBe(true) })
    expect(onFlush).toHaveBeenCalledTimes(2)
    expect(result.current.flushPendingEditorChange()).toBe(false)
  })

  it('does not throw through React cleanup when a pending serializer fails', () => {
    const onFlush = vi.fn(() => { throw new Error('Serialization failed') })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result, unmount } = renderHook(() => useDebouncedEditorChange({ onFlush, suppressChangeRef: { current: false } }))
    act(() => { result.current.handleEditorChange() })
    expect(unmount).not.toThrow()
    expect(onFlush).toHaveBeenCalledOnce()
  })
})
