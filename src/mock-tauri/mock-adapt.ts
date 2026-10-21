// The browser's Adapt host: the frozen contract's thirteen commands (adaptContract.ts) for the dev
// server, its tests and the desktop harness, which calls window.__mockHandlers directly.
//
// Without an explicit fixture there is no provider and no local Adapt storage here. Codex answers
// `unavailable/notInstalled`: the browser has no native provider program and claims no version.
// Claude answers `unavailable/notAuthorized`, as native does. A visit is refused
// `storageUnavailable`, so nothing can be sent or shown as saved. Nothing here fetches, forwards a
// request, reads a credential, writes a note or touches an extension.
//
// A test may install a deterministic fixture provider (tests/helpers/adaptFixture.ts, described in
// docs/leadinglight/adapt-browser.md): a script in sessionStorage, read once at page load and only
// on the dev server. A script that breaks any rule makes Codex `unavailable/failed`, never a default
// success. Host rules mirror the contract and native `leadinglight_adapt` as corrected: admission
// order, cancel scoped to one conversation, closing visits and disconnects that answer `stopping`
// until their work is proven ended, outcomes kept in memory when their local write fails, one
// revision counter, and the final-answer reader. The fixture claims no native durability.
import {
  ADAPT_ATTACHMENT_KINDS, ADAPT_COMMANDS, ADAPT_FAILURES, ADAPT_LIMITS, ADAPT_PROVIDERS, ADAPT_STOP_REASONS,
  checkSendArgs, isPlainLine, isPlainProse, isTurnId, isWellFormedText, parseReadConversationReply, parseStatusReply, utf8Length,
  type AdaptAttachment, type AdaptCancelConnectReply, type AdaptCancelTurnArgs, type AdaptCancelTurnReply, type AdaptCloseVisitReply,
  type AdaptCommandName, type AdaptConnectArgs, type AdaptConnectReply, type AdaptConversationSummary, type AdaptDeleteConversationReply,
  type AdaptDisconnectReply, type AdaptEntry, type AdaptFailure, type AdaptListConversationsReply, type AdaptNewConversationReply,
  type AdaptOpenVisitReply, type AdaptProvider, type AdaptProviderState, type AdaptReadConversationArgs, type AdaptReadConversationReply,
  type AdaptReply, type AdaptRevisionBase, type AdaptSaveConversationReply, type AdaptSendArgs, type AdaptSendReply, type AdaptStatusReply,
  type AdaptStopReason, type AdaptStorageState, type AdaptTurnPhase,
} from '../leadinglight/adapt/adaptContract'
import { isOpaqueToken } from '../leadinglight/proposals/proposalContract'
import { sha256Bytes } from './mock-history'

export const ADAPT_COMMAND_LIST: readonly AdaptCommandName[] = Object.values(ADAPT_COMMANDS)

export const ADAPT_FIXTURE_FORMAT = 'leadinglight.adapt-fixture/1'
/** The test-written script; tests/helpers/adaptFixture.ts writes it once per tab. */
export const ADAPT_FIXTURE_KEY = 'leadinglight.adaptFixture'
/** This host's own state, so a reload keeps the account, conversations and script position. */
export const ADAPT_FIXTURE_STATE_KEY = 'leadinglight.adaptFixture.state'
/** Recorded as each request's guide: the fixture sends no real guide, so it claims none. */
export const ADAPT_FIXTURE_GUIDE = 'extensions-guide-fixture'
/** From Connect to its result, and between a turn's phases. */
export const ADAPT_FIXTURE_STEP_MS = 150
export const ADAPT_FIXTURE_LIMITS = { connects: 16, turns: 64, sent: 16 } as const

/** Native MAX_VISITS_PER_OWNER and MAX_TOMBSTONES; a page is one owner. */
const MAX_VISITS = 8
const MAX_TOMBSTONES = 256
/** Native MAX_ANSWER_BYTES: a longer final answer is `outputTooLarge` before it is read. */
const MAX_ANSWER_BYTES = 2 * ADAPT_LIMITS.packageBytes

// --- Script ----------------------------------------------------------------------------------------

export const ADAPT_FIXTURE_CONNECT_RESULTS = ['connected', 'failed', 'accountNotSupported', 'browserUnavailable'] as const
/** What one explicit Connect does. `hold`: it stays `connecting` until released. */
export interface AdaptFixtureConnect { result: (typeof ADAPT_FIXTURE_CONNECT_RESULTS)[number]; hold?: boolean }
/** How the local write of one turn's outcome goes, when it does not simply succeed. */
export const ADAPT_FIXTURE_SAVE_FAULTS = ['unsaved', 'unconfirmed'] as const
/**
 * What one admitted Send gets. `reply`: the model's answer, checked as native checks it. `output`:
 * the raw final answer text, read as native reads it. `failure`: the provider's failure as written.
 * `hold`: the turn stays `working` until released. `slowStop`: a stop is not proven until the late
 * result arrives (on release, or from its timer), and that result is discarded. `outcomeSave`: the
 * local write of the outcome fails (`unsaved`, kept in memory only) or is not synced (`unconfirmed`)
 * until the conversation is written again, by a later Send or `saveConversation`.
 */
export type AdaptFixtureTurn = { hold?: boolean; slowStop?: boolean; outcomeSave?: (typeof ADAPT_FIXTURE_SAVE_FAULTS)[number] }
  & ({ reply: AdaptReply } | { output: string } | { failure: AdaptFailure; resetsAt?: string | null })
export interface AdaptFixtureScript {
  fixture: typeof ADAPT_FIXTURE_FORMAT
  /** Where Codex starts; `signedOut` unless a test skips Connect. */
  account?: 'signedOut' | 'connected'
  connects?: AdaptFixtureConnect[]
  turns?: AdaptFixtureTurn[]
}

/** Exactly what one admitted Send gave the fixture provider: its arguments and the named turns' visible text. */
export interface AdaptFixtureEnvelope {
  turnId: string
  provider: AdaptProvider
  request: string
  attachments: AdaptAttachment[]
  earlierTurns: Array<{ turnId: string; request: string; reply: AdaptReply | null }>
  /** Native's `changePackage`: only the package and its base; `expectedActiveSha256` stays local. */
  changePackage: Pick<AdaptRevisionBase, 'packageId' | 'baseSha256'> | null
  guide: string
}

/** `window.__leadinglightAdaptFixture`, present only while a fixture is active. */
export interface AdaptFixtureControl {
  /** Lets every held Connect and every held or stopping turn finish; answers how many. */
  release(): number
  /** What each admitted Send of this page load gave the provider, oldest first. */
  sent(): AdaptFixtureEnvelope[]
}

declare global {
  interface Window { __leadinglightAdaptFixture?: AdaptFixtureControl }
}

type Fields = Record<string, unknown>
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value)
const hasOnly = (value: Fields, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key))
const hasExactly = (value: Fields, keys: readonly string[]) => hasOnly(value, keys) && keys.every(key => Object.hasOwn(value, key))
const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (values as readonly string[]).includes(value)
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const optionalFlag = (value: unknown) => value === undefined || typeof value === 'boolean'
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/
const isInstant = (value: unknown): value is string => typeof value === 'string' && ISO_UTC.test(value) && !Number.isNaN(Date.parse(value))
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const encoder = new TextEncoder()
const sha256 = (text: string) => sha256Bytes(encoder.encode(text))

function readConnectStep(value: unknown): AdaptFixtureConnect | null {
  if (!isFields(value) || !hasOnly(value, ['result', 'hold']) || !optionalFlag(value.hold)) return null
  return oneOf(ADAPT_FIXTURE_CONNECT_RESULTS, value.result) ? { result: value.result, hold: value.hold === true } : null
}

function readTurnStep(value: unknown): AdaptFixtureTurn | null {
  if (!isFields(value) || !optionalFlag(value.hold) || !optionalFlag(value.slowStop)) return null
  if (value.outcomeSave !== undefined && !oneOf(ADAPT_FIXTURE_SAVE_FAULTS, value.outcomeSave)) return null
  const timing = { hold: value.hold === true, slowStop: value.slowStop === true, ...(value.outcomeSave === undefined ? {} : { outcomeSave: value.outcomeSave }) }
  const kinds = ['reply', 'output', 'failure'].filter(key => Object.hasOwn(value, key))
  if (kinds.length !== 1) return null
  const allowed = [kinds[0], 'hold', 'slowStop', 'outcomeSave', ...(kinds[0] === 'failure' ? ['resetsAt'] : [])]
  if (!hasOnly(value, allowed)) return null
  // A reply is any object: one the host cannot read is the provider answering nonsense.
  if (kinds[0] === 'reply') return isFields(value.reply) ? { ...timing, reply: value.reply as AdaptReply } : null
  if (kinds[0] === 'output') return typeof value.output === 'string' ? { ...timing, output: value.output } : null
  const resetsAt = value.resetsAt ?? null
  return oneOf(ADAPT_FAILURES, value.failure) && (resetsAt === null || typeof resetsAt === 'string')
    ? { ...timing, failure: value.failure, resetsAt }
    : null
}

/** The script, or null when it breaks any rule; nothing is guessed or defaulted to success. */
export function readAdaptFixtureScript(text: string): AdaptFixtureScript | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isFields(value) || !hasOnly(value, ['fixture', 'account', 'connects', 'turns']) || value.fixture !== ADAPT_FIXTURE_FORMAT) return null
  const account = value.account ?? 'signedOut'
  const connects = value.connects ?? []
  const turns = value.turns ?? []
  if ((account !== 'signedOut' && account !== 'connected') || !Array.isArray(connects) || !Array.isArray(turns)) return null
  if (connects.length > ADAPT_FIXTURE_LIMITS.connects || turns.length > ADAPT_FIXTURE_LIMITS.turns) return null
  const connectSteps = connects.map(readConnectStep)
  const turnSteps = turns.map(readTurnStep)
  if (connectSteps.includes(null) || turnSteps.includes(null)) return null
  return { fixture: ADAPT_FIXTURE_FORMAT, account, connects: connectSteps as AdaptFixtureConnect[], turns: turnSteps as AdaptFixtureTurn[] }
}

// --- The final answer (prompt.rs `read_answer`, check.rs `check_reply`) ------------------------------

type AnswerFault = 'invalidOutput' | 'outputTooLarge'

function checkReply(reply: AdaptReply): AnswerFault | null {
  const prose = (text: string): AnswerFault | null =>
    text.length > ADAPT_LIMITS.messageChars ? 'outputTooLarge' : isPlainProse(text, ADAPT_LIMITS.messageChars) ? null : 'invalidOutput'
  const message = prose(reply.message)
  if (message) return message
  switch (reply.kind) {
    case 'candidate':
      if (utf8Length(reply.packageText) > ADAPT_LIMITS.packageBytes) return 'outputTooLarge'
      return reply.packageText.trim() === '' || !isWellFormedText(reply.packageText) ? 'invalidOutput' : null
    case 'question':
      if (reply.choices.length > ADAPT_LIMITS.choices) return 'invalidOutput'
      for (const choice of reply.choices) {
        if (choice.length > ADAPT_LIMITS.choiceChars) return 'outputTooLarge'
        if (!isPlainLine(choice, ADAPT_LIMITS.choiceChars)) return 'invalidOutput'
      }
      return null
    case 'unsupported':
      return reply.alternative === null ? null : prose(reply.alternative)
  }
}

/** The provider's complete final text as one reply, or why it is none. Never repaired. */
export function readFixtureAnswer(text: string): AdaptReply | AnswerFault {
  if (utf8Length(text) > MAX_ANSWER_BYTES) return 'outputTooLarge'
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return 'invalidOutput'
  }
  if (!isFields(value) || !hasOnly(value, ['kind', 'message', 'packageText', 'choices', 'alternative'])) return 'invalidOutput'
  const { kind, message, choices } = value
  const packageText = value.packageText ?? null
  const alternative = value.alternative ?? null
  if (typeof message !== 'string' || !Array.isArray(choices) || !choices.every(choice => typeof choice === 'string')
    || (packageText !== null && typeof packageText !== 'string') || (alternative !== null && typeof alternative !== 'string')) return 'invalidOutput'
  let reply: AdaptReply
  if (kind === 'candidate' && packageText !== null && choices.length === 0 && alternative === null) reply = { kind, message, packageText }
  else if (kind === 'question' && packageText === null && alternative === null) reply = { kind, message, choices }
  else if (kind === 'unsupported' && packageText === null && choices.length === 0) reply = { kind, message, alternative }
  else return 'invalidOutput'
  return checkReply(reply) ?? reply
}

type Outcome = { reply: AdaptReply } | { failure: AdaptFailure; resetsAt: string | null }

/** An unscripted Send fails as a provider that has nothing to answer. */
function stepOutcome(step: AdaptFixtureTurn | null): Outcome {
  if (step === null) return { failure: 'providerFailed', resetsAt: null }
  if ('failure' in step) {
    const resetsAt = step.failure === 'usageLimit' && isInstant(step.resetsAt) ? step.resetsAt : null
    return { failure: step.failure, resetsAt }
  }
  // A reply becomes the provider's schema envelope, so both kinds of step take native's one reader.
  const text = 'output' in step ? step.output : JSON.stringify({ packageText: null, choices: [], alternative: null, ...step.reply })
  const answer = readFixtureAnswer(text)
  return typeof answer === 'string' ? { failure: answer, resetsAt: null } : { reply: answer }
}

/** The contract's line controls: C0, C1, line and paragraph separators, direction overrides and isolates. */
function isControl(char: string): boolean {
  const code = char.charCodeAt(0)
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || (code >= 0x2028 && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)
}

/** check.rs `title_of`: the first non-blank line, one plain line within `labelChars`. */
function titleOf(request: string): string {
  const line = request.split('\n').map(part => part.replace(/\r$/, '').trim()).find(part => part !== '') ?? ''
  let title = ''
  for (const char of line.replaceAll('\t', ' ')) {
    if (isControl(char)) continue
    if (title.length + char.length > ADAPT_LIMITS.labelChars) break
    title += char
  }
  return title.trim()
}

// --- Host ------------------------------------------------------------------------------------------

/** A malformed argument. Native answers `Err`, which the frontend reads as no reply. */
export class AdaptArgumentError extends Error {}

type Account = Exclude<AdaptProviderState, { status: 'unavailable' }>
const CLAUDE: AdaptProviderState = { status: 'unavailable', reason: 'notAuthorized', installedVersion: null }

interface Running { turnId: string; visitId: string; phase: AdaptTurnPhase; stop: AdaptStopReason | null; epoch: number }
interface Stored {
  conversationId: string
  /** A digest of the vault path, never the path. */
  vault: string
  createdAt: string
  updatedAt: string
  title: string
  revision: number
  entries: AdaptEntry[]
  /** How the last local write of this conversation went; an outcome it lost stays in memory. */
  storage: AdaptStorageState
  /** Turn ids cancelled before their Send; past MAX_TOMBSTONES the conversation is sealed. */
  tombstones: string[]
  sealed: boolean
  running: Running | null
}
interface HostState {
  format: 1
  /** The script these steps came from, by digest; another script starts fresh. */
  script: string
  revision: number
  statusRevision: number
  /** Changes whenever the account may have; a turn admitted under another epoch delivers nothing. */
  epoch: number
  account: Account
  nextConnect: number
  nextTurn: number
  conversations: Stored[]
}

/** The page's provider: none, a fixture a test asked for whose script is broken, or that fixture. */
export type AdaptBrowserProvider =
  | { kind: 'none' }
  | { kind: 'broken' }
  | { kind: 'fixture'; script: AdaptFixtureScript; digest: string }

export interface AdaptBrowserHostOptions {
  provider: AdaptBrowserProvider
  /** Where fixture state survives a reload. Without a fixture there is no local Adapt storage. */
  storage: Storage | null
  /** Runs `run` after `ms`; answers a cancel. */
  schedule?: (run: () => void, ms: number) => () => void
}

/** `closing`: answers nothing but close until its turns are proven ended. */
interface Visit { vault: string; opened: number; closing: boolean }
interface Work { turnId: string; step: AdaptFixtureTurn | null; cancels: Array<() => void> }
interface ConnectWork { hold: boolean; finish: () => void; cancel: () => void }

const STORED_KEYS = ['conversationId', 'vault', 'createdAt', 'updatedAt', 'title', 'revision', 'entries', 'storage', 'tombstones', 'sealed', 'running']

function readStored(value: unknown): Stored | null {
  if (!isFields(value) || !hasExactly(value, STORED_KEYS)) return null
  const { conversationId, vault, createdAt, updatedAt, title, revision, entries, storage, tombstones, sealed, running } = value
  let turn: { turnId: string; phase: AdaptTurnPhase } | null = null
  if (running !== null) {
    if (!isFields(running) || !hasExactly(running, ['turnId', 'visitId', 'phase', 'stop', 'epoch'])) return null
    if (typeof running.visitId !== 'string' || !isCount(running.epoch) || !(running.stop === null || oneOf(ADAPT_STOP_REASONS, running.stop))) return null
    turn = { turnId: running.turnId as string, phase: running.phase as AdaptTurnPhase }
  }
  // The contract's own reader decides whether the transcript is one.
  const read = typeof conversationId === 'string'
    ? parseReadConversationReply({ status: 'ok', conversation: { conversationId, revision, entries, turn, storage } }, { visitId: 'visit', conversationId, knownRevision: null })
    : null
  const fits = read?.status === 'ok' && typeof vault === 'string' && /^[0-9a-f]{64}$/.test(vault) && isInstant(createdAt) && isInstant(updatedAt)
    && typeof title === 'string' && (title === '' || isPlainLine(title, ADAPT_LIMITS.labelChars))
    && Array.isArray(tombstones) && tombstones.length <= MAX_TOMBSTONES && tombstones.every(isTurnId) && typeof sealed === 'boolean'
  if (!fits) return null
  const { entries: transcript, storage: written } = read.conversation
  return {
    conversationId, vault, createdAt, updatedAt, title, revision: read.conversation.revision, entries: transcript, storage: written,
    tombstones: tombstones as string[], sealed, running: running as Running | null,
  } as Stored
}

/** Stored state for this script, or null when there is none or it breaks any rule. */
function readState(text: string | null, digest: string): HostState | null {
  if (text === null) return null
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isFields(value) || value.format !== 1 || value.script !== digest || !Array.isArray(value.conversations)) return null
  const { revision, statusRevision, epoch, nextConnect, nextTurn } = value
  if (![revision, statusRevision, epoch, nextConnect, nextTurn].every(isCount)) return null
  const account = parseStatusReply({ revision: 0, providers: { codex: value.account, claude: CLAUDE } })?.providers.codex
  const conversations = value.conversations.map(readStored)
  if (!account || account.status === 'unavailable' || conversations.includes(null)) return null
  return {
    format: 1, script: digest, revision: revision as number, statusRevision: statusRevision as number, epoch: epoch as number,
    account, nextConnect: nextConnect as number, nextTurn: nextTurn as number, conversations: conversations as Stored[],
  }
}

const defaultSchedule = (run: () => void, ms: number) => {
  const timer = setTimeout(run, ms)
  return () => clearTimeout(timer)
}
const now = () => new Date().toISOString()

export class AdaptBrowserHost {
  private readonly provider: AdaptBrowserProvider
  private readonly storage: Storage | null
  private readonly schedule: (run: () => void, ms: number) => () => void
  private state: HostState
  private readonly visits = new Map<string, Visit>()
  private opened = 0
  /** The in-page provider work of each running turn, by conversation. */
  private readonly work = new Map<string, Work>()
  private connecting: ConnectWork | null = null
  private readonly sentLog: AdaptFixtureEnvelope[] = []

  constructor(options: AdaptBrowserHostOptions) {
    this.provider = options.provider
    this.storage = options.provider.kind === 'fixture' ? options.storage : null
    this.schedule = options.schedule ?? defaultSchedule
    const digest = options.provider.kind === 'fixture' ? options.provider.digest : ''
    const account: Account = options.provider.kind === 'fixture' && options.provider.script.account === 'connected'
      ? { status: 'connected' }
      : { status: 'signedOut', lastConnect: null }
    this.state = this.readStorage(digest) ?? {
      format: 1, script: digest, revision: 0, statusRevision: 1, epoch: 0, account, nextConnect: 0, nextTurn: 0, conversations: [],
    }
    this.recoverFromReload()
  }

  private readStorage(digest: string): HostState | null {
    if (!this.storage) return null
    try {
      return readState(this.storage.getItem(ADAPT_FIXTURE_STATE_KEY), digest)
    } catch {
      return null
    }
  }

  /** Keeps the host's state for a reload; false when sessionStorage refused it. */
  private save(): boolean {
    if (!this.storage) return false
    try {
      this.storage.setItem(ADAPT_FIXTURE_STATE_KEY, JSON.stringify(this.state))
      return true
    } catch {
      return false
    }
  }

  /** Applies `change` and keeps it, or leaves the state exactly as it was: nothing written, nothing sent. */
  private commit(change: () => void): boolean {
    const before = copy(this.state)
    change()
    if (this.save()) return true
    this.state = before
    return false
  }

  /**
   * Writes `conversation` as shown and records how that went. `fault` is a scripted write that fails
   * or is not synced; the conversation stays in memory either way and its revision moves on, so a
   * poll sees the change.
   */
  private persist(conversation: Stored, fault: AdaptFixtureTurn['outcomeSave'] = undefined) {
    const before = conversation.storage
    conversation.storage = fault ?? 'saved'
    if (conversation.storage !== before) conversation.revision = this.next()
    if (this.save() || conversation.storage === 'unsaved') return
    conversation.storage = 'unsaved'
    conversation.revision = this.next()
  }

  /**
   * The page went away: its visits ended with it, and its in-page provider work too, so a turn
   * still running is stopped and proven ended. A sign-in in progress did not finish.
   */
  private recoverFromReload() {
    const { state } = this
    state.revision = Math.max(state.revision, ...state.conversations.map(conversation => conversation.revision))
    for (const conversation of state.conversations) {
      if (!conversation.running) continue
      const at = now()
      conversation.entries.push({ kind: 'stopped', turnId: conversation.running.turnId, at, reason: conversation.running.stop ?? 'visitClosed', confirmed: true })
      conversation.running = null
      conversation.updatedAt = at
      conversation.revision = this.next()
      this.persist(conversation)
    }
    if (state.account.status === 'connecting') this.setAccount({ status: 'signedOut', lastConnect: 'failed' })
  }

  private next(): number {
    this.state.revision += 1
    return this.state.revision
  }

  // --- Providers ----------------------------------------------------------------------------------

  private codex(): AdaptProviderState {
    if (this.provider.kind === 'none') return { status: 'unavailable', reason: 'notInstalled', installedVersion: null }
    if (this.provider.kind === 'broken') return { status: 'unavailable', reason: 'failed', installedVersion: null }
    return { ...this.state.account }
  }

  /** As native `set_account`: a different settled account is a new epoch. */
  private setAccount(account: Account) {
    if (JSON.stringify(account) === JSON.stringify(this.state.account)) return
    if (account.status !== 'connecting') this.state.epoch += 1
    this.state.account = account
    this.state.statusRevision += 1
    this.save()
  }

  status(): AdaptStatusReply {
    return { revision: this.state.statusRevision, providers: { codex: this.codex(), claude: { ...CLAUDE } } }
  }

  connect(args: AdaptConnectArgs): AdaptConnectReply {
    if (!isOpaqueToken(args.disclosureVersion)) throw new AdaptArgumentError('The disclosure version could not be read.')
    const refused = (reason: 'unavailable' | 'alreadyConnected' | 'busy' | 'browserUnavailable'): AdaptConnectReply => ({ status: 'refused', reason })
    const codex = this.codex()
    if (args.provider === 'claude' || codex.status === 'unavailable') return refused('unavailable')
    if (codex.status === 'connecting') return refused('busy')
    if (codex.status !== 'signedOut') return refused('alreadyConnected')
    const step = this.takeConnect()
    if (step?.result === 'browserUnavailable') {
      this.setAccount({ status: 'signedOut', lastConnect: null })
      return refused('browserUnavailable')
    }
    this.setAccount({ status: 'connecting' })
    const result = step?.result ?? 'failed'
    const finish = () => {
      this.connecting = null
      if (this.state.account.status !== 'connecting') return
      if (result === 'connected') this.setAccount({ status: 'connected' })
      else if (result === 'accountNotSupported') this.setAccount({ status: 'refused', reason: 'accountNotSupported' })
      else this.setAccount({ status: 'signedOut', lastConnect: 'failed' })
    }
    const hold = step?.hold === true
    this.connecting = { hold, finish, cancel: hold ? () => undefined : this.schedule(finish, ADAPT_FIXTURE_STEP_MS) }
    return { status: 'started' }
  }

  private takeConnect(): AdaptFixtureConnect | null {
    if (this.provider.kind !== 'fixture') return null
    const step = this.provider.script.connects?.[this.state.nextConnect] ?? null
    if (step) this.state.nextConnect += 1
    return step
  }

  cancelConnect(provider: AdaptProvider): AdaptCancelConnectReply {
    if (provider === 'claude' || !this.connecting) return { status: 'notConnecting' }
    this.connecting.cancel()
    this.connecting = null
    this.setAccount({ status: 'signedOut', lastConnect: 'cancelled' })
    return { status: 'cancelled' }
  }

  /**
   * Admission closes first (signed out, so every Send is refused `notConnected`), then every running
   * turn is cancelled (`accountChanged`). `stopping` until all of them are proven ended; asking
   * again answers `disconnected` once they are.
   */
  disconnect(provider: AdaptProvider): AdaptDisconnectReply {
    if (provider === 'claude' || this.codex().status === 'unavailable') return { status: 'refused', reason: 'unavailable' }
    this.connecting?.cancel()
    this.connecting = null
    this.setAccount({ status: 'signedOut', lastConnect: null })
    this.stopWhere('accountChanged', () => true)
    return { status: this.state.conversations.some(conversation => conversation.running) ? 'stopping' : 'disconnected' }
  }

  // --- Visits -------------------------------------------------------------------------------------

  /** A visit that is open, not closing. */
  private visit(visitId: string): Visit | null {
    const visit = this.visits.get(visitId)
    return visit && !visit.closing ? visit : null
  }

  /** Without a fixture the browser keeps no local Adapt data, so there is nothing to visit. */
  openVisit(vaultPath: string): AdaptOpenVisitReply {
    if (this.provider.kind !== 'fixture' || !this.save()) return { status: 'refused', reason: 'storageUnavailable' }
    if (vaultPath.trim() === '') return { status: 'refused', reason: 'vaultUnavailable' }
    // Opening another visit in the same page closes its oldest open one.
    const open = [...this.visits].filter(([, visit]) => !visit.closing).sort((a, b) => a[1].opened - b[1].opened)
    for (const [visitId] of open.slice(0, Math.max(0, open.length - MAX_VISITS + 1))) this.endVisit(visitId)
    const visitId = `visit-${crypto.randomUUID()}`
    this.opened += 1
    this.visits.set(visitId, { vault: sha256(vaultPath), opened: this.opened, closing: false })
    return { status: 'open', visitId }
  }

  /** Cancels the visit's turns (`visitClosed`); `closed` once all are proven ended, `stopping` until then. */
  closeVisit(visitId: string): AdaptCloseVisitReply {
    if (!this.visits.has(visitId)) return { status: 'unknown' }
    return this.endVisit(visitId) ? { status: 'closed' } : { status: 'stopping' }
  }

  /** Closes the visit; true once none of its turns is still running, when it is gone. */
  private endVisit(visitId: string): boolean {
    const visit = this.visits.get(visitId)
    if (visit) visit.closing = true
    this.stopWhere('visitClosed', running => running.visitId === visitId)
    if (this.state.conversations.some(conversation => conversation.running?.visitId === visitId)) return false
    this.visits.delete(visitId)
    return true
  }

  // --- Conversations ------------------------------------------------------------------------------

  private find(visitId: string, conversationId: string): { visit: true; conversation: Stored | null } | { visit: false } {
    const visit = this.visit(visitId)
    if (!visit) return { visit: false }
    const conversation = this.state.conversations.find(item => item.conversationId === conversationId && item.vault === visit.vault)
    return { visit: true, conversation: conversation ?? null }
  }

  listConversations(visitId: string): AdaptListConversationsReply {
    const visit = this.visit(visitId)
    if (!visit) return { status: 'unknownVisit' }
    const conversations: AdaptConversationSummary[] = this.state.conversations
      .filter(conversation => conversation.vault === visit.vault)
      .map(conversation => ({
        conversationId: conversation.conversationId, updatedAt: conversation.updatedAt, title: conversation.title,
        turns: conversation.entries.filter(entry => entry.kind === 'request').length, running: conversation.running !== null,
      }))
      .sort((a, b) => (a.updatedAt === b.updatedAt ? a.conversationId.localeCompare(b.conversationId) : a.updatedAt < b.updatedAt ? 1 : -1))
    return { status: 'ok', conversations: conversations.slice(0, ADAPT_LIMITS.conversationsPerVault) }
  }

  /** At the limit, only an empty conversation that was never sent may make room. */
  newConversation(visitId: string): AdaptNewConversationReply {
    const visit = this.visit(visitId)
    if (!visit) return { status: 'unknownVisit' }
    const mine = this.state.conversations.filter(conversation => conversation.vault === visit.vault)
    let placeholder: Stored | undefined
    if (mine.length >= ADAPT_LIMITS.conversationsPerVault) {
      placeholder = mine.filter(conversation => conversation.entries.length === 0 && conversation.running === null)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0]
      if (!placeholder) return { status: 'refused', reason: 'conversationLimit' }
    }
    const at = now()
    const conversationId = `conversation-${crypto.randomUUID()}`
    const kept = this.commit(() => {
      this.state.conversations = this.state.conversations.filter(conversation => conversation !== placeholder)
      this.state.conversations.push({
        conversationId, vault: visit.vault, createdAt: at, updatedAt: at, title: '', revision: this.next(),
        entries: [], storage: 'saved', tombstones: [], sealed: false, running: null,
      })
    })
    return kept ? { status: 'created', conversationId } : { status: 'refused', reason: 'storageUnavailable' }
  }

  readConversation(args: AdaptReadConversationArgs): AdaptReadConversationReply {
    const found = this.find(args.visitId, args.conversationId)
    if (!found.visit) return { status: 'unknownVisit' }
    const { conversation } = found
    if (!conversation) return { status: 'unknownConversation' }
    if (args.knownRevision === conversation.revision) return { status: 'unchanged', revision: conversation.revision }
    const { conversationId, revision, entries, running, storage } = conversation
    return { status: 'ok', conversation: copy({ conversationId, revision, entries, turn: running && { turnId: running.turnId, phase: running.phase }, storage }) }
  }

  /** Removes the local record only; a running turn must be stopped first. */
  deleteConversation(visitId: string, conversationId: string): AdaptDeleteConversationReply {
    const found = this.find(visitId, conversationId)
    if (!found.visit) return { status: 'unknownVisit' }
    const { conversation } = found
    if (!conversation) return { status: 'unknownConversation' }
    if (conversation.running) return { status: 'refused', reason: 'running' }
    const kept = this.commit(() => {
      this.state.conversations = this.state.conversations.filter(item => item !== conversation)
    })
    return kept ? { status: 'deleted' } : { status: 'refused', reason: 'storageUnavailable' }
  }

  /** Writes the conversation as shown, locally only: no provider, no turn repeated. */
  saveConversation(visitId: string, conversationId: string): AdaptSaveConversationReply {
    const found = this.find(visitId, conversationId)
    if (!found.visit) return { status: 'unknownVisit' }
    const { conversation } = found
    if (!conversation) return { status: 'unknownConversation' }
    this.persist(conversation)
    return { status: conversation.storage }
  }

  // --- Turns --------------------------------------------------------------------------------------

  /** Native `send`, in its order: the first rule broken is the refusal. */
  send(args: AdaptSendArgs): AdaptSendReply {
    const refused = (reason: Extract<AdaptSendReply, { status: 'refused' }>['reason']): AdaptSendReply => ({ status: 'refused', reason })
    const found = this.find(args.visitId, args.conversationId)
    if (!found.visit) return refused('unknownVisit')
    const { conversation } = found
    if (!conversation) return refused('unknownConversation')
    const invalid = checkSendArgs(args)
    if (invalid) return refused(invalid)
    if (conversation.tombstones.includes(args.turnId)) return refused('cancelled')
    if (conversation.entries.some(entry => entry.turnId === args.turnId)) return refused('replayed')
    if (conversation.running || conversation.sealed) return refused('busy')
    if (conversation.entries.filter(entry => entry.kind === 'request').length >= ADAPT_LIMITS.turnsPerConversation) return refused('conversationFull')
    const codex = this.codex()
    if (args.provider === 'claude' || codex.status === 'unavailable') return refused('providerUnavailable')
    if (codex.status !== 'connected') return refused('notConnected')

    // The named turns must be finished turns of this conversation; their visible text is resent.
    const earlierTurns: AdaptFixtureEnvelope['earlierTurns'] = []
    for (const turnId of args.includeTurnIds) {
      const request = conversation.entries.find(entry => entry.kind === 'request' && entry.turnId === turnId)
      const outcome = conversation.entries.find(entry => entry.kind !== 'request' && entry.turnId === turnId)
      if (request?.kind !== 'request' || !outcome) return refused('invalidRequest')
      earlierTurns.push({ turnId, request: request.text, reply: outcome.kind === 'reply' ? outcome.reply : null })
    }
    const replyBytes = (reply: AdaptReply | null) => reply === null ? 0 : utf8Length(reply.message)
      + (reply.kind === 'candidate' ? utf8Length(reply.packageText) : reply.kind === 'question' ? reply.choices.reduce((sum, choice) => sum + utf8Length(choice), 0) : utf8Length(reply.alternative ?? ''))
    const total = utf8Length(args.request) + args.attachments.reduce((sum, item) => sum + utf8Length(item.text), 0)
      + earlierTurns.reduce((sum, turn) => sum + utf8Length(turn.request) + replyBytes(turn.reply), 0)
    if (total > ADAPT_LIMITS.payloadBytes) return refused('tooLarge')

    const script = this.provider.kind === 'fixture' ? this.provider.script.turns ?? [] : []
    const step = script[this.state.nextTurn] ?? null
    const at = now()
    // The whole record is written with the request, so an outcome an earlier write lost is saved too.
    const kept = this.commit(() => {
      if (step) this.state.nextTurn += 1
      conversation.entries.push({
        kind: 'request', turnId: args.turnId, at, provider: args.provider, text: args.request,
        attachments: args.attachments.map(item => ({ kind: item.kind, label: item.label, bytes: utf8Length(item.text), sha256: sha256(item.text) })),
        includedTurnIds: [...args.includeTurnIds],
        // Stored and returned exactly as given: the UI's activation compare-and-set reads it back.
        revision: args.revision && {
          packageId: args.revision.packageId, baseSha256: args.revision.baseSha256, expectedActiveSha256: args.revision.expectedActiveSha256,
        },
        guide: ADAPT_FIXTURE_GUIDE,
      })
      if (conversation.title === '') conversation.title = titleOf(args.request)
      conversation.updatedAt = at
      conversation.storage = 'saved'
      conversation.running = { turnId: args.turnId, visitId: args.visitId, phase: 'sending', stop: null, epoch: this.state.epoch }
      conversation.revision = this.next()
    })
    if (!kept) return refused('storageUnavailable')

    this.sentLog.push(copy({
      turnId: args.turnId, provider: args.provider, request: args.request, attachments: args.attachments, earlierTurns,
      // As native's prompt: the package being changed, never the local compare-and-set value.
      changePackage: args.revision && { packageId: args.revision.packageId, baseSha256: args.revision.baseSha256 }, guide: ADAPT_FIXTURE_GUIDE,
    }))
    this.sentLog.splice(0, this.sentLog.length - ADAPT_FIXTURE_LIMITS.sent)
    this.start(conversation.conversationId, args.turnId, step)
    return { status: 'admitted', turnId: args.turnId }
  }

  /** Host-known phases only: `working`, then `checking` unless held, then the outcome. */
  private start(conversationId: string, turnId: string, step: AdaptFixtureTurn | null) {
    const work: Work = { turnId, step, cancels: [] }
    this.work.set(conversationId, work)
    work.cancels.push(this.schedule(() => this.setPhase(conversationId, turnId, 'working'), ADAPT_FIXTURE_STEP_MS))
    if (step?.hold) return
    work.cancels.push(this.schedule(() => this.setPhase(conversationId, turnId, 'checking'), 2 * ADAPT_FIXTURE_STEP_MS))
    work.cancels.push(this.schedule(() => this.finish(conversationId, turnId), 3 * ADAPT_FIXTURE_STEP_MS))
  }

  private running(conversationId: string, turnId: string): Stored | null {
    const conversation = this.state.conversations.find(item => item.conversationId === conversationId)
    return conversation?.running?.turnId === turnId ? conversation : null
  }

  /** Phases are host memory, not the local record: nothing is written for them. */
  private setPhase(conversationId: string, turnId: string, phase: AdaptTurnPhase) {
    const conversation = this.running(conversationId, turnId)
    if (!conversation?.running || conversation.running.stop !== null || conversation.running.phase === phase) return
    conversation.running.phase = phase
    conversation.revision = this.next()
    this.save()
  }

  /**
   * The provider work ended. Its outcome is admitted only while the turn is not stopped and under
   * the same account; it is kept in memory even when its local write fails.
   */
  private finish(conversationId: string, turnId: string) {
    const conversation = this.running(conversationId, turnId)
    const work = this.work.get(conversationId)
    if (work?.turnId === turnId) {
      work.cancels.forEach(cancel => cancel())
      this.work.delete(conversationId)
    }
    if (!conversation?.running) return
    const step = work?.turnId === turnId ? work.step : null
    const { running } = conversation
    const at = now()
    let entry: AdaptEntry
    let signOut = false
    if (running.stop) entry = { kind: 'stopped', turnId, at, reason: running.stop, confirmed: true }
    else if (running.epoch !== this.state.epoch) entry = { kind: 'stopped', turnId, at, reason: 'accountChanged', confirmed: true }
    else {
      const outcome = stepOutcome(step)
      entry = 'reply' in outcome
        ? { kind: 'reply', turnId, at, reply: outcome.reply }
        : { kind: 'failed', turnId, at, reason: outcome.failure, resetsAt: outcome.resetsAt }
      signOut = 'failure' in outcome && outcome.failure === 'notConnected'
    }
    conversation.entries.push(entry)
    conversation.running = null
    conversation.updatedAt = at
    conversation.revision = this.next()
    this.persist(conversation, step?.outcomeSave)
    // As native: a provider that says it is signed out is signed out.
    if (signOut) this.setAccount({ status: 'signedOut', lastConnect: null })
  }

  /** Closes admission for every matching running turn; its provider work ends now unless its stop is slow. */
  private stopWhere(reason: AdaptStopReason, matches: (running: Running, conversation: Stored) => boolean) {
    for (const conversation of this.state.conversations) {
      const { running } = conversation
      if (!running || !matches(running, conversation)) continue
      if (running.stop === null) {
        running.stop = reason
        running.phase = 'stopping'
        conversation.revision = this.next()
        this.save()
      }
      if (!this.work.get(conversation.conversationId)?.step?.slowStop) this.finish(conversation.conversationId, running.turnId)
    }
  }

  /** Only the named conversation's turn, through an open visit of its vault; `stopped` once proven ended. */
  cancelTurn(args: AdaptCancelTurnArgs): AdaptCancelTurnReply {
    const found = this.find(args.visitId, args.conversationId)
    if (!found.visit) return { status: 'unknownVisit' }
    const { conversation } = found
    if (!conversation) return { status: 'unknownConversation' }
    if (conversation.running?.turnId !== args.turnId) {
      if (conversation.entries.some(entry => entry.kind === 'request' && entry.turnId === args.turnId)) return { status: 'finished' }
      // Never admitted: remember it so its Send is refused. An id that is no turn id can never be.
      if (isTurnId(args.turnId) && !conversation.tombstones.includes(args.turnId)) {
        if (conversation.tombstones.length >= MAX_TOMBSTONES) conversation.sealed = true
        else conversation.tombstones.push(args.turnId)
        this.save()
      }
      return { status: 'stopped' }
    }
    this.stopWhere('cancelled', (running, item) => item === conversation && running.turnId === args.turnId)
    return { status: conversation.running ? 'stopping' : 'stopped' }
  }

  // --- Fixture controls ---------------------------------------------------------------------------

  release(): number {
    let released = 0
    if (this.connecting?.hold) {
      this.connecting.finish()
      released += 1
    }
    for (const [conversationId, work] of [...this.work]) {
      const conversation = this.running(conversationId, work.turnId)
      if (!conversation?.running || !(work.step?.hold || conversation.running.stop !== null)) continue
      this.finish(conversationId, work.turnId)
      released += 1
    }
    return released
  }

  sent(): AdaptFixtureEnvelope[] {
    return copy(this.sentLog)
  }

  // --- Dispatch -----------------------------------------------------------------------------------

  /** One command as invoked, `{ args }`; arguments that are not exactly the typed ones are rejected. */
  handle(command: string, payload: unknown): unknown {
    const args = isFields(payload) && isFields(payload.args) ? payload.args : null
    const rule = Object.hasOwn(ARGUMENTS, command) ? Reflect.get(ARGUMENTS, command) as (value: Fields) => boolean : null
    if (!args || !rule?.(args)) throw new AdaptArgumentError(`The arguments of ${command} could not be read.`)
    const text = (key: string) => Reflect.get(args, key) as string
    switch (command as AdaptCommandName) {
      case ADAPT_COMMANDS.status: return this.status()
      case ADAPT_COMMANDS.connect: return this.connect(args as unknown as AdaptConnectArgs)
      case ADAPT_COMMANDS.cancelConnect: return this.cancelConnect(text('provider') as AdaptProvider)
      case ADAPT_COMMANDS.disconnect: return this.disconnect(text('provider') as AdaptProvider)
      case ADAPT_COMMANDS.openVisit: return this.openVisit(text('vaultPath'))
      case ADAPT_COMMANDS.closeVisit: return this.closeVisit(text('visitId'))
      case ADAPT_COMMANDS.listConversations: return this.listConversations(text('visitId'))
      case ADAPT_COMMANDS.newConversation: return this.newConversation(text('visitId'))
      case ADAPT_COMMANDS.readConversation: return this.readConversation(args as unknown as AdaptReadConversationArgs)
      case ADAPT_COMMANDS.deleteConversation: return this.deleteConversation(text('visitId'), text('conversationId'))
      case ADAPT_COMMANDS.saveConversation: return this.saveConversation(text('visitId'), text('conversationId'))
      case ADAPT_COMMANDS.send: return this.send(args as unknown as AdaptSendArgs)
      case ADAPT_COMMANDS.cancelTurn: return this.cancelTurn(args as unknown as AdaptCancelTurnArgs)
    }
  }
}

// --- Arguments (native deserializes each with unknown fields denied) ---------------------------------

const isText = (value: unknown) => typeof value === 'string'
const isProvider = (value: unknown) => oneOf(ADAPT_PROVIDERS, value)
const exactly = (keys: string[], rules: Record<string, (value: unknown) => boolean> = {}) => (args: Fields) =>
  hasExactly(args, keys) && keys.every(key => (rules[key] ?? isText)(args[key]))
const isAttachment = (value: unknown) => isFields(value) && exactly(['kind', 'label', 'text'], { kind: kind => oneOf(ADAPT_ATTACHMENT_KINDS, kind) })(value)
/** Native's `RevisionBase`: all three keys present, `expectedActiveSha256` a string or null; its hash rules are `checkSendArgs`. */
const isRevisionShape = (value: unknown) => value === null
  || (isFields(value) && exactly(['packageId', 'baseSha256', 'expectedActiveSha256'], { expectedActiveSha256: active => active === null || isText(active) })(value))

const ARGUMENTS: Record<AdaptCommandName, (args: Fields) => boolean> = {
  [ADAPT_COMMANDS.status]: exactly([]),
  [ADAPT_COMMANDS.connect]: exactly(['provider', 'disclosureVersion'], { provider: isProvider }),
  [ADAPT_COMMANDS.cancelConnect]: exactly(['provider'], { provider: isProvider }),
  [ADAPT_COMMANDS.disconnect]: exactly(['provider'], { provider: isProvider }),
  [ADAPT_COMMANDS.openVisit]: exactly(['vaultPath']),
  [ADAPT_COMMANDS.closeVisit]: exactly(['visitId']),
  [ADAPT_COMMANDS.listConversations]: exactly(['visitId']),
  [ADAPT_COMMANDS.newConversation]: exactly(['visitId']),
  [ADAPT_COMMANDS.readConversation]: exactly(['visitId', 'conversationId', 'knownRevision'], { knownRevision: value => value === null || isCount(value) }),
  [ADAPT_COMMANDS.deleteConversation]: exactly(['visitId', 'conversationId']),
  [ADAPT_COMMANDS.saveConversation]: exactly(['visitId', 'conversationId']),
  [ADAPT_COMMANDS.send]: exactly(['visitId', 'conversationId', 'turnId', 'provider', 'request', 'attachments', 'includeTurnIds', 'revision'], {
    provider: isProvider,
    attachments: value => Array.isArray(value) && value.every(isAttachment),
    includeTurnIds: value => Array.isArray(value) && value.every(isText),
    revision: isRevisionShape,
  }),
  [ADAPT_COMMANDS.cancelTurn]: exactly(['visitId', 'conversationId', 'turnId']),
}

// --- The page's host -------------------------------------------------------------------------------

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

/**
 * The page's host. The fixture only when a test wrote its script and the page runs on the dev
 * server; anything else has no provider. Read once: a script written later takes a reload.
 */
export function browserAdaptHost(dev: boolean = import.meta.env.DEV, storage: Storage | null = sessionStore()): AdaptBrowserHost {
  let text: string | null = null
  try {
    text = dev && storage ? storage.getItem(ADAPT_FIXTURE_KEY) : null
  } catch {
    text = null
  }
  if (text === null || !storage) return new AdaptBrowserHost({ provider: { kind: 'none' }, storage: null })
  const script = readAdaptFixtureScript(text)
  if (!script) {
    console.warn(`[mock-tauri] The Adapt fixture script breaks a rule of ${ADAPT_FIXTURE_FORMAT}, so the browser provider is unavailable.`)
    return new AdaptBrowserHost({ provider: { kind: 'broken' }, storage: null })
  }
  const host = new AdaptBrowserHost({ provider: { kind: 'fixture', script, digest: sha256(text) }, storage })
  if (typeof window !== 'undefined') window.__leadinglightAdaptFixture = { release: () => host.release(), sent: () => host.sent() }
  return host
}
