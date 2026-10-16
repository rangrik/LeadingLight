import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAppWindowControls } from './useAppWindowControls'
import type { useLayoutPanels } from './useLayoutPanels'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

type Props = { layout: ReturnType<typeof useLayoutPanels>, windowMode: boolean, inspectorFloats?: boolean }

describe('main window minimum when the Inspector opens', () => {
  // Sidebar 250 + list 300 + page 480 = 1030; only the legacy default adds the 280px Inspector.
  it.each([
    { name: 'opt-in floating Inspector keeps an 1100px window as is', inspectorFloats: true, highest: 1030 },
    { name: 'default still reserves Inspector width', inspectorFloats: undefined, highest: 1310 },
  ])('$name', ({ inspectorFloats, highest }) => {
    invoke.mockClear()
    const layout = { sidebarWidth: 250, noteListWidth: 300, inspectorWidth: 280, inspectorCollapsed: true,
      setInspectorCollapsed: vi.fn() } as unknown as ReturnType<typeof useLayoutPanels>
    const { result, rerender } = renderHook((props: Props) => useAppWindowControls(props),
      { initialProps: { layout, windowMode: false, inspectorFloats } })

    act(() => result.current.handleToggleInspector())
    rerender({ layout: { ...layout, inspectorCollapsed: false }, windowMode: false, inspectorFloats })

    const requested = invoke.mock.calls
      .filter(([command]) => command === 'update_current_window_min_size')
      .map(([, args]) => (args as { minWidth: number }).minWidth)
    expect(requested.length).toBeGreaterThan(1)
    expect(Math.max(...requested)).toBe(highest)
  })
})
