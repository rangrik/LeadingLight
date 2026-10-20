import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { cancelNoteRowDrag, registerNoteRowDropTarget, type NoteRowPoint } from './noteRowDrag'
import { dropEdgeAt, type DropEdge, type NoteDropTarget } from './pageTabDrag'
import type { PaneId } from './useSplitWorkspace'

export interface PaneRect { left: number; top: number; width: number; height: number }
/** The pointer outside React state, so the chip can follow it without rerendering the panes. */
export interface DragPointer {
  get: () => { x: number; y: number } | null
  subscribe: (listener: () => void) => () => void
}
export interface NoteDropPreview {
  title: string
  edges: DropEdge[]
  edge: DropEdge | null
  center: PaneRect | null
  pointer: DragPointer
}
interface DroppableNote { title: string; edges: DropEdge[] }
type DropZones = Pick<NoteDropPreview, 'edges' | 'edge' | 'center'>
const NO_ZONES: DropZones = { edges: [], edge: null, center: null }

function createDragPointer(): DragPointer & { set: (next: { x: number; y: number } | null) => void } {
  let value: { x: number; y: number } | null = null
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: next => {
      value = next
      listeners.forEach(listener => listener())
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

const sameZones = (a: DropZones, b: DropZones) => a.edge === b.edge && a.edges.join() === b.edges.join()
  && a.center?.left === b.center?.left && a.center?.top === b.center?.top
  && a.center?.width === b.center?.width && a.center?.height === b.center?.height

function hitAt(area: HTMLElement, point: NoteRowPoint, edges: DropEdge[]): { target: NoteDropTarget; center: PaneRect | null } | null {
  if (!point.element || !area.contains(point.element)) return null
  const rect = area.getBoundingClientRect()
  const edge = dropEdgeAt(rect, point.x, point.y, edges)
  if (edge) return { target: { edge }, center: null }
  const pane = point.element.closest<HTMLElement>('[data-pane-id]')
  if (!pane || !area.contains(pane)) return null
  const box = pane.getBoundingClientRect()
  return {
    target: { pane: Number(pane.dataset.paneId) as PaneId },
    center: { left: box.left - rect.left, top: box.top - rect.top, width: box.width, height: box.height },
  }
}

/**
 * The page area's side of the note-row gesture. The chip follows the pointer anywhere; drop zones
 * show only over the page area. External file, text and image drops never pass through here.
 */
export function useNoteListDrop({ areaRef, vaultPath, describe, onDrop }: {
  areaRef: RefObject<HTMLElement | null>
  vaultPath: string
  describe: (path: string | null) => DroppableNote | null
  onDrop: (path: string, target: NoteDropTarget) => void
}) {
  const [preview, setPreview] = useState<NoteDropPreview | null>(null)
  const [pointer] = useState(createDragPointer)
  const current = useRef({ vaultPath, describe, onDrop })
  useEffect(() => { current.current = { vaultPath, describe, onDrop } })
  useEffect(() => registerNoteRowDropTarget(({ path }) => {
    const vault = current.current.vaultPath
    const pressed = current.current.describe(path)
    if (!pressed) return null
    // Pages, layout and eligibility now; a drop is checked again at release.
    const describeNow = () => (current.current.vaultPath === vault ? current.current.describe(path) : null)
    // Rerender only when the zones change, not for every pointer move.
    const show = (zones: DropZones) =>
      setPreview(shown => (shown && sameZones(shown, zones) ? shown : { title: pressed.title, ...zones, pointer }))
    return {
      // The preview lives exactly as long as the drag, wherever the pointer is.
      follow: point => {
        pointer.set(point && { x: point.x, y: point.y })
        setPreview(shown => (point ? shown ?? { title: pressed.title, ...NO_ZONES, pointer } : null))
      },
      clear: () => setPreview(shown => (shown && !sameZones(shown, NO_ZONES) ? { ...shown, ...NO_ZONES } : shown)),
      hit: point => {
        const note = describeNow()
        const area = areaRef.current
        const hit = note && area ? hitAt(area, point, note.edges) : null
        if (!note || !hit) return null
        return {
          preview: () => show({ edges: note.edges, edge: 'edge' in hit.target ? hit.target.edge : null, center: hit.center }),
          drop: () => { if (describeNow()) current.current.onDrop(path, hit.target) },
        }
      },
    }
  }), [areaRef, pointer])

  /** Revoke both pane and sidebar destinations, even before the press crosses the threshold. */
  const invalidateNoteDrag = useCallback(() => {
    cancelNoteRowDrag()
    pointer.set(null)
    setPreview(null)
  }, [pointer])
  return { preview, invalidateNoteDrag }
}
