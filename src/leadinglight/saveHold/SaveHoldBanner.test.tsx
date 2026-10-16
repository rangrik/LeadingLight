import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { SaveHoldBanner } from './SaveHoldBanner'
import type { PageRecoveryView } from './useSaveHoldActions'

// Seam: the page notice's choices. Catches a discard with no confirmation naming the page, focus lost when it is
// dismissed, a keep-copy offered for an outdated copy, or a copy moved to another folder without the person choosing it.
const PATH = '/vault/notes/plan.md'
const request = { requestId: 'r1', vaultPath: '/vault', session: 's:1', path: PATH, seq: 1, submittedSha256: 'a'.repeat(64) }
const view = (change: Partial<PageRecoveryView> = {}): PageRecoveryView => ({
  path: PATH, retriable: null, notDurable: false, copy: null, canKeepCopy: false, busy: null, notice: null,
  hold: { lane: PATH, request, kind: 'missing', reason: 'parentMissing', adopted: false, retired: false, nativeUnknown: false },
  ...change,
})
const copyOf = (outcome: NonNullable<PageRecoveryView['copy']>['outcome']) => ({ lane: PATH, requestId: 'r1', operationId: 'o1', seq: 1, outcome })
const actions = () => ({ checkAgain: vi.fn(), saveCopy: vi.fn(), finish: vi.fn() })

it('asks before discarding, names the page, and does nothing on Cancel or Escape but return focus', async () => {
  const act = actions()
  render(<SaveHoldBanner view={view()} actions={act} title="Plan" locale="en" />)
  const discard = screen.getByRole('button', { name: 'Discard changes…' })
  fireEvent.click(discard)
  expect(screen.getByRole('dialog')).toHaveTextContent('Your unsaved changes to “Plan” will be lost')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(discard).toHaveFocus())
  fireEvent.click(discard)
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  await waitFor(() => expect(discard).toHaveFocus())
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(act.finish).not.toHaveBeenCalled()

  fireEvent.click(discard)
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
  expect(act.finish).toHaveBeenCalledWith(PATH, 'discard')
})

it('offers keep-copy only for a copy of the current words, and another folder only as an explicit choice', () => {
  const act = actions()
  const created = copyOf({ status: 'created', path: '/vault/notes/plan copy.md', relativePath: 'notes/plan copy.md', durable: true })
  const { rerender } = render(<SaveHoldBanner view={view({ copy: created })} actions={act} title="Plan" locale="en" />)
  expect(screen.queryByRole('button', { name: 'Keep the copy and close' })).toBeNull()
  expect(screen.getByText("You've written more since the copy. Save a new copy to keep everything.")).toBeInTheDocument()

  rerender(<SaveHoldBanner view={view({ copy: created, canKeepCopy: true })} actions={act} title="Plan" locale="en" />)
  fireEvent.click(screen.getByRole('button', { name: 'Keep the copy and close' }))
  expect(act.finish).toHaveBeenCalledWith(PATH, 'keepCopy')

  rerender(<SaveHoldBanner view={view({ copy: copyOf({ status: 'folderUnavailable', recordedFolder: '/vault/notes' }) })} actions={act} title="Plan" locale="en" />)
  expect(screen.queryByRole('button', { name: 'Save as a new page' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Save at the top of the vault' }))
  expect(act.saveCopy).toHaveBeenCalledWith(PATH, '/vault')
})

it('says a notice that repeats the copy line once', () => {
  const created = copyOf({ status: 'created', path: '/vault/notes/plan copy.md', relativePath: 'notes/plan copy.md', durable: true })
  render(<SaveHoldBanner view={view({ copy: created, notice: { key: 'saveHold.copy.newer' } })} actions={actions()} title="Plan" locale="en" />)
  expect(screen.getAllByText("You've written more since the copy. Save a new copy to keep everything.")).toHaveLength(1)
})
