import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RetargetNoteDialog } from './RetargetNoteDialog'

it('keeps one pending move visible, blocks dismissal and preserves a refused destination search', async () => {
  let finish!: (value: boolean) => void
  const onSelect = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
  const onClose = vi.fn()
  render(<RetargetNoteDialog open title="Move to folder" description="Choose a folder" searchPlaceholder="Search folders"
    emptyMessage="No folders" options={[{ id: 'filed', label: 'Filed' }]} onSelect={onSelect} onClose={onClose}
    workingLabel="Saving your writing and moving the page…" testIdPrefix="retarget-note-folder" />)
  const search = screen.getByPlaceholderText('Search folders')
  fireEvent.change(search, { target: { value: 'File' } })
  const destination = screen.getByRole('button', { name: 'Filed' })
  fireEvent.click(destination)
  fireEvent.click(destination)
  fireEvent.keyDown(search, { key: 'Enter' })
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onSelect).toHaveBeenCalledOnce()
  expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true')
  expect(screen.getByRole('status')).toHaveTextContent('Saving your writing')
  expect(search).toBeDisabled()
  expect(onClose).not.toHaveBeenCalled()
  await act(async () => { finish(false) })
  expect(search).toHaveValue('File')
  expect(search).not.toBeDisabled()
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.click(destination)
  await act(async () => { finish(true) })
  expect(onClose).toHaveBeenCalledOnce()
})

describe('folder destination keyboard selection', () => {
  it('selects the highlighted folder with Enter and allows Escape before submission', async () => {
    const onSelect = vi.fn(async () => false)
    const onClose = vi.fn()
    render(<RetargetNoteDialog open title="Move to folder" description="Choose a folder" searchPlaceholder="Search folders"
      emptyMessage="No folders" options={[{ id: '', label: 'Vault', current: true }, { id: 'filed', label: 'Filed' }]}
      onSelect={onSelect} onClose={onClose} testIdPrefix="retarget-note-folder" />)
    const search = screen.getByPlaceholderText('Search folders')
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    await act(async () => { fireEvent.keyDown(search, { key: 'Enter' }) })
    expect(onSelect).toHaveBeenCalledWith('filed')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
