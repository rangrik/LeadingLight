// Wire shapes and calls of the five S1a page history commands (plan revision 3, §8).
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../../mock-tauri'
import { isSha256Hex, type HistoryNote } from '../saveOutcome'

export type HistoryReason = HistoryNote['reason']
export type VersionReason = 'firstSave' | 'sessionStart' | 'changedElsewhere' | 'bigChange' | 'checkpoint'
export interface VersionRow { id: string; recordedPath: string; capturedAt: number; reason: VersionReason; length: number; sha256: string }
export interface HistoryHealth {
  state: 'on' | 'notKeeping' | 'unknown'
  reason: HistoryReason | null
  usedBytes: number | null
  budgetBytes: number
  unreadable: number
  attention: string[]
}
export interface SavedLocation { path: string; newestAt: number; count: number; exists: boolean }
type OutsideVault = { status: 'refused'; reason: 'outsideVault' }
export type VersionPage = { status: 'ok'; versions: VersionRow[]; nextCursor: string | null; health: HistoryHealth } | OutsideVault
export type LocationPage = { status: 'ok'; locations: SavedLocation[]; nextCursor: string | null } | OutsideVault
export type VersionPreview =
  | { status: 'ok'; text: string | null; length: number; shownBytes: number; truncated: boolean; bom: boolean; crlf: boolean }
  | { status: 'damaged' } | { status: 'missing' } | OutsideVault
export type VersionCopyRefusal = 'busy' | 'outsideVault' | 'nameUnavailable' | 'operationMismatch' | 'damaged' | 'missing'
export type VersionCopyOutcome =
  | { status: 'created'; path: string; relativePath: string; durable: boolean }
  | { status: 'folderUnavailable'; recordedFolder: string }
  | { status: 'refused'; reason: VersionCopyRefusal }
  | { status: 'failed'; message: string }
  | { status: 'uncertain'; candidatePath: string | null }

type Fields = Record<string, unknown>
const VERSION_REASONS: readonly VersionReason[] = ['firstSave', 'sessionStart', 'changedElsewhere', 'bigChange', 'checkpoint']
const HISTORY_REASONS: readonly HistoryReason[] = ['tooLarge', 'full', 'lowSpace', 'busy', 'unavailable']
const COPY_REFUSALS: readonly VersionCopyRefusal[] = ['busy', 'outsideVault', 'nameUnavailable', 'operationMismatch', 'damaged', 'missing']
const VERSION_ID = /^[0-9a-f]{32}\/\d{1,16}-[0-9a-f]{16}-[0-9a-f]{6}$/

const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string'
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const isFlag = (value: unknown): value is boolean => typeof value === 'boolean'
const isCursor = (value: unknown): value is string | null => value === null || isText(value)
const isOneOf = <T extends string>(options: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (options as readonly string[]).includes(value)
const outsideVault = (value: Fields): OutsideVault | null =>
  value.status === 'refused' && value.reason === 'outsideVault' ? { status: 'refused', reason: 'outsideVault' } : null

/** Every list of the reply, or null when any one item has another shape. */
function every<T>(value: unknown, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null
  const items = value.map(parse)
  return items.every((item): item is T => item !== null) ? items : null
}

export function parseHistoryHealth(value: unknown): HistoryHealth | null {
  if (!isFields(value)) return null
  const { state, reason, usedBytes, budgetBytes, unreadable } = value
  const attention = every(value.attention, item => (isText(item) ? item : null))
  if (!isOneOf(['on', 'notKeeping', 'unknown'] as const, state) || !(reason === null || isOneOf(HISTORY_REASONS, reason))) return null
  if (!(usedBytes === null || isCount(usedBytes)) || !isCount(budgetBytes) || !isCount(unreadable) || !attention) return null
  return { state, reason, usedBytes, budgetBytes, unreadable, attention }
}

function parseVersionRow(value: unknown): VersionRow | null {
  if (!isFields(value)) return null
  const { id, recordedPath, capturedAt, reason, length, sha256 } = value
  if (!isText(id) || !VERSION_ID.test(id) || !isText(recordedPath) || !isCount(capturedAt)) return null
  if (!isOneOf(VERSION_REASONS, reason) || !isCount(length) || !isSha256Hex(sha256)) return null
  return { id, recordedPath, capturedAt, reason, length, sha256 }
}

function parseLocation(value: unknown): SavedLocation | null {
  if (!isFields(value)) return null
  const { path, newestAt, count, exists } = value
  return isText(path) && isCount(newestAt) && isCount(count) && isFlag(exists) ? { path, newestAt, count, exists } : null
}

export function parseVersionPage(value: unknown): VersionPage | null {
  if (!isFields(value)) return null
  if (value.status !== 'ok') return outsideVault(value)
  const versions = every(value.versions, parseVersionRow)
  const health = parseHistoryHealth(value.health)
  return versions && health && isCursor(value.nextCursor) ? { status: 'ok', versions, nextCursor: value.nextCursor, health } : null
}

export function parseLocationPage(value: unknown): LocationPage | null {
  if (!isFields(value)) return null
  if (value.status !== 'ok') return outsideVault(value)
  const locations = every(value.locations, parseLocation)
  return locations && isCursor(value.nextCursor) ? { status: 'ok', locations, nextCursor: value.nextCursor } : null
}

export function parseVersionPreview(value: unknown): VersionPreview | null {
  if (!isFields(value)) return null
  if (value.status === 'damaged' || value.status === 'missing') return { status: value.status }
  if (value.status !== 'ok') return outsideVault(value)
  const { text, length, shownBytes, truncated, bom, crlf } = value
  if (!(text === null || isText(text)) || !isCount(length) || !isCount(shownBytes) || shownBytes > length) return null
  if (!isFlag(truncated) || !isFlag(bom) || !isFlag(crlf)) return null
  return { status: 'ok', text, length, shownBytes, truncated, bom, crlf }
}

export function parseVersionCopyOutcome(value: unknown): VersionCopyOutcome | null {
  if (!isFields(value)) return null
  switch (value.status) {
    case 'created':
      return isText(value.path) && isText(value.relativePath) && isFlag(value.durable)
        ? { status: 'created', path: value.path, relativePath: value.relativePath, durable: value.durable }
        : null
    case 'folderUnavailable':
      return isText(value.recordedFolder) ? { status: 'folderUnavailable', recordedFolder: value.recordedFolder } : null
    case 'refused':
      return isOneOf(COPY_REFUSALS, value.reason) ? { status: 'refused', reason: value.reason } : null
    case 'failed':
      return isText(value.message) ? { status: 'failed', message: value.message } : null
    case 'uncertain':
      return value.candidatePath === null || isText(value.candidatePath) ? { status: 'uncertain', candidatePath: value.candidatePath } : null
    default:
      return null
  }
}

/** The parsed reply, or null for an error or any other shape: no reply is never read as an answer. */
async function ask<T>(command: string, args: Record<string, unknown>, parse: (value: unknown) => T | null): Promise<T | null> {
  try {
    const reply = isTauri() ? await invoke(command, args) : await mockInvoke(command, args)
    const parsed = parse(reply)
    if (parsed === null) console.warn(`[page history] ${command} answered in an unexpected shape`)
    return parsed
  } catch (error) {
    console.warn(`[page history] ${command} did not answer:`, error)
    return null
  }
}

export const pageHistoryApi = {
  listVersions: (vaultPath: string, path: string, cursor: string | null) =>
    ask('list_page_versions', { vaultPath, path, cursor }, parseVersionPage),
  listLocations: (vaultPath: string, cursor: string | null) =>
    ask('list_saved_locations', { vaultPath, cursor }, parseLocationPage),
  readVersion: (vaultPath: string, row: Pick<VersionRow, 'id' | 'sha256'>) =>
    ask('read_page_version', { vaultPath, id: row.id, sha256: row.sha256 }, parseVersionPreview),
  /** One operation id per person's choice; a retry with the same id never makes a second copy. */
  saveCopy: (vaultPath: string, row: Pick<VersionRow, 'id' | 'sha256'>, folder: string | null, operationId: string) =>
    ask('save_page_version_as_copy', { vaultPath, id: row.id, sha256: row.sha256, folder, operationId }, parseVersionCopyOutcome),
  health: (vaultPath: string) => ask('page_history_health', { vaultPath }, parseHistoryHealth),
}

export type PageHistoryApi = typeof pageHistoryApi
