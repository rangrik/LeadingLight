import { describe, expect, it } from 'vitest'
import { parseStart, parseState } from './backupApi'

// Seam: native answers to the UI. Catches an answer for another kind of operation, or a self-contradicting one, read as an outcome.
const none = { total: 0, counts: {}, sample: [] }
const complete = { status: 'complete', folder: '/b/W backup', folderName: 'W backup', files: 2, bytes: 10, durable: true, gaps: none, versionsSkipped: 0, trashItemsNotIncluded: 3 }

describe('backup answers', () => {
  it('reads an operation only as the kind that was started', () => {
    expect(parseState('backup', { state: 'finished', kind: 'backup', result: complete })).toEqual({ state: 'finished', result: complete })
    expect(parseState('restore', { state: 'finished', kind: 'backup', result: complete })).toBeNull()
    expect(parseState('inspect', { state: 'running', kind: 'restore', phase: 'copying', progress: null, cancelRequested: false })).toBeNull()
  })

  it('refuses answers that contradict the contract', () => {
    expect(parseStart('backup', { status: 'finished', result: { ...complete, gaps: { total: 1, counts: { link: 1 }, sample: [] } } })).toBeNull()
    expect(parseStart('backup', { status: 'refused', reason: 'maybe' })).toBeNull()
    expect(parseStart('restore', { status: 'finished', result: { status: 'backupChanged', problems: none } })).toBeNull()
    expect(parseStart('restore', { status: 'finished', result: { status: 'backupChanged', problems: none, leftover: null } })).not.toBeNull()
  })
})
