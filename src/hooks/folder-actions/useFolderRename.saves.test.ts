import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { SetStateAction } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useAppSave } from '../useAppSave'
import { AUTO_SAVE_DEBOUNCE_MS } from '../useEditorSave'
import { favoriteMutation, patchFavoriteKeys } from '../../leadinglight/favoriteTransaction'
import type { VaultEntry } from '../../types'
import { useNoteRename } from '../useNoteRename'
import { admitPageMove, holdFolderForMove } from './folderActionUtils'
import { useFolderRename } from './useFolderRename'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../../mock-tauri', () => ({ isTauri: () => true, mockInvoke: vi.fn(), updateMockContent: vi.fn() }))
// The real hash finishes outside fake time, which made save timing depend on the machine.
vi.mock('../../leadinglight/saveOutcome', async importOriginal => ({
  ...await importOriginal<typeof import('../../leadinglight/saveOutcome')>(),
  sha256Hex: async () => 'a'.repeat(64),
}))

// Seam: a folder move against page saves and page renames. Catches writes or renames landing at the old folder after a move.
const ON = { favorite: true, favoriteIndex: 1 } as const
const KEYS = '_favorite: true\n_favorite_index: 1\n'
const OLD = '/vault/projects'
const NEW = '/vault/work'
const BUSY = 'Page busy'
const disk = new Map<string, string>()
let favoriteGate: { promise: Promise<void>; open: () => void }
let renameGate: { promise: Promise<void>; open: () => void } | null
let pageRenameGate: { promise: Promise<void>; open: () => void } | null
let pageMoveGate: { promise: Promise<void>; open: () => void } | null
let renameFails: boolean
let moveFails: boolean
let readFails: boolean
let renames: number
let pageRenames: number
let pageMoves: number

function gate() {
  let open!: () => void
  return { promise: new Promise<void>(resolve => { open = resolve }), open }
}

function installNative() {
  vi.mocked(invoke).mockImplementation(async (cmd: string, raw?: unknown) => {
    const args = (raw ?? {}) as { path: string; content: string; request: { path: string } }
    if (cmd === 'save_page_content') {
      disk.set(args.request.path, args.content)
      return { status: 'committed', written: true, durable: true, history: null }
    }
    if (cmd === 'get_note_content') {
      if (readFails) throw new Error('unreadable')
      return disk.get(args.path) ?? ''
    }
    if (cmd === 'move_note_to_folder') {
      const { oldPath, folderPath, vaultPath } = (raw as { args: { oldPath: string; folderPath: string; vaultPath: string } }).args
      pageMoves += 1
      // Like the native move: the body is read first, then published at the new path after a delay.
      const staged = disk.get(oldPath) ?? ''
      await pageMoveGate?.promise
      if (moveFails) throw new Error('denied')
      const to = `${vaultPath}/${folderPath}/${oldPath.split('/').pop()}`
      disk.delete(oldPath)
      disk.set(to, staged)
      return { new_path: to, updated_files: 0, failed_updates: 0 }
    }
    if (cmd === 'rename_note_filename' || cmd === 'rename_note') {
      const { oldPath, newFilenameStem, newTitle } = (raw as { args: { oldPath: string; newFilenameStem?: string; newTitle?: string } }).args
      const staged = disk.get(oldPath) ?? ''
      await pageRenameGate?.promise
      const stem = newFilenameStem ?? (newTitle ?? '').toLowerCase().replace(/\s+/g, '-')
      const to = `${oldPath.slice(0, oldPath.lastIndexOf('/'))}/${stem}.md`
      disk.delete(oldPath)
      // A title rename also rewrites the page's title line.
      disk.set(to, newTitle ? staged.replace(/^# .*$/m, `# ${newTitle}`) : staged)
      return { new_path: to, updated_files: 0, failed_updates: 0 }
    }
    if (cmd === 'set_note_favorite') {
      await favoriteGate.promise
      const after = patchFavoriteKeys(disk.get(args.path) ?? '', ON) ?? ''
      disk.set(args.path, after)
      return { status: 'committed', content: after, written: true, durable: true }
    }
    if (cmd === 'auto_rename_untitled') {
      const from = (raw as { args: { notePath: string } }).args.notePath
      const to = `${from.slice(0, from.lastIndexOf('/'))}/Plan.md`
      disk.set(to, disk.get(from) ?? '')
      disk.delete(from)
      return { new_path: to, updated_files: 0 }
    }
    if (cmd !== 'rename_vault_folder') return null
    renames += 1
    await renameGate?.promise
    if (renameFails) throw new Error('denied')
    for (const [path, content] of [...disk]) {
      if (!path.startsWith(`${OLD}/`)) continue
      disk.delete(path)
      disk.set(NEW + path.slice(OLD.length), content)
    }
    return { old_path: 'projects', new_path: 'work' }
  })
}

function setup(files: Record<string, string>, reloadVault = vi.fn(async () => [] as VaultEntry[]), autoRename = false) {
  for (const [path, content] of Object.entries(files)) disk.set(path, content)
  let tabs = Object.entries(files).map(([path, content]) => ({ entry: { path, title: 'Page', filename: path.split('/').pop() } as VaultEntry, content }))
  let active = tabs[0].entry.path
  const setTabs = (update: SetStateAction<typeof tabs>) => { tabs = typeof update === 'function' ? update(tabs) : update }
  const setToastMessage = vi.fn()
  // The native page rename, as the note actions run it: the file moves, then the entry and tab follow.
  const handleRenameFilename = async (from: string, stem: string, _vault: string, onRenamed: (old: string, entry: { path: string }, content: string) => void) => {
    pageRenames += 1
    await pageRenameGate?.promise
    const to = `${from.slice(0, from.lastIndexOf('/'))}/${stem}.md`
    const content = disk.get(from) ?? ''
    disk.set(to, content)
    disk.delete(from)
    onRenamed(from, { path: to }, content)
    setTabs(current => current.map(tab => tab.entry.path === from ? { ...tab, entry: { ...tab.entry, path: to } } : tab))
  }
  const hook = renderHook(() => {
    const app = useAppSave({
      updateEntry: vi.fn(), setTabs, handleSwitchTab: vi.fn(), setToastMessage, loadModifiedFiles: vi.fn(),
      clearUnsaved: vi.fn(), unsavedPaths: new Set<string>(), tabs, activeTabPath: active, pageBusyMessage: BUSY,
      handleRenameNote: vi.fn(), handleRenameFilename, replaceEntry: vi.fn(), resolvedPath: '/vault', initialH1AutoRenameEnabled: autoRename,
    })
    const folder = useFolderRename({
      activeTabPathRef: { current: active },
      handleSwitchTab: path => { active = path },
      prepareFolderMove: folderPath => holdFolderForMove(folderPath, {
        // App's order, without Trash: hold both, join running renames, then page changes.
        quiet: async () => {
          const reopenRenames = app.holdManualRenameAdmission()
          const reopenMutations = app.holdMutationAdmission()
          await app.whenManualRenamesIdle().then(app.whenMutationsIdle)
          return () => { reopenMutations(); reopenRenames() }
        },
        pagePaths: () => tabs.map(tab => tab.entry.path),
        holdWrites: app.holdWrites,
        saveHeld: app.prepareForTrash,
        releaseWrites: paths => app.releaseHeldWrites(paths, 'resume'),
        trackRenamedPath: app.trackRenamedPath,
      }),
      reloadFolders: async () => [],
      reloadVault,
      selection: { kind: 'folder', path: 'projects' },
      setSelection: vi.fn(),
      setTabs,
      setToastMessage,
      vaultPath: '/vault',
    })
    // The real page move, through the same admission App uses for sidebar drops and the command.
    const notes = useNoteRename(
      { entries: [], setToastMessage, reloadVault, onPathRenamed: app.trackRenamedPath },
      { tabs, setTabs, activeTabPathRef: { current: active }, handleSwitchTab: path => { active = path }, updateTabContent: vi.fn() },
    )
    const moveToFolder = admitPageMove({
      withManualRename: app.withManualRename,
      holdWrites: app.holdWrites,
      saveHeld: app.prepareForTrash,
      releaseWrites: paths => app.releaseHeldWrites(paths, 'resume'),
    }, notes.handleMoveNoteToFolder)
    return { app, folder, notes, moveToFolder: (path: string, folderPath: string) => moveToFolder(path, folderPath, '/vault', () => {}) }
  })
  return {
    hook: hook.result,
    setToastMessage,
    paths: () => tabs.map(tab => tab.entry.path),
    tabText: () => tabs.map(tab => tab.content),
    // App re-renders on every tab change; this harness's tabs are plain, so it re-renders by hand.
    rerender: () => hook.rerender(),
  }
}

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const waitForAutosave = () => act(async () => { await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS + 10) })

beforeEach(() => {
  vi.useFakeTimers()
  disk.clear()
  favoriteGate = gate()
  renameGate = null
  pageRenameGate = null
  pageMoveGate = null
  renameFails = false
  moveFails = false
  readFails = false
  renames = 0
  pageRenames = 0
  pageMoves = 0
  installNative()
})
afterEach(() => { vi.useRealTimers() })

describe('renaming a folder with pages that have unsaved work', () => {
  it('writes text queued behind a Favorite before the move, so it lands only in the new folder', async () => {
    const page = `${OLD}/plan.md`
    const { hook, paths } = setup({ [page]: '---\ntitle: Plan\n---\nbody' })
    expect(hook.current.app.mutateExistingDocument(page, favoriteMutation(ON)).admitted).toBe(true)
    await settle()
    act(() => { hook.current.app.handleContentChange(page, '---\ntitle: Plan\n---\nnewer') })
    let renamed: Promise<boolean> | undefined
    act(() => { renamed = hook.current.folder.renameFolder('projects', 'work') })
    await act(async () => { favoriteGate.open() })
    await settle()

    expect(await renamed).toBe(true)
    await waitForAutosave()
    expect(Object.fromEntries(disk)).toEqual({ [`${NEW}/plan.md`]: `---\ntitle: Plan\n${KEYS}---\nnewer` })
    expect(paths()).toEqual([`${NEW}/plan.md`])
  })

  it('refuses to move a folder holding an unmerged draft and leaves everything where it was', async () => {
    const page = `${OLD}/plan.md`
    const other = `${OLD}/other.md`
    const { hook, setToastMessage } = setup({ [page]: '---\ntitle: Plan\n---\nbody', [other]: '---\ntitle: Other\n---\n' })
    hook.current.app.mutateExistingDocument(page, favoriteMutation(ON))
    await settle()
    act(() => { hook.current.app.handleContentChange(page, '---\ntitle: Plan\nbroken body') })
    await act(async () => { favoriteGate.open() })

    await act(async () => { expect(await hook.current.folder.renameFolder('projects', 'work')).toBe(false) })
    expect(renames).toBe(0)
    expect(setToastMessage).toHaveBeenLastCalledWith("Can't save yet. Fix the page's properties first. Your edits are kept.")
    expect(disk.get(page)).toBe(`---\ntitle: Plan\n${KEYS}---\nbody`)
    expect(hook.current.app.hasPendingWrite(page)).toBe(true)
    expect(hook.current.app.mutateExistingDocument(other, favoriteMutation(ON)).admitted).toBe(true)
    await act(() => hook.current.app.handleFilenameRename(other, 'renamed'))
    expect(disk.has(`${OLD}/renamed.md`)).toBe(true)
  })

  it('waits for a page rename that started first, then moves the page under its new name', async () => {
    const page = `${OLD}/a.md`
    const { hook, paths } = setup({ [page]: 'a' })
    act(() => { hook.current.app.handleContentChange(page, 'a2') })
    pageRenameGate = gate()
    let pageRenamed: Promise<void> | undefined
    act(() => { pageRenamed = hook.current.app.handleFilenameRename(page, 'b') })
    let renamed: Promise<boolean> | undefined
    act(() => { renamed = hook.current.folder.renameFolder('projects', 'work') })
    await settle()
    expect(renames).toBe(0)

    await act(async () => { pageRenameGate?.open(); await pageRenamed })
    expect(await renamed).toBe(true)
    act(() => { hook.current.app.handleContentChange(page, 'a3') })
    await waitForAutosave()
    expect(Object.fromEntries(disk)).toEqual({ [`${NEW}/b.md`]: 'a3' })
    expect(paths()).toEqual([`${NEW}/b.md`])
  })

  it('refuses a page rename asked for while its folder moves, and allows it once the move is done', async () => {
    const page = `${OLD}/a.md`
    const { hook, setToastMessage } = setup({ [page]: 'a' })
    renameGate = gate()
    let renamed: Promise<boolean> | undefined
    act(() => { renamed = hook.current.folder.renameFolder('projects', 'work') })
    await settle()

    await act(() => hook.current.app.handleFilenameRename(page, 'b'))
    expect(setToastMessage).toHaveBeenLastCalledWith(BUSY)
    expect(pageRenames).toBe(0)
    await act(async () => { renameGate?.open() })
    expect(await renamed).toBe(true)

    await act(() => hook.current.app.handleFilenameRename(`${NEW}/a.md`, 'b'))
    expect(Object.fromEntries(disk)).toEqual({ [`${NEW}/b.md`]: 'a' })
  })

  it('saves both open pages first and keeps an edit typed during the move with its page', async () => {
    const a = `${OLD}/a.md`
    const b = `${OLD}/b.md`
    const { hook, paths } = setup({ [a]: 'a', [b]: 'b' })
    act(() => {
      hook.current.app.handleContentChange(a, 'a2')
      hook.current.app.handleContentChange(b, 'b2')
    })
    renameGate = gate()
    let renamed: Promise<boolean> | undefined
    act(() => { renamed = hook.current.folder.renameFolder('projects', 'work') })
    await settle()
    expect(Object.fromEntries(disk)).toEqual({ [a]: 'a2', [b]: 'b2' })

    act(() => { hook.current.app.handleContentChange(b, 'b3') })
    await waitForAutosave()
    expect(disk.get(b)).toBe('b2')
    await act(async () => { renameGate?.open() })
    expect(await renamed).toBe(true)
    await waitForAutosave()
    expect(Object.fromEntries(disk)).toEqual({ [`${NEW}/a.md`]: 'a2', [`${NEW}/b.md`]: 'b3' })
    expect(paths()).toEqual([`${NEW}/a.md`, `${NEW}/b.md`])
  })

  it('moves a page renamed from its heading during preparation, and writes via either name land in it', async () => {
    const untitled = `${OLD}/untitled-note-123.md`
    const { hook, paths } = setup({ [untitled]: '# Plan\n\nbody' }, undefined, true)
    act(() => { hook.current.app.handleContentChange(untitled, '# Plan\n\nnewer') })

    await act(async () => { expect(await hook.current.folder.renameFolder('projects', 'work')).toBe(true) })
    expect(Object.fromEntries(disk)).toEqual({ [`${NEW}/Plan.md`]: '# Plan\n\nnewer' })
    act(() => { hook.current.app.handleContentChange(untitled, '# Plan\n\nvia old name') })
    await waitForAutosave()
    act(() => { hook.current.app.handleContentChange(`${OLD}/Plan.md`, '# Plan\n\nvia settled name') })
    await waitForAutosave()
    expect(Object.fromEntries(disk)).toEqual({ [`${NEW}/Plan.md`]: '# Plan\n\nvia settled name' })
    expect(paths()).toEqual([`${NEW}/Plan.md`])
  })

  it('keeps writes following the moved folder when the page list fails to reload', async () => {
    const page = `${OLD}/plan.md`
    const { hook, setToastMessage, paths } = setup({ [page]: 'body' }, vi.fn(async () => { throw new Error('offline') }))

    await act(async () => { expect(await hook.current.folder.renameFolder('projects', 'work')).toBe(true) })
    expect(setToastMessage).toHaveBeenLastCalledWith(expect.stringContaining('couldn’t refresh'))
    act(() => { hook.current.app.handleContentChange(page, 'after') })
    await waitForAutosave()
    expect(Object.fromEntries(disk)).toEqual({ [`${NEW}/plan.md`]: 'after' })
    expect(paths()).toEqual([`${NEW}/plan.md`])
  })

  it('keeps pages and an edit typed meanwhile in place when the move fails', async () => {
    const page = `${OLD}/plan.md`
    renameFails = true
    renameGate = gate()
    const { hook, setToastMessage, paths } = setup({ [page]: 'body' })
    let renamed: Promise<boolean> | undefined
    act(() => { renamed = hook.current.folder.renameFolder('projects', 'work') })
    await settle()
    act(() => { hook.current.app.handleContentChange(page, 'typed meanwhile') })
    await act(async () => { renameGate?.open() })

    expect(await renamed).toBe(false)
    expect(setToastMessage).toHaveBeenLastCalledWith('Failed to rename folder: Error: denied')
    await waitForAutosave()
    expect(Object.fromEntries(disk)).toEqual({ [page]: 'typed meanwhile' })
    expect(paths()).toEqual([page])
  })
})

describe('moving a page into or out of a folder that is moving', () => {
  const INBOX = '/vault/inbox'

  it('refuses a page move asked for while its folder moves', async () => {
    const page = `${OLD}/a.md`
    const { hook, setToastMessage } = setup({ [page]: 'a' })
    renameGate = gate()
    let renamed: Promise<boolean> | undefined
    act(() => { renamed = hook.current.folder.renameFolder('projects', 'work') })
    await settle()

    await act(async () => { expect(await hook.current.moveToFolder(page, 'inbox')).toBeNull() })
    expect(setToastMessage).toHaveBeenLastCalledWith(BUSY)
    expect(pageMoves).toBe(0)
    await act(async () => { renameGate?.open() })
    expect(await renamed).toBe(true)
    expect(Object.fromEntries(disk)).toEqual({ [`${NEW}/a.md`]: 'a' })
  })

  it('waits for a page moving out that started first, and the page and later edits stay out', async () => {
    const page = `${OLD}/a.md`
    const { hook, paths } = setup({ [page]: 'a' })
    pageMoveGate = gate()
    let moving: Promise<unknown> | undefined
    act(() => { moving = hook.current.moveToFolder(page, 'inbox') })
    let renamed: Promise<boolean> | undefined
    act(() => { renamed = hook.current.folder.renameFolder('projects', 'work') })
    await settle()
    expect(renames).toBe(0)

    await act(async () => { pageMoveGate?.open(); await moving })
    expect(await renamed).toBe(true)
    act(() => { hook.current.app.handleContentChange(page, 'late') })
    await waitForAutosave()
    expect(Object.fromEntries(disk)).toEqual({ [`${INBOX}/a.md`]: 'late' })
    expect(paths()).toEqual([`${INBOX}/a.md`])
  })

  it('waits for a page moving in that started first, then takes it and its newest text along', async () => {
    const page = `${INBOX}/c.md`
    const { hook, paths } = setup({ [page]: 'c' })
    act(() => { hook.current.app.handleContentChange(page, 'c1') })
    pageMoveGate = gate()
    let moving: Promise<unknown> | undefined
    act(() => { moving = hook.current.moveToFolder(page, 'projects') })
    await settle()
    act(() => { hook.current.app.handleContentChange(page, 'c2') })
    let renamed: Promise<boolean> | undefined
    act(() => { renamed = hook.current.folder.renameFolder('projects', 'work') })
    await waitForAutosave()
    expect(renames).toBe(0)
    expect(Object.fromEntries(disk)).toEqual({ [page]: 'c1' })

    await act(async () => { pageMoveGate?.open(); await moving })
    expect(await renamed).toBe(true)
    act(() => { hook.current.app.handleContentChange(page, 'c3') })
    await waitForAutosave()
    expect(Object.fromEntries(disk)).toEqual({ [`${NEW}/c.md`]: 'c3' })
    expect(paths()).toEqual([`${NEW}/c.md`])
  })

  it('keeps a page move that happened when the page cannot be read back, and later writes follow it', async () => {
    const page = `${INBOX}/c.md`
    const { hook, setToastMessage, paths } = setup({ [page]: 'c' })
    readFails = true
    await act(async () => { expect(await hook.current.moveToFolder(page, 'projects')).toEqual(expect.objectContaining({ new_path: `${OLD}/c.md` })) })
    expect(setToastMessage).toHaveBeenLastCalledWith(expect.stringContaining('couldn’t be reloaded'))
    expect(paths()).toEqual([`${OLD}/c.md`])

    readFails = false
    await act(async () => { expect(await hook.current.folder.renameFolder('projects', 'work')).toBe(true) })
    act(() => { hook.current.app.handleContentChange(page, 'late') })
    await waitForAutosave()
    expect(Object.fromEntries(disk)).toEqual({ [`${NEW}/c.md`]: 'late' })
  })

  it('leaves the page and later writes where they were when the native move fails', async () => {
    const page = `${OLD}/a.md`
    const { hook, paths } = setup({ [page]: 'a' })
    moveFails = true
    await act(async () => { expect(await hook.current.moveToFolder(page, 'inbox')).toBeNull() })
    act(() => { hook.current.app.handleContentChange(page, 'after') })
    await waitForAutosave()
    expect(Object.fromEntries(disk)).toEqual({ [page]: 'after' })
    expect(paths()).toEqual([page])
  })
})

// Seam: the copy read back after a move or rename against text typed meanwhile. Catches that text replaced by the older copy.
describe('reading a page back after it moves or is renamed', () => {
  it('keeps text typed while a page moves, and later typing builds on it', async () => {
    const page = '/vault/inbox/c.md'
    const moved = `${OLD}/c.md`
    const { hook, rerender, tabText } = setup({ [page]: 'c' })
    act(() => { hook.current.app.handleContentChange(page, 'c1') })
    rerender()
    pageMoveGate = gate()
    let moving: Promise<unknown> | undefined
    act(() => { moving = hook.current.moveToFolder(page, 'projects') })
    await settle()
    act(() => { hook.current.app.handleContentChange(page, 'c1 c2') })
    rerender()
    await act(async () => { pageMoveGate?.open(); await moving })

    expect(tabText()).toEqual(['c1 c2'])
    act(() => { hook.current.app.handleContentChange(moved, `${tabText()[0]} c3`) })
    await waitForAutosave()
    expect(Object.fromEntries(disk)).toEqual({ [moved]: 'c1 c2 c3' })
  })

  it('keeps text typed while a page is renamed, and later typing builds on it', async () => {
    const page = `${OLD}/a.md`
    const renamed = `${OLD}/b.md`
    const { hook, rerender, tabText } = setup({ [page]: 'a' })
    pageRenameGate = gate()
    let renaming: Promise<void> | undefined
    act(() => { renaming = hook.current.notes.handleRenameFilename(page, 'b', '/vault', () => {}) })
    await settle()
    act(() => { hook.current.app.handleContentChange(page, 'a a2') })
    rerender()
    await act(async () => { pageRenameGate?.open(); await renaming })

    expect(tabText()).toEqual(['a a2'])
    act(() => { hook.current.app.handleContentChange(renamed, `${tabText()[0]} a3`) })
    await waitForAutosave()
    expect(Object.fromEntries(disk)).toEqual({ [renamed]: 'a a2 a3' })
  })

  it('still shows the title a rename wrote when nothing was typed meanwhile', async () => {
    const page = `${OLD}/a.md`
    const { hook, tabText } = setup({ [page]: '# Old\n\nbody' })
    await act(() => hook.current.notes.handleRenameNote(page, 'New Title', '/vault', () => {}))
    expect(tabText()).toEqual(['# New Title\n\nbody'])
  })
})
