/**
 * Vault API detection and proxy for browser dev mode.
 * When a local vault API server is running, routes read and write commands
 * through it instead of returning hardcoded mock data.
 */

import { BACKUP_COMMAND_LIST } from './mock-backup'
import { isExtensionCommand } from './mock-extensions'
import { HISTORY_COMMANDS } from './mock-history'
import { VAULT_API_MARKER } from './mock-save-recovery'

let vaultApiAvailable: boolean | null = null

/** The in-memory mock vault's own roots: its pages and default vaults live only here. */
export const MEMORY_VAULT_ROOTS = ['/Users/mock', '/Users/luca/Laputa', '/mock-vault'] as const

const isMemoryPath = (value: unknown) => typeof value === 'string'
  && MEMORY_VAULT_ROOTS.some(root => value === root || value.startsWith(`${root}/`))

// Without the marker there is no disk at all (unit tests, static pages), so memory is the only vault.
const diskSession = () => typeof document !== 'undefined' && document.querySelector(`meta[name="${VAULT_API_MARKER}"]`) !== null

/** A write in a disk session may fall back to memory only when every target is in the mock vault. */
function failsClosed(body: Record<string, unknown>): boolean {
  const targets = [body.path, body.old_path, body.vault_path].filter(target => target !== undefined)
  return diskSession() && !(targets.length > 0 && targets.every(isMemoryPath))
}

async function detectVaultApiAvailability(): Promise<boolean> {
  try {
    const res = await fetch('/api/vault/ping', { signal: AbortSignal.timeout(500) })
    return res.ok
  } catch (error) {
    void error
    return false
  }
}

async function checkVaultApi(): Promise<boolean> {
  if (vaultApiAvailable === true) return true

  const available = await detectVaultApiAvailability()
  vaultApiAvailable = available
  console.info(`[mock-tauri] Vault API available: ${vaultApiAvailable}`)
  return available
}

interface VaultApiGetRequest {
  body: Record<string, unknown>
  kind: 'all-content' | 'content' | 'entry' | 'list' | 'search'
}

interface VaultApiPostRequest {
  body: Record<string, unknown>
  kind: 'create' | 'delete' | 'rename' | 'rename-filename' | 'save' | 'trash-list' | 'trash-move' | 'trash-restore'
}

const TRASH_COMMANDS = new Map<string, { kind: VaultApiPostRequest['kind'], key?: 'paths' | 'ids' }>([
  ['move_to_local_trash', { kind: 'trash-move', key: 'paths' }],
  ['list_local_trash', { kind: 'trash-list' }],
  ['restore_from_local_trash', { kind: 'trash-restore', key: 'ids' }],
])

/** Local Trash for synthetic fixture vaults, through the dev server. */
function buildTrashRequest(cmd: string, payload: Record<string, unknown>): VaultApiRequest | null {
  const route = TRASH_COMMANDS.get(cmd)
  if (!route || !payload.vaultPath) return null
  const body: Record<string, unknown> = { vault_path: payload.vaultPath }
  if (route.key) body[route.key] = payload[route.key]
  return { kind: route.kind, body }
}

type VaultApiRequest = VaultApiGetRequest | VaultApiPostRequest

/** Tracks last vault path for commands that don't receive it as an argument. */
let lastVaultPath: string | null = null

type PathQueryCommand =
  | 'reload_vault_entry'
  | 'get_note_content'
  | 'validate_note_content'
  | 'get_all_content'

function argText(args: Record<string, unknown>, key: string): string | null {
  const value = Reflect.get(args, key)
  return value ? String(value) : null
}

function commandArgs(args: Record<string, unknown>): Record<string, unknown> {
  const nestedArgs = Reflect.get(args, 'args')
  if (!nestedArgs || typeof nestedArgs !== 'object') return args
  return nestedArgs as Record<string, unknown>
}

function buildListRequest(args: Record<string, unknown>, reload: boolean): VaultApiRequest | null {
  const payload = commandArgs(args)
  const path = argText(payload, 'path')
  if (!path) return null

  lastVaultPath = path
  return { kind: 'list', body: { path, reload } }
}

function buildPathQueryRequest(cmd: PathQueryCommand, args: Record<string, unknown>): VaultApiRequest | null {
  const payload = commandArgs(args)
  const path = argText(payload, 'path')
  if (!path) return null
  const vaultPath = argText(payload, 'vaultPath') ?? argText(payload, 'vault_path')
  return { kind: pathQueryKind(cmd), body: vaultPath ? { path, vault_path: vaultPath } : { path } }
}

function buildRequiredPostRequest(
  kind: VaultApiPostRequest['kind'],
  required: unknown,
  body: Record<string, unknown>,
): VaultApiRequest | null {
  return required ? { kind, body } : null
}

function buildRequiredPathPostRequest(
  kind: VaultApiPostRequest['kind'],
  args: Record<string, unknown>,
  body: Record<string, unknown>,
): VaultApiRequest | null {
  return buildRequiredPostRequest(kind, args.path, body)
}

function buildSearchRequest(args: Record<string, unknown>): VaultApiRequest | null {
  const payload = commandArgs(args)
  const query = argText(payload, 'query')
  if (!query || !lastVaultPath) return null

  const mode = argText(payload, 'mode') ?? 'all'
  const body: Record<string, unknown> = { mode, query, vault_path: lastVaultPath }
  if (Reflect.get(payload, 'excludeFrontmatter') === true) body.exclude_frontmatter = true
  return { kind: 'search', body }
}

function isPathQueryCommand(cmd: string): cmd is PathQueryCommand {
  return cmd === 'reload_vault_entry'
    || cmd === 'get_note_content'
    || cmd === 'validate_note_content'
    || cmd === 'get_all_content'
}

function pathQueryKind(command: PathQueryCommand): VaultApiGetRequest['kind'] {
  if (command === 'reload_vault_entry') return 'entry'
  if (command === 'get_all_content') return 'all-content'
  return 'content'
}

function buildPostRequest(cmd: string, args: Record<string, unknown>): VaultApiRequest | null {
  const payload = commandArgs(args)
  if (cmd === 'save_note_content') {
    return buildRequiredPathPostRequest('save', payload, {
      content: payload.content,
      path: payload.path,
    })
  }
  if (cmd === 'create_note_content') {
    return buildRequiredPathPostRequest('create', payload, {
      content: payload.content,
      path: payload.path,
    })
  }
  if (cmd === 'rename_note') {
    return buildRequiredPostRequest('rename', payload.old_path, {
      new_title: payload.new_title,
      old_path: payload.old_path,
      vault_path: payload.vault_path,
    })
  }
  if (cmd === 'rename_note_filename') {
    return buildRequiredPostRequest('rename-filename', payload.old_path, {
      new_filename_stem: payload.new_filename_stem,
      old_path: payload.old_path,
      vault_path: payload.vault_path,
    })
  }
  if (cmd === 'delete_note') return buildRequiredPathPostRequest('delete', payload, { path: payload.path })
  return buildTrashRequest(cmd, payload)
}

function buildVaultApiRequest(cmd: string, args?: Record<string, unknown>): VaultApiRequest | null {
  if (!args) return null
  if (cmd === 'list_vault') return buildListRequest(args, false)
  if (cmd === 'reload_vault') return buildListRequest(args, true)
  if (cmd === 'search_vault') return buildSearchRequest(args)
  if (isPathQueryCommand(cmd)) return buildPathQueryRequest(cmd, args)
  return buildPostRequest(cmd, args)
}

function buildFetchOptions(request: { body: Record<string, unknown> }): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request.body),
  }
}

/** Raised for a refused write so the caller sees it instead of a silent in-memory fallback. */
class VaultApiRefusal extends Error {}

async function fetchVaultApiResponse(request: VaultApiRequest, closed: boolean) {
  const res = await fetchVaultApiRequest(request)
  if (res.ok) return res.json()
  if (res.status !== 409 && !closed) return undefined
  const body = await res.json().catch(() => ({})) as { error?: string }
  throw new VaultApiRefusal(body.error ?? (res.status === 409 ? 'File already exists' : `Vault API ${res.status}`))
}

function isGetRequest(request: VaultApiRequest): request is VaultApiGetRequest {
  return request.kind === 'all-content'
    || request.kind === 'content'
    || request.kind === 'entry'
    || request.kind === 'list'
    || request.kind === 'search'
}

function fetchVaultApiGetRequest(request: VaultApiGetRequest): Promise<Response> {
  if (request.kind === 'all-content') {
    return fetch('/api/vault/all-content', buildFetchOptions(request))
  }
  if (request.kind === 'content') {
    return fetch('/api/vault/content', buildFetchOptions(request))
  }
  if (request.kind === 'entry') {
    return fetch('/api/vault/entry', buildFetchOptions(request))
  }
  if (request.kind === 'list') {
    return fetch('/api/vault/list', buildFetchOptions(request))
  }
  return fetch('/api/vault/search', buildFetchOptions(request))
}

function fetchVaultApiPostRequest(request: VaultApiPostRequest): Promise<Response> {
  if (request.kind.startsWith('trash-') || request.kind === 'create') return fetch(`/api/vault/${request.kind}`, buildFetchOptions(request))
  if (request.kind === 'delete') return fetch('/api/vault/delete', buildFetchOptions(request))
  if (request.kind === 'rename') return fetch('/api/vault/rename', buildFetchOptions(request))
  if (request.kind === 'rename-filename') return fetch('/api/vault/rename-filename', buildFetchOptions(request))
  return fetch('/api/vault/save', buildFetchOptions(request))
}

function fetchVaultApiRequest(request: VaultApiRequest): Promise<Response> {
  return isGetRequest(request)
    ? fetchVaultApiGetRequest(request)
    : fetchVaultApiPostRequest(request)
}

const SAVE_RECOVERY_ROUTES = new Map([
  ['save_page_content', '/api/vault/save-page-content'],
  ['check_save_outcome', '/api/vault/check-save-outcome'],
  ['save_draft_as_new_page', '/api/vault/save-draft-as-new-page'],
  ['release_hold_with_copy', '/api/vault/release-hold-with-copy'],
  ['discard_hold', '/api/vault/discard-hold'],
])

// Page history (S1a) for a vault on disk; its versions live beside that vault's pages.
const HISTORY_ROUTES = new Map<string, string>(HISTORY_COMMANDS.map(command => [command, `/api/vault/${command.replaceAll('_', '-')}`]))

// Backup, inspection and restore (M6): routed by every path they carry, not by a vault alone.
const BACKUP_ROUTES = new Map<string, string>(BACKUP_COMMAND_LIST.map(command => [command, `/api/vault/${command.replaceAll('_', '-')}`]))
const BACKUP_PATH_KEYS = ['vaultPath', 'backupPath', 'parent'] as const

const UNAVAILABLE = 'The dev vault server is not answering, so nothing was written.'

// The mock vault answers itself; any other vault is answered from disk or the caller sees no reply.
async function tryDiskCommandApi<T>(route: string, args: Record<string, unknown>, vaultPath: unknown): Promise<T | undefined> {
  if (!diskSession() || isMemoryPath(vaultPath)) return undefined
  if (!await checkVaultApi()) throw new Error(UNAVAILABLE)
  const res = await fetch(route, buildFetchOptions({ body: args }))
  const body = await res.json().catch(() => null) as { error?: unknown } | null
  if (res.ok && body !== null) return body as T
  throw new Error(typeof body?.error === 'string' ? body.error : `Vault API ${res.status}`)
}

// Extensions in a disk session: every command goes to the dev server, which issues this page its
// owner, as native binds a window. Sessions, runs and receipts never fall back to the memory mock.
const EXTENSIONS_UNAVAILABLE = 'The dev extension bridge is not answering; nothing was changed by this request.'
let extensionOwner: Promise<string> | null = null

async function registerExtensionOwner(): Promise<string> {
  const res = await fetch('/api/extensions/owner', buildFetchOptions({ body: {} }))
  const body = await res.json().catch(() => null) as { owner?: unknown } | null
  if (!res.ok || typeof body?.owner !== 'string') throw new Error(EXTENSIONS_UNAVAILABLE)
  const owner = body.owner
  // Leaving the page ends its sessions, as native does for a reloaded or closed window.
  window.addEventListener('pagehide', () => {
    extensionOwner = null
    navigator.sendBeacon?.('/api/extensions/owner-end', new Blob([JSON.stringify({ owner })], { type: 'application/json' }))
  }, { once: true })
  return owner
}

async function tryExtensionDiskApi<T>(cmd: string, args: Record<string, unknown>): Promise<T | undefined> {
  if (!diskSession()) return undefined
  extensionOwner ??= registerExtensionOwner().catch((error: unknown) => {
    extensionOwner = null
    throw error
  })
  const owner = await extensionOwner
  const res = await fetch(`/api/extensions/${cmd}`, buildFetchOptions({ body: { owner, args } }))
  const body = await res.json().catch(() => null) as { error?: unknown } | null
  if (res.ok && body !== null) return body as T
  throw new Error(typeof body?.error === 'string' ? body.error : EXTENSIONS_UNAVAILABLE)
}

export async function tryVaultApi<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  if (isExtensionCommand(cmd)) return tryExtensionDiskApi<T>(cmd, args ?? {})
  // The desktop is the preservation boundary for folder moves. A disk-session browser
  // must never turn an unsupported native operation into an in-memory success.
  if (cmd === 'move_note_to_folder' && args && diskSession()) {
    const payload = commandArgs(args)
    if (!isMemoryPath(payload.vault_path ?? payload.vaultPath)) {
      throw new VaultApiRefusal('Move this page in the desktop app to preserve its local references.')
    }
  }
  const recoveryRoute = SAVE_RECOVERY_ROUTES.get(cmd)
  if (recoveryRoute) return args ? tryDiskCommandApi<T>(recoveryRoute, args, (args.request as { vaultPath?: unknown } | undefined)?.vaultPath) : undefined
  const historyRoute = HISTORY_ROUTES.get(cmd)
  if (historyRoute) return args ? tryDiskCommandApi<T>(historyRoute, args, args.vaultPath) : undefined
  const backupRoute = BACKUP_ROUTES.get(cmd)
  if (backupRoute) {
    // Any mock-vault path means the in-memory preview, which answers itself; status and cancel go to disk.
    const memory = args !== undefined && BACKUP_PATH_KEYS.some(key => isMemoryPath(args[key]))
    return args ? tryDiskCommandApi<T>(backupRoute, args, memory ? MEMORY_VAULT_ROOTS[0] : undefined) : undefined
  }
  const request = buildVaultApiRequest(cmd, args)
  if (!request) return undefined
  const exactRead = request.kind === 'entry' || (cmd === 'get_note_content' && typeof request.body.vault_path === 'string')
  const closed = (!isGetRequest(request) || exactRead) && failsClosed(request.body)
  if (!await checkVaultApi()) {
    if (closed) throw new VaultApiRefusal(UNAVAILABLE)
    return undefined
  }

  try {
    const data = await fetchVaultApiResponse(request, closed)
    if (closed && exactRead && (data == null || (cmd === 'get_note_content' && typeof data.content !== 'string'))) {
      throw new VaultApiRefusal('The exact page could not be read from disk.')
    }
    if (data === undefined) return undefined
    if (cmd === 'get_note_content') return data.content as T
    if (cmd === 'validate_note_content') return (data.content === args?.content) as T
    return data as T
  } catch (err) {
    if (err instanceof VaultApiRefusal || closed) throw err
    console.warn(`[mock-tauri] Vault API call failed for ${cmd}, falling back to mock:`, err)
    return undefined
  }
}
