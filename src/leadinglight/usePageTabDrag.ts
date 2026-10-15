import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { dropEdgeAt, type DropEdge } from './pageTabDrag'
import type { PaneId } from './useSplitWorkspace'

// Shorter presses stay clicks, so the page picker still opens.
const DRAG_THRESHOLD_PX = 5

export interface PageTabDragState {
  pane: PaneId
  title: string
  edges: DropEdge[]
  edge: DropEdge | null
  x: number
  y: number
}

interface DragStart {
  event: ReactPointerEvent<HTMLElement>
  pane: PaneId
  title: string
  edges: DropEdge[]
  /** Vault and page at press time; the drop handler rejects a gesture whose origin changed. */
  origin: string
}

function swallowNextClick() {
  const swallow = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    window.removeEventListener('click', swallow, true)
  }
  window.addEventListener('click', swallow, true)
  window.setTimeout(() => window.removeEventListener('click', swallow, true), 0)
}

/** Internal pointer dragging; HTML5 drag events are not used for page tabs. */
export function usePageTabDrag({ areaRef, onDrop }: { areaRef: RefObject<HTMLElement | null>; onDrop: (pane: PaneId, edge: DropEdge, origin: string) => void }) {
  const [drag, setDrag] = useState<PageTabDragState | null>(null)
  const sessionRef = useRef<{ end: () => void; cancel: () => void } | null>(null)
  const onDropRef = useRef(onDrop)
  useEffect(() => { onDropRef.current = onDrop })
  useEffect(() => () => sessionRef.current?.end(), [])

  const startPageDrag = useCallback(({ event, pane, title, edges, origin }: DragStart) => {
    if (event.button !== 0 || event.isPrimary === false) return
    // No focus or selection on press: a canceled drag must not change the active pane.
    event.preventDefault()
    sessionRef.current?.end()
    const tab = event.currentTarget
    const { pointerId, clientX: startX, clientY: startY } = event
    // Some input (accessibility, synthetic) reports no held button for the whole press.
    // Only then is a button-less move not evidence of a release we missed.
    const pressReportsButtons = event.buttons !== 0
    // Capture keeps the release with us even outside the window.
    try { tab.setPointerCapture?.(pointerId) } catch { /* Window listeners still apply. */ }
    let phase: 'pressed' | 'dragging' | 'canceled' = 'pressed'
    const edgeAt = (point: PointerEvent) => {
      const rect = areaRef.current?.getBoundingClientRect()
      return rect ? dropEdgeAt(rect, point.clientX, point.clientY, edges) : null
    }

    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== pointerId) return
      // No button held means the release happened where we could not see it.
      if (move.buttons === 0 && pressReportsButtons) { end(); return }
      if (phase === 'canceled') return
      if (phase === 'pressed' && Math.hypot(move.clientX - startX, move.clientY - startY) < DRAG_THRESHOLD_PX) return
      phase = 'dragging'
      setDrag({ pane, title, edges, edge: edgeAt(move), x: move.clientX, y: move.clientY })
    }
    const onUp = (up: PointerEvent) => {
      if (up.pointerId !== pointerId) return
      // The release point decides, so a release outside never commits an earlier preview.
      const dropEdge = phase === 'dragging' ? edgeAt(up) : null
      if (phase !== 'pressed') swallowNextClick()
      end()
      if (dropEdge) onDropRef.current(pane, dropEdge, origin)
    }
    const onPointerCancel = (cancel: PointerEvent) => { if (cancel.pointerId === pointerId) end() }
    // Keep listening until release so the release click does not open the picker.
    const cancel = () => {
      if (phase !== 'dragging') { end(); return }
      phase = 'canceled'
      setDrag(null)
    }
    const onKeyDown = (key: KeyboardEvent) => {
      if (key.key !== 'Escape' || phase !== 'dragging') return
      key.preventDefault()
      key.stopPropagation()
      cancel()
    }
    function end() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', end, true)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', end)
      tab.removeEventListener('lostpointercapture', end)
      try { if (tab.hasPointerCapture?.(pointerId)) tab.releasePointerCapture(pointerId) } catch { /* Already released. */ }
      sessionRef.current = null
      setDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    // A new press means this gesture's release was missed; it must never drop later.
    window.addEventListener('pointerdown', end, true)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', end)
    tab.addEventListener('lostpointercapture', end)
    sessionRef.current = { end, cancel }
  }, [areaRef])

  /** For outside changes (vault switch, pending transition): drops nothing and swallows the release click. */
  const cancelPageDrag = useCallback(() => sessionRef.current?.cancel(), [])

  return { drag, startPageDrag, cancelPageDrag }
}
