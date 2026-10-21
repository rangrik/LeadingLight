import { describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '../../types'
import { runManagedRename, type ManagedRenameServices, type RebaseHeldDraft } from './managedRename'
import { createRenameAdmission } from './renameAdmission'
import type { RenameReceipt } from './renameReceipt'
import { RENAME_REFUSED_PREFIX } from './renameRefusal'

type Tab = { entry: VaultEntry; content: string }
const tab = (path: string, content: string): Tab => ({ entry: { path, title: 'T', filename: path.split('/').pop() } as VaultEntry, content })

function services(tabs: Tab[], extra: Partial<ManagedRenameServices> = {}) {
  const state = { tabs }
  const service: ManagedRenameServices = {
    admission: createRenameAdmission(),
    tabsRef: { get current() { return state.tabs } },
    setTabs: update => { state.tabs = update(state.tabs) },
    ...extra,
  }
  return { service, state }
}

const receipt = (overrides: Partial<RenameReceipt> = {}): RenameReceipt => ({
  new_path: '/vault/goals.md', updated_files: 0, failed_updates: 0,
  source_before_content: '# Plan\n\n[Self](./plan.md)\n', source_content: '# Plan\n\n[Self](./goals.md)\n',
  updated_open_pages: [], unrefreshed_open_paths: [], ...overrides,
})

const request = (reply: unknown, route = vi.fn()) => ({
  sourcePath: '/vault/plan.md',
  vaultPath: '/vault',
  oldTitle: 'Plan',
  destination: { siblingOf: '/vault/plan.md' },
  dispatch: vi.fn(async () => reply),
  route,
})

describe('managed rename flow', () => {
  // Amendment B §3: the editor is still registered under the old identity until routing re-renders.
  it('flushes the old editor identity, routes, flushes the new alias, then rebases the held source draft', async () => {
    const order: string[] = []
    const draft = '# Plan\n\n[Self](./plan.md)\n\nTyped meanwhile.\n'
    const rebaseHeldDraft = vi.fn<RebaseHeldDraft>((path, rebase) => {
      order.push(`rebase:${path}`)
      expect(rebase(draft)).toBe('# Plan\n\n[Self](./goals.md)\n\nTyped meanwhile.\n')
      return 'rebased'
    })
    const flushEditorBuffers = vi.fn((path: string) => { order.push(`flush:${path}`) })
    const { service } = services([tab('/vault/plan.md', '# Plan\n\n[Self](./plan.md)\n')], { rebaseHeldDraft, flushEditorBuffers })
    const route = vi.fn(() => { order.push('route') })
    const result = await runManagedRename(request(receipt(), route), service)
    expect(order).toEqual(['flush:/vault/plan.md', 'route', 'flush:/vault/goals.md', 'rebase:/vault/goals.md'])
    expect(result).toEqual(expect.objectContaining({ status: 'renamed', sourceHeld: false, sourceText: '# Plan\n\n[Self](./goals.md)\n\nTyped meanwhile.\n' }))
  })

  it('gives an unchanged source tab the receipt bytes and reports an unmergeable draft as held', async () => {
    const none = services([tab('/vault/plan.md', '# Plan\n\n[Self](./plan.md)\n')], { rebaseHeldDraft: () => 'none' })
    await runManagedRename(request(receipt()), none.service)
    expect(none.state.tabs[0].content).toBe('# Plan\n\n[Self](./goals.md)\n')

    const held = services([tab('/vault/plan.md', '# Plan\n\n[Self](./plan.md)\n')], { rebaseHeldDraft: () => 'unmergedDraft' })
    expect(await runManagedRename(request(receipt()), held.service)).toEqual(expect.objectContaining({ status: 'renamed', sourceHeld: true }))
  })

  it.each([
    ['a malformed reply', (pending: ReturnType<typeof request>) => pending.dispatch.mockResolvedValue({ new_path: '/vault/goals.md', updated_files: 0 })],
    ['a rejected transport', (pending: ReturnType<typeof request>) => pending.dispatch.mockRejectedValue(new Error('IPC lost'))],
  ])('holds the source after %s: unknown, never routed, nothing reread, tab untouched', async (_case, reply) => {
    const order: string[] = []
    const rebaseHeldDraft = vi.fn<RebaseHeldDraft>(path => { order.push(`hold:${path}`); return 'none' })
    const flushEditorBuffers = vi.fn((path: string) => { order.push(`flush:${path}`) })
    const { service, state } = services([tab('/vault/plan.md', '# Plan\n')], { rebaseHeldDraft, flushEditorBuffers })
    const route = vi.fn()
    const pending = request(null, route)
    reply(pending)
    // Even when the old path still reads exactly its before-image, nothing is proven: no reread.
    const readSource = vi.fn(async () => '# Plan\n')
    const result = await runManagedRename({ ...pending, readSource }, service)
    expect(result).toMatchObject({ status: 'unknown', heldPaths: [], unprovenPaths: [] })
    expect(route).not.toHaveBeenCalled()
    expect(readSource).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['flush:/vault/plan.md', 'hold:/vault/plan.md'])
    expect(rebaseHeldDraft.mock.calls[0][1]('anything')).toBeNull()
    expect(state.tabs[0].content).toBe('# Plan\n')
  })

  it('marks an unknown source unproven first, before its ticket is released, even when its editor cannot be read', async () => {
    const order: string[] = []
    const { service } = services([tab('/vault/plan.md', '# Plan\n')], {
      holdUnproven: vi.fn((path: string) => { order.push(`unproven:${path}:${service.admission!.held(path) ? 'ticket' : 'released'}`) }),
      flushEditorBuffers: vi.fn(() => { order.push('flush'); throw new Error('The rich editor could not serialize') }),
      rebaseHeldDraft: vi.fn<RebaseHeldDraft>(path => { order.push(`hold:${path}`); return 'unmergedDraft' }),
    })
    const pending = request(null)
    pending.dispatch.mockRejectedValue(new Error('IPC lost'))
    const result = await runManagedRename(pending, service)
    expect(result).toMatchObject({ status: 'unknown' })
    expect(order).toEqual(['unproven:/vault/plan.md:ticket', 'flush', 'hold:/vault/plan.md'])
    expect(service.admission!.held('/vault/plan.md')).toBeNull()
  })

  it('never marks a source whose outcome is known', async () => {
    const holdUnproven = vi.fn()
    const known = [
      request(receipt()),
      { ...request(null), allowUnchanged: true },
      Object.assign(request(null), { dispatch: vi.fn(async () => { throw `${RENAME_REFUSED_PREFIX}Invalid filename` }) }),
    ]
    for (const pending of known) {
      const { service } = services([tab('/vault/plan.md', '# Plan\n\n[Self](./plan.md)\n')], { holdUnproven, rebaseHeldDraft: () => 'none' })
      expect((await runManagedRename(pending, service)).status).not.toBe('unknown')
    }
    expect(holdUnproven).not.toHaveBeenCalled()
  })

  it('treats only an explicit backend refusal as known, with its own message and no hold', async () => {
    const rebaseHeldDraft = vi.fn<RebaseHeldDraft>(() => 'none')
    const { service } = services([tab('/vault/plan.md', '# Plan\n')], { rebaseHeldDraft })
    const pending = request(null)
    pending.dispatch.mockRejectedValue(`${RENAME_REFUSED_PREFIX}A note with that name already exists`)
    expect(await runManagedRename(pending, service)).toEqual({ status: 'refused', reason: 'native', error: 'A note with that name already exists' })
    expect(rebaseHeldDraft).not.toHaveBeenCalled()
  })

  it('refuses before dispatch when another managed rename holds a page it may rewrite', async () => {
    const { service } = services([tab('/vault/plan.md', '# Plan\n'), tab('/vault/c.md', '[S](./plan.md)\n')])
    const other = service.admission!.admit('/vault/other.md', ['/vault/c.md'])
    const pending = request(receipt())
    expect(await runManagedRename(pending, service)).toEqual({ status: 'refused', reason: 'busy' })
    expect(pending.dispatch).not.toHaveBeenCalled()
    other?.release()
    // A barrier's earlier ticket is used, extended, and left for its owner to release.
    const barrier = service.admission!.admit('/vault/plan.md', [])
    await runManagedRename(request(receipt()), service)
    expect(service.admission!.held('/vault/plan.md')).toBe(barrier)
    expect(barrier?.covers(['/vault/c.md'])).toBe(true)
    barrier?.release()
  })

  it('treats an automatic rename’s null reply as nothing renamed', async () => {
    const { service } = services([tab('/vault/plan.md', '# Plan\n')])
    expect(await runManagedRename({ ...request(null), allowUnchanged: true }, service)).toEqual({ status: 'unchanged' })
    expect(await runManagedRename(request(null), service)).toMatchObject({ status: 'unknown' })
  })

  it('without the save seam refreshes linked tabs only from their exact before-image', async () => {
    const { service, state } = services([
      tab('/vault/plan.md', '# Plan\n\n[Self](./plan.md)\n'),
      tab('/vault/a.md', '[S](./plan.md)\n'),
      tab('/vault/b.md', '[S](./plan.md) typed\n'),
    ])
    const reply = receipt({ updated_open_pages: [
      { path: '/vault/a.md', before_content: '[S](./plan.md)\n', content: '[S](./goals.md)\n' },
      { path: '/vault/b.md', before_content: '[S](./plan.md)\n', content: '[S](./goals.md)\n' },
    ] })
    const pending = request(reply)
    const result = await runManagedRename(pending, service)
    expect(pending.dispatch).toHaveBeenCalledWith(['/vault/a.md', '/vault/b.md'])
    expect(state.tabs.map(item => item.content)).toEqual(['# Plan\n\n[Self](./goals.md)\n', '[S](./goals.md)\n', '[S](./plan.md) typed\n'])
    expect(result).toEqual(expect.objectContaining({ status: 'renamed', stalePaths: ['/vault/b.md'] }))
  })
})
