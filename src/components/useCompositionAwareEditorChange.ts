import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { registerEditorCompositionBoundary } from '../hooks/editorCompositionBoundary'

const IME_COMMIT_RECONCILIATION_FALLBACK_MS = 50

type CompositionChangeState = {
  composing: { current: boolean }
  onChange: { current?: () => void }
  pendingChange: { current: boolean }
  pendingTimer: { current: ReturnType<typeof setTimeout> | null }
}

function clearPendingTimer(state: CompositionChangeState) {
  if (state.pendingTimer.current === null) return
  clearTimeout(state.pendingTimer.current)
  state.pendingTimer.current = null
}

function flushPendingChange(state: CompositionChangeState) {
  state.pendingTimer.current = null
  if (state.composing.current || !state.pendingChange.current) return
  state.pendingChange.current = false
  state.onChange.current?.()
}

function registerCompositionListeners(
  container: HTMLDivElement,
  state: CompositionChangeState,
) {
  const handleCompositionStart = () => {
    clearPendingTimer(state)
    state.composing.current = true
  }
  const handleCompositionEnd = () => {
    state.composing.current = false
    clearPendingTimer(state)
    state.pendingTimer.current = setTimeout(
      () => flushPendingChange(state),
      IME_COMMIT_RECONCILIATION_FALLBACK_MS,
    )
  }

  container.addEventListener('compositionstart', handleCompositionStart, true)
  container.addEventListener('compositionend', handleCompositionEnd, true)
  return () => {
    clearPendingTimer(state)
    container.removeEventListener('compositionstart', handleCompositionStart, true)
    container.removeEventListener('compositionend', handleCompositionEnd, true)
  }
}

function publishEditorChange(state: CompositionChangeState) {
  if (state.composing.current) {
    state.pendingChange.current = true
    return
  }

  clearPendingTimer(state)
  state.pendingChange.current = false
  state.onChange.current?.()
}

export function useCompositionAwareEditorChange(options: {
  containerRef: RefObject<HTMLDivElement | null>
  onChange?: () => void
  editor?: object
}) {
  const { containerRef, onChange, editor } = options
  const onChangeRef = useRef(onChange)
  const composingRef = useRef(false)
  const pendingChangeRef = useRef(false)
  const pendingFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const state = useMemo<CompositionChangeState>(
    () => ({
      composing: composingRef,
      onChange: onChangeRef,
      pendingChange: pendingChangeRef,
      pendingTimer: pendingFlushTimerRef,
    }),
    [],
  )

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useLayoutEffect(() => {
    if (!editor) return
    return registerEditorCompositionBoundary(editor, () => {
      // Do not force serialization ahead of ProseMirror's composition reconciliation.
      // Explicit save/close can retry once the existing onChange or fallback runs.
      if (state.composing.current || state.pendingChange.current) {
        throw new Error('Editor composition has not finished reconciling')
      }
    })
  }, [editor, state])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    return registerCompositionListeners(container, state)
  }, [containerRef, state])

  return useCallback(() => publishEditorChange(state), [state])
}
