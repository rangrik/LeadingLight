// The bundled website recipe in the browser model: listed everywhere, on by default only where the
// host performs `web.capture`, and an explicit host list that never grows with the schema.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EXTENSION_COMMANDS } from '../leadinglight/extensions/extensionApi'
import { CAPABILITIES, E2_HOST_CAPABILITIES } from '../leadinglight/extensions/extensionContract'
import { PROPOSAL_COMMANDS } from '../leadinglight/proposals/proposalContract'
import { PROPOSAL_UNDO_COMMANDS } from '../leadinglight/proposals/proposalUndoContract'
import { sha256Hex } from '../leadinglight/saveOutcome'
import { DEFAULT_ON_PACKAGES, ExtensionBackend, MOCK_HOST_CAPABILITIES, bundledWebsiteText, memoryHost, type MemoryVault } from './mock-extensions'

const fixture = readFileSync(`${process.cwd()}/src/leadinglight/extensions/fixtures/website-capture.json`, 'utf8')
const WEBSITE = bundledWebsiteText(fixture)
const VAULT = '/vault'
const C = EXTENSION_COMMANDS
type Reply = Record<string, unknown>

function setup(capabilities?: readonly (typeof CAPABILITIES)[number][]) {
  const pages = new Map<string, string>()
  const trashed: string[] = []
  const vault: MemoryVault = {
    roots: [VAULT],
    pagePaths: () => pages.keys(),
    createPage: (path, content) => { if (pages.has(path)) return false; pages.set(path, content); return true },
    readPage: path => pages.get(path) ?? null,
    writePage: (path, content) => { pages.set(path, content) },
    trashPage: (_root, path) => { trashed.push(path); return pages.delete(path) },
  }
  const backend = new ExtensionBackend(memoryHost(vault, [WEBSITE]), capabilities ? { capabilities } : {})
  const call = (command: string, args: unknown) => backend.handle(command, args, 'main') as Promise<Reply>
  const website = async () => ((await call(C.list, { vaultPath: VAULT })).extensions as Reply[]).find(item => item.packageId === 'leadinglight.website-capture')!
  return { pages, trashed, call, website }
}

describe('the bundled website recipe', () => {
  it('is the shared fixture with only its id changed', () => {
    expect(WEBSITE).toBe(fixture.replace('"local.website-capture"', '"leadinglight.website-capture"'))
    expect(WEBSITE).not.toBe(fixture)
    expect(DEFAULT_ON_PACKAGES.has('leadinglight.website-capture')).toBe(true)
  })

  it('stays off, and cannot be turned on, where the host does not fetch', async () => {
    expect(MOCK_HOST_CAPABILITIES).toEqual(E2_HOST_CAPABILITIES)
    expect(MOCK_HOST_CAPABILITIES).not.toContain('web.capture')
    const host = setup()
    const listed = await host.website()
    expect(listed).toMatchObject({ name: 'Save from website', activeSha256: null })
    const sha = (listed.versions as Reply[])[0].packageSha256
    expect(await host.call(C.activate, { vaultPath: VAULT, packageId: 'leadinglight.website-capture', packageSha256: sha, expectedActiveSha256: null }))
      .toEqual({ status: 'refused', reason: 'missingCapabilities', missingCapabilities: ['web.capture'] })
  })

  it('is on by default where the host fetches, and its create offers Undo to Trash', async () => {
    const host = setup([...MOCK_HOST_CAPABILITIES, 'web.capture'])
    const listed = await host.website()
    expect(listed.activeSha256).toBe((listed.versions as Reply[])[0].packageSha256)
    const { sessionId } = await host.call(C.openSession, { vaultPath: VAULT }) as { sessionId: string }
    const admission = await host.call(C.beginRun, { sessionId, packageSha256: listed.activeSha256, commandId: 'save-page', invocationId: crypto.randomUUID() })
    const runId = (admission.scope as Reply).runId as string
    const bound = await host.call(C.bindFolder, { runId, folder: '' })
    const content = '---\nsource: https://fixtures.leadinglight.invalid/lighthouse\n---\n# Lighthouse log\n'
    const proposal = { kind: 'create', operationId: crypto.randomUUID(), runId, folderHandle: bound.folderHandle, fileName: 'lighthouse-log.md', content, contentSha256: await sha256Hex(content) }
    const receipt = await host.call(PROPOSAL_COMMANDS.submit, { proposal })
    expect(receipt).toMatchObject({ status: 'committed', kind: 'create', path: `${VAULT}/lighthouse-log.md` })
    expect(host.pages.get(`${VAULT}/lighthouse-log.md`)).toBe(content)
    const undone = await host.call(PROPOSAL_UNDO_COMMANDS.undo, { request: {
      operationId: crypto.randomUUID(), sessionId, undoReceipt: receipt.undoReceipt, kind: 'create', expectedSha256: receipt.afterSha256, beforeSha256: null,
    } })
    expect(undone).toMatchObject({ status: 'undone', kind: 'create' })
    expect(host.trashed).toEqual([`${VAULT}/lighthouse-log.md`])
  })
})
