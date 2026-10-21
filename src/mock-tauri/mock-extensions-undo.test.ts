// E2 in the browser model: bound pages with an immutable baseline, one guarded whole-page append
// with its earlier text kept first, Undo bound to the session and the exact bytes written, and the
// bundled passage commentary on by default until a vault turns it off.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EXTENSION_COMMANDS } from '../leadinglight/extensions/extensionApi'
import { PROPOSAL_COMMANDS } from '../leadinglight/proposals/proposalContract'
import { PROPOSAL_UNDO_COMMANDS } from '../leadinglight/proposals/proposalUndoContract'
import { sha256Hex } from '../leadinglight/saveOutcome'
import { ExtensionBackend, bundledCommentaryText, memoryHost, type MemoryVault } from './mock-extensions'

const root = process.cwd()
const fixture = (name: string) => readFileSync(`${root}/src/leadinglight/extensions/fixtures/${name}`, 'utf8')
const COMMENTARY = bundledCommentaryText(fixture('passage-commentary.json'))
const VAULT = '/vault'
const NOTE = `${VAULT}/Topics/commentary.md`
const BEFORE = '# Commentary on Source\n\n[Source](./source.md)\n\n> Earlier\n'
const AFTER = `${BEFORE}\n> Later\n`
const C = { ...EXTENSION_COMMANDS, submit: PROPOSAL_COMMANDS.submit, query: PROPOSAL_COMMANDS.query, ...Object.fromEntries(Object.entries(PROPOSAL_UNDO_COMMANDS).map(([key, value]) => [`undo_${key}`, value])) }

type Reply = Record<string, unknown>

function setup(options: { retain?: boolean } = {}) {
  const pages = new Map<string, string>([[NOTE, BEFORE], [`${VAULT}/Topics/source.md`, '# Source\n\nThe passage.\n']])
  const trashed: string[] = []
  const vault: MemoryVault = {
    roots: [VAULT],
    pagePaths: () => pages.keys(),
    createPage: (path, content) => { if (pages.has(path)) return false; pages.set(path, content); return true },
    readPage: path => pages.get(path) ?? null,
    writePage: (path, content) => { pages.set(path, content) },
    trashPage: (_root, path) => { trashed.push(path); return pages.delete(path) },
  }
  const base = memoryHost(vault, [COMMENTARY])
  const host = options.retain === false ? { ...base, retain: async () => false } : base
  const backend = new ExtensionBackend(host)
  const call = (command: string, args: unknown, owner = 'main') => backend.handle(command, args, owner) as Promise<Reply>
  const api = {
    pages, trashed, call,
    async run(owner = 'main') {
      const list = await call(C.list, { vaultPath: VAULT })
      const commentary = (list.extensions as Reply[]).find(item => item.packageId === 'leadinglight.passage-commentary')!
      const { sessionId } = await call(C.openSession, { vaultPath: VAULT }, owner) as { sessionId: string }
      const admission = await call(C.beginRun, { sessionId, packageSha256: commentary.activeSha256, commandId: 'comment', invocationId: crypto.randomUUID() }, owner)
      expect(admission.status).toBe('admitted')
      return { sessionId, runId: (admission.scope as Reply).runId as string }
    },
    async append(runId: string, content = AFTER, owner = 'main') {
      const bound = await call(C.bindDocument, { runId, path: 'Topics/commentary.md' }, owner)
      const proposal = {
        kind: 'append', operationId: crypto.randomUUID(), runId, content, contentSha256: await sha256Hex(content),
        documentHandle: bound.documentHandle, expectedSha256: bound.contentSha256,
      }
      return { bound, proposal, receipt: await call(C.submit, { proposal }, owner) }
    },
    undo: async (request: Reply, owner = 'main') => call(PROPOSAL_UNDO_COMMANDS.undo, { request }, owner),
    request: (sessionId: string, receipt: Reply, operationId = crypto.randomUUID()) => ({
      operationId, sessionId, undoReceipt: receipt.undoReceipt, kind: receipt.kind, expectedSha256: receipt.afterSha256, beforeSha256: receipt.beforeSha256,
    }),
  }
  return api
}

describe('the bundled passage commentary', () => {
  it('is on where nobody chose, stays off once turned off, and turns on again asking nothing', async () => {
    const w = setup()
    const listed = async () => ((await w.call(C.list, { vaultPath: VAULT })).extensions as Reply[]).find(item => item.packageId === 'leadinglight.passage-commentary')!
    const sha = await sha256Hex(COMMENTARY)
    expect(await listed()).toMatchObject({ activeSha256: sha, previousSha256: null })
    expect(await w.call(C.deactivate, { vaultPath: VAULT, packageId: 'leadinglight.passage-commentary', expectedActiveSha256: sha })).toMatchObject({ status: 'inactive' })
    expect(await listed()).toMatchObject({ activeSha256: null, previousSha256: sha })
    expect(await w.call(C.activate, { vaultPath: VAULT, packageId: 'leadinglight.passage-commentary', packageSha256: sha, expectedActiveSha256: null }))
      .toMatchObject({ status: 'active' })
    expect(await listed()).toMatchObject({ activeSha256: sha })
  })
})

describe('guarded append', () => {
  it('binds a page with its bytes as the baseline, writes the whole postimage once and offers Undo', async () => {
    const w = setup()
    const { runId } = await w.run()
    const { bound, proposal, receipt } = await w.append(runId)
    expect(bound).toMatchObject({ status: 'bound', displayPath: 'Topics/commentary.md', contentSha256: await sha256Hex(BEFORE) })
    expect(receipt).toEqual({
      status: 'committed', kind: 'append', operationId: proposal.operationId, path: NOTE, beforeSha256: await sha256Hex(BEFORE),
      afterSha256: await sha256Hex(AFTER), durable: true, undoReceipt: expect.stringMatching(/^undo-/),
    })
    expect(w.pages.get(NOTE)).toBe(AFTER)
    expect(await w.call(C.submit, { proposal })).toEqual(receipt)
    expect(await w.call(C.query, { operationId: proposal.operationId })).toEqual(receipt)
  })

  it('writes nothing when the page changed after binding, or when its earlier text cannot be kept', async () => {
    const changed = setup()
    const run = await changed.run()
    const bound = await changed.call(C.bindDocument, { runId: run.runId, path: 'Topics/commentary.md' })
    changed.pages.set(NOTE, `${BEFORE}typed elsewhere\n`)
    const proposal = { kind: 'append', operationId: crypto.randomUUID(), runId: run.runId, content: AFTER, contentSha256: await sha256Hex(AFTER),
      documentHandle: bound.documentHandle, expectedSha256: bound.contentSha256 }
    expect(await changed.call(C.submit, { proposal })).toEqual({ status: 'conflict', operationId: proposal.operationId, reason: 'changed' })
    expect(changed.pages.get(NOTE)).toBe(`${BEFORE}typed elsewhere\n`)

    const unkept = setup({ retain: false })
    const { receipt } = await unkept.append((await unkept.run()).runId)
    expect(receipt).toMatchObject({ status: 'refused', reason: 'storageUnavailable' })
    expect(unkept.pages.get(NOTE)).toBe(BEFORE)
  })

  it('refuses a proposal whose baseline is not its handle’s, and an identical postimage', async () => {
    const w = setup()
    const { runId } = await w.run()
    const bound = await w.call(C.bindDocument, { runId, path: 'Topics/commentary.md' })
    const base = { kind: 'append', runId, documentHandle: bound.documentHandle }
    const other = { ...base, operationId: crypto.randomUUID(), content: AFTER, contentSha256: await sha256Hex(AFTER), expectedSha256: 'b'.repeat(64) }
    expect(await w.call(C.submit, { proposal: other })).toMatchObject({ status: 'refused', reason: 'handleMismatch' })
    const fresh = await w.run()
    const rebound = await w.call(C.bindDocument, { runId: fresh.runId, path: 'Topics/commentary.md' })
    const same = { kind: 'append', runId: fresh.runId, documentHandle: rebound.documentHandle, operationId: crypto.randomUUID(), content: BEFORE,
      contentSha256: await sha256Hex(BEFORE), expectedSha256: rebound.contentSha256 }
    expect(await w.call(C.submit, { proposal: same })).toMatchObject({ status: 'refused', reason: 'digestMismatch' })
  })
})

describe('Undo', () => {
  it('restores the exact earlier text once, after the run ended, and answers that press again by query', async () => {
    const w = setup()
    const { sessionId, runId } = await w.run()
    const { receipt } = await w.append(runId)
    const request = w.request(sessionId, receipt)
    const undone = await w.undo(request)
    expect(undone).toEqual({ status: 'undone', operationId: request.operationId, kind: 'append', path: NOTE, restoredSha256: receipt.beforeSha256, durable: true })
    expect(w.pages.get(NOTE)).toBe(BEFORE)
    expect(await w.call(PROPOSAL_UNDO_COMMANDS.query, { operationId: request.operationId })).toEqual(undone)
    expect(await w.undo(request)).toEqual(undone)
    expect(await w.undo(w.request(sessionId, receipt))).toMatchObject({ status: 'refused', reason: 'consumed' })
  })

  it('refuses while the page holds other bytes, and keeps the token for a later press', async () => {
    const w = setup()
    const { sessionId, runId } = await w.run()
    const { receipt } = await w.append(runId)
    w.pages.set(NOTE, `${AFTER}words typed after\n`)
    expect(await w.undo(w.request(sessionId, receipt))).toMatchObject({ status: 'conflict', reason: 'changed' })
    expect(w.pages.get(NOTE)).toBe(`${AFTER}words typed after\n`)
    w.pages.set(NOTE, AFTER)
    expect(await w.undo(w.request(sessionId, receipt))).toMatchObject({ status: 'undone' })
  })

  it('belongs to its owner and open session: another owner, a released token or a closed session undo nothing', async () => {
    const w = setup()
    const { sessionId, runId } = await w.run()
    const { receipt } = await w.append(runId)
    expect(await w.undo(w.request(sessionId, receipt), 'other')).toMatchObject({ status: 'refused', reason: 'sessionClosed' })
    expect(await w.undo({ ...w.request(sessionId, receipt), expectedSha256: 'c'.repeat(64) })).toMatchObject({ status: 'refused', reason: 'unknownReceipt' })
    expect(await w.call(PROPOSAL_UNDO_COMMANDS.release, { sessionId, undoReceipt: receipt.undoReceipt })).toEqual({ status: 'released' })
    expect(await w.undo(w.request(sessionId, receipt))).toMatchObject({ status: 'refused', reason: 'unknownReceipt' })

    const again = await w.run()
    w.pages.set(NOTE, BEFORE)
    const second = await w.append(again.runId)
    expect(await w.call(C.closeSession, { sessionId: again.sessionId })).toEqual({ status: 'closed' })
    expect(await w.undo(w.request(again.sessionId, second.receipt))).toMatchObject({ status: 'refused', reason: 'sessionClosed' })
    expect(w.pages.get(NOTE)).toBe(AFTER)
  })

  it('moves a created note to Trash only while it is exactly as written', async () => {
    const w = setup()
    const { sessionId, runId } = await w.run()
    const folder = await w.call(C.bindFolder, { runId, folder: 'Topics' })
    const content = '# Commentary on Source 2\n'
    const proposal = { kind: 'create', operationId: crypto.randomUUID(), runId, content, contentSha256: await sha256Hex(content), folderHandle: folder.folderHandle, fileName: 'commentary-2.md' }
    const receipt = await w.call(C.submit, { proposal })
    expect(receipt).toMatchObject({ status: 'committed', kind: 'create', undoReceipt: expect.stringMatching(/^undo-/) })
    w.pages.set(`${VAULT}/Topics/commentary-2.md`, `${content}typed\n`)
    expect(await w.undo(w.request(sessionId, receipt))).toMatchObject({ status: 'conflict', reason: 'changed' })
    w.pages.set(`${VAULT}/Topics/commentary-2.md`, content)
    expect(await w.undo(w.request(sessionId, receipt))).toMatchObject({ status: 'undone', kind: 'create', path: `${VAULT}/Topics/commentary-2.md` })
    expect(w.trashed).toEqual([`${VAULT}/Topics/commentary-2.md`])
  })

  it('never reuses a proposal’s operation id and reads the request strictly', async () => {
    const w = setup()
    const { sessionId, runId } = await w.run()
    const { proposal, receipt } = await w.append(runId)
    expect(await w.undo(w.request(sessionId, receipt, proposal.operationId))).toMatchObject({ status: 'refused', reason: 'operationMismatch' })
    await expect(w.undo({ ...w.request(sessionId, receipt), extra: true })).rejects.toThrow()
    expect(w.pages.get(NOTE)).toBe(AFTER)
  })
})
