import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CaptureHeldError } from '../pendingCapture'
import type { BackupApi } from './backupApi'
import { BACKUP_LIMITS, type BackupResult } from './backupContract'
import { BackupDialog, type WorkspaceGuard } from './BackupDialog'
import { MISSED_REPLIES, START_REPLY_MS, STATE_REPLY_MS } from './runOperation'

// Seam: the backup flow's order and its answers. Catches a copy that starts before pages are saved, over an unsaved page
// or a changed workspace, a guard left held (even when native never answers), a second start, or a result that claims too much.
const none = { total: 0, counts: {}, sample: [] }
const saved: BackupResult = { status: 'complete', folder: '/backups/W backup', folderName: 'W backup', files: 2, bytes: 10, durable: true, gaps: none, versionsSkipped: 1, trashItemsNotIncluded: 3 }

function setup({ guard = {}, api = {}, pick }: { guard?: Partial<WorkspaceGuard>; api?: Partial<BackupApi>; pick?: () => Promise<string | null> } = {}) {
  const calls: string[] = []
  const release = vi.fn(() => { calls.push('release') })
  const fullGuard: WorkspaceGuard = {
    begin: () => { calls.push('begin'); return release },
    saveAll: async () => { calls.push('save') },
    unresolvedSaves: () => false,
    busy: () => false,
    ...guard,
  }
  const fullApi = {
    startBackup: vi.fn(async () => { calls.push('start'); return { status: 'finished' as const, result: saved } }),
    state: vi.fn(async () => null),
    cancel: vi.fn(async () => false),
    ...api,
  } as unknown as BackupApi
  const choose = pick ?? (async () => { calls.push('pick'); return '/backups' })
  const view = render(<BackupDialog locale="en" vaultPath="/vault" guard={fullGuard} api={fullApi} pick={choose} onClose={() => {}} />)
  fireEvent.click(screen.getByTestId('backup-choose'))
  return { calls, release, api: fullApi, view }
}

describe('BackupDialog', () => {
  it('holds the workspace before the picker, saves before the copy starts, and lets go after the answer', async () => {
    const { calls, api } = setup()
    const result = await screen.findByTestId('backup-result')
    expect(calls).toEqual(['begin', 'pick', 'save', 'start', 'release'])
    expect(api.startBackup).toHaveBeenCalledWith({ operationId: expect.stringMatching(/^[0-9a-f-]{36}$/), vaultPath: '/vault', destination: '/backups' })
    expect(result).toHaveTextContent('Files copied and checked: 2')
    expect(result).toHaveTextContent('Earlier page versions not included: 1.')
    expect(result).toHaveTextContent('Items in Trash not included: 3.')
  })

  it('refuses without copying when a page stays unsaved, and lets go', async () => {
    const { calls, api } = setup({ guard: { unresolvedSaves: () => true } })
    expect(await screen.findByTestId('backup-refused')).toHaveAttribute('data-reason', 'held')
    expect(api.startBackup).not.toHaveBeenCalled()
    expect(calls.at(-1)).toBe('release')
  })

  it('treats a workspace that changed and changed back during the picker as stale', async () => {
    let choose: (path: string) => void = () => {}
    const { api, view } = setup({ pick: () => new Promise(resolve => { choose = resolve }) })
    const rerender = (vaultPath: string) => view.rerender(<BackupDialog locale="en" vaultPath={vaultPath} guard={{ begin: () => () => {}, saveAll: async () => {}, unresolvedSaves: () => false, busy: () => false }} api={api} onClose={() => {}} />)
    rerender('/other')
    rerender('/vault')
    choose('/backups')
    expect(await screen.findByTestId('backup-refused')).toHaveAttribute('data-reason', 'changed')
    expect(api.startBackup).not.toHaveBeenCalled()
  })

  it('refuses a draft with words before the picker opens', async () => {
    const pick = vi.fn(async () => '/backups')
    setup({ guard: { begin: () => { throw new CaptureHeldError() } }, pick })
    expect(await screen.findByTestId('backup-refused')).toHaveAttribute('data-reason', 'draft')
    expect(pick).not.toHaveBeenCalled()
  })

  it('stopping while pages save lets go at once and never starts a copy', async () => {
    const { calls, api } = setup({ guard: { saveAll: () => new Promise(() => {}) } })
    fireEvent.click(await screen.findByTestId('backup-stop'))
    expect(screen.getByTestId('backup-refused')).toHaveAttribute('data-reason', 'stopped')
    expect(calls.at(-1)).toBe('release')
    expect(api.startBackup).not.toHaveBeenCalled()
  })

  it('after a lost start reply never starts again, and names the folder to look in', async () => {
    const { api } = setup({ api: { startBackup: vi.fn(async () => null), state: vi.fn(async () => ({ state: 'unknown' as const })) } })
    expect(await screen.findByTestId('backup-uncertain')).toHaveTextContent('leadinglight-backup.json')
    expect(screen.getByTestId('backup-destination')).toHaveTextContent('/backups')
    expect(api.startBackup).toHaveBeenCalledTimes(1)
  })

  it('when native never answers, lets go of the workspace in uncertainty, keeps the folder, and ignores a late answer', async () => {
    vi.useFakeTimers()
    let answerLate: (answer: { status: 'finished'; result: BackupResult }) => void = () => {}
    const startBackup = vi.fn(() => new Promise<{ status: 'finished'; result: BackupResult }>(resolve => { answerLate = resolve }))
    const { calls } = setup({ api: { startBackup, state: vi.fn(() => new Promise(() => {})) as unknown as BackupApi['state'] } })
    try {
      await act(() => vi.advanceTimersByTimeAsync(START_REPLY_MS + MISSED_REPLIES * (STATE_REPLY_MS + BACKUP_LIMITS.pollIntervalMs)))
      expect(screen.getByTestId('backup-uncertain')).toBeInTheDocument()
      expect(screen.getByTestId('backup-destination')).toHaveTextContent('/backups')
      expect(screen.queryByTestId('backup-cancel')).toBeNull()
      expect(calls.at(-1)).toBe('release')
      await act(async () => { answerLate({ status: 'finished', result: saved }) })
      expect(screen.getByTestId('backup-uncertain')).toBeInTheDocument()
      expect(screen.queryByTestId('backup-result')).toBeNull()
      expect(startBackup).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows a finished backup when the cancel came too late', async () => {
    const answers = [{ state: 'running', phase: 'copying', progress: { files: 1, totalFiles: 2, bytes: 5, totalBytes: 10 }, cancelRequested: false }, { state: 'finished', kind: 'backup', result: saved }]
    const state = vi.fn(async () => answers.length > 1 ? answers.shift()! : answers[0])
    const { api } = setup({ api: { startBackup: vi.fn(async () => ({ status: 'started' as const })), state: state as unknown as BackupApi['state'] } })
    const cancel = await screen.findByRole('button', { name: 'Cancel' })
    await waitFor(() => expect(cancel).toBeEnabled())
    fireEvent.click(cancel)
    expect((await screen.findByTestId('backup-result')).textContent).toContain('Backup saved')
    expect(api.cancel).toHaveBeenCalledTimes(1)
  })

  it('a failed backup names what was left and never claims a backup', async () => {
    const failed: BackupResult = { status: 'failed', reason: 'noSpace', path: null, leftover: '/backups/W backup' }
    setup({ api: { startBackup: vi.fn(async () => ({ status: 'finished' as const, result: failed })) } })
    const result = await screen.findByTestId('backup-result')
    expect(result).toHaveTextContent('No completed backup was created.')
    expect(result).toHaveTextContent('Files may remain at /backups/W backup. Don’t rely on them as a backup.')
    expect(result).not.toHaveTextContent('Backup saved')
  })
})
