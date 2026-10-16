import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BackupApi } from './backupApi'
import type { InspectResult, RestoreResult } from './backupContract'
import { RestoreDialog } from './RestoreDialog'

// Seam: restore writes only after a check and an explicit place, and opens only when asked. Catches an automatic switch,
// a lost path when the switch is refused, "nothing was restored" while files may remain, or a claim that they are marked.
const checked: InspectResult = {
  status: 'ok', manifestSha256: 'a'.repeat(64), createdAt: '2026-10-16T09:30:00Z', appVersion: '0.6.0',
  workspaceName: 'W', backupStatus: 'complete', files: 2, bytes: 10, gaps: 0, extraFiles: 0,
}

function setup(answer: RestoreResult, openWorkspace = vi.fn(async () => {})) {
  const places = ['/backups/W backup', '/restored']
  const api = {
    startInspection: vi.fn(async () => ({ status: 'finished' as const, result: checked })),
    startRestore: vi.fn(async () => ({ status: 'finished' as const, result: answer })),
    state: vi.fn(async () => null),
    cancel: vi.fn(async () => false),
  } as unknown as BackupApi
  render(<RestoreDialog locale="en" openWorkspace={openWorkspace} api={api} pick={async () => places.shift() ?? null} onClose={() => {}} />)
  return { api, openWorkspace }
}

async function restoreThroughForm() {
  fireEvent.click(screen.getByTestId('restore-choose'))
  expect(await screen.findByTestId('restore-name')).toHaveValue('W restored')
  fireEvent.click(screen.getByTestId('restore-start'))
}

describe('RestoreDialog', () => {
  it('restores into the chosen place, opens only when asked, and keeps the path when the switch is refused', async () => {
    const restored: RestoreResult = { status: 'restored', folder: '/restored/W restored', folderName: 'W restored', files: 2, bytes: 10, durable: true, timesKept: true }
    const { api, openWorkspace } = setup(restored, vi.fn(async () => { throw new Error('draft held') }))
    await restoreThroughForm()
    expect(await screen.findByTestId('restore-result')).toHaveTextContent('Workspace restored')
    expect(api.startRestore).toHaveBeenCalledWith({ operationId: expect.any(String), backupPath: '/backups/W backup', manifestSha256: 'a'.repeat(64), parent: '/restored', name: 'W restored' })
    expect(openWorkspace).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('restore-open'))
    expect(await screen.findByTestId('restore-open-failed')).toHaveTextContent('/restored/W restored')
    expect(openWorkspace).toHaveBeenCalledWith('/restored/W restored', 'W restored')
    expect(screen.getByTestId('restore-result')).toBeInTheDocument()
  })

  it('a restore that stopped partway names where files may remain, without claiming they are marked or nothing was restored', async () => {
    setup({ status: 'backupChanged', problems: { total: 1, counts: { hashMismatch: 1 }, sample: [{ path: 'a.md', reason: 'hashMismatch' }] }, leftover: '/restored/W restored' })
    await restoreThroughForm()
    const result = await screen.findByTestId('restore-result')
    expect(result).toHaveTextContent('No complete workspace was created. Files may remain at /restored/W restored.')
    expect(result).not.toHaveTextContent('marked')
    expect(result).toHaveTextContent('a.md — Content doesn’t match')
    expect(result).not.toHaveTextContent('No restored workspace was created.')
  })

  it('keeps the form and the name when that name is taken', async () => {
    setup({ status: 'nameTaken' })
    await restoreThroughForm()
    expect(await screen.findByTestId('restore-notice')).toHaveAttribute('data-notice', 'nameTaken')
    expect(screen.getByTestId('restore-name')).toHaveValue('W restored')
  })
})
