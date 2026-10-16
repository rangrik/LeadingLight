/** Legacy callers use the document; split editors must only touch their own surface. */
export function editorScopeForPath(path: string | null): ParentNode {
  const panes = document.querySelectorAll<HTMLElement>('[data-pane-id]')
  for (const pane of panes) if (pane.dataset.notePath === path) return pane
  return panes.length ? document.createDocumentFragment() : document
}
export function editorScopeForEditor(editor: { prosemirrorView?: { dom?: HTMLElement } }): ParentNode {
  let dom: HTMLElement | undefined
  try {
    dom = editor.prosemirrorView?.dom
  } catch {
    // An unmounted editor's view throws; it owns no surface, never the whole document.
    return document.createDocumentFragment()
  }
  return dom?.closest('[data-pane-id]') ?? dom?.closest('.editor') ?? document
}
export function editorContainer(editor: { prosemirrorView?: { dom?: HTMLElement } }): HTMLElement | null {
  return editorScopeForEditor(editor).querySelector<HTMLElement>('.editor__blocknote-container')
}
