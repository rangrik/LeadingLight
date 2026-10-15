import { translate, type AppLocale } from '../lib/i18n'
import type { DropEdge } from './pageTabDrag'
import type { PaneRect } from './useNoteListDrop'

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
  /** Pointer position for title drags; list drags already show the native drag image. */
  x?: number
  y?: number
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
    {drag && <div className="ll-drop-overlay" aria-hidden="true">
      {drag.edges.map(edge => <div key={edge} className="ll-drop-zone" data-edge={edge} data-active={drag.edge === edge}>
        <span>{translate(locale, EDGE_LABELS[edge])}</span>
      </div>)}
      {drag.center && <div className="ll-drop-zone" data-edge="center" data-active="true"
        style={{ left: drag.center.left + 6, top: drag.center.top + 6, width: drag.center.width - 12, height: drag.center.height - 12 }}>
        <span>{translate(locale, 'leadinglight.split.openHere')}</span>
      </div>}
    </div>}
    {drag?.x !== undefined && drag.y !== undefined && <div className="ll-drag-chip" aria-hidden="true" style={{ left: drag.x, top: drag.y }}>{drag.title}</div>}
  </>
}
