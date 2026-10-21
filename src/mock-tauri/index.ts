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
import { MOCK_ENTRIES } from './mock-entries'
import { EXTENSION_BRIDGE_COMMANDS, ExtensionBackend, MEMORY_OWNER, bundledCommentaryText, memoryHost, type MemoryVault } from './mock-extensions'
import { mockTrashHandlers } from './mock-trash'
import { ADAPT_COMMAND_LIST, browserAdaptHost } from './mock-adapt'
import { MEMORY_VAULT_ROOTS, tryVaultApi } from './vault-api'
import bundledMeetingDebrief from '../../src-tauri/src/leadinglight_extensions/bundled/meeting-debrief.json?raw'
import passageCommentaryFixture from '../leadinglight/extensions/fixtures/passage-commentary.json?raw'

export { addMockEntry, updateMockContent, trackMockChange }

// The mock vault's pages for extensions; a new page is created as create_note_content creates one.
const mockVaultPages: MemoryVault = {
  roots: MEMORY_VAULT_ROOTS,
  pagePaths: () => [...Object.keys(MOCK_CONTENT), ...MOCK_ENTRIES.map(entry => entry.path)],
  createPage(path, content) {
    if (Object.hasOwn(MOCK_CONTENT, path) || MOCK_ENTRIES.some(entry => entry.path === path)) return false
    updateMockContent(path, content)
    trackMockChange(path)
    return true
  },
  readPage: path => {
    const content: unknown = Reflect.get(MOCK_CONTENT, path)
    return typeof content === 'string' ? content : null
  },
  writePage(path, content) {
    updateMockContent(path, content)
    trackMockChange(path)
  },
  trashPage: (root, path) => mockTrashHandlers.move_to_local_trash({ vaultPath: root, paths: [path] }).moved.length === 1,
}
let memoryExtensions: ExtensionBackend | null = null
const runMemoryExtensions = (command: string, args: unknown) => {
  memoryExtensions ??= new ExtensionBackend(memoryHost(mockVaultPages, [bundledMeetingDebrief, bundledCommentaryText(passageCommentaryFixture)]))
  return memoryExtensions.handle(command, args ?? {}, MEMORY_OWNER)
}

// Adapt has no provider in the browser unless a test installed the explicit fixture at page load.
const adaptHost = browserAdaptHost()

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
  // E1 extensions: the dev server in a disk session, which fails closed; otherwise the mock vault.
  ...Object.fromEntries(EXTENSION_BRIDGE_COMMANDS.map(command => [command, async (args?: unknown) =>
    (await tryVaultApi(command, args as Record<string, unknown> | undefined)) ?? runMemoryExtensions(command, args)])),
  // Adapt never reaches the dev server or the network; the desktop harness calls these directly.
  ...Object.fromEntries(ADAPT_COMMAND_LIST.map(command => [command, (args?: unknown) => adaptHost.handle(command, args)])),
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
