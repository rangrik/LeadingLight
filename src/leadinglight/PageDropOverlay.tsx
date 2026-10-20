import { useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { translate, type AppLocale } from '../lib/i18n'
import type { DropEdge } from './pageTabDrag'
import type { DragPointer, PaneRect } from './useNoteListDrop'

const EDGE_LABELS = {
  left: 'leadinglight.split.placeLeft',
  right: 'leadinglight.split.placeRight',
  top: 'leadinglight.split.placeTop',
  bottom: 'leadinglight.split.placeBottom',
} as const satisfies Record<DropEdge, string>

interface DropPreview {
  title: string
  edges: DropEdge[]
  edge: DropEdge | null
  /** Pane under the pointer for a note dropped from the list. */
  center?: PaneRect | null
  /** Pointer position for page-tab drags. */
  x?: number
  y?: number
  /** Pointer for note-row drags, followed by the chip alone. */
  pointer?: DragPointer
}

function Chip({ title, x, y }: { title: string; x: number; y: number }) {
  return <div className="ll-drag-chip" aria-hidden="true" style={{ left: x, top: y }}>{title}</div>
}

// Over the list and sidebar too, so it must not depend on the editor column's containment or clipping.
function FollowingChip({ title, pointer }: { title: string; pointer: DragPointer }) {
  const at = useSyncExternalStore(pointer.subscribe, pointer.get)
  return at && createPortal(<Chip title={title} x={at.x} y={at.y} />, document.body)
}

/** Temporary preview only; it never touches layout or persistence. */
export function PageDropOverlay({ drag, locale }: { drag: DropPreview | null; locale: AppLocale }) {
  const status = !drag ? '' : drag.edge
    ? translate(locale, EDGE_LABELS[drag.edge])
    : drag.center
      ? translate(locale, 'leadinglight.split.openHere')
      : translate(locale, 'leadinglight.split.dragStatus', { title: drag.title })
  return <>
    {/* Mounted before a drag starts so screen readers announce changes. */}
    <span role="status" className="sr-only">{status}</span>
    {/* A note row away from the page area shows only its chip. */}
    {drag && (drag.edges.length > 0 || drag.center) && <div className="ll-drop-overlay" aria-hidden="true">
      {drag.edges.map(edge => <div key={edge} className="ll-drop-zone" data-edge={edge} data-active={drag.edge === edge}>
        <span>{translate(locale, EDGE_LABELS[edge])}</span>
      </div>)}
      {drag.center && <div className="ll-drop-zone" data-edge="center" data-active="true"
        style={{ left: drag.center.left + 6, top: drag.center.top + 6, width: drag.center.width - 12, height: drag.center.height - 12 }}>
        <span>{translate(locale, 'leadinglight.split.openHere')}</span>
      </div>}
    </div>}
    {drag?.pointer
      ? <FollowingChip title={drag.title} pointer={drag.pointer} />
      : drag?.x !== undefined && drag.y !== undefined && <Chip title={drag.title} x={drag.x} y={drag.y} />}
  </>
}
