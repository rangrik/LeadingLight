/**
 * Mock Tauri invoke for browser testing.
 * When running outside Tauri (e.g. in Chrome via localhost:5173),
 * this provides realistic test data so the UI can be verified visually.
 */

import { MOCK_CONTENT } from './mock-content'
import { mockHandlers, addMockEntry, updateMockContent, trackMockChange } from './mock-handlers'
import { setNoteFavorite, type SetNoteFavoriteArgs } from './mock-favorite'
import { BACKUP_COMMAND_LIST, runMemoryBackup } from './mock-backup'
import { HISTORY_COMMANDS, memoryPageHistory, runHistoryCommand } from './mock-history'
import { SAVE_RECOVERY_COMMANDS } from './mock-save-recovery'
import { tryVaultApi } from './vault-api'

export { addMockEntry, updateMockContent, trackMockChange }

type MockHandler = (args?: unknown) => unknown

function registerMockHandlers(): Record<string, MockHandler> {
  return Object.fromEntries(
    Object.entries(mockHandlers).map(([command, handler]) => [
      command,
      (args?: unknown) => Reflect.apply(handler, undefined, [args]),
    ]),
  )
}

const registeredMockHandlers: Record<string, MockHandler> = {
  ...registerMockHandlers(),
  // Reads and writes take the app's own routes, so the dev vault API, the desktop harness and
  // the in-memory mock all keep the star in the same place as the page.
  set_note_favorite: (args?: unknown) => setNoteFavorite(
    args as SetNoteFavoriteArgs,
    path => mockInvoke<string>('get_note_content', { path }),
    (path, content) => mockInvoke('save_note_content', { path, content }),
  ),
  // The desktop harness calls these handlers directly, so a disk vault is still answered from disk.
  ...Object.fromEntries(SAVE_RECOVERY_COMMANDS.map(command => [command, async (args?: unknown) =>
    (await tryVaultApi(command, args as Record<string, unknown> | undefined))
      ?? Reflect.apply(Reflect.get(mockHandlers, command) as MockHandler, undefined, [args])])),
  // Page history the same way; the mock vault's own history shares its pages with its saves.
  ...Object.fromEntries(HISTORY_COMMANDS.map(command => [command, async (args?: unknown) =>
    (await tryVaultApi(command, args as Record<string, unknown> | undefined))
      ?? runHistoryCommand(memoryPageHistory, command, args)])),
  // Backup and restore need a disk; the in-memory preview answers `unavailable`, never a fake success.
  ...Object.fromEntries(BACKUP_COMMAND_LIST.map(command => [command, async (args?: unknown) =>
    (await tryVaultApi(command, args as Record<string, unknown> | undefined)) ?? runMemoryBackup(command, args)])),
}

export function isTauri(): boolean {
  if (typeof globalThis !== 'undefined' && typeof (globalThis as { isTauri?: unknown }).isTauri === 'boolean') {
    return Boolean((globalThis as { isTauri?: unknown }).isTauri)
  }

  return typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window)
}

// Initialize window globals for browser testing and Playwright overrides
if (typeof window !== 'undefined') {
  window.__mockContent = MOCK_CONTENT
  window.__mockHandlers = registeredMockHandlers
}

function resolveMockHandler(command: string) {
  const windowHandler = typeof window === 'undefined' || !window.__mockHandlers
    ? undefined
    : Reflect.get(window.__mockHandlers, command) as MockHandler | undefined
  return windowHandler ?? Reflect.get(registeredMockHandlers, command) as MockHandler | undefined
}

export async function mockInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const vaultResult = await tryVaultApi<T>(cmd, args)
  if (vaultResult !== undefined) return vaultResult

  const handler = resolveMockHandler(cmd)
  if (handler) {
    await new Promise((r) => setTimeout(r, 100))
    return handler(args) as T
  }
  throw new Error(`No mock handler for command: ${cmd}`)
}
