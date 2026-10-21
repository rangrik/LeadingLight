import { describe, expect, it } from 'vitest'
import { PROPOSAL_LIMITS, type AppendedReceipt, type CreatedReceipt } from './proposalContract'
import {
  PROPOSAL_UNDO_COMMANDS, UNDO_REFUSALS, parseReleaseUndoReply, parseUndoQueryReply, parseUndoReceipt, undoOfferFor, undoRequestFor,
  type UndoOffer,
} from './proposalUndoContract'

const sha = (digit: string) => digit.repeat(64)
const proposalId = '6f1c2c1e-6d1f-4a59-9a43-2f6f0c8e7b10'
const press = '0b7c1a52-3c8e-4f0d-9d2a-6e5b4c3a2f10'
const appended: AppendedReceipt = {
  status: 'committed', kind: 'append', operationId: proposalId, path: '/vault/Commentary.md',
  beforeSha256: sha('b'), afterSha256: sha('c'), durable: true, undoReceipt: 'undo-1',
}
const created: CreatedReceipt = {
  status: 'committed', kind: 'create', operationId: proposalId, path: '/vault/Commentary on Plan.md',
  beforeSha256: null, afterSha256: sha('a'), durable: false, undoReceipt: 'undo-2',
}

const offerOf = (receipt: AppendedReceipt | CreatedReceipt): UndoOffer => {
  const offer = undoOfferFor(receipt, 'session-1')
  if (offer === null) throw new Error('expected an offer')
  return offer
}

describe('undo offers', () => {
  it('keeps everything a later press and its reply check need, after the dialog is gone', () => {
    expect(offerOf(appended)).toEqual({
      sessionId: 'session-1', undoReceipt: 'undo-1', kind: 'append', path: '/vault/Commentary.md', afterSha256: sha('c'), beforeSha256: sha('b'),
    })
    expect(offerOf(created)).toEqual({
      sessionId: 'session-1', undoReceipt: 'undo-2', kind: 'create', path: '/vault/Commentary on Plan.md', afterSha256: sha('a'), beforeSha256: null,
    })
    expect(Object.isFrozen(offerOf(appended))).toBe(true)
  })

  it('offers nothing without a usable token, session or digests', () => {
    expect(undoOfferFor({ ...created, undoReceipt: null }, 'session-1')).toBeNull()
    expect(undoOfferFor(appended, 'not a token')).toBeNull()
    expect(undoOfferFor(appended, '')).toBeNull()
    expect(undoOfferFor({ ...appended, undoReceipt: 'undo 1' }, 'session-1')).toBeNull()
    expect(undoOfferFor({ ...appended, beforeSha256: sha('c') }, 'session-1')).toBeNull()
    expect(undoOfferFor({ ...appended, beforeSha256: 'B'.repeat(64) }, 'session-1')).toBeNull()
    expect(undoOfferFor({ ...appended, path: '' }, 'session-1')).toBeNull()
  })

  it('builds the wire request from the offer alone', () => {
    expect(undoRequestFor(offerOf(appended), press)).toEqual({
      operationId: press, sessionId: 'session-1', undoReceipt: 'undo-1', kind: 'append', expectedSha256: sha('c'), beforeSha256: sha('b'),
    })
    expect(undoRequestFor(offerOf(created), press)).toEqual({
      operationId: press, sessionId: 'session-1', undoReceipt: 'undo-2', kind: 'create', expectedSha256: sha('a'), beforeSha256: null,
    })
    expect(PROPOSAL_UNDO_COMMANDS).toEqual({ undo: 'undo_document_proposal', query: 'query_document_undo', release: 'release_document_undo' })
  })
})

describe('undo replies', () => {
  const appendUndone = { status: 'undone', operationId: press, kind: 'append', path: '/vault/Commentary.md', restoredSha256: sha('b'), durable: true }
  const createUndone = { status: 'undone', operationId: press, kind: 'create', path: '/vault/Commentary on Plan.md' }

  it('accepts an undone append only for its offer, path and exact before digest', () => {
    const offer = offerOf(appended)
    expect(parseUndoReceipt(appendUndone, offer, press)).toEqual(appendUndone)
    expect(parseUndoReceipt({ ...appendUndone, durable: false }, offer, press)).toEqual({ ...appendUndone, durable: false })
    for (const wrong of [
      { operationId: proposalId }, { restoredSha256: sha('c') }, { restoredSha256: sha('d') }, { kind: 'create' },
      { path: '/vault/Other.md' }, { durable: 'yes' }, { extra: true },
    ]) expect({ wrong, parsed: parseUndoReceipt({ ...appendUndone, ...wrong }, offer, press) }).toEqual({ wrong, parsed: null })
    expect(parseUndoReceipt(appendUndone, offer, proposalId)).toBeNull()
  })

  it('accepts an undone create only for its offer and path, with no digest or durability claim', () => {
    const offer = offerOf(created)
    expect(parseUndoReceipt(createUndone, offer, press)).toEqual(createUndone)
    for (const wrong of [{ kind: 'append' }, { path: '/vault/Commentary.md' }, { restoredSha256: sha('a') }, { durable: true }]) {
      expect({ wrong, parsed: parseUndoReceipt({ ...createUndone, ...wrong }, offer, press) }).toEqual({ wrong, parsed: null })
    }
    expect(parseUndoReceipt(appendUndone, offer, press)).toBeNull()
  })

  it('reads conflicts, refusals and uncertainty exactly', () => {
    const offer = offerOf(appended)
    for (const reason of ['changed', 'missing'] as const) {
      expect(parseUndoReceipt({ status: 'conflict', operationId: press, reason }, offer, press)).toEqual({ status: 'conflict', operationId: press, reason })
    }
    for (const reason of UNDO_REFUSALS) {
      expect(parseUndoReceipt({ status: 'refused', operationId: press, reason }, offer, press)).toEqual({ status: 'refused', operationId: press, reason })
    }
    expect(parseUndoReceipt({ status: 'uncertain', operationId: press }, offer, press)).toEqual({ status: 'uncertain', operationId: press })
    for (const wrong of [
      { status: 'conflict', operationId: press, reason: 'exists' },
      { status: 'refused', operationId: press, reason: 'staleRun' },
      { status: 'uncertain', operationId: press, reason: 'lost' },
      { status: 'running', operationId: press },
      { status: 'committed', operationId: press },
      null, 'undone', [appendUndone],
    ]) expect({ wrong, parsed: parseUndoReceipt(wrong, offer, press) }).toEqual({ wrong, parsed: null })
  })

  it('reads a query as a recorded receipt or running and unknown, never as a reason to press again', () => {
    const offer = offerOf(appended)
    expect(parseUndoQueryReply(appendUndone, offer, press)).toEqual(appendUndone)
    expect(parseUndoQueryReply({ status: 'running', operationId: press }, offer, press)).toEqual({ status: 'running', operationId: press })
    expect(parseUndoQueryReply({ status: 'unknown', operationId: press }, offer, press)).toEqual({ status: 'unknown', operationId: press })
    expect(parseUndoQueryReply({ status: 'unknown', operationId: proposalId }, offer, press)).toBeNull()
    expect(parseUndoQueryReply({ status: 'running', operationId: press, extra: 1 }, offer, press)).toBeNull()
    expect(parseUndoQueryReply({ ...appendUndone, restoredSha256: sha('d') }, offer, press)).toBeNull()
  })

  it('reads a release answer exactly', () => {
    expect(parseReleaseUndoReply({ status: 'released' })).toEqual({ status: 'released' })
    expect(parseReleaseUndoReply({ status: 'unknown' })).toEqual({ status: 'unknown' })
    for (const wrong of [{ status: 'released', extra: true }, { status: 'closed' }, null, 'released']) {
      expect(parseReleaseUndoReply(wrong)).toBeNull()
    }
  })

  it('keeps paths within the reply bound', () => {
    const long = `/${'p'.repeat(PROPOSAL_LIMITS.pathChars)}`
    expect(undoOfferFor({ ...appended, path: long }, 'session-1')).toBeNull()
  })
})
