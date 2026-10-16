import { StrictMode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearParsedNoteBlockCache } from './editorParsedBlockCache'
import { blankParagraphBlocks } from './editorTabContent'
import { useEditorTabSwap } from './useEditorTabSwap'
import { flushEditorTick, flushQueuedFrames, makeMockEditor, makeTab, makeTextParagraphBlock, type SwapHarnessProps } from './useEditorTabSwap.test-utils'

// Seam: StrictMode's effect replay and the deferred opening swap. Catches typing in a new page never reaching save.
const NEW = '/vault/new.md'
const WRITTEN = '/vault/written.md'
const emptyPage = { ...makeTab(NEW, 'New'), content: '' }
const writtenPage = makeTab(WRITTEN, 'Written')

function openUnderStrictMode(initialProps: SwapHarnessProps) {
  const frames: FrameRequestCallback[] = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => frames.push(callback))
  vi.spyOn(document, 'querySelector').mockReturnValue({ scrollTop: 0 } as unknown as Element)
  const docRef = { current: blankParagraphBlocks() as unknown[] }
  const editor = makeMockEditor(docRef)
  const onContentChange = vi.fn()
  const hook = renderHook(
    (props: SwapHarnessProps) => useEditorTabSwap({ ...props, editor: editor as never, onContentChange }),
    { initialProps, wrapper: StrictMode },
  )
  const runFrames = async () => {
    for (let round = 0; round < 4; round += 1) {
      flushQueuedFrames(frames)
      await flushEditorTick()
    }
  }
  const type = (text: string) => {
    docRef.current = [makeTextParagraphBlock(text)]
    editor.blocksToMarkdownLossy.mockReturnValue(`${text}\n`)
    act(() => {
      hook.result.current.handleEditorChange()
      hook.result.current.flushPendingEditorChange()
    })
  }
  return { ...hook, docRef, editor, onContentChange, runFrames, type }
}

afterEach(() => {
  clearParsedNoteBlockCache()
  vi.restoreAllMocks()
})

describe('useEditorTabSwap under StrictMode with deferred frames', () => {
  it('saves the first words typed into a new empty page, and no old swap erases them', async () => {
    const page = openUnderStrictMode({ tabs: [emptyPage], activeTabPath: NEW })
    await page.runFrames()

    page.type('First words')
    const applied = page.editor.replaceBlocks.mock.calls.length
    await page.runFrames()

    expect(page.onContentChange).toHaveBeenCalledExactlyOnceWith(NEW, 'First words\n')
    expect(page.editor.replaceBlocks).toHaveBeenCalledTimes(applied)
    expect(page.docRef.current).toEqual([makeTextParagraphBlock('First words')])
  })

  it('keeps edits off both pages while switching away from a new page, then saves to the shown one', async () => {
    const page = openUnderStrictMode({ tabs: [emptyPage], activeTabPath: NEW })
    page.rerender({ tabs: [emptyPage, writtenPage], activeTabPath: WRITTEN })
    page.type('Stray')
    expect(page.onContentChange).not.toHaveBeenCalled()

    await page.runFrames()
    page.type('Edited')

    expect(page.onContentChange).toHaveBeenCalledOnce()
    expect(page.onContentChange).toHaveBeenCalledWith(WRITTEN, expect.stringContaining('Edited'))
  })

  it('runs no opening swap and saves nothing after the editor closes', async () => {
    const page = openUnderStrictMode({ tabs: [emptyPage], activeTabPath: NEW })
    page.unmount()
    await page.runFrames()

    expect(page.editor.replaceBlocks).not.toHaveBeenCalled()
    expect(page.onContentChange).not.toHaveBeenCalled()
  })
})
