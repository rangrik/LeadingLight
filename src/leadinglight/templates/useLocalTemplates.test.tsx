import { StrictMode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { useLocalTemplates } from './useLocalTemplates'
import { buildNewEntry } from '../../hooks/useNoteCreation'
import type { TemplateSaveResult } from './templateContract'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../../mock-tauri', () => ({ isTauri: () => true, mockInvoke: vi.fn() }))

const source = { vaultPath: '/vault', path: '/vault/plan.md' }
const entry = { ...buildNewEntry({ path: source.path, slug: 'plan', title: 'Plan', type: 'Type', status: null }), template: '## Steps' }
const open = vi.fn(async () => true)
const writeExisting = vi.fn(async (): Promise<TemplateSaveResult> => ({ status: 'failed', reason: 'saveHeld', write: 'notStarted', revision: 0 }))
function setup() {
  return renderHook(({ vaultPath, ready }) => useLocalTemplates({ vaultPath, ready, entries: [],
    reserveOpen: () => ({ inSession: () => true, isActive: () => false, open }),
    markNavigation: () => ({ current: () => true }), writeExisting, addEntry: vi.fn() }),
  { initialProps: { vaultPath: '/vault', ready: true }, wrapper: StrictMode })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(invoke).mockResolvedValue(entry)
})

describe('template hook session binding', () => {
  it('is usable after strict effects and invalidates A → B → A without changing controller identity', async () => {
    const h = setup()
    const controller = h.result.current
    const scope = controller.begin()!
    expect(scope).not.toBeNull()
    h.rerender({ vaultPath: '/other', ready: true })
    h.rerender({ vaultPath: '/vault', ready: true })
    expect(h.result.current).toBe(controller)
    expect(await controller.prepare(scope, source)).toMatchObject({ status: 'failed', reason: 'stale' })
    expect(invoke).not.toHaveBeenCalled()
    const next = controller.begin()!
    expect(await controller.prepare(next, source)).toMatchObject({ status: 'ready' })
    expect(invoke).toHaveBeenCalledWith('reload_vault_entry', source)
    h.unmount()
  })

  it('refuses admission while vault loading and keeps unmounted work in whenIdle until it settles', async () => {
    const h = setup()
    h.rerender({ vaultPath: '/vault', ready: false })
    expect(h.result.current.begin()).toBeNull()
    h.rerender({ vaultPath: '/vault', ready: true })
    const controller = h.result.current
    const scope = controller.begin()!
    let finish!: (value: typeof entry) => void
    vi.mocked(invoke).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const work = controller.prepare(scope, source)
    await act(async () => { await Promise.resolve() })
    h.unmount()
    let idle = false
    void controller.whenIdle().then(() => { idle = true })
    await Promise.resolve()
    expect(idle).toBe(false)
    finish(entry)
    expect(await work).toMatchObject({ status: 'failed', reason: 'stale' })
    await controller.whenIdle()
    expect(controller.begin()).toBeNull()
    expect(open).not.toHaveBeenCalled()
  })
})
