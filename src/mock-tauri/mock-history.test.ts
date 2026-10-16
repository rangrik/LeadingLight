import { createHash, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseSaveOutcome } from '../leadinglight/saveOutcome'
import {
  createMemoryPageHistory,
  createPageHistory,
  HISTORY_LIMITS,
  HistoryArgumentError,
  type HistoryStore,
  keepReason,
  locationKey,
  parseVersionMeta,
  previewOf,
  retentionPlan,
  sha256Bytes,
  type StoredVersion,
  type VersionMeta,
  type VersionReason,
} from './mock-history'
import { createSaveRecovery, memoryStore } from './mock-save-recovery'

const bytes = (text: string) => new TextEncoder().encode(text)
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')
const HOUR = 3_600_000
const DAY = 24 * HOUR
const NOW = Date.UTC(2026, 9, 16, 12)

describe('page history policy', () => {
  // Seam: the browser mock hashes without Node; a wrong digest would mislabel every version.
  it('hashes exactly like SHA-256 across the padding edges', () => {
    for (const length of [0, 3, 55, 56, 63, 64, 65, 1000]) {
      const sample = Uint8Array.from({ length }, (_, i) => (i * 37) & 255)
      expect(sha256Bytes(sample)).toBe(sha(sample))
    }
  })

  // Seam H1: lost first-minute text, two quick big deletions, duplicate rows.
  it('keeps a cleared tiny page and every big deletion, and never the same bytes twice', () => {
    const meta = (text: string, ago: number, reason: VersionReason = 'checkpoint'): VersionMeta =>
      ({ format: 1, capturedAt: NOW - ago, reason, recordedPath: 'a.md', length: bytes(text).length, sha256: sha(bytes(text)) })
    const why = (before: string, after: string, versions: VersionMeta[], remembered?: string) =>
      keepReason({ versions, remembered, before: bytes(before), beforeSha256: sha(bytes(before)), after: bytes(after), now: NOW })
    const long = 'x'.repeat(3000)
    expect(why('hello', '', [])).toBe('firstSave')
    expect(why('hello', 'help', [meta('hello', 10)])).toBe('duplicate')
    expect(why(`${long}!`, 'short', [meta(long, 30_000, 'bigChange')], sha(bytes(`${long}!`)))).toBe('bigChange')
    expect(why('abcdefghij', 'abcdefghik', [meta('zz', 1000)])).toBe('sessionStart')
    expect(why('abcdefghij', 'abcdefghik', [meta('zz', 1000)], 'other')).toBe('changedElsewhere')
    expect(why('abcdefghij', 'abcdefghik', [meta('zz', 61_000)], sha(bytes('abcdefghij')))).toBe('checkpoint')
    expect(why('abcdefghij', 'abcdefghik', [meta('zz', 1000)], sha(bytes('abcdefghij')))).toBeNull()
  })

  // Judged by age like native's plan, unreadable entries included; a bucket's newest stays.
  it('retention drops old and superseded entries but never the newest or a bucket\'s newest big change', () => {
    const stored = (name: string, ago: number, reason: VersionReason | null): StoredVersion => ({
      name, at: NOW - ago, bytes: 1,
      meta: reason ? { format: 1, capturedAt: NOW - ago, reason, recordedPath: 'a.md', length: 1, sha256: '0'.repeat(64) } : null,
    })
    const versions = [
      stored('newest', 60_000, 'checkpoint'),
      stored('later', 2 * HOUR + 40 * 60_000, 'checkpoint'),
      stored('big', 2 * HOUR + 50 * 60_000, 'bigChange'),
      stored('mid', 2 * HOUR + 55 * 60_000, 'checkpoint'),
      stored('bad', 2 * HOUR + 58 * 60_000, null),
      stored('old', 200 * DAY, 'checkpoint'),
    ]
    expect(retentionPlan(versions, NOW, HISTORY_LIMITS)).toEqual(['old', 'bad', 'mid'])
    expect(retentionPlan([stored('only', 400 * DAY, 'firstSave')], NOW, HISTORY_LIMITS)).toEqual([])
  })

  // As native's plan: the protected newest is one of the 30 recent places, so 31 recent keep 30.
  it('keeps thirty recent entries, the newest among them', () => {
    const recent = Array.from({ length: 31 }, (_, i): StoredVersion => ({
      name: `v${String(i).padStart(2, '0')}`, at: NOW - i * 60_000, bytes: 1,
      meta: { format: 1, capturedAt: NOW - i * 60_000, reason: 'checkpoint', recordedPath: 'a.md', length: 1, sha256: '0'.repeat(64) },
    }))
    expect(retentionPlan(recent, NOW, HISTORY_LIMITS)).toEqual(['v30'])
  })

  // Seam B1: an inventory with a gap gives no authority to delete, even when only the recount finds it.
  it('maintenance deletes nothing from a blocked count, and stops when a recount finds one', () => {
    const loc = locationKey('a.md', sha256Bytes)
    const version = (name: string, at: number): StoredVersion =>
      ({ name, at, bytes: 1, meta: { format: 1, capturedAt: at, reason: 'checkpoint', recordedPath: 'a.md', length: 1, sha256: '0'.repeat(64) } })
    const versions = [version('old', NOW - 200 * DAY), version('newest', NOW)]
    const scans: Array<'unavailable' | 'full' | null> = []
    const removed: string[] = []
    const store: HistoryStore = {
      root: vaultPath => vaultPath,
      spot: () => null,
      inventory: () => ({
        usedBytes: 0, versionCount: versions.length, attention: [], blocked: scans.shift() ?? null,
        locations: [{ loc, recordedPath: 'a.md', versions, complete: true }],
        tmp: [{ name: `del-${loc}-x`, deleting: true, at: 0 }],
      }),
      write: () => 'unavailable',
      remove: (_root, _loc, name) => { removed.push(name); return true },
      removeTmp: (_root, entry) => { removed.push(entry.name); return true },
      removeLocation: (_root, key) => { removed.push(key); return true },
      read: () => 'missing', exists: () => true, copy: () => ({ status: 'failed', message: 'unused' }),
    }
    const history = createPageHistory(store, { now: () => NOW, schedule: () => {} })
    for (const blocked of ['unavailable', 'full'] as const) {
      scans.push(blocked)
      history.maintain('/v')
    }
    expect(removed).toEqual([])
    scans.push(null, 'unavailable')
    history.maintain('/v')
    expect(removed).toEqual([`del-${loc}-x`])
  })

  // Seam: only a capture that really kept something proves storage recovered (corrections, health).
  it('keeps a remembered low-space failure through a skipped capture until one succeeds', () => {
    const results: Array<'kept' | 'lowSpace'> = ['kept', 'lowSpace', 'kept']
    const versions: StoredVersion[] = []
    const loc = locationKey('a.md', sha256Bytes)
    const store: HistoryStore = {
      root: vaultPath => vaultPath,
      spot: (vaultPath, page) => ({ root: vaultPath, recordedPath: page.slice(vaultPath.length + 1) }),
      inventory: () => ({
        usedBytes: 0, versionCount: versions.length, tmp: [], attention: [], blocked: null,
        locations: versions.length ? [{ loc, recordedPath: 'a.md', versions, complete: true }] : [],
      }),
      write: (_root, _loc, _location, name, _payload, meta) => {
        const result = results.shift() ?? 'kept'
        const parsed = parseVersionMeta(meta)
        if (result === 'kept' && parsed) versions.push({ name, at: parsed.capturedAt, meta: parsed, bytes: 1 })
        return result
      },
      remove: () => true, removeTmp: () => true, removeLocation: () => true,
      read: () => 'missing', exists: () => true, copy: () => ({ status: 'failed', message: 'unused' }),
    }
    const history = createPageHistory(store, { now: () => NOW, schedule: () => {} })
    const capture = (before: string) => history.capture({ vaultPath: '/v', page: '/v/a.md', before: bytes(before), after: bytes('') })
    const state = () => history.pageHistoryHealth({ vaultPath: '/v' })

    expect(capture('one')).toBeNull()
    expect(capture('two')).toEqual({ status: 'notKept', reason: 'lowSpace' })
    expect(capture('one')).toBeNull()
    expect(state()).toMatchObject({ state: 'notKeeping', reason: 'lowSpace' })
    expect(capture('three')).toBeNull()
    expect(state()).toMatchObject({ state: 'on', reason: null })
  })

  // Seam F2/A15: nothing cut mid-character, truncation is not damage, non-UTF-8 is never shown.
  it('previews whole characters up to the limit and leaves non-UTF-8 unshown', () => {
    const limit = HISTORY_LIMITS.previewBytes
    const long = previewOf(bytes(`\uFEFF${'a'.repeat(limit - 4)}✓tail`), limit)
    expect(long).toMatchObject({ status: 'ok', text: `\uFEFF${'a'.repeat(limit - 4)}`, shownBytes: limit - 1, truncated: true, bom: true })
    expect(previewOf(bytes('\uFEFFa\r\nb'), 100)).toMatchObject({ text: '\uFEFFa\r\nb', bom: true, crlf: true, truncated: false })
    expect(previewOf(Uint8Array.from([0x66, 0xff]), 100)).toMatchObject({ text: null, shownBytes: 0, length: 2 })
  })
})

describe('the mock vault history', () => {
  it('keeps a cleared page, copies it exactly beside it, and leaves the save answer unchanged', async () => {
    const text = 'First line ✓\n'
    const pages = new Map([['/Users/mock/notes/a.md', text]])
    const history = createMemoryPageHistory({ schedule: () => {} })
    const recovery = createSaveRecovery(memoryStore({ read: p => pages.get(p), write: (p, c) => { pages.set(p, c) } }, ['/Users/mock'], history))
    const request = { requestId: randomUUID(), vaultPath: '/Users/mock', session: 's', path: '/Users/mock/notes/a.md', seq: 1, submittedSha256: sha(bytes('')) }

    expect(await recovery.savePageContent({ request, content: '' })).toEqual({ status: 'committed', written: true, durable: true, history: null })
    const list = history.listPageVersions({ vaultPath: '/Users/mock', path: request.path, cursor: null })
    if (list.status !== 'ok') throw new Error('refused')
    const [row] = list.versions
    expect(row).toMatchObject({ recordedPath: 'notes/a.md', reason: 'firstSave', length: bytes(text).length, sha256: sha(bytes(text)) })
    expect(list.health).toMatchObject({ state: 'on', reason: null })
    expect(history.savePageVersionAsCopy({ vaultPath: '/Users/mock', id: row.id, sha256: row.sha256, folder: null, operationId: randomUUID() }))
      .toEqual({ status: 'created', path: '/Users/mock/notes/a-2.md', relativePath: 'notes/a-2.md', durable: true })
    expect(pages.get('/Users/mock/notes/a-2.md')).toBe(text)
    expect(history.listSavedLocations({ vaultPath: '/Users/mock', cursor: null }))
      .toEqual({ status: 'ok', locations: [{ path: 'notes/a.md', newestAt: row.capturedAt, count: 1, exists: true }], nextCursor: null })
    expect(() => history.pageHistoryHealth({ vaultPath: '/Users/mock', extra: 1 })).toThrow(HistoryArgumentError)
  })

  // Seam F1 (bridge side): a committed save that kept nothing settles normally; only its first answer says so.
  it('answers a not-kept note once, and replays, Checks and no-ops answer null', async () => {
    const pages = new Map([['/Users/mock/a.md', 'earlier words']])
    const history = createMemoryPageHistory({ limits: { budgetBytes: 10 }, schedule: () => {} })
    const recovery = createSaveRecovery(memoryStore({ read: p => pages.get(p), write: (p, c) => { pages.set(p, c) } }, ['/Users/mock'], history))
    const envelope = (content: string) =>
      ({ requestId: randomUUID(), vaultPath: '/Users/mock', session: 's', path: '/Users/mock/a.md', seq: 1, submittedSha256: sha(bytes(content)) })
    const request = envelope('later words')

    const committed = await recovery.savePageContent({ request, content: 'later words' })
    expect(committed).toEqual({ status: 'committed', written: true, durable: true, history: { status: 'notKept', reason: 'full' } })
    expect(parseSaveOutcome(committed)).toEqual(committed)
    const stored = { ...committed, history: null }
    expect(await recovery.savePageContent({ request, content: 'later words' })).toEqual(stored)
    expect(await recovery.checkSaveOutcome({ request })).toEqual({ state: 'done', outcome: stored })
    expect(pages.get('/Users/mock/a.md')).toBe('later words')
    expect(await recovery.savePageContent({ request: envelope('later words'), content: 'later words' }))
      .toEqual({ status: 'committed', written: false, durable: true, history: null })
  })
})
