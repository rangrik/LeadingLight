import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EXTENSION_COMMANDS } from '../leadinglight/extensions/extensionApi'
import { PROPOSAL_COMMANDS, type CreateProposal } from '../leadinglight/proposals/proposalContract'
import { sha256Hex } from '../leadinglight/saveOutcome'
import {
  BRIDGE_LIMITS, ExtensionArgumentError, ExtensionBackend, memoryHost,
  type ExtensionHost, type MemoryVault, type PageWrite, type Publication,
} from './mock-extensions'

// The shared browser model against a host whose effects a test controls: one-shot holds stand at
// the read, create and publication boundaries, so every interleaving here is deterministic.
const root = process.cwd()
const fixture = (name: string) => readFileSync(`${root}/src/leadinglight/extensions/fixtures/${name}`, 'utf8')
const BUNDLED = readFileSync(`${root}/src-tauri/src/leadinglight_extensions/bundled/meeting-debrief.json`, 'utf8')
const QUICK = fixture('quick-note.json')
const VAULT = '/vault'
const TEXT = '# Debrief\n\nLiteral <b>text</b> stays text.\n'
const C = { ...EXTENSION_COMMANDS, submit: PROPOSAL_COMMANDS.submit, query: PROPOSAL_COMMANDS.query }

/** The quick-note package under another id or version: other bytes, so another hash. */
const quickNote = (version = '1.0.0', id = 'local.quick-note') =>
  QUICK.replace('"id": "local.quick-note"', `"id": "${id}"`).replace('"version": "1.0.0"', `"version": "${version}"`)

interface Gate { readonly reached: Promise<void>; release(): void; wait(): Promise<void> }
function gate(): Gate {
  let signal: () => void = () => undefined
  let open: () => void = () => undefined
  const reached = new Promise<void>(resolve => { signal = () => resolve() })
  const opened = new Promise<void>(resolve => { open = () => resolve() })
  return {
    reached,
    release: () => open(),
    wait: async () => {
      signal()
      await opened
    },
  }
}

const flush = async () => {
  for (let turn = 0; turn < 20; turn++) await new Promise(resolve => setTimeout(resolve, 0))
}

function testHost() {
  const blobs = new Map<string, string>()
  const pages = new Map<string, string>([[`${VAULT}/Meetings/Existing.md`, 'old'], [`${VAULT}/page.md`, 'a page']])
  const control = {
    blobs, pages,
    preferences: null as string | null,
    preferencesUnusable: false,
    publication: 'synced' as Publication,
    deleteFails: false,
    setAside: 0,
    warnings: [] as string[],
    creates: 0,
    createResult: null as PageWrite | 'throw' | null,
    holdRead: null as Gate | null,
    holdCreate: null as Gate | null,
    holdPublish: null as Gate | null,
  }
  const take = (key: 'holdRead' | 'holdCreate' | 'holdPublish') => {
    const hold = control[key]
    control[key] = null
    return hold
  }
  const vault: MemoryVault = {
    roots: [VAULT],
    pagePaths: () => pages.keys(),
    createPage: (path, content) => {
      if (pages.has(path)) return false
      pages.set(path, content)
      return true
    },
  }
  const base = memoryHost(vault, [BUNDLED])
  const host: ExtensionHost = {
    ...base,
    // The bytes are read first, then the hold: as native's paused package read.
    async readBlob(sha) {
      const text = blobs.get(sha) ?? null
      await take('holdRead')?.wait()
      return text
    },
    async writeBlob(sha, text) {
      blobs.set(sha, text)
      return true
    },
    async deleteBlob(sha) {
      if (control.deleteFails) return false
      blobs.delete(sha)
      return true
    },
    async scanBlobs(limit) {
      const hashes = [...blobs.keys()]
      return { hashes: hashes.slice(0, limit), complete: hashes.length <= limit }
    },
    async readPreferences() {
      if (control.preferencesUnusable) return { status: 'unusable' }
      return control.preferences === null ? { status: 'missing' } : { status: 'text', text: control.preferences }
    },
    // Published first, then held: the window between publication and its answer.
    async writePreferences(text) {
      if (control.publication === 'notPublished') return 'notPublished'
      control.preferences = text
      await take('holdPublish')?.wait()
      return control.publication
    },
    async setPreferencesAside() {
      control.setAside += 1
      control.preferences = null
    },
    async createPage(roots, folder, fileName, content) {
      control.creates += 1
      await take('holdCreate')?.wait()
      const forced = control.createResult
      if (forced === 'throw') throw new Error('The reply was lost.')
      return forced ?? base.createPage(roots, folder, fileName, content)
    },
    warn: message => { control.warnings.push(message) },
  }
  return { host, control }
}

type Reply = Record<string, unknown>

function world(shared = testHost()) {
  const { host, control } = shared
  const backend = new ExtensionBackend(host)
  const call = (command: string, args: unknown, owner = 'main') => backend.handle(command, args, owner) as Promise<Reply>
  const sha = (text: string) => sha256Hex(text)
  const api = {
    backend, control, shared, call,
    importText: (packageText: string) => call(C.importCandidate, { packageText }),
    list: async () => (await call(C.list, { vaultPath: VAULT })).extensions as Reply[],
    entry: async (packageId: string) => (await api.list()).find(item => item.packageId === packageId),
    activate: async (text: string, expected: string | null = null) => {
      const parsed = JSON.parse(text) as { id: string }
      return call(C.activate, { vaultPath: VAULT, packageId: parsed.id, packageSha256: await sha(text), expectedActiveSha256: expected })
    },
    session: async (owner = 'main') => (await call(C.openSession, { vaultPath: VAULT }, owner)).sessionId as string,
    begin: async (sessionId: string, text: string, invocationId = crypto.randomUUID(), owner = 'main', commandId = 'quick') =>
      call(C.beginRun, { sessionId, packageSha256: await sha(text), commandId, invocationId }, owner),
    run: async (text = QUICK, owner = 'main', sessionId?: string) => {
      const session = sessionId ?? await api.session(owner)
      const invocationId = crypto.randomUUID()
      const admission = await api.begin(session, text, invocationId, owner)
      expect(admission.status).toBe('admitted')
      return { sessionId: session, invocationId, runId: (admission.scope as Reply).runId as string }
    },
    folder: async (runId: string, folder = 'Meetings', owner = 'main') => call(C.bindFolder, { runId, folder }, owner),
    handle: async (runId: string, folder = 'Meetings', owner = 'main') => (await api.folder(runId, folder, owner)).folderHandle as string,
    proposal: async (runId: string, folderHandle: string, fileName = 'Debrief.md', content = TEXT, operationId = crypto.randomUUID()): Promise<CreateProposal> =>
      ({ kind: 'create', operationId, runId, content, contentSha256: await sha(content), folderHandle, fileName }),
    submit: (proposal: unknown, owner = 'main') => call(C.submit, { proposal }, owner),
    query: (operationId: string, owner = 'main') => call(C.query, { operationId }, owner),
    /** Quick note imported, turned on, and one run with the Meetings folder bound. */
    ready: async (owner = 'main') => {
      await api.importText(QUICK)
      const current = (await api.entry('local.quick-note'))?.activeSha256 as string | null | undefined
      if (!current) await api.activate(QUICK)
      const run = await api.run(QUICK, owner)
      return { ...run, folderHandle: await api.handle(run.runId, 'Meetings', owner) }
    },
  }
  return api
}

const committed = (proposal: CreateProposal, path: string) => ({
  status: 'committed', kind: 'create', operationId: proposal.operationId, path,
  beforeSha256: null, afterSha256: proposal.contentSha256, durable: true, undoReceipt: null,
})

describe('packages and the shared validator corpus', () => {
  const cases = JSON.parse(fixture('cases.json')) as { valid: string[]; invalid: { file: string; code: string; path: string }[] }

  it('imports every valid fixture as a candidate only, and E1-unsupported recipes stay visible but cannot turn on', async () => {
    const w = world()
    for (const name of cases.valid) {
      const text = fixture(name)
      const reply = await w.importText(text)
      expect(reply).toMatchObject({ status: 'candidate', packageSha256: await sha256Hex(text) })
    }
    expect(await w.importText(fixture('quick-note.json'))).toMatchObject({ missingCapabilities: [] })
    for (const name of ['passage-commentary.json', 'append-observation.json']) {
      const text = fixture(name)
      const imported = await w.importText(text)
      expect((imported.missingCapabilities as string[]).length).toBeGreaterThan(0)
      expect(await w.activate(text)).toEqual({ status: 'refused', reason: 'missingCapabilities', missingCapabilities: imported.missingCapabilities })
      expect(await w.begin(await w.session(), text, crypto.randomUUID(), 'main', 'comment')).toEqual({ status: 'refused', reason: 'notActive' })
    }
    for (const extension of await w.list()) expect(extension.activeSha256).toBeNull()
  })

  it('refuses each invalid fixture with exactly its one shared diagnostic and stores nothing', async () => {
    const w = world()
    for (const item of cases.invalid) {
      const reply = await w.importText(fixture(item.file))
      expect(reply.status, item.file).toBe('invalid')
      expect((reply.diagnostics as Reply[]).map(d => [d.code, d.path]), item.file).toEqual([[item.code, item.path]])
    }
    expect(w.control.blobs.size).toBe(0)
    expect((await w.list()).map(item => item.packageId)).toEqual(['leadinglight.meeting-debrief'])
  })

  it('ships the bundled Meeting debrief off by default under its reserved id, which no import may claim', async () => {
    const w = world()
    const bundledSha = await sha256Hex(BUNDLED)
    expect(await w.entry('leadinglight.meeting-debrief')).toEqual({
      packageId: 'leadinglight.meeting-debrief', name: 'Meeting debrief',
      versions: [{ packageSha256: bundledSha, version: '1.0.0', readable: true }], activeSha256: null, previousSha256: null,
    })
    expect(await w.importText(BUNDLED)).toEqual({ status: 'refused', reason: 'reservedId' })
    expect(await w.importText(quickNote('1.0.0', 'leadinglight.quick-note'))).toEqual({ status: 'refused', reason: 'reservedId' })
    expect(await w.call(C.read, { packageSha256: bundledSha })).toEqual({ status: 'ok', packageText: BUNDLED })
    expect(await w.activate(BUNDLED)).toEqual({ status: 'active', packageSha256: bundledSha, previousSha256: null, revokedRuns: 0 })
    const session = await w.session()
    expect(await w.begin(session, BUNDLED)).toEqual({ status: 'refused', reason: 'unknownCommand' })
    expect(await w.begin(session, BUNDLED, crypto.randomUUID(), 'main', 'new-debrief')).toMatchObject({ status: 'admitted' })
  })

  it('never activates on import, keeps a changed candidate beside the active version, and stores exact bytes once', async () => {
    const w = world()
    const v1 = quickNote('1.0.0')
    const v2 = quickNote('1.1.0')
    const first = await w.importText(v1)
    expect(await w.importText(v1)).toEqual(first)
    await w.activate(v1)
    await w.importText(v2)
    const entry = await w.entry('local.quick-note')
    expect(entry?.activeSha256).toBe(await sha256Hex(v1))
    expect((entry?.versions as Reply[]).map(v => v.version)).toEqual(['1.1.0', '1.0.0'])
    expect(await w.call(C.read, { packageSha256: await sha256Hex(v2) })).toEqual({ status: 'ok', packageText: v2 })
    expect(await w.call(C.read, { packageSha256: '0'.repeat(64) })).toEqual({ status: 'unknown' })
  })
})

describe('activation, rollback and turning off', () => {
  it('compares and sets per vault, rolls back to the previous version and turns off to previous', async () => {
    const w = world()
    const [a, b] = [quickNote('1.0.0'), quickNote('2.0.0')]
    const [shaA, shaB] = [await sha256Hex(a), await sha256Hex(b)]
    await w.importText(a)
    await w.importText(b)
    expect(await w.activate(a)).toEqual({ status: 'active', packageSha256: shaA, previousSha256: null, revokedRuns: 0 })
    expect(await w.activate(b)).toEqual({ status: 'refused', reason: 'changed', missingCapabilities: [] })
    expect(await w.activate(b, shaA)).toEqual({ status: 'active', packageSha256: shaB, previousSha256: shaA, revokedRuns: 0 })
    expect(await w.activate(a, shaB)).toEqual({ status: 'active', packageSha256: shaA, previousSha256: shaB, revokedRuns: 0 })
    expect(await w.call(C.deactivate, { vaultPath: VAULT, packageId: 'local.quick-note', expectedActiveSha256: shaB }))
      .toEqual({ status: 'refused', reason: 'changed' })
    expect(await w.call(C.deactivate, { vaultPath: VAULT, packageId: 'local.quick-note', expectedActiveSha256: shaA }))
      .toEqual({ status: 'inactive', revokedRuns: 0 })
    expect(await w.entry('local.quick-note')).toMatchObject({ activeSha256: null, previousSha256: shaA })
    expect(await w.call(C.activate, { vaultPath: VAULT, packageId: 'local.other', packageSha256: shaA, expectedActiveSha256: null }))
      .toEqual({ status: 'refused', reason: 'unknownVersion', missingCapabilities: [] })
    expect(await w.call(C.list, { vaultPath: '/elsewhere' })).toEqual({ status: 'refused', reason: 'vaultUnavailable' })
  })

  it('refuses a version an import dropped while its activation was checked, with no write or revocation', async () => {
    const shared = testHost()
    const w = world(shared)
    const versions = Array.from({ length: 8 }, (_, n) => quickNote(`1.0.${n}`))
    for (const text of versions) await w.importText(text)
    const hold = gate()
    w.control.holdRead = hold
    const activation = w.activate(versions[0])
    await hold.reached
    expect(await w.importText(quickNote('1.0.8'))).toMatchObject({ status: 'candidate' })
    hold.release()
    expect(await activation).toEqual({ status: 'refused', reason: 'unknownVersion', missingCapabilities: [] })
    const entry = await w.entry('local.quick-note')
    expect(entry?.activeSha256).toBeNull()
    expect((entry?.versions as Reply[]).map(v => v.packageSha256)).not.toContain(await sha256Hex(versions[0]))
    expect(await w.begin(await w.session(), versions[0])).toEqual({ status: 'refused', reason: 'notActive' })
    expect(await w.activate(versions[1])).toMatchObject({ status: 'active' })
    const restarted = world(shared)
    expect((await restarted.entry('local.quick-note'))?.activeSha256).toBe(await sha256Hex(versions[1]))
    expect(((await restarted.entry('local.quick-note'))?.versions as Reply[]).length).toBe(8)
    expect(shared.control.setAside).toBe(0)
  })

  it('keeps every active and previous version when imports drop old ones at the per-package bound', async () => {
    const w = world()
    const versions = Array.from({ length: 10 }, (_, n) => quickNote(`3.0.${n}`))
    await w.importText(versions[0])
    await w.importText(versions[1])
    await w.activate(versions[0])
    await w.activate(versions[1], await sha256Hex(versions[0]))
    for (const text of versions.slice(2)) expect(await w.importText(text)).toMatchObject({ status: 'candidate' })
    const kept = ((await w.entry('local.quick-note'))?.versions as Reply[]).map(v => v.packageSha256)
    expect(kept).toHaveLength(BRIDGE_LIMITS.versionsPerPackage)
    expect(kept).toContain(await sha256Hex(versions[0]))
    expect(kept).toContain(await sha256Hex(versions[1]))
    expect(w.control.blobs.size).toBe(BRIDGE_LIMITS.versionsPerPackage)
  })
})

describe('preference publication', () => {
  it('refuses a change that was not published and changes, revokes and leaves nothing', async () => {
    const w = world()
    const [a, b, c] = [quickNote('1.0.0'), quickNote('2.0.0'), quickNote('3.0.0')]
    await w.importText(a)
    await w.importText(b)
    await w.activate(a)
    const run = await w.run(a)
    const before = w.control.preferences
    w.control.publication = 'notPublished'
    expect(await w.activate(b, await sha256Hex(a))).toEqual({ status: 'refused', reason: 'vaultUnavailable', missingCapabilities: [] })
    expect(await w.call(C.deactivate, { vaultPath: VAULT, packageId: 'local.quick-note', expectedActiveSha256: await sha256Hex(a) }))
      .toEqual({ status: 'refused', reason: 'vaultUnavailable' })
    const blobs = w.control.blobs.size
    expect(await w.importText(c)).toEqual({ status: 'refused', reason: 'storageUnavailable' })
    expect(w.control.blobs.size).toBe(blobs)
    expect(w.control.preferences).toBe(before)
    expect((await w.entry('local.quick-note'))?.activeSha256).toBe(await sha256Hex(a))
    expect(await w.folder(run.runId)).toMatchObject({ status: 'bound' })
  })

  it('answers and revokes a change that was published even when its folder could not be synced', async () => {
    const shared = testHost()
    const w = world(shared)
    const [a, b] = [quickNote('1.0.0'), quickNote('2.0.0')]
    await w.importText(a)
    await w.importText(b)
    await w.activate(a)
    const run = await w.run(a)
    w.control.publication = 'unsynced'
    expect(await w.activate(b, await sha256Hex(a))).toMatchObject({ status: 'active', revokedRuns: 1 })
    expect(await w.folder(run.runId)).toEqual({ status: 'refused', reason: 'staleRun' })
    expect(await w.begin(await w.session(), a)).toEqual({ status: 'refused', reason: 'notActive' })
    expect(w.control.warnings.some(message => message.includes('could not be synced'))).toBe(true)
    expect((await world(shared).entry('local.quick-note'))?.activeSha256).toBe(await sha256Hex(b))
    expect(await w.call(C.deactivate, { vaultPath: VAULT, packageId: 'local.quick-note', expectedActiveSha256: await sha256Hex(b) }))
      .toEqual({ status: 'inactive', revokedRuns: 0 })
    expect((await world(shared).entry('local.quick-note'))?.activeSha256).toBeNull()
  })

  it('stops at the end of the sequence numbers instead of wrapping, keeping its state', async () => {
    const shared = testHost()
    const w = world(shared)
    await w.importText(QUICK)
    await w.activate(QUICK)
    const stored = JSON.parse(shared.control.preferences as string) as Reply
    shared.control.preferences = JSON.stringify({ ...stored, nextSeq: BRIDGE_LIMITS.sequence })
    const late = world(shared)
    expect(await late.importText(quickNote('9.0.0'))).toEqual({ status: 'refused', reason: 'storageUnavailable' })
    expect(await late.call(C.deactivate, { vaultPath: VAULT, packageId: 'local.quick-note', expectedActiveSha256: await sha256Hex(QUICK) }))
      .toEqual({ status: 'refused', reason: 'vaultUnavailable' })
    expect((await late.entry('local.quick-note'))?.activeSha256).toBe(await sha256Hex(QUICK))
    expect(shared.control.setAside).toBe(0)
  })

  it('allows the last increment up to 2^53 exactly once', async () => {
    const shared = testHost()
    const w = world(shared)
    await w.importText(QUICK)
    const stored = JSON.parse(shared.control.preferences as string) as Reply
    shared.control.preferences = JSON.stringify({ ...stored, nextSeq: BRIDGE_LIMITS.sequence - 1 })
    const late = world(shared)
    expect(await late.importText(quickNote('9.0.0'))).toMatchObject({ status: 'candidate' })
    expect((JSON.parse(shared.control.preferences as string) as Reply).nextSeq).toBe(BRIDGE_LIMITS.sequence)
    expect(await late.importText(quickNote('9.1.0'))).toEqual({ status: 'refused', reason: 'storageUnavailable' })
    expect(((await world(shared).entry('local.quick-note'))?.versions as Reply[]).length).toBe(2)
    expect(shared.control.setAside).toBe(0)
  })
})

describe('the preference reader', () => {
  async function baseline() {
    const shared = testHost()
    const w = world(shared)
    await w.importText(quickNote('1.0.0'))
    await w.importText(quickNote('2.0.0'))
    await w.activate(quickNote('1.0.0'))
    await w.activate(quickNote('2.0.0'), await sha256Hex(quickNote('1.0.0')))
    return { shared, stored: JSON.parse(shared.control.preferences as string) as Reply }
  }
  type Stored = { nextSeq: number; imports: Reply[]; vaults: Record<string, { touched: number; active: Record<string, string>; previous: Record<string, string> }> }
  const variants: [string, (stored: Stored) => unknown][] = [
    ['nextSeq beyond 2^53', s => ({ ...s, nextSeq: 2 ** 53 + 2 })],
    ['nextSeq not past an import', s => ({ ...s, nextSeq: Math.max(...s.imports.map(i => i.seq as number)) })],
    ['a vault touched in the future', s => ({ ...s, vaults: { [VAULT]: { ...s.vaults[VAULT], touched: s.nextSeq } } })],
    ['a duplicate import', s => ({ ...s, imports: [...s.imports, s.imports[0]] })],
    ['a path where a hash belongs', s => ({ ...s, imports: [{ ...s.imports[0], packageSha256: '../escape' }, ...s.imports.slice(1)] })],
    ['a reserved import', s => ({ ...s, imports: [{ ...s.imports[0], packageId: 'leadinglight.quick-note' }, ...s.imports.slice(1)] })],
    ['a 201-byte name', s => ({ ...s, imports: [{ ...s.imports[0], name: 'x'.repeat(201) }, ...s.imports.slice(1)] })],
    ['an invalid version', s => ({ ...s, imports: [{ ...s.imports[0], version: '01.0.0' }, ...s.imports.slice(1)] })],
    ['an invalid package id', s => ({ ...s, imports: [{ ...s.imports[0], packageId: 'local..x' }, ...s.imports.slice(1)] })],
    ['a name with a direction override', s => ({ ...s, imports: [{ ...s.imports[0], name: `Quick ${String.fromCodePoint(0x202e)} note` }, ...s.imports.slice(1)] })],
    ['a vault key of 4097 UTF-8 bytes in fewer characters', s => ({ ...s, vaults: { [`/${'é'.repeat(2048)}`]: s.vaults[VAULT] } })],
    ['65 imports', s => ({ ...s, nextSeq: 100, imports: Array.from({ length: 65 }, (_, n) => ({ ...s.imports[0], packageId: `local.p${n}`, packageSha256: n.toString(16).padStart(64, '0'), seq: n })) })],
    ['an active version never stored', s => ({ ...s, vaults: { [VAULT]: { ...s.vaults[VAULT], active: { ...s.vaults[VAULT].active, 'local.other': 'a'.repeat(64) } } } })],
    ['active equal to previous', s => ({ ...s, vaults: { [VAULT]: { ...s.vaults[VAULT], previous: s.vaults[VAULT].active } } })],
    ['a 4097-byte vault key', s => ({ ...s, vaults: { [`/${'v'.repeat(4096)}`]: s.vaults[VAULT] } })],
    ['an unknown field', s => ({ ...s, extra: true })],
    ['an unknown import field', s => ({ ...s, imports: [{ ...s.imports[0], extra: 1 }, ...s.imports.slice(1)] })],
    ['another format', s => ({ ...s, format: 2 })],
  ]

  it('loads its own preferences unchanged', async () => {
    const { shared } = await baseline()
    const w = world(shared)
    expect((await w.entry('local.quick-note'))?.activeSha256).toBe(await sha256Hex(quickNote('2.0.0')))
    expect(shared.control.setAside).toBe(0)
  })

  it.each(variants)('sets aside preferences with %s and starts with everything off', async (_name, mutate) => {
    const { shared, stored } = await baseline()
    shared.control.preferences = JSON.stringify(mutate(stored as unknown as Stored))
    const w = world(shared)
    const entry = await w.entry('local.quick-note')
    expect(entry?.activeSha256).toBeNull()
    expect(entry?.previousSha256).toBeNull()
    expect((entry?.versions as Reply[]).length).toBe(2)
    expect(shared.control.setAside).toBe(1)
    expect(await w.begin(await w.session(), quickNote('2.0.0'))).toEqual({ status: 'refused', reason: 'notActive' })
    expect(await w.activate(quickNote('1.0.0'))).toMatchObject({ status: 'active' })
  })

  it('sets aside unusable or unparsable preferences the same way', async () => {
    for (const setup of [(c: ReturnType<typeof testHost>['control']) => { c.preferencesUnusable = true }, (c: ReturnType<typeof testHost>['control']) => { c.preferences = 'not json' }]) {
      const { shared } = await baseline()
      setup(shared.control)
      const w = world(shared)
      expect((await w.entry('local.quick-note'))?.activeSha256).toBeNull()
      expect(shared.control.setAside).toBe(1)
    }
  })

  it('drops only a bundled activation this app no longer ships, keeping the rest', async () => {
    const { shared, stored } = await baseline()
    const vaults = stored.vaults as Stored['vaults']
    const changed = { ...stored, vaults: { [VAULT]: { ...vaults[VAULT], active: { ...vaults[VAULT].active, 'leadinglight.meeting-debrief': 'b'.repeat(64) } } } }
    shared.control.preferences = JSON.stringify(changed)
    const w = world(shared)
    expect((await w.entry('leadinglight.meeting-debrief'))?.activeSha256).toBeNull()
    expect((await w.entry('local.quick-note'))?.activeSha256).toBe(await sha256Hex(quickNote('2.0.0')))
    expect(shared.control.setAside).toBe(0)
    expect(shared.control.warnings.some(message => message.includes('built-in extension changed'))).toBe(true)
  })
})

describe('package file bounds', () => {
  it('leaves no new file after failed publications and stays within one file beyond the bound when removal fails too', async () => {
    const w = world()
    await w.importText(quickNote('1.0.0'))
    await w.activate(quickNote('1.0.0'))
    w.control.publication = 'notPublished'
    for (let n = 0; n < 20; n++) expect(await w.importText(quickNote(`5.${n}.0`, `local.fail-${n}`))).toMatchObject({ status: 'refused' })
    expect(w.control.blobs.size).toBe(1)
    w.control.deleteFails = true
    let most = 0
    for (let n = 0; n < 84; n++) {
      await w.importText(quickNote(`6.${n}.0`, `local.leak-${n}`))
      most = Math.max(most, w.control.blobs.size)
    }
    expect(most).toBeLessThanOrEqual(BRIDGE_LIMITS.storedVersions + 1)
    expect(w.control.blobs.has(await sha256Hex(quickNote('1.0.0')))).toBe(true)
    w.control.deleteFails = false
    w.control.publication = 'synced'
    expect(await w.importText(quickNote('7.0.0'))).toMatchObject({ status: 'candidate' })
    expect(w.control.blobs.size).toBe(2)
  })

  it('counts a failed prune until its file is removed, and never drops an active version', async () => {
    const w = world()
    const texts = Array.from({ length: 64 }, (_, n) => quickNote(`1.0.${n % 8}`, `local.pack-${Math.floor(n / 8)}`))
    for (const text of texts) expect(await w.importText(text)).toMatchObject({ status: 'candidate' })
    await w.activate(texts[0])
    w.control.deleteFails = true
    expect(await w.importText(quickNote('2.0.0', 'local.extra-a'))).toMatchObject({ status: 'candidate' })
    expect(w.control.blobs.size).toBe(65)
    expect(await w.importText(quickNote('2.0.0', 'local.extra-b'))).toEqual({ status: 'refused', reason: 'storageUnavailable' })
    w.control.deleteFails = false
    expect(await w.importText(quickNote('2.0.0', 'local.extra-b'))).toMatchObject({ status: 'candidate' })
    expect(w.control.blobs.size).toBe(64)
    expect(w.control.blobs.has(await sha256Hex(texts[0]))).toBe(true)
  })

  it('repairs a stored version only within the same file bound, and reuses valid bytes without a new file', async () => {
    const w = world()
    await w.importText(QUICK)
    await w.activate(QUICK)
    const sha = await sha256Hex(QUICK)
    w.control.publication = 'notPublished'
    w.control.deleteFails = true
    for (let n = 0; n < 70; n++) await w.importText(quickNote(`4.${n}.0`, `local.stuck-${n}`))
    expect(w.control.blobs.size).toBe(BRIDGE_LIMITS.storedVersions + 1)
    w.control.publication = 'synced'
    expect(await w.importText(QUICK)).toMatchObject({ status: 'candidate', packageSha256: sha })
    expect(w.control.blobs.size).toBe(BRIDGE_LIMITS.storedVersions + 1)
    w.control.blobs.delete(sha)
    expect(await w.importText(QUICK)).toMatchObject({ status: 'candidate' })
    expect(w.control.blobs.size).toBe(BRIDGE_LIMITS.storedVersions + 1)
    w.control.blobs.delete(sha)
    w.control.blobs.set('f'.repeat(64), 'left by an earlier attempt')
    expect(await w.importText(QUICK)).toEqual({ status: 'refused', reason: 'storageUnavailable' })
    expect(w.control.blobs.size).toBe(BRIDGE_LIMITS.storedVersions + 1)
    expect(await w.entry('local.quick-note')).toMatchObject({ activeSha256: sha, versions: [{ readable: false }] })
  })

  it('keeps a missing package listed as unreadable, admits nothing from it, and repairs it on import', async () => {
    const shared = testHost()
    const w = world(shared)
    await w.importText(QUICK)
    await w.activate(QUICK)
    const sha = await sha256Hex(QUICK)
    shared.control.blobs.delete(sha)
    const restarted = world(shared)
    expect(await restarted.entry('local.quick-note')).toMatchObject({ activeSha256: sha, versions: [{ packageSha256: sha, readable: false }] })
    expect(await restarted.begin(await restarted.session(), QUICK)).toEqual({ status: 'refused', reason: 'unreadable' })
    expect(await restarted.call(C.read, { packageSha256: sha })).toEqual({ status: 'unreadable' })
    shared.control.blobs.set(sha, `${QUICK} `)
    expect(await restarted.activate(QUICK, sha)).toEqual({ status: 'refused', reason: 'unreadable', missingCapabilities: [] })
    expect(await restarted.importText(QUICK)).toMatchObject({ status: 'candidate' })
    expect(await restarted.entry('local.quick-note')).toMatchObject({ activeSha256: sha, versions: [{ packageSha256: sha, readable: true }] })
    expect(await restarted.begin(await restarted.session(), QUICK)).toMatchObject({ status: 'admitted' })
    expect(shared.control.setAside).toBe(0)
  })
})

describe('sessions and admission', () => {
  it('answers only the owner that opened a session, with a fresh id for every visit', async () => {
    const w = world()
    await w.importText(QUICK)
    await w.activate(QUICK)
    const first = await w.session()
    const second = await w.session()
    expect(first).not.toBe(second)
    expect(await w.begin(first, QUICK, crypto.randomUUID(), 'other')).toEqual({ status: 'refused', reason: 'sessionClosed' })
    expect(await w.call(C.closeSession, { sessionId: first }, 'other')).toEqual({ status: 'unknown' })
    expect(await w.call(C.endRun, { sessionId: first, invocationId: 'k1' }, 'other')).toEqual({ status: 'unknownSession' })
    expect(await w.call(C.closeSession, { sessionId: first })).toEqual({ status: 'closed' })
    expect(await w.call(C.closeSession, { sessionId: first })).toEqual({ status: 'closed' })
    expect(await w.call(C.closeSession, { sessionId: first }, 'other')).toEqual({ status: 'unknown' })
    expect(await w.begin(first, QUICK)).toEqual({ status: 'refused', reason: 'sessionClosed' })
    expect(await w.call(C.closeSession, { sessionId: 'session-never' })).toEqual({ status: 'unknown' })
    expect(await w.call(C.openSession, { vaultPath: '/elsewhere' })).toEqual({ status: 'refused', reason: 'vaultUnavailable' })
  })

  it('keeps an ended request out, whether the end came before or during its admission', async () => {
    const w = world()
    await w.importText(QUICK)
    await w.activate(QUICK)
    const session = await w.session()
    expect(await w.call(C.endRun, { sessionId: session, invocationId: 'early' })).toEqual({ status: 'ended' })
    expect(await w.begin(session, QUICK, 'early')).toEqual({ status: 'refused', reason: 'cancelled' })
    const hold = gate()
    w.control.holdRead = hold
    const pending = w.begin(session, QUICK, 'during')
    await hold.reached
    expect(await w.call(C.endRun, { sessionId: session, invocationId: 'during' })).toEqual({ status: 'ended' })
    hold.release()
    expect(await pending).toEqual({ status: 'refused', reason: 'cancelled' })
    // The cancelled admission gave its live slot back: all sixteen fit, and only a seventeenth waits.
    for (let n = 0; n < BRIDGE_LIMITS.liveRunsPerSession; n++) await w.run(QUICK, 'main', session)
    expect(await w.begin(session, QUICK, 'seventeenth')).toEqual({ status: 'refused', reason: 'busy' })
  })

  it('seals a session whose full key table cannot keep an end, even after a pending admission frees a key', async () => {
    const w = world()
    await w.importText(QUICK)
    await w.activate(QUICK)
    const session = await w.session()
    for (let n = 0; n < BRIDGE_LIMITS.keysPerSession - 1; n++) await w.call(C.endRun, { sessionId: session, invocationId: `gone-${n}` })
    const hold = gate()
    w.control.holdRead = hold
    const failing = w.begin(session, QUICK, 'pending', 'main', 'no-such-command')
    await hold.reached
    expect(await w.call(C.endRun, { sessionId: session, invocationId: 'unseen' })).toEqual({ status: 'ended' })
    hold.release()
    expect(await failing).toEqual({ status: 'refused', reason: 'unknownCommand' })
    expect(await w.begin(session, QUICK, 'unseen')).toEqual({ status: 'refused', reason: 'busy' })
    expect(await w.begin(session, QUICK, 'fresh')).toEqual({ status: 'refused', reason: 'busy' })
  })

  it('reserves live capacity while admissions check their package, so two cannot pass the bound together', async () => {
    const w = world()
    await w.importText(QUICK)
    await w.activate(QUICK)
    const session = await w.session()
    for (let n = 0; n < BRIDGE_LIMITS.liveRunsPerSession - 1; n++) await w.run(QUICK, 'main', session)
    const hold = gate()
    w.control.holdRead = hold
    const first = w.begin(session, QUICK, 'first')
    await hold.reached
    expect(await w.begin(session, QUICK, 'second')).toEqual({ status: 'refused', reason: 'busy' })
    hold.release()
    expect(await first).toMatchObject({ status: 'admitted' })
  })

  it('refuses an admission that an activation change overtook, and revokes matching runs on rollback and off', async () => {
    const w = world()
    const [a, b] = [quickNote('1.0.0'), quickNote('2.0.0')]
    await w.importText(a)
    await w.importText(b)
    await w.activate(a)
    const session = await w.session()
    const kept = await w.run(a, 'main', session)
    const hold = gate()
    w.control.holdRead = hold
    const overtaken = w.begin(session, a, 'overtaken')
    await hold.reached
    expect(await w.activate(b, await sha256Hex(a))).toMatchObject({ status: 'active', revokedRuns: 1 })
    hold.release()
    expect(await overtaken).toEqual({ status: 'refused', reason: 'busy' })
    expect(await w.folder(kept.runId)).toEqual({ status: 'refused', reason: 'staleRun' })
    const bRun = await w.run(b, 'main', session)
    expect(await w.call(C.deactivate, { vaultPath: VAULT, packageId: 'local.quick-note', expectedActiveSha256: await sha256Hex(b) }))
      .toEqual({ status: 'inactive', revokedRuns: 1 })
    expect(await w.folder(bRun.runId)).toEqual({ status: 'refused', reason: 'staleRun' })
    expect(await w.begin(session, a, kept.invocationId)).toEqual({ status: 'refused', reason: 'cancelled' })
  })

  it('closes a reloaded owner’s sessions only, and that owner can still settle them', async () => {
    const w = world()
    await w.importText(QUICK)
    await w.activate(QUICK)
    const mine = await w.run(QUICK, 'main')
    const theirs = await w.run(QUICK, 'other')
    w.backend.forgetOwner('main')
    expect(await w.folder(mine.runId)).toEqual({ status: 'refused', reason: 'staleRun' })
    expect(await w.begin(mine.sessionId, QUICK)).toEqual({ status: 'refused', reason: 'sessionClosed' })
    expect(await w.folder(theirs.runId, 'Meetings', 'other')).toMatchObject({ status: 'bound' })
    expect(await w.call(C.closeSession, { sessionId: mine.sessionId })).toEqual({ status: 'closed' })
    expect(await w.call(C.endRun, { sessionId: mine.sessionId, invocationId: mine.invocationId })).toEqual({ status: 'ended' })
    expect(await w.call(C.closeSession, { sessionId: mine.sessionId }, 'other')).toEqual({ status: 'unknown' })
  })

  it('opening one session too many closes that owner’s oldest', async () => {
    const w = world()
    await w.importText(QUICK)
    await w.activate(QUICK)
    const sessions = []
    for (let n = 0; n <= BRIDGE_LIMITS.sessionsPerOwner; n++) sessions.push(await w.session())
    expect(await w.begin(sessions[0], QUICK)).toEqual({ status: 'refused', reason: 'sessionClosed' })
    expect(await w.begin(sessions[1], QUICK)).toMatchObject({ status: 'admitted' })
    expect(await w.call(C.closeSession, { sessionId: sessions[0] })).toEqual({ status: 'closed' })
  })
})

describe('guarded create', () => {
  it('creates one new page with exactly the reviewed bytes and reports it', async () => {
    const w = world()
    const { runId, folderHandle } = await w.ready()
    const proposal = await w.proposal(runId, folderHandle)
    const receipt = await w.submit(proposal)
    expect(receipt).toEqual(committed(proposal, `${VAULT}/Meetings/Debrief.md`))
    expect(w.control.pages.get(`${VAULT}/Meetings/Debrief.md`)).toBe(TEXT)
    expect(await w.query(proposal.operationId)).toEqual(receipt)
    expect(await w.query(proposal.operationId, 'other')).toEqual({ status: 'unknown', operationId: proposal.operationId })
    const root = await w.ready()
    const atRoot = await w.proposal(root.runId, await w.handle(root.runId, ''), 'Root.md')
    expect(await w.submit(atRoot)).toMatchObject({ status: 'committed', path: `${VAULT}/Root.md` })
  })

  it('answers one operation id with one write whatever is sent again', async () => {
    const w = world()
    const { runId, folderHandle } = await w.ready()
    const original = await w.proposal(runId, folderHandle)
    const receipt = await w.submit(original)
    expect(await w.submit(original)).toEqual(receipt)
    const mismatch = (operationId: string) => ({ status: 'refused', operationId, reason: 'operationMismatch' })
    expect(await w.submit({ ...original, fileName: 'Other.md' })).toEqual(mismatch(original.operationId))
    expect(await w.submit(original, 'other')).toEqual(mismatch(original.operationId))
    const second = await w.proposal(runId, folderHandle, 'Second.md')
    expect(await w.submit(second)).toEqual(mismatch(second.operationId))
    const other = await w.ready()
    expect(await w.submit({ ...original, runId: other.runId, folderHandle: other.folderHandle, fileName: 'Third.md' })).toEqual(mismatch(original.operationId))
    expect(w.control.creates).toBe(1)
    expect(w.control.pages.size).toBe(3)
  })

  it('refuses new work once the ledger is full and never forgets an id', async () => {
    const w = world()
    const { runId, folderHandle } = await w.ready()
    const original = await w.proposal(runId, folderHandle)
    const receipt = await w.submit(original)
    for (let n = 1; n < BRIDGE_LIMITS.operations; n++) {
      const filler = await w.proposal('run-missing', 'folder-missing', 'Filler.md')
      expect(await w.submit(filler)).toEqual({ status: 'refused', operationId: filler.operationId, reason: 'staleRun' })
    }
    const next = await w.ready()
    const fresh = await w.proposal(next.runId, next.folderHandle, 'New.md')
    expect(await w.submit(fresh)).toEqual({ status: 'refused', operationId: fresh.operationId, reason: 'busy' })
    expect(await w.query(fresh.operationId)).toEqual({ status: 'unknown', operationId: fresh.operationId })
    expect(await w.submit({ ...original, runId: next.runId, folderHandle: next.folderHandle, fileName: 'Again.md' }))
      .toEqual({ status: 'refused', operationId: original.operationId, reason: 'operationMismatch' })
    expect(await w.submit(original)).toEqual(receipt)
    expect(w.control.creates).toBe(1)
  })

  it('makes a duplicate wait for the running write and answers it the same, with query reporting running meanwhile', async () => {
    const w = world()
    const { runId, folderHandle } = await w.ready()
    const proposal = await w.proposal(runId, folderHandle)
    const hold = gate()
    w.control.holdCreate = hold
    const first = w.submit(proposal)
    await hold.reached
    const duplicate = w.submit(proposal)
    expect(await w.query(proposal.operationId)).toEqual({ status: 'running', operationId: proposal.operationId })
    hold.release()
    const receipt = await first
    expect(await duplicate).toEqual(receipt)
    expect(w.control.creates).toBe(1)
  })

  it('joins an admitted write before close, end and turning off answer, and the write stays committed', async () => {
    for (const settle of ['close', 'end', 'off'] as const) {
      const w = world()
      const { runId, folderHandle, sessionId, invocationId } = await w.ready()
      const proposal = await w.proposal(runId, folderHandle)
      const hold = gate()
      w.control.holdCreate = hold
      const write = w.submit(proposal)
      await hold.reached
      let answered = false
      const barrier = (settle === 'close'
        ? w.call(C.closeSession, { sessionId })
        : settle === 'end'
          ? w.call(C.endRun, { sessionId, invocationId })
          : w.call(C.deactivate, { vaultPath: VAULT, packageId: 'local.quick-note', expectedActiveSha256: await sha256Hex(QUICK) })
      ).then(reply => {
        answered = true
        return reply
      })
      expect(await w.call(C.closeSession, { sessionId }, 'other')).toEqual({ status: 'unknown' })
      await flush()
      expect(answered, settle).toBe(false)
      hold.release()
      const receipt = await write
      expect(receipt.status, settle).toBe('committed')
      expect((await barrier).status, settle).toMatch(/closed|ended|inactive/)
      expect(await w.query(proposal.operationId)).toEqual(receipt)
      expect(await w.submit(proposal)).toEqual(receipt)
    }
  })

  it('applies overlapping changes in order: a delayed revocation never reaches a newer version’s run', async () => {
    const shared = testHost()
    const w = world(shared)
    const [a, b, c] = [quickNote('1.0.0'), quickNote('2.0.0'), quickNote('3.0.0')]
    const [shaA, shaB, shaC] = [await sha256Hex(a), await sha256Hex(b), await sha256Hex(c)]
    for (const text of [a, b, c]) await w.importText(text)
    await w.activate(a)
    const session = await w.session()
    const aRun = await w.run(a, 'main', session)
    const write = await w.proposal(aRun.runId, await w.handle(aRun.runId))
    const hold = gate()
    w.control.holdCreate = hold
    const written = w.submit(write)
    await hold.reached
    const toB = w.activate(b, shaA)
    await flush()
    const bRun = await w.run(b, 'main', session)
    let toCAnswered = false
    const toC = w.activate(c, shaB).then(reply => {
      toCAnswered = true
      return reply
    })
    await flush()
    expect(toCAnswered).toBe(false)
    expect(await w.begin(session, c)).toEqual({ status: 'refused', reason: 'notActive' })
    hold.release()
    expect((await written).status).toBe('committed')
    expect(await toB).toEqual({ status: 'active', packageSha256: shaB, previousSha256: shaA, revokedRuns: 1 })
    expect(await toC).toEqual({ status: 'active', packageSha256: shaC, previousSha256: shaB, revokedRuns: 1 })
    expect(await w.folder(bRun.runId)).toEqual({ status: 'refused', reason: 'staleRun' })
    const cRun = await w.run(c, 'main', session)
    expect(await w.folder(cRun.runId)).toMatchObject({ status: 'bound' })
    expect(await world(shared).entry('local.quick-note')).toMatchObject({ activeSha256: shaC, previousSha256: shaB })
  })

  it('never writes over an existing page, and a fresh run may retry under another name', async () => {
    const w = world()
    const { runId, folderHandle } = await w.ready()
    const taken = await w.proposal(runId, folderHandle, 'Existing.md')
    expect(await w.submit(taken)).toEqual({ status: 'conflict', operationId: taken.operationId, reason: 'exists' })
    expect(w.control.pages.get(`${VAULT}/Meetings/Existing.md`)).toBe('old')
    expect(await w.submit(await w.proposal(runId, folderHandle, 'Renamed.md'))).toMatchObject({ reason: 'operationMismatch' })
    const retry = await w.ready()
    expect(await w.submit(await w.proposal(retry.runId, retry.folderHandle, 'Renamed.md'))).toMatchObject({ status: 'committed' })
  })

  it('refuses bad names, sizes and digests before writing', async () => {
    const w = world()
    const names = ['../Escape.md', 'Sub/Page.md', '.hidden.md', 'Page.txt', 'con.md', 'Trailing .md', ' Lead.md', '.md', `${'x'.repeat(260)}.md`, 'Bell\u0007.md', 'Star*.md', 'Dot..md']
    for (const name of names) {
      const { runId, folderHandle } = await w.ready()
      const proposal = await w.proposal(runId, folderHandle, name)
      expect(await w.submit(proposal), name).toEqual({ status: 'refused', operationId: proposal.operationId, reason: 'invalidName' })
    }
    const large = await w.ready()
    const tooLarge = await w.proposal(large.runId, large.folderHandle, 'Large.md', 'x'.repeat(1024 * 1024 + 1))
    expect(await w.submit(tooLarge)).toMatchObject({ reason: 'tooLarge' })
    for (const digest of ['0'.repeat(64), 'not a digest']) {
      const run = await w.ready()
      const proposal = { ...await w.proposal(run.runId, run.folderHandle, 'Digest.md'), contentSha256: digest }
      expect(await w.submit(proposal)).toMatchObject({ reason: 'digestMismatch' })
    }
    expect(w.control.creates).toBe(0)
  })

  it('binds only visible folders inside the vault, refuses appending and foreign or stale runs', async () => {
    const w = world()
    const { runId, folderHandle } = await w.ready()
    const refused = (reason: string) => ({ status: 'refused', reason })
    for (const folder of ['../outside', '/abs', '.leadinglight', 'Meetings/../..', './Meetings']) expect(await w.folder(runId, folder), folder).toEqual(refused('outsideVault'))
    expect(await w.folder(runId, 'Missing')).toEqual(refused('missing'))
    expect(await w.folder(runId, 'page.md')).toEqual(refused('notFolder'))
    expect(await w.folder(runId, 'Meetings/')).toMatchObject({ status: 'bound', displayPath: 'Meetings' })
    expect(await w.folder(runId, '')).toMatchObject({ status: 'bound', displayPath: '' })
    expect(await w.folder(runId, 'Meetings', 'other')).toEqual(refused('staleRun'))
    expect(await w.call(C.bindDocument, { runId, path: 'Meetings/Existing.md' })).toEqual(refused('unsupported'))
    const append = { kind: 'append', operationId: crypto.randomUUID(), runId, content: TEXT, contentSha256: await sha256Hex(TEXT), documentHandle: 'doc-1', expectedSha256: 'a'.repeat(64) }
    expect(await w.submit(append)).toEqual({ status: 'refused', operationId: append.operationId, reason: 'unsupported' })
    const notUuid = await w.proposal(runId, folderHandle, 'Debrief.md', TEXT, 'ABC')
    expect(await w.submit(notUuid)).toEqual({ status: 'refused', operationId: 'ABC', reason: 'operationMismatch' })
    const foreign = await w.proposal(runId, folderHandle)
    expect(await w.submit(foreign, 'other')).toEqual({ status: 'refused', operationId: foreign.operationId, reason: 'staleRun' })
    const wrongHandle = await w.proposal(runId, 'folder-unknown')
    expect(await w.submit(wrongHandle)).toEqual({ status: 'refused', operationId: wrongHandle.operationId, reason: 'handleMismatch' })
    expect(w.control.creates).toBe(0)
  })

  it('keeps an unprovable publication uncertain: queried, never written again', async () => {
    for (const forced of [{ status: 'uncertain' } as const, 'throw' as const]) {
      const w = world()
      const { runId, folderHandle } = await w.ready()
      w.control.createResult = forced
      const proposal = await w.proposal(runId, folderHandle)
      const uncertain = { status: 'uncertain', operationId: proposal.operationId }
      expect(await w.submit(proposal)).toEqual(uncertain)
      expect(await w.query(proposal.operationId)).toEqual(uncertain)
      expect(await w.submit(proposal)).toEqual(uncertain)
      expect(w.control.creates).toBe(1)
    }
  })

  it('reports the other host refusals as known-no-write', async () => {
    for (const [status, reason] of [['unavailable', 'storageUnavailable'], ['moved', 'handleMismatch'], ['busy', 'busy']] as const) {
      const w = world()
      const { runId, folderHandle } = await w.ready()
      w.control.createResult = { status }
      const proposal = await w.proposal(runId, folderHandle)
      expect(await w.submit(proposal)).toEqual({ status: 'refused', operationId: proposal.operationId, reason })
    }
  })

  it('forgets every session and operation on restart but keeps activation', async () => {
    const shared = testHost()
    const w = world(shared)
    const { runId, folderHandle, sessionId } = await w.ready()
    const proposal = await w.proposal(runId, folderHandle)
    await w.submit(proposal)
    const restarted = world(shared)
    expect(await restarted.query(proposal.operationId)).toEqual({ status: 'unknown', operationId: proposal.operationId })
    expect(await restarted.call(C.closeSession, { sessionId })).toEqual({ status: 'unknown' })
    expect(await restarted.call(C.endRun, { sessionId, invocationId: 'k' })).toEqual({ status: 'unknownSession' })
    expect((await restarted.entry('local.quick-note'))?.activeSha256).toBe(await sha256Hex(QUICK))
    expect(await restarted.submit(proposal)).toEqual({ status: 'refused', operationId: proposal.operationId, reason: 'staleRun' })
  })
})

describe('arguments and the in-memory host', () => {
  it('rejects malformed arguments as native does, so the caller sees no reply', async () => {
    const w = world()
    const { runId, folderHandle } = await w.ready()
    const proposal = await w.proposal(runId, folderHandle)
    const rejected = [
      w.call(C.importCandidate, {}),
      w.call(C.list, { vaultPath: 3 }),
      w.call(C.importCandidate, { packageText: 'a\ud800b' }),
      w.call(C.submit, { proposal: { ...proposal, extra: 1 } }),
      w.call(C.submit, { proposal: { ...proposal, fileName: null } }),
      w.call(C.bindDocument, { runId }),
      w.call('run_any_command', {}),
      w.call(C.list, null),
    ]
    for (const reply of rejected) await expect(reply).rejects.toBeInstanceOf(ExtensionArgumentError)
  })

  it('creates mock-vault pages exclusively and answers a throwing write as not written', async () => {
    const pages = new Map([['/m/Notes/One.md', '1']])
    let fail = false
    const host = memoryHost({
      roots: ['/m'],
      pagePaths: () => pages.keys(),
      createPage: (path, content) => {
        if (fail) throw new Error('mock failure')
        if (pages.has(path)) return false
        pages.set(path, content)
        return true
      },
    }, [BUNDLED])
    const roots = { requested: '/m', canonical: '/m' }
    const lookup = await host.resolveFolder('/m', 'Notes')
    if (!lookup.ok) throw new Error('Notes should resolve')
    expect(await host.createPage(roots, lookup.folder, 'One.md', 'x')).toEqual({ status: 'exists' })
    expect(await host.createPage(roots, lookup.folder, 'Two.md', 'x')).toEqual({ status: 'created', durable: true })
    fail = true
    expect(await host.createPage(roots, lookup.folder, 'Three.md', 'x')).toEqual({ status: 'unavailable' })
    expect(await host.vaultRoots('/other')).toBeNull()
    expect(host.pagePath(roots, lookup.folder, 'Two.md')).toBe('/m/Notes/Two.md')
  })
})
