// Which panes are narrow enough for the toolbar action to show only its icon (title kept as its
// label and tooltip). Measured from the panes' own sections, so the floating toolbar needs no layout.
import { useEffect, useState, type RefObject } from 'react'

/** Fable's compact threshold for the selection toolbar's text label. */
export const COMPACT_PANE_WIDTH = 480

export function useCommentaryPaneWidths(areaRef: RefObject<HTMLElement | null>, layoutKey: string): readonly [boolean, boolean] {
  const [narrow, setNarrow] = useState<readonly [boolean, boolean]>([false, false])
  useEffect(() => {
    const area = areaRef.current
    if (!area || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const widthOf = (pane: 0 | 1) => area.querySelector<HTMLElement>(`[data-pane-id="${pane}"]`)?.getBoundingClientRect().width ?? Infinity
      const next = [widthOf(0) < COMPACT_PANE_WIDTH, widthOf(1) < COMPACT_PANE_WIDTH] as const
      setNarrow(current => (current[0] === next[0] && current[1] === next[1] ? current : next))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(area)
    area.querySelectorAll('[data-pane-id]').forEach(section => observer.observe(section))
    measure()
    return () => observer.disconnect()
  }, [areaRef, layoutKey])
  return narrow
}

/** The Inspector's float threshold: a pane narrower than this is too narrow to write beside another. */
export const MIN_WRITING_WIDTH = 400

/** Side by side would leave either pane under the writing width, so a new split opens stacked. */
export function sideBySideTooNarrow(): boolean {
  const area = document.querySelector<HTMLElement>('.ll-panes')
  const width = area?.getBoundingClientRect().width ?? window.innerWidth
  return width / 2 < MIN_WRITING_WIDTH
}
