import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { sha256Hex } from '../saveOutcome'
import type { CreateProposal, GuardedProposal, ProposalQueryReply, ProposalReceipt } from '../proposals/proposalContract'
import type { BeginRunArgs, FolderHandleReply, RunAdmission } from './extensionApi'
import {
  createExtensionController, runnableCommands,
  type CreatedPage, type ExtensionController, type OpenTarget, type RunOpening,
} from './extensionSessionController'
import { createExtensionTransport, type ExtensionTransport } from './extensionTransport'

// The encoder snapshot needs a parser-lane module this worktree lacks; these tests are about
// ordering and outcomes, so a stand-in that keeps text as written is enough here.
vi.mock('./extensionMarkdownText', () => {
  class LiteralMarkdownTextError extends Error {
    readonly reason: string
    constructor(reason: string) { super(reason); this.reason = reason }
  }
  const lines = (text: string) => {
    const all = text.split('\n').map(line => line.trim())
    const first = all.findIndex(Boolean)
    if (first === -1) return []
    let last = all.length - 1
    while (!all[last]) last -= 1
    return all.slice(first, last + 1)
  }
  return {
    LiteralMarkdownTextError,
    encodeLiteralMarkdownLines: lines,
    encodeLiteralMarkdownInline: (text: string) => {
      if (text.includes('\n')) throw new LiteralMarkdownTextError('lineBreak')
      return text.trim()
    },
  }
})

const VAULT_A = '/vaults/a'
const VAULT_B = '/vaults/b'
const fixture = (name: string) => readFileSync(`${process.cwd()}/src/leadinglight/extensions/fixtures/${name}`, 'utf8')
const MEETING = fixture('meeting-debrief.json')
const QUICK = fixture('quick-note.json')
const COMMENTARY = fixture('passage-commentary.json')
const ANSWERS = { meeting: 'Weekly sync', decisions: 'Ship it' }
const MEETING_KEY = 'local.meeting-debrief/new-debrief'

interface Stored { id: string; name: string; text: string; sha: string; version: string; active: boolean; readable?: boolean }
let shas: Record<string, string>

beforeAll(async () => {
  shas = { meeting: await sha256Hex(MEETING), quick: await sha256Hex(QUICK), commentary: await sha256Hex(COMMENTARY) }
})

function stored(text: string, sha: string, active: boolean): Stored {
  const parsed = JSON.parse(text) as { id: string; name: string; version: string }
  return { id: parsed.id, name: parsed.name, version: parsed.version, text, sha, active }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function committedFor(proposal: CreateProposal, folders: Map<string, string>, vault = VAULT_A): ProposalReceipt {
  const folder = folders.get(proposal.folderHandle) ?? ''
  return {
    status: 'committed', kind: 'create', operationId: proposal.operationId, path: [vault, folder, proposal.fileName].filter(Boolean).join('/'),
    beforeSha256: null, afterSha256: proposal.contentSha256, durable: true, undoReceipt: null,
  }
}

function fakeApi(packages: Stored[]) {
  let sessions = 0
  let handles = 0
  const folders = new Map<string, string>()
  const api = {
    importCandidate: vi.fn(async ({ packageText }: { packageText: string }) => {
      const parsed = JSON.parse(packageText) as { id: string; version: string }
      return { status: 'candidate' as const, packageSha256: await sha256Hex(packageText), packageId: parsed.id, version: parsed.version, missingCapabilities: [] }
    }),
    list: vi.fn(async () => ({
      status: 'ok' as const,
      extensions: packages.map(item => ({
        packageId: item.id, name: item.name, versions: [{ packageSha256: item.sha, version: item.version, readable: item.readable ?? true }],
        activeSha256: item.active ? item.sha : null, previousSha256: null,
      })),
    })),
    read: vi.fn(async ({ packageSha256 }: { packageSha256: string }) => {
      const item = packages.find(entry => entry.sha === packageSha256)
      return item ? { status: 'ok' as const, packageText: item.text } : { status: 'unknown' as const }
    }),
    activate: vi.fn(async (args: { packageId: string; packageSha256: string }) => {
      for (const item of packages) if (item.id === args.packageId) item.active = item.sha === args.packageSha256
      return { status: 'active' as const, packageSha256: args.packageSha256, previousSha256: null, revokedRuns: 0 }
    }),
    deactivate: vi.fn(async (args: { packageId: string }) => {
      for (const item of packages) if (item.id === args.packageId) item.active = false
      return { status: 'inactive' as const, revokedRuns: 0 }
    }),
    openSession: vi.fn<(args: { vaultPath: string }) => Promise<{ status: 'open'; sessionId: string }>>(async () => ({ status: 'open', sessionId: `session-${++sessions}` })),
    closeSession: vi.fn<(args: { sessionId: string }) => Promise<{ status: 'closed' } | null>>(async () => ({ status: 'closed' })),
    beginRun: vi.fn(async (args: BeginRunArgs): Promise<RunAdmission | null> => ({
      status: 'admitted', scope: { runId: `run-${args.invocationId}`, packageId: 'local.pkg', ...args },
    })),
    endRun: vi.fn<(args: { sessionId: string; invocationId: string }) => Promise<{ status: 'ended' }>>(async () => ({ status: 'ended' })),
    bindFolder: vi.fn(async ({ folder }: { runId: string; folder: string }): Promise<FolderHandleReply | null> => {
      const folderHandle = `folder-${++handles}`
      folders.set(folderHandle, folder)
      return { status: 'bound', folderHandle, displayPath: folder }
    }),
    bindDocument: vi.fn(async () => ({ status: 'refused' as const, reason: 'unsupported' as const })),
    submitProposal: vi.fn(async (proposal: GuardedProposal): Promise<ProposalReceipt | null> => committedFor(proposal as CreateProposal, folders)),
    queryProposal: vi.fn<(args: { operationId: string }) => Promise<ProposalQueryReply | null>>(async () => null),
    forget: vi.fn(),
  }
  return { api, folders, transport: api as unknown as ExtensionTransport }
}

function host() {
  const committed: CreatedPage[] = []
  const written: string[] = []
  const open = vi.fn(async (_page: CreatedPage, stillCurrent: () => boolean) => stillCurrent())
  const target: OpenTarget = { beforeWrite: path => { written.push(path) }, committed: page => { committed.push(page) }, open }
  return { target, committed, written, open }
}

async function ready(packages: Stored[], vault = VAULT_A, options: { closeTimeoutMs?: number } = {}) {
  const fake = fakeApi(packages)
  const controller = createExtensionController({ api: fake.transport, closeTimeoutMs: options.closeTimeoutMs })
  controller.enter(vault)
  await controller.refresh()
  return { ...fake, controller }
}

function opening(controller: ExtensionController, key = MEETING_KEY): RunOpening {
  const value = controller.openRun(key)
  if (!value) throw new Error(`not runnable: ${key}`)
  return value
}

describe('registry as the vault sees it', () => {
  it('lists packages, loads only verified bytes and offers only fully supported commands', async () => {
    const { controller, api } = await ready([stored(MEETING, shas.meeting, true), stored(COMMENTARY, shas.commentary, true), stored(QUICK, shas.quick, false)])
    const snapshot = controller.snapshot()
    expect(snapshot.status).toBe('ready')
    expect(runnableCommands(snapshot).map(item => item.key)).toEqual([MEETING_KEY])
    if (snapshot.status !== 'ready') return
    const commentary = snapshot.packages.find(item => item.packageId === 'local.passage-commentary')!
    expect(commentary.active).toMatchObject({ status: 'ready', review: { activation: 'blocked' } })
    expect(snapshot.packages.find(item => item.packageId === 'local.quick-note')?.candidate?.load).toMatchObject({ status: 'ready' })
    expect(api.openSession).not.toHaveBeenCalled()
  })

  it('treats bytes whose hash, id or version differ from the listing as unreadable', async () => {
    const forged = stored(MEETING.replace('Meeting debrief', 'Meeting debrief!'), shas.meeting, true)
    const { controller } = await ready([forged])
    const snapshot = controller.snapshot()
    expect(snapshot.status === 'ready' && snapshot.packages[0].active).toEqual({ status: 'unreadable' })
    expect(runnableCommands(snapshot)).toEqual([])
  })

  it('reports an unanswered listing as a failure, never as an empty registry', async () => {
    const { controller, api } = await ready([])
    api.list.mockResolvedValueOnce(null as never)
    expect(await controller.refresh()).toEqual({ status: 'failed', vaultPath: VAULT_A, reason: 'noReply' })
  })
})

describe('importing a candidate', () => {
  it('rejects invalid text locally without storing anything', async () => {
    const { controller, api } = await ready([])
    const outcome = await controller.importText(fixture('invalid/folder-path.json'))
    expect(outcome).toMatchObject({ status: 'invalid', diagnostics: [{ code: 'unknownField', path: '/commands/0/steps/1/folder' }] })
    expect(api.importCandidate).not.toHaveBeenCalled()
  })

  it('refuses the reserved id prefix before native sees it', async () => {
    const { controller, api } = await ready([])
    expect(await controller.importText(MEETING.replace('"local.meeting-debrief"', '"leadinglight.fake"'))).toEqual({ status: 'refused', reason: 'reservedId' })
    expect(api.importCandidate).not.toHaveBeenCalled()
  })

  it('accepts a candidate only for the exact bytes it sent, and never activates', async () => {
    const { controller, api } = await ready([])
    expect(await controller.importText(QUICK)).toMatchObject({ status: 'candidate', packageSha256: shas.quick })
    api.importCandidate.mockResolvedValueOnce({ status: 'candidate', packageSha256: 'f'.repeat(64), packageId: 'local.quick-note', version: '1.0.0', missingCapabilities: [] })
    expect(await controller.importText(QUICK)).toEqual({ status: 'noReply' })
    expect(api.activate).not.toHaveBeenCalled()
  })
})

describe('sessions follow vault visits, never paths', () => {
  it('opens no session for listing or previews, then one per visit on the first run', async () => {
    const { controller, api } = await ready([stored(MEETING, shas.meeting, true)])
    const { target } = host()
    await controller.create(opening(controller), { answers: ANSWERS, folder: '', target })
    await controller.create(opening(controller), { answers: { ...ANSWERS, meeting: 'Second' }, folder: '', target })
    expect(api.openSession).toHaveBeenCalledTimes(1)
  })

  it('gives A, then B, then A again three distinct sessions and closes each one left', async () => {
    const { controller, api } = await ready([stored(MEETING, shas.meeting, true)])
    const { target } = host()
    const visit = async (vault: string) => {
      controller.enter(vault)
      await controller.refresh()
      await controller.create(opening(controller), { answers: ANSWERS, folder: '', target })
    }
    await visit(VAULT_A)
    await visit(VAULT_B)
    await visit(VAULT_A)
    expect(api.openSession.mock.calls.map(([args]) => args.vaultPath)).toEqual([VAULT_A, VAULT_B, VAULT_A])
    expect(api.closeSession.mock.calls.map(([args]) => args.sessionId)).toEqual(['session-1', 'session-2'])
  })
})

describe('one Create, one run', () => {
  it('admits, binds the chosen folder, submits the exact page once, lists it and opens it', async () => {
    const { controller, api } = await ready([stored(MEETING, shas.meeting, true)])
    const { target, committed, written, open } = host()
    const outcome = await controller.create(opening(controller), { answers: ANSWERS, folder: 'Meetings', target })
    expect(outcome).toMatchObject({ status: 'opened', page: { path: `${VAULT_A}/Meetings/debrief-weekly-sync.md`, displayPath: 'Meetings/debrief-weekly-sync.md' } })
    const proposal = api.submitProposal.mock.calls[0][0] as CreateProposal
    expect(proposal).toMatchObject({ kind: 'create', fileName: 'debrief-weekly-sync.md', content: expect.stringMatching(/^# Debrief: Weekly sync\n/) })
    expect(proposal.contentSha256).toBe(await sha256Hex(proposal.content))
    expect(api.bindFolder).toHaveBeenCalledWith({ runId: proposal.runId, folder: 'Meetings' })
    expect(written).toEqual([`${VAULT_A}/Meetings/debrief-weekly-sync.md`])
    expect(committed.map(page => page.path)).toEqual(written)
    expect(open).toHaveBeenCalledTimes(1)
    const begin = api.beginRun.mock.calls[0][0]
    expect(api.endRun).toHaveBeenCalledWith({ sessionId: begin.sessionId, invocationId: begin.invocationId })
  })

  it('keeps answers on a required-field problem without asking native anything', async () => {
    const { controller, api } = await ready([stored(MEETING, shas.meeting, true)])
    const outcome = await controller.create(opening(controller), { answers: { meeting: 'Sync' }, folder: '', target: host().target })
    expect(outcome).toEqual({ status: 'invalid', problems: [{ code: 'required', field: 'decisions' }] })
    expect(api.openSession).not.toHaveBeenCalled()
  })

  it('lists but does not open a note when the recipe has no open step', async () => {
    const { controller } = await ready([stored(QUICK, shas.quick, true)])
    const { target, committed, open } = host()
    const outcome = await controller.create(opening(controller, 'local.quick-note/quick'), { answers: { topic: 'Ideas' }, folder: '', target })
    expect(outcome).toMatchObject({ status: 'created', opened: 'notRequested', page: { displayPath: 'ideas.md' } })
    expect(committed).toHaveLength(1)
    expect(open).not.toHaveBeenCalled()
  })

  it('after a name collision, an explicit Create is a fresh run with a fresh operation and handle', async () => {
    const { controller, api, folders } = await ready([stored(MEETING, shas.meeting, true)])
    api.submitProposal.mockImplementationOnce(async proposal => ({ status: 'conflict', operationId: proposal.operationId, reason: 'exists' }))
    const run = opening(controller)
    expect(await controller.create(run, { answers: ANSWERS, folder: '', target: host().target })).toEqual({ status: 'notWritten', reason: 'exists' })
    api.submitProposal.mockImplementationOnce(async proposal => committedFor(proposal as CreateProposal, folders))
    expect(await controller.create(run, { answers: { ...ANSWERS, meeting: 'Weekly sync 2' }, folder: '', target: host().target })).toMatchObject({ status: 'opened' })
    const [first, second] = api.submitProposal.mock.calls.map(([proposal]) => proposal as CreateProposal)
    expect(second.operationId).not.toBe(first.operationId)
    expect(second.runId).not.toBe(first.runId)
    expect(second.folderHandle).not.toBe(first.folderHandle)
    expect(api.beginRun.mock.calls[1][0].invocationId).not.toBe(api.beginRun.mock.calls[0][0].invocationId)
  })

  it('reports a known storage refusal as nothing written and lets Create try again', async () => {
    const { controller, api } = await ready([stored(MEETING, shas.meeting, true)])
    api.submitProposal.mockImplementationOnce(async proposal => ({ status: 'refused', operationId: proposal.operationId, reason: 'storageUnavailable' }))
    const run = opening(controller)
    expect(await controller.create(run, { answers: ANSWERS, folder: '', target: host().target })).toEqual({ status: 'notWritten', reason: 'storage' })
    expect(await controller.create(run, { answers: ANSWERS, folder: '', target: host().target })).toMatchObject({ status: 'opened' })
    expect(api.submitProposal).toHaveBeenCalledTimes(2)
  })

  it('submits nothing when the folder handle is refused or names another folder', async () => {
    const { controller, api } = await ready([stored(MEETING, shas.meeting, true)])
    api.bindFolder.mockResolvedValueOnce({ status: 'refused', reason: 'link' })
    expect(await controller.create(opening(controller), { answers: ANSWERS, folder: 'Linked', target: host().target })).toEqual({ status: 'notWritten', reason: 'link' })
    api.bindFolder.mockResolvedValueOnce({ status: 'bound', folderHandle: 'folder-x', displayPath: 'Elsewhere' })
    expect(await controller.create(opening(controller), { answers: ANSWERS, folder: 'Meetings', target: host().target })).toEqual({ status: 'notWritten', reason: 'internal' })
    expect(api.submitProposal).not.toHaveBeenCalled()
  })

  it('treats an unanswered admission as not started, with nothing submitted', async () => {
    const { controller, api } = await ready([stored(MEETING, shas.meeting, true)])
    api.beginRun.mockResolvedValueOnce(null)
    expect(await controller.create(opening(controller), { answers: ANSWERS, folder: '', target: host().target })).toEqual({ status: 'notWritten', reason: 'notStarted' })
    expect(api.bindFolder).not.toHaveBeenCalled()
    expect(api.submitProposal).not.toHaveBeenCalled()
  })

  it('does not open a page whose receipt names another path, but still reports it written', async () => {
    const { controller, api } = await ready([stored(MEETING, shas.meeting, true)])
    api.submitProposal.mockImplementationOnce(async proposal => ({ ...committedFor(proposal as CreateProposal, new Map()), path: `${VAULT_A}/Other/x.md` }))
    const { target, committed, open } = host()
    expect(await controller.create(opening(controller), { answers: ANSWERS, folder: 'Meetings', target }))
      .toMatchObject({ status: 'created', opened: 'notShown', page: { displayPath: 'Other/x.md' } })
    expect(committed).toEqual([])
    expect(open).not.toHaveBeenCalled()
  })
})

describe('a lost reply is queried with the same operation, never resubmitted', () => {
  it('stays uncertain through running and unknown, and opens once the query finds it', async () => {
    const { controller, api, folders } = await ready([stored(MEETING, shas.meeting, true)])
    api.submitProposal.mockResolvedValueOnce(null)
    const run = opening(controller)
    const { target, open } = host()
    const outcome = await controller.create(run, { answers: ANSWERS, folder: '', target })
    if (outcome.status !== 'uncertain') throw new Error(outcome.status)
    const proposal = api.submitProposal.mock.calls[0][0] as CreateProposal
    expect(outcome.attempt.operationId).toBe(proposal.operationId)
    api.queryProposal.mockResolvedValueOnce({ status: 'running', operationId: proposal.operationId })
    expect(await controller.recheck(run)).toMatchObject({ status: 'uncertain', detail: 'running' })
    api.queryProposal.mockResolvedValueOnce({ status: 'unknown', operationId: proposal.operationId })
    expect(await controller.recheck(run)).toMatchObject({ status: 'uncertain', detail: 'unknown' })
    api.queryProposal.mockResolvedValueOnce(committedFor(proposal, folders))
    expect(await controller.recheck(run)).toMatchObject({ status: 'opened' })
    expect(api.queryProposal.mock.calls.map(([args]) => args.operationId)).toEqual([proposal.operationId, proposal.operationId, proposal.operationId])
    expect(api.submitProposal).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledTimes(1)
    expect(api.forget).toHaveBeenCalledWith(proposal.operationId)
  })

  it('lets Create start again only after the query proves nothing was written', async () => {
    const { controller, api } = await ready([stored(MEETING, shas.meeting, true)])
    api.submitProposal.mockResolvedValueOnce(null)
    const run = opening(controller)
    const outcome = await controller.create(run, { answers: ANSWERS, folder: '', target: host().target })
    if (outcome.status !== 'uncertain') throw new Error(outcome.status)
    api.queryProposal.mockResolvedValueOnce({ status: 'conflict', operationId: outcome.attempt.operationId, reason: 'exists' })
    expect(await controller.recheck(run)).toEqual({ status: 'notWritten', reason: 'exists' })
  })
})

/** The same fake behind the real transport, so replies pass through its strict readers. */
function viaTransport(api: ReturnType<typeof fakeApi>['api']): ExtensionTransport {
  const routes: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    list_extensions: () => api.list(),
    read_extension_package: args => api.read(args as never),
    open_extension_session: args => api.openSession(args as never),
    close_extension_session: args => api.closeSession(args as never),
    begin_extension_run: args => api.beginRun(args as never),
    end_extension_run: args => api.endRun(args as never),
    bind_extension_folder: args => api.bindFolder(args as never),
    submit_document_proposal: args => api.submitProposal(args.proposal as never),
    query_document_proposal: args => api.queryProposal(args as never),
  }
  return createExtensionTransport(async (command, args) => routes[command](args))
}

describe('recovery keeps the recipe’s own open intent', () => {
  it('reports a save-only recipe created and unopened, whether its reply arrives or is recovered', async () => {
    const { controller, api, folders } = await ready([stored(QUICK, shas.quick, true)])
    const immediate = host()
    expect(await controller.create(opening(controller, 'local.quick-note/quick'), { answers: { topic: 'First' }, folder: '', target: immediate.target }))
      .toMatchObject({ status: 'created', opened: 'notRequested' })
    api.submitProposal.mockResolvedValueOnce(null)
    const run = opening(controller, 'local.quick-note/quick')
    const recovered = host()
    expect(await controller.create(run, { answers: { topic: 'Second' }, folder: '', target: recovered.target })).toMatchObject({ status: 'uncertain' })
    api.queryProposal.mockResolvedValueOnce(committedFor(api.submitProposal.mock.calls[1][0] as CreateProposal, folders))
    expect(await controller.recheck(run)).toMatchObject({ status: 'created', opened: 'notRequested', page: { displayPath: 'second.md' } })
    expect(immediate.open).not.toHaveBeenCalled()
    expect(recovered.open).not.toHaveBeenCalled()
    expect(recovered.committed.map(page => page.displayPath)).toEqual(['second.md'])
  })

  it('opens a recovered page once in its request-time target, and not after its visit moved on', async () => {
    const { controller, api, folders } = await ready([stored(MEETING, shas.meeting, true)])
    api.submitProposal.mockResolvedValueOnce(null)
    const current = opening(controller)
    const first = host()
    await controller.create(current, { answers: ANSWERS, folder: '', target: first.target })
    api.queryProposal.mockResolvedValueOnce(committedFor(api.submitProposal.mock.calls[0][0] as CreateProposal, folders))
    expect(await controller.recheck(current)).toMatchObject({ status: 'opened' })
    expect(first.open).toHaveBeenCalledTimes(1)

    api.submitProposal.mockResolvedValueOnce(null)
    const moved = opening(controller)
    const second = host()
    await controller.create(moved, { answers: { ...ANSWERS, meeting: 'Moved' }, folder: '', target: second.target })
    void controller.leave()
    api.queryProposal.mockResolvedValueOnce(committedFor(api.submitProposal.mock.calls[1][0] as CreateProposal, folders))
    expect(await controller.recheck(moved)).toMatchObject({ status: 'created', opened: 'notShown' })
    expect(second.open).not.toHaveBeenCalled()
  })
})

describe('an opening owns its unresolved and final writes', () => {
  const counts = (api: ReturnType<typeof fakeApi>['api']) =>
    [api.beginRun.mock.calls.length, api.bindFolder.mock.calls.length, api.submitProposal.mock.calls.length]

  it('allocates no other run or operation while its write stays uncertain, whatever the query answers', async () => {
    const fake = fakeApi([stored(MEETING, shas.meeting, true)])
    const controller = createExtensionController({ api: viaTransport(fake.api) })
    controller.enter(VAULT_A)
    await controller.refresh()
    const { api } = fake
    api.submitProposal.mockResolvedValueOnce(null)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const run = opening(controller)
    const first = await controller.create(run, { answers: ANSWERS, folder: '', target: host().target })
    if (first.status !== 'uncertain') throw new Error(first.status)
    const operationId = first.attempt.operationId
    const answers: (() => Promise<ProposalQueryReply | null>)[] = [
      async () => ({ status: 'running', operationId }),
      async () => ({ status: 'unknown', operationId }),
      async () => ({ status: 'uncertain', operationId }),
      async () => ({ status: 'committed', operationId }) as never,
      async () => { throw new Error('ipc closed') },
      async () => null,
    ]
    for (const answer of answers) {
      api.queryProposal.mockImplementationOnce(answer)
      expect(await controller.recheck(run)).toMatchObject({ status: 'uncertain', attempt: { operationId } })
      // A Create with other answers and another folder still answers the same operation.
      expect(await controller.create(run, { answers: { ...ANSWERS, meeting: 'Different' }, folder: 'Other', target: host().target }))
        .toMatchObject({ status: 'uncertain', attempt: { operationId } })
    }
    expect(counts(api)).toEqual([1, 1, 1])
    expect(api.queryProposal.mock.calls.every(([args]) => args.operationId === operationId)).toBe(true)
    warn.mockRestore()
  })

  it('answers busy to a duplicate Create or Check again while its submission is unanswered', async () => {
    const { controller, api } = await ready([stored(MEETING, shas.meeting, true)])
    const reply = deferred<ProposalReceipt | null>()
    api.submitProposal.mockImplementationOnce(() => reply.promise)
    const run = opening(controller)
    const pending = controller.create(run, { answers: ANSWERS, folder: '', target: host().target })
    await vi.waitFor(() => expect(api.submitProposal).toHaveBeenCalled())
    expect(await controller.create(run, { answers: ANSWERS, folder: '', target: host().target })).toEqual({ status: 'busy' })
    expect(await controller.recheck(run)).toEqual({ status: 'busy' })
    reply.resolve(null)
    expect(await pending).toMatchObject({ status: 'uncertain' })
    expect(await controller.create(run, { answers: ANSWERS, folder: '', target: host().target })).toMatchObject({ status: 'uncertain' })
    expect(counts(api)).toEqual([1, 1, 1])
    expect(api.queryProposal).not.toHaveBeenCalled()
  })

  it('answers busy to Create while Check again is still asking', async () => {
    const { controller, api } = await ready([stored(MEETING, shas.meeting, true)])
    api.submitProposal.mockResolvedValueOnce(null)
    const run = opening(controller)
    await controller.create(run, { answers: ANSWERS, folder: '', target: host().target })
    const query = deferred<ProposalQueryReply | null>()
    api.queryProposal.mockImplementationOnce(() => query.promise)
    const checking = controller.recheck(run)
    expect(await controller.create(run, { answers: ANSWERS, folder: '', target: host().target })).toEqual({ status: 'busy' })
    query.resolve({ status: 'refused', operationId: (api.submitProposal.mock.calls[0][0] as CreateProposal).operationId, reason: 'storageUnavailable' })
    expect(await checking).toEqual({ status: 'notWritten', reason: 'storage' })
    expect(counts(api)).toEqual([1, 1, 1])
  })

  it('lets one explicit fresh attempt follow a definite no-write answer, with fresh ids', async () => {
    const { controller, api } = await ready([stored(MEETING, shas.meeting, true)])
    api.submitProposal.mockResolvedValueOnce(null)
    const run = opening(controller)
    const first = await controller.create(run, { answers: ANSWERS, folder: '', target: host().target })
    if (first.status !== 'uncertain') throw new Error(first.status)
    api.queryProposal.mockResolvedValueOnce({ status: 'refused', operationId: first.attempt.operationId, reason: 'storageUnavailable' })
    expect(await controller.recheck(run)).toEqual({ status: 'notWritten', reason: 'storage' })
    expect(await controller.create(run, { answers: ANSWERS, folder: '', target: host().target })).toMatchObject({ status: 'opened' })
    expect(counts(api)).toEqual([2, 2, 2])
    const [a, b] = api.submitProposal.mock.calls.map(([proposal]) => proposal as CreateProposal)
    expect([b.operationId === a.operationId, b.runId === a.runId, b.folderHandle === a.folderHandle]).toEqual([false, false, false])
    expect(await controller.recheck(run)).toMatchObject({ status: 'opened' })
  })

  it('treats a committed result, immediate or recovered, as final for the opening', async () => {
    const { controller, api, folders } = await ready([stored(MEETING, shas.meeting, true)])
    const immediate = opening(controller)
    const done = await controller.create(immediate, { answers: ANSWERS, folder: '', target: host().target })
    expect(done).toMatchObject({ status: 'opened' })
    expect(await controller.create(immediate, { answers: { ...ANSWERS, meeting: 'Again' }, folder: '', target: host().target })).toBe(done)
    expect(await controller.recheck(immediate)).toBe(done)

    api.submitProposal.mockResolvedValueOnce(null)
    const later = opening(controller)
    await controller.create(later, { answers: { ...ANSWERS, meeting: 'Later' }, folder: '', target: host().target })
    api.queryProposal.mockResolvedValueOnce(committedFor(api.submitProposal.mock.calls[1][0] as CreateProposal, folders))
    const recovered = await controller.recheck(later)
    expect(await controller.create(later, { answers: ANSWERS, folder: '', target: host().target })).toBe(recovered)
    expect(counts(api)).toEqual([2, 2, 2])
  })

  it('retires an opening that is abandoned or cancelled, so its write never becomes retryable', async () => {
    const { controller, api } = await ready([stored(MEETING, shas.meeting, true)])
    api.submitProposal.mockResolvedValueOnce(null)
    const run = opening(controller)
    const first = await controller.create(run, { answers: ANSWERS, folder: '', target: host().target })
    if (first.status !== 'uncertain') throw new Error(first.status)
    controller.abandon(run)
    expect(api.forget).toHaveBeenCalledWith(first.attempt.operationId)
    expect(await controller.create(run, { answers: ANSWERS, folder: '', target: host().target })).toEqual({ status: 'cancelled' })
    expect(await controller.recheck(run)).toEqual({ status: 'cancelled' })
    const closed = opening(controller)
    controller.cancel(closed)
    expect(await controller.create(closed, { answers: ANSWERS, folder: '', target: host().target })).toEqual({ status: 'cancelled' })
    expect(counts(api)).toEqual([1, 1, 1])
    expect(api.queryProposal).not.toHaveBeenCalled()
  })

  it('keeps an uncertain write recorded when its dialog is cancelled without abandoning', async () => {
    const { controller, api } = await ready([stored(MEETING, shas.meeting, true)])
    api.submitProposal.mockResolvedValueOnce(null)
    const run = opening(controller)
    await controller.create(run, { answers: ANSWERS, folder: '', target: host().target })
    controller.cancel(run)
    expect(await controller.create(run, { answers: ANSWERS, folder: '', target: host().target })).toMatchObject({ status: 'uncertain' })
    expect(counts(api)).toEqual([1, 1, 1])
  })
})

describe('cancellation, revocation and leaving', () => {
  it('ends a pending admission by its request key, and a late admission writes nothing', async () => {
    const { controller, api } = await ready([stored(MEETING, shas.meeting, true)])
    const admission = deferred<RunAdmission | null>()
    api.beginRun.mockImplementationOnce(() => admission.promise)
    const run = opening(controller)
    const pending = controller.create(run, { answers: ANSWERS, folder: '', target: host().target })
    await vi.waitFor(() => expect(api.beginRun).toHaveBeenCalled())
    const args = api.beginRun.mock.calls[0][0]
    controller.cancel(run)
    await vi.waitFor(() => expect(api.endRun).toHaveBeenCalledWith({ sessionId: args.sessionId, invocationId: args.invocationId }))
    admission.resolve({ status: 'admitted', scope: { runId: 'late-run', packageId: 'local.pkg', ...args } })
    expect(await pending).toEqual({ status: 'cancelled' })
    expect(api.bindFolder).not.toHaveBeenCalled()
    expect(api.submitProposal).not.toHaveBeenCalled()
  })

  it('revokes an open form when its extension is turned off or replaced', async () => {
    const { controller, api } = await ready([stored(MEETING, shas.meeting, true)])
    const run = opening(controller)
    await controller.deactivate('local.meeting-debrief', shas.meeting)
    expect(controller.revokedReason(run)).toBe('package')
    expect(await controller.create(run, { answers: ANSWERS, folder: '', target: host().target })).toEqual({ status: 'revoked', reason: 'package' })
    expect(api.openSession).not.toHaveBeenCalled()
  })

  it('keeps a write admitted before leaving, without opening it in the next vault', async () => {
    const { controller, api, folders } = await ready([stored(MEETING, shas.meeting, true)])
    const reply = deferred<ProposalReceipt | null>()
    api.submitProposal.mockImplementationOnce(() => reply.promise)
    const run = opening(controller)
    const { target, open } = host()
    const pending = controller.create(run, { answers: ANSWERS, folder: '', target })
    await vi.waitFor(() => expect(api.submitProposal).toHaveBeenCalled())
    const leaving = controller.leave()
    controller.enter(VAULT_B)
    reply.resolve(committedFor(api.submitProposal.mock.calls[0][0] as CreateProposal, folders))
    expect(await pending).toMatchObject({ status: 'created', opened: 'notShown' })
    expect(open).not.toHaveBeenCalled()
    expect(await leaving).toEqual({ status: 'confirmed' })
  })

  it('refuses a page placement that becomes stale while the opener is loading', async () => {
    const { controller } = await ready([stored(MEETING, shas.meeting, true)])
    const loading = deferred<void>()
    const started = deferred<void>()
    let placed = false
    const target: OpenTarget = {
      beforeWrite: () => {}, committed: () => {},
      async open(_page, stillCurrent) {
        if (!stillCurrent()) return false
        started.resolve()
        await loading.promise
        // The reservation checks again at placement, after its own await.
        placed = stillCurrent()
        return placed
      },
    }
    const pending = controller.create(opening(controller), { answers: ANSWERS, folder: '', target })
    await started.promise
    void controller.leave()
    loading.resolve()
    expect(await pending).toMatchObject({ status: 'created', opened: 'notShown' })
    expect(placed).toBe(false)
  })

  it('stays visibly blocked after an unconfirmed close, and only a confirmed retry resumes', async () => {
    const { controller, api } = await ready([stored(MEETING, shas.meeting, true)])
    await controller.create(opening(controller), { answers: ANSWERS, folder: '', target: host().target })
    api.closeSession.mockResolvedValueOnce(null)
    expect(await controller.leave()).toEqual({ status: 'unconfirmed' })
    expect(controller.snapshot()).toEqual({ status: 'unsettled', vaultPath: VAULT_A })
    // A refused transition releases its hold, but nothing resumes past an unconfirmed barrier.
    expect(controller.resume()).toBe(false)
    expect(controller.openRun(MEETING_KEY)).toBeNull()
    api.closeSession.mockResolvedValueOnce(null)
    expect(await controller.retryUnsettled()).toEqual({ status: 'unconfirmed' })
    expect(controller.snapshot().status).toBe('unsettled')
    expect(await controller.retryUnsettled()).toEqual({ status: 'confirmed' })
    await vi.waitFor(() => expect(controller.snapshot().status).toBe('ready'))
    expect(opening(controller).visit.vaultPath).toBe(VAULT_A)
    // Every ask was for the same session; the resumed visit has not opened one yet.
    expect(api.closeSession.mock.calls.map(([args]) => args.sessionId)).toEqual(['session-1', 'session-1', 'session-1'])
    expect(api.openSession).toHaveBeenCalledTimes(1)
  })

  it('asks again at the next leave for an earlier visit whose close went unanswered', async () => {
    const { controller, api } = await ready([stored(MEETING, shas.meeting, true)])
    await controller.create(opening(controller), { answers: ANSWERS, folder: '', target: host().target })
    api.closeSession.mockResolvedValueOnce(null)
    // The vault changed without a transition gate; A's close is sent but not confirmed.
    controller.enter(VAULT_B)
    await controller.refresh()
    await controller.create(opening(controller), { answers: ANSWERS, folder: '', target: host().target })
    expect(await controller.leave()).toEqual({ status: 'confirmed' })
    expect(api.closeSession.mock.calls.map(([args]) => args.sessionId).sort()).toEqual(['session-1', 'session-1', 'session-2'])
  })

  it('reports a close native never answers as unconfirmed instead of waiting forever', async () => {
    const { controller, api } = await ready([stored(MEETING, shas.meeting, true)], VAULT_A, { closeTimeoutMs: 20 })
    await controller.create(opening(controller), { answers: ANSWERS, folder: '', target: host().target })
    const run = opening(controller)
    api.closeSession.mockImplementationOnce(() => new Promise(() => {}))
    expect(await controller.leave()).toEqual({ status: 'unconfirmed' })
    // Admissions stay off while the boundary is unsettled.
    expect(controller.openRun(MEETING_KEY)).toBeNull()
    expect(await controller.create(run, { answers: ANSWERS, folder: '', target: host().target })).toEqual({ status: 'revoked', reason: 'workspace' })
    expect(api.beginRun).toHaveBeenCalledTimes(1)
  })

  it('stops admissions at once when leaving begins', async () => {
    const { controller, api } = await ready([stored(MEETING, shas.meeting, true)])
    const run = opening(controller)
    void controller.leave()
    expect(controller.revokedReason(run)).toBe('workspace')
    expect(controller.openRun(MEETING_KEY)).toBeNull()
    expect(await controller.create(run, { answers: ANSWERS, folder: '', target: host().target })).toEqual({ status: 'revoked', reason: 'workspace' })
    expect(api.beginRun).not.toHaveBeenCalled()
  })
})
