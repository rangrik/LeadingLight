import { describe, expect, it, vi } from 'vitest'
import { PROPOSAL_COMMANDS, type CreateProposal } from '../proposals/proposalContract'
import { EXTENSION_COMMANDS } from './extensionApi'
import { createExtensionTransport, type Ask } from './extensionTransport'

const SHA = 'c'.repeat(64)
const proposal: CreateProposal = {
  kind: 'create', operationId: '11111111-1111-4111-8111-111111111111', runId: 'run-1', folderHandle: 'fh-1',
  fileName: 'note.md', content: '# Note\n', contentSha256: SHA,
}
const committed = {
  status: 'committed', kind: 'create', operationId: proposal.operationId, path: '/vault/note.md',
  beforeSha256: null, afterSha256: SHA, durable: true, undoReceipt: null,
}

function recording(answer: (command: string, args: Record<string, unknown>) => unknown) {
  const calls: { command: string; args: Record<string, unknown> }[] = []
  const ask: Ask = async (command, args) => { calls.push({ command, args }); return answer(command, args) }
  return { calls, transport: createExtensionTransport(ask) }
}

describe('extension transport', () => {
  it('sends only the declared command names with flat arguments', async () => {
    const { calls, transport } = recording(() => null)
    await transport.list({ vaultPath: '/vault' })
    await transport.activate({ vaultPath: '/vault', packageId: 'local.x', packageSha256: SHA, expectedActiveSha256: null })
    await transport.beginRun({ sessionId: 's', packageSha256: SHA, commandId: 'c', invocationId: 'i' })
    await transport.submitProposal(proposal)
    await transport.queryProposal({ operationId: proposal.operationId })
    const declared = new Set<string>([...Object.values(EXTENSION_COMMANDS), ...Object.values(PROPOSAL_COMMANDS)])
    expect(calls.every(call => declared.has(call.command))).toBe(true)
    expect(calls.map(call => call.command)).toEqual([
      'list_extensions', 'activate_extension_version', 'begin_extension_run', 'submit_document_proposal', 'query_document_proposal',
    ])
    expect(calls[1].args).toEqual({ vaultPath: '/vault', packageId: 'local.x', packageSha256: SHA, expectedActiveSha256: null })
    expect(calls[3].args).toEqual({ proposal })
    expect(calls[4].args).toEqual({ operationId: proposal.operationId })
  })

  it('does not forward fields a caller adds to an argument object', async () => {
    const { calls, transport } = recording(() => null)
    await transport.list({ vaultPath: '/vault', command: 'delete_note' } as never)
    expect(calls[0]).toEqual({ command: 'list_extensions', args: { vaultPath: '/vault' } })
  })

  it('answers null for a rejected call or a malformed answer, never an outcome', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rejecting = createExtensionTransport(async () => { throw new Error('ipc closed') })
    expect(await rejecting.submitProposal(proposal)).toBeNull()
    expect(await rejecting.openSession({ vaultPath: '/vault' })).toBeNull()
    const { transport } = recording(() => ({ status: 'committed', operationId: proposal.operationId }))
    expect(await transport.submitProposal(proposal)).toBeNull()
    expect(await transport.closeSession({ sessionId: 's' })).toBeNull()
    warn.mockRestore()
  })

  it('reads a committed receipt only for the exact proposal it sent', async () => {
    const { transport } = recording(command => (command === 'submit_document_proposal' ? committed : null))
    expect(await transport.submitProposal(proposal)).toEqual(committed)
    const other = { ...proposal, contentSha256: 'd'.repeat(64) }
    expect(await transport.submitProposal(other)).toBeNull()
  })

  it('queries only operations it submitted, with the proposal kept after a lost reply', async () => {
    let lost = true
    const { calls, transport } = recording(command => {
      if (command === 'submit_document_proposal' && lost) throw new Error('reply lost')
      return command === 'query_document_proposal' ? committed : null
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await transport.queryProposal({ operationId: proposal.operationId })).toBeNull()
    expect(calls).toEqual([])
    expect(await transport.submitProposal(proposal)).toBeNull()
    lost = false
    expect(await transport.queryProposal({ operationId: proposal.operationId })).toEqual(committed)
    transport.forget(proposal.operationId)
    expect(await transport.queryProposal({ operationId: proposal.operationId })).toBeNull()
    expect(calls.filter(call => call.command === 'submit_document_proposal')).toHaveLength(1)
    warn.mockRestore()
  })

  it('keeps an exact copy, so later changes to the caller object change nothing', async () => {
    const { calls, transport } = recording(command => (command === 'query_document_proposal' ? committed : null))
    const mutable = { ...proposal }
    await transport.submitProposal(mutable)
    mutable.contentSha256 = 'e'.repeat(64)
    expect(await transport.queryProposal({ operationId: proposal.operationId })).toEqual(committed)
    expect(calls[0].args).toEqual({ proposal })
  })
})
