import { act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearParsedNoteBlockCache } from './editorParsedBlockCache'
import { RICH_EDITOR_CHANGE_DEBOUNCE_MS } from './useEditorTabSwap'
import { createSwapHarness, makeTab, makeTextParagraphBlock } from './useEditorTabSwap.test-utils'

const emptyTab = { ...makeTab('/vault/empty.md', 'Empty'), content: '' }
const firstText = 'First words in an empty file'

afterEach(() => {
  clearParsedNoteBlockCache()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useEditorTabSwap zero-byte Markdown files', () => {
  it.each([false, true])('flushes the first edit when file content arrives asynchronously: %s', async arrivesLater => {
    const onContentChange = vi.fn()
    const { result, docRef, mockEditor, rerenderWith } = await createSwapHarness({
      initialProps: { tabs: arrivesLater ? [] : [emptyTab], activeTabPath: emptyTab.entry.path },
      onContentChange,
    })
    if (arrivesLater) await rerenderWith({ tabs: [emptyTab] })

    docRef.current = [makeTextParagraphBlock(firstText)]
    mockEditor.blocksToMarkdownLossy.mockReturnValue(`${firstText}\n`)
    act(() => {
      result.current.handleEditorChange()
      result.current.flushPendingEditorChange()
    })

    expect(onContentChange).toHaveBeenCalledExactlyOnceWith(emptyTab.entry.path, `${firstText}\n`)
  })

  it('propagates the first edit after the idle debounce without a manual save', async () => {
    const onContentChange = vi.fn()
    const { result, docRef, mockEditor } = await createSwapHarness({
      initialProps: { tabs: [emptyTab], activeTabPath: emptyTab.entry.path },
      onContentChange,
    })
    docRef.current = [makeTextParagraphBlock(firstText)]
    mockEditor.blocksToMarkdownLossy.mockReturnValue(`${firstText}\n`)
    vi.useFakeTimers()

    act(() => result.current.handleEditorChange())
    expect(onContentChange).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(RICH_EDITOR_CHANGE_DEBOUNCE_MS))

    expect(onContentChange).toHaveBeenCalledExactlyOnceWith(emptyTab.entry.path, `${firstText}\n`)
  })

  it('does not save a requested file before its asynchronous content read arrives', async () => {
    const onContentChange = vi.fn()
    const { result, docRef, mockEditor } = await createSwapHarness({
      initialProps: { tabs: [], activeTabPath: emptyTab.entry.path },
      onContentChange,
    })
    docRef.current = [makeTextParagraphBlock('Previous editor contents')]
    mockEditor.blocksToMarkdownLossy.mockReturnValue('Previous editor contents\n')

    act(() => {
      result.current.handleEditorChange()
      result.current.flushPendingEditorChange()
    })

    expect(onContentChange).not.toHaveBeenCalled()
  })
})
