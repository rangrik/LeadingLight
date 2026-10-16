import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'
import { renderHook } from '@testing-library/react'
import { BlockNoteEditor } from '@blocknote/core'
import { schema } from '../components/editorSchema'
import { resumeEditorFocus, suspendEditorFocus, useEditorFocusScope } from '../hooks/editorFocusOwnership'
import { insertDraftAtEnd, readyPageFor, useEditorFocus } from '../hooks/useEditorFocus'

function mounted() {
  const editor = BlockNoteEditor.create({ schema })
  editor.mount(document.body.appendChild(document.createElement('div')))
  return editor
}

const texts = (editor: ReturnType<typeof mounted>) => editor.document.map(block =>
  (Array.isArray(block.content) ? block.content : []).map(item => ('text' in item ? item.text : '')).join(''))

// Seam: the draft reaches the real editor as one step; a split or merged step would duplicate or lose text on undo.
describe('a pending draft in the rich editor', () => {
  it('becomes paragraphs in one undo step, with the caret after it and later typing kept apart', () => {
    const editor = mounted()
    insertDraftAtEnd(editor, 'Harbor fog at dawn — café crème.\nÅlesund 港 ✓ naïve résumé.')

    expect(texts(editor).filter(Boolean)).toEqual(['Harbor fog at dawn — café crème.', 'Ålesund 港 ✓ naïve résumé.'])
    expect(editor.getTextCursorPosition().block.id).toBe(editor.document[1].id)
    editor.insertInlineContent(' tail')
    expect(texts(editor)[1]).toBe('Ålesund 港 ✓ naïve résumé. tail')

    editor.undo()
    expect(texts(editor)[1]).toBe('Ålesund 港 ✓ naïve résumé.')
    editor.undo()
    expect(texts(editor).filter(Boolean)).toEqual([])
  })

  it('keeps typing after a draft that ends with a new line as its own undo step', () => {
    const editor = mounted()
    insertDraftAtEnd(editor, 'first line\n')
    editor.insertInlineContent('next')
    expect(texts(editor)).toEqual(['first line', 'next', ''])

    editor.undo()
    expect(texts(editor).filter(Boolean)).toEqual(['first line'])
  })

  describe('hand-over into a page whose view has just mounted', () => {
    const PATH = '/vault/untitled-page-1.md'
    afterEach(() => {
      resumeEditorFocus()
      document.body.innerHTML = ''
    })

    // BlockNote's own focus() is a no-op until Tiptap finishes init, a task after each mount.
    function freshPage() {
      const pane = document.body.appendChild(document.createElement('section'))
      Object.assign(pane.dataset, { paneId: '0', notePath: PATH, paneActive: 'true' })
      const editor = BlockNoteEditor.create({ schema })
      editor.mount(pane.appendChild(document.createElement('div')))
      const field = document.body.appendChild(document.createElement('textarea'))
      field.focus()
      suspendEditorFocus(field)
      const takeDraft = vi.fn((text: string) => {
        insertDraftAtEnd(editor, text)
        return { path: PATH, content: text, session: 1, seq: 1 }
      })
      renderHook(() => {
        const scopeRef = useRef<HTMLElement>(pane)
        useEditorFocusScope(scopeRef)
        useEditorFocus(editor, { current: true }, PATH, PATH, takeDraft)
      })
      return { pane, editor, takeDraft }
    }

    it('takes the keyboard through the real focus guard, with the draft after it', () => {
      const { editor } = freshPage()
      readyPageFor(PATH)?.accept('first thought')

      expect(document.activeElement).toBe(editor.prosemirrorView?.dom)
      expect(texts(editor).filter(Boolean)).toEqual(['first thought'])
    })

    it('inserts nothing while its pane is inert, then once when it is not', () => {
      const { pane, editor, takeDraft } = freshPage()
      pane.setAttribute('inert', '')
      readyPageFor(PATH)?.accept('first thought')
      expect(takeDraft).not.toHaveBeenCalled()
      expect(texts(editor).filter(Boolean)).toEqual([])

      pane.removeAttribute('inert')
      readyPageFor(PATH)?.accept('first thought')
      expect(texts(editor).filter(Boolean)).toEqual(['first thought'])
      expect(document.activeElement).toBe(editor.prosemirrorView?.dom)
    })
  })

  it('goes after existing text, never into a heading', () => {
    const editor = mounted()
    editor.replaceBlocks(editor.document, [{ type: 'heading', props: { level: 1 }, content: 'October 15, 2026' }])
    insertDraftAtEnd(editor, 'first thought')

    expect(editor.document[0]).toMatchObject({ type: 'heading' })
    expect(texts(editor).filter(Boolean)).toEqual(['October 15, 2026', 'first thought'])
  })
})
