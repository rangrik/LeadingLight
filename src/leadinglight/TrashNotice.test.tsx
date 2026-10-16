import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { TrashActivity, TrashNotice } from './TrashNotice'
import type { TrashMoveOutcome } from './useLocalTrash'

const page = { path: '/vault/a.md', id: 'a'.repeat(32), originalPath: 'a.md', title: 'Plan' }
const outcome = (patch: Partial<TrashMoveOutcome>): TrashMoveOutcome => ({ moved: [], changed: [], uncertain: [], failed: [], unavailable: false, ...patch })

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('Trash notice and activity', () => {
  it('offers Undo for a moved page and reports when it worked', async () => {
    const onUndo = vi.fn(async () => ({ restored: [{ ...page, relativePath: 'a.md', renamed: false, relocated: false, entry: null }], failed: [] }))
    render(<TrashNotice outcome={outcome({ moved: [page] })} locale="en" onUndo={onUndo} onDismiss={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('Moved “Plan” to Trash.')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo' })) })
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent('Restored from Trash.')
  })

  it('says a changed page stayed with its latest text and offers no Undo for it', () => {
    render(<TrashNotice outcome={outcome({ changed: [page] })} locale="en" onUndo={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('stays here with your latest text')
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('shows what is happening only when it takes a moment, and names a restore as a restore', () => {
    const { rerender } = render(<TrashActivity activity="move" locale="en" />)
    expect(screen.queryByRole('status')).toBeNull()
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByRole('status')).toHaveTextContent('Moving to Trash…')
    rerender(<TrashActivity activity="restore" locale="en" />)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByRole('status')).toHaveTextContent('Restoring from Trash…')
    rerender(<TrashActivity activity={null} locale="en" />)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
