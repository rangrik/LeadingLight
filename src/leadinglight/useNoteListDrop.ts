import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { clearDraggedNotePath, NOTE_DRAG_MIME_TYPE, readDraggedNotePath } from '../utils/noteDragDrop'
import { notePathsMatch } from '../utils/notePathIdentity'
import { dropEdgeAt, type DropEdge, type NoteDropTarget } from './pageTabDrag'
import type { PaneId } from './useSplitWorkspace'

export interface PaneRect { left: number; top: number; width: number; height: number }
export interface NoteDropPreview {
  title: string
  edges: DropEdge[]
  edge: DropEdge | null
  center: PaneRect | null
}
interface DroppableNote { title: string; edges: DropEdge[] }

// Only our own note drags carry this type; external files, text and links never do.
const isNoteDrag = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes(NOTE_DRAG_MIME_TYPE)

function hitAt(area: HTMLElement, event: DragEvent, edges: DropEdge[]): { target: NoteDropTarget; center: PaneRect | null } | null {
  const rect = area.getBoundingClientRect()
  const edge = dropEdgeAt(rect, event.clientX, event.clientY, edges)
  if (edge) return { target: { edge }, center: null }
  const pane = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-pane-id]') : null
  if (!pane || !area.contains(pane)) return null
  const box = pane.getBoundingClientRect()
  return {
    target: { pane: Number(pane.dataset.paneId) as PaneId },
    center: { left: box.left - rect.left, top: box.top - rect.top, width: box.width, height: box.height },
  }
}

function samePreview(a: NoteDropPreview | null, b: NoteDropPreview | null): boolean {
  if (!a || !b) return a === b
  return a.title === b.title && a.edge === b.edge && a.edges.join() === b.edges.join()
    && JSON.stringify(a.center) === JSON.stringify(b.center)
}

/**
 * Notes dragged from the list. Window capture runs before the sidebar's document-capture cleanup
 * and before any editor, so a note path dropped on the page area can never be inserted as text.
 */
export function useNoteListDrop({ areaRef, vaultPath, describe, onDrop }: {
  areaRef: RefObject<HTMLElement | null>
  vaultPath: string
  describe: (path: string | null) => DroppableNote | null
  onDrop: (path: string, target: NoteDropTarget) => void
}) {
  const [preview, setPreview] = useState<NoteDropPreview | null>(null)
  // The drag this workspace saw start. Cleared when the vault, pages, layout or transition state change.
  const originRef = useRef<{ path: string; vault: string } | null>(null)
  const describeRef = useRef(describe)
  const onDropRef = useRef(onDrop)
  const vaultRef = useRef(vaultPath)
  useEffect(() => {
    describeRef.current = describe
    onDropRef.current = onDrop
    vaultRef.current = vaultPath
  })

  useEffect(() => {
    const show = (next: NoteDropPreview | null) => setPreview(current => (samePreview(current, next) ? current : next))
    const areaUnder = (event: DragEvent) => {
      const area = areaRef.current
      return area && event.target instanceof Node && area.contains(event.target) ? area : null
    }
    const claim = (event: DragEvent) => {
      event.preventDefault()
      event.stopPropagation()
    }
    const fromThisDrag = (path: string | null) => {
      const origin = originRef.current
      return origin && path && notePathsMatch(origin.path, path) && origin.vault === vaultRef.current ? path : null
    }
    // Bubble phase: runs after the note row has written its payload.
    const onDragStart = (event: DragEvent) => {
      const path = isNoteDrag(event) ? readDraggedNotePath(event.dataTransfer) : null
      originRef.current = path ? { path, vault: vaultRef.current } : null
    }
    const onDragOver = (event: DragEvent) => {
      if (!isNoteDrag(event)) return
      const area = areaUnder(event)
      if (!area) { show(null); return }
      claim(event)
      // BlockNote forwards nearby outside hovers into its editor with clamped coordinates.
      if ('synthetic' in event && event.synthetic === true) {
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
        show(null)
        return
      }
      // Browsers hide the payload until drop; the drag session still names the note.
      const note = describeRef.current(fromThisDrag(readDraggedNotePath(event.dataTransfer)))
      const hit = note ? hitAt(area, event, note.edges) : null
      if (event.dataTransfer) event.dataTransfer.dropEffect = hit ? 'move' : 'none'
      show(note && { title: note.title, edges: note.edges, edge: hit && 'edge' in hit.target ? hit.target.edge : null, center: hit?.center ?? null })
    }
    const onDropEvent = (event: DragEvent) => {
      if (!isNoteDrag(event)) return
      show(null)
      const path = fromThisDrag(readDraggedNotePath(event.dataTransfer))
      // End our origin before an outside drop can be forwarded back into an editor.
      // Keep the shared note payload available for the sidebar's outside-drop handler.
      originRef.current = null
      const area = areaUnder(event)
      if (!area) return
      // Consumed even when invalid or stale: no target may receive the path as text.
      claim(event)
      clearDraggedNotePath()
      const note = path ? describeRef.current(path) : null
      const hit = note ? hitAt(area, event, note.edges) : null
      if (path && hit) onDropRef.current(path, hit.target)
    }
    const clear = () => show(null)
    const end = () => { originRef.current = null; show(null) }
    window.addEventListener('dragstart', onDragStart)
    window.addEventListener('dragenter', onDragOver, true)
    window.addEventListener('dragover', onDragOver, true)
    window.addEventListener('drop', onDropEvent, true)
    window.addEventListener('dragend', end, true)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('dragstart', onDragStart)
      window.removeEventListener('dragenter', onDragOver, true)
      window.removeEventListener('dragover', onDragOver, true)
      window.removeEventListener('drop', onDropEvent, true)
      window.removeEventListener('dragend', end, true)
      window.removeEventListener('blur', clear)
    }
  }, [areaRef])

  /** Called on vault, page, layout or transition changes: a drag that started before them cannot drop. */
  const invalidateNoteDrag = useCallback(() => {
    originRef.current = null
    setPreview(null)
  }, [])
  return { preview, invalidateNoteDrag }
}
