import { backupApi, type BackupApi, type Results, type StartOf, type StateOf } from './backupApi'
import { BACKUP_LIMITS, type OperationKind, type StartRefusal } from './backupContract'

export type RunEnd<K extends OperationKind> =
  | { end: 'finished'; result: Results[K] }
  | { end: 'refused'; reason: StartRefusal }
  /** No trustworthy answer; the operation may still be running, may have finished, or never started. */
  | { end: 'uncertain' }
  | { end: 'stopped' }

export type Running = Extract<StateOf<OperationKind>, { state: 'running' }>

export interface RunHooks {
  onRunning: (state: Running) => void
  /** True once nobody is waiting for the answer any more. */
  stopped: () => boolean
  wait?: (ms: number) => Promise<void>
}

/** Missed status replies in a row, failed or never answered, before the dialog says it lost track. */
export const MISSED_REPLIES = 8
/** Admission checks folders, which a waking drive can slow; a status answer is only a lookup. */
export const START_REPLY_MS = 30_000
export const STATE_REPLY_MS = 5_000

const sleep = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms) })

const EXPIRED = Symbol('expired')
/** A reply that has not come by then counts as lost; if it comes later, nobody is listening. */
function within<T>(reply: Promise<T>, ms: number): Promise<T | typeof EXPIRED> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<typeof EXPIRED>(resolve => { timer = setTimeout(resolve, ms, EXPIRED) })
  return Promise.race([reply, expired]).finally(() => clearTimeout(timer))
}

/**
 * Starts once, then follows the operation until it finishes.
 * A lost start reply only leads to status checks; the start is never sent again.
 */
export async function runOperation<K extends OperationKind>(
  kind: K, operationId: string, start: () => Promise<StartOf<K> | null>, hooks: RunHooks, api: Pick<BackupApi, 'state'> = backupApi,
): Promise<RunEnd<K>> {
  const wait = hooks.wait ?? sleep
  const answer = await within(start(), START_REPLY_MS)
  if (hooks.stopped()) return { end: 'stopped' }
  const started = answer === EXPIRED ? null : answer
  if (started?.status === 'finished') return { end: 'finished', result: started.result }
  if (started?.status === 'refused') return { end: 'refused', reason: started.reason }
  let missed = 0
  let askNow = started === null
  for (;;) {
    if (!askNow) await wait(BACKUP_LIMITS.pollIntervalMs)
    askNow = false
    if (hooks.stopped()) return { end: 'stopped' }
    const reply = await within(api.state(kind, operationId), STATE_REPLY_MS)
    if (hooks.stopped()) return { end: 'stopped' }
    const state = reply === EXPIRED ? null : reply
    if (state === null) {
      missed += 1
      if (missed >= MISSED_REPLIES) return { end: 'uncertain' }
      continue
    }
    missed = 0
    if (state.state === 'unknown') return { end: 'uncertain' }
    if (state.state === 'finished') return { end: 'finished', result: state.result }
    hooks.onRunning(state)
  }
}
