import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TemplateController, TemplateReadResult, TemplateSaveResult, TemplateSnapshot } from './templateContract'
import { templateDraftDirty, useTemplateUi } from './useTemplateUi'

const snapshot = (path = '/vault/Meeting.md', template = '## Notes'): TemplateSnapshot => ({
  source: { vaultPath: '/vault', path }, title: 'Meeting', template, defaults: [], destinationDirectory: '', revision: template,
})
const ready = (value = snapshot()): TemplateReadResult => ({ status: 'ready', snapshot: value, preview: value.template?.trim() ? { snapshot: value, content: value.template } : null })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function setup(overrides: Partial<TemplateController> = {}) {
  const cancel = vi.fn(), release = vi.fn(), held = vi.fn()
  const controller: TemplateController = {
    begin: vi.fn(() => ({ id: 'scope-1', vaultPath: '/vault', cancel })),
    prepare: vi.fn(async (_scope, source) => ready(snapshot(source.path))),
    save: vi.fn(async (_scope, draft) => ({ status: 'saved', source: snapshot().source,
      snapshot: snapshot('/vault/Meeting.md', draft.text), text: draft.text, revision: draft.revision, refreshPending: false })),
    create: vi.fn(async () => ({ status: 'created', path: '/vault/new.md' })),
    holdAdmission: vi.fn(() => release), whenIdle: vi.fn(async () => {}), ...overrides,
  }
  const hook = renderHook(({ vaultPath }) => useTemplateUi({ controller, vaultPath, locale: 'en', blocked: () => false, onHeld: held }), { initialProps: { vaultPath: '/vault' } })
  act(() => hook.result.current.open())
  return { ...hook, controller, cancel, release, held }
}

describe('template draft ownership', () => {
  it('keeps a failed draft through dismissal and refuses boundaries without leaking admission holds', async () => {
    const test = setup({ save: vi.fn(async (_scope, draft) => ({ status: 'failed', reason: 'saveHeld', write: 'notStarted', revision: draft.revision })) })
    await act(() => test.result.current.select(snapshot().source))
    act(() => { test.result.current.edit(); test.result.current.type('text', 'unsaved words') })
    await act(() => test.result.current.save())
    act(() => test.result.current.requestClose())
    expect(test.result.current.state?.editor?.text).toBe('unsaved words')
    expect(test.result.current.state?.discard).toBe('close')
    expect(test.result.current.state?.editor?.status).toContain('unsaved changes')
    expect(() => test.result.current.boundary.begin()).toThrow()
    expect(test.release).toHaveBeenCalledOnce()
    expect(test.held).toHaveBeenCalledOnce()
    act(() => test.result.current.keepEditing())
    act(() => test.result.current.type('text', 'still editable'))
    expect(test.result.current.state?.editor?.text).toBe('still editable')
  })

  it('converts an older new-template receipt to the exact existing source and retains newer body text', async () => {
    const pending = deferred<TemplateSaveResult>()
    const save = vi.fn<TemplateController['save']>().mockReturnValueOnce(pending.promise).mockImplementation(async (_scope, draft) => ({
      status: 'saved', source: snapshot().source, snapshot: snapshot('/vault/Meeting.md', draft.text), text: draft.text, revision: draft.revision, refreshPending: false,
    }))
    const test = setup({ save })
    act(() => { test.result.current.newTemplate(); test.result.current.type('name', 'Meeting'); test.result.current.type('text', 'first text') })
    let work!: Promise<void>
    act(() => { work = test.result.current.save() })
    const submitted = save.mock.calls[0][1]
    act(() => { test.result.current.type('text', 'newer text'); test.result.current.type('name', 'Another name') })
    expect(test.result.current.state?.editor?.name).toBe('Meeting')
    expect(() => test.result.current.boundary.begin()).toThrow()
    await act(async () => { pending.resolve({ status: 'saved', source: snapshot().source, snapshot: snapshot('/vault/Meeting.md', 'first text'),
      text: 'first text', revision: submitted.revision, refreshPending: true }); await work })
    expect(test.result.current.state?.editor).toMatchObject({ kind: 'existing', name: 'Meeting', text: 'newer text', baseline: 'first text' })
    expect(templateDraftDirty(test.result.current.state?.editor ?? null)).toBe(true)
    await act(() => test.result.current.save())
    expect(save.mock.calls[1][1]).toMatchObject({ kind: 'existing', source: snapshot().source, text: 'newer text' })
    expect(templateDraftDirty(test.result.current.state?.editor ?? null)).toBe(false)
  })

  it('returns a clean new save to the exact saved template even before the page list refreshes', async () => {
    const test = setup()
    act(() => { test.result.current.newTemplate(); test.result.current.type('name', 'Meeting'); test.result.current.type('text', '## Notes') })
    await act(() => test.result.current.save())
    expect(test.result.current.state?.editor).toBeNull()
    expect(test.result.current.state?.selected).toEqual(snapshot().source)
    expect(test.result.current.state?.preview?.snapshot.source).toEqual(snapshot().source)
    expect(test.result.current.state?.savedSources).toHaveLength(1)
  })

  it('keeps the attempted preview locked for explicit reconciliation and warns before abandoning', async () => {
    const create = vi.fn<TemplateController['create']>().mockResolvedValueOnce({ status: 'failed', reason: 'unconfirmed', write: 'unconfirmed', attemptedPath: '/vault/attempt.md' })
      .mockResolvedValueOnce({ status: 'created', path: '/vault/attempt.md' })
    const test = setup({ create })
    await act(() => test.result.current.select(snapshot().source))
    await act(() => test.result.current.create())
    await act(() => test.result.current.select(snapshot('/vault/Other.md').source))
    act(() => { test.result.current.newTemplate(); test.result.current.edit() })
    expect(test.result.current.state?.selected).toEqual(snapshot().source)
    expect(test.result.current.state?.editor).toBeNull()
    expect(test.result.current.state?.attemptedPath).toBe('/vault/attempt.md')
    expect(() => test.result.current.boundary.begin()).toThrow()
    act(() => test.result.current.requestClose())
    expect(test.result.current.state?.discard).toBe('close')
    act(() => test.result.current.keepEditing())
    await act(() => test.result.current.create())
    expect(create.mock.calls[1][1]).toBe(create.mock.calls[0][1])
    expect(test.result.current.state?.resultPath).toBe('/vault/attempt.md')
  })

  it('ignores an older selection read and cancels idle preview before a workspace boundary', async () => {
    const a = deferred<TemplateReadResult>(), b = deferred<TemplateReadResult>()
    const test = setup({ prepare: vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise) })
    let first!: Promise<void>, second!: Promise<void>
    act(() => { first = test.result.current.select(snapshot('/vault/A.md').source); second = test.result.current.select(snapshot('/vault/B.md').source) })
    await act(async () => { b.resolve(ready(snapshot('/vault/B.md'))); await second; a.resolve(ready(snapshot('/vault/A.md'))); await first })
    expect(test.result.current.state?.snapshot?.source.path).toBe('/vault/B.md')
    let release!: () => void
    act(() => { release = test.result.current.boundary.begin() })
    expect(test.result.current.state).toBeNull()
    expect(test.cancel).toHaveBeenCalledOnce()
    act(() => test.result.current.open())
    expect(test.result.current.state).toBeNull()
    release(); release()
    expect(test.release).toHaveBeenCalledOnce()
    act(() => test.result.current.open())
    expect(test.result.current.state).not.toBeNull()
  })

  it('requires explicit acceptance of an externally changed baseline before preserving-draft save', async () => {
    const changed = snapshot('/vault/Meeting.md', 'external text')
    const save = vi.fn<TemplateController['save']>().mockImplementation(async (_scope, draft) => ({ status: 'sourceChanged', snapshot: changed, revision: draft.revision }))
    const test = setup({ save })
    await act(() => test.result.current.select(snapshot().source))
    act(() => { test.result.current.edit(); test.result.current.type('text', 'my draft') })
    await act(() => test.result.current.save())
    await act(() => test.result.current.save())
    expect(save).toHaveBeenCalledTimes(1)
    expect(test.result.current.state?.editor?.text).toBe('my draft')
    act(() => test.result.current.acceptConflict())
    await act(() => test.result.current.save())
    expect(save.mock.calls[1][1]).toMatchObject({ text: 'my draft', expected: changed })
  })

  it('keeps a cancelled preview read in boundary accounting until its source work settles', async () => {
    const pending = deferred<TemplateReadResult>()
    const test = setup({ prepare: vi.fn(() => pending.promise) })
    let work!: Promise<void>
    act(() => { work = test.result.current.select(snapshot().source) })
    act(() => test.result.current.requestClose())
    expect(test.result.current.state).toBeNull()
    expect(() => test.result.current.boundary.begin()).toThrow()
    await act(async () => { pending.resolve(ready()); await work })
    let release!: () => void
    act(() => { release = test.result.current.boundary.begin() })
    release()
    expect(test.result.current.state).toBeNull()
  })

  it('unlocks a new name only when the previous attempt is proven not to have written', async () => {
    const test = setup({ save: vi.fn(async (_scope, draft) => ({ status: 'failed', reason: 'collision', write: 'notStarted', attemptedPath: '/vault/Meeting.md', revision: draft.revision })) })
    act(() => { test.result.current.newTemplate(); test.result.current.type('name', 'Meeting'); test.result.current.type('text', 'draft') })
    await act(() => test.result.current.save())
    expect(test.result.current.state?.editor?.nameLocked).toBe(false)
    expect(test.result.current.state?.attemptedPath).toBeNull()
    act(() => test.result.current.type('name', 'New meeting'))
    expect(test.result.current.state?.editor?.name).toBe('New meeting')
  })

  it('routes Save to the active draft and retains a cleared existing template for confirmation', async () => {
    const test = setup()
    await act(() => test.result.current.select(snapshot().source))
    act(() => { test.result.current.edit(); test.result.current.type('text', '') })
    let handled = false
    await act(async () => { handled = test.result.current.boundary.saveActive(); await Promise.resolve() })
    expect(handled).toBe(true)
    expect(test.controller.save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'existing', text: '' }))
    expect(test.result.current.state?.editor?.text).toBe('')
    expect(templateDraftDirty(test.result.current.state?.editor ?? null)).toBe(false)
  })
})
