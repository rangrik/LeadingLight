// Backup and restore rules shared by the browser preview and the dev server's disk bridge.
// The path rule mirrors native `leadinglight_backup/rules.rs`; the cross-reader test keeps them equal.
import {
  BACKUP_COMMANDS,
  BACKUP_LIMITS,
  type BackupCommand,
  type BackupManifest,
  GAP_REASONS,
  type GapReason,
  MANIFEST_FORMAT,
  MANIFEST_VERSION,
  type Problem,
  type Sample,
  type Summary,
} from '../leadinglight/backup/backupContract.ts'

export const BACKUP_COMMAND_LIST: readonly BackupCommand[] = Object.values(BACKUP_COMMANDS)
export const isBackupCommand = (value: string): value is BackupCommand => (BACKUP_COMMAND_LIST as readonly string[]).includes(value)

const encoder = new TextEncoder()
export const byteLength = (text: string) => encoder.encode(text).length
const MAX_SAFE = Number.MAX_SAFE_INTEGER
const SHA256 = /^[0-9a-f]{64}$/
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export const isOperationId = (value: string) => UUID_V4.test(value)
export const isSha256 = (value: string) => SHA256.test(value)

// --- Path rule (rules.rs) ---------------------------------------------------------------------

// Rust's `char::is_control`: general category Cc.
const CONTROL = /\p{Cc}/u
// Rust's `str::trim`: Unicode White_Space, which JavaScript's `trim` does not match exactly.
const WHITE = '\u0009\u000a\u000b\u000c\u000d \u0085                 　'
export function rustTrim(text: string): string {
  let start = 0
  let end = text.length
  while (start < end && WHITE.includes(text[start])) start += 1
  while (end > start && WHITE.includes(text[end - 1])) end -= 1
  return text.slice(start, end)
}

/** One name: not empty, not `.` or `..`, and nothing read as a separator, drive or terminator. */
export const segmentOk = (segment: string) =>
  segment !== '' && segment !== '.' && segment !== '..' && !/[/\\:]/.test(segment) && !CONTROL.test(segment)

export type PathFault = 'notText' | 'tooLong' | 'tooDeep'
/** Native's check order: byte length, then depth, then each name. */
export function checkPath(path: string): PathFault | null {
  if (byteLength(path) > BACKUP_LIMITS.pathBytes) return 'tooLong'
  const segments = path.split('/')
  if (segments.length > BACKUP_LIMITS.pathSegments) return 'tooDeep'
  if (path === '' || !segments.every(segmentOk)) return 'notText'
  return null
}

const hexOf = (text: string, length: number) => text.length === length && /^[0-9a-f]+$/.test(text)
export const STORE = '.leadinglight'
const versionName = (name: string) => {
  const parts = name.split('-')
  return parts.length === 3 && /^[0-9]{1,16}$/.test(parts[0]) && hexOf(parts[1], 16) && hexOf(parts[2], 6)
}

// Rust's `eq_ignore_ascii_case`: only A-Z fold, so no other letter can pose as a reserved name.
const asciiLower = (text: string) => text.replace(/[A-Z]/g, c => c.toLowerCase())
const sameName = (a: string, b: string) => asciiLower(a) === asciiLower(b)
const startsLike = (segment: string, prefix: string) => asciiLower(segment.slice(0, prefix.length)) === prefix

export type PathClass = 'user' | 'version' | 'excluded'
/** Reserved names match in any letter case, as a case-insensitive disk resolves them (rules.rs `classify`). */
export function classifyPath(path: string): PathClass {
  const segments = path.split('/')
  if (segments.some(segment => sameName(segment, '.git') || startsLike(segment, '.leadinglight-'))) return 'excluded'
  if (sameName(path, '.laputa-cache.json') || sameName(segments[segments.length - 1], '.DS_Store')) return 'excluded'
  if (!sameName(segments[0], STORE)) return 'user'
  // Only the exact store spelling carries versions; any other spelling is excluded whole.
  if (segments[0] !== STORE) return 'excluded'
  const [, history, versions, loc, name, file, ...rest] = segments
  if (history !== 'history' || versions !== 'versions' || !hexOf(loc ?? '', 32) || rest.length > 0) return 'excluded'
  if (name === 'location.json' && file === undefined) return 'version'
  return versionName(name ?? '') && (file === 'payload' || file === 'version.json') ? 'version' : 'excluded'
}
/** A folder the walk never enters: excluded by rule, or the store, which history exports. */
export const skipDir = (path: string) => sameName(path, STORE) || classifyPath(path) === 'excluded'

/** A restore folder name: one plain component. */
export const nameOk = (name: string) =>
  name !== '' && byteLength(name) <= BACKUP_LIMITS.restoreNameBytes && segmentOk(name) && !name.startsWith('.') && rustTrim(name) === name

/** A folder name derived from the workspace, safe on any disk (rules.rs `display_name`). */
export function displayName(raw: string): string {
  const cleaned = [...raw].map(c => (c === '/' || c === '\\' || c === ':' ? '-' : CONTROL.test(c) ? ' ' : c)).join('')
  const trimmed = rustTrim(rustTrim(cleaned).replace(/^\.+/, ''))
  let name = ''
  for (const c of trimmed) {
    if (byteLength(name + c) > 120) break
    name += c
  }
  name = rustTrim(`x${name}`).slice(1)
  return name === '' ? 'Workspace' : name
}

/** A display path never longer than the path limit, cut at a character boundary. */
export function boundedText(text: string, limit: number = BACKUP_LIMITS.pathBytes): string {
  if (byteLength(text) <= limit) return text
  let out = ''
  for (const c of text) {
    if (byteLength(out + c) > limit) break
    out += c
  }
  return out
}

// --- Summaries --------------------------------------------------------------------------------

/** Counts every reason and keeps the first few samples, so no answer grows with the input. */
export class Tally<R extends string> {
  private readonly summary: Summary<R> = { total: 0, counts: {}, sample: [] }
  add(reason: R, path: string | null): void {
    this.summary.total += 1
    this.summary.counts[reason] = (this.summary.counts[reason] ?? 0) + 1
    if (this.summary.sample.length < BACKUP_LIMITS.samples) {
      this.summary.sample.push({ path: path === null ? null : boundedText(path), reason } as Sample<R>)
    }
  }
  get total(): number { return this.summary.total }
  result(): Summary<R> { return { total: this.summary.total, counts: { ...this.summary.counts }, sample: [...this.summary.sample] } }
}
export const oneProblem = (problem: Problem, path: string | null): Summary<Problem> => {
  const tally = new Tally<Problem>()
  tally.add(problem, path)
  return tally.result()
}

// --- Strict JSON ------------------------------------------------------------------------------

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
class JsonError extends Error {}

/** As strict as serde reading the manifest: no duplicate keys, whole numbers only, no lone surrogates, bounded depth. */
export function parseStrictJson(text: string, maxDepth = 8): Json {
  let at = 0
  const fail = (): never => { throw new JsonError(`invalid JSON at ${at}`) }
  const space = () => { while (at < text.length && ' \t\n\r'.includes(text[at])) at += 1 }
  const expect = (char: string) => { if (text[at] !== char) fail(); at += 1 }
  function string(): string {
    expect('"')
    let out = ''
    for (;;) {
      if (at >= text.length) fail()
      const char = text[at]
      if (char === '"') { at += 1; break }
      if (char < ' ') fail()
      if (char !== '\\') { out += char; at += 1; continue }
      const escaped = text[at + 1]
      at += 2
      const simple: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }
      if (escaped in simple) { out += simple[escaped]; continue }
      if (escaped !== 'u') fail()
      const unit = (): number => {
        const hex = text.slice(at, at + 4)
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail()
        at += 4
        return parseInt(hex, 16)
      }
      const high = unit()
      if (high >= 0xdc00 && high <= 0xdfff) fail()
      if (high >= 0xd800 && high <= 0xdbff) {
        if (text.slice(at, at + 2) !== '\\u') fail()
        at += 2
        const low = unit()
        if (low < 0xdc00 || low > 0xdfff) fail()
        out += String.fromCharCode(high, low)
      } else out += String.fromCharCode(high)
    }
    // A raw lone surrogate cannot come from valid UTF-8, but a decoded string is checked anyway.
    if (/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(out)) fail()
    return out
  }
  function value(depth: number): Json {
    if (depth > maxDepth) fail()
    space()
    const char = text[at]
    if (char === '{') {
      at += 1
      const out: { [key: string]: Json } = {}
      space()
      if (text[at] === '}') { at += 1; return out }
      for (;;) {
        space()
        const key = string()
        if (Object.hasOwn(out, key)) fail()
        space()
        expect(':')
        Object.defineProperty(out, key, { value: value(depth + 1), enumerable: true, writable: true, configurable: true })
        space()
        if (text[at] === ',') { at += 1; continue }
        expect('}')
        return out
      }
    }
    if (char === '[') {
      at += 1
      const out: Json[] = []
      space()
      if (text[at] === ']') { at += 1; return out }
      for (;;) {
        out.push(value(depth + 1))
        space()
        if (text[at] === ',') { at += 1; continue }
        expect(']')
        return out
      }
    }
    if (char === '"') return string()
    for (const [word, result] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(word, at)) { at += word.length; return result }
    }
    // Non-negative integers only: every manifest number is a count, a size or a time.
    const digits = /^(0|[1-9][0-9]{0,19})(?![0-9.eE+-])/.exec(text.slice(at, at + 22))?.[0] ?? fail()
    at += digits.length
    return Number(digits)
  }
  const result = value(0)
  space()
  if (at !== text.length) fail()
  return result
}

// --- Manifest ---------------------------------------------------------------------------------

const MANIFEST_KEYS = [
  'format', 'version', 'appVersion', 'createdAt', 'workspaceName', 'status', 'files', 'gaps',
  'gapsTotal', 'versionsSkipped', 'trashItemsNotIncluded', 'totalFiles', 'totalBytes',
] as const
const NUMBER_KEYS = ['gapsTotal', 'versionsSkipped', 'trashItemsNotIncluded', 'totalFiles', 'totalBytes'] as const
const FILE_KEYS = ['path', 'bytes', 'sha256', 'modifiedMs'] as const
const GAP_KEYS = ['path', 'reason'] as const
/** RFC 3339 in UTC, as native's `time_ok`: a `Z` time of at most 64 characters. */
const CREATED_AT = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(\.\d+)?Z$/
/** manifest.rs `MAX_TEXT`: the longest app version text. */
const MAX_TEXT = 256

const isObject = (value: Json | undefined): value is { [key: string]: Json } =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const exactKeys = (value: { [key: string]: Json }, keys: readonly string[]) => {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key))
}
/** A JSON number the strict reader accepted: always a non-negative integer, maybe past 2^53. */
const isInteger = (value: Json | undefined): value is number => typeof value === 'number'
const safe = (value: number) => value <= MAX_SAFE

function validCreatedAt(text: string): boolean {
  const match = text.length <= 64 ? CREATED_AT.exec(text) : null
  if (!match) return false
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    && hour < 24 && minute < 60 && second <= 60
}

/** The shape serde accepts for `Manifest` with `deny_unknown_fields`: exact keys and types. */
function shaped(value: { [key: string]: Json }): value is { [key: string]: Json } & {
  appVersion: string; createdAt: string; workspaceName: string; status: 'complete' | 'incomplete'
  files: Array<{ path: string; bytes: number; sha256: string; modifiedMs: number }>
  gaps: Array<{ path: string; reason: GapReason }>
} {
  if (!exactKeys(value, MANIFEST_KEYS)) return false
  const { appVersion, createdAt, workspaceName, status, files, gaps } = value
  if (typeof appVersion !== 'string' || typeof createdAt !== 'string' || typeof workspaceName !== 'string') return false
  if (status !== 'complete' && status !== 'incomplete') return false
  if (!NUMBER_KEYS.every(key => isInteger(value[key]))) return false
  if (!Array.isArray(files) || !Array.isArray(gaps)) return false
  const fileOk = (file: Json) => isObject(file) && exactKeys(file, FILE_KEYS) && typeof file.path === 'string'
    && isInteger(file.bytes) && typeof file.sha256 === 'string' && isInteger(file.modifiedMs)
  const gapOk = (gap: Json) => isObject(gap) && exactKeys(gap, GAP_KEYS) && typeof gap.path === 'string'
    && typeof gap.reason === 'string' && (GAP_REASONS as readonly string[]).includes(gap.reason)
  return files.every(fileOk) && gaps.every(gapOk)
}

export type ManifestCheck =
  | { ok: true; manifest: BackupManifest }
  | { ok: false; problems: Summary<Problem> }

/** As native `manifest::parse`: the version first, then shape, limits, sums and paths, every problem reported. */
export function validateManifest(bytes: Uint8Array): ManifestCheck {
  const only = (problem: Problem): ManifestCheck => ({ ok: false, problems: oneProblem(problem, null) })
  if (bytes.length > BACKUP_LIMITS.manifestBytes) return only('manifestTooLarge')
  let value: Json
  try {
    value = parseStrictJson(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes))
  } catch {
    return only('manifestInvalid')
  }
  if (!isObject(value) || value.format !== MANIFEST_FORMAT) return only('manifestInvalid')
  if (value.version !== undefined && !isInteger(value.version)) return only('manifestInvalid')
  if (value.version !== MANIFEST_VERSION) return only('unsupportedVersion')
  if (!shaped(value)) return only('manifestInvalid')

  const { files, gaps } = value
  const problems = new Tally<Problem>()
  const pathBytes = files.reduce((sum, file) => sum + byteLength(file.path), 0)
  if (files.length > BACKUP_LIMITS.entries || pathBytes > BACKUP_LIMITS.totalPathBytes) return only('tooLarge')
  const gapsTotal = value.gapsTotal as number
  const headerOk = byteLength(value.appVersion) <= MAX_TEXT
    && validCreatedAt(value.createdAt)
    && nameOk(value.workspaceName)
    && NUMBER_KEYS.every(key => safe(value[key] as number))
    && gaps.length <= BACKUP_LIMITS.manifestGaps
    && gaps.length <= gapsTotal
    && (gapsTotal > BACKUP_LIMITS.manifestGaps || gaps.length === gapsTotal)
    && gaps.every(gap => byteLength(gap.path) <= BACKUP_LIMITS.pathBytes)
    && (value.status === 'complete') === (gapsTotal === 0)
    && value.totalFiles === files.length
  if (!headerOk) problems.add('manifestInvalid', null)

  let total = 0
  const seen = new Set<string>()
  for (const file of files) {
    total += file.bytes
    if (!safe(file.bytes) || !safe(file.modifiedMs) || !SHA256.test(file.sha256)) problems.add('manifestInvalid', file.path)
    if (checkPath(file.path) !== null || classifyPath(file.path) === 'excluded') problems.add('badPath', file.path)
    else if (seen.has(file.path)) problems.add('duplicatePath', file.path)
    else seen.add(file.path)
  }
  if (total !== value.totalBytes || !safe(total)) problems.add('manifestInvalid', null)
  // A listed file that is also a folder above another listed file.
  for (const file of files) {
    const segments = file.path.split('/')
    if (segments.slice(1).some((_, depth) => seen.has(segments.slice(0, depth + 1).join('/')))) problems.add('pathConflict', file.path)
  }
  if (problems.total > 0) return { ok: false, problems: problems.result() }
  return {
    ok: true,
    manifest: {
      format: MANIFEST_FORMAT, version: MANIFEST_VERSION, appVersion: value.appVersion, createdAt: value.createdAt,
      workspaceName: value.workspaceName, status: value.status, files: files.map(file => ({ ...file })),
      gaps: gaps.map(gap => ({ ...gap })), gapsTotal, versionsSkipped: value.versionsSkipped as number,
      trashItemsNotIncluded: value.trashItemsNotIncluded as number, totalFiles: files.length, totalBytes: total,
    },
  }
}

/** The manifest's text, fields in the contract's order, compact with a final newline, as native writes it. */
export const serializeManifest = (manifest: BackupManifest) => `${JSON.stringify({
  format: manifest.format, version: manifest.version, appVersion: manifest.appVersion, createdAt: manifest.createdAt,
  workspaceName: manifest.workspaceName, status: manifest.status,
  files: manifest.files.map(file => ({ path: file.path, bytes: file.bytes, sha256: file.sha256, modifiedMs: file.modifiedMs })),
  gaps: manifest.gaps.map(gap => ({ path: gap.path, reason: gap.reason })),
  gapsTotal: manifest.gapsTotal, versionsSkipped: manifest.versionsSkipped, trashItemsNotIncluded: manifest.trashItemsNotIncluded,
  totalFiles: manifest.totalFiles, totalBytes: manifest.totalBytes,
})}\n`

/** `YYYY-MM-DDTHH:MM:SSZ`, whole seconds in UTC. */
export const isoSeconds = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z')

// --- Arguments --------------------------------------------------------------------------------

/** A malformed argument object. Native answers `Err`, which the UI treats as no reply. */
export class BackupArgumentError extends Error {}

const ARG_KEYS: Record<BackupCommand, readonly string[]> = {
  [BACKUP_COMMANDS.startBackup]: ['operationId', 'vaultPath', 'destination'],
  [BACKUP_COMMANDS.startInspection]: ['operationId', 'backupPath'],
  [BACKUP_COMMANDS.startRestore]: ['operationId', 'backupPath', 'manifestSha256', 'parent', 'name'],
  [BACKUP_COMMANDS.getOperation]: ['operationId'],
  [BACKUP_COMMANDS.cancelOperation]: ['operationId'],
}

/** Exactly the command's fields, every one a string. */
export function argsOf(command: BackupCommand, args: unknown): Record<string, string> {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new BackupArgumentError('arguments must be an object')
  const keys = ARG_KEYS[command]
  const actual = Object.keys(args)
  if (actual.length !== keys.length || !keys.every(key => actual.includes(key))) {
    throw new BackupArgumentError(`arguments need exactly: ${keys.join(', ')}`)
  }
  for (const key of keys) {
    if (typeof Reflect.get(args, key) !== 'string') throw new BackupArgumentError(`${key} must be a string`)
  }
  return args as Record<string, string>
}

/** Bounded counts never exceed the safe integer range in any sum the bridge makes. */
export const safeAdd = (a: number, b: number) => Math.min(a + b, MAX_SAFE)

// --- The in-memory preview --------------------------------------------------------------------

/** The mock vault has no disk: nothing starts, nothing is known, nothing cancels. Never a fake success. */
export function runMemoryBackup(command: BackupCommand, args: unknown): unknown {
  argsOf(command, args)
  if (command === BACKUP_COMMANDS.getOperation) return { state: 'unknown' }
  if (command === BACKUP_COMMANDS.cancelOperation) return { accepted: false }
  return { status: 'refused', reason: 'unavailable' }
}
