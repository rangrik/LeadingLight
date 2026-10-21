// The UI's only route to the native extension registry. A closed table of the declared extension
// and proposal commands; nothing here takes a command name from a caller, so package data can never
// pick what is invoked. Every reply is read strictly; a rejected call or an unexpected shape is no
// reply (null), which callers never read as success or as proof that nothing was written.
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../../mock-tauri'
import {
  PROPOSAL_COMMANDS, parseProposalQueryReply, parseProposalReceipt,
  type GuardedProposal, type ProposalQueryReply, type ProposalReceipt,
} from '../proposals/proposalContract'
import {
  PROPOSAL_UNDO_COMMANDS, parseReleaseUndoReply, parseUndoQueryReply, parseUndoReceipt,
} from '../proposals/proposalUndoContract'
import {
  EXTENSION_COMMANDS, parseCloseSessionReply, parseEndRunReply, parseOpenSessionReply, parseRunAdmission,
  type ExtensionApi,
} from './extensionApi'
import {
  parseActivationReply, parseDeactivationReply, parseDocumentHandleReply, parseExtensionListReply,
  parseFolderHandleReply, parseImportCandidateReply, parseReadExtensionReply,
} from './extensionReplyReaders'

type DeclaredCommand =
  | (typeof EXTENSION_COMMANDS)[keyof typeof EXTENSION_COMMANDS]
  | (typeof PROPOSAL_COMMANDS)[keyof typeof PROPOSAL_COMMANDS]
  | (typeof PROPOSAL_UNDO_COMMANDS)[keyof typeof PROPOSAL_UNDO_COMMANDS]

/** Sends one declared command with its arguments and resolves to the raw answer. */
export type Ask = (command: DeclaredCommand, args: Record<string, unknown>) => Promise<unknown>

const nativeAsk: Ask = (command, args) => (isTauri() ? invoke(command, args) : mockInvoke(command, args))

export interface ExtensionTransport extends ExtensionApi {
  /**
   * Drops the copy kept to read query replies for this operation. Call it only once the operation
   * is resolved (committed or proved not written) or the person has explicitly stopped checking.
   */
  forget(operationId: string): void
}

/**
 * Native arguments are flat camelCase fields, as Tauri maps them to the command's parameters; a
 * proposal travels whole as `{ proposal }`. A query is read against the exact proposal submitted
 * through this transport, so a reply for an operation it never sent is no reply.
 */
export function createExtensionTransport(ask: Ask = nativeAsk): ExtensionTransport {
  const submitted = new Map<string, GuardedProposal>()

  async function read<T>(command: DeclaredCommand, args: Record<string, unknown>, parse: (value: unknown) => T | null): Promise<T | null> {
    let reply: unknown
    try {
      reply = await ask(command, args)
    } catch (error) {
      console.warn(`[extensions] ${command} did not answer:`, error)
      return null
    }
    const parsed = parse(reply)
    if (parsed === null) console.warn(`[extensions] ${command} answered in an unexpected shape`)
    return parsed
  }

  return {
    importCandidate: args => read(EXTENSION_COMMANDS.importCandidate, { packageText: args.packageText }, parseImportCandidateReply),
    list: args => read(EXTENSION_COMMANDS.list, { vaultPath: args.vaultPath }, parseExtensionListReply),
    read: args => read(EXTENSION_COMMANDS.read, { packageSha256: args.packageSha256 }, parseReadExtensionReply),
    activate: args => read(EXTENSION_COMMANDS.activate, {
      vaultPath: args.vaultPath, packageId: args.packageId, packageSha256: args.packageSha256, expectedActiveSha256: args.expectedActiveSha256,
    }, value => parseActivationReply(value, args)),
    deactivate: args => read(EXTENSION_COMMANDS.deactivate, {
      vaultPath: args.vaultPath, packageId: args.packageId, expectedActiveSha256: args.expectedActiveSha256,
    }, parseDeactivationReply),
    openSession: args => read(EXTENSION_COMMANDS.openSession, { vaultPath: args.vaultPath }, parseOpenSessionReply),
    closeSession: args => read(EXTENSION_COMMANDS.closeSession, { sessionId: args.sessionId }, parseCloseSessionReply),
    beginRun: args => read(EXTENSION_COMMANDS.beginRun, {
      sessionId: args.sessionId, packageSha256: args.packageSha256, commandId: args.commandId, invocationId: args.invocationId,
    }, value => parseRunAdmission(value, args)),
    endRun: args => read(EXTENSION_COMMANDS.endRun, { sessionId: args.sessionId, invocationId: args.invocationId }, parseEndRunReply),
    bindFolder: args => read(EXTENSION_COMMANDS.bindFolder, { runId: args.runId, folder: args.folder }, parseFolderHandleReply),
    bindDocument: args => read(EXTENSION_COMMANDS.bindDocument, { runId: args.runId, path: args.path }, parseDocumentHandleReply),
    submitProposal(proposal): Promise<ProposalReceipt | null> {
      const exact: GuardedProposal = { ...proposal }
      // Kept before sending, so a reply lost on the way back can still be queried.
      submitted.set(exact.operationId, exact)
      return read(PROPOSAL_COMMANDS.submit, { proposal: exact }, value => parseProposalReceipt(value, exact))
    },
    queryProposal(args): Promise<ProposalQueryReply | null> {
      const proposal = submitted.get(args.operationId)
      if (!proposal) return Promise.resolve(null)
      return read(PROPOSAL_COMMANDS.query, { operationId: proposal.operationId }, value => parseProposalQueryReply(value, proposal))
    },
    forget(operationId) {
      submitted.delete(operationId)
    },
    // An Undo request travels whole and strict; its reply must name exactly that press of that offer.
    undoProposal: (request, offer) => read(PROPOSAL_UNDO_COMMANDS.undo, { request: { ...request } },
      value => parseUndoReceipt(value, offer, request.operationId)),
    queryUndo: (args, offer) => read(PROPOSAL_UNDO_COMMANDS.query, { operationId: args.operationId },
      value => parseUndoQueryReply(value, offer, args.operationId)),
    releaseUndo: args => read(PROPOSAL_UNDO_COMMANDS.release, { sessionId: args.sessionId, undoReceipt: args.undoReceipt }, parseReleaseUndoReply),
  }
}
