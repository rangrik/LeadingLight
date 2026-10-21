// Transport contract between the Adapt UI and the native Adapt host, version 1.
//
// Fixed commands, each invoked as `invoke(command, { args })` with `args` exactly as typed below. There
// is no event stream and no generic provider call: the UI polls bounded snapshots, and every
// snapshot carries a revision that only increases while the host process runs. A new visit after a
// restart may start lower; a visit never outlives its host process.
//
// Native never reads a note for Adapt. Only `request`, the attachment texts the UI sends, the
// visible text of the prior turns the UI names, and the built-in extension guide reach the
// provider. Nothing from a vault path reaches it. Candidates are untrusted text: the UI parses them
// and the E1 registry validates them again. Native never imports, activates or edits anything.
import { isOpaqueToken } from '../proposals/proposalContract'

export const ADAPT_COMMANDS = {
  status: 'adapt_provider_status',
  connect: 'adapt_connect',
  cancelConnect: 'adapt_cancel_connect',
  disconnect: 'adapt_disconnect',
  openVisit: 'adapt_open_visit',
  closeVisit: 'adapt_close_visit',
  listConversations: 'adapt_list_conversations',
  newConversation: 'adapt_new_conversation',
  readConversation: 'adapt_read_conversation',
  saveConversation: 'adapt_save_conversation',
  deleteConversation: 'adapt_delete_conversation',
  send: 'adapt_send',
  cancelTurn: 'adapt_cancel_turn',
} as const
export type AdaptCommandName = (typeof ADAPT_COMMANDS)[keyof typeof ADAPT_COMMANDS]

/** Bytes are UTF-8; characters are UTF-16 code units, as `String.length`. */
export const ADAPT_LIMITS = {
  requestBytes: 16 * 1024,
  attachments: 8,
  attachmentBytes: 128 * 1024,
  /** Request, attachment texts and the included prior turns together. The guide is extra. */
  payloadBytes: 512 * 1024,
  labelChars: 120,
  includedTurns: 16,
  messageChars: 600,
  choices: 3,
  choiceChars: 120,
  packageBytes: 128 * 1024,
  /** Retained per conversation; sending once full is refused `conversationFull`. */
  turnsPerConversation: 50,
  /**
   * Kept per vault. At the limit, a new conversation may only replace one that is empty and was
   * never sent; otherwise it is refused `conversationLimit` until the person deletes one. A
   * conversation with any entry is never removed automatically.
   */
  conversationsPerVault: 50,
} as const

// --- Providers and account -------------------------------------------------------------------------

export const ADAPT_PROVIDERS = ['codex', 'claude'] as const
export type AdaptProvider = (typeof ADAPT_PROVIDERS)[number]

/**
 * `notInstalled`: no native provider program found where LeadingLight looks; nothing is installed for you.
 * `unsupportedVersion`: found, but not a version LeadingLight has qualified.
 * `unqualified`: LeadingLight cannot prove that the provider has no file, shell, network or tool
 * access, so it is not used.
 * `notAuthorized`: no route LeadingLight is permitted to offer (Claude in this version).
 * `failed`: the provider could not be started or answered nonsense; nothing was sent.
 * `storageUnavailable`: LeadingLight's private provider folder could not be prepared.
 */
export const ADAPT_UNAVAILABLE_REASONS = ['notInstalled', 'unsupportedVersion', 'unqualified', 'notAuthorized', 'failed', 'storageUnavailable'] as const
export type AdaptUnavailableReason = (typeof ADAPT_UNAVAILABLE_REASONS)[number]

/**
 * Never carries an email, account id, token or plan. Reading status never starts a sign-in.
 * `signedOut.lastConnect`: how the latest Connect in this process ended, if it did not succeed.
 * `refused`: signed in to a kind of account Adapt does not use (for example an API key); nothing is
 * sent with it, and Disconnect removes it.
 */
export type AdaptProviderState =
  | { status: 'unavailable'; reason: AdaptUnavailableReason; installedVersion: string | null }
  | { status: 'signedOut'; lastConnect: 'failed' | 'cancelled' | null }
  | { status: 'connecting' }
  | { status: 'connected' }
  | { status: 'refused'; reason: 'accountNotSupported' }

export type AdaptStatusArgs = Record<string, never>
export interface AdaptStatusReply { revision: number; providers: { codex: AdaptProviderState; claude: AdaptProviderState } }

/**
 * Starts the provider's own ChatGPT sign-in in the system browser, for LeadingLight's private
 * provider identity only. Only an explicit click calls this. `disclosureVersion` names the text the
 * person agreed to and is recorded locally.
 */
export interface AdaptConnectArgs { provider: AdaptProvider; disclosureVersion: string }
export type AdaptConnectReply =
  | { status: 'started' }
  | { status: 'refused'; reason: 'unavailable' | 'alreadyConnected' | 'busy' | 'browserUnavailable' }

export interface AdaptCancelConnectArgs { provider: AdaptProvider }
export type AdaptCancelConnectReply = { status: 'cancelled' | 'notConnecting' }

/**
 * Closes admission for this provider, cancels every running turn of it (`accountChanged`), then
 * signs out. While this is in progress every Send for the provider is refused `notConnected`.
 * `disconnected`: signed out and every turn proven ended. `stopping`: signed out and nothing is
 * admitted, but some cancelled work is not yet proven ended; ask again to learn when it is.
 */
export interface AdaptDisconnectArgs { provider: AdaptProvider }
export type AdaptDisconnectReply =
  | { status: 'disconnected' | 'stopping' }
  | { status: 'refused'; reason: 'unavailable' | 'failed' }

// --- Visits ----------------------------------------------------------------------------------------

/**
 * One vault visit in one window. Conversations belong to the vault, are stored only in LeadingLight's
 * local app data, and are reached only through an open visit. The vault path scopes local storage
 * only; it is never sent to a provider.
 */
export interface AdaptOpenVisitArgs { vaultPath: string }
export type AdaptOpenVisitReply =
  | { status: 'open'; visitId: string }
  | { status: 'refused'; reason: 'vaultUnavailable' | 'storageUnavailable' }

/**
 * Cancels every turn this visit started (`visitClosed`); none of them can admit a candidate after
 * this call. `closed`: every one is proven ended and the visit is gone. `stopping`: the visit is
 * closing but some turn is not yet proven ended; call again with the same id until `closed`. A
 * closing visit answers nothing else: every other command treats it as `unknownVisit`. `unknown`: no
 * such visit in this host process. Native also closes a window's visits when it closes or reloads.
 */
export interface AdaptCloseVisitArgs { visitId: string }
export type AdaptCloseVisitReply = { status: 'closed' | 'stopping' | 'unknown' }

// --- Conversations ---------------------------------------------------------------------------------

export interface AdaptConversationSummary {
  conversationId: string
  /** ISO 8601 UTC. */
  updatedAt: string
  /** The first request's first line, shortened by the host to `labelChars`; '' before any request. */
  title: string
  turns: number
  running: boolean
}

export interface AdaptListConversationsArgs { visitId: string }
/** Most recently updated first. */
export type AdaptListConversationsReply = { status: 'ok'; conversations: AdaptConversationSummary[] } | { status: 'unknownVisit' }

/** `conversationLimit`: the vault keeps `conversationsPerVault` conversations with entries; delete one first. */
export interface AdaptNewConversationArgs { visitId: string }
export type AdaptNewConversationReply =
  | { status: 'created'; conversationId: string }
  | { status: 'unknownVisit' }
  | { status: 'refused'; reason: 'storageUnavailable' | 'conversationLimit' }

/** `running`: stop its turn first. Deleting removes the local record only. */
export interface AdaptDeleteConversationArgs { visitId: string; conversationId: string }
export type AdaptDeleteConversationReply =
  | { status: 'deleted' | 'unknownVisit' | 'unknownConversation' }
  | { status: 'refused'; reason: 'running' | 'storageUnavailable' }

export interface AdaptAttachmentSummary { kind: AdaptAttachmentKind; label: string; bytes: number; sha256: string }
/**
 * What a change is based on, captured by the UI when the person attached the extension:
 * - `packageId` and `baseSha256` name the exact version being changed;
 * - `expectedActiveSha256` is the version that was active in the vault at that moment, `null` when
 *   none was.
 *
 * The host stores it with the request and returns it unchanged. It is local metadata for the UI's
 * compare-and-set at activation: a later activation compares against this original value, never one
 * re-read afterwards. It is not sent to the provider, and it must always be present; it is never
 * guessed.
 */
export interface AdaptRevisionBase { packageId: string; baseSha256: string; expectedActiveSha256: string | null }

/** Plain prose only; never Markdown, HTML or links to fetch. `packageText` is untrusted JSON text. */
export type AdaptReply =
  | { kind: 'candidate'; message: string; packageText: string }
  | { kind: 'question'; message: string; choices: string[] }
  | { kind: 'unsupported'; message: string; alternative: string | null }

/**
 * `invalidOutput`: the final answer was not one well-formed reply; it is not shown and nothing is
 * retried. `outputTooLarge`: over the bounds above. `usageLimit`: `resetsAt` only when the provider
 * gave one. `toolRefused`: the provider tried to use a tool or asked for anything but an answer;
 * the turn was stopped and nothing was run. `timedOut`: no answer within the host's limit.
 */
export const ADAPT_FAILURES = ['providerFailed', 'invalidOutput', 'outputTooLarge', 'usageLimit', 'notConnected', 'toolRefused', 'timedOut'] as const
export type AdaptFailure = (typeof ADAPT_FAILURES)[number]

/** `appClosed`: LeadingLight quit while it ran; found on the next start. */
export const ADAPT_STOP_REASONS = ['cancelled', 'visitClosed', 'accountChanged', 'appClosed'] as const
export type AdaptStopReason = (typeof ADAPT_STOP_REASONS)[number]

/** Exactly what one Send sent, and how it ended. Attachment texts are not kept, only their summary. */
export type AdaptEntry =
  | {
    kind: 'request'
    turnId: string
    at: string
    provider: AdaptProvider
    text: string
    attachments: AdaptAttachmentSummary[]
    includedTurnIds: string[]
    revision: AdaptRevisionBase | null
    /** The built-in extension guide sent with it, by version. */
    guide: string
  }
  | { kind: 'reply'; turnId: string; at: string; reply: AdaptReply }
  | { kind: 'failed'; turnId: string; at: string; reason: AdaptFailure; resetsAt: string | null }
  /** `confirmed`: the provider work was proven ended. Either way, no candidate of the turn is admitted. */
  | { kind: 'stopped'; turnId: string; at: string; reason: AdaptStopReason; confirmed: boolean }

/** Only what the host knows. `stopping`: cancelled, admission closed, termination not yet confirmed. */
export const ADAPT_TURN_PHASES = ['sending', 'working', 'checking', 'stopping'] as const
export type AdaptTurnPhase = (typeof ADAPT_TURN_PHASES)[number]

/**
 * Whether what a snapshot shows is in local storage. `saved`: written and synced. `unconfirmed`:
 * written, but the folder sync failed, so it may not survive a power loss. `unsaved`: some entry
 * exists only in memory because the local write failed; it is lost if LeadingLight quits. Never show
 * the last two as saved; offer `saveConversation`, which is local only.
 */
export const ADAPT_STORAGE_STATES = ['saved', 'unconfirmed', 'unsaved'] as const
export type AdaptStorageState = (typeof ADAPT_STORAGE_STATES)[number]

export interface AdaptConversation {
  conversationId: string
  revision: number
  /** Oldest first. Every request is followed by exactly one outcome once its turn ends. */
  entries: AdaptEntry[]
  turn: { turnId: string; phase: AdaptTurnPhase } | null
  storage: AdaptStorageState
}

/** `knownRevision`: the revision the UI already shows; the same one answers `unchanged`. */
export interface AdaptReadConversationArgs { visitId: string; conversationId: string; knownRevision: number | null }
export type AdaptReadConversationReply =
  | { status: 'ok'; conversation: AdaptConversation }
  | { status: 'unchanged'; revision: number }
  | { status: 'unknownVisit' | 'unknownConversation' }

/**
 * Writes the conversation as shown to local storage again, and answers how that went. Local only:
 * it never contacts a provider and never repeats a turn.
 */
export interface AdaptSaveConversationArgs { visitId: string; conversationId: string }
export type AdaptSaveConversationReply = { status: AdaptStorageState | 'unknownVisit' | 'unknownConversation' }

// --- Turns -----------------------------------------------------------------------------------------

export const ADAPT_ATTACHMENT_KINDS = ['pastedText', 'pageSnapshot', 'extension'] as const
export type AdaptAttachmentKind = (typeof ADAPT_ATTACHMENT_KINDS)[number]

/** Text the person attached, as shown to them. Never a path; the host never reads one. */
export interface AdaptAttachment { kind: AdaptAttachmentKind; label: string; text: string }

/**
 * One Send. `turnId` is a fresh UUID per Send, chosen by the UI so it can be cancelled before the
 * reply arrives. Every Send starts a fresh provider thread with only this payload. `includeTurnIds`
 * names finished earlier turns of this conversation whose request text and reply text are resent;
 * nothing else from history is. `revision` binds a change to an existing ordinary package and its
 * exact base; attach that package's text as an `extension` attachment.
 */
export interface AdaptSendArgs {
  visitId: string
  conversationId: string
  turnId: string
  provider: AdaptProvider
  request: string
  attachments: AdaptAttachment[]
  includeTurnIds: string[]
  revision: AdaptRevisionBase | null
}

/**
 * `busy`: this conversation already has a running turn. `cancelled`: this turn id was cancelled
 * first. `replayed`: this turn id was already used. `notConnected`: sign in first. `invalidRequest`:
 * an argument breaks the rules above (see `checkSendArgs`).
 */
export const ADAPT_SEND_REFUSALS = [
  'unknownVisit', 'unknownConversation', 'providerUnavailable', 'notConnected', 'busy', 'cancelled', 'replayed',
  'tooLarge', 'invalidRequest', 'conversationFull', 'storageUnavailable',
] as const
export type AdaptSendRefusal = (typeof ADAPT_SEND_REFUSALS)[number]
export type AdaptSendReply = { status: 'admitted'; turnId: string } | { status: 'refused'; reason: AdaptSendRefusal }

/**
 * Closes candidate admission for the turn at once, whether or not its admission reply arrived.
 * `stopped`: ended and proven; `stopping`: admission is closed but termination is not yet proven,
 * so poll; `finished`: it ended before the cancel and its outcome stands.
 */
export interface AdaptCancelTurnArgs { visitId: string; conversationId: string; turnId: string }
export type AdaptCancelTurnReply = { status: 'stopped' | 'stopping' | 'finished' | 'unknownVisit' | 'unknownConversation' }

// --- The injected surface --------------------------------------------------------------------------

/** Every call answers null when no usable reply came back; null is never read as an outcome. */
export interface AdaptApi {
  status(args: AdaptStatusArgs): Promise<AdaptStatusReply | null>
  connect(args: AdaptConnectArgs): Promise<AdaptConnectReply | null>
  cancelConnect(args: AdaptCancelConnectArgs): Promise<AdaptCancelConnectReply | null>
  disconnect(args: AdaptDisconnectArgs): Promise<AdaptDisconnectReply | null>
  openVisit(args: AdaptOpenVisitArgs): Promise<AdaptOpenVisitReply | null>
  closeVisit(args: AdaptCloseVisitArgs): Promise<AdaptCloseVisitReply | null>
  listConversations(args: AdaptListConversationsArgs): Promise<AdaptListConversationsReply | null>
  newConversation(args: AdaptNewConversationArgs): Promise<AdaptNewConversationReply | null>
  readConversation(args: AdaptReadConversationArgs): Promise<AdaptReadConversationReply | null>
  saveConversation(args: AdaptSaveConversationArgs): Promise<AdaptSaveConversationReply | null>
  deleteConversation(args: AdaptDeleteConversationArgs): Promise<AdaptDeleteConversationReply | null>
  send(args: AdaptSendArgs): Promise<AdaptSendReply | null>
  cancelTurn(args: AdaptCancelTurnArgs): Promise<AdaptCancelTurnReply | null>
}

// --- Checks shared with native ---------------------------------------------------------------------

export function utf8Length(text: string): number {
  let bytes = 0
  for (const char of text) {
    const code = char.codePointAt(0) as number
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}

/** No lone surrogates, which cannot cross to native, and no NUL. */
export function isWellFormedText(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index)
    if (unit === 0) return false
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index++
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false
  }
  return true
}

/** Controls, line and paragraph separators, direction overrides and isolates; tab and newline only in prose. */
function hasControl(text: string, prose: boolean): boolean {
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index)
    if (prose && (unit === 0x09 || unit === 0x0a)) continue
    if (unit < 0x20 || (unit >= 0x7f && unit <= 0x9f) || (unit >= 0x2028 && unit <= 0x202e) || (unit >= 0x2066 && unit <= 0x2069)) return true
  }
  return false
}
/** Prose: plain text, newlines and tabs allowed, no other control or direction characters. */
export const isPlainProse = (text: string, maxChars: number): boolean =>
  text.trim() !== '' && text.length <= maxChars && isWellFormedText(text) && !hasControl(text, true)
/** One short line: labels, titles, choices. */
export const isPlainLine = (text: string, maxChars: number): boolean =>
  text.trim() !== '' && text.length <= maxChars && isWellFormedText(text) && !hasControl(text, false)

const SHA256 = /^[0-9a-f]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const isSha256 = (value: unknown): value is string => typeof value === 'string' && SHA256.test(value)
export const isTurnId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)

/** Exactly the three fields, with the original expected active hash present: `null` or a hash. */
export function isRevisionBase(value: unknown): value is AdaptRevisionBase {
  if (!isFields(value) || !hasKeys(value, ['packageId', 'baseSha256', 'expectedActiveSha256'])) return false
  const { packageId, baseSha256, expectedActiveSha256 } = value
  return isOpaqueToken(packageId) && isSha256(baseSha256) && (expectedActiveSha256 === null || isSha256(expectedActiveSha256))
}

/** What native refuses as `invalidRequest` or `tooLarge`; null when the arguments may be sent. */
export function checkSendArgs(args: AdaptSendArgs): 'invalidRequest' | 'tooLarge' | null {
  const { request, attachments, includeTurnIds, revision } = args
  const shaped = isOpaqueToken(args.visitId) && isOpaqueToken(args.conversationId) && isTurnId(args.turnId)
    && (ADAPT_PROVIDERS as readonly string[]).includes(args.provider)
    && isWellFormedText(request) && request.trim() !== ''
    && attachments.length <= ADAPT_LIMITS.attachments
    && attachments.every(item => (ADAPT_ATTACHMENT_KINDS as readonly string[]).includes(item.kind)
      && isPlainLine(item.label, ADAPT_LIMITS.labelChars) && isWellFormedText(item.text) && item.text.trim() !== '')
    && includeTurnIds.length <= ADAPT_LIMITS.includedTurns && includeTurnIds.every(isTurnId)
    && new Set(includeTurnIds).size === includeTurnIds.length && !includeTurnIds.includes(args.turnId)
    && (revision === null || isRevisionBase(revision))
  if (!shaped) return 'invalidRequest'
  const attached = attachments.map(item => utf8Length(item.text))
  if (utf8Length(request) > ADAPT_LIMITS.requestBytes || attached.some(bytes => bytes > ADAPT_LIMITS.attachmentBytes)) return 'tooLarge'
  return utf8Length(request) + attached.reduce((sum, bytes) => sum + bytes, 0) > ADAPT_LIMITS.payloadBytes ? 'tooLarge' : null
}

// --- Reading replies -------------------------------------------------------------------------------

type Fields = Record<string, unknown>
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value)
const has = (value: Fields, key: string): unknown => (Object.hasOwn(value, key) ? value[key] : undefined)
const hasKeys = (value: Fields, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (values as readonly string[]).includes(value)
const isRevision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/
const isInstant = (value: unknown): value is string => typeof value === 'string' && ISO_UTC.test(value) && !Number.isNaN(Date.parse(value))
const isVersion = (value: unknown): value is string => typeof value === 'string' && /^[0-9A-Za-z.+-]{1,64}$/.test(value)

/** A reply that is exactly `{ status }` with one of `statuses`. */
function statusOnly<T extends string>(value: unknown, statuses: readonly T[]): { status: T } | null {
  if (!isFields(value) || !hasKeys(value, ['status'])) return null
  const status = has(value, 'status')
  return oneOf(statuses, status) ? { status } : null
}

/** A reply that is exactly `{ status: 'refused', reason }` with one of `reasons`. */
function refusal<T extends string>(value: Fields, reasons: readonly T[]): { status: 'refused'; reason: T } | null {
  const reason = has(value, 'reason')
  return hasKeys(value, ['status', 'reason']) && has(value, 'status') === 'refused' && oneOf(reasons, reason)
    ? { status: 'refused', reason }
    : null
}

function parseProviderState(value: unknown): AdaptProviderState | null {
  if (!isFields(value)) return null
  switch (has(value, 'status')) {
    case 'unavailable': {
      const { reason, installedVersion } = value
      return hasKeys(value, ['status', 'reason', 'installedVersion']) && oneOf(ADAPT_UNAVAILABLE_REASONS, reason)
        && (installedVersion === null || isVersion(installedVersion))
        ? { status: 'unavailable', reason, installedVersion }
        : null
    }
    case 'signedOut': {
      const lastConnect = has(value, 'lastConnect')
      return hasKeys(value, ['status', 'lastConnect']) && (lastConnect === null || lastConnect === 'failed' || lastConnect === 'cancelled')
        ? { status: 'signedOut', lastConnect }
        : null
    }
    case 'connecting':
    case 'connected':
      return hasKeys(value, ['status']) ? { status: has(value, 'status') as 'connecting' | 'connected' } : null
    case 'refused':
      return hasKeys(value, ['status', 'reason']) && has(value, 'reason') === 'accountNotSupported'
        ? { status: 'refused', reason: 'accountNotSupported' }
        : null
    default:
      return null
  }
}

export function parseStatusReply(value: unknown): AdaptStatusReply | null {
  if (!isFields(value) || !hasKeys(value, ['revision', 'providers'])) return null
  const providers = has(value, 'providers')
  if (!isRevision(has(value, 'revision')) || !isFields(providers) || !hasKeys(providers, ['codex', 'claude'])) return null
  const codex = parseProviderState(has(providers, 'codex'))
  const claude = parseProviderState(has(providers, 'claude'))
  return codex && claude ? { revision: value.revision as number, providers: { codex, claude } } : null
}

export function parseConnectReply(value: unknown): AdaptConnectReply | null {
  if (!isFields(value)) return null
  if (has(value, 'status') === 'started') return hasKeys(value, ['status']) ? { status: 'started' } : null
  return refusal(value, ['unavailable', 'alreadyConnected', 'busy', 'browserUnavailable'] as const)
}

export const parseCancelConnectReply = (value: unknown): AdaptCancelConnectReply | null =>
  statusOnly(value, ['cancelled', 'notConnecting'] as const)

export function parseDisconnectReply(value: unknown): AdaptDisconnectReply | null {
  if (!isFields(value)) return null
  if (has(value, 'status') === 'refused') return refusal(value, ['unavailable', 'failed'] as const)
  return statusOnly(value, ['disconnected', 'stopping'] as const)
}

export function parseOpenVisitReply(value: unknown): AdaptOpenVisitReply | null {
  if (!isFields(value)) return null
  const visitId = has(value, 'visitId')
  if (has(value, 'status') === 'open') return hasKeys(value, ['status', 'visitId']) && isOpaqueToken(visitId) ? { status: 'open', visitId } : null
  return refusal(value, ['vaultUnavailable', 'storageUnavailable'] as const)
}

export const parseCloseVisitReply = (value: unknown): AdaptCloseVisitReply | null =>
  statusOnly(value, ['closed', 'stopping', 'unknown'] as const)

const SUMMARY_KEYS = ['conversationId', 'updatedAt', 'title', 'turns', 'running']

function parseSummary(value: unknown): AdaptConversationSummary | null {
  if (!isFields(value) || !hasKeys(value, SUMMARY_KEYS)) return null
  const { conversationId, updatedAt, title, turns, running } = value
  const fits = isOpaqueToken(conversationId) && isInstant(updatedAt)
    && typeof title === 'string' && (title === '' || isPlainLine(title, ADAPT_LIMITS.labelChars))
    && Number.isSafeInteger(turns) && (turns as number) >= 0 && (turns as number) <= ADAPT_LIMITS.turnsPerConversation
    && typeof running === 'boolean'
  return fits ? { conversationId, updatedAt, title, turns: turns as number, running } : null
}

export function parseListConversationsReply(value: unknown): AdaptListConversationsReply | null {
  if (!isFields(value)) return null
  if (has(value, 'status') === 'unknownVisit') return hasKeys(value, ['status']) ? { status: 'unknownVisit' } : null
  const list = has(value, 'conversations')
  if (has(value, 'status') !== 'ok' || !hasKeys(value, ['status', 'conversations']) || !Array.isArray(list)) return null
  if (list.length > ADAPT_LIMITS.conversationsPerVault) return null
  const conversations = list.map(parseSummary)
  const ids = new Set(conversations.map(summary => summary?.conversationId))
  return conversations.every(summary => summary !== null) && ids.size === conversations.length
    ? { status: 'ok', conversations: conversations as AdaptConversationSummary[] }
    : null
}

export function parseNewConversationReply(value: unknown): AdaptNewConversationReply | null {
  if (!isFields(value)) return null
  const conversationId = has(value, 'conversationId')
  if (has(value, 'status') === 'created') {
    return hasKeys(value, ['status', 'conversationId']) && isOpaqueToken(conversationId) ? { status: 'created', conversationId } : null
  }
  if (has(value, 'status') === 'unknownVisit') return hasKeys(value, ['status']) ? { status: 'unknownVisit' } : null
  return refusal(value, ['storageUnavailable', 'conversationLimit'] as const)
}

export function parseDeleteConversationReply(value: unknown): AdaptDeleteConversationReply | null {
  if (!isFields(value)) return null
  if (has(value, 'status') === 'refused') return refusal(value, ['running', 'storageUnavailable'] as const)
  return statusOnly(value, ['deleted', 'unknownVisit', 'unknownConversation'] as const)
}

/** The model's answer, as native stored it. Also the reader for any candidate envelope. */
export function parseAdaptReply(value: unknown): AdaptReply | null {
  if (!isFields(value)) return null
  const { message } = value
  if (typeof message !== 'string' || !isPlainProse(message, ADAPT_LIMITS.messageChars)) return null
  switch (has(value, 'kind')) {
    case 'candidate': {
      const packageText = has(value, 'packageText')
      return hasKeys(value, ['kind', 'message', 'packageText']) && typeof packageText === 'string' && packageText.trim() !== ''
        && isWellFormedText(packageText) && utf8Length(packageText) <= ADAPT_LIMITS.packageBytes
        ? { kind: 'candidate', message, packageText }
        : null
    }
    case 'question': {
      const choices = has(value, 'choices')
      return hasKeys(value, ['kind', 'message', 'choices']) && Array.isArray(choices) && choices.length <= ADAPT_LIMITS.choices
        && choices.every(choice => typeof choice === 'string' && isPlainLine(choice, ADAPT_LIMITS.choiceChars))
        ? { kind: 'question', message, choices: choices as string[] }
        : null
    }
    case 'unsupported': {
      const alternative = has(value, 'alternative')
      return hasKeys(value, ['kind', 'message', 'alternative'])
        && (alternative === null || (typeof alternative === 'string' && isPlainProse(alternative, ADAPT_LIMITS.messageChars)))
        ? { kind: 'unsupported', message, alternative }
        : null
    }
    default:
      return null
  }
}

function parseAttachmentSummary(value: unknown): AdaptAttachmentSummary | null {
  if (!isFields(value) || !hasKeys(value, ['kind', 'label', 'bytes', 'sha256'])) return null
  const { kind, label, bytes, sha256 } = value
  return oneOf(ADAPT_ATTACHMENT_KINDS, kind) && typeof label === 'string' && isPlainLine(label, ADAPT_LIMITS.labelChars)
    && Number.isSafeInteger(bytes) && (bytes as number) >= 0 && (bytes as number) <= ADAPT_LIMITS.attachmentBytes && isSha256(sha256)
    ? { kind, label, bytes: bytes as number, sha256 }
    : null
}

function parseRevisionBase(value: unknown): AdaptRevisionBase | null | undefined {
  if (value === null) return null
  if (!isRevisionBase(value)) return undefined
  const { packageId, baseSha256, expectedActiveSha256 } = value
  return { packageId, baseSha256, expectedActiveSha256 }
}

const REQUEST_KEYS = ['kind', 'turnId', 'at', 'provider', 'text', 'attachments', 'includedTurnIds', 'revision', 'guide']

function parseRequestEntry(value: Fields): AdaptEntry | null {
  if (!hasKeys(value, REQUEST_KEYS)) return null
  const { turnId, at, provider, text, attachments, includedTurnIds, guide } = value
  const revision = parseRevisionBase(has(value, 'revision'))
  if (!isTurnId(turnId) || !isInstant(at) || !oneOf(ADAPT_PROVIDERS, provider) || revision === undefined || !isOpaqueToken(guide)) return null
  if (typeof text !== 'string' || text.trim() === '' || !isWellFormedText(text) || utf8Length(text) > ADAPT_LIMITS.requestBytes) return null
  if (!Array.isArray(attachments) || attachments.length > ADAPT_LIMITS.attachments) return null
  if (!Array.isArray(includedTurnIds) || includedTurnIds.length > ADAPT_LIMITS.includedTurns || !includedTurnIds.every(isTurnId)) return null
  const summaries = attachments.map(parseAttachmentSummary)
  if (!summaries.every(summary => summary !== null)) return null
  return {
    kind: 'request', turnId, at, provider, text,
    attachments: summaries as AdaptAttachmentSummary[], includedTurnIds: includedTurnIds as string[], revision, guide,
  }
}

function parseEntry(value: unknown): AdaptEntry | null {
  if (!isFields(value)) return null
  const { turnId, at } = value
  if (has(value, 'kind') === 'request') return parseRequestEntry(value)
  if (!isTurnId(turnId) || !isInstant(at)) return null
  switch (has(value, 'kind')) {
    case 'reply': {
      const reply = hasKeys(value, ['kind', 'turnId', 'at', 'reply']) ? parseAdaptReply(has(value, 'reply')) : null
      return reply ? { kind: 'reply', turnId, at, reply } : null
    }
    case 'failed': {
      const { reason, resetsAt } = value
      return hasKeys(value, ['kind', 'turnId', 'at', 'reason', 'resetsAt']) && oneOf(ADAPT_FAILURES, reason)
        && (resetsAt === null || (reason === 'usageLimit' && isInstant(resetsAt)))
        ? { kind: 'failed', turnId, at, reason, resetsAt }
        : null
    }
    case 'stopped': {
      const { reason, confirmed } = value
      return hasKeys(value, ['kind', 'turnId', 'at', 'reason', 'confirmed']) && oneOf(ADAPT_STOP_REASONS, reason) && typeof confirmed === 'boolean'
        ? { kind: 'stopped', turnId, at, reason, confirmed }
        : null
    }
    default:
      return null
  }
}

/**
 * Requests and outcomes alternate, each outcome for the request before it. Only the last request
 * may be waiting, and it is waiting exactly when it is the running turn. Included turns are earlier ones.
 */
function isOrdered(entries: AdaptEntry[], turn: AdaptConversation['turn']): boolean {
  const finished = new Set<string>()
  let waiting: string | null = null
  for (const entry of entries) {
    if (entry.kind === 'request') {
      if (waiting !== null || finished.has(entry.turnId) || !entry.includedTurnIds.every(id => finished.has(id))) return false
      waiting = entry.turnId
    } else {
      if (entry.turnId !== waiting) return false
      finished.add(waiting)
      waiting = null
    }
  }
  return waiting === null ? turn === null : turn?.turnId === waiting
}

function parseConversation(value: unknown): AdaptConversation | null {
  if (!isFields(value) || !hasKeys(value, ['conversationId', 'revision', 'entries', 'turn', 'storage'])) return null
  const { conversationId, revision, entries, turn, storage } = value
  if (!isOpaqueToken(conversationId) || !isRevision(revision) || !Array.isArray(entries) || !oneOf(ADAPT_STORAGE_STATES, storage)) return null
  if (entries.length > ADAPT_LIMITS.turnsPerConversation * 2) return null
  let running: AdaptConversation['turn'] = null
  if (turn !== null) {
    if (!isFields(turn) || !hasKeys(turn, ['turnId', 'phase'])) return null
    const { turnId, phase } = turn
    if (!isTurnId(turnId) || !oneOf(ADAPT_TURN_PHASES, phase)) return null
    running = { turnId, phase }
  }
  const parsed = entries.map(parseEntry)
  if (!parsed.every(entry => entry !== null) || !isOrdered(parsed as AdaptEntry[], running)) return null
  return { conversationId, revision, entries: parsed as AdaptEntry[], turn: running, storage }
}

/** An answer about another conversation is no answer. */
export function parseReadConversationReply(value: unknown, args: AdaptReadConversationArgs): AdaptReadConversationReply | null {
  if (!isFields(value)) return null
  switch (has(value, 'status')) {
    case 'ok': {
      const conversation = hasKeys(value, ['status', 'conversation']) ? parseConversation(has(value, 'conversation')) : null
      return conversation && conversation.conversationId === args.conversationId ? { status: 'ok', conversation } : null
    }
    case 'unchanged': {
      const revision = has(value, 'revision')
      return hasKeys(value, ['status', 'revision']) && isRevision(revision) && revision === args.knownRevision ? { status: 'unchanged', revision } : null
    }
    default:
      return statusOnly(value, ['unknownVisit', 'unknownConversation'] as const)
  }
}

/** An admission must echo this turn id; anything else is no reply. */
export function parseSendReply(value: unknown, args: AdaptSendArgs): AdaptSendReply | null {
  if (!isFields(value)) return null
  if (has(value, 'status') === 'admitted') {
    return hasKeys(value, ['status', 'turnId']) && has(value, 'turnId') === args.turnId ? { status: 'admitted', turnId: args.turnId } : null
  }
  return refusal(value, ADAPT_SEND_REFUSALS)
}

export const parseCancelTurnReply = (value: unknown): AdaptCancelTurnReply | null =>
  statusOnly(value, ['stopped', 'stopping', 'finished', 'unknownVisit', 'unknownConversation'] as const)

export const parseSaveConversationReply = (value: unknown): AdaptSaveConversationReply | null =>
  statusOnly(value, [...ADAPT_STORAGE_STATES, 'unknownVisit', 'unknownConversation'] as const)
