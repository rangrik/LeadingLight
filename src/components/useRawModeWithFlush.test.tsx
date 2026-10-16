import { useCallback, useState } from 'react'
import { renderHook, act } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useRawModeWithFlush } from './useRawModeWithFlush'
import * as store from '../utils/vaultConfigStore'

const notePath = '/vault/project/test.md'
const originalContent = '# Test\n\nOriginal body\n'
const rawEditedContent = '# Test\n\nEdited in raw mode\n'

function makeEditor() {
  return {
    document: [],
    blocksToMarkdownLossy: vi.fn(() => originalContent),
  }
}

describe('useRawModeWithFlush', () => {
  beforeEach(() => {
    store.resetVaultConfigStore()
    store.bindVaultConfigStore(
      {
        zoom: null,
        view_mode: null,
        editor_mode: null,
        tag_colors: null,
        status_colors: null,
        property_display_modes: null,
      },
      vi.fn(),
    )
  })

  afterEach(() => {
    act(() => store.resetVaultConfigStore())
  })

  it('re-enters raw mode with pending raw edits while tab state is still stale', async () => {
    const onContentChange = vi.fn()
    const flushPendingEditorChangeRef = { current: vi.fn(() => false) }
    const editor = makeEditor()
    const { result } = renderHook(() => useRawModeWithFlush(
      editor as never,
      notePath,
      originalContent,
      onContentChange,
      undefined,
      flushPendingEditorChangeRef,
    ))

    await act(async () => {
      await result.current.handleToggleRaw()
    })
    act(() => {
      result.current.rawLatestContentRef.current = rawEditedContent
    })

    await act(async () => {
      await result.current.handleToggleRaw()
    })
    await act(async () => {
      await result.current.handleToggleRaw()
    })

    expect(onContentChange).toHaveBeenCalledWith(notePath, rawEditedContent)
    expect(result.current.rawLatestContentRef.current).toBe(rawEditedContent)
    expect(result.current.rawModeContentOverride).toEqual({
      path: notePath,
      content: rawEditedContent,
    })
  })
  it('keeps a pending raw buffer in its own controlled pane and retains lower-level no-change flush semantics', async () => {
    const onContentChange = vi.fn()
    const editor = makeEditor()
    const { result } = renderHook(() => {
      const [left, setLeft] = useState<'preview' | 'raw'>('preview')
      const [right, setRight] = useState<'preview' | 'raw'>('preview')
      const beginLeft = useCallback(() => (mode: 'preview' | 'raw') => { setLeft(mode); return true }, [])
      const beginRight = useCallback(() => (mode: 'preview' | 'raw') => { setRight(mode); return true }, [])
      return [
        useRawModeWithFlush(editor as never, '/left.md', 'left words', onContentChange, undefined, { current: () => false }, { mode: left, begin: beginLeft }),
        useRawModeWithFlush(editor as never, '/right.md', 'right words', onContentChange, undefined, { current: () => false }, { mode: right, begin: beginRight }),
      ] as const
    })
    await act(async () => { await result.current[1].handleToggleRaw() })
    act(() => { result.current[1].rawLatestContentRef.current = 'right words before debounce' })
    act(() => store.updateVaultConfigField('zoom', 1.2))
    expect(result.current.map(pane => pane.rawMode)).toEqual([false, true])
    await act(async () => { await result.current[1].handleToggleRaw() })
    expect(onContentChange).toHaveBeenCalledExactlyOnceWith('/right.md', 'right words before debounce')
    expect(result.current[0].rawLatestContentRef.current).toBe('left words')
    await act(async () => { await result.current[1].handleToggleRaw() })
    expect(result.current[1].rawLatestContentRef.current).toBe('right words before debounce')
  })

  it('keeps rich mode and reports a composition refusal before replacing the raw buffer', async () => {
    const error = new Error('Composition pending')
    const onError = vi.fn()
    const { result } = renderHook(() => useRawModeWithFlush(makeEditor() as never, notePath, originalContent,
      undefined, undefined, { current: () => { throw error } }, undefined, onError))
    await act(async () => { expect(await result.current.handleToggleRaw()).toBe(false) })
    expect(result.current.rawMode).toBe(false)
    expect(result.current.rawLatestContentRef.current).toBe(originalContent)
    expect(result.current.rawModeContentOverride).toBeNull()
    expect(onError).toHaveBeenCalledWith(error)
  })

})
