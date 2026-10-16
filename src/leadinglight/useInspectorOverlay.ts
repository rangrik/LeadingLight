import { useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { requestEditorFocus } from '../hooks/useEditorFocus'
import type { PaneId } from './useSplitWorkspace'

// Beside the Inspector, a page narrower than this is too thin to write in.
const MIN_WRITING_WIDTH = 400
const OVERLAY = '[data-inspector-overlay]'

interface Options {
  areaRef: RefObject<HTMLElement | null>
  visiblePanes: readonly PaneId[]
  activePane: PaneId
  activePath: string | null
  inspectorOpen: boolean
  inspectorWidth: number
  revealPane: PaneId | null
  onClose: () => void
}

function usePaneWidths(areaRef: RefObject<HTMLElement | null>, paneKey: string) {
  const [widths, setWidths] = useState<readonly [number, number]>([0, 0])
  useLayoutEffect(() => {
    const area = areaRef.current
    if (!area) return
    const panes = () => Array.from(area.querySelectorAll<HTMLElement>(':scope > [data-pane-id]'))
    const measure = () => setWidths(current => {
      const next: [number, number] = [current[0], current[1]]
      for (const pane of panes()) next[Number(pane.dataset.paneId) as PaneId] = pane.getBoundingClientRect().width
      return next[0] === current[0] && next[1] === current[1] ? current : next
    })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    panes().forEach(pane => observer.observe(pane))
    return () => observer.disconnect()
  }, [areaRef, paneKey])
  return widths
}

function returnFocus(opener: Element | null, path: string | null) {
  // The editor guards its own focus, so it is asked rather than focused directly.
  if (opener instanceof HTMLElement && opener.isConnected && opener !== document.body && !opener.closest('[contenteditable="true"]')) opener.focus({ preventScroll: true })
  else if (path) requestEditorFocus({ path })
}

export function useInspectorOverlay({ areaRef, visiblePanes, activePane, activePath, inspectorOpen, inspectorWidth, revealPane, onClose }: Options) {
  const widths = usePaneWidths(areaRef, visiblePanes.join())
  const floats = (pane: PaneId) => widths[pane] > 0 && widths[pane] - inspectorWidth < MIN_WRITING_WIDTH
  const overlayPane = inspectorOpen && activePath && floats(activePane) ? activePane : null
  const opened = useRef<{ pane: PaneId, opener: Element | null } | null>(null)
  const wasOpen = useRef(inspectorOpen)

  useLayoutEffect(() => {
    const justOpened = inspectorOpen && !wasOpen.current
    wasOpen.current = inspectorOpen
    const previous = opened.current
    if (overlayPane === null) {
      opened.current = null
      // Give focus back only if closing dropped it and the person stayed on this page.
      const lost = !document.activeElement || document.activeElement === document.body
      if (previous?.pane === activePane && lost) returnFocus(previous.opener, activePath)
      return
    }
    if (previous?.pane !== overlayPane) opened.current = { pane: overlayPane, opener: document.activeElement }
    if (justOpened || revealPane === overlayPane) {
      areaRef.current?.querySelector<HTMLElement>(`[data-pane-id="${overlayPane}"] ${OVERLAY}`)?.focus({ preventScroll: true })
    }
  }, [areaRef, overlayPane, activePane, activePath, inspectorOpen, revealPane])

  const closeOnEscape = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target instanceof Element ? event.target : null
    // Fields, menus and pickers inside use Escape for themselves first.
    if (event.key !== 'Escape' || event.defaultPrevented || !target?.closest(OVERLAY)) return
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return
    event.preventDefault()
    onClose()
  }
  return { floats, closeOnEscape }
}
