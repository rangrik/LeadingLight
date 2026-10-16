import { describe, expect, it } from 'vitest'
import { sha256Hex, type OriginalRequest } from '../leadinglight/saveOutcome'
import { createSaveRecovery, memoryStore, SaveRecoveryArgumentError } from './mock-save-recovery'

const PAGE = '/vault/notes/a.md'

function setup(initial: Record<string, string> = { [PAGE]: 'old' }) {
  const pages = new Map(Object.entries(initial))
  const writes: string[] = []
  const recovery = createSaveRecovery(memoryStore({
    read: path => pages.get(path),
    write: (path, content) => {
      writes.push(path)
      pages.set(path, content)
    },
  }))
  return { pages, writes, recovery }
}

async function envelope(content: string, overrides: Partial<OriginalRequest> = {}): Promise<OriginalRequest> {
  return { requestId: crypto.randomUUID(), vaultPath: '/vault', session: 's1', path: PAGE, seq: 1, submittedSha256: await sha256Hex(content), ...overrides }
}

describe('save recovery registry', () => {
  it('admits a first save once; a replay or check returns the stored answer without writing again', async () => {
    const { pages, writes, recovery } = setup()
    const request = await envelope('new')
    const committed = { status: 'committed', written: true, durable: true, history: null }
    await expect(recovery.savePageContent({ request, content: 'new' })).resolves.toEqual(committed)
    await expect(recovery.savePageContent({ request, content: 'new' })).resolves.toEqual(committed)
    await expect(recovery.checkSaveOutcome({ request })).resolves.toEqual({ state: 'done', outcome: committed })
    expect(writes).toEqual([PAGE])
    expect(pages.get(PAGE)).toBe('new')
  })

  it('voids an envelope a query sees first, so its late save never writes', async () => {
    const { pages, writes, recovery } = setup()
    const request = await envelope('late')
    await expect(recovery.checkSaveOutcome({ request })).resolves.toEqual({ state: 'voided' })
    await expect(recovery.savePageContent({ request, content: 'late' })).resolves.toEqual({ status: 'refused', reason: 'requestVoided' })
    expect(writes).toEqual([])
    expect(pages.get(PAGE)).toBe('old')
  })

  it('never runs a changed envelope, bytes that do not match the hash, or a malformed argument', async () => {
    const { writes, recovery } = setup()
    const request = await envelope('one')
    await recovery.savePageContent({ request, content: 'one' })
    const changed = { ...request, seq: 2 }
    await expect(recovery.savePageContent({ request: changed, content: 'one' })).resolves.toEqual({ status: 'refused', reason: 'requestMismatch' })
    await expect(recovery.checkSaveOutcome({ request: changed })).resolves.toEqual({ state: 'mismatch' })
    const unmatched = await envelope('two')
    await expect(recovery.savePageContent({ request: unmatched, content: 'other' })).resolves.toEqual({ status: 'refused', reason: 'requestMismatch' })
    await expect(recovery.checkSaveOutcome({ request: unmatched })).resolves.toEqual({ state: 'voided' })
    await expect(recovery.checkSaveOutcome({ request: { ...request, requestId: request.requestId.toUpperCase() } })).resolves.toEqual({ state: 'mismatch' })
    await expect(recovery.savePageContent({ request: { ...request, extra: 1 }, content: 'one' })).rejects.toBeInstanceOf(SaveRecoveryArgumentError)
    await expect(recovery.checkSaveOutcome({ request: { ...request, seq: -1 } })).rejects.toBeInstanceOf(SaveRecoveryArgumentError)
    expect(writes).toEqual([PAGE])
  })

  it('holds a missing page, names its holder to the next save, and copies it beside the original without recreating it', async () => {
    const gone = '/vault/notes/gone.md'
    const { pages, recovery } = setup({ [PAGE]: 'old', '/vault/notes/gone-2.md': 'taken' })
    const first = await envelope('text', { path: gone })
    const hold = { requestId: first.requestId, kind: 'missing', seq: 1, submittedSha256: first.submittedSha256 }
    await expect(recovery.savePageContent({ request: first, content: 'text' })).resolves.toEqual({ status: 'refused', reason: 'missing', hold })
    const second = await envelope('more', { path: gone, seq: 2 })
    await expect(recovery.savePageContent({ request: second, content: 'more' })).resolves.toEqual({
      status: 'refused', reason: 'held', heldBy: first.requestId, heldRequest: first, heldKind: 'missing',
    })
    await expect(recovery.savePageContent({ request: await envelope('elsewhere'), content: 'elsewhere' })).resolves.toMatchObject({ status: 'committed' })
    const copy = { request: first, draft: { seq: 2, content: 'more' }, operationId: crypto.randomUUID(), folder: null }
    const created = { status: 'created', path: '/vault/notes/gone-3.md', relativePath: 'notes/gone-3.md', durable: true }
    await expect(recovery.saveDraftAsNewPage(copy)).resolves.toEqual(created)
    await expect(recovery.saveDraftAsNewPage(copy)).resolves.toEqual(created)
    await expect(recovery.saveDraftAsNewPage({ ...copy, draft: { seq: 3, content: 'newer' } })).resolves.toEqual({ status: 'refused', reason: 'operationMismatch' })
    for (const folder of ['.leadinglight', 'notes/../..']) {
      await expect(recovery.saveDraftAsNewPage({ ...copy, operationId: crypto.randomUUID(), folder })).resolves.toEqual({ status: 'refused', reason: 'outsideVault' })
    }
    expect(pages.has(gone)).toBe(false)
  })

  it('keeps a copy only while it still holds the confirmed text, on an exact retry too', async () => {
    const { pages, recovery } = setup({})
    const request = await envelope('text')
    await recovery.savePageContent({ request, content: 'text' })
    const operationId = crypto.randomUUID()
    await recovery.saveDraftAsNewPage({ request, draft: { seq: 2, content: 'draft' }, operationId, folder: null })
    const release = { request, actionId: crypto.randomUUID(), confirmed: { seq: 2, contentSha256: await sha256Hex('draft') }, operationId }
    const other = await envelope('other')
    await expect(recovery.releaseHoldWithCopy({ ...release, request: other })).resolves.toEqual({ status: 'refused', reason: 'operationMismatch' })
    await expect(recovery.releaseHoldWithCopy({ ...release, confirmed: { seq: 2, contentSha256: other.submittedSha256 } }))
      .resolves.toEqual({ status: 'refused', reason: 'copyChanged' })
    await expect(recovery.releaseHoldWithCopy({ ...release, request: { ...request, vaultPath: 'vault' } })).resolves.toEqual({ status: 'refused', reason: 'busy' })
    // The same bytes from another draft are not this copy; the request's own seq does not matter.
    await expect(recovery.releaseHoldWithCopy({ ...release, confirmed: { seq: 3, contentSha256: release.confirmed.contentSha256 } }))
      .resolves.toEqual({ status: 'refused', reason: 'copyChanged' })
    pages.set('/vault/notes/a-2.md', 'edited elsewhere')
    await expect(recovery.releaseHoldWithCopy(release)).resolves.toEqual({ status: 'refused', reason: 'copyChanged' })
    pages.set('/vault/notes/a-2.md', 'draft')
    const resolved = { status: 'resolved', actionId: release.actionId, holdRetired: true, leftovers: [] }
    await expect(recovery.releaseHoldWithCopy(release)).resolves.toEqual(resolved)
    pages.set('/vault/notes/a-2.md', 'edited again')
    await expect(recovery.releaseHoldWithCopy(release)).resolves.toEqual({ status: 'refused', reason: 'copyChanged' })
    pages.delete('/vault/notes/a-2.md')
    await expect(recovery.releaseHoldWithCopy(release)).resolves.toEqual({ status: 'refused', reason: 'copyNotOwned' })
    await expect(recovery.checkSaveOutcome({ request })).resolves.toEqual({ state: 'retired', terminal: 'refused', resolved: true })
  })

  it('settles newer text after a lost release reply only through its own copy and action', async () => {
    const { recovery } = setup({})
    const request = await envelope('text')
    await recovery.savePageContent({ request, content: 'text' })
    const resolveWith = async (seq: number, content: string, actionId = crypto.randomUUID()) => {
      const operationId = crypto.randomUUID()
      await recovery.saveDraftAsNewPage({ request, draft: { seq, content }, operationId, folder: null })
      return { request, actionId, confirmed: { seq, contentSha256: await sha256Hex(content) }, operationId }
    }
    const first = await resolveWith(2, 'v2')
    await expect(recovery.releaseHoldWithCopy(first)).resolves.toMatchObject({ status: 'resolved', holdRetired: true })
    // The old action, reused for the newer snapshot, never settles it.
    const newer = await resolveWith(3, 'v3')
    await expect(recovery.releaseHoldWithCopy({ ...newer, actionId: first.actionId })).resolves.toEqual({ status: 'refused', reason: 'actionMismatch' })
    await expect(recovery.releaseHoldWithCopy(newer)).resolves.toMatchObject({ status: 'resolved', holdRetired: false })
  })

  it('discards an envelope it has never seen without a readable page, so the late save is void', async () => {
    const { writes, recovery } = setup()
    const request = await envelope('never')
    const discard = { request, actionId: crypto.randomUUID(), confirmed: { seq: 1, contentSha256: request.submittedSha256 } }
    const resolved = { status: 'resolved', actionId: discard.actionId, holdRetired: false, leftovers: [] }
    await expect(recovery.discardHold(discard)).resolves.toEqual(resolved)
    await expect(recovery.discardHold(discard)).resolves.toEqual(resolved)
    await expect(recovery.savePageContent({ request, content: 'never' })).resolves.toEqual({ status: 'refused', reason: 'requestVoided' })
    expect(writes).toEqual([])
  })

  it('compacts an older finished save once a newer one on the page finishes, and any save once resolved', async () => {
    const { recovery } = setup()
    const older = await envelope('one')
    await recovery.savePageContent({ request: older, content: 'one' })
    const newer = await envelope('two', { seq: 2 })
    await recovery.savePageContent({ request: newer, content: 'two' })
    await expect(recovery.checkSaveOutcome({ request: older })).resolves.toEqual({ state: 'retired', terminal: 'committed', resolved: false })
    await expect(recovery.savePageContent({ request: older, content: 'one' })).resolves.toEqual({ status: 'refused', reason: 'requestVoided' })
    // Only a live hold reports itself retired.
    const discard = { request: newer, actionId: crypto.randomUUID(), confirmed: { seq: 2, contentSha256: newer.submittedSha256 } }
    await expect(recovery.discardHold(discard)).resolves.toEqual({ status: 'resolved', actionId: discard.actionId, holdRetired: false, leftovers: [] })
    await expect(recovery.savePageContent({ request: newer, content: 'two' })).resolves.toEqual({ status: 'refused', reason: 'requestVoided' })
  })

  // Seam: Check re-proves an uncertain save only through the page's folder as it was. Catches a read through a swapped link.
  it('re-proves an uncertain save only while its page still resolves where it was saved', async () => {
    let swapped = false
    const proofs: unknown[] = []
    const base = memoryStore({ read: () => 'old', write: () => {} })
    const recovery = createSaveRecovery({
      ...base,
      pageKey: request => (swapped ? null : base.pageKey(request)),
      writePage: () => { throw new Error('reply lost') },
      reprove: (_request, proof) => { proofs.push(proof); return 'committed' },
    })
    const request = await envelope('new')
    await expect(recovery.savePageContent({ request, content: 'new' })).resolves.toMatchObject({ status: 'uncertain' })
    swapped = true
    await expect(recovery.checkSaveOutcome({ request })).resolves.toMatchObject({ state: 'done', outcome: { status: 'uncertain' } })
    expect(proofs, 'nothing was re-proved through the swapped folder').toEqual([])
    swapped = false
    await expect(recovery.checkSaveOutcome({ request })).resolves.toEqual({ state: 'done', outcome: { status: 'committed', written: true, durable: false, history: null } })
  })

  // Seam: answers given without running are stored apart from the page, as native admit_unplaced and admit do.
  it('stores an outside page and a held refusal without touching the page\'s latest save', async () => {
    const { pages, recovery } = setup({})
    const outside = await envelope('x', { path: '/vault/../a.md' })
    const refusedOutside = { status: 'refused', reason: 'outsideVault' }
    await expect(recovery.savePageContent({ request: outside, content: 'x' })).resolves.toEqual(refusedOutside)
    await expect(recovery.savePageContent({ request: outside, content: 'x' })).resolves.toEqual(refusedOutside)
    await expect(recovery.checkSaveOutcome({ request: outside })).resolves.toEqual({ state: 'done', outcome: refusedOutside })
    const holder = await envelope('text')
    await recovery.savePageContent({ request: holder, content: 'text' })
    const blocked = await envelope('more', { seq: 2 })
    const held = await recovery.savePageContent({ request: blocked, content: 'more' })
    await recovery.discardHold({ request: holder, actionId: crypto.randomUUID(), confirmed: { seq: 1, contentSha256: holder.submittedSha256 } })
    pages.set(PAGE, 'back')
    await expect(recovery.savePageContent({ request: await envelope('later', { seq: 3 }), content: 'later' })).resolves.toMatchObject({ status: 'committed' })
    await expect(recovery.checkSaveOutcome({ request: blocked })).resolves.toEqual({ state: 'done', outcome: held })
  })
})
