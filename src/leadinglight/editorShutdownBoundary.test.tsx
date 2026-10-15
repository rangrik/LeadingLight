import { useRef } from 'react'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCompositionAwareEditorChange } from '../components/useCompositionAwareEditorChange'
import { createSwapHarness, makeTab, makeTextParagraphBlock } from '../hooks/useEditorTabSwap.test-utils'
import { useNativeSaveBeforeClose } from './useNativeSaveBeforeClose'

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: native.listen }))
vi.mock('../mock-tauri', () => ({ isTauri: () => true }))

let requestClose: (event: { payload: { id: number } }) => void

function CompositionEditor({ editor, onChange }: { editor: object; onChange: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const publish = useCompositionAwareEditorChange({ containerRef, onChange, editor })
  return <div ref={containerRef} data-testid="composition-editor">
    <button type="button" onClick={publish}>Publish editor change</button>
  </div>
}

async function setup() {
  const onContentChange = vi.fn()
  const onError = vi.fn()
  const swap = await createSwapHarness({
    initialProps: { tabs: [makeTab('/vault/note.md', 'Note')], activeTabPath: '/vault/note.md' },
    onContentChange,
  })
  swap.docRef.current = [makeTextParagraphBlock('Committed composition')]
  swap.mockEditor.blocksToMarkdownLossy.mockReturnValue('Committed composition\n')
  render(<CompositionEditor editor={swap.mockEditor} onChange={swap.result.current.handleEditorChange} />)
  renderHook(() => useNativeSaveBeforeClose({
    flush: async () => { swap.result.current.flushPendingEditorChange() },
    onError,
  }))
  await act(async () => {})
  return { ...swap, onContentChange, onError }
}

async function close(id: number) {
  await act(async () => { requestClose({ payload: { id } }) })
}

function expectCloseBlocked(id: number) {
  expect(native.invoke).toHaveBeenCalledWith('complete_shutdown_save', { requestId: id, saved: false })
  expect(native.invoke).not.toHaveBeenCalledWith('complete_shutdown_save', { requestId: id, saved: true })
}

beforeEach(() => {
  vi.clearAllMocks()
  native.invoke.mockResolvedValue(undefined)
  native.listen.mockImplementation(async (name, handler) => {
    if (name === 'leadinglight:save-before-close') requestClose = handler
    return () => {}
  })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('editor shutdown save boundary', () => {
  it('preserves an active composition through unrelated tab metadata renders', async () => {
    const { rerenderWith, onContentChange } = await setup()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    fireEvent.compositionStart(screen.getByTestId('composition-editor'))
    fireEvent.click(screen.getByRole('button', { name: 'Publish editor change' }))
    await rerenderWith({ tabs: [{ ...makeTab('/vault/note.md', 'Note') }] })
    expect(onContentChange).not.toHaveBeenCalled()
    await close(1)
    expectCloseBlocked(1)
    fireEvent.compositionEnd(screen.getByTestId('composition-editor'))
    fireEvent.click(screen.getByRole('button', { name: 'Publish editor change' }))
    await close(2)
    expect(onContentChange).toHaveBeenCalledWith('/vault/note.md', expect.stringContaining('Committed composition'))
    expect(native.invoke).toHaveBeenCalledWith('complete_shutdown_save', { requestId: 2, saved: true })
  })

  it('keeps an active composition open, then saves its reconciled text on retry', async () => {
    const { onContentChange, onError } = await setup()
    fireEvent.compositionStart(screen.getByTestId('composition-editor'))
    fireEvent.click(screen.getByRole('button', { name: 'Publish editor change' }))
    await close(1)
    expectCloseBlocked(1)
    expect(onContentChange).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledOnce()

    fireEvent.compositionEnd(screen.getByTestId('composition-editor'))
    fireEvent.click(screen.getByRole('button', { name: 'Publish editor change' }))
    await close(2)
    expect(onContentChange).toHaveBeenCalledWith('/vault/note.md', expect.stringContaining('Committed composition'))
    expect(native.invoke).toHaveBeenCalledWith('complete_shutdown_save', { requestId: 2, saved: true })
  })

  it('does not serialize an active composition when an earlier autosave timer expires', async () => {
    const { onContentChange } = await setup()
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const publish = screen.getByRole('button', { name: 'Publish editor change' })
    fireEvent.click(publish)
    fireEvent.compositionStart(screen.getByTestId('composition-editor'))
    fireEvent.click(publish)
    await act(async () => { vi.advanceTimersByTime(1_500) })
    expect(onContentChange).not.toHaveBeenCalled()
    await close(1)
    expectCloseBlocked(1)
    fireEvent.compositionEnd(screen.getByTestId('composition-editor'))
    fireEvent.click(publish)
    await close(2)
    expect(onContentChange).toHaveBeenCalledWith('/vault/note.md', expect.stringContaining('Committed composition'))
    expect(native.invoke).toHaveBeenCalledWith('complete_shutdown_save', { requestId: 2, saved: true })
  })

  it('keeps an unreconciled composition open until its existing fallback publishes the change', async () => {
    const { onContentChange } = await setup()
    vi.useFakeTimers()
    const container = screen.getByTestId('composition-editor')
    fireEvent.compositionStart(container)
    fireEvent.click(screen.getByRole('button', { name: 'Publish editor change' }))
    fireEvent.compositionEnd(container)
    await act(async () => { vi.advanceTimersByTime(49) })
    await close(1)
    expectCloseBlocked(1)
    expect(onContentChange).not.toHaveBeenCalled()

    await act(async () => { vi.advanceTimersByTime(1) })
    await close(2)
    expect(onContentChange).toHaveBeenCalledWith('/vault/note.md', expect.stringContaining('Committed composition'))
    expect(native.invoke).toHaveBeenCalledWith('complete_shutdown_save', { requestId: 2, saved: true })
  })

  it('blocks close on serialization failure and retains the pending change for a successful retry', async () => {
    const { mockEditor, onContentChange } = await setup()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockEditor.blocksToMarkdownLossy.mockImplementation(() => { throw new Error('Cannot serialize document') })
    fireEvent.click(screen.getByRole('button', { name: 'Publish editor change' }))
    await close(1)
    expectCloseBlocked(1)
    expect(onContentChange).not.toHaveBeenCalled()

    mockEditor.blocksToMarkdownLossy.mockReturnValue('Recovered draft\n')
    await close(2)
    expect(onContentChange).toHaveBeenCalledWith('/vault/note.md', expect.stringContaining('Recovered draft'))
    expect(native.invoke).toHaveBeenCalledWith('complete_shutdown_save', { requestId: 2, saved: true })
  })
})
