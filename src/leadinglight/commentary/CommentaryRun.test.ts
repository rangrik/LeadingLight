// The run after capture: destinations from discovery, Create beside the source, Add inside the
// commentary's own page lane from its saved bytes, and what each outcome shows. A real controller
// against the in-memory registry; fake domain services; a page lane that records what it was given.
import { describe, expect, it, vi } from 'vitest'
import type { MutateExistingDocument, RunPageExclusive } from '../../hooks/useAppSave'
import type { VaultEntry } from '../../types'
import { CAPABILITIES } from '../extensions/extensionContract'
import { createExtensionController } from '../extensions/extensionSessionController'
import { deferred, fakeRegistry, fixtureText, packageOf, VAULT } from '../extensions/extensions.test-utils'
import type { AppendProposal, ProposalReceipt } from '../proposals/proposalContract'
import { sha256Hex } from '../saveOutcome'
import type { BesideReservation } from '../useSplitWorkspace'
import type { CapturedPassage, CommentaryDiscovery, CommentaryPreparation } from './commentaryContract'
import type { CommentaryServices } from './CommentaryPorts'
import { createCommentaryRun, type CommentaryRunDeps } from './CommentaryRun'

vi.mock('../extensions/extensionMarkdownText', async () => (await import('../extensions/extensionEncoder.test-utils')).encoderStandIn())

const KEY = 'local.passage-commentary/comment'
const SOURCE = `${VAULT}/Topics/source.md`
const COMMENTARY = `${VAULT}/Topics/commentary-on-source.md`
const BASELINE = '---\n_leadinglight_commentary: {}\n---\n# Commentary on Source\n\n[Source](./source.md)\n\n> Earlier\n'
const ENTRY = '> The passage\n\nMy thought\n'
const CAPTURED: CapturedPassage = {
  id: 'capture-1', sourcePath: 'Topics/source.md', sourceTitle: 'Source',
  selector: { projection: 'leadinglight-text-v1', exact: 'The passage', prefix: '', suffix: '', sourceBodySha256: 'a'.repeat(64), start: 0, end: 11 },
}
const ANSWERS = { thought: 'My thought', question: '' }

const entry = (path: string): VaultEntry => ({ path, filename: path.split('/').pop()!, title: 'x', isA: null, aliases: [], belongsTo: [], relatedTo: [],
  status: null, archived: false, modifiedAt: 1, createdAt: 1, fileSize: 1, snippet: '', wordCount: 0, relationships: {}, icon: null, color: null,
  order: null, sidebarLabel: null, template: null, sort: null, view: null, visible: null, organized: false, favorite: false, favoriteIndex: null,
  listPropertiesDisplay: [], outgoingLinks: [], properties: {}, hasH1: true })

function services(linked: CommentaryDiscovery['linked'] = []): CommentaryServices {
  return {
    buildCapture: vi.fn(),
    mayBeCommentary: () => false,
    readNote: vi.fn(),
    discover: vi.fn(async () => ({ sourcePath: CAPTURED.sourcePath, complete: true, linked, skipped: 0 })),
    plan: (discovery, separate) => (separate || discovery.linked.length === 0 ? { kind: 'create', separate }
      : discovery.linked.length === 1 ? { kind: 'append', target: discovery.linked[0] } : { kind: 'choose', options: discovery.linked, blocked: [], incomplete: false }),
    name: (title, _folder, separate) => ({ title: separate ? `${title} 2` : title, fileName: separate ? 'commentary-on-source-2.md' : 'commentary-on-source.md' }),
    isTaken: () => false,
    prepareCreate: vi.fn(({ name, folder }): CommentaryPreparation => ({ status: 'ready', entry: ENTRY,
      write: { kind: 'create', path: `${folder}/${name.fileName}`, folder, fileName: name.fileName, title: name.title, content: `# ${name.title}\n\n${ENTRY}` } })),
    prepareAppend: vi.fn(({ baseline, baselineSha256, path }): CommentaryPreparation => ({ status: 'ready', entry: ENTRY,
      write: { kind: 'append', path, expectedSha256: baselineSha256, content: `${baseline}\n${ENTRY}` } })),
    canAppendAfter: () => true,
  }
}

/** A page lane: runs publish at once (its own flush is not modelled) and records the bytes it takes. */
function lane(settle: 'saved' | 'failed' = 'saved') {
  const taken: { path: string; content: string | null }[] = []
  const mutate: MutateExistingDocument = (path, mutation) => ({
    admitted: true, path,
    done: (async () => {
      if (settle === 'failed') return { kind: 'notRun', path, error: new Error('held'), current: true }
      const result = await mutation.publish(path)
      const content = mutation.committedContent(result)
      taken.push({ path, content })
      return { kind: 'returned', path, result, current: true, integration: 'none', latest: content }
    })(),
  })
  const runPageExclusive: RunPageExclusive = vi.fn(async (_path, work) => work(mutate))
  return { taken, runPageExclusive }
}

async function setup(options: { linked?: CommentaryDiscovery['linked']; disk?: Record<string, string>; tabs?: { path: string; content: string }[]; settle?: 'saved' | 'failed'; shown?: boolean } = {}) {
  const registry = fakeRegistry([await packageOf([fixtureText('passage-commentary.json')], 'newest')])
  const controller = createExtensionController({ api: registry.transport, hostCapabilities: CAPABILITIES })
  controller.enter(VAULT)
  await controller.refresh()
  const opening = controller.openCaptureRun(KEY, { passage: 'passage-1', quote: CAPTURED.selector.exact, sourceTitle: 'Source' })!
  const page = lane(options.settle)
  const beside: BesideReservation = { pane: 1, inSession: () => true, effect: () => ({ kind: 'beside' }), open: vi.fn(async () => options.shown ?? true) }
  const deps: CommentaryRunDeps = {
    controller, opening, services: services(options.linked), captured: CAPTURED, vaultPath: VAULT, beside,
    entries: () => [entry(SOURCE), entry(COMMENTARY)],
    tabs: () => (options.tabs ?? []).map(tab => ({ entry: entry(tab.path), content: tab.content })),
    read: async path => options.disk?.[path] ?? null,
    runPageExclusive: page.runPageExclusive,
    target: { beforeWrite: vi.fn(), committed: vi.fn(), open: vi.fn(async () => false) },
    narrow: () => false,
    labelOf: path => path,
    entryFor: created => entry(created.path),
    focus: vi.fn(),
    onCommitted: vi.fn(),
    serialize: (_key, work) => work(),
  }
  const run = createCommentaryRun(deps)
  await run.discover()
  return { registry, controller, run, deps, page, beside }
}

const LINKED = [{ path: 'Topics/commentary-on-source.md', title: 'Commentary on Source', modifiedAt: 2, appendable: true, record: 'ready' as const, captures: 1 }]
const phase = () => {}

describe('destinations', () => {
  it('proposes Create when no note is linked, and Add to the one linked note otherwise', async () => {
    const none = await setup()
    expect(none.run.destinations()).toEqual({ status: 'ready', options: [], incomplete: false, initial: { kind: 'create', separate: false } })
    expect(none.run.createName(ANSWERS, false)).toEqual({ title: 'Commentary on Source', taken: false })
    expect(none.run.createName(ANSWERS, true)?.title).toBe('Commentary on Source 2')
    const one = await setup({ linked: LINKED })
    expect(one.run.destinations()).toMatchObject({ status: 'ready', initial: { kind: 'append', path: COMMENTARY }, options: [{ path: COMMENTARY, title: 'Commentary on Source' }] })
  })

  it('previews the new entry only, with the recipe problems for the chosen kind', async () => {
    const { run } = await setup()
    expect(run.preview(ANSWERS, { kind: 'create', separate: false })).toEqual({ markdown: ENTRY, problems: [] })
  })
})

describe('Create beside the source', () => {
  it('writes the prepared note, records its Undo, and opens it beside with the caret after the entry', async () => {
    const { run, deps, registry, beside } = await setup()
    expect(await run.submit(ANSWERS, { kind: 'create', separate: false }, phase)).toEqual({ status: 'shown' })
    expect(registry.api.submitProposal.mock.calls[0][0]).toMatchObject({ kind: 'create', fileName: 'commentary-on-source.md' })
    expect(registry.api.bindFolder).toHaveBeenCalledWith(expect.objectContaining({ folder: 'Topics' }))
    expect(deps.onCommitted).toHaveBeenCalledWith(expect.objectContaining({ kind: 'create', preimage: null, postimage: '# Commentary on Source\n\n> The passage\n\nMy thought\n' }))
    expect(beside.open).toHaveBeenCalledTimes(1)
    expect(deps.focus).toHaveBeenCalledWith(`${VAULT}/Topics/commentary-on-source.md`)
  })

  it('keeps the dialog with a committed note it could not open, and never writes again', async () => {
    const { run, registry } = await setup({ shown: false })
    expect(await run.submit(ANSWERS, { kind: 'create', separate: false }, phase)).toEqual({ status: 'notShown', kind: 'create', title: 'Commentary on Source' })
    expect(await run.submit(ANSWERS, { kind: 'create', separate: false }, phase)).toMatchObject({ status: 'notShown' })
    expect(registry.api.submitProposal).toHaveBeenCalledTimes(1)
  })
})

describe('Add to the linked note', () => {
  async function bound(registry: Awaited<ReturnType<typeof setup>>['registry'], content = BASELINE) {
    const sha = await sha256Hex(content)
    registry.api.bindDocument.mockImplementation(async () => ({ status: 'bound', documentHandle: 'doc-1', displayPath: 'Topics/commentary-on-source.md', contentSha256: sha }) as never)
    registry.api.submitProposal.mockImplementation(async proposal => ({
      status: 'committed', kind: 'append', operationId: proposal.operationId, path: COMMENTARY, beforeSha256: sha,
      afterSha256: proposal.contentSha256, durable: true, undoReceipt: 'undo-1',
    } as ProposalReceipt))
  }

  it('reads the saved note inside its lane, sends its whole postimage and hands the lane the new bytes', async () => {
    const { run, registry, page, deps } = await setup({ linked: LINKED, disk: { [COMMENTARY]: BASELINE }, tabs: [{ path: COMMENTARY, content: BASELINE }] })
    await bound(registry)
    const phases: string[] = []
    expect(await run.submit(ANSWERS, { kind: 'append', path: COMMENTARY }, next => phases.push(next))).toEqual({ status: 'shown' })
    expect(phases).toEqual(['saving', 'adding'])
    const sent = registry.api.submitProposal.mock.calls[0][0] as AppendProposal
    expect(sent).toMatchObject({ kind: 'append', expectedSha256: await sha256Hex(BASELINE), content: `${BASELINE}\n${ENTRY}` })
    expect(page.taken).toEqual([{ path: COMMENTARY, content: `${BASELINE}\n${ENTRY}` }])
    expect(deps.onCommitted).toHaveBeenCalledWith(expect.objectContaining({ kind: 'append', preimage: BASELINE, postimage: `${BASELINE}\n${ENTRY}`, offer: expect.objectContaining({ undoReceipt: 'undo-1' }) }))
  })

  it('refuses without sending when the open note holds other text than its saved bytes', async () => {
    const { run, registry } = await setup({ linked: LINKED, disk: { [COMMENTARY]: BASELINE }, tabs: [{ path: COMMENTARY, content: `${BASELINE}typed` }] })
    expect(await run.submit(ANSWERS, { kind: 'append', path: COMMENTARY }, phase)).toEqual({ status: 'notWritten', reason: 'changed', title: 'Commentary on Source' })
    expect(registry.api.beginRun).not.toHaveBeenCalled()
  })

  it('adds nothing when the note’s unsaved words could not be saved first', async () => {
    const { run, registry } = await setup({ linked: LINKED, disk: { [COMMENTARY]: BASELINE }, settle: 'failed' })
    expect(await run.submit(ANSWERS, { kind: 'append', path: COMMENTARY }, phase)).toEqual({ status: 'notWritten', reason: 'settleFailed', title: 'Commentary on Source' })
    expect(registry.api.submitProposal).not.toHaveBeenCalled()
  })

  it('answers a lost reply with Check again only, and a found commit goes through the lane before it is shown', async () => {
    const { run, registry, page, beside } = await setup({ linked: LINKED, disk: { [COMMENTARY]: BASELINE } })
    await bound(registry)
    const reply = deferred<ProposalReceipt | null>()
    registry.api.submitProposal.mockImplementationOnce(() => reply.promise)
    const adding = run.submit(ANSWERS, { kind: 'append', path: COMMENTARY }, phase)
    await vi.waitFor(() => expect(registry.api.submitProposal).toHaveBeenCalledTimes(1))
    reply.resolve(null)
    expect(await adding).toEqual({ status: 'uncertain', detail: 'noReply' })
    expect(page.taken).toEqual([{ path: COMMENTARY, content: null }])
    const sent = registry.api.submitProposal.mock.calls[0][0] as AppendProposal
    registry.api.queryProposal.mockImplementationOnce(async () => ({
      status: 'committed', kind: 'append', operationId: sent.operationId, path: COMMENTARY, beforeSha256: sent.expectedSha256,
      afterSha256: sent.contentSha256, durable: true, undoReceipt: 'undo-1',
    }))
    expect(await run.checkAgain()).toEqual({ status: 'shown' })
    expect(registry.api.submitProposal).toHaveBeenCalledTimes(1)
    expect(page.taken.at(-1)).toEqual({ path: COMMENTARY, content: sent.content })
    expect(beside.open).toHaveBeenCalledTimes(1)
  })
})
