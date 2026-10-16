import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BackupApi, StateOf } from './backupApi'
import { BACKUP_LIMITS } from './backupContract'
import { MISSED_REPLIES, START_REPLY_MS, STATE_REPLY_MS, runOperation } from './runOperation'

// Seam: following one native operation. Catches a lost or never-answered reply that starts a second copy,
// waits forever, or lets a late answer change the end.
const ID = '00000000-0000-4000-8000-000000000001'
const result = { status: 'cancelled', leftover: null } as const
const running = { state: 'running', phase: 'copying', progress: null, cancelRequested: false } as const
const hooks = () => ({ onRunning: vi.fn(), stopped: () => false, wait: async () => {} })
const never = () => new Promise<never>(() => {})
const answering = (states: (StateOf<'backup'> | null | 'never')[]) => {
  const state = vi.fn(async () => {
    const next = states.shift()
    return next === 'never' ? never() : next ?? null
  })
  return { state, api: { state } as unknown as Pick<BackupApi, 'state'> }
}
const SILENT_POLLS_MS = MISSED_REPLIES * (STATE_REPLY_MS + BACKUP_LIMITS.pollIntervalMs)

afterEach(() => { vi.useRealTimers() })

describe('runOperation', () => {
  it('after a lost start reply only asks for status, and stops at unknown', async () => {
    const start = vi.fn(async () => null)
    const { state, api } = answering([{ state: 'unknown' }])
    expect(await runOperation('backup', ID, start, hooks(), api)).toEqual({ end: 'uncertain' })
    expect(start).toHaveBeenCalledTimes(1)
    expect(state).toHaveBeenCalledTimes(1)
  })

  it('follows a long copy for as long as it answers running, then takes its result', async () => {
    const watch = hooks()
    const { api } = answering([...Array.from({ length: 200 }, () => running), { state: 'finished', result }])
    expect(await runOperation('backup', ID, async () => ({ status: 'started' }), watch, api)).toEqual({ end: 'finished', result })
    expect(watch.onRunning).toHaveBeenCalledTimes(200)
  })

  it('ends in uncertainty after repeated failed replies instead of polling forever', async () => {
    const { state, api } = answering([])
    expect(await runOperation('backup', ID, async () => ({ status: 'started' }), hooks(), api)).toEqual({ end: 'uncertain' })
    expect(state).toHaveBeenCalledTimes(MISSED_REPLIES)
  })

  it('when a start reply never comes, asks for the same id and takes its answer, never starting again', async () => {
    vi.useFakeTimers()
    const start = vi.fn(never)
    const { state, api } = answering([{ state: 'finished', result }])
    const ending = runOperation('backup', ID, start, hooks(), api)
    await vi.advanceTimersByTimeAsync(START_REPLY_MS)
    expect(await ending).toEqual({ end: 'finished', result })
    expect(start).toHaveBeenCalledTimes(1)
    expect(state).toHaveBeenCalledWith('backup', ID)
  })

  it('when no reply ever comes, ends in uncertainty and a late start answer changes nothing', async () => {
    vi.useFakeTimers()
    let answerLate: (value: { status: 'finished'; result: typeof result }) => void = () => {}
    const start = vi.fn(() => new Promise<{ status: 'finished'; result: typeof result }>(resolve => { answerLate = resolve }))
    const { api } = answering(Array.from({ length: MISSED_REPLIES }, () => 'never' as const))
    let end: unknown = null
    void runOperation('backup', ID, start, hooks(), api).then(value => { end = value })
    await vi.advanceTimersByTimeAsync(START_REPLY_MS + SILENT_POLLS_MS)
    expect(end).toEqual({ end: 'uncertain' })
    answerLate({ status: 'finished', result })
    await vi.advanceTimersByTimeAsync(0)
    expect(end).toEqual({ end: 'uncertain' })
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('a status reply that stops coming after running ends in uncertainty', async () => {
    vi.useFakeTimers()
    const watch = hooks()
    const { api } = answering([running, ...Array.from({ length: MISSED_REPLIES }, () => 'never' as const)])
    let end: unknown = null
    void runOperation('backup', ID, async () => ({ status: 'started' }), watch, api).then(value => { end = value })
    await vi.advanceTimersByTimeAsync(SILENT_POLLS_MS)
    expect(end).toEqual({ end: 'uncertain' })
    expect(watch.onRunning).toHaveBeenCalledTimes(1)
  })
})
