import { describe, expect, it } from 'vitest'
import {
  parseCopyOutcome, parseResolutionOutcome, parseSaveOutcome, parseSaveRequestState, sha256Hex,
} from './saveOutcome'

// Seam: native serde JSON → queue. A wrong shape must read as no reply, never as a different answer.
const SHA = 'a'.repeat(64)
const request = { requestId: 'r1', vaultPath: '/vault', session: '3', path: '/vault/plan.md', seq: 4, submittedSha256: SHA }
const hold = { requestId: 'r1', kind: 'conflict', seq: 4, submittedSha256: SHA }

describe('save outcome wire shapes', () => {
  it.each([
    { status: 'committed', written: true, durable: false, history: null },
    { status: 'refused', reason: 'readFailed' },
    { status: 'refused', reason: 'held', heldBy: 'r0', heldRequest: request, heldKind: 'uncertain' },
    { status: 'refused', reason: 'symlink', hold: { ...hold, kind: 'linked' } },
    { status: 'failed', reason: 'publish' },
    { status: 'conflict', reason: 'changedDuringSave', hold },
    { status: 'uncertain', hold: { ...hold, kind: 'uncertain' }, originalAt: null, stagedAt: '/vault/.leadinglight-x/plan.md' },
  ])('reads %o exactly', (wire) => {
    expect(parseSaveOutcome(JSON.parse(JSON.stringify(wire)))).toEqual(wire)
  })

  it.each([
    null, 'committed', { status: 'committed', written: true, durable: true },
    { status: 'committed', written: true, durable: true, history: {} },
    { status: 'refused', reason: 'dropped' },
    { status: 'refused', reason: 'held', heldBy: 'r0', heldKind: 'conflict' },
    { status: 'refused', reason: 'missing', hold: { ...hold, seq: -1 } },
    { status: 'conflict', reason: 'changedDuringSave', hold: { ...hold, submittedSha256: 'A'.repeat(64) } },
    { status: 'failed', reason: 'read' },
  ])('reads %o as no answer', (wire) => {
    expect(parseSaveOutcome(wire)).toBeNull()
  })

  it('reads Check again, copy and resolution answers and rejects others', () => {
    expect(parseSaveRequestState({ state: 'done', outcome: { status: 'failed', reason: 'publish' } }))
      .toEqual({ state: 'done', outcome: { status: 'failed', reason: 'publish' } })
    expect(parseSaveRequestState({ state: 'retired', terminal: 'refused', resolved: true }))
      .toEqual({ state: 'retired', terminal: 'refused', resolved: true })
    expect(parseSaveRequestState({ state: 'done', outcome: { status: 'nope' } })).toBeNull()
    expect(parseCopyOutcome({ status: 'created', path: '/vault/plan-2.md', relativePath: 'plan-2.md', durable: true }))
      .toEqual({ status: 'created', path: '/vault/plan-2.md', relativePath: 'plan-2.md', durable: true })
    expect(parseCopyOutcome({ status: 'refused', reason: 'staleHold' })).toBeNull()
    expect(parseResolutionOutcome({ status: 'resolved', actionId: 'a1', holdRetired: false, leftovers: ['/x'] }))
      .toEqual({ status: 'resolved', actionId: 'a1', holdRetired: false, leftovers: ['/x'] })
    expect(parseResolutionOutcome({ status: 'refused', reason: 'copyChanged' })).toEqual({ status: 'refused', reason: 'copyChanged' })
    expect(parseResolutionOutcome({ status: 'resolved', actionId: 'a1', holdRetired: true, leftovers: [1] })).toBeNull()
  })

  it('hashes the UTF-8 bytes of the captured text as lowercase hex', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256Hex('é')).toBe('4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c')
  })
})
