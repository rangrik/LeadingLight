const compositionChecks = new WeakMap<object, () => void>()

/** Each mounted rich editor owns its own composition readiness check. */
export function registerEditorCompositionBoundary(editor: object, check: () => void) {
  compositionChecks.set(editor, check)
  return () => {
    if (compositionChecks.get(editor) === check) compositionChecks.delete(editor)
  }
}

/** A save must not acknowledge text which ProseMirror has not reconciled yet. */
export function assertEditorCompositionReady(editor: object) {
  compositionChecks.get(editor)?.()
}
