// The UI's only route to the native Adapt host: the contract's fixed commands, each sent as
// `{ args }` and read by the contract's strict readers. A rejected call or any other shape is no
// reply (null). In the browser without the desktop host there is no Adapt: calls fail, so the UI
// shows the provider as unavailable rather than pretending to be connected.
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../../mock-tauri'
import {
  ADAPT_COMMANDS,
  parseCancelConnectReply, parseCancelTurnReply, parseCloseVisitReply, parseConnectReply, parseDeleteConversationReply,
  parseDisconnectReply, parseListConversationsReply, parseNewConversationReply, parseOpenVisitReply, parseReadConversationReply,
  parseSaveConversationReply, parseSendReply, parseStatusReply,
  type AdaptApi, type AdaptCommandName,
} from './adaptContract'

export type AdaptAsk = (command: AdaptCommandName, payload: { args: object }) => Promise<unknown>

const nativeAsk: AdaptAsk = (command, payload) =>
  (isTauri() ? invoke(command, payload as Record<string, unknown>) : mockInvoke(command, payload as Record<string, unknown>))

export function createAdaptTransport(ask: AdaptAsk = nativeAsk): AdaptApi {
  async function read<T>(command: AdaptCommandName, args: object, parse: (value: unknown) => T | null): Promise<T | null> {
    let reply: unknown
    try {
      reply = await ask(command, { args })
    } catch (error) {
      console.warn(`[adapt] ${command} did not answer:`, error)
      return null
    }
    const parsed = parse(reply)
    if (parsed === null) console.warn(`[adapt] ${command} answered in an unexpected shape`)
    return parsed
  }
  return {
    status: args => read(ADAPT_COMMANDS.status, { ...args }, parseStatusReply),
    connect: args => read(ADAPT_COMMANDS.connect, { provider: args.provider, disclosureVersion: args.disclosureVersion }, parseConnectReply),
    cancelConnect: args => read(ADAPT_COMMANDS.cancelConnect, { provider: args.provider }, parseCancelConnectReply),
    disconnect: args => read(ADAPT_COMMANDS.disconnect, { provider: args.provider }, parseDisconnectReply),
    openVisit: args => read(ADAPT_COMMANDS.openVisit, { vaultPath: args.vaultPath }, parseOpenVisitReply),
    closeVisit: args => read(ADAPT_COMMANDS.closeVisit, { visitId: args.visitId }, parseCloseVisitReply),
    listConversations: args => read(ADAPT_COMMANDS.listConversations, { visitId: args.visitId }, parseListConversationsReply),
    newConversation: args => read(ADAPT_COMMANDS.newConversation, { visitId: args.visitId }, parseNewConversationReply),
    readConversation: args => read(ADAPT_COMMANDS.readConversation,
      { visitId: args.visitId, conversationId: args.conversationId, knownRevision: args.knownRevision }, value => parseReadConversationReply(value, args)),
    deleteConversation: args => read(ADAPT_COMMANDS.deleteConversation, { visitId: args.visitId, conversationId: args.conversationId }, parseDeleteConversationReply),
    send(args) {
      const exact = {
        visitId: args.visitId, conversationId: args.conversationId, turnId: args.turnId, provider: args.provider, request: args.request,
        attachments: args.attachments.map(({ kind, label, text }) => ({ kind, label, text })),
        includeTurnIds: [...args.includeTurnIds],
        revision: args.revision && { packageId: args.revision.packageId, baseSha256: args.revision.baseSha256, expectedActiveSha256: args.revision.expectedActiveSha256 },
      }
      return read(ADAPT_COMMANDS.send, exact, value => parseSendReply(value, exact))
    },
    cancelTurn: args => read(ADAPT_COMMANDS.cancelTurn, { visitId: args.visitId, conversationId: args.conversationId, turnId: args.turnId }, parseCancelTurnReply),
    saveConversation: args => read(ADAPT_COMMANDS.saveConversation, { visitId: args.visitId, conversationId: args.conversationId }, parseSaveConversationReply),
  }
}
