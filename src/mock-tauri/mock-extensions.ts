// E1 extension commands for the browser: one model of the native package store, sessions and
// guarded create (src-tauri/src/leadinglight_extensions), answering the frozen contract
// (extensionApi.ts, proposalContract.ts) with the frozen TypeScript validator. It runs over a host:
// in memory for the mock vault (memoryHost), or on synthetic disk fixtures through the dev vault
// server (scripts/vault-api-extensions.ts). Browser parity is test infrastructure, never native
// authority. Pure: no DOM, Node, React or invoke, so the dev server and the page share it.
import {
  EXTENSION_COMMANDS,
  type ActivationRefusal, type ActivationReply, type CloseSessionReply, type DeactivationReply, type EndRunReply,
  type ExtensionListReply, type FolderHandleReply, type HandleRefusal, type ImportCandidateReply, type InstalledExtension,
  type OpenSessionReply, type ReadExtensionReply, type RunAdmission, type RunAdmissionRefusal,
} from '../leadinglight/extensions/extensionApi.ts'
import {
  E1_HOST_CAPABILITIES, EXTENSION_LIMITS, EXTENSION_SCHEMA, RESERVED_PACKAGE_ID_PREFIX, type Capability, type ExtensionPackage,
} from '../leadinglight/extensions/extensionContract.ts'
import { commandCapabilities, parseExtensionPackage, utf8Bytes } from '../leadinglight/extensions/extensionSchema.ts'
import {
  PROPOSAL_COMMANDS, PROPOSAL_LIMITS, isOpaqueToken,
  type CreateProposal, type GuardedProposal, type ProposalQueryReply, type ProposalReceipt, type ProposalRefusal,
} from '../leadinglight/proposals/proposalContract.ts'
import { sha256Hex } from '../leadinglight/saveOutcome.ts'

export const EXTENSION_BRIDGE_COMMANDS: readonly string[] = [
  ...Object.values(EXTENSION_COMMANDS), PROPOSAL_COMMANDS.submit, PROPOSAL_COMMANDS.query,
]
const BRIDGE_COMMAND_SET = new Set(EXTENSION_BRIDGE_COMMANDS)
export const isExtensionCommand = (command: string) => BRIDGE_COMMAND_SET.has(command)

/** The native bounds (store.rs, runs.rs), so a browser check meets the same refusals. */
export const BRIDGE_LIMITS = {
  /** Opening another session in the same owner closes its oldest one. */
  sessionsPerOwner: 8,
  /** Request keys a session remembers; an end that cannot keep its key seals the session. */
  keysPerSession: 256,
  /** Admitted runs not yet ended, counting admissions still checking their package. */
  liveRunsPerSession: 16,
  foldersPerRun: 8,
  /** Operation ids this process answers for; none is ever dropped, so new ones then answer busy. */
  operations: 1024,
  recentlyClosed: 256,
  versionsPerPackage: 8,
  storedVersions: 64,
  /** Vaults with remembered activation; one with nothing active is forgotten first. */
  vaults: 64,
  /** UTF-8 bytes of a vault key, its resolved path. */
  vaultKeyBytes: 4096,
  /** Folder entries one look at the package folder reads; a folder with more takes no new file. */
  packageScan: 256,
  preferencesBytes: 4 * 1024 * 1024,
  /** Native MAX_SEQ: sequence numbers stay exact and never wrap. */
  sequence: 2 ** 53,
} as const

/** A malformed argument. Native answers `Err`, which the frontend reads as no reply. */
export class ExtensionArgumentError extends Error {}

// --- Hosts -----------------------------------------------------------------------------------------

export interface VaultRoots { readonly requested: string; readonly canonical: string }
/** `identity` names the folder itself, so a folder replaced at the same path differs. */
export interface BoundFolder { readonly path: string; readonly identity: string; readonly relative: string }
export type FolderLookup = { readonly ok: true; readonly folder: BoundFolder } | { readonly ok: false; readonly reason: HandleRefusal }
/**
 * One exclusive creation. `unavailable`: nothing was published (the folder is gone, or staging
 * failed). `moved`: the bound folder is no longer the same folder; nothing was published. `busy`:
 * another writer holds the page. `uncertain`: a publication that cannot be proven either way.
 */
export type PageWrite =
  | { readonly status: 'created'; readonly durable: boolean }
  | { readonly status: 'exists' | 'unavailable' | 'moved' | 'busy' | 'uncertain' }
/** `unusable`: present but unreadable, too large, not a plain file or not UTF-8. */
export type PreferencesRead = { readonly status: 'missing' | 'unusable' } | { readonly status: 'text'; readonly text: string }
/** `unsynced`: published, but the folder sync failed, so it may not survive power loss. */
export type Publication = 'synced' | 'unsynced' | 'notPublished'
/** Package file hashes among at most the scanned entries; `complete` when none were left unread. */
export interface BlobScan { readonly hashes: readonly string[]; readonly complete: boolean }

/** Storage and vault effects. Packages and preferences never live in a vault. */
export interface ExtensionHost {
  /** The exact text of each package shipped with the app, off until turned on in a vault. */
  readonly bundled: readonly string[]
  sha256(text: string): Promise<string>
  /** The stored text, or null when missing, not a plain file or too large. */
  readBlob(sha: string): Promise<string | null>
  /** Puts exactly `text` at the hash in one step; false when nothing was published. */
  writeBlob(sha: string, text: string): Promise<boolean>
  /** True when no file is left at the hash. */
  deleteBlob(sha: string): Promise<boolean>
  scanBlobs(limit: number): Promise<BlobScan | null>
  readPreferences(maxBytes: number): Promise<PreferencesRead>
  writePreferences(text: string): Promise<Publication>
  setPreferencesAside(): Promise<void>
  /** A vault this host may serve, resolved now; null answers `vaultUnavailable`. */
  vaultRoots(vaultPath: string): Promise<VaultRoots | null>
  resolveFolder(canonicalRoot: string, folder: string): Promise<FolderLookup>
  /** Exclusive creation of exactly `content`, rechecking the folder before and after staging. */
  createPage(vault: VaultRoots, folder: BoundFolder, fileName: string, content: string): Promise<PageWrite>
  /** The page path as the vault was requested, so it matches the app's own entries. */
  pagePath(vault: VaultRoots, folder: BoundFolder, fileName: string): string
  warn(message: string): void
}

/** Vault-relative segments as the native folder check reads them, or null for an escape. */
export function folderSegments(folder: string): string[] | null {
  if (folder.includes('\0') || folder.startsWith('/')) return null
  const segments: string[] = []
  for (const [index, segment] of folder.split('/').entries()) {
    // Like Rust's Path::components: empty parts and inner `.` vanish; a leading `.` stays.
    if (segment === '' || (segment === '.' && index > 0)) continue
    if (segment.startsWith('.')) return null
    segments.push(segment)
  }
  return segments
}

// --- Small rules -----------------------------------------------------------------------------------

type Fields = Record<string, unknown>
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value)
const own = (fields: Fields, key: string): unknown => (Object.hasOwn(fields, key) ? Reflect.get(fields, key) : undefined)
const hasKeys = (fields: Fields, keys: readonly string[]) =>
  Object.keys(fields).length === keys.length && keys.every(key => Object.hasOwn(fields, key))
const notNull = <T>(value: T | null): value is T => value !== null
const SHA256 = /^[0-9a-f]{64}$/
const isSha256 = (value: unknown): value is string => typeof value === 'string' && SHA256.test(value)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** Native's `is_uuid`: only the canonical lowercase form, so one id never names two operations. */
export const isCanonicalUuid = (value: string) => UUID.test(value)
const isReserved = (packageId: string) => packageId.startsWith(RESERVED_PACKAGE_ID_PREFIX)
const missingOf = (capabilities: readonly Capability[]) => capabilities.filter(capability => !E1_HOST_CAPABILITIES.includes(capability))

function isWellFormed(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index++
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false
  }
  return true
}

/** A string argument as native reads it: anything else, or text Rust cannot hold, is no argument. */
function readText(args: Fields, key: string): string {
  const value = own(args, key)
  if (typeof value !== 'string' || !isWellFormed(value)) throw new ExtensionArgumentError(`Missing or unreadable ${key}`)
  return value
}

function readOptionalText(args: Fields, key: string): string | null {
  const value = own(args, key)
  return value === undefined || value === null ? null : readText(args, key)
}

const PROPOSAL_KEYS = {
  create: ['kind', 'operationId', 'runId', 'content', 'contentSha256', 'folderHandle', 'fileName'],
  append: ['kind', 'operationId', 'runId', 'content', 'contentSha256', 'documentHandle', 'expectedSha256'],
} as const

/** Read as strictly as the native command reads it: exact keys, every value a string. */
export function readProposal(value: unknown): GuardedProposal {
  const unreadable = () => new ExtensionArgumentError('The proposal could not be read.')
  if (!isFields(value)) throw unreadable()
  const kind = own(value, 'kind')
  if (kind !== 'create' && kind !== 'append') throw unreadable()
  const keys: readonly string[] = PROPOSAL_KEYS[kind]
  const text = (key: string) => readText(value, key)
  if (!hasKeys(value, keys)) throw unreadable()
  const base = { operationId: text('operationId'), runId: text('runId'), content: text('content'), contentSha256: text('contentSha256') }
  return kind === 'create'
    ? { kind, ...base, folderHandle: text('folderHandle'), fileName: text('fileName') }
    : { kind, ...base, documentHandle: text('documentHandle'), expectedSha256: text('expectedSha256') }
}

/** Every field of the request in a fixed order, so no two requests share a digest. */
const proposalFields = (proposal: CreateProposal) =>
  ['create', proposal.operationId, proposal.runId, proposal.content, proposal.contentSha256, proposal.folderHandle, proposal.fileName]

const WINDOWS_RESERVED = new Set(['CON', 'PRN', 'AUX', 'NUL', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap(n => [`COM${n}`, `LPT${n}`])])
/** Rust's `char::is_whitespace`, which the native name check trims with. */
const isRustSpace = (code: number) => (code >= 0x09 && code <= 0x0d) || code === 0x20 || code === 0x85 || code === 0xa0
  || code === 0x1680 || (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029 || code === 0x202f
  || code === 0x205f || code === 0x3000
const isControl = (code: number) => code <= 0x1f || (code >= 0x7f && code <= 0x9f)
const asciiUpper = (text: string) => text.replace(/[a-z]/g, letter => letter.toUpperCase())

/** Native `valid_file_name`: one portable, visible stem ending in `.md`, at most 255 bytes. */
export function validFileName(name: string): boolean {
  if (!name.endsWith('.md') || utf8Bytes(name) > PROPOSAL_LIMITS.fileNameBytes) return false
  const stem = name.slice(0, -3)
  const codes = Array.from(stem, character => character.codePointAt(0) ?? 0)
  const first = codes.at(0)
  const last = codes.at(-1)
  if (first === undefined || last === undefined || stem.startsWith('.') || isRustSpace(first) || isRustSpace(last)) return false
  if (Array.from(name).some(character => isControl(character.codePointAt(0) ?? 0))) return false
  if (stem.endsWith('.') || Array.from(stem).some(character => '<>:"/\\|?*'.includes(character))) return false
  return !WINDOWS_RESERVED.has(asciiUpper(stem.split('.').at(0) ?? stem))
}

// --- Preferences -----------------------------------------------------------------------------------

/** One stored version; names and versions only, never note text. */
interface Imported { readonly packageSha256: string; readonly packageId: string; readonly version: string; readonly name: string; readonly seq: number }
interface VaultEntry { touched: number; readonly active: Map<string, string>; readonly previous: Map<string, string> }
interface Preferences { nextSeq: number; imports: Imported[]; readonly vaults: Map<string, VaultEntry> }

/** A package version this app ships; besides a stored import, the only kind a vault may name. */
interface Identity { readonly packageId: string; readonly sha256: string }

const PREFERENCE_KEYS = ['format', 'nextSeq', 'imports', 'vaults']
const IMPORT_KEYS = ['packageSha256', 'packageId', 'version', 'name', 'seq']
const ENTRY_KEYS = ['touched', 'active', 'previous']
const isSeq = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= BRIDGE_LIMITS.sequence

/** The smallest valid package, so identity fields are judged by the frozen validator itself. */
const IDENTITY_PACKAGE = {
  schema: EXTENSION_SCHEMA, id: '', version: '', name: '', description: 'Identity check.', capabilities: ['document.create'],
  commands: [{
    id: 'check', title: 'Check', steps: [
      { id: 'where', op: 'resolveDestination', policy: 'newInChosenFolder' },
      { id: 'note', op: 'composeDocument', title: ['Note'], blocks: [{ type: 'paragraph', text: ['Note'] }] },
      { id: 'create', op: 'proposeDocument' },
    ],
  }],
}

/** Native `valid_identity`: exactly the id, version and name a package may have. */
function validIdentity(id: string, version: string, name: string): boolean {
  return parseExtensionPackage(JSON.stringify({ ...IDENTITY_PACKAGE, id, version, name })).status === 'valid'
}

const emptyEntry = (): VaultEntry => ({ touched: 0, active: new Map(), previous: new Map() })
const copyOf = (preferences: Preferences): Preferences => ({
  nextSeq: preferences.nextSeq,
  imports: [...preferences.imports],
  vaults: new Map([...preferences.vaults].map(([key, entry]) =>
    [key, { touched: entry.touched, active: new Map(entry.active), previous: new Map(entry.previous) }])),
})

/**
 * Native `take_seq`: the next sequence number, or null once none is left; it never wraps. Compared
 * before adding, since 2^53 + 1 is not a distinct double.
 */
function takeSeq(preferences: Preferences): number | null {
  if (preferences.nextSeq >= BRIDGE_LIMITS.sequence) return null
  const seq = preferences.nextSeq
  preferences.nextSeq += 1
  return seq
}

function serialize(preferences: Preferences): string {
  const vaults = Object.fromEntries([...preferences.vaults].map(([key, entry]) =>
    [key, { touched: entry.touched, active: Object.fromEntries(entry.active), previous: Object.fromEntries(entry.previous) }]))
  return JSON.stringify({ format: 1, nextSeq: preferences.nextSeq, imports: preferences.imports, vaults }, null, 2)
}

const isVaultKey = (key: string) => key !== '' && !key.includes('\0') && isWellFormed(key) && utf8Bytes(key) <= BRIDGE_LIMITS.vaultKeyBytes

function importOf(value: unknown, nextSeq: number): Imported | null {
  if (!isFields(value) || !hasKeys(value, IMPORT_KEYS)) return null
  const [packageSha256, packageId, version, name, seq] = IMPORT_KEYS.map(key => own(value, key))
  if (!isSha256(packageSha256) || !isSeq(seq) || seq >= nextSeq) return null
  if (typeof packageId !== 'string' || typeof version !== 'string' || typeof name !== 'string' || isReserved(packageId)) return null
  return validIdentity(packageId, version, name) ? { packageSha256, packageId, version, name, seq } : null
}

function importsOf(value: unknown, nextSeq: number): Imported[] | null {
  if (!Array.isArray(value) || value.length > BRIDGE_LIMITS.storedVersions) return null
  const imports = value.map(item => importOf(item, nextSeq))
  if (!imports.every(notNull)) return null
  const perPackage = new Map<string, number>()
  for (const item of imports) perPackage.set(item.packageId, (perPackage.get(item.packageId) ?? 0) + 1)
  const unique = new Set(imports.map(item => item.packageSha256)).size === imports.length
    && new Set(imports.map(item => item.seq)).size === imports.length
  return unique && [...perPackage.values()].every(count => count <= BRIDGE_LIMITS.versionsPerPackage) ? imports : null
}

interface Knowledge {
  readonly bundled: (packageId: string, sha: string) => boolean
  readonly stored: (packageId: string, sha: string) => boolean
  /** Ids already judged valid, so a vault's entries rarely need the validator again. */
  readonly validIds: Set<string>
  readonly warn: (message: string) => void
}

/** Well-formed entries, a stale bundled one dropped, and every other naming a version that exists. */
function versionsOf(value: unknown, knowledge: Knowledge): Map<string, string> | null {
  if (!isFields(value)) return null
  const versions = new Map(Object.entries(value))
  for (const [packageId, sha] of versions) {
    if (!isSha256(sha)) return null
    if (!knowledge.validIds.has(packageId)) {
      if (!validIdentity(packageId, '1.0.0', 'Check')) return null
      knowledge.validIds.add(packageId)
    }
  }
  const checked = new Map<string, string>()
  for (const [packageId, sha] of versions as Map<string, string>) {
    if (isReserved(packageId) && !knowledge.bundled(packageId, sha)) {
      knowledge.warn('A built-in extension changed with this app; it is off until turned on again.')
      continue
    }
    if (!knowledge.bundled(packageId, sha) && !knowledge.stored(packageId, sha)) return null
    checked.set(packageId, sha)
  }
  return checked
}

function entryOf(value: unknown, nextSeq: number, knowledge: Knowledge): VaultEntry | null {
  if (!isFields(value) || !hasKeys(value, ENTRY_KEYS)) return null
  const touched = own(value, 'touched')
  if (!isSeq(touched) || touched >= nextSeq) return null
  const active = versionsOf(own(value, 'active'), knowledge)
  const previous = versionsOf(own(value, 'previous'), knowledge)
  if (!active || !previous) return null
  return [...active].some(([packageId, sha]) => previous.get(packageId) === sha) ? null : { touched, active, previous }
}

/**
 * Native `Store::checked`: the loaded preferences, if they keep every rule this store writes by.
 * An activation of a bundled version this app no longer ships is dropped, so that package is off.
 */
function parsePreferences(text: string, bundled: readonly Identity[], warn: (message: string) => void): Preferences | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isFields(value) || !hasKeys(value, PREFERENCE_KEYS) || own(value, 'format') !== 1) return null
  const nextSeq = own(value, 'nextSeq')
  const vaultsValue = own(value, 'vaults')
  if (!isSeq(nextSeq) || nextSeq < 1 || !isFields(vaultsValue) || Object.keys(vaultsValue).length > BRIDGE_LIMITS.vaults) return null
  const imports = importsOf(own(value, 'imports'), nextSeq)
  if (!imports) return null
  const knowledge: Knowledge = {
    bundled: (packageId, sha) => bundled.some(item => item.packageId === packageId && item.sha256 === sha),
    stored: (packageId, sha) => imports.some(item => item.packageId === packageId && item.packageSha256 === sha),
    validIds: new Set([...imports.map(item => item.packageId), ...bundled.map(item => item.packageId)]),
    warn,
  }
  const vaults = new Map<string, VaultEntry>()
  for (const [key, item] of Object.entries(vaultsValue)) {
    const entry = isVaultKey(key) ? entryOf(item, nextSeq, knowledge) : null
    if (!entry) return null
    vaults.set(key, entry)
  }
  return { nextSeq, imports, vaults }
}

const isStored = (preferences: Preferences, packageId: string, sha: string) =>
  preferences.imports.some(item => item.packageSha256 === sha && item.packageId === packageId)

/** The versions to drop so one more fits; null when only versions in use could go. */
function roomFor(preferences: Preferences, packageId: string): string[] | null {
  const referenced = new Set([...preferences.vaults.values()].flatMap(entry => [...entry.active.values(), ...entry.previous.values()]))
  const imports = [...preferences.imports].sort((left, right) => left.seq - right.seq)
  const evicted: string[] = []
  if (imports.filter(item => item.packageId === packageId).length >= BRIDGE_LIMITS.versionsPerPackage) {
    const victim = imports.find(item => item.packageId === packageId && !referenced.has(item.packageSha256))
    if (!victim) return null
    evicted.push(victim.packageSha256)
  }
  if (imports.length - evicted.length >= BRIDGE_LIMITS.storedVersions) {
    const victim = imports.find(item => !referenced.has(item.packageSha256) && !evicted.includes(item.packageSha256))
    if (!victim) return null
    evicted.push(victim.packageSha256)
  }
  return evicted
}

function makeRoomForVault(preferences: Preferences, vault: string): boolean {
  if (preferences.vaults.has(vault) || preferences.vaults.size < BRIDGE_LIMITS.vaults) return true
  const idle = [...preferences.vaults].filter(([, entry]) => entry.active.size === 0).sort(([, left], [, right]) => left.touched - right.touched).at(0)
  if (idle === undefined) return false
  preferences.vaults.delete(idle[0])
  return true
}

// --- In-memory host --------------------------------------------------------------------------------

/** The mock vault, as the in-memory host sees it. */
export interface MemoryVault {
  readonly roots: readonly string[]
  pagePaths(): Iterable<string>
  /** Creates the page with exactly `content`; false when it already exists. */
  createPage(path: string, content: string): boolean
}

/** Packages, preferences and runs for this page's lifetime only; pages go to the mock vault. */
export function memoryHost(vault: MemoryVault, bundled: readonly string[]): ExtensionHost {
  const blobs = new Map<string, string>()
  let preferences: string | null = null
  const lookup = (root: string, folder: string): FolderLookup => {
    const segments = folderSegments(folder)
    if (segments === null) return { ok: false, reason: 'outsideVault' }
    const pages = [...vault.pagePaths()]
    let path = root
    for (const segment of segments) {
      path = `${path}/${segment}`
      if (pages.includes(path)) return { ok: false, reason: 'notFolder' }
      if (!pages.some(page => page.startsWith(`${path}/`))) return { ok: false, reason: 'missing' }
    }
    return { ok: true, folder: { path, identity: path, relative: segments.join('/') } }
  }
  return {
    bundled,
    sha256: sha256Hex,
    readBlob: async sha => blobs.get(sha) ?? null,
    writeBlob: async (sha, text) => {
      blobs.set(sha, text)
      return true
    },
    deleteBlob: async sha => {
      blobs.delete(sha)
      return true
    },
    scanBlobs: async limit => ({ hashes: [...blobs.keys()].slice(0, limit), complete: blobs.size <= limit }),
    readPreferences: async () => (preferences === null ? { status: 'missing' } : { status: 'text', text: preferences }),
    writePreferences: async text => {
      preferences = text
      return 'synced'
    },
    setPreferencesAside: async () => {
      preferences = null
    },
    vaultRoots: async vaultPath => (vault.roots.includes(vaultPath) ? { requested: vaultPath, canonical: vaultPath } : null),
    resolveFolder: async (root, folder) => lookup(root, folder),
    createPage: async (roots, folder, fileName, content) => {
      const now = lookup(roots.canonical, folder.relative)
      if (!now.ok) return { status: now.reason === 'missing' || now.reason === 'notFolder' ? 'unavailable' : 'moved' }
      if (now.folder.path !== folder.path) return { status: 'moved' }
      // The mock vault's write either happens whole or throws before any change.
      try {
        return vault.createPage(`${folder.path}/${fileName}`, content) ? { status: 'created', durable: true } : { status: 'exists' }
      } catch {
        return { status: 'unavailable' }
      }
    },
    pagePath: (roots, folder, fileName) => [roots.requested, folder.relative, fileName].filter(part => part !== '').join('/'),
    warn: () => undefined,
  }
}

// --- Backend ---------------------------------------------------------------------------------------

interface Verified { readonly text: string; readonly extension: ExtensionPackage }
interface Bundled extends Verified { readonly sha256: string }
type Unusable = 'unreadable' | 'invalid'

type Key = { readonly state: 'admitting' } | { readonly state: 'admitted'; readonly runId: string } | { readonly state: 'ended' }
interface Session {
  readonly owner: string; readonly vault: VaultRoots; readonly opened: number
  readonly keys: Map<string, Key>
  /** Admitted runs not yet ended plus admissions reserving a slot. */
  live: number
  /** Set when an end could not keep its key: no new admission, ever, in this session. */
  sealed: boolean
}
type Write = { readonly state: 'free' | 'done' } | { readonly state: 'busy'; readonly settled: Promise<void> }
interface Run {
  readonly session: string; readonly owner: string; readonly invocation: string; readonly vault: VaultRoots
  readonly packageId: string; readonly packageSha256: string
  revoked: boolean
  write: Write
  readonly folders: [string, BoundFolder][]
}
interface Operation { readonly owner: string; readonly digest: string; state: 'running' | ProposalReceipt; readonly settled: Promise<void> }
interface BeginRequest { readonly sessionId: string; readonly packageSha256: string; readonly commandId: string; readonly invocationId: string }
interface ClosedSession { readonly owner: string; readonly sessionId: string }
type Activated = { readonly previous: string | null; readonly replaced: string | null }

const VAULT_UNAVAILABLE = { status: 'refused', reason: 'vaultUnavailable' } as const
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`
const activationRefused = (reason: ActivationRefusal, missingCapabilities: Capability[] = []): ActivationReply =>
  ({ status: 'refused', reason, missingCapabilities })

/**
 * The bridge's backend: the native store and run registry as one model. Session, run and
 * operation state lives in this object for its lifetime, as native keeps it for its process.
 */
export class ExtensionBackend {
  private readonly host: ExtensionHost
  private preferences: Preferences | null = null
  /** The store's lock: one preference read or change at a time. */
  private storeQueue: Promise<unknown> = Promise.resolve()
  /** Activation and deactivation, from compare-and-set through revocation; writes never wait on it. */
  private transitionQueue: Promise<unknown> = Promise.resolve()
  private bundledPackages: Promise<readonly Bundled[]> | null = null
  private readonly sessions = new Map<string, Session>()
  private readonly runs = new Map<string, Run>()
  private readonly closed: ClosedSession[] = []
  private readonly operations = new Map<string, Operation>()
  private seq = 0
  /** Changes whenever activation revokes runs, so an admission checked before it refuses. */
  private epoch = 0

  constructor(host: ExtensionHost) {
    this.host = host
  }

  /** One command, with the caller's owner; a malformed argument rejects, as native's `Err`. */
  async handle(command: string, args: unknown, owner: string): Promise<unknown> {
    if (!isFields(args)) throw new ExtensionArgumentError('The arguments could not be read.')
    const text = (key: string) => readText(args, key)
    switch (command) {
      case EXTENSION_COMMANDS.importCandidate: return this.importCandidate(text('packageText'))
      case EXTENSION_COMMANDS.list: return this.list(text('vaultPath'))
      case EXTENSION_COMMANDS.read: return this.read(text('packageSha256'))
      case EXTENSION_COMMANDS.activate:
        return this.activate(text('vaultPath'), text('packageId'), text('packageSha256'), readOptionalText(args, 'expectedActiveSha256'))
      case EXTENSION_COMMANDS.deactivate: return this.deactivate(text('vaultPath'), text('packageId'), text('expectedActiveSha256'))
      case EXTENSION_COMMANDS.openSession: return this.openSession(owner, text('vaultPath'))
      case EXTENSION_COMMANDS.closeSession: return this.closeSession(owner, text('sessionId'))
      case EXTENSION_COMMANDS.beginRun:
        return this.beginRun(owner, { sessionId: text('sessionId'), packageSha256: text('packageSha256'), commandId: text('commandId'), invocationId: text('invocationId') })
      case EXTENSION_COMMANDS.endRun: return this.endRun(owner, text('sessionId'), text('invocationId'))
      case EXTENSION_COMMANDS.bindFolder: return this.bindFolder(owner, text('runId'), text('folder'))
      case EXTENSION_COMMANDS.bindDocument:
        // Adding to an existing page is the append milestone; E1 binds no documents.
        text('runId')
        text('path')
        return { status: 'refused', reason: 'unsupported' }
      case PROPOSAL_COMMANDS.submit: return this.submit(owner, readProposal(own(args, 'proposal')))
      case PROPOSAL_COMMANDS.query: return this.query(owner, text('operationId'))
      default: throw new ExtensionArgumentError(`No extension command ${command}`)
    }
  }

  /** A closed or reloaded page: its sessions close and their runs are revoked now, unjoined. */
  forgetOwner(owner: string): void {
    for (const [id, session] of [...this.sessions]) if (session.owner === owner) this.closeNow(id)
  }

  // --- Store --------------------------------------------------------------------------------------

  private bundled(): Promise<readonly Bundled[]> {
    this.bundledPackages ??= Promise.all(this.host.bundled.map(async (text): Promise<Bundled | null> => {
      const result = parseExtensionPackage(text)
      if (result.status === 'invalid' || !isReserved(result.extension.id)) {
        this.host.warn('A bundled extension package is invalid and stays unavailable.')
        return null
      }
      return { text, extension: result.extension, sha256: await this.host.sha256(text) }
    })).then(items => items.filter(notNull))
    return this.bundledPackages
  }

  /** Bytes read now, hash checked, package validated now. */
  private async verified(sha: string): Promise<Verified | Unusable> {
    const bundled = (await this.bundled()).find(item => item.sha256 === sha)
    if (bundled) return bundled
    if (!isSha256(sha)) return 'unreadable'
    const text = await this.host.readBlob(sha)
    if (text === null || utf8Bytes(text) > EXTENSION_LIMITS.packageBytes || await this.host.sha256(text) !== sha) return 'unreadable'
    const result = parseExtensionPackage(text)
    return result.status === 'valid' ? { text, extension: result.extension } : 'invalid'
  }

  /** Serialized like the native store lock: one preference read or change at a time. */
  private withStore<T>(work: (preferences: Preferences) => Promise<T>): Promise<T> {
    const result = this.storeQueue.then(async () => work(await this.loaded()))
    this.storeQueue = result.catch(() => undefined)
    return result
  }

  private inTransition<T>(work: () => Promise<T>): Promise<T> {
    const result = this.transitionQueue.then(work)
    this.transitionQueue = result.catch(() => undefined)
    return result
  }

  /**
   * Native `load`: missing, every extension off with the stored versions found again from their
   * files; unusable or outside any bound, the same with the file set aside. Nothing is activated.
   */
  private async loaded(): Promise<Preferences> {
    if (this.preferences) return this.preferences
    const bundled = (await this.bundled()).map(item => ({ packageId: item.extension.id, sha256: item.sha256 }))
    const read = await this.host.readPreferences(BRIDGE_LIMITS.preferencesBytes)
    const parsed = read.status === 'text' ? parsePreferences(read.text, bundled, message => this.host.warn(message)) : null
    if (read.status !== 'missing' && parsed === null) {
      this.host.warn('Extension preferences could not be used; every extension is off until turned on again.')
      await this.host.setPreferencesAside()
    }
    this.preferences = parsed ?? await this.rebuilt()
    return this.preferences
  }

  /**
   * Native `rebuilt`: the first `packageScan` folder entries, in name order up to the version
   * bounds. Files beyond that stay unlisted, and the next reconciliation removes them.
   */
  private async rebuilt(): Promise<Preferences> {
    const preferences: Preferences = { nextSeq: 1, imports: [], vaults: new Map() }
    const scan = await this.host.scanBlobs(BRIDGE_LIMITS.packageScan)
    if (scan && !scan.complete) this.host.warn('The extension package folder holds more entries than are read back; the rest stay unlisted.')
    const perPackage = new Map<string, number>()
    for (const sha of [...(scan?.hashes ?? [])].sort()) {
      if (preferences.imports.length === BRIDGE_LIMITS.storedVersions) {
        this.host.warn('More extension packages were found than are kept; the rest stay unlisted.')
        break
      }
      const verified = await this.verified(sha)
      if (typeof verified === 'string') continue
      const { id, version, name } = verified.extension
      const versions = perPackage.get(id) ?? 0
      if (isReserved(id) || versions === BRIDGE_LIMITS.versionsPerPackage) continue
      perPackage.set(id, versions + 1)
      const seq = takeSeq(preferences)
      if (seq === null) break
      preferences.imports.push({ packageSha256: sha, packageId: id, version, name, seq })
    }
    return preferences
  }

  /** Native `save`: nothing larger than the read bound is written, so whatever is written reads back. */
  private async publishPreferences(next: Preferences): Promise<Publication> {
    const text = serialize(next)
    return utf8Bytes(text) > BRIDGE_LIMITS.preferencesBytes ? 'notPublished' : this.host.writePreferences(text)
  }

  /** Published, synced or not, is the state now: the cache follows it and revocation follows. */
  private adopt(next: Preferences, published: Publication): void {
    this.preferences = next
    if (published === 'unsynced') this.host.warn('An extension store change is in place, but its folder could not be synced.')
  }

  /**
   * Native `reconciled`: removes package files no stored version names, then answers whether one
   * more fits. At most `storedVersions` may remain before it, counting any whose removal failed, so
   * the host never holds more than one file beyond them. A folder with more entries takes none.
   */
  private async reconciled(preferences: Preferences): Promise<boolean> {
    const scan = await this.host.scanBlobs(BRIDGE_LIMITS.packageScan)
    if (!scan) return false
    const stored = new Set(preferences.imports.map(item => item.packageSha256))
    let present = 0
    for (const sha of scan.hashes) if (stored.has(sha) || !await this.host.deleteBlob(sha)) present += 1
    if (!scan.complete) this.host.warn('The extension package folder holds more entries than one pass reads; no new package is stored.')
    return scan.complete && present <= BRIDGE_LIMITS.storedVersions
  }

  /** Native `write_blob`: whether this call created the file; a new file, repairs too, only after reconciliation. */
  private async putBlob(preferences: Preferences, sha: string, text: string): Promise<'created' | 'existing' | 'failed'> {
    const current = await this.host.readBlob(sha)
    if (current !== null && await this.host.sha256(current) === sha) return 'existing'
    if (!await this.reconciled(preferences)) return 'failed'
    return await this.host.writeBlob(sha, text) ? 'created' : 'failed'
  }

  private async importCandidate(text: string): Promise<ImportCandidateReply> {
    const result = parseExtensionPackage(text)
    if (result.status === 'invalid') return { status: 'invalid', diagnostics: [...result.diagnostics] }
    const { extension } = result
    if (isReserved(extension.id)) return { status: 'refused', reason: 'reservedId' }
    const sha = await this.host.sha256(text)
    const stored = await this.withStore(preferences => this.storeVersion(preferences, sha, text, extension))
    if (!stored) return { status: 'refused', reason: 'storageUnavailable' }
    return { status: 'candidate', packageSha256: sha, packageId: extension.id, version: extension.version, missingCapabilities: missingOf(extension.capabilities) }
  }

  /**
   * Native `store_version`: stores a candidate and never changes what is active. Unpublished, a file
   * this attempt created goes again, since nothing names it; published, the dropped versions go.
   */
  private async storeVersion(preferences: Preferences, sha: string, text: string, extension: ExtensionPackage): Promise<boolean> {
    // Already stored: its file is only repaired, within the same bound as a new one.
    if (preferences.imports.some(item => item.packageSha256 === sha)) return await this.putBlob(preferences, sha, text) !== 'failed'
    const evicted = roomFor(preferences, extension.id)
    if (evicted === null) return false
    const next = copyOf(preferences)
    const seq = takeSeq(next)
    if (seq === null) return false
    next.imports = next.imports.filter(item => !evicted.includes(item.packageSha256))
    next.imports.push({ packageSha256: sha, packageId: extension.id, version: extension.version, name: extension.name, seq })
    const blob = await this.putBlob(preferences, sha, text)
    if (blob === 'failed') return false
    const published = await this.publishPreferences(next)
    if (published === 'notPublished') {
      // A file left by a failed removal is counted by the next reconciliation.
      if (blob === 'created') await this.host.deleteBlob(sha)
      return false
    }
    this.adopt(next, published)
    for (const old of evicted) await this.host.deleteBlob(old)
    return true
  }

  private async list(vaultPath: string): Promise<ExtensionListReply> {
    const roots = await this.host.vaultRoots(vaultPath)
    if (!roots) return VAULT_UNAVAILABLE
    const snapshot = await this.withStore(async preferences => ({
      imports: [...preferences.imports].sort((left, right) => right.seq - left.seq),
      vault: preferences.vaults.get(roots.canonical) ?? emptyEntry(),
    }))
    const extensions: InstalledExtension[] = []
    const versionsOf = (packageId: string, name: string) => {
      let entry = extensions.find(item => item.packageId === packageId)
      if (!entry) {
        entry = { packageId, name, versions: [], activeSha256: null, previousSha256: null }
        extensions.push(entry)
      }
      return entry.versions
    }
    for (const bundled of await this.bundled()) {
      versionsOf(bundled.extension.id, bundled.extension.name).push({ packageSha256: bundled.sha256, version: bundled.extension.version, readable: true })
    }
    for (const item of snapshot.imports) {
      const verified = await this.verified(item.packageSha256)
      const readable = typeof verified !== 'string' && verified.extension.id === item.packageId
      versionsOf(item.packageId, item.name).push({ packageSha256: item.packageSha256, version: item.version, readable })
    }
    for (const entry of extensions) {
      entry.activeSha256 = snapshot.vault.active.get(entry.packageId) ?? null
      entry.previousSha256 = snapshot.vault.previous.get(entry.packageId) ?? null
    }
    return { status: 'ok', extensions }
  }

  private async read(sha: string): Promise<ReadExtensionReply> {
    const bundled = (await this.bundled()).some(item => item.sha256 === sha)
    const known = bundled || await this.withStore(async preferences => preferences.imports.some(item => item.packageSha256 === sha))
    if (!known) return { status: 'unknown' }
    const verified = await this.verified(sha)
    return typeof verified === 'string' ? { status: 'unreadable' } : { status: 'ok', packageText: verified.text }
  }

  /** Compare-and-set, then the runs of a replaced version are revoked and joined before the answer. */
  private async activate(vaultPath: string, packageId: string, sha: string, expected: string | null): Promise<ActivationReply> {
    const roots = await this.host.vaultRoots(vaultPath)
    if (!roots) return activationRefused('vaultUnavailable')
    return this.inTransition(async () => {
      const bundled = (await this.bundled()).some(item => item.sha256 === sha && item.extension.id === packageId)
      const stored = await this.withStore(async preferences => isStored(preferences, packageId, sha))
      if (!bundled && !stored) return activationRefused('unknownVersion')
      if (isReserved(packageId) && !bundled) return activationRefused('reservedId')
      const verified = await this.verified(sha)
      if (typeof verified === 'string') return activationRefused(verified)
      if (verified.extension.id !== packageId) return activationRefused('unknownVersion')
      const needed = missingOf(verified.extension.capabilities)
      if (needed.length > 0) return activationRefused('missingCapabilities', needed)
      const change = await this.withStore(preferences => this.setActive(preferences, { vault: roots.canonical, packageId, sha, expected, bundled }))
      if (typeof change === 'string') return activationRefused(change)
      const revokedRuns = change.replaced === null ? 0 : await this.revokePackage(roots.canonical, packageId, sha)
      return { status: 'active', packageSha256: sha, previousSha256: change.previous, revokedRuns }
    })
  }

  /**
   * Native `set_active`. The version is checked again here, in the queue that publishes: an import
   * may have dropped it while its bytes were read, and an activation never names an unstored version.
   */
  private async setActive(
    preferences: Preferences,
    request: { vault: string; packageId: string; sha: string; expected: string | null; bundled: boolean },
  ): Promise<Activated | 'unknownVersion' | 'changed' | 'vaultUnavailable'> {
    const { vault, packageId, sha, expected } = request
    if (!request.bundled && !isStored(preferences, packageId, sha)) return 'unknownVersion'
    const entry = preferences.vaults.get(vault)
    const current = entry?.active.get(packageId) ?? null
    if (current !== expected) return 'changed'
    if (current === sha) return { previous: entry?.previous.get(packageId) ?? null, replaced: null }
    if (!isVaultKey(vault)) return 'vaultUnavailable'
    const next = copyOf(preferences)
    if (!makeRoomForVault(next, vault)) return 'vaultUnavailable'
    const seq = takeSeq(next)
    if (seq === null) return 'vaultUnavailable'
    const target = next.vaults.get(vault) ?? emptyEntry()
    next.vaults.set(vault, target)
    target.touched = seq
    if (current !== null) target.previous.set(packageId, current)
    target.active.set(packageId, sha)
    if (target.previous.get(packageId) === sha) target.previous.delete(packageId)
    const published = await this.publishPreferences(next)
    if (published === 'notPublished') return 'vaultUnavailable'
    this.adopt(next, published)
    return { previous: target.previous.get(packageId) ?? null, replaced: current }
  }

  /** Compare-and-set; the turned-off version becomes the previous one, so it can come back. */
  private async deactivate(vaultPath: string, packageId: string, expected: string): Promise<DeactivationReply> {
    const roots = await this.host.vaultRoots(vaultPath)
    if (!roots) return VAULT_UNAVAILABLE
    return this.inTransition(async () => {
      const outcome = await this.withStore(async (preferences): Promise<'changed' | 'vaultUnavailable' | 'published'> => {
        if (preferences.vaults.get(roots.canonical)?.active.get(packageId) !== expected) return 'changed'
        const next = copyOf(preferences)
        const seq = takeSeq(next)
        const target = next.vaults.get(roots.canonical)
        if (seq === null || !target) return 'vaultUnavailable'
        target.active.delete(packageId)
        target.previous.set(packageId, expected)
        target.touched = seq
        const published = await this.publishPreferences(next)
        if (published === 'notPublished') return 'vaultUnavailable'
        this.adopt(next, published)
        return 'published'
      })
      if (outcome !== 'published') return { status: 'refused', reason: outcome }
      return { status: 'inactive', revokedRuns: await this.revokePackage(roots.canonical, packageId, null) }
    })
  }

  /** Run admission: this exact version active in this vault, its bytes verified now, a command this host performs. */
  private async admit(vault: string, sha: string, commandId: string): Promise<{ packageId: string } | { refused: RunAdmissionRefusal }> {
    const bundled = (await this.bundled()).find(item => item.sha256 === sha)
    const { packageId, active } = await this.withStore(async preferences => {
      const id = bundled?.extension.id ?? preferences.imports.find(item => item.packageSha256 === sha)?.packageId
      return { packageId: id, active: id !== undefined && preferences.vaults.get(vault)?.active.get(id) === sha }
    })
    if (packageId === undefined || !active) return { refused: 'notActive' }
    const verified = await this.verified(sha)
    if (typeof verified === 'string' || verified.extension.id !== packageId) return { refused: 'unreadable' }
    const command = verified.extension.commands.find(item => item.id === commandId)
    if (!command) return { refused: 'unknownCommand' }
    if (missingOf(commandCapabilities(command)).length > 0) return { refused: 'missingCapabilities' }
    return { packageId }
  }

  // --- Sessions -----------------------------------------------------------------------------------

  /** Non-joining: the session is gone and its runs revoked; a write in progress keeps its record. */
  private closeNow(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      this.sessions.delete(sessionId)
      this.closed.push({ owner: session.owner, sessionId })
      while (this.closed.length > BRIDGE_LIMITS.recentlyClosed) this.closed.shift()
    }
    for (const [id, run] of this.runs) {
      if (run.session !== sessionId) continue
      run.revoked = true
      if (run.write.state !== 'busy') this.runs.delete(id)
    }
  }

  /** A session this owner closed, or one with a run of this owner still settling. */
  private ownsClosed(owner: string, sessionId: string): boolean {
    return this.closed.some(item => item.owner === owner && item.sessionId === sessionId)
      || [...this.runs.values()].some(run => run.session === sessionId && run.owner === owner)
  }

  /** Waits until no matching run is writing; nothing new can start on a revoked run. */
  private async join(ours: (run: Run) => boolean): Promise<void> {
    for (;;) {
      const writing = [...this.runs.values()].filter(run => ours(run) && run.write.state === 'busy')
      if (writing.length === 0) return
      await Promise.all(writing.map(run => (run.write.state === 'busy' ? run.write.settled : undefined)))
    }
  }

  private async openSession(owner: string, vaultPath: string): Promise<OpenSessionReply> {
    const roots = await this.host.vaultRoots(vaultPath)
    if (!roots) return VAULT_UNAVAILABLE
    const owned = [...this.sessions].filter(([, session]) => session.owner === owner).sort(([, left], [, right]) => left.opened - right.opened)
    while (owned.length >= BRIDGE_LIMITS.sessionsPerOwner) {
      const oldest = owned.shift()
      if (oldest) this.closeNow(oldest[0])
    }
    const sessionId = newId('session')
    this.seq += 1
    this.sessions.set(sessionId, { owner, vault: roots, opened: this.seq, keys: new Map(), live: 0, sealed: false })
    return { status: 'open', sessionId }
  }

  /** Closes first, then waits for writes already admitted; another owner learns nothing. */
  private async closeSession(owner: string, sessionId: string): Promise<CloseSessionReply> {
    if (!isOpaqueToken(sessionId)) return { status: 'unknown' }
    const session = this.sessions.get(sessionId)
    const known = session ? session.owner === owner : this.ownsClosed(owner, sessionId)
    if (!known) return { status: 'unknown' }
    this.closeNow(sessionId)
    const ours = (run: Run) => run.session === sessionId && run.owner === owner
    await this.join(ours)
    for (const [id, run] of this.runs) if (ours(run)) this.runs.delete(id)
    return { status: 'closed' }
  }

  /**
   * Reserves a live slot for the key, checks the package with no reservation able to be skipped,
   * then admits only if the key was not ended and no activation change happened meanwhile.
   */
  private async beginRun(owner: string, request: BeginRequest): Promise<RunAdmission> {
    const refused = (reason: RunAdmissionRefusal): RunAdmission => ({ status: 'refused', reason })
    if (!isOpaqueToken(request.sessionId)) return refused('sessionClosed')
    if (!isOpaqueToken(request.invocationId) || !isOpaqueToken(request.commandId)) return refused('unknownCommand')
    if (!isSha256(request.packageSha256)) return refused('notActive')
    const session = this.sessions.get(request.sessionId)
    if (!session || session.owner !== owner) return refused('sessionClosed')
    const key = session.keys.get(request.invocationId)
    if (key?.state === 'ended') return refused('cancelled')
    if (key) return refused('replayed')
    if (session.sealed || session.keys.size >= BRIDGE_LIMITS.keysPerSession || session.live >= BRIDGE_LIMITS.liveRunsPerSession) return refused('busy')
    session.keys.set(request.invocationId, { state: 'admitting' })
    session.live += 1
    const epoch = this.epoch
    const checked = await this.admit(session.vault.canonical, request.packageSha256, request.commandId)
    // A closed session took its reservation with it.
    const current = this.sessions.get(request.sessionId)
    if (!current) return refused('sessionClosed')
    if (current.keys.get(request.invocationId)?.state !== 'admitting') {
      current.live = Math.max(0, current.live - 1)
      return refused('cancelled')
    }
    if ('refused' in checked || this.epoch !== epoch) {
      current.keys.delete(request.invocationId)
      current.live = Math.max(0, current.live - 1)
      return refused('refused' in checked ? checked.refused : 'busy')
    }
    const runId = newId('run')
    current.keys.set(request.invocationId, { state: 'admitted', runId })
    this.runs.set(runId, {
      session: request.sessionId, owner, invocation: request.invocationId, vault: current.vault, packageId: checked.packageId,
      packageSha256: request.packageSha256, revoked: false, write: { state: 'free' }, folders: [],
    })
    return {
      status: 'admitted',
      scope: { runId, sessionId: request.sessionId, invocationId: request.invocationId, packageId: checked.packageId, packageSha256: request.packageSha256, commandId: request.commandId },
    }
  }

  /** Makes the request-time key unadmittable, admitted or not, then revokes its run and joins its write. */
  private async endRun(owner: string, sessionId: string, invocationId: string): Promise<EndRunReply> {
    if (!isOpaqueToken(sessionId) || !isOpaqueToken(invocationId)) return { status: 'unknownSession' }
    const session = this.sessions.get(sessionId)
    let runId: string | null = null
    if (session) {
      if (session.owner !== owner) return { status: 'unknownSession' }
      const key = session.keys.get(invocationId)
      if (key?.state === 'admitted') runId = key.runId
      // No room to remember this key, and keys freed later must not let it in.
      if (key || session.keys.size < BRIDGE_LIMITS.keysPerSession) session.keys.set(invocationId, { state: 'ended' })
      else session.sealed = true
      if (runId !== null) session.live = Math.max(0, session.live - 1)
    } else if (!this.ownsClosed(owner, sessionId)) {
      return { status: 'unknownSession' }
    }
    const run = runId === null ? undefined : this.runs.get(runId)
    if (run) run.revoked = true
    const ours = (item: Run) => item.session === sessionId && item.invocation === invocationId && item.owner === owner
    await this.join(ours)
    for (const [id, item] of this.runs) if (ours(item) && item.revoked) this.runs.delete(id)
    return { status: 'ended' }
  }

  /**
   * Activation changed in this vault: runs of other versions of the package (every version when
   * `keep` is null) are revoked, and each such write, including one an end already revoked, is
   * joined before answering. Answers how many runs this revoked.
   */
  private async revokePackage(vault: string, packageId: string, keep: string | null): Promise<number> {
    this.epoch += 1
    const matching = [...this.runs].filter(([, run]) => run.vault.canonical === vault && run.packageId === packageId && run.packageSha256 !== keep)
    let revoked = 0
    for (const [, run] of matching) {
      if (run.revoked) continue
      run.revoked = true
      revoked += 1
      const session = this.sessions.get(run.session)
      if (session) {
        session.keys.set(run.invocation, { state: 'ended' })
        session.live = Math.max(0, session.live - 1)
      }
    }
    const targets = new Set(matching.map(([, run]) => run))
    await this.join(run => targets.has(run))
    for (const [id] of matching) this.runs.delete(id)
    return revoked
  }

  private liveRun(owner: string, runId: string): Run | undefined {
    const run = this.runs.get(runId)
    return run && !run.revoked && run.owner === owner && this.sessions.has(run.session) ? run : undefined
  }

  private async bindFolder(owner: string, runId: string, folder: string): Promise<FolderHandleReply> {
    const stale: FolderHandleReply = { status: 'refused', reason: 'staleRun' }
    if (!isOpaqueToken(runId)) return stale
    const run = this.liveRun(owner, runId)
    if (!run) return stale
    const lookup = await this.host.resolveFolder(run.vault.canonical, folder)
    if (!lookup.ok) return { status: 'refused', reason: lookup.reason }
    if (!this.liveRun(owner, runId)) return stale
    const folderHandle = newId('folder')
    if (run.folders.length >= BRIDGE_LIMITS.foldersPerRun) run.folders.shift()
    run.folders.push([folderHandle, lookup.folder])
    return { status: 'bound', folderHandle, displayPath: lookup.folder.relative }
  }

  // --- Writes -------------------------------------------------------------------------------------

  /**
   * One operation per run. The same operation id with the same fields answers its recorded result,
   * waiting while it runs; with any other field, or from another owner, it is refused. Nothing is
   * ever written twice for one id, and no record is ever dropped or replaced.
   */
  private async submit(owner: string, proposal: GuardedProposal): Promise<ProposalReceipt> {
    const { operationId } = proposal
    const refused = (reason: ProposalRefusal): ProposalReceipt => ({ status: 'refused', operationId, reason })
    if (!isCanonicalUuid(operationId)) return refused('operationMismatch')
    if (proposal.kind === 'append') return refused('unsupported')
    const digest = await this.host.sha256(JSON.stringify(proposalFields(proposal)))
    const recorded = this.operations.get(operationId)
    if (recorded) return this.replay(recorded, owner, digest, operationId)
    // A full ledger takes no new id at all, so no answer here goes unrecorded.
    if (this.operations.size >= BRIDGE_LIMITS.operations) return refused('busy')
    const run = this.liveRun(owner, proposal.runId)
    const folder = run?.folders.find(([handle]) => handle === proposal.folderHandle)?.[1]
    if (!run || run.write.state !== 'free' || !folder) {
      const receipt = refused(!run ? 'staleRun' : run.write.state !== 'free' ? 'operationMismatch' : 'handleMismatch')
      this.operations.set(operationId, { owner, digest, state: receipt, settled: Promise.resolve() })
      return receipt
    }
    let settle: () => void = () => undefined
    const settled = new Promise<void>(resolve => {
      settle = resolve
    })
    const operation: Operation = { owner, digest, state: 'running', settled }
    this.operations.set(operationId, operation)
    run.write = { state: 'busy', settled }
    let receipt: ProposalReceipt
    try {
      receipt = await this.publish(run.vault, folder, proposal)
    } catch {
      receipt = { status: 'uncertain', operationId }
    }
    operation.state = receipt
    run.write = { state: 'done' }
    for (const [id, item] of this.runs) if (item.revoked && item.write.state !== 'busy') this.runs.delete(id)
    settle()
    return receipt
  }

  /** Records are never replaced; the binding is still checked again after waiting. */
  private async replay(recorded: Operation, owner: string, digest: string, operationId: string): Promise<ProposalReceipt> {
    const mismatch: ProposalReceipt = { status: 'refused', operationId, reason: 'operationMismatch' }
    if (recorded.owner !== owner || recorded.digest !== digest) return mismatch
    await recorded.settled
    const after = this.operations.get(operationId)
    if (!after || after.owner !== owner || after.digest !== digest) return mismatch
    return after.state === 'running' ? { status: 'uncertain', operationId } : after.state
  }

  /** Name, size and digest, then the host's exclusive creation; every refusal precedes publication. */
  private async publish(vault: VaultRoots, folder: BoundFolder, proposal: CreateProposal): Promise<ProposalReceipt> {
    const { operationId, fileName, content, contentSha256 } = proposal
    const refused = (reason: ProposalRefusal): ProposalReceipt => ({ status: 'refused', operationId, reason })
    if (!validFileName(fileName)) return refused('invalidName')
    if (utf8Bytes(content) > PROPOSAL_LIMITS.contentBytes) return refused('tooLarge')
    if (!isSha256(contentSha256) || await this.host.sha256(content) !== contentSha256) return refused('digestMismatch')
    const written = await this.host.createPage(vault, folder, fileName, content)
    switch (written.status) {
      case 'created':
        return {
          status: 'committed', kind: 'create', operationId, path: this.host.pagePath(vault, folder, fileName),
          beforeSha256: null, afterSha256: contentSha256, durable: written.durable, undoReceipt: null,
        }
      case 'exists': return { status: 'conflict', operationId, reason: 'exists' }
      case 'unavailable': return refused('storageUnavailable')
      case 'moved': return refused('handleMismatch')
      case 'busy': return refused('busy')
      default: return { status: 'uncertain', operationId }
    }
  }

  /** The recorded state for this owner's operation; anyone else's is `unknown`, never absence. */
  private query(owner: string, operationId: string): ProposalQueryReply {
    const operation = this.operations.get(operationId)
    if (!operation || operation.owner !== owner) return { status: 'unknown', operationId }
    return operation.state === 'running' ? { status: 'running', operationId } : operation.state
  }
}

/** The in-memory backend's only page owner: one page, one owner, gone on reload. */
export const MEMORY_OWNER = 'browser'
