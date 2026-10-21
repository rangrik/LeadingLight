import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { SetStateAction } from 'react'
import { invoke, type InvokeArgs } from '@tauri-apps/api/core'
import { useAppSave } from './useAppSave'
import { AUTO_SAVE_DEBOUNCE_MS } from './useEditorSave'
import type { VaultEntry } from '../types'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({ isTauri: () => true, mockInvoke: vi.fn(), updateMockContent: vi.fn() }))
// The real hash finishes outside fake time, as in useAppSave.test.ts.
vi.mock('../leadinglight/saveOutcome', async importOriginal => ({
  ...await importOriginal<typeof import('../leadinglight/saveOutcome')>(),
  sha256Hex: async () => 'a'.repeat(64),
}))

// Seam (RENAME 6.1): two open untitled pages that link to each other rename themselves. Catches
// each rename's linked-page change waiting on the other page's rename while that rename waits on it.
const A = '/vault/untitled-note-1.md'
const B = '/vault/untitled-note-2.md'
const disk = new Map<string, string>()
const gates = new Map<string, () => void>()
const dispatched: string[] = []

interface Tab { entry: VaultEntry; content: string }
let tabs: Tab[] = []

function entry(path: string): VaultEntry {
  return { path, title: 'Untitled', filename: path.split('/').pop(), isA: 'Note' } as unknown as VaultEntry
}

beforeEach(() => {
  vi.useFakeTimers()
  disk.clear()
  gates.clear()
  dispatched.length = 0
  disk.set(A, '# Alpha\n\n[B](./untitled-note-2.md)\n')
  disk.set(B, '# Beta\n\n[A](./untitled-note-1.md)\n')
  tabs = [{ entry: entry(A), content: disk.get(A)! }, { entry: entry(B), content: disk.get(B)! }]
  vi.mocked(invoke).mockImplementation(async (cmd: string, raw?: InvokeArgs) => {
    const args = (raw ?? {}) as { path: string; request: { path: string }; content: string; args: { notePath: string; openPaths: string[] } }
    if (cmd === 'save_page_content') {
      disk.set(args.request.path, args.content)
      return { status: 'committed', written: true, durable: true, history: null }
    }
    if (cmd === 'get_note_content') return disk.get(args.path) ?? ''
    if (cmd === 'reload_vault_entry') return entry(args.path)
    if (cmd !== 'auto_rename_untitled') return null
    // Like native: read, wait, publish at the H1 slug, rewrite the other page's ordinary link.
    const { notePath, openPaths } = args.args
    dispatched.push(notePath)
    const before = disk.get(notePath) ?? ''
    await new Promise<void>(resolve => { gates.set(notePath, resolve) })
    const newPath = notePath === A ? '/vault/alpha.md' : '/vault/beta.md'
    disk.delete(notePath)
    disk.set(newPath, before)
    const other = [...disk.keys()].find(path => path !== newPath)!
    const otherBefore = disk.get(other)!
    const otherAfter = otherBefore.replace(`./${notePath.split('/').pop()}`, `./${newPath.split('/').pop()}`)
    disk.set(other, otherAfter)
    return {
      new_path: newPath, updated_files: 1, failed_updates: 0, source_before_content: before, source_content: before,
      updated_open_pages: openPaths.includes(other) ? [{ path: other, before_content: otherBefore, content: otherAfter }] : [],
      unrefreshed_open_paths: [],
    }
  })
})
afterEach(() => { vi.useRealTimers() })

function render(activeTabPath: string) {
  return renderHook(({ active }: { active: string }) => useAppSave({
    updateEntry: vi.fn(),
    setTabs: (update: SetStateAction<Tab[]>) => { tabs = typeof update === 'function' ? update(tabs) : update },
    handleSwitchTab: vi.fn(), setToastMessage: vi.fn(), loadModifiedFiles: vi.fn(), clearUnsaved: vi.fn(),
    unsavedPaths: new Set(), tabs, activeTabPath: active, handleRenameNote: vi.fn(), handleRenameFilename: vi.fn(),
    replaceEntry: vi.fn(), resolvedPath: '/vault', initialH1AutoRenameEnabled: true, pageBusyMessage: 'busy',
  }), { initialProps: { active: activeTabPath } })
}

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

it('refuses the intersecting automatic rename before it registers, finishes the first, and renames the second later', async () => {
  const hook = render(A)
  act(() => { hook.result.current.handleContentChange(A, `${disk.get(A)}\n`) })
  await advance(AUTO_SAVE_DEBOUNCE_MS + 2_600)
  expect(dispatched).toEqual([A])

  // B becomes active and saves while A's rename waits on native.
  hook.rerender({ active: B })
  act(() => { hook.result.current.handleContentChange(B, `${disk.get(B)}\n`) })
  await advance(AUTO_SAVE_DEBOUNCE_MS + 2_600)
  // B's rename intersects A's (each may rewrite the other): refused before dispatch, nothing waits.
  expect(dispatched).toEqual([A])

  await act(async () => { gates.get(A)?.() })
  await advance(AUTO_SAVE_DEBOUNCE_MS)
  expect(disk.get('/vault/alpha.md')).toBe('# Alpha\n\n[B](./untitled-note-2.md)\n\n')
  expect(disk.get(B)).toBe('# Beta\n\n[A](./alpha.md)\n\n')
  expect(tabs.find(tab => tab.entry.path === B)?.content).toBe('# Beta\n\n[A](./alpha.md)\n\n')

  // A later edit reschedules B as a fresh action; it now runs alone.
  act(() => { hook.result.current.handleContentChange(B, `${tabs.find(tab => tab.entry.path === B)!.content}More.\n`) })
  await advance(AUTO_SAVE_DEBOUNCE_MS + 2_600)
  expect(dispatched).toEqual([A, B])
  await act(async () => { gates.get(B)?.() })
  await advance(AUTO_SAVE_DEBOUNCE_MS)
  expect(disk.get('/vault/beta.md')).toBe('# Beta\n\n[A](./alpha.md)\n\nMore.\n')
  expect(disk.get('/vault/alpha.md')).toBe('# Alpha\n\n[B](./beta.md)\n\n')
})
