import { afterEach, describe, expect, it } from 'vitest'
import { clearEditorDomSelection } from '../hooks/editorDomSelection'
import { editorContainer, editorScopeForEditor, editorScopeForPath } from './editorScope'

afterEach(() => { document.body.innerHTML = '' })
describe('pane DOM ownership', () => {
  it('reads and clears only the requested editor surface', () => {
    document.body.innerHTML = '<section data-pane-id="0" data-note-path="/left"><div class="editor__blocknote-container"><div contenteditable="true">left</div></div></section><section data-pane-id="1" data-note-path="/right"><div class="editor__blocknote-container"><div contenteditable="true">right</div></div></section>'
    const left = document.querySelector<HTMLElement>('[data-pane-id="0"] [contenteditable]')!
    const right = document.querySelector<HTMLElement>('[data-pane-id="1"] [contenteditable]')!
    const leftContainer = left.parentElement!
    const rightContainer = right.parentElement!
    leftContainer.scrollTop = 35
    rightContainer.scrollTop = 120
    expect(editorContainer({ prosemirrorView: { dom: right } })?.scrollTop).toBe(120)
    left.focus()
    const selection = window.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(left)
    selection.removeAllRanges()
    selection.addRange(range)
    clearEditorDomSelection(editorScopeForPath('/right'))
    expect(document.activeElement).toBe(left)
    expect(selection.toString()).toBe('left')
    expect(leftContainer.scrollTop).toBe(35)
  })
  it('never falls back to another pane when a requested page is missing', () => {
    document.body.innerHTML = '<section data-pane-id="0" data-note-path="/left"><div class="editor__blocknote-container">left</div></section>'
    expect(editorScopeForPath('/missing').querySelector('.editor__blocknote-container')).toBeNull()
  })
  it('gives an unmounted editor no surface, never the other pane', () => {
    document.body.innerHTML = '<section data-pane-id="0" data-note-path="/left"><div class="editor__blocknote-container"><div contenteditable="true">left</div></div></section>'
    // Like Tiptap: once unmounted, reading the view's DOM throws.
    const unmounted = { get prosemirrorView() { return { get dom(): HTMLElement { throw new Error('view not available') } } } }
    expect(editorContainer(unmounted)).toBeNull()
    expect(editorScopeForEditor(unmounted).querySelector('[contenteditable]')).toBeNull()
  })
})
