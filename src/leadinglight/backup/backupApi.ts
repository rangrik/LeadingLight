// Strict reading of the backup commands' answers: a reply of another shape, or meant for
// another kind of operation, is never taken for an answer.
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../../mock-tauri'
import {
  BACKUP_COMMANDS, BACKUP_FAILURES, BACKUP_LIMITS, GAP_REASONS, PHASES, PROBLEMS, RESTORE_FAILURES, START_REFUSALS,
  type BackupResult, type InspectResult, type OperationKind, type Phase, type Progress, type RestoreResult,
  type StartBackupArgs, type StartInspectionArgs, type StartRefusal, type StartRestoreArgs, type Summary,
} from './backupContract'

export interface Results { backup: BackupResult; inspect: InspectResult; restore: RestoreResult }
export type StartOf<K extends OperationKind> =
  | { status: 'started' }
  | { status: 'finished'; result: Results[K] }
  | { status: 'refused'; reason: StartRefusal }
export type StateOf<K extends OperationKind> =
  | { state: 'unknown' }
  | { state: 'running'; phase: Phase; progress: Progress | null; cancelRequested: boolean }
  | { state: 'finished'; result: Results[K] }

type Fields = Record<string, unknown>
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string'
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const isFlag = (value: unknown): value is boolean => typeof value === 'boolean'
const isPathOrNull = (value: unknown): value is string | null => value === null || isText(value)
const isOneOf = <T extends string>(options: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (options as readonly string[]).includes(value)
const SHA256 = /^[0-9a-f]{64}$/

function summary<R extends string>(value: unknown, reasons: readonly R[]): Summary<R> | null {
  if (!isFields(value) || !isCount(value.total) || !isFields(value.counts) || !Array.isArray(value.sample)) return null
  const counts = Object.entries(value.counts)
  if (!counts.every(([reason, count]) => isOneOf(reasons, reason) && isCount(count))) return null
  const sample = value.sample
  if (sample.length > BACKUP_LIMITS.samples || sample.length > value.total) return null
  if (!sample.every(item => isFields(item) && isPathOrNull(item.path) && isOneOf(reasons, item.reason))) return null
  return { total: value.total, counts: value.counts as Summary<R>['counts'], sample: sample as Summary<R>['sample'] }
}

export function parseBackupResult(value: unknown): BackupResult | null {
  if (!isFields(value)) return null
  const { status } = value
  if (status === 'complete' || status === 'incomplete') {
    const gaps = summary(value.gaps, GAP_REASONS)
    const { folder, folderName, files, bytes, durable, versionsSkipped, trashItemsNotIncluded } = value
    if (!gaps || !isText(folder) || !isText(folderName) || !isCount(files) || !isCount(bytes) || !isFlag(durable)) return null
    if (!isCount(versionsSkipped) || !isCount(trashItemsNotIncluded) || (status === 'complete') !== (gaps.total === 0)) return null
    return { status, folder, folderName, files, bytes, durable, gaps, versionsSkipped, trashItemsNotIncluded }
  }
  if (status === 'cancelled') return isPathOrNull(value.leftover) && !('reason' in value) ? { status, leftover: value.leftover } : null
  if (status === 'failed' && isOneOf(BACKUP_FAILURES, value.reason) && isPathOrNull(value.path) && isPathOrNull(value.leftover)) {
    return { status, reason: value.reason, path: value.path, leftover: value.leftover }
  }
  return null
}

export function parseInspectResult(value: unknown): InspectResult | null {
  if (!isFields(value)) return null
  const { status } = value
  if (status === 'ok') {
    const { manifestSha256, createdAt, appVersion, workspaceName, backupStatus, files, bytes, gaps, extraFiles } = value
    if (!isText(manifestSha256) || !SHA256.test(manifestSha256) || !isText(createdAt) || !isText(appVersion) || !isText(workspaceName)) return null
    if (!isOneOf(['complete', 'incomplete'] as const, backupStatus) || !isCount(files) || !isCount(bytes) || !isCount(gaps) || !isCount(extraFiles)) return null
    if ((backupStatus === 'complete') !== (gaps === 0)) return null
    return { status, manifestSha256, createdAt, appVersion, workspaceName, backupStatus, files, bytes, gaps, extraFiles }
  }
  if (status === 'notBackup') return { status }
  if (status === 'cancelled') return 'leftover' in value ? null : { status }
  if (status === 'damaged') {
    const problems = summary(value.problems, PROBLEMS)
    return problems && !('leftover' in value) ? { status, problems } : null
  }
  if (status === 'failed') return isOneOf(['io', 'internal'] as const, value.reason) && !('path' in value) ? { status, reason: value.reason } : null
  return null
}

export function parseRestoreResult(value: unknown): RestoreResult | null {
  if (!isFields(value)) return null
  const { status } = value
  if (status === 'restored') {
    const { folder, folderName, files, bytes, durable, timesKept } = value
    return isText(folder) && isText(folderName) && isCount(files) && isCount(bytes) && isFlag(durable) && isFlag(timesKept)
      ? { status, folder, folderName, files, bytes, durable, timesKept }
      : null
  }
  if (status === 'nameTaken') return { status }
  if (status === 'backupChanged' || status === 'damaged') {
    const problems = summary(value.problems, PROBLEMS)
    if (!problems) return null
    if (status === 'damaged') return 'leftover' in value ? null : { status, problems }
    return isPathOrNull(value.leftover) ? { status, problems, leftover: value.leftover } : null
  }
  if (status === 'cancelled') return isPathOrNull(value.leftover) ? { status, leftover: value.leftover } : null
  if (status === 'failed' && isOneOf(RESTORE_FAILURES, value.reason) && isPathOrNull(value.path) && isPathOrNull(value.leftover)) {
    return { status, reason: value.reason, path: value.path, leftover: value.leftover }
  }
  return null
}

const RESULTS: { [K in OperationKind]: (value: unknown) => Results[K] | null } = {
  backup: parseBackupResult,
  inspect: parseInspectResult,
  restore: parseRestoreResult,
}

export function parseStart<K extends OperationKind>(kind: K, value: unknown): StartOf<K> | null {
  if (!isFields(value)) return null
  if (value.status === 'started') return { status: 'started' }
  if (value.status === 'refused') return isOneOf(START_REFUSALS, value.reason) ? { status: 'refused', reason: value.reason } : null
  if (value.status !== 'finished') return null
  const result = RESULTS[kind](value.result)
  return result ? { status: 'finished', result } : null
}

function parseProgress(value: unknown): Progress | null | undefined {
  if (value === null) return null
  if (!isFields(value) || !isCount(value.files) || !isCount(value.bytes)) return undefined
  const { totalFiles, totalBytes } = value
  if (!(totalFiles === null || isCount(totalFiles)) || !(totalBytes === null || isCount(totalBytes))) return undefined
  return { files: value.files, totalFiles, bytes: value.bytes, totalBytes }
}

/** The state of this kind of operation; a running or finished operation of another kind is no answer. */
export function parseState<K extends OperationKind>(kind: K, value: unknown): StateOf<K> | null {
  if (!isFields(value)) return null
  if (value.state === 'unknown') return { state: 'unknown' }
  if (value.kind !== kind) return null
  if (value.state === 'running') {
    const progress = parseProgress(value.progress)
    if (!isOneOf(PHASES, value.phase) || progress === undefined || !isFlag(value.cancelRequested)) return null
    return { state: 'running', phase: value.phase, progress, cancelRequested: value.cancelRequested }
  }
  if (value.state !== 'finished') return null
  const result = RESULTS[kind](value.result)
  return result ? { state: 'finished', result } : null
}

/** The raw answer, or `undefined` when no answer came back. */
async function ask(command: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    return isTauri() ? await invoke(command, args) : await mockInvoke(command, args)
  } catch (error) {
    console.warn(`[backup] ${command} did not answer:`, error)
    return undefined
  }
}

async function read<T>(command: string, args: Record<string, unknown>, parse: (value: unknown) => T | null): Promise<T | null> {
  const reply = await ask(command, args)
  if (reply === undefined) return null
  const parsed = parse(reply)
  if (parsed === null) console.warn(`[backup] ${command} answered in an unexpected shape`)
  return parsed
}

/** Every call answers null when nothing usable came back; the caller never reads null as an outcome. */
export const backupApi = {
  startBackup: (args: StartBackupArgs) => read(BACKUP_COMMANDS.startBackup, { ...args }, value => parseStart('backup', value)),
  startInspection: (args: StartInspectionArgs) => read(BACKUP_COMMANDS.startInspection, { ...args }, value => parseStart('inspect', value)),
  startRestore: (args: StartRestoreArgs) => read(BACKUP_COMMANDS.startRestore, { ...args }, value => parseStart('restore', value)),
  state: <K extends OperationKind>(kind: K, operationId: string) =>
    read(BACKUP_COMMANDS.getOperation, { operationId }, value => parseState(kind, value)),
  cancel: (operationId: string) =>
    read(BACKUP_COMMANDS.cancelOperation, { operationId }, value => (isFields(value) && isFlag(value.accepted) ? value.accepted : null)),
}
export type BackupApi = typeof backupApi
