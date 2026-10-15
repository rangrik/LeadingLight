import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'

export const RICH_EDITOR_CHANGE_DEBOUNCE_MS = 1_500

export function useDebouncedEditorChange({
  onFlush,
  suppressChangeRef,
}: {
  onFlush: () => void
  suppressChangeRef: MutableRefObject<boolean>
}) {
  const pendingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (!timerRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const flushPendingEditorChange = useCallback(() => {
    if (!pendingRef.current) return false
    clearTimer()
    onFlush()
    pendingRef.current = false
    return true
  }, [clearTimer, onFlush])

  const tryBackgroundFlush = useCallback(() => {
    try {
      flushPendingEditorChange()
    } catch (error) {
      // Keep the pending change so an explicit save/close can report and retry it.
      console.warn('[editor] Could not flush pending editor change:', error)
    }
  }, [flushPendingEditorChange])

  const handleEditorChange = useCallback(() => {
    if (suppressChangeRef.current) return

    pendingRef.current = true
    clearTimer()
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      tryBackgroundFlush()
    }, RICH_EDITOR_CHANGE_DEBOUNCE_MS)
  }, [clearTimer, tryBackgroundFlush, suppressChangeRef])

  useEffect(() => {
    return () => {
      tryBackgroundFlush()
      clearTimer()
    }
  }, [clearTimer, tryBackgroundFlush])

  return { handleEditorChange, flushPendingEditorChange }
}

export function consumeRawModeTransition(
  prevRawModeRef: MutableRefObject<boolean>,
  rawMode: boolean | undefined,
) {
  const rawModeJustEnded = prevRawModeRef.current && !rawMode
  prevRawModeRef.current = !!rawMode
  return rawModeJustEnded
}

export function flushBeforeRawMode(options: {
  rawMode?: boolean
  flushPendingEditorChange: () => boolean
}) {
  const { rawMode, flushPendingEditorChange } = options
  if (!rawMode) return false
  flushPendingEditorChange()
  return true
}

export function flushBeforePathChange(options: {
  pathChanged: boolean
  flushPendingEditorChange: () => boolean
}) {
  const { pathChanged, flushPendingEditorChange } = options
  if (pathChanged) flushPendingEditorChange()
}
