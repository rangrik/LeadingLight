import { fireEvent, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { backupInputHeld, holdBackupInput, useGuardedHandlers } from './backupInputGate'

// Seam: input while a backup holds the workspace. Catches a key or native menu command reaching the app.
describe('backup input gate', () => {
  it('drops keys outside the dialog and modified keys inside it, until released', () => {
    const seen = vi.fn()
    window.addEventListener('keydown', seen, true)
    const dialog = document.createElement('div')
    dialog.setAttribute('data-backup-dialog', '')
    const button = dialog.appendChild(document.createElement('button'))
    document.body.append(dialog)
    const release = holdBackupInput()
    fireEvent.keyDown(document.body, { key: 'p', metaKey: true })
    fireEvent.keyDown(button, { key: 'p', metaKey: true })
    fireEvent.keyDown(button, { key: 'Tab' })
    expect(seen).toHaveBeenCalledTimes(1)
    release()
    release()
    expect(backupInputHeld()).toBe(false)
    fireEvent.keyDown(document.body, { key: 'p', metaKey: true })
    expect(seen).toHaveBeenCalledTimes(2)
    window.removeEventListener('keydown', seen, true)
    dialog.remove()
  })

  it('makes menu handlers do nothing and their refs read empty while guarded', () => {
    let guarded = true
    const onSearch = vi.fn()
    const selection = { current: { selectedPaths: ['a', 'b'] } }
    const { result } = renderHook(() => useGuardedHandlers({ onSearch, selection, label: 'x' }, () => guarded))
    result.current.onSearch()
    expect(onSearch).not.toHaveBeenCalled()
    expect(result.current.selection.current).toBeNull()
    guarded = false
    result.current.onSearch()
    expect(onSearch).toHaveBeenCalledTimes(1)
    expect(result.current.selection.current).toBe(selection.current)
    expect(result.current.label).toBe('x')
  })
})
