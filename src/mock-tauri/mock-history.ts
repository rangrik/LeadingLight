// Model of the S1a page-history commands (m5-s1-revalidated-plan.md revision 3, §2–§8) for the
// browser bridge and the dev vault server. Pure: a store does the storage work; no Node modules.
import type { HistoryNote } from '../leadinglight/saveOutcome.ts'

export const HISTORY_COMMANDS = [
  'list_page_versions',
  'list_saved_locations',
  'read_page_version',
  'save_page_version_as_copy',
  'page_history_health',
] as const
export type HistoryCommand = (typeof HISTORY_COMMANDS)[number]

// --- Frozen §8 shapes ----------------------------------------------------------------------

export type HistoryReason = HistoryNote['reason']
export type VersionReason = 'firstSave' | 'sessionStart' | 'changedElsewhere' | 'bigChange' | 'checkpoint'
export interface VersionRow { id: string; recordedPath: string; capturedAt: number; reason: VersionReason; length: number; sha256: string }
/** `unknown` means the lock was busy, so nothing could be checked now. */
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
export type VersionList = { status: 'ok'; versions: VersionRow[]; nextCursor: string | null; health: HistoryHealth } | OutsideVault
export type LocationList = { status: 'ok'; locations: SavedLocation[]; nextCursor: string | null } | OutsideVault
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

/** A malformed argument. Native answers `Err`, which the frontend treats as no reply. */
export class HistoryArgumentError extends Error {}

// --- Limits and store contract -----------------------------------------------------------

const MIB = 1024 * 1024
export const HISTORY_LIMITS = {
  budgetBytes: 512 * MIB,
  versions: 1000,
  locations: 2000,
  perLocation: 200,
  tmp: 64,
  maxPageBytes: 10 * MIB,
  previewBytes: 256 * 1024,
  pageSize: 100,
  pruneBatch: 20,
  maintenanceBatch: 500,
}
export type HistoryLimits = typeof HISTORY_LIMITS

const HOUR = 3_600_000
const DAY = 24 * HOUR
// The frozen shared layout (m5-s1-cross-lane-contract-corrections.md): names both lanes write and read.
const VERSION_NAME = /^(\d{1,16})-([0-9a-f]{16})-([0-9a-f]{6})$/
export const LOCATION_KEY = /^[0-9a-f]{32}$/
const TMP_WRITE = /^[0-9a-f]{32}\.tmpv$/
const TMP_DELETE = /^del-([0-9a-f]{32})-(\d{1,16}-[0-9a-f]{16}-[0-9a-f]{6})$/
const LOCATION_CURSOR = /^(\d{1,16})-([0-9a-f]{32})$/
const SHA256 = /^[0-9a-f]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const REASONS: readonly VersionReason[] = ['firstSave', 'sessionStart', 'changedElsewhere', 'bigChange', 'checkpoint']
const META_KEYS = ['format', 'capturedAt', 'reason', 'recordedPath', 'length', 'sha256']

/** A version folder's capture time, only when it is a safe integer the frontend can hold exactly. */
export function versionTime(name: string): number | null {
  const match = VERSION_NAME.exec(name)
  const time = match ? Number(match[1]) : NaN
  return Number.isSafeInteger(time) ? time : null
}
/** A `tmp/` entry by the shared layout; a deletion's version name needs the same safe time as a version. */
export function tmpKind(name: string): 'write' | 'delete' | null {
  if (TMP_WRITE.test(name)) return 'write'
  const deleting = TMP_DELETE.exec(name)
  return deleting && versionTime(deleting[2]) !== null ? 'delete' : null
}
/** The version folder name native writes: a 13-digit time, the hash prefix and six random hex. */
export const versionName = (capturedAt: number, sha256: string, tag: string) =>
  `${String(capturedAt).padStart(13, '0')}-${sha256.slice(0, 16)}-${tag}`
/** A vault-relative `/` path that cannot leave the vault. */
export const safeRelative = (value: string) =>
  value !== '' && !value.startsWith('/') && value.split('/').every(part => part !== '' && part !== '.' && part !== '..')

/** The contents of `version.json`, format 1, in native's field order. */
export interface VersionMeta { format: 1; capturedAt: number; reason: VersionReason; recordedPath: string; length: number; sha256: string }
export const serializeVersionMeta = (meta: VersionMeta) => JSON.stringify({
  format: meta.format, capturedAt: meta.capturedAt, reason: meta.reason, recordedPath: meta.recordedPath, length: meta.length, sha256: meta.sha256,
})
export const serializeLocation = (recordedPath: string) => JSON.stringify({ recordedPath })
export interface StoredVersion {
  name: string
  /** Capture time from the name, so a malformed entry still sorts. */
  at: number
  /** Null when malformed: counted and removable, never listed. */
  meta: VersionMeta | null
  bytes: number
}
export interface StoredLocation {
  loc: string
  /** As read from `location.json`; the core checks it against `loc`. */
  recordedPath: string | null
  versions: StoredVersion[]
  /** False when the per-location ceiling stopped the scan, so its newest is unknown. */
  complete: boolean
}
export interface TmpEntry { name: string; deleting: boolean; at: number }
export interface Inventory {
  usedBytes: number
  versionCount: number
  locations: StoredLocation[]
  tmp: TmpEntry[]
  /** Vault-relative paths that cannot be accounted for. */
  attention: string[]
  /** `full`: a ceiling stopped the scan; `unavailable`: something here cannot be accounted for. */
  blocked: 'full' | 'unavailable' | null
}
export interface PageSpot { root: string; recordedPath: string }
/** A version's whole payload, its record (null when not understood) and its location's own record. */
export interface FoundVersion { bytes: Uint8Array; meta: VersionMeta | null; location: string | null }
export interface VersionCopyJob {
  vaultPath: string
  root: string
  operationId: string
  /** Digest of the version and the raw folder choice; a retry must match it exactly. */
  args: string
  contentSha256: string
  folder: string | null
  /** Already verified against its record and the request, under the claim. */
  bytes: Uint8Array
  recordedPath: string
}

export interface HistoryStore {
  /** The canonical root of a usable vault, or null. */
  root(vaultPath: string): string | null
  /** Where a page's versions are recorded, or null outside the vault. */
  spot(vaultPath: string, page: string): PageSpot | null
  /** Bounded and metadata-only; throws when the store cannot be read at all. */
  inventory(root: string, limits: HistoryLimits): Inventory
  /** §5 write steps 1–6, persisting exactly these bytes; `location` only when its record is missing. Never throws. */
  write(root: string, loc: string, location: string | null, name: string, payload: Uint8Array, meta: string): 'kept' | 'lowSpace' | 'unavailable'
  /** Recognized-file delete; false when something was left behind in `tmp/`. */
  remove(root: string, loc: string, name: string): boolean
  removeTmp(root: string, entry: TmpEntry): boolean
  /** Only a location holding nothing but its `location.json`. */
  removeLocation(root: string, loc: string): boolean
  /** Native's read: `missing` when gone, `damaged` when present but unreadable. */
  read(root: string, loc: string, name: string): FoundVersion | 'missing' | 'damaged'
  exists(root: string, recordedPath: string): boolean
  copy(job: VersionCopyJob): VersionCopyOutcome
}

// --- Pure helpers ---------------------------------------------------------------------------

const ROUND: number[] = []
const INITIAL: number[] = []
const ror = (x: number, n: number) => (x >>> n) | (x << (32 - n))
/** SHA-256 in plain JS, so the in-memory mock can hash synchronously in the browser. */
export function sha256Bytes(bytes: Uint8Array): string {
  if (ROUND.length === 0) {
    for (let n = 2; ROUND.length < 64; n += 1) {
      let prime = true
      for (let d = 2; d * d <= n; d += 1) if (n % d === 0) prime = false
      if (!prime) continue
      if (INITIAL.length < 8) INITIAL.push(((Math.sqrt(n) % 1) * 2 ** 32) | 0)
      ROUND.push(((Math.cbrt(n) % 1) * 2 ** 32) | 0)
    }
  }
  const words = new Uint32Array(((bytes.length + 72) >> 6) << 4)
  bytes.forEach((byte, i) => { words[i >> 2] |= byte << (24 - (i & 3) * 8) })
  words[bytes.length >> 2] |= 0x80 << (24 - (bytes.length & 3) * 8)
  words[words.length - 2] = Math.floor(bytes.length / 2 ** 29)
  words[words.length - 1] = bytes.length * 8
  const h = [...INITIAL]
  const w = new Uint32Array(64)
  for (let block = 0; block < words.length; block += 16) {
    for (let t = 0; t < 64; t += 1) {
      if (t < 16) w[t] = words[block + t]
      else {
        const a = w[t - 15], b = w[t - 2]
        w[t] = (ror(a, 7) ^ ror(a, 18) ^ (a >>> 3)) + w[t - 7] + (ror(b, 17) ^ ror(b, 19) ^ (b >>> 10)) + w[t - 16]
      }
    }
    let [a, b, c, d, e, f, g, k] = h
    for (let t = 0; t < 64; t += 1) {
      const t1 = k + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + ROUND[t] + w[t]
      const t2 = (ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))
      k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
    }
    const round = [a, b, c, d, e, f, g, k]
    for (let i = 0; i < 8; i += 1) h[i] = (h[i] + round[i]) | 0
  }
  return h.map(value => (value >>> 0).toString(16).padStart(8, '0')).join('')
}

const encoder = new TextEncoder()
export const locationKey = (recordedPath: string, sha256: (bytes: Uint8Array) => string) =>
  sha256(encoder.encode(recordedPath)).slice(0, 32)

/** Bytes of `before` that `after` no longer has between their shared ends. */
export function removedSpan(before: Uint8Array, after: Uint8Array): number {
  const shorter = Math.min(before.length, after.length)
  let prefix = 0
  while (prefix < shorter && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  while (suffix < shorter - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1
  return before.length - prefix - suffix
}

/** §5 policy: why to keep `before`, `duplicate`, or null for nothing worth keeping. */
export function keepReason(input: {
  versions: readonly VersionMeta[]
  remembered: string | undefined
  before: Uint8Array
  beforeSha256: string
  after: Uint8Array
  now: number
}): VersionReason | 'duplicate' | null {
  const { versions, remembered, before, beforeSha256, after, now } = input
  const newest = versions.reduce<VersionMeta | null>((best, v) => (!best || v.capturedAt > best.capturedAt ? v : best), null)
  const same = (v: VersionMeta) => v.length === before.length && v.sha256 === beforeSha256
  if (versions.some(v => same(v) && (v === newest || now - v.capturedAt <= 2 * HOUR))) return 'duplicate'
  if (!newest) return 'firstSave'
  if (remembered === undefined) return 'sessionStart'
  if (remembered !== beforeSha256) return 'changedElsewhere'
  const removed = removedSpan(before, after)
  if (removed >= 2048 || removed >= 0.3 * before.length) return 'bigChange'
  if (now - newest.capturedAt >= 60_000) return 'checkpoint'
  return null
}

const TIERS = [
  { upTo: 2 * DAY, bucket: HOUR },
  { upTo: 30 * DAY, bucket: DAY },
  { upTo: 180 * DAY, bucket: 7 * DAY },
]

/**
 * §5 retention, as native's `retention::plan`: names to delete, oldest first. Every entry is judged
 * by age, unreadable ones included; the newest listable version is never among them.
 */
export function retentionPlan(versions: readonly StoredVersion[], now: number, limits: HistoryLimits): string[] {
  const newestFirst = [...versions].sort((x, y) => y.at - x.at || (y.name < x.name ? -1 : 1))
  const newest = newestFirst.find(v => v.meta)?.name
  let recent = 0
  const buckets = new Map<string, { big: boolean }>()
  const wanted = newestFirst.map(v => {
    const age = Math.max(0, now - v.at)
    // As native: the protected newest takes one of the 30 recent places too.
    if (age <= 2 * HOUR) return ++recent <= 30 || v.name === newest
    if (v.name === newest) return true
    const tier = TIERS.find(t => age <= t.upTo)
    if (!tier) return false
    const key = `${tier.bucket}:${Math.floor(v.at / tier.bucket)}`
    const big = v.meta?.reason === 'bigChange'
    const here = buckets.get(key)
    buckets.set(key, { big: (here?.big ?? false) || big })
    return !here || (big && !here.big)
  })
  let kept = wanted.filter(Boolean).length
  const remove: string[] = []
  for (let i = newestFirst.length - 1; i >= 0; i -= 1) {
    const name = newestFirst[i].name
    if (!wanted[i]) remove.push(name)
    else if (kept > limits.perLocation && name !== newest) { remove.push(name); kept -= 1 }
  }
  return remove
}

/** The bounded preview of verified bytes: whole UTF-8 characters only, never past the limit. */
export function previewOf(bytes: Uint8Array, limit: number): Extract<VersionPreview, { status: 'ok' }> {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  const crlf = bytes.some((byte, i) => byte === 0x0d && bytes[i + 1] === 0x0a)
  try {
    decoder.decode(bytes)
  } catch {
    return { status: 'ok', text: null, length: bytes.length, shownBytes: 0, truncated: false, bom, crlf }
  }
  let end = Math.min(bytes.length, limit)
  while (end > 0 && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1
  return { status: 'ok', text: decoder.decode(bytes.subarray(0, end)), length: bytes.length, shownBytes: end, truncated: end < bytes.length, bom, crlf }
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** Format 1 exactly; any other format or field is not understood, so it is never listed or rewritten. */
export function parseVersionMeta(text: string): VersionMeta | null {
  try {
    const value = JSON.parse(text) as Record<string, unknown> | null
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const keys = Object.keys(value)
    if (keys.length !== META_KEYS.length || !META_KEYS.every(key => keys.includes(key))) return null
    const { format, capturedAt, reason, recordedPath, length, sha256 } = value
    const valid = format === 1 && isCount(capturedAt) && isCount(length) && REASONS.includes(reason as VersionReason)
      && typeof recordedPath === 'string' && safeRelative(recordedPath) && typeof sha256 === 'string' && SHA256.test(sha256)
    return valid
      ? { format: 1, capturedAt: capturedAt as number, reason: reason as VersionReason, recordedPath: recordedPath as string, length: length as number, sha256: sha256 as string }
      : null
  } catch {
    return null
  }
}

function fieldsOf(args: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new HistoryArgumentError('arguments must be an object')
  const actual = Object.keys(args)
  if (actual.length !== keys.length || !keys.every(key => actual.includes(key))) {
    throw new HistoryArgumentError(`arguments need exactly: ${keys.join(', ')}`)
  }
  return args as Record<string, unknown>
}
function textOf(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new HistoryArgumentError(`${name} must be a string`)
  return value
}
function nullableTextOf(value: unknown, name: string): string | null {
  return value === null ? null : textOf(value, name)
}
/** `<32 hex>/<version name>`, or null: like native, an id of another shape names no version. */
function versionIdOf(value: unknown): { loc: string; name: string } | null {
  const [loc, name, extra] = textOf(value, 'id').split('/')
  return extra === undefined && name !== undefined && LOCATION_KEY.test(loc) && versionTime(name) !== null ? { loc, name } : null
}
const randomHex = (length: number) =>
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(length / 2)), byte => byte.toString(16).padStart(2, '0')).join('')

// --- The commands ---------------------------------------------------------------------------

export interface PageHistoryOptions {
  limits?: Partial<HistoryLimits>
  now?: () => number
  sha256?: (bytes: Uint8Array) => string
  /** Runs maintenance off the save's path. */
  schedule?: (run: () => void) => void
}

export type PageHistory = ReturnType<typeof createPageHistory>

/** One process's page history over one store. Everything is synchronous, so callers never interleave. */
export function createPageHistory(store: HistoryStore, options: PageHistoryOptions = {}) {
  const limits: HistoryLimits = { ...HISTORY_LIMITS, ...options.limits }
  const now = options.now ?? Date.now
  const hash = options.sha256 ?? sha256Bytes
  const schedule = options.schedule ?? ((run: () => void) => { setTimeout(run, 0) })
  // In-process claims only: Node and the browser cannot take native's OS lock.
  const claimed = new Set<string>()
  // This process's last committed bytes per location, and its latest failed capture per vault.
  const lastWrite = new Map<string, string>()
  const failures = new Map<string, HistoryReason>()
  const maintained = new Map<string, number>()
  const fullReported = new Set<string>()

  const tryLock = (root: string) => !claimed.has(root) && Boolean(claimed.add(root))
  const validLocation = (location: StoredLocation) => {
    const recorded = location.recordedPath
    return recorded !== null && safeRelative(recorded) && locationKey(recorded, hash) === location.loc ? recorded : null
  }
  // Listed only when its own record names the page its location records.
  const listable = (location: StoredLocation) => {
    const recorded = validLocation(location)
    return recorded === null ? [] : location.versions.filter(v => v.meta?.recordedPath === recorded)
  }
  const newestOf = (versions: StoredVersion[]) =>
    versions.reduce<StoredVersion | null>((best, v) => (!best || v.at > best.at ? v : best), null)
  const unreadable = (inv: Inventory) => inv.locations.reduce((sum, l) => sum + l.versions.length - listable(l).length, 0)
  const room = (inv: Inventory) => inv.usedBytes < limits.budgetBytes && inv.versionCount < limits.versions
    && inv.locations.length < limits.locations && inv.tmp.length < limits.tmp

  function fits(inv: Inventory, loc: string, need: number): boolean {
    const location = inv.locations.find(l => l.loc === loc)
    return inv.usedBytes + need <= limits.budgetBytes && inv.versionCount + 1 <= limits.versions
      && (location ? location.versions.length + 1 <= limits.perLocation : inv.locations.length + 1 <= limits.locations)
      && inv.tmp.length + 1 <= limits.tmp
  }

  function prune(root: string, location: StoredLocation, most: number): void {
    for (const name of retentionPlan(location.versions, now(), limits).slice(0, most)) store.remove(root, location.loc, name)
  }

  function maintain(root: string): void {
    if (!tryLock(root)) return
    try {
      let inv = store.inventory(root, limits)
      // A count with a gap gives no authority to delete, nor does a recount that finds one.
      const recount = () => {
        inv = store.inventory(root, limits)
        return !inv.blocked
      }
      if (inv.blocked) return
      const at = now()
      let left = limits.maintenanceBatch
      const tmp = inv.tmp.filter(entry => entry.deleting || at - entry.at >= HOUR).slice(0, left)
      for (const entry of tmp) store.removeTmp(root, entry)
      left -= tmp.length
      // Count again after any cleanup, so freed room is never paid for with kept versions,
      // and what could not be cleaned still counts.
      if (tmp.length > 0 && !recount()) return
      const complete = () => inv.locations.filter(l => l.complete)
      const expired = complete().flatMap(l => retentionPlan(l.versions, at, limits).map(name => ({ loc: l.loc, name }))).slice(0, left)
      for (const { loc, name } of expired) store.remove(root, loc, name)
      left -= expired.length
      if (expired.length > 0 && !recount()) return
      // Still over: the oldest unprotected versions go first, across locations, counted once gone.
      let used = inv.usedBytes
      let count = inv.versionCount
      const rest = complete()
        .flatMap(location => {
          const newest = newestOf(listable(location))
          return location.versions.filter(v => v !== newest).map(v => ({ loc: location.loc, v }))
        })
        .sort((x, y) => x.v.at - y.v.at)
      for (const { loc, v } of rest) {
        if (left === 0 || (used < limits.budgetBytes && count < limits.versions)) break
        left -= 1
        if (store.remove(root, loc, v.name)) { used -= v.bytes; count -= 1 }
      }
      if (!recount()) return
      for (const location of inv.locations) {
        if (location.complete && location.versions.length === 0) store.removeLocation(root, location.loc)
      }
    } finally {
      claimed.delete(root)
    }
  }

  // At the first history use per run, at most daily, and after `full` was reported; never inline.
  function touch(root: string): void {
    const last = maintained.get(root)
    if (last !== undefined && now() - last < DAY && !fullReported.has(root)) return
    maintained.set(root, now())
    fullReported.delete(root)
    schedule(() => {
      try {
        maintain(root)
      } catch {
        // The next due run tries again.
      }
    })
  }

  function failed(root: string, reason: HistoryReason): HistoryNote {
    failures.set(root, reason)
    if (reason === 'full') { fullReported.add(root); touch(root) }
    return { status: 'notKept', reason }
  }

  function captureNow(vaultPath: string, page: string, before: Uint8Array, after: Uint8Array): HistoryNote | null {
    if (before.length === 0) return null
    if (before.length > limits.maxPageBytes) return { status: 'notKept', reason: 'tooLarge' }
    const spot = store.spot(vaultPath, page)
    if (!spot) return null
    const { root, recordedPath } = spot
    touch(root)
    if (!tryLock(root)) return failed(root, 'busy')
    try {
      // The inventory under the lock is the reservation; nothing is admitted before it completes.
      let inv = store.inventory(root, limits)
      if (inv.blocked) return failed(root, inv.blocked)
      const loc = locationKey(recordedPath, hash)
      let location = inv.locations.find(l => l.loc === loc)
      // A record here that names another page cannot hold this page's versions.
      if (location && location.recordedPath !== null && validLocation(location) !== recordedPath) return failed(root, 'unavailable')
      const beforeSha256 = hash(before)
      const versions = location ? listable(location).map(v => v.meta as VersionMeta) : []
      const at = now()
      const reason = keepReason({ versions, remembered: lastWrite.get(`${root}\n${loc}`), before, beforeSha256, after, now: at })
      if (reason === null || reason === 'duplicate') return null
      const meta = { format: 1, capturedAt: at, reason, recordedPath, length: before.length, sha256: beforeSha256 } as const
      const metaText = serializeVersionMeta(meta)
      // Exactly the bytes the writer persists, a missing location record included (§4).
      const record = !location || location.recordedPath === null ? serializeLocation(recordedPath) : null
      const versionBytes = before.length + encoder.encode(metaText).length
      const need = versionBytes + (record === null ? 0 : encoder.encode(record).length)
      if (!fits(inv, loc, need)) {
        if (location) prune(root, location, limits.pruneBatch)
        inv = store.inventory(root, limits)
        if (inv.blocked || !fits(inv, loc, need)) return failed(root, 'full')
        location = inv.locations.find(l => l.loc === loc)
      }
      const name = versionName(at, beforeSha256, randomHex(6))
      const written = store.write(root, loc, record, name, before, metaText)
      if (written !== 'kept') return failed(root, written)
      failures.delete(root)
      const kept: StoredVersion = { name, at, meta, bytes: versionBytes }
      prune(root, { loc, recordedPath, versions: [...(location?.versions ?? []), kept], complete: true }, limits.pruneBatch)
      return null
    } finally {
      claimed.delete(root)
    }
  }

  function health(root: string): HistoryHealth {
    const base = { budgetBytes: limits.budgetBytes }
    if (!tryLock(root)) return { ...base, state: 'unknown', reason: null, usedBytes: null, unreadable: 0, attention: [] }
    try {
      let inv: Inventory
      try {
        inv = store.inventory(root, limits)
      } catch {
        return { ...base, state: 'notKeeping', reason: 'unavailable', usedBytes: null, unreadable: 0, attention: ['.leadinglight/history'] }
      }
      const reason = inv.blocked ?? (room(inv) ? failures.get(root) ?? null : 'full')
      return {
        ...base,
        state: reason ? 'notKeeping' : 'on',
        reason,
        usedBytes: inv.blocked ? null : inv.usedBytes,
        unreadable: unreadable(inv),
        attention: inv.attention,
      }
    } finally {
      claimed.delete(root)
    }
  }

  // The identity a listed row needs (the name's time and hash prefix, the location's key and its own
  // record), then the whole payload against the request. A malformed request hash simply never matches.
  const verified = (id: { loc: string; name: string } | null, found: FoundVersion, sha256: string): found is FoundVersion & { meta: VersionMeta } => {
    const meta = found.meta
    return id !== null && meta !== null && meta.sha256 === sha256 && meta.length === found.bytes.length
      && meta.capturedAt === versionTime(id.name) && id.name.split('-')[1] === sha256.slice(0, 16)
      && found.location === meta.recordedPath && locationKey(meta.recordedPath, hash) === id.loc
      && hash(found.bytes) === sha256
  }
  const readId = (root: string, id: { loc: string; name: string } | null) => (id ? store.read(root, id.loc, id.name) : 'missing')

  const outsideVault = { status: 'refused', reason: 'outsideVault' } as const

  return {
    /** The S0 save's optional step between staging and recheck. Never throws; null asserts nothing. */
    capture({ vaultPath, page, before, after }: { vaultPath: string; page: string; before: Uint8Array; after: Uint8Array }): HistoryNote | null {
      try {
        return captureNow(vaultPath, page, before, after)
      } catch {
        const root = store.root(vaultPath)
        return root ? failed(root, 'unavailable') : { status: 'notKept', reason: 'unavailable' }
      }
    },
    /** Remembers what this process wrote, for `sessionStart` and `changedElsewhere`. */
    committed({ vaultPath, page, after }: { vaultPath: string; page: string; after: Uint8Array }): void {
      try {
        const spot = store.spot(vaultPath, page)
        if (spot) lastWrite.set(`${spot.root}\n${locationKey(spot.recordedPath, hash)}`, hash(after))
      } catch {
        // Only the next keep reason is affected.
      }
    },

    listPageVersions(args: unknown): VersionList {
      const fields = fieldsOf(args, ['vaultPath', 'path', 'cursor'])
      const spot = store.spot(textOf(fields.vaultPath, 'vaultPath'), textOf(fields.path, 'path'))
      const cursor = nullableTextOf(fields.cursor, 'cursor')
      if (!spot) return outsideVault
      const loc = locationKey(spot.recordedPath, hash)
      const after = cursor === null ? null : versionIdOf(cursor)
      if (cursor !== null && after?.loc !== loc) throw new HistoryArgumentError('cursor must be a version id of this location')
      const afterAt = after ? versionTime(after.name) ?? 0 : 0
      touch(spot.root)
      const location = store.inventory(spot.root, limits).locations.find(l => l.loc === loc)
      const rows = (location && validLocation(location) === spot.recordedPath ? listable(location) : [])
        .sort((x, y) => y.at - x.at || (y.name < x.name ? -1 : 1))
        .filter(v => !after || v.at < afterAt || (v.at === afterAt && v.name < after.name))
      const page = rows.slice(0, limits.pageSize)
      const row = (v: StoredVersion, meta: VersionMeta): VersionRow =>
        ({ id: `${loc}/${v.name}`, recordedPath: meta.recordedPath, capturedAt: meta.capturedAt, reason: meta.reason, length: meta.length, sha256: meta.sha256 })
      return {
        status: 'ok',
        versions: page.map(v => row(v, v.meta as VersionMeta)),
        nextCursor: rows.length > page.length ? `${loc}/${page[page.length - 1].name}` : null,
        health: health(spot.root),
      }
    },

    listSavedLocations(args: unknown): LocationList {
      const fields = fieldsOf(args, ['vaultPath', 'cursor'])
      const root = store.root(textOf(fields.vaultPath, 'vaultPath'))
      const cursor = nullableTextOf(fields.cursor, 'cursor')
      const after = cursor === null ? null : LOCATION_CURSOR.exec(cursor)
      if (cursor !== null && !after) throw new HistoryArgumentError('cursor must be <ms>-<32 hex>')
      if (!root) return outsideVault
      touch(root)
      const rows = store.inventory(root, limits).locations.flatMap(location => {
        const recordedPath = validLocation(location)
        const versions = listable(location)
        if (recordedPath === null || versions.length === 0) return []
        return [{ loc: location.loc, path: recordedPath, newestAt: Math.max(...versions.map(v => v.at)), count: versions.length }]
      })
        .sort((x, y) => y.newestAt - x.newestAt || (y.loc < x.loc ? -1 : 1))
        .filter(r => !after || r.newestAt < Number(after[1]) || (r.newestAt === Number(after[1]) && r.loc < after[2]))
      const page = rows.slice(0, limits.pageSize)
      return {
        status: 'ok',
        locations: page.map(r => ({ path: r.path, newestAt: r.newestAt, count: r.count, exists: store.exists(root, r.path) })),
        nextCursor: rows.length > page.length ? `${page[page.length - 1].newestAt}-${page[page.length - 1].loc}` : null,
      }
    },

    /** Shows nothing until the whole payload matches its row; then whole characters up to the limit. */
    readPageVersion(args: unknown): VersionPreview {
      const fields = fieldsOf(args, ['vaultPath', 'id', 'sha256'])
      const root = store.root(textOf(fields.vaultPath, 'vaultPath'))
      const id = versionIdOf(fields.id)
      const sha256 = textOf(fields.sha256, 'sha256')
      if (!root) return outsideVault
      touch(root)
      const found = readId(root, id)
      if (typeof found === 'string') return { status: found }
      return verified(id, found, sha256) ? previewOf(found.bytes, limits.previewBytes) : { status: 'damaged' }
    },

    savePageVersionAsCopy(args: unknown): VersionCopyOutcome {
      const fields = fieldsOf(args, ['vaultPath', 'id', 'sha256', 'folder', 'operationId'])
      const vaultPath = textOf(fields.vaultPath, 'vaultPath')
      const id = versionIdOf(fields.id)
      const sha256 = textOf(fields.sha256, 'sha256')
      const folder = nullableTextOf(fields.folder, 'folder')
      const operationId = textOf(fields.operationId, 'operationId')
      const root = store.root(vaultPath)
      if (!root) return outsideVault
      if (!UUID.test(operationId)) return { status: 'refused', reason: 'operationMismatch' }
      // Held from the source check through publication, so pruning cannot remove the bytes mid-copy.
      if (!tryLock(root)) return { status: 'refused', reason: 'busy' }
      try {
        // Verified first, retries included: a gone or changed source answers so, whatever was copied before.
        const found = readId(root, id)
        if (typeof found === 'string') return { status: 'refused', reason: found }
        if (!verified(id, found, sha256)) return { status: 'refused', reason: 'damaged' }
        return store.copy({
          vaultPath,
          root,
          operationId,
          args: hash(encoder.encode(JSON.stringify([fields.id, sha256, folder]))),
          contentSha256: sha256,
          folder,
          bytes: found.bytes,
          recordedPath: found.meta.recordedPath,
        })
      } catch {
        // A copy step that broke without an answer may already have published.
        return { status: 'uncertain', candidatePath: null }
      } finally {
        claimed.delete(root)
      }
    },

    pageHistoryHealth(args: unknown): HistoryHealth {
      const fields = fieldsOf(args, ['vaultPath'])
      const root = store.root(textOf(fields.vaultPath, 'vaultPath'))
      if (!root) throw new HistoryArgumentError('vaultPath is not a vault')
      touch(root)
      return health(root)
    },

    /** Background maintenance; exposed for the dev server's tests. */
    maintain: (vaultPath: string) => {
      const root = store.root(vaultPath)
      if (root) maintain(root)
    },
  }
}

export function runHistoryCommand(history: PageHistory, command: HistoryCommand, args: unknown): Promise<unknown> {
  return Promise.resolve().then(() => {
    switch (command) {
      case 'list_page_versions': return history.listPageVersions(args)
      case 'list_saved_locations': return history.listSavedLocations(args)
      case 'read_page_version': return history.readPageVersion(args)
      case 'save_page_version_as_copy': return history.savePageVersionAsCopy(args)
      case 'page_history_health': return history.pageHistoryHealth(args)
    }
  })
}

// --- The in-memory mock vault's history ------------------------------------------------------

export interface HistoryPages {
  read: (path: string) => string | undefined
  write: (path: string, content: string) => void
}

const trimSlash = (value: string) => value.replace(/\/+$/, '')
const parentOf = (page: string) => page.slice(0, Math.max(page.lastIndexOf('/'), 0)) || '/'
const hasParentStep = (target: string) => target.split('/').includes('..')
const copyName = (page: string, index: number) => {
  const name = page.slice(page.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `${name.slice(0, dot)}-${index}${name.slice(dot)}` : `${name}-${index}`
}

/**
 * The mock vault's history. Its writes cannot run out of space and nothing else shares it, so it
 * never answers `lowSpace`, `busy` or `unknown`. `usePages` binds the mock pages it copies into.
 */
export function createMemoryPageHistory(options: PageHistoryOptions = {}) {
  let pages: HistoryPages | null = null
  let homes: string[] = []
  type Location = { recordedPath: string; versions: Map<string, { meta: VersionMeta; payload: Uint8Array }> }
  const roots = new Map<string, Map<string, Location>>()
  const copies = new Map<string, { args: string; path: string }>()
  const homeOf = (root: string, target: string) => [root, ...homes].map(trimSlash)
    .find(home => home.startsWith('/') && (target === home || target.startsWith(`${home}/`)))
  const sizeOf = (text: string) => encoder.encode(text).length

  const store: HistoryStore = {
    root: vaultPath => (vaultPath.startsWith('/') ? trimSlash(vaultPath) : null),
    spot(vaultPath, page) {
      const home = hasParentStep(page) ? undefined : homeOf(vaultPath, parentOf(page))
      return home && page.startsWith(`${home}/`) ? { root: home, recordedPath: page.slice(home.length + 1) } : null
    },
    inventory(root, limits) {
      const locations: StoredLocation[] = [...(roots.get(root)?.entries() ?? [])].map(([loc, location]) => ({
        loc,
        recordedPath: location.recordedPath,
        complete: true,
        versions: [...location.versions].map(([name, v]) =>
          ({ name, at: v.meta.capturedAt, meta: v.meta, bytes: v.payload.length + sizeOf(serializeVersionMeta(v.meta)) })),
      }))
      const versionCount = locations.reduce((sum, l) => sum + l.versions.length, 0)
      const usedBytes = locations.reduce((sum, l) =>
        sum + sizeOf(serializeLocation(l.recordedPath ?? '')) + l.versions.reduce((s, v) => s + v.bytes, 0), 0)
      const over = versionCount > limits.versions || locations.length > limits.locations
        || locations.some(l => l.versions.length > limits.perLocation)
      return { usedBytes, versionCount, locations, tmp: [], attention: [], blocked: over ? 'full' : null }
    },
    write(root, loc, _location, name, payload, metaText) {
      const meta = parseVersionMeta(metaText)
      if (!meta) return 'unavailable'
      const byLoc = roots.get(root) ?? new Map<string, Location>()
      roots.set(root, byLoc)
      const location = byLoc.get(loc) ?? { recordedPath: meta.recordedPath, versions: new Map() }
      byLoc.set(loc, location)
      location.versions.set(name, { meta, payload: payload.slice() })
      return 'kept'
    },
    remove: (root, loc, name) => Boolean(roots.get(root)?.get(loc)?.versions.delete(name)),
    removeTmp: () => true,
    removeLocation(root, loc) {
      const location = roots.get(root)?.get(loc)
      return Boolean(location && location.versions.size === 0 && roots.get(root)?.delete(loc))
    },
    read(root, loc, name) {
      const location = roots.get(root)?.get(loc)
      const version = location?.versions.get(name)
      return location && version ? { bytes: version.payload.slice(), meta: version.meta, location: location.recordedPath } : 'missing'
    },
    exists: (root, recordedPath) => pages?.read(`${root}/${recordedPath}`) !== undefined,
    copy(job) {
      if (!pages) return { status: 'failed', message: 'The mock vault has no pages.' }
      const key = `${job.root}\n${job.operationId}`
      const recorded = copies.get(key)
      if (recorded) {
        if (recorded.args !== job.args) return { status: 'refused', reason: 'operationMismatch' }
        return pages.read(recorded.path) !== undefined
          ? { status: 'created', path: recorded.path, relativePath: recorded.path.slice(job.root.length + 1), durable: true }
          : { status: 'uncertain', candidatePath: recorded.path }
      }
      const page = `${job.root}/${job.recordedPath}`
      const folder = trimSlash(job.folder === null ? parentOf(page) : job.folder.startsWith('/') ? job.folder : `${job.root}/${job.folder}`)
      const home = hasParentStep(folder) ? undefined : homeOf(job.root, folder)
      if (!home || folder.split('/').some(part => part.startsWith('.leadinglight'))) return { status: 'refused', reason: 'outsideVault' }
      for (let index = 2; index <= 101; index += 1) {
        const path = `${folder}/${copyName(page, index)}`
        if (pages.read(path) !== undefined) continue
        pages.write(path, new TextDecoder().decode(job.bytes))
        copies.set(key, { args: job.args, path })
        return { status: 'created', path, relativePath: path.slice(home.length + 1), durable: true }
      }
      return { status: 'refused', reason: 'nameUnavailable' }
    },
  }

  return {
    ...createPageHistory(store, options),
    usePages(nextPages: HistoryPages, nextHomes: readonly string[]): void {
      pages = nextPages
      homes = [...nextHomes]
    },
  }
}

export type MemoryPageHistory = ReturnType<typeof createMemoryPageHistory>

/** The mock vault's one history, shared by its saves and its history commands. */
export const memoryPageHistory = createMemoryPageHistory()
