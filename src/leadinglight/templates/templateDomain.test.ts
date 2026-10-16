import { describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import { buildNewEntry } from '../../hooks/useNoteCreation'
import { createTemplateController, snapshotFromEntry, type TemplateDomainDeps } from './templateDomain'
import type { TemplateDraft, TemplateSaveResult, TemplateSource } from './templateContract'
import type { VaultEntry } from '../../types'

const source = { vaultPath: '/vault', path: '/vault/Projects/plan.md' }
const entry = () => ({ ...buildNewEntry({ path: source.path, slug: 'plan', title: 'Plan: next', type: 'Type', status: null }),
  template: '## Steps\n- [ ] Begin', properties: { Priority: 2 }, relationships: { Project: ['[[Home]]'] } })

function setup() {
  let fresh: VaultEntry = entry()
  let session = {}
  let navigation = true
  const disk = new Map<string, string>()
  const create = vi.fn(async (path: string, content: string) => {
    if (disk.has(path)) throw new Error('File already exists')
    disk.set(path, content)
  })
  const open = vi.fn(async () => true)
  const read = vi.fn<(source: TemplateSource) => Promise<VaultEntry | null>>(async () => fresh)
  const addEntry = vi.fn()
  const flushSource = vi.fn(async () => {})
  const writeExisting = vi.fn(async (): Promise<TemplateSaveResult> => ({ status: 'failed', reason: 'saveHeld', revision: 1, write: 'notStarted' }))
  const refresh = vi.fn(async () => {})
  const deps = (): TemplateDomainDeps => ({ session, vaultPath: '/vault', ready: true, entries: [],
    reserveOpen: () => ({ inSession: () => true, isActive: () => false, open }),
    markNavigation: () => ({ current: () => navigation }),
    readEntry: read, readContent: async path => { if (!disk.has(path)) throw new Error('ENOENT'); return disk.get(path)! },
    createFile: create, flushSource, writeExisting, addEntry, refresh })
  const controller = createTemplateController(deps)
  const scope = controller.begin()!
  return { controller, scope, read, create, disk, open, addEntry, flushSource, writeExisting, refresh,
    change: (patch: Partial<typeof fresh>) => { fresh = { ...fresh, ...patch } },
    navigate: () => { navigation = false }, switchSession: () => { session = {} } }
}

async function preview(s: ReturnType<typeof setup>) {
  const result = await s.controller.prepare(s.scope, source)
  expect(result.status).toBe('ready')
  if (result.status !== 'ready' || !result.preview) throw new Error('preview missing')
  return result.preview
}

describe('local template operations', () => {
  it('uses one exact fresh entry and safely copies its body/defaults into the same folder', async () => {
    const s = setup()
    const p = await preview(s)
    expect(s.flushSource).toHaveBeenCalledWith(source.path)
    expect(s.read).toHaveBeenCalledWith(source)
    expect(p.snapshot.destinationDirectory).toBe('Projects')
    expect(parse(p.content.split('---')[1])).toEqual({ type: 'Plan: next', Priority: 2, Project: '[[Home]]' })
    const result = await s.controller.create(s.scope, p)
    expect(result.status).toBe('opened')
    expect(s.create).toHaveBeenCalledOnce()
    expect(s.create.mock.calls[0][0]).toMatch(/^\/vault\/Projects\/[^/]+\.md$/)
    expect(s.create.mock.calls[0][1]).toBe(p.content)
  })

  it('requires explicit approval of a changed fresh preview, then refuses a missing source without a sibling fallback', async () => {
    const s = setup()
    const p = await preview(s)
    s.change({ template: '## New body', properties: { Priority: 3 } })
    const changed = await s.controller.create(s.scope, p)
    expect(changed.status).toBe('previewChanged')
    expect(s.create).not.toHaveBeenCalled()
    s.read.mockResolvedValueOnce(null)
    expect(await s.controller.create(s.scope, p)).toMatchObject({ status: 'failed', reason: 'missing', write: 'notStarted' })
    expect(s.create).not.toHaveBeenCalled()
  })

  it('treats native property and relationship map ordering as the same approved preview', async () => {
    const s = setup()
    s.change({ properties: { Zulu: 2, Alpha: 1 }, relationships: { ZuluProject: ['[[Z]]'], AlphaProject: ['[[A]]'] } })
    const approved = await preview(s)
    s.change({ properties: { Alpha: 1, Zulu: 2 }, relationships: { AlphaProject: ['[[A]]'], ZuluProject: ['[[Z]]'] } })
    expect(await s.controller.create(s.scope, approved)).toMatchObject({ status: 'opened' })
    expect(s.create).toHaveBeenCalledOnce()
    expect(s.create.mock.calls[0][1]).toBe(approved.content)
  })

  it('does not write after source settlement refuses or the captured pane navigates', async () => {
    const s = setup()
    const p = await preview(s)
    s.flushSource.mockRejectedValueOnce(new Error('held'))
    expect(await s.controller.create(s.scope, p)).toMatchObject({ reason: 'saveHeld' })
    s.navigate()
    expect(await s.controller.create(s.scope, p)).toMatchObject({ reason: 'stale' })
    expect(s.create).not.toHaveBeenCalled()
  })

  it('preserves an uncertain create path and checks it on explicit retry without creating/opening twice', async () => {
    const s = setup()
    const p = await preview(s)
    s.create.mockImplementationOnce(async (path, content) => { s.disk.set(path, content); throw new Error('reply lost') })
    const uncertain = await s.controller.create(s.scope, p)
    expect(uncertain).toMatchObject({ status: 'failed', write: 'unconfirmed' })
    expect(s.open).not.toHaveBeenCalled()
    const result = await s.controller.create(s.scope, p)
    expect(result).toMatchObject({ status: 'opened', path: s.create.mock.calls[0][0] })
    expect(s.create).toHaveBeenCalledOnce()
    expect(await s.controller.create(s.scope, p)).toEqual(result)
    expect(s.open).toHaveBeenCalledOnce()
  })

  it('never opens a collision occupant or overwrites changed content at an uncertain path', async () => {
    const s = setup()
    const p = await preview(s)
    s.create.mockImplementationOnce(async path => { s.disk.set(path, 'Other writer'); throw new Error('reply lost') })
    await s.controller.create(s.scope, p)
    expect(await s.controller.create(s.scope, p)).toMatchObject({ reason: 'collision', write: 'unconfirmed' })
    expect(s.create).toHaveBeenCalledOnce()
    expect(s.open).not.toHaveBeenCalled()
    expect([...s.disk.values()]).toEqual(['Other writer'])
  })

  it('atomically saves a new Type and retains the older acknowledged draft after an uncertain reply', async () => {
    const s = setup()
    const draft: TemplateDraft = { kind: 'new', name: 'Plan: "weekly"', text: '## Start\n- [ ] Read', revision: 1 }
    s.create.mockImplementationOnce(async (path, content) => { s.disk.set(path, content); throw new Error('reply lost') })
    expect(await s.controller.save(s.scope, draft)).toMatchObject({ write: 'unconfirmed', revision: 1 })
    const receipt = await s.controller.save(s.scope, { ...draft, text: 'Newer typing', revision: 2 })
    expect(receipt).toMatchObject({ status: 'saved', revision: 1, text: draft.text, snapshot: { title: draft.name, template: draft.text } })
    expect(s.create).toHaveBeenCalledOnce()
    expect(parse(s.create.mock.calls[0][1].split('---')[1])).toEqual({ type: 'Type', title: draft.name, template: draft.text })
    expect(s.open).not.toHaveBeenCalled()
  })

  it('saves a second new template in the same chooser as a separate exclusive creation', async () => {
    const s = setup()
    const alpha: TemplateDraft = { kind: 'new', name: 'Alpha', text: '## Alpha', revision: 1 }
    expect(await s.controller.save(s.scope, alpha)).toMatchObject({ status: 'saved', source: { path: '/vault/alpha.md' } })
    expect(await s.controller.save(s.scope, { kind: 'new', name: 'Beta', text: '## Beta', revision: 2 })).toMatchObject({ status: 'saved', source: { path: '/vault/beta.md' } })
    expect([...s.disk.keys()]).toEqual(['/vault/alpha.md', '/vault/beta.md'])
    expect(s.writeExisting).not.toHaveBeenCalled()
  })

  it('a second New template with the same name cannot turn into an overwrite of the first', async () => {
    const s = setup()
    const alpha: TemplateDraft = { kind: 'new', name: 'Alpha', text: '## Original', revision: 1 }
    await s.controller.save(s.scope, alpha)
    const original = s.disk.get('/vault/alpha.md')
    expect(await s.controller.save(s.scope, { ...alpha, text: '## Different', revision: 2 })).toMatchObject({ status: 'failed', reason: 'collision', write: 'notStarted' })
    expect(s.disk.get('/vault/alpha.md')).toBe(original)
    expect(s.create).toHaveBeenCalledTimes(2)
    expect(s.writeExisting).not.toHaveBeenCalled()
  })

  it('requires meaningful new name/body but permits explicitly clearing an existing template', async () => {
    const s = setup()
    expect(await s.controller.save(s.scope, { kind: 'new', name: ' ', text: '## Body', revision: 1 })).toMatchObject({ reason: 'empty' })
    expect(await s.controller.save(s.scope, { kind: 'new', name: 'Name', text: ' ', revision: 1 })).toMatchObject({ reason: 'empty' })
    const expected = snapshotFromEntry(source, entry())!
    await s.controller.save(s.scope, { kind: 'existing', source, expected, text: '', revision: 2 })
    expect(s.writeExisting).toHaveBeenCalledWith(expect.objectContaining({ text: '', revision: 2 }))
  })

  it('rejects foreign, archived and non-Type identities without a write', async () => {
    const s = setup()
    expect(await s.controller.prepare(s.scope, { ...source, path: '/elsewhere/type.md' })).toMatchObject({ reason: 'invalidSource' })
    expect(s.read).not.toHaveBeenCalled()
    s.change({ archived: true })
    expect(await s.controller.prepare(s.scope, source)).toMatchObject({ reason: 'invalidSource' })
    s.change({ archived: false, isA: 'Note' })
    expect(await s.controller.prepare(s.scope, source)).toMatchObject({ reason: 'invalidSource' })
    expect(s.create).not.toHaveBeenCalled()
  })

  it('does not accept a late first selection after a second preparation', async () => {
    const s = setup()
    let finish!: (value: ReturnType<typeof entry>) => void
    s.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const first = s.controller.prepare(s.scope, source)
    await vi.waitFor(() => expect(s.read).toHaveBeenCalledOnce())
    expect(await s.controller.prepare(s.scope, source)).toMatchObject({ status: 'ready' })
    finish(entry())
    expect(await first).toMatchObject({ status: 'failed', reason: 'stale' })
  })

  it('keeps confirmed page creation and accurate known metadata if entry refresh or outgoing open fails', async () => {
    const s = setup()
    s.change({ template: '# Meeting\n\n## Agenda' })
    const p = await preview(s)
    s.read.mockImplementation(async target => {
      if (target.path === source.path) return { ...entry(), template: '# Meeting\n\n## Agenda' }
      throw new Error('refresh failed')
    })
    s.open.mockRejectedValueOnce(new Error('outgoing save held'))
    expect(await s.controller.create(s.scope, p)).toMatchObject({ status: 'created' })
    expect(s.addEntry).toHaveBeenCalledWith(expect.objectContaining({ title: 'Meeting', hasH1: true,
      properties: { Priority: 2 }, relationships: { Project: ['[[Home]]'] } }))
    expect(s.create).toHaveBeenCalledOnce()
  })

  it('retries an absent uncertain file only at its retained path and refuses double submission', async () => {
    const s = setup()
    const p = await preview(s)
    let fail!: (error: Error) => void
    s.create.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    const first = s.controller.create(s.scope, p)
    await vi.waitFor(() => expect(s.create).toHaveBeenCalledOnce())
    expect(await s.controller.create(s.scope, p)).toMatchObject({ reason: 'busy' })
    fail(new Error('reply lost'))
    const result = await first
    expect(result).toMatchObject({ write: 'unconfirmed' })
    expect(await s.controller.prepare(s.scope, source)).toMatchObject({ reason: 'unconfirmed' })
    expect(await s.controller.create(s.scope, p)).toMatchObject({ status: 'opened', path: s.create.mock.calls[0][0] })
    expect(s.create.mock.calls.map(([path]) => path)).toEqual([s.create.mock.calls[0][0], s.create.mock.calls[0][0]])
  })

  it('keeps cancellation distinct from the dispatched write and permits correcting a definite name collision', async () => {
    const s = setup()
    const draft: TemplateDraft = { kind: 'new', name: 'Plan', text: '## Body', revision: 1 }
    s.disk.set('/vault/plan.md', 'Existing occupant')
    expect(await s.controller.save(s.scope, draft)).toMatchObject({ reason: 'collision', write: 'notStarted' })
    let fail!: (error: Error) => void
    s.create.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    const work = s.controller.save(s.scope, { ...draft, name: 'Other', revision: 2 })
    s.scope.cancel()
    let idle = false
    void s.controller.whenIdle().then(() => { idle = true })
    await Promise.resolve()
    expect(idle).toBe(false)
    fail(new Error('lost'))
    expect(await work).toMatchObject({ write: 'unconfirmed', attemptedPath: '/vault/other.md', revision: 2 })
    expect(await s.controller.save(s.scope, draft)).toMatchObject({ reason: 'stale' })
    expect(s.disk.get('/vault/plan.md')).toBe('Existing occupant')
    expect(s.open).not.toHaveBeenCalled()
  })

  it('passes the retained existing draft through reconciliation and keeps uncertainty on a held retry', async () => {
    const s = setup()
    const expected = snapshotFromEntry(source, entry())!
    const draft: TemplateDraft = { kind: 'existing', source, expected, text: '## First', revision: 1 }
    s.writeExisting.mockResolvedValueOnce({ status: 'failed', reason: 'unconfirmed', write: 'unconfirmed', attemptedPath: source.path, revision: 1 })
    await s.controller.save(s.scope, draft)
    expect(await s.controller.save(s.scope, { ...draft, text: '## Newer', revision: 2 })).toMatchObject({ write: 'unconfirmed', attemptedPath: source.path, revision: 1 })
    expect(s.writeExisting).toHaveBeenLastCalledWith(expect.objectContaining({ text: '## First', revision: 1, reconcile: true }))
  })

  it('a lifecycle hold blocks new work, joins admitted writes, and does not publish across a vault session', async () => {
    const s = setup()
    const p = await preview(s)
    let finish!: () => void
    s.create.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const operation = s.controller.create(s.scope, p)
    await vi.waitFor(() => expect(s.create).toHaveBeenCalledOnce())
    const release = s.controller.holdAdmission()
    expect(s.controller.begin()).toBeNull()
    expect(await s.controller.save(s.scope, { kind: 'new', name: 'New', text: 'Body', revision: 1 })).toMatchObject({ reason: 'busy' })
    let idle = false
    void s.controller.whenIdle().then(() => { idle = true })
    await Promise.resolve()
    expect(idle).toBe(false)
    s.switchSession()
    finish()
    expect(await operation).toMatchObject({ status: 'created' })
    await s.controller.whenIdle()
    expect(s.addEntry).not.toHaveBeenCalled()
    expect(s.open).not.toHaveBeenCalled()
    release()
    expect(s.controller.begin()).not.toBeNull()
  })
})
