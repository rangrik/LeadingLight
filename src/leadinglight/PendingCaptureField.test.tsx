import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { writeClipboardText } from '../utils/clipboardText'
import { PendingCaptureField } from './PendingCaptureField'
import { PendingCaptureController, type CaptureOutcome } from './pendingCapture'

vi.mock('../utils/clipboardText', () => ({ writeClipboardText: vi.fn(async () => {}) }))

function setup() {
  const capture = new PendingCaptureController()
  capture.configure({ markNavigation: () => ({ pane: 0, current: () => true }), openPage: async () => false })
  render(<PendingCaptureField controller={capture} locale="en" />)
  return capture
}

afterEach(() => vi.clearAllMocks())

// Seam: the visible field is what holds early keys; recovery must never lose or silently copy them.
describe('pending page field', () => {
  it('is focused with its label and status in the same turn as New page', () => {
    const capture = setup()
    act(() => { capture.admit('newPage', vi.fn()) })

    const field = screen.getByRole('textbox', { name: 'Your draft' })
    expect(document.activeElement).toBe(field)
    expect(screen.getByText('Opening page…')).toBeTruthy()
  })

  it('after a failed create keeps the same field and words, copies only when asked, and asks before discarding', () => {
    const capture = setup()
    let outcome: CaptureOutcome | undefined
    act(() => { outcome = capture.admit('newPage', vi.fn()) })
    const field = screen.getByRole('textbox', { name: 'Your draft' })
    fireEvent.change(field, { target: { value: 'Harbor fog\nat dawn' } })
    act(() => outcome?.failed())

    expect(screen.getByRole('textbox', { name: 'Your draft' })).toBe(field)
    expect((field as HTMLTextAreaElement).value).toBe('Harbor fog\nat dawn')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(writeClipboardText).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Copy text' }))
    expect(writeClipboardText).toHaveBeenCalledWith('Harbor fog\nat dawn')

    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((screen.getByRole('textbox', { name: 'Your draft' }) as HTMLTextAreaElement).value).toBe('Harbor fog\nat dawn')

    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Discard draft' }).at(-1)!)
    expect(screen.queryByRole('textbox', { name: 'Your draft' })).toBeNull()
  })
})
