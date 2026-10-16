import { act, render, screen } from '@testing-library/react'
import { undo } from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'
import { useRef, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { resumeEditorFocus, suspendEditorFocus, useEditorFocusScope } from '../hooks/editorFocusOwnership'
import { readyPageFor } from '../hooks/useEditorFocus'
import type { ContentReceipt } from '../hooks/useEditorSave'
import { RawEditorView } from './RawEditorView'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const PATH = '/vault/Daily/2026-10-15.md'

// Seam: the raw-mode preference must take a pending draft the same way: one change the save queue already holds.
describe('RawEditorView pending draft', () => {
  it('appends the raw text as one undo step, already handed to the save queue, only in its active pane', () => {
    const pane = document.body.appendChild(document.createElement('section'))
    Object.assign(pane.dataset, { paneId: '0', notePath: PATH, paneActive: 'false' })
    const onContentChange = vi.fn((path: string, content: string) => ({ path, content, session: 1, seq: 7 }))
    render(<RawEditorView content={'# Today\n\n'} entries={[]} onContentChange={onContentChange} onSave={vi.fn()} path={PATH} />,
      { container: pane })
    const view = (screen.getByTestId('raw-editor-codemirror') as HTMLElement & { __cmView: EditorView }).__cmView

    expect(readyPageFor(PATH)?.accept('Ålesund 港\n- [ ] keep')).toEqual({ kind: 'notReady' })
    expect(view.state.doc.toString()).toBe('# Today\n\n')
    pane.dataset.paneActive = 'true'
    act(() => {
      expect(readyPageFor(PATH)?.accept('Ålesund 港\n- [ ] keep')).toEqual({
        kind: 'delivered', receipt: { path: PATH, content: '# Today\n\nÅlesund 港\n- [ ] keep', session: 1, seq: 7 }, focused: true,
      })
    })

    expect(onContentChange).toHaveBeenCalledExactlyOnceWith(PATH, '# Today\n\nÅlesund 港\n- [ ] keep')
    const end = view.state.selection.main.head
    expect(end).toBe(view.state.doc.length)
    act(() => { view.dispatch({ changes: { from: end, insert: '!' }, selection: { anchor: end + 1 }, userEvent: 'input.type' }) })
    act(() => { undo(view) })
    expect(view.state.doc.toString()).toBe('# Today\n\nÅlesund 港\n- [ ] keep')
    act(() => { undo(view) })
    expect(view.state.doc.toString()).toBe('# Today\n\n')
    pane.remove()
  })

  // Seam: the draft field's focus boundary turns the app's editor focus guard on; the raw page must still get the keys.
  it('takes the keyboard from the draft field through the real editor focus guard', () => {
    const pane = document.body.appendChild(document.createElement('section'))
    Object.assign(pane.dataset, { paneId: '0', notePath: PATH, paneActive: 'true' })
    render(<GuardedScope><RawEditorView content={'# Today\n\n'} entries={[]} onContentChange={vi.fn()} onSave={vi.fn()} path={PATH} /></GuardedScope>,
      { container: pane })
    const field = document.body.appendChild(document.createElement('textarea'))
    field.focus()
    suspendEditorFocus(field)

    act(() => { readyPageFor(PATH)?.accept('港 keep') })

    expect(document.activeElement).toBe(pane.querySelector('.cm-content'))
    resumeEditorFocus()
    field.remove()
    pane.remove()
  })

  it('reports a dropped or changed admission as uncertain, never as delivered', () => {
    const pane = document.body.appendChild(document.createElement('section'))
    Object.assign(pane.dataset, { paneId: '0', notePath: PATH, paneActive: 'true' })
    const refused = vi.fn<(path: string, content: string) => ContentReceipt | null>(() => null)
    render(<RawEditorView content="" entries={[]} onContentChange={refused} onSave={vi.fn()} path={PATH} />, { container: pane })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    let result: unknown
    act(() => { result = readyPageFor(PATH)?.accept('words') })
    expect(result).toEqual({ kind: 'uncertain' })
    expect(refused).toHaveBeenCalledExactlyOnceWith(PATH, 'words')
    // A receipt for other bytes is no proof that these words are queued.
    refused.mockReturnValueOnce({ path: PATH, content: 'words', session: 1, seq: 2 })
    act(() => { result = readyPageFor(PATH)?.accept('more') })
    expect(result).toEqual({ kind: 'uncertain' })
    pane.remove()
  })
})

function GuardedScope({ children }: { children: ReactNode }) {
  const scopeRef = useRef<HTMLDivElement>(null)
  useEditorFocusScope(scopeRef)
  return <div ref={scopeRef}>{children}</div>
}
