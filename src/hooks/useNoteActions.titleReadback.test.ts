import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useAppSave } from './useAppSave'
import { AUTO_SAVE_DEBOUNCE_MS } from './useEditorSave'
import { useNoteActions } from './useNoteActions'
import type { VaultEntry } from '../types'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({ isTauri: () => true, mockInvoke: vi.fn(), updateMockContent: vi.fn(), addMockEntry: vi.fn(), trackMockChange: vi.fn() }))

// Seam: the Inspector title rename reading the page back. Catches the read-back hiding text typed during the rename.
const PAGE = '/vault/plan.md'
const RENAMED = '/vault/new-name.md'
const disk = new Map<string, string>()
let renameGate: { promise: Promise<void>; open: () => void }
let readFails: boolean

beforeEach(() => {
  vi.useFakeTimers()
  disk.clear()
  disk.set(PAGE, '---\ntitle: Plan\n---\n# Plan\n\nbody')
  let open!: () => void
  renameGate = { promise: new Promise<void>(resolve => { open = resolve }), open }
  readFails = false
  vi.mocked(invoke).mockImplementation(async (cmd: string, raw?: unknown) => {
    const args = (raw ?? {}) as { path: string; content: string; key: string; value: string }
    if (cmd === 'save_note_content') return void disk.set(args.path, args.content)
    if (cmd === 'get_note_content') {
      if (readFails && args.path === RENAMED) throw new Error('unreadable')
      return disk.get(args.path) ?? ''
    }
    if (cmd === 'update_frontmatter') {
      const after = (disk.get(args.path) ?? '').replace(/^title: .*$/m, `title: ${args.value}`)
      disk.set(args.path, after)
      return after
    }
    if (cmd !== 'rename_note') return null
    // Like the native rename: the page is read first, then published at the new path with its title line.
    const { oldPath, newTitle } = (raw as { args: { oldPath: string; newTitle: string } }).args
    const staged = disk.get(oldPath) ?? ''
    await renameGate.promise
    disk.delete(oldPath)
    disk.set(RENAMED, staged.replace(/^# .*$/m, `# ${newTitle}`))
    return { new_path: RENAMED, updated_files: 0, failed_updates: 0 }
  })
})
afterEach(() => { vi.useRealTimers() })

// Wired like App: the note actions reach the save coordinator through refs.
function setup() {
  const entry = { path: PAGE, filename: 'plan.md', title: 'Plan', isA: 'Note', properties: {} } as unknown as VaultEntry
  const hook = renderHook(() => {
    const appRef = useRef<ReturnType<typeof useAppSave> | null>(null)
    const notes = useNoteActions({
      addEntry: vi.fn(), removeEntry: vi.fn(), entries: [entry], setToastMessage: vi.fn(), updateEntry: vi.fn(), vaultPath: '/vault',
      replaceEntry: vi.fn(),
      onPathRenamed: (from, to) => appRef.current?.trackRenamedPath(from, to),
      flushBeforeNoteMutation: path => appRef.current!.flushBeforeAction(path),
      mutateExistingDocument: (path, mutation) => appRef.current!.mutateExistingDocument(path, mutation),
      runPageExclusive: (path, work) => appRef.current!.runPageExclusive(path, work),
      runManualRename: (path, rename) => appRef.current!.withManualRename(path, rename),
    })
    const app = useAppSave({
      updateEntry: vi.fn(), setTabs: notes.setTabs, handleSwitchTab: notes.handleSwitchTab, setToastMessage: vi.fn(),
      loadModifiedFiles: vi.fn(), clearUnsaved: vi.fn(), unsavedPaths: new Set(), tabs: notes.tabs, activeTabPath: notes.activeTabPath,
      handleRenameNote: vi.fn(), handleRenameFilename: vi.fn(), replaceEntry: vi.fn(), resolvedPath: '/vault',
      initialH1AutoRenameEnabled: false, pageBusyMessage: 'busy',
    })
    appRef.current = app
    return { app, notes }
  })
  return { entry, hook: hook.result }
}

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const tab = (hook: ReturnType<typeof setup>['hook']) => hook.current.notes.tabs.map(t => [t.entry.path, t.content])

it.each([
  ['the page can be read back', false],
  ['the read-back fails', true],
])('keeps text typed during an Inspector title rename at the new path when %s', async (_case, fails) => {
  const { entry, hook } = setup()
  await act(async () => { await hook.current.notes.handleSelectNote(entry) })
  readFails = fails
  let updating!: Promise<unknown>
  act(() => { updating = hook.current.notes.handleUpdateFrontmatter(PAGE, 'title', 'New Name') })
  await settle()
  const typed = '---\ntitle: New Name\n---\n# Plan\n\nbody typed'
  act(() => { hook.current.app.handleContentChange(PAGE, typed) })
  await settle()

  await act(async () => { renameGate.open(); await updating })
  expect(tab(hook)).toEqual([[RENAMED, typed]])

  act(() => { hook.current.app.handleContentChange(RENAMED, `${hook.current.notes.tabs[0].content} more`) })
  await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS + 10) })
  expect(Object.fromEntries(disk)).toEqual({ [RENAMED]: `${typed} more` })
})

it('still shows the title line the rename wrote when nothing was typed meanwhile', async () => {
  const { entry, hook } = setup()
  await act(async () => { await hook.current.notes.handleSelectNote(entry) })
  renameGate.open()
  await act(async () => { await hook.current.notes.handleUpdateFrontmatter(PAGE, 'title', 'New Name') })
  expect(tab(hook)).toEqual([[RENAMED, '---\ntitle: New Name\n---\n# New Name\n\nbody']])
})
