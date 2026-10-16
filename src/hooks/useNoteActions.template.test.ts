import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { mockInvoke } from '../mock-tauri'
import { writeTemplateConfirmed, type NoteActionsConfig } from './useNoteActions'
import { buildNewEntry } from './useNoteCreation'
import { snapshotFromEntry, type TemplateWriteRequest } from '../leadinglight/templates/templateDomain'
import type { DocumentMutation, MutationSettled } from './useEditorSave'
import type { MutateExistingDocument, RunPageExclusive } from './useAppSave'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const runtime = vi.hoisted(() => ({ native: true }))
vi.mock('../mock-tauri', () => ({ isTauri: () => runtime.native, mockInvoke: vi.fn() }))

const source = { vaultPath: '/vault', path: '/vault/type.md' }
const entry = { ...buildNewEntry({ path: source.path, slug: 'type', title: 'Plan', type: 'Type', status: null }), template: '## Old' }
const expected = snapshotFromEntry(source, entry)!
const request = (): TemplateWriteRequest => ({ source, expected, text: '## New', revision: 3, current: () => true })
const confirmed = '---\ntype: Type\ntemplate: "## New"\n---\n# Plan\n'

function setup() {
  const updateEntry = vi.fn()
  const persisted = vi.fn(async () => {})
  const typeChanged = vi.fn(async () => {})
  let path = source.path
  const mutate: MutateExistingDocument = <R,>(_path: string, mutation: Omit<DocumentMutation<R>, 'flushBuffers'>) => ({
    admitted: true, path, done: (async (): Promise<MutationSettled<R>> => {
      try { return { kind: 'returned', path, result: await mutation.publish(path), current: true, integration: 'none', latest: null } }
      catch (error) { return { kind: 'unknown', path, error, current: true } }
    })(),
  })
  const run: RunPageExclusive = async (_path, work) => work(mutate)
  const config: NoteActionsConfig = { vaultPath: '/vault', entries: [entry], addEntry: vi.fn(), removeEntry: vi.fn(),
    updateEntry, setToastMessage: vi.fn(), runPageExclusive: run,
    onFrontmatterPersisted: persisted, onTypeStateChanged: typeChanged }
  return { config, updateEntry, persisted, typeChanged, alias: () => { path = '/vault/renamed.md' } }
}

beforeEach(() => {
  vi.clearAllMocks()
  runtime.native = true
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === 'reload_vault_entry') return entry
    if (command === 'update_frontmatter') return confirmed
  })
})

describe('acknowledged template property writes', () => {
  it('keeps a confirmed receipt and old revision when subsequent refresh fails', async () => {
    const s = setup()
    s.typeChanged.mockRejectedValueOnce(new Error('refresh unavailable'))
    expect(await writeTemplateConfirmed(s.config, request())).toMatchObject({ status: 'saved', text: '## New', revision: 3,
      source, snapshot: { template: '## New' }, refreshPending: true })
    expect(s.updateEntry).toHaveBeenCalledWith(source.path, { template: '## New' })
  })

  it('refuses stale source, save hold, and renamed aliases before invoking any write', async () => {
    const s = setup()
    s.alias()
    expect(await writeTemplateConfirmed(s.config, request())).toMatchObject({ status: 'failed', reason: 'stale', write: 'notStarted' })
    expect(await writeTemplateConfirmed({ ...s.config, runPageExclusive: async () => false }, request())).toMatchObject({ reason: 'saveHeld' })
    expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'update_frontmatter')).toHaveLength(0)
  })

  it('compares the fresh exact source under its page claim and preserves a changed source', async () => {
    const s = setup()
    vi.mocked(invoke).mockResolvedValueOnce({ ...entry, template: '## External change' })
    expect(await writeTemplateConfirmed(s.config, request())).toMatchObject({ status: 'sourceChanged', revision: 3, snapshot: { template: '## External change' } })
    expect(s.updateEntry).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('accepts reordered native defaults and returns a receipt that matches the next fresh snapshot', async () => {
    const s = setup()
    const original = { ...entry, properties: { Zulu: 2, Alpha: 1 }, relationships: { ZuluProject: ['[[Z]]'], AlphaProject: ['[[A]]'] } }
    const reordered = { ...entry, properties: { Alpha: 1, Zulu: 2 }, relationships: { AlphaProject: ['[[A]]'], ZuluProject: ['[[Z]]'] } }
    vi.mocked(invoke).mockImplementation(async command => command === 'reload_vault_entry' ? reordered : confirmed)
    const receipt = await writeTemplateConfirmed(s.config, { ...request(), expected: snapshotFromEntry(source, original)! })
    expect(receipt).toMatchObject({ status: 'saved', snapshot: snapshotFromEntry(source, { ...original, template: '## New' }) })
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'update_frontmatter')).toHaveLength(1)
  })

  it('exposes a known attempted path on lost reply and never publishes an optimistic template', async () => {
    const s = setup()
    vi.mocked(invoke).mockImplementation(async command => {
      if (command === 'reload_vault_entry') return entry
      throw new Error('reply lost')
    })
    expect(await writeTemplateConfirmed(s.config, request())).toMatchObject({ status: 'failed', reason: 'unconfirmed', write: 'unconfirmed', attemptedPath: source.path })
    expect(s.updateEntry).not.toHaveBeenCalled()
    expect(s.typeChanged).not.toHaveBeenCalled()
  })

  it('keeps disk confirmation but refuses publication after the captured session goes stale', async () => {
    const s = setup()
    let current = true
    vi.mocked(invoke).mockImplementation(async command => {
      if (command === 'reload_vault_entry') return entry
      current = false
      return confirmed
    })
    expect(await writeTemplateConfirmed(s.config, { ...request(), current: () => current })).toMatchObject({ status: 'saved', refreshPending: true })
    expect(s.updateEntry).not.toHaveBeenCalled()
  })

  it('reconciles an unknown value already on disk through the mutation receipt without another property write', async () => {
    const s = setup()
    vi.mocked(invoke).mockImplementation(async command => command === 'reload_vault_entry' ? { ...entry, template: '## New' } : confirmed)
    expect(await writeTemplateConfirmed(s.config, { ...request(), reconcile: true })).toMatchObject({ status: 'saved', revision: 3 })
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual(['reload_vault_entry', 'get_note_content'])
    expect(s.updateEntry).toHaveBeenCalledWith(source.path, { template: '## New' })
  })

  it('browser saves use exact disk content and preserve unrelated metadata and body', async () => {
    runtime.native = false
    const s = setup()
    const original = '---\ntype: Type\ntemplate: "## Old"\nPriority: 2\n---\n# Plan\n\nKeep body'
    vi.mocked(mockInvoke).mockImplementation(async command => {
      if (command === 'reload_vault_entry') return entry
      if (command === 'get_note_content') return original
    })
    expect(await writeTemplateConfirmed(s.config, request())).toMatchObject({ status: 'saved' })
    expect(mockInvoke).toHaveBeenCalledWith('get_note_content', source)
    const write = vi.mocked(mockInvoke).mock.calls.find(([command]) => command === 'save_note_content')
    expect(write?.[1]).toMatchObject({ ...source, content: expect.stringContaining('Priority: 2\n---\n# Plan\n\nKeep body') })
    expect(write?.[1]?.content).toContain('template: "## New"')
  })

  it('browser source-read failure cannot seed empty/cached text or dispatch a write', async () => {
    runtime.native = false
    const s = setup()
    vi.mocked(mockInvoke).mockImplementation(async command => {
      if (command === 'reload_vault_entry') return entry
      throw new Error('read unavailable')
    })
    expect(await writeTemplateConfirmed(s.config, request())).toMatchObject({ status: 'failed', write: 'notStarted' })
    expect(vi.mocked(mockInvoke).mock.calls.some(([command]) => command === 'save_note_content')).toBe(false)
  })
})
