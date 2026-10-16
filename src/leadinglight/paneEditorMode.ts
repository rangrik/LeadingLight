export type PaneEditorMode = 'preview' | 'raw'
export type PaneEditorModes = [PaneEditorMode, PaneEditorMode]

/** Reserve the current page before preparation; commit can refuse a stale reservation. */
export interface PaneEditorModeControl {
  mode: PaneEditorMode
  begin: () => ((mode: PaneEditorMode) => boolean) | null
}

export function readPaneEditorModes(value: unknown): PaneEditorModes | undefined {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(mode => mode === 'preview' || mode === 'raw')) return undefined
  return [value[0], value[1]]
}
