import { useCallback, useState } from 'react'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useEditorContentModel, type EditorContentProps } from './useEditorContentModel'
import * as store from '../../utils/vaultConfigStore'
import type { PaneEditorMode } from '../../leadinglight/paneEditorMode'

function props(path: string): EditorContentProps {
  return { activeTab: { entry: { path, filename: path, title: path }, content: 'saved body' }, activeTabPath: path,
    entries: [], editor: {}, diffMode: false, rawMode: false, richEditorContentReady: true,
    activeStatus: 'clean', onToggleRaw: vi.fn(), editorDocumentSessionRef: { current: 1 } } as unknown as EditorContentProps
}

describe('controlled emergency raw recovery', () => {
  it('recovers only the owning pane, skips rich serialization, and refuses a stale page callback', () => {
    store.resetVaultConfigStore()
    const leftProps = props('/left.md')
    const rightProps = props('/right.md')
    const { result, rerender } = renderHook(({ path }) => {
      const [left, setLeft] = useState<PaneEditorMode>('preview')
      const [right, setRight] = useState<PaneEditorMode>('preview')
      const beginLeft = useCallback(() => (mode: PaneEditorMode) => { setLeft(mode); return true }, [])
      const beginRight = useCallback(() => (mode: PaneEditorMode) => { setRight(mode); return true }, [])
      return [
        useEditorContentModel({ ...leftProps, rawMode: left === 'raw', editorModeControl: { mode: left, begin: beginLeft } }),
        useEditorContentModel({ ...rightProps, activeTabPath: path, rawMode: right === 'raw', editorModeControl: { mode: right, begin: beginRight } }),
      ] as const
    }, { initialProps: { path: '/right.md' } })
    const stale = result.current[1].onToggleRaw
    rerender({ path: '/replacement.md' })
    act(() => stale('react_update_depth_exceeded'))
    expect(result.current.map(model => model.effectiveRawMode)).toEqual([false, false])
    act(() => result.current[1].onToggleRaw('react_update_depth_exceeded'))
    expect(result.current.map(model => model.effectiveRawMode)).toEqual([false, true])
    expect(leftProps.onToggleRaw).not.toHaveBeenCalled()
    expect(rightProps.onToggleRaw).not.toHaveBeenCalled()
    expect(store.getVaultConfig().editor_mode).toBeNull()
  })
})
