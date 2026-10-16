import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import type { EditorIdleCheck } from '../../components/editorContentFlushRegistration'
import type { ContentReceipt } from '../../hooks/useEditorSave'
import type { OpenReservation } from '../../hooks/useNoteCreation'
import { clearPrefetchCache } from '../../hooks/useTabManagement'
import { notePathsMatch } from '../../utils/notePathIdentity'

/** The editor side of a final recovery choice: prove a page's buffers hold only the bound text, then close it. */
export interface PageSettlement {
  idle: (path: string, content: string) => boolean
  /**
   * Closes the page without saving; its editor's late writes are refused until that editor is gone.
   * Returns a later open in the pane that showed it, or null when no pane did.
   */
  close: (path: string) => OpenReservation | null
}

type Panes<T> = readonly [T, T]
type ContentChange = (path: string, content: string) => ContentReceipt | null | void

export const includesPath = (paths: Iterable<string | null> | undefined, path: string | null) =>
  !!path && [...(paths ?? [])].some(item => notePathsMatch(item, path))

export function usePaneSettlement(options: {
  paths: Panes<string | null>
  blockedPaths?: ReadonlySet<string>
  onContentChange?: ContentChange
  idleRefs: Panes<MutableRefObject<EditorIdleCheck | null>>
  closePageAndReserveOpen: (path: string) => OpenReservation | null
  settlementRef?: MutableRefObject<PageSettlement | null>
}) {
  const { idleRefs, settlementRef } = options
  const latest = useRef(options)
  useLayoutEffect(() => { latest.current = options })
  // The page each pane settled and closed; its editor's writes are refused until it unmounts.
  const closed = useRef<[string | null, string | null]>([null, null])
  const [first, second] = options.paths
  // Passive, so it runs only after the closed editor's own unmount cleanups.
  useEffect(() => {
    closed.current = closed.current.map((path, pane) =>
      notePathsMatch(latest.current.paths[pane], path) ? path : null) as [string | null, string | null]
  }, [first, second])

  const isBlocked = useCallback((pane: 0 | 1) => {
    const path = latest.current.paths[pane]
    return notePathsMatch(closed.current[pane], path) || includesPath(latest.current.blockedPaths, path)
  }, [])
  const admit = useCallback((pane: 0 | 1, path: string, content: string) =>
    notePathsMatch(closed.current[pane], path) ? null : latest.current.onContentChange?.(path, content), [])
  const contentChanges = useMemo(() => [
    (path: string, content: string) => admit(0, path, content),
    (path: string, content: string) => admit(1, path, content),
  ] as const, [admit])

  useEffect(() => {
    if (!settlementRef) return
    const settlement: PageSettlement = {
      idle: (path, content) => idleRefs.every(ref => ref.current?.(path, content) ?? true),
      close: path => {
        latest.current.paths.forEach((shown, pane) => { if (notePathsMatch(shown, path)) closed.current[pane] = path })
        // Disk may differ from what the page opened with; reopening or the copy's open must read it again.
        clearPrefetchCache()
        return latest.current.closePageAndReserveOpen(path)
      },
    }
    settlementRef.current = settlement
    return () => { if (settlementRef.current === settlement) settlementRef.current = null }
  }, [idleRefs, settlementRef])

  return { isBlocked, contentChanges }
}
