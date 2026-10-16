import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { VaultEntry } from '../types'

// Bridge to the native per-vault Trash commands: move_to_local_trash, list_local_trash and
// restore_from_local_trash. Every item gets its own result; failure `code`s pick the copy shown.

export interface TrashMoved { path: string, id: string, originalPath: string }
export interface TrashMoveFailure { path: string, code: string, message: string }
export interface TrashMoveResult { moved: TrashMoved[], failed: TrashMoveFailure[] }

/** `cleanupPending`: already restored to `restoredPath`; only a leftover Trash copy remains to tidy. */
export type TrashItemState = 'ready' | 'needsAttention' | 'missing' | 'cleanupPending'
export interface TrashItem {
  id: string
  state: TrashItemState
  title: string | null
  filename: string | null
  originalPath: string | null
  deletedAt: number | null
  fileKind: 'markdown' | 'text' | 'binary'
  sizeBytes: number | null
  restoredPath?: string | null
}

export interface TrashRestored {
  id: string
  path: string
  relativePath: string
  renamed: boolean
  relocated: boolean
  /** Restored; the copy left in Trash is removed later. Never a reason to restore again. */
  cleanupPending?: boolean
  entry: VaultEntry | null
}
export interface TrashRestoreFailure { id: string, code: string, message: string }
export interface TrashRestoreResult { restored: TrashRestored[], failed: TrashRestoreFailure[] }

function local<T>(command: string, args: Record<string, unknown>): Promise<T> {
  return isTauri() ? invoke<T>(command, args) : mockInvoke<T>(command, args)
}

/** Rejects only when nothing moved; otherwise every path gets its own result. */
export function moveToLocalTrash(vaultPath: string, paths: string[]): Promise<TrashMoveResult> {
  return local('move_to_local_trash', { vaultPath, paths })
}

export function listLocalTrash(vaultPath: string): Promise<TrashItem[]> {
  return local('list_local_trash', { vaultPath })
}

export function restoreFromLocalTrash(vaultPath: string, ids: string[]): Promise<TrashRestoreResult> {
  return local('restore_from_local_trash', { vaultPath, ids })
}
