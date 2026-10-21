import { describe, expect, it } from 'vitest'
import {
  ADAPT_LIMITS,
  checkSendArgs,
  parseAdaptReply,
  parseCancelTurnReply,
  parseCloseVisitReply,
  parseDisconnectReply,
  parseListConversationsReply,
  parseSaveConversationReply,
  parseNewConversationReply,
  parseReadConversationReply,
  parseSendReply,
  parseStatusReply,
  type AdaptReadConversationArgs,
  type AdaptSendArgs,
} from './adaptContract'

const TURN_1 = '11111111-1111-4111-8111-111111111111'
const TURN_2 = '22222222-2222-4222-8222-222222222222'
const TURN_3 = '33333333-3333-4333-8333-333333333333'
const SHA = 'a'.repeat(64)
const AT = '2026-10-20T10:00:00Z'
const LONE_SURROGATE = String.fromCharCode(0xd800)
const RIGHT_TO_LEFT_OVERRIDE = String.fromCharCode(0x202e)

function send(overrides: Partial<AdaptSendArgs> = {}): AdaptSendArgs {
  return {
    visitId: 'visit-1',
    conversationId: 'conversation-1',
    turnId: TURN_3,
    provider: 'codex',
    request: 'A weekly review with three questions',
    attachments: [{ kind: 'pastedText', label: 'Pasted text', text: 'What went well?' }],
    includeTurnIds: [TURN_1],
    revision: null,
    ...overrides,
  }
}

const request = (turnId: string, includedTurnIds: string[] = []) => ({
  kind: 'request', turnId, at: AT, provider: 'codex', text: 'Make a reading reflection',
  attachments: [{ kind: 'pageSnapshot', label: 'Current page', bytes: 12, sha256: SHA }],
  includedTurnIds, revision: null, guide: 'extensions-guide-1',
})
const reply = (turnId: string) => ({
  kind: 'reply', turnId, at: AT,
  reply: { kind: 'question', message: 'Should the note include the author?', choices: ['Yes', 'No'] },
})

const READ: AdaptReadConversationArgs = { visitId: 'visit-1', conversationId: 'conversation-1', knownRevision: null }
const conversation = (entries: unknown[], turn: unknown = null, storage: unknown = 'saved') => ({
  status: 'ok', conversation: { conversationId: 'conversation-1', revision: 7, entries, turn, storage },
})

describe('what a Send may carry', () => {
  it('accepts a request with visible context and names what is too large', () => {
    expect(checkSendArgs(send())).toBeNull()
    expect(checkSendArgs(send({ request: 'x'.repeat(ADAPT_LIMITS.requestBytes + 1) }))).toBe('tooLarge')
    const big = { kind: 'pageSnapshot' as const, label: 'Page', text: 'y'.repeat(ADAPT_LIMITS.attachmentBytes) }
    expect(checkSendArgs(send({ attachments: [big, big, big, big] }))).toBe('tooLarge')
    expect(checkSendArgs(send({ attachments: [{ ...big, text: 'y'.repeat(ADAPT_LIMITS.attachmentBytes + 1) }] }))).toBe('tooLarge')
  })

  it('refuses text native cannot receive and context that is not earlier and visible', () => {
    expect(checkSendArgs(send({ request: `Hello ${LONE_SURROGATE}` }))).toBe('invalidRequest')
    expect(checkSendArgs(send({ request: '   ' }))).toBe('invalidRequest')
    expect(checkSendArgs(send({ attachments: [{ kind: 'pastedText', label: 'Two\nlines', text: 'x' }] }))).toBe('invalidRequest')
    expect(checkSendArgs(send({ includeTurnIds: [TURN_1, TURN_1] }))).toBe('invalidRequest')
    expect(checkSendArgs(send({ includeTurnIds: [TURN_3] }))).toBe('invalidRequest')
    expect(checkSendArgs(send({ turnId: 'not-a-uuid' }))).toBe('invalidRequest')
    expect(checkSendArgs(send({ revision: { packageId: 'local.weekly-review', baseSha256: 'ABC', expectedActiveSha256: null } }))).toBe('invalidRequest')
    const many = Array.from({ length: ADAPT_LIMITS.attachments + 1 }, () => ({ kind: 'pastedText' as const, label: 'Text', text: 'x' }))
    expect(checkSendArgs(send({ attachments: many }))).toBe('invalidRequest')
  })
})

describe('a revision keeps the version that was active when it was asked for', () => {
  const OTHER_SHA = 'c'.repeat(64)
  const base = (expectedActiveSha256: unknown) => ({ packageId: 'local.weekly-review', baseSha256: SHA, expectedActiveSha256 })
  const missing = { packageId: 'local.weekly-review', baseSha256: SHA }
  const withRevision = (revision: unknown) => send({ revision: revision as AdaptSendArgs['revision'] })

  it('sends an explicit expected version, none, or no revision at all', () => {
    expect(checkSendArgs(withRevision(base(null)))).toBeNull()
    expect(checkSendArgs(withRevision(base(OTHER_SHA)))).toBeNull()
    expect(checkSendArgs(send({ revision: null }))).toBeNull()
  })

  it('never guesses a missing or malformed expected version', () => {
    for (const revision of [missing, base('ABC'), base(''), base(undefined), { ...base(null), activeSha256: null }]) {
      expect(checkSendArgs(withRevision(revision))).toBe('invalidRequest')
    }
  })

  it('reads the stored request with its original expected version, unchanged', () => {
    const asked = (revision: unknown) => conversation([{ ...request(TURN_1), revision }, reply(TURN_1)])
    for (const expected of [OTHER_SHA, null]) {
      const parsed = parseReadConversationReply(asked(base(expected)), READ)
      const stored = parsed?.status === 'ok' ? parsed.conversation.entries[0] : null
      expect(stored?.kind === 'request' && stored.revision).toEqual(base(expected))
    }
    expect(parseReadConversationReply(asked(missing), READ)).toBeNull()
    expect(parseReadConversationReply(asked(base('not-a-hash')), READ)).toBeNull()
    expect(parseReadConversationReply(asked(null), READ)).not.toBeNull()
  })
})

describe('reading provider status', () => {
  const signedOut = { status: 'signedOut', lastConnect: null }
  const claude = { status: 'unavailable', reason: 'notAuthorized', installedVersion: null }

  it('reads the explicit states', () => {
    expect(parseStatusReply({ revision: 3, providers: { codex: { status: 'connected' }, claude } })).toEqual({
      revision: 3, providers: { codex: { status: 'connected' }, claude },
    })
    expect(parseStatusReply({ revision: 1, providers: { codex: { status: 'unavailable', reason: 'unsupportedVersion', installedVersion: '0.153.4' }, claude } }))
      .not.toBeNull()
    expect(parseStatusReply({ revision: 1, providers: { codex: signedOut, claude } })).not.toBeNull()
  })

  it('treats any account detail or unknown state as no reply', () => {
    expect(parseStatusReply({ revision: 3, providers: { codex: { status: 'connected', email: 'someone@example.com' }, claude } })).toBeNull()
    expect(parseStatusReply({ revision: 3, providers: { codex: { status: 'connected', planType: 'plus' }, claude } })).toBeNull()
    expect(parseStatusReply({ revision: 3, providers: { codex: { status: 'ready' }, claude } })).toBeNull()
    expect(parseStatusReply({ revision: -1, providers: { codex: signedOut, claude } })).toBeNull()
    expect(parseStatusReply({ revision: 1, providers: { codex: signedOut } })).toBeNull()
  })
})

describe('reading a conversation snapshot', () => {
  it('reads finished turns and the running one', () => {
    const parsed = parseReadConversationReply(
      conversation([request(TURN_1), reply(TURN_1), request(TURN_2, [TURN_1])], { turnId: TURN_2, phase: 'working' }),
      READ,
    )
    expect(parsed?.status).toBe('ok')
    if (parsed?.status !== 'ok') return
    expect(parsed.conversation.entries).toHaveLength(3)
    expect(parsed.conversation.turn).toEqual({ turnId: TURN_2, phase: 'working' })
  })

  it('refuses a history that could not have happened', () => {
    const cases: [string, unknown[], unknown][] = [
      ['an outcome without its request', [reply(TURN_1)], null],
      ['two requests waiting', [request(TURN_1), request(TURN_2)], { turnId: TURN_2, phase: 'working' }],
      ['a waiting request with no running turn', [request(TURN_1)], null],
      ['a running turn after its outcome', [request(TURN_1), reply(TURN_1)], { turnId: TURN_1, phase: 'checking' }],
      ['context from a later turn', [request(TURN_1, [TURN_2]), reply(TURN_1)], null],
      ['a turn id used twice', [request(TURN_1), reply(TURN_1), request(TURN_1), reply(TURN_1)], null],
    ]
    for (const [name, entries, turn] of cases) {
      expect(parseReadConversationReply(conversation(entries, turn), READ), name).toBeNull()
    }
  })

  it('says whether what it shows is saved locally', () => {
    const shown = [request(TURN_1), reply(TURN_1)]
    for (const storage of ['saved', 'unconfirmed', 'unsaved'] as const) {
      const parsed = parseReadConversationReply(conversation(shown, null, storage), READ)
      expect(parsed?.status === 'ok' && parsed.conversation.storage).toBe(storage)
    }
    expect(parseReadConversationReply(conversation(shown, null, 'probably'), READ)).toBeNull()
    const withoutStorage = { status: 'ok', conversation: { conversationId: 'conversation-1', revision: 7, entries: shown, turn: null } }
    expect(parseReadConversationReply(withoutStorage, READ)).toBeNull()
  })

  it('answers only for the conversation and revision asked about', () => {
    const other = { status: 'ok', conversation: { conversationId: 'conversation-2', revision: 7, entries: [], turn: null, storage: 'saved' } }
    expect(parseReadConversationReply(other, READ)).toBeNull()
    expect(parseReadConversationReply({ status: 'unchanged', revision: 7 }, { ...READ, knownRevision: 7 })).toEqual({ status: 'unchanged', revision: 7 })
    expect(parseReadConversationReply({ status: 'unchanged', revision: 7 }, { ...READ, knownRevision: 6 })).toBeNull()
  })

  it('keeps a usage-limit reset only when the provider gave one', () => {
    const failed = (reason: string, resetsAt: string | null) => conversation([request(TURN_1), { kind: 'failed', turnId: TURN_1, at: AT, reason, resetsAt }])
    expect(parseReadConversationReply(failed('usageLimit', '2026-10-20T14:30:00Z'), READ)).not.toBeNull()
    expect(parseReadConversationReply(failed('usageLimit', null), READ)).not.toBeNull()
    expect(parseReadConversationReply(failed('timedOut', '2026-10-20T14:30:00Z'), READ)).toBeNull()
    expect(parseReadConversationReply(failed('retrying', null), READ)).toBeNull()
  })

  it('reads a stop with whether it was proven', () => {
    const stopped = conversation([request(TURN_1), { kind: 'stopped', turnId: TURN_1, at: AT, reason: 'accountChanged', confirmed: false }])
    expect(parseReadConversationReply(stopped, READ)).not.toBeNull()
  })
})

describe('reading the model reply', () => {
  it('reads the three shapes and nothing else', () => {
    expect(parseAdaptReply({ kind: 'candidate', message: 'Here is a weekly review.', packageText: '{}' })).not.toBeNull()
    expect(parseAdaptReply({ kind: 'unsupported', message: 'Extensions cannot set reminders.', alternative: 'A follow-up note.' })).not.toBeNull()
    expect(parseAdaptReply({ kind: 'unsupported', message: 'Extensions cannot set reminders.', alternative: null })).not.toBeNull()
    expect(parseAdaptReply({ kind: 'script', message: 'Run this.' })).toBeNull()
    expect(parseAdaptReply({ kind: 'candidate', message: 'Here.', packageText: '{}', open: true })).toBeNull()
  })

  it('bounds what can be shown', () => {
    const candidate = (packageText: string, message = 'Here.') => ({ kind: 'candidate', message, packageText })
    expect(parseAdaptReply(candidate('x'.repeat(ADAPT_LIMITS.packageBytes + 1)))).toBeNull()
    expect(parseAdaptReply(candidate('{}', 'm'.repeat(ADAPT_LIMITS.messageChars + 1)))).toBeNull()
    expect(parseAdaptReply(candidate('{}', `Safe ${RIGHT_TO_LEFT_OVERRIDE}txt.exe`))).toBeNull()
    expect(parseAdaptReply(candidate('{}', `Bell${String.fromCharCode(7)}`))).toBeNull()
    expect(parseAdaptReply({ kind: 'question', message: 'Which one?', choices: ['A', 'B', 'C', 'D'] })).toBeNull()
    expect(parseAdaptReply({ kind: 'question', message: 'Which one?', choices: ['A\nB'] })).toBeNull()
  })
})

describe('reading turn replies', () => {
  it('admits only an echo of this turn', () => {
    expect(parseSendReply({ status: 'admitted', turnId: TURN_3 }, send())).toEqual({ status: 'admitted', turnId: TURN_3 })
    expect(parseSendReply({ status: 'admitted', turnId: TURN_2 }, send())).toBeNull()
    expect(parseSendReply({ status: 'refused', reason: 'cancelled' }, send())).toEqual({ status: 'refused', reason: 'cancelled' })
    expect(parseSendReply({ status: 'refused', reason: 'later' }, send())).toBeNull()
  })

  it('keeps cancel outcomes distinct', () => {
    expect(parseCancelTurnReply({ status: 'stopping' })).toEqual({ status: 'stopping' })
    expect(parseCancelTurnReply({ status: 'stopped', confirmed: true })).toBeNull()
  })

  it('keeps unproven endings distinct from finished ones', () => {
    expect(parseCloseVisitReply({ status: 'stopping' })).toEqual({ status: 'stopping' })
    expect(parseCloseVisitReply({ status: 'closed' })).toEqual({ status: 'closed' })
    expect(parseCloseVisitReply({ status: 'closing' })).toBeNull()
    expect(parseDisconnectReply({ status: 'stopping' })).toEqual({ status: 'stopping' })
    expect(parseDisconnectReply({ status: 'refused', reason: 'failed' })).toEqual({ status: 'refused', reason: 'failed' })
    expect(parseDisconnectReply({ status: 'stopping', reason: 'failed' })).toBeNull()
  })

  it('reads a local save as local storage states only', () => {
    expect(parseSaveConversationReply({ status: 'unsaved' })).toEqual({ status: 'unsaved' })
    expect(parseSaveConversationReply({ status: 'unknownConversation' })).toEqual({ status: 'unknownConversation' })
    expect(parseSaveConversationReply({ status: 'admitted' })).toBeNull()
  })

  it('says plainly when a vault has no room for another conversation', () => {
    expect(parseNewConversationReply({ status: 'refused', reason: 'conversationLimit' })).toEqual({ status: 'refused', reason: 'conversationLimit' })
    expect(parseNewConversationReply({ status: 'created', conversationId: 'conversation-9' })).toEqual({ status: 'created', conversationId: 'conversation-9' })
    expect(parseNewConversationReply({ status: 'refused', reason: 'evictedOldest' })).toBeNull()
    expect(parseNewConversationReply({ status: 'created', conversationId: 'conversation-9', evicted: 'conversation-1' })).toBeNull()
  })

  it('lists conversations once each', () => {
    const summary = { conversationId: 'conversation-1', updatedAt: AT, title: 'Weekly review', turns: 2, running: false }
    expect(parseListConversationsReply({ status: 'ok', conversations: [summary] })).not.toBeNull()
    expect(parseListConversationsReply({ status: 'ok', conversations: [summary, summary] })).toBeNull()
  })
})
