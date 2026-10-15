import type { PaneId, SplitOrientation } from './useSplitWorkspace'

export type DropEdge = 'left' | 'right' | 'top' | 'bottom'
export type PaneOrder = readonly [PaneId, PaneId]
/** Where a note dragged from the list should open: at an edge, or in the pane under the pointer. */
export type NoteDropTarget = { edge: DropEdge } | { pane: PaneId }
interface PaneLayout {
  split: boolean
  orientation: SplitOrientation
  order: PaneOrder
}

export const DROP_EDGES: DropEdge[] = ['left', 'right', 'top', 'bottom']
// Share of the page area, from each edge, that counts as that edge.
const EDGE_REACH = 0.3

export function edgeSlot(edge: DropEdge): 0 | 1 {
  return edge === 'left' || edge === 'top' ? 0 : 1
}

/** The layout after placing a pane at an edge, or null when nothing would change. */
export function pagePlacement(layout: PaneLayout, pane: PaneId, edge: DropEdge): PaneLayout | null {
  const orientation: SplitOrientation = edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical'
  const slot = edgeSlot(edge)
  const other: PaneId = pane === 0 ? 1 : 0
  if (layout.split && layout.orientation === orientation && layout.order[slot] === pane) return null
  return { split: true, orientation, order: slot === 0 ? [pane, other] : [other, pane] }
}

export function offeredEdges(layout: PaneLayout, pane: PaneId): DropEdge[] {
  return DROP_EDGES.filter(edge => pagePlacement(layout, pane, edge))
}

export function dropEdgeAt(rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, x: number, y: number, offered: DropEdge[]): DropEdge | null {
  if (!rect.width || !rect.height) return null
  const nx = (x - rect.left) / rect.width
  const ny = (y - rect.top) / rect.height
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null
  const distances: Array<[DropEdge, number]> = [['left', nx], ['right', 1 - nx], ['top', ny], ['bottom', 1 - ny]]
  const [edge, distance] = distances.reduce((nearest, item) => (item[1] < nearest[1] ? item : nearest))
  return distance <= EDGE_REACH && offered.includes(edge) ? edge : null
}

const ARROW_EDGES = new Map<string, DropEdge>([['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['ArrowUp', 'top'], ['ArrowDown', 'bottom']])

export function arrowEdge(key: string): DropEdge | null {
  return ARROW_EDGES.get(key) ?? null
}
