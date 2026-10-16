// Backup and restore wire contract, version 1: m6-backup-contract.md as amended by root.
// A leaf: native, the browser bridge and the UI share these shapes. No imports, no desktop code.

export const BACKUP_COMMANDS = {
  startBackup: 'start_workspace_backup',
  startInspection: 'start_backup_inspection',
  startRestore: 'start_backup_restore',
  getOperation: 'get_backup_operation',
  cancelOperation: 'cancel_backup_operation',
} as const
export type BackupCommand = (typeof BACKUP_COMMANDS)[keyof typeof BACKUP_COMMANDS]

export const BACKUP_LIMITS = {
  /** Entries a preflight walk or inspection traversal may visit. */
  entries: 100_000,
  /** Sum of included relative-path bytes. */
  totalPathBytes: 16 * 1024 * 1024,
  pathBytes: 1024,
  pathSegments: 64,
  manifestBytes: 64 * 1024 * 1024,
  manifestGaps: 1000,
  /** Samples returned per summary over IPC. */
  samples: 5,
  changingFileAttempts: 3,
  copyBufferBytes: 1024 * 1024,
  /** Finished operations a process keeps; older ids answer `unknown`. */
  retainedOperations: 16,
  /** Trash items are counted up to this many; the count is "at least" at the cap. */
  trashItemsCounted: 10_000,
  restoreNameBytes: 255,
  pollIntervalMs: 250,
} as const

export const MANIFEST_NAME = 'leadinglight-backup.json'
export const MANIFEST_FORMAT = 'leadinglight-backup'
export const MANIFEST_VERSION = 1
/** Copied files live under this folder inside a backup. */
export const WORKSPACE_FOLDER = 'workspace'
/** Present in a restore output until the verified restore removes it. */
export const RESTORE_MARKER = '.leadinglight-restore-unfinished'

// --- Shared ----------------------------------------------------------------------------------

export const OPERATION_KINDS = ['backup', 'inspect', 'restore'] as const
export type OperationKind = (typeof OPERATION_KINDS)[number]
export const PHASES = ['counting', 'copying', 'checking', 'finishing'] as const
export type Phase = (typeof PHASES)[number]
export interface Progress { files: number; totalFiles: number | null; bytes: number; totalBytes: number | null }
/** `path` is relative to the workspace or the backup. */
export interface Sample<R extends string> { path: string | null; reason: R }
/** `sample` holds at most `BACKUP_LIMITS.samples` entries; `total` counts them all. */
export interface Summary<R extends string> { total: number; counts: Partial<Record<R, number>>; sample: Sample<R>[] }

// --- Commands --------------------------------------------------------------------------------

/** `operationId` is a lowercase UUID v4; paths are absolute. */
export interface StartBackupArgs { operationId: string; vaultPath: string; destination: string }
export interface StartInspectionArgs { operationId: string; backupPath: string }
export interface StartRestoreArgs { operationId: string; backupPath: string; manifestSha256: string; parent: string; name: string }
export interface OperationArgs { operationId: string }

export const START_REFUSALS = [
  'busy',
  'operationMismatch',
  'notWorkspace',
  'destinationMissing', 'destinationNotFolder', 'destinationInWorkspace',
  'backupMissing', 'backupNotFolder',
  'parentMissing', 'parentNotFolder', 'parentInWorkspace', 'parentInBackup',
  'nameInvalid',
  /** Root amendment: the in-memory browser preview has no disk to back up or restore. */
  'unavailable',
] as const
export type StartRefusal = (typeof START_REFUSALS)[number]

/** No backup or restore output was written for a refusal. */
export type StartAnswer =
  | { status: 'started' }
  | { status: 'finished'; result: OperationResult }
  | { status: 'refused'; reason: StartRefusal }

/**
 * `unknown`: never seen in this process, or no longer retained. A start is idempotent only
 * while its operation is retained; the UI never replays a start after `unknown`.
 */
export type OperationState =
  | { state: 'unknown' }
  | { state: 'running'; kind: OperationKind; phase: Phase; progress: Progress | null; cancelRequested: boolean }
  | { state: 'finished'; kind: 'backup'; result: BackupResult }
  | { state: 'finished'; kind: 'inspect'; result: InspectResult }
  | { state: 'finished'; kind: 'restore'; result: RestoreResult }

export interface CancelAnswer { accepted: boolean }

// --- Results ---------------------------------------------------------------------------------

export const GAP_REASONS = ['unreadable', 'changing', 'missing', 'link', 'special', 'notText', 'tooLong', 'tooDeep'] as const
export type GapReason = (typeof GAP_REASONS)[number]

export const BACKUP_FAILURES = [
  'tooLarge', 'manifestTooLarge', 'noSpace', 'destinationNotWritable', 'destinationChanged', 'checkFailed', 'io', 'internal',
] as const
export type BackupFailure = (typeof BACKUP_FAILURES)[number]

export type BackupResult =
  | {
      status: 'complete' | 'incomplete'
      folder: string
      folderName: string
      files: number
      bytes: number
      /** False: completed, but a folder sync failed. Never retried. */
      durable: boolean
      gaps: Summary<GapReason>
      versionsSkipped: number
      trashItemsNotIncluded: number
    }
  /** `leftover`: an unfinished folder that could not be removed. */
  | { status: 'cancelled'; leftover: string | null }
  | { status: 'failed'; reason: BackupFailure; path: string | null; leftover: string | null }

export const PROBLEMS = [
  'manifestMissing', 'manifestTooLarge', 'manifestInvalid', 'unsupportedVersion',
  'badPath', 'duplicatePath', 'pathConflict',
  'missing', 'notRegularFile', 'sizeMismatch', 'hashMismatch', 'unreadable',
  /** A bounded traversal (manifest records, path bytes or extra files) passed its limit. */
  'tooLarge',
] as const
export type Problem = (typeof PROBLEMS)[number]

export type InspectResult =
  | {
      status: 'ok'
      manifestSha256: string
      createdAt: string
      appVersion: string
      workspaceName: string
      backupStatus: 'complete' | 'incomplete'
      files: number
      bytes: number
      gaps: number
      /** Files under `workspace/` not in the manifest; never restored. */
      extraFiles: number
    }
  | { status: 'notBackup' }
  | { status: 'damaged'; problems: Summary<Problem> }
  | { status: 'cancelled' }
  | { status: 'failed'; reason: 'io' | 'internal' }

export const RESTORE_FAILURES = ['noSpace', 'parentNotWritable', 'destinationChanged', 'checkFailed', 'io', 'internal'] as const
export type RestoreFailure = (typeof RESTORE_FAILURES)[number]

export type RestoreResult =
  | { status: 'restored'; folder: string; folderName: string; files: number; bytes: number; durable: boolean; timesKept: boolean }
  /** parent/name already exists; nothing was written. */
  | { status: 'nameTaken' }
  /** The manifest or a file differs from the inspected backup; may occur after output was created. */
  | { status: 'backupChanged'; problems: Summary<Problem>; leftover: string | null }
  /** The manifest failed re-validation before any output was created. */
  | { status: 'damaged'; problems: Summary<Problem> }
  | { status: 'cancelled'; leftover: string | null }
  | { status: 'failed'; reason: RestoreFailure; path: string | null; leftover: string | null }

export type OperationResult = BackupResult | InspectResult | RestoreResult

// --- Manifest (`leadinglight-backup.json`, version 1) -----------------------------------------

export interface ManifestFile { path: string; bytes: number; sha256: string; modifiedMs: number }
export interface ManifestGap { path: string; reason: GapReason }
/** Every integer is a safe non-negative integer; `status` is `complete` exactly when `gapsTotal` is 0. */
export interface BackupManifest {
  format: typeof MANIFEST_FORMAT
  version: typeof MANIFEST_VERSION
  appVersion: string
  createdAt: string
  workspaceName: string
  status: 'complete' | 'incomplete'
  files: ManifestFile[]
  /** At most `BACKUP_LIMITS.manifestGaps` entries; `gapsTotal` counts all. */
  gaps: ManifestGap[]
  gapsTotal: number
  versionsSkipped: number
  trashItemsNotIncluded: number
  totalFiles: number
  totalBytes: number
}
