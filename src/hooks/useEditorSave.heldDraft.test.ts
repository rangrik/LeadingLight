import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { SetStateAction } from 'react'
import { invoke, type InvokeArgs } from '@tauri-apps/api/core'
import { AUTO_SAVE_DEBOUNCE_MS, useEditorSave } from './useEditorSave'
import type { VaultEntry } from '../types'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({ isTauri: () => true, mockInvoke: vi.fn(), updateMockContent: vi.fn() }))
vi.mock('../leadinglight/saveOutcome', async importOriginal => ({
  ...await importOriginal<typeof import('../leadinglight/saveOutcome')>(),
  sha256Hex: async () => 'a'.repeat(64),
}))

// Seam (RENAME 6.2): a renamed page's words typed under its hold take the receipt's change, or stay
// held. Catches an old-base draft being autosaved over the rename's committed change.
const OLD = '/vault/plan.md'
const NEW = '/vault/goals.md'
const disk = new Map<string, string>()
let tabs: { entry: VaultEntry; content: string }[] = []
let renamed: string | null = null

beforeEach(() => {
  vi.useFakeTimers()
  disk.clear()
  renamed = null
  tabs = [{ entry: { path: OLD } as VaultEntry, content: '[Self](./plan.md)\n' }]
  vi.mocked(invoke).mockImplementation(async (cmd: string, raw?: InvokeArgs) => {
    const { request, content } = raw as unknown as { request: { path: string }; content: string }
    if (cmd === 'save_page_content') disk.set(request.path, content)
    return cmd === 'save_page_content' ? { status: 'committed', written: true, durable: true, history: null } : null
  })
})
afterEach(() => { vi.useRealTimers() })

function render() {
  return renderHook(() => useEditorSave({
    updateVaultContent: vi.fn(), setToastMessage: vi.fn(),
    setTabs: (update: SetStateAction<typeof tabs>) => { tabs = typeof update === 'function' ? update(tabs) : update },
    resolvePath: path => (renamed && path === OLD ? renamed : path),
    persistenceScope: '/vault',
  })).result
}

function typeUnderHold(queue: ReturnType<typeof render>, draft: string) {
  act(() => {
    queue.current.holdAutosave([OLD])
    queue.current.handleContentChange(OLD, draft)
  })
  // The rename commits and the page now shows at its new path.
  renamed = NEW
  tabs = tabs.map(tab => ({ ...tab, entry: { ...tab.entry, path: NEW } }))
}

it('a held draft takes the rebase, shows it at the new path, and saves it only after release', async () => {
  const queue = render()
  typeUnderHold(queue, '[Self](./plan.md)\nTyped.\n')
  let state = ''
  act(() => { state = queue.current.rebaseHeldDraft(NEW, draft => draft.replace('./plan.md', './goals.md')) })
  expect(state).toBe('rebased')
  expect(tabs[0].content).toBe('[Self](./goals.md)\nTyped.\n')
  await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS * 2) })
  expect(disk.size).toBe(0)
  act(() => { queue.current.releaseAutosave([OLD], 'resume') })
  await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS + 10) })
  expect(Object.fromEntries(disk)).toEqual({ [NEW]: '[Self](./goals.md)\nTyped.\n' })
})

it('a draft that cannot take the change stays pending and unsaved, and says so when saved explicitly', async () => {
  const queue = render()
  typeUnderHold(queue, '[Self](./plan.md)\nTyped.\n')
  let state = ''
  act(() => { state = queue.current.rebaseHeldDraft(NEW, () => null) })
  expect(state).toBe('unmergedDraft')
  act(() => { queue.current.releaseAutosave([OLD], 'resume') })
  await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS + 10) })
  expect(disk.size).toBe(0)
  const explicit = await act(async () => queue.current.savePendingForPath(NEW).then(() => 'saved', (error: Error) => error.name))
  expect(explicit).toBe('UnmergedDraftError')
  expect(tabs[0].content).toBe('[Self](./plan.md)\nTyped.\n')
})

it('reports none when nothing is pending', () => {
  const queue = render()
  let state = ''
  act(() => { state = queue.current.rebaseHeldDraft(OLD, draft => `${draft}x`) })
  expect(state).toBe('none')
})
