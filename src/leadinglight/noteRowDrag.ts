import type { PointerEvent as ReactPointerEvent } from 'react'

export interface NoteRowOrigin { readonly path: string }
export interface NoteRowPoint { readonly x: number; readonly y: number; readonly element: Element | null }
/** What one destination would do with a release at a point. */
export interface NoteRowDropClaim { preview: () => void; drop: () => void }
export interface NoteRowDropTarget {
  /** The claim for a release at this point, or null. Changes nothing itself. */
  hit: (point: NoteRowPoint) => NoteRowDropClaim | null
  /** The pointer while dragging, wherever it is; null once the gesture ends. */
  follow?: (point: NoteRowPoint | null) => void
  /** Removes this destination's preview. */
  clear: () => void
}
type BeginTarget = (origin: NoteRowOrigin) => NoteRowDropTarget | null

// Shorter presses stay clicks.
const DRAG_THRESHOLD_PX = 5
// Controls inside a row keep their own press.
const ROW_CONTROLS = '[data-property-chip="true"],button,a,input,textarea,select,[contenteditable="true"],[role="button"]'
const DRAGGING_ATTRIBUTE = 'data-note-row-dragging'

const targets = new Set<BeginTarget>()
let session: { cancel: () => void; end: () => void } | null = null
let clearReleaseClick: (() => void) | null = null

/** Registrations are snapshotted at press, so a newly mounted destination cannot adopt a drag. */
export function registerNoteRowDropTarget(begin: BeginTarget): () => void {
  targets.add(begin)
  return () => {
    targets.delete(begin)
    cancelNoteRowDrag()
  }
}

/** Invalidate the whole gesture, including sidebar destinations and presses below threshold. */
export function cancelNoteRowDrag(): void { session?.cancel() }

function suppressReleaseClick(up: PointerEvent) {
  clearReleaseClick?.()
  const clear = () => {
    window.removeEventListener('click', swallow, true)
    window.removeEventListener('pointerdown', clear, true)
    window.clearTimeout(timer)
    clearReleaseClick = null
  }
  const swallow = (click: MouseEvent) => {
    if (click.detail === 0 || click.button !== 0 || Math.hypot(click.clientX - up.clientX, click.clientY - up.clientY) > 2) return
    click.preventDefault()
    click.stopImmediatePropagation()
    clear()
  }
  window.addEventListener('click', swallow, true)
  window.addEventListener('pointerdown', clear, true)
  // A click belongs to this release only within the current browser event turn.
  const timer = window.setTimeout(clear, 0)
  clearReleaseClick = clear
}

/** One internal pointer path for note rows; nothing is exported to a native drag clipboard. */
export function startNoteRowDrag(event: ReactPointerEvent<HTMLElement>, origin: NoteRowOrigin): void {
  if (event.button !== 0 || event.isPrimary === false || event.pointerType === 'touch'
    || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
  const control = event.target instanceof Element ? event.target.closest(ROW_CONTROLS) : null
  if (control && control !== event.currentTarget && event.currentTarget.contains(control)) return
  session?.end()
  const note: NoteRowOrigin = Object.freeze({ path: origin.path })
  const candidates = [...targets].map(begin => begin(note)).filter((target): target is NoteRowDropTarget => target !== null)
  if (!candidates.length) return
  const { pointerId, clientX: startX, clientY: startY } = event
  // Some input (accessibility, automation) reports no held button for the whole press.
  // Only then is a button-less move not evidence of a release we missed.
  const pressReportsButtons = event.buttons !== 0
  // The root survives virtualized row recycling and unmounts.
  const root = document.documentElement
  let phase: 'pressed' | 'dragging' | 'canceled' = 'pressed'
  const pointAt = (pointer: PointerEvent): NoteRowPoint =>
    ({ x: pointer.clientX, y: pointer.clientY, element: document.elementFromPoint(pointer.clientX, pointer.clientY) })
  const claimAt = (point: NoteRowPoint) => {
    for (const target of candidates) {
      const claim = target.hit(point)
      if (claim) return { target, claim }
    }
    return null
  }
  const show = (point: NoteRowPoint) => {
    const won = claimAt(point)
    for (const target of candidates) {
      target.follow?.(point)
      if (target !== won?.target) target.clear()
    }
    won?.claim.preview()
  }
  const hide = () => {
    root.removeAttribute(DRAGGING_ATTRIBUTE)
    for (const target of candidates) {
      target.follow?.(null)
      target.clear()
    }
  }
  const onMove = (move: PointerEvent) => {
    if (move.pointerId !== pointerId) return
    // No button held means the release happened where we could not see it.
    if (move.buttons === 0 && pressReportsButtons) { end(); return }
    if (phase === 'canceled') return
    if (phase === 'pressed') {
      if (Math.hypot(move.clientX - startX, move.clientY - startY) < DRAG_THRESHOLD_PX) return
      phase = 'dragging'
      root.setAttribute(DRAGGING_ATTRIBUTE, '')
      // Only now: capture on press would take a short click away from the row.
      try { root.setPointerCapture?.(pointerId) } catch { /* Window listeners still apply. */ }
    }
    show(pointAt(move))
  }
  const onUp = (up: PointerEvent) => {
    if (up.pointerId !== pointerId) return
    // The release point decides, so a release elsewhere never commits an earlier preview.
    const won = phase === 'dragging' ? claimAt(pointAt(up)) : null
    if (phase !== 'pressed') suppressReleaseClick(up)
    // End first: the drop may rerender or unregister destinations, and must run only once.
    end()
    won?.claim.drop()
  }
  const onCancel = (pointer: PointerEvent) => { if (pointer.pointerId === pointerId) end() }
  // After a drag starts, keep listening until release so the release click does not open the row.
  const cancel = () => {
    if (phase === 'pressed') { end(); return }
    phase = 'canceled'
    hide()
  }
  const onKeyDown = (key: KeyboardEvent) => {
    if (key.key !== 'Escape') return
    if (phase === 'dragging') {
      key.preventDefault()
      key.stopPropagation()
    }
    cancel()
  }
  const current = { cancel, end }
  function end() {
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointerdown', end, true)
    window.removeEventListener('pointercancel', onCancel, true)
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('blur', end)
    root.removeEventListener('lostpointercapture', onCancel)
    if (session === current) session = null
    hide()
    try { if (root.hasPointerCapture?.(pointerId)) root.releasePointerCapture(pointerId) } catch { /* Already released. */ }
  }
  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerup', onUp, true)
  // A new press means this gesture's release was missed; it must never drop later.
  window.addEventListener('pointerdown', end, true)
  window.addEventListener('pointercancel', onCancel, true)
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('blur', end)
  root.addEventListener('lostpointercapture', onCancel)
  session = current
}
