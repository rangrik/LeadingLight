// Shared support for the Adapt tests: an in-memory native host that keeps the frozen contract's
// rules, every call a spy. Nothing here is used by the app.
import { vi } from 'vitest'
import quickText from '../extensions/fixtures/quick-note.json?raw'
import type {
  AdaptConversation, AdaptEntry, AdaptProviderState, AdaptReply, AdaptSendArgs, AdaptSendReply, AdaptStorageState,
} from './adaptContract'

export const SHA = 'c'.repeat(64)
export const AT = '2026-10-20T12:00:00Z'
export const candidate: AdaptReply = { kind: 'candidate', message: 'Here is a quick note.', packageText: quickText }

export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

/** Per-vault conversations, ordered entries, one turn per conversation, cancel by id, local saving. */
export function fakeHost(codex: AdaptProviderState = { status: 'connected' }) {
  let revision = 0
  let visits = 0
  let conversations = 0
  const state: { codex: AdaptProviderState; saves: AdaptStorageState } = { codex, saves: 'saved' }
  const store = new Map<string, AdaptConversation>()
  const vaultOf = new Map<string, string>()
  const visitVault = new Map<string, string>()
  const inVisit = (visitId: string) => [...store.values()].filter(item => vaultOf.get(item.conversationId) === visitVault.get(visitId))
  const cancelled = new Set<string>()
  const used = new Set<string>()
  const bump = (id: string, change: (c: AdaptConversation) => Partial<AdaptConversation>) => {
    const current = store.get(id)!
    store.set(id, { ...current, ...change(current), revision: ++revision })
  }
  const titleOf = (item: AdaptConversation) => {
    const first = item.entries.find(entry => entry.kind === 'request')
    return first?.kind === 'request' ? first.text.split('\n')[0] : ''
  }
  const api = {
    status: vi.fn(async () => ({ revision: ++revision, providers: { codex: state.codex, claude: { status: 'unavailable', reason: 'notAuthorized', installedVersion: null } as const } })),
    connect: vi.fn(async () => { state.codex = { status: 'connecting' }; return { status: 'started' } as const }),
    cancelConnect: vi.fn(async () => { state.codex = { status: 'signedOut', lastConnect: 'cancelled' }; return { status: 'cancelled' } as const }),
    disconnect: vi.fn(async () => { state.codex = { status: 'signedOut', lastConnect: null }; return { status: 'disconnected' } as const }),
    openVisit: vi.fn(async ({ vaultPath }: { vaultPath: string }) => {
      const visitId = `visit-${++visits}`
      visitVault.set(visitId, vaultPath)
      return { status: 'open', visitId } as const
    }),
    closeVisit: vi.fn(async ({ visitId }: { visitId: string }) => { visitVault.delete(visitId); return { status: 'closed' } as const }),
    listConversations: vi.fn(async ({ visitId }: { visitId: string }) => ({
      status: 'ok' as const,
      conversations: inVisit(visitId).reverse().map(item => ({ conversationId: item.conversationId, updatedAt: AT, title: titleOf(item), turns: item.entries.length / 2, running: item.turn !== null })),
    })),
    newConversation: vi.fn(async ({ visitId }: { visitId: string }) => {
      const conversationId = `conv-${++conversations}`
      store.set(conversationId, { conversationId, revision: ++revision, entries: [], turn: null, storage: 'saved' })
      vaultOf.set(conversationId, visitVault.get(visitId)!)
      return { status: 'created', conversationId } as const
    }),
    readConversation: vi.fn(async ({ conversationId, knownRevision }: { visitId: string; conversationId: string; knownRevision: number | null }) => {
      const conversation = store.get(conversationId)
      if (!conversation) return { status: 'unknownConversation' } as const
      return conversation.revision === knownRevision ? { status: 'unchanged', revision: knownRevision } as const : { status: 'ok', conversation } as const
    }),
    deleteConversation: vi.fn(async ({ conversationId }: { conversationId: string }) => {
      if (store.get(conversationId)?.turn) return { status: 'refused', reason: 'running' } as const
      store.delete(conversationId)
      return { status: 'deleted' } as const
    }),
    send: vi.fn(async (args: AdaptSendArgs): Promise<AdaptSendReply | null> => {
      if (cancelled.has(args.turnId)) return { status: 'refused', reason: 'cancelled' }
      if (used.has(args.turnId)) return { status: 'refused', reason: 'replayed' }
      if (state.codex.status !== 'connected') return { status: 'refused', reason: 'notConnected' }
      if (store.get(args.conversationId)?.turn) return { status: 'refused', reason: 'busy' }
      used.add(args.turnId)
      const request: AdaptEntry = {
        kind: 'request', turnId: args.turnId, at: AT, provider: args.provider, text: args.request,
        attachments: args.attachments.map(item => ({ kind: item.kind, label: item.label, bytes: item.text.length, sha256: SHA })),
        includedTurnIds: args.includeTurnIds, revision: args.revision, guide: 'guide-1',
      }
      bump(args.conversationId, c => ({ entries: [...c.entries, request], turn: { turnId: args.turnId, phase: 'working' } }))
      return { status: 'admitted', turnId: args.turnId }
    }),
    cancelTurn: vi.fn(async ({ conversationId, turnId }: { conversationId: string; turnId: string }) => {
      cancelled.add(turnId)
      const conversation = store.get(conversationId)
      if (conversation?.turn?.turnId !== turnId) return { status: 'finished' } as const
      finish(conversationId, { kind: 'stopped', turnId, at: AT, reason: 'cancelled', confirmed: true })
      return { status: 'stopped' } as const
    }),
    saveConversation: vi.fn(async ({ conversationId }: { visitId: string; conversationId: string }) => {
      if (!store.has(conversationId)) return { status: 'unknownConversation' } as const
      bump(conversationId, () => ({ storage: state.saves }))
      return { status: state.saves }
    }),
  }
  function finish(conversationId: string, outcome: Exclude<AdaptEntry, { kind: 'request' }>) {
    bump(conversationId, c => ({ entries: [...c.entries, outcome], turn: null }))
  }
  const reply = (conversationId: string, value: AdaptReply = candidate) =>
    finish(conversationId, { kind: 'reply', turnId: store.get(conversationId)!.turn!.turnId, at: AT, reply: value })
  const fail = (conversationId: string) =>
    finish(conversationId, { kind: 'failed', turnId: store.get(conversationId)!.turn!.turnId, at: AT, reason: 'providerFailed', resetsAt: null })
  return {
    api, state, store, finish, reply, fail,
    setPhase: (id: string, phase: 'stopping' | 'checking') => bump(id, c => ({ turn: c.turn && { ...c.turn, phase } })),
    setStorage: (id: string, storage: AdaptStorageState) => bump(id, () => ({ storage })),
  }
}

export type FakeHost = ReturnType<typeof fakeHost>
