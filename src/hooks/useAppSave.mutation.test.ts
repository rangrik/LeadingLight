import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { SetStateAction } from 'react'
import { invoke, type InvokeArgs } from '@tauri-apps/api/core'
import { useAppSave } from './useAppSave'
import { AUTO_SAVE_DEBOUNCE_MS, UnmergedDraftError } from './useEditorSave'
import { favoriteMutation, patchFavoriteKeys, type FavoriteState } from '../leadinglight/favoriteTransaction'
import { propertyChange } from './frontmatterOps'
import type { VaultEntry } from '../types'

vi.mock('react', async (importOriginal) => ({ ...await importOriginal<typeof import('react')>(), startTransition: (run: () => void) => run() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({ isTauri: () => true, mockInvoke: vi.fn(), updateMockContent: vi.fn() }))

const ON: FavoriteState = { favorite: true, favoriteIndex: 1 }
const KEYS = '_favorite: true\n_favorite_index: 1\n'
const UNMERGED = "Can't save yet. Fix the page's properties first. Your edits are kept."

interface Gate { promise: Promise<void>; open: () => void }
function gate(): Gate {
  let open!: () => void
  return { promise: new Promise<void>(resolve => { open = resolve }), open }
}

const disk = new Map<string, string>()
let log: string[] = []
let gates: { favorite: Gate; save: Gate | null; rename: Gate | null; renameTo: string; property: Gate | null; manual: Gate | null }
let failing: string | null = null
const BUSY = 'This page is busy. Try again in a moment.'

function installNative() {
  vi.mocked(invoke).mockImplementation(async (cmd: string, raw?: InvokeArgs) => {
    const args = (raw ?? {}) as { path: string; content: string; favorite: boolean; favoriteIndex: number | null; args?: { notePath: string } }
    if (cmd === failing) throw new Error(`${cmd} failed`)
    if (cmd === 'save_note_content') {
      await gates.save?.promise
      disk.set(args.path, args.content)
      log.push(`save:${args.path}:${args.content}`)
      return null
    }
    if (cmd === 'set_note_favorite') {
      log.push(`favorite:${args.path}`)
      await gates.favorite.promise
      const before = disk.get(args.path) ?? ''
      const after = patchFavoriteKeys(before, ON) ?? before
      disk.set(args.path, after)
      return { status: 'committed', content: after, written: after !== before, durable: true }
    }
    if (cmd === 'update_frontmatter') {
      log.push(`property:${args.path}`)
      // Like the native command: read the file, then write the whole of it back later.
      const after = (disk.get(args.path) ?? '').replace('\n---\n', '\nstatus: done\n---\n')
      await gates.property?.promise
      disk.set(args.path, after)
      return after
    }
    if (cmd === 'auto_rename_untitled') {
      log.push('rename')
      await gates.rename?.promise
      const from = args.args?.notePath ?? ''
      disk.set(gates.renameTo, disk.get(from) ?? '')
      disk.delete(from)
      return { new_path: gates.renameTo, updated_files: 0 }
    }
    if (cmd === 'reload_vault_entry') return { path: args.path, title: 'Fresh Title', filename: 'fresh-title.md' }
    if (cmd === 'get_note_content') return disk.get(args.path) ?? ''
    return null
  })
}

type RenameFilename = (path: string, stem: string, vaultPath: string, replace: (oldPath: string, entry: { path: string }, content: string) => void) => Promise<void>

/** Like the native rename: reads the page, waits, then publishes those bytes at the new path. */
const nativeRename: RenameFilename = async (path, stem, _vaultPath, replace) => {
  const staged = disk.get(path) ?? ''
  log.push(`stage:${path}:${staged}`)
  await gates.manual?.promise
  if (failing === 'rename_note_filename') throw new Error('rename failed')
  const next = `/vault/${stem}.md`
  disk.delete(path)
  disk.set(next, staged)
  replace(path, { path: next }, staged)
}

function setup(path: string, content: string, options: { unsaved?: boolean; disk?: string; flushEditorBuffers?: (path: string) => void; renameFilename?: RenameFilename } = {}) {
  disk.set(path, options.disk ?? content)
  let tabs = [{ entry: { path, title: 'Plan', filename: path.split('/').pop() } as VaultEntry, content }]
  const setToastMessage = vi.fn()
  const handleRenameFilename = vi.fn(options.renameFilename ?? (async () => { log.push('manual-rename'); await gates.manual?.promise }))
  const handleRenameNote = vi.fn().mockResolvedValue(undefined)
  const hook = renderHook(() => useAppSave({
    updateEntry: vi.fn(),
    setTabs: (update: SetStateAction<typeof tabs>) => { tabs = typeof update === 'function' ? update(tabs) : update },
    handleSwitchTab: vi.fn(),
    setToastMessage,
    loadModifiedFiles: vi.fn(),
    clearUnsaved: vi.fn(),
    unsavedPaths: new Set(options.unsaved ? [path] : []),
    tabs,
    activeTabPath: path,
    handleRenameNote,
    handleRenameFilename,
    replaceEntry: vi.fn(),
    resolvedPath: '/vault',
    initialH1AutoRenameEnabled: true,
    pageBusyMessage: BUSY,
    flushEditorBuffers: options.flushEditorBuffers,
  }))
  return { app: hook.result, setToastMessage, handleRenameFilename, handleRenameNote, tab: () => tabs[0].content }
}

/** What an Inspector edit does: the real property change, admitted under the page claim. */
async function writeStatus(app: ReturnType<typeof setup>['app'], path: string): Promise<string> {
  let outcome = 'not started'
  await app.current.runPageExclusive(path, async mutate => {
    const admission = mutate(path, propertyChange('update', 'status', 'done'))
    outcome = admission.admitted ? (await admission.done).kind : admission.reason
    return true
  })
  return outcome
}

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

function admit(app: ReturnType<typeof setup>['app'], path: string) {
  const admission = app.current.mutateExistingDocument(path, favoriteMutation(ON))
  if (!admission.admitted) throw new Error(`refused: ${admission.reason}`)
  return admission.done
}

beforeEach(() => {
  vi.useFakeTimers()
  disk.clear()
  log = []
  gates = { favorite: gate(), save: null, rename: null, renameTo: '/vault/fresh-title.md', property: null, manual: null }
  failing = null
  installNative()
})
afterEach(() => { vi.useRealTimers() })

describe('the Favorite seam in the app save coordinator', () => {
  const page = '/vault/plan.md'

  it('makes Trash wait for a change admitted earlier, even before it starts, then move text with the keys (T1)', async () => {
    const { app } = setup(page, '---\ntitle: Plan\n---\nbody')
    gates.save = gate()
    act(() => { app.current.handleContentChange(page, '---\ntitle: Plan\n---\nfirst words') })
    await wait(AUTO_SAVE_DEBOUNCE_MS + 10)
    const done = admit(app, page)
    let moved: string | null = null
    act(() => { app.current.holdWrites([page]) })
    void app.current.prepareForTrash(page).then(path => { moved = path })
    await act(async () => { gates.save?.open() })
    await settle()
    act(() => { app.current.handleContentChange(page, '---\ntitle: Plan\n---\nlast words') })
    expect(moved).toBeNull()

    await act(async () => { gates.favorite.open() })
    await done
    await settle()

    expect(moved).toBe(page)
    expect(log).toEqual([
      `save:${page}:---\ntitle: Plan\n---\nfirst words`,
      `favorite:${page}`,
      `save:${page}:---\ntitle: Plan\n${KEYS}---\nlast words`,
    ])
  })

  it('holds back a scheduled automatic rename during the change and runs it once afterwards (T2)', async () => {
    const untitled = '/vault/untitled-note-123.md'
    const { app } = setup(untitled, '# Fresh Title\n\nBody')
    act(() => { app.current.handleContentChange(untitled, '# Fresh Title\n\nBody') })
    await wait(AUTO_SAVE_DEBOUNCE_MS + 10)
    const done = admit(app, untitled)
    await wait(3_000)
    expect(log).not.toContain('rename')

    await act(async () => { gates.favorite.open() })
    await done
    await wait(2_600)

    expect(log.filter(entry => entry === 'rename')).toHaveLength(1)
    expect(log.indexOf('rename')).toBeGreaterThan(log.indexOf(`favorite:${untitled}`))
    expect(disk.get('/vault/fresh-title.md')).toBe(`---\n${KEYS}---\n# Fresh Title\n\nBody`)
  })

  it('waits for an automatic rename already running and changes the renamed file (T2)', async () => {
    const untitled = '/vault/untitled-note-123.md'
    const { app } = setup(untitled, '# Fresh Title\n\nBody')
    act(() => { app.current.handleContentChange(untitled, '# Fresh Title\n\nBody') })
    await wait(AUTO_SAVE_DEBOUNCE_MS + 10)
    gates.rename = gate()
    await wait(2_600)
    expect(log.at(-1)).toBe('rename')

    const done = admit(app, untitled)
    await settle()
    expect(log).not.toContain(`favorite:${untitled}`)
    await act(async () => { gates.rename?.open() })
    await act(async () => { gates.favorite.open() })

    expect(await done).toMatchObject({ kind: 'returned', path: '/vault/fresh-title.md' })
    expect(disk.get('/vault/fresh-title.md')).toBe(`---\n${KEYS}---\n# Fresh Title\n\nBody`)
    expect(log.filter(entry => entry === 'rename')).toHaveLength(1)
  })

  it('lets rename, Trash preparation and Save finish after the change, and refuses a change during a rename (T7)', async () => {
    const { app } = setup(page, 'body')
    const done = admit(app, page)
    await settle()
    const results: string[] = []
    const track = (name: string, work: Promise<unknown>) => { void work.then(() => results.push(name)) }
    track('rename', app.current.handleFilenameRename(page, 'renamed'))
    track('trash', app.current.prepareForTrash(page))
    track('save', app.current.handleSave())
    expect(app.current.mutateExistingDocument(page, favoriteMutation(ON))).toEqual({ admitted: false, reason: 'renaming' })
    await settle()
    expect(log).not.toContain('manual-rename')

    await act(async () => { gates.favorite.open() })
    await done
    await wait(10)

    expect(results.sort()).toEqual(['rename', 'save', 'trash'])
    expect(log.indexOf('manual-rename')).toBeGreaterThan(log.indexOf(`favorite:${page}`))
  })

  it('sends unsaved tab text through the queue, so the change starts after that write (T8)', async () => {
    const { app } = setup(page, 'unsaved words', { unsaved: true, disk: 'old words' })
    gates.save = gate()
    const flushed = app.current.flushBeforeAction(page)
    await settle()
    const done = admit(app, page)
    await settle()
    expect(log).toEqual([])

    await act(async () => { gates.save?.open() })
    await flushed
    await act(async () => { gates.favorite.open() })
    await done

    expect(log).toEqual([`save:${page}:unsaved words`, `favorite:${page}`])
    expect(disk.get(page)).toBe(`---\n${KEYS}---\nunsaved words`)
  })

  it('refuses explicit saving, navigation and rename of an unmerged draft visibly and at once', async () => {
    const { app, setToastMessage, handleRenameFilename } = setup(page, '---\ntitle: Plan\n---\nbody')
    const done = admit(app, page)
    await settle()
    act(() => { app.current.handleContentChange(page, '---\ntitle: Plan\nbroken body') })
    await act(async () => { gates.favorite.open() })
    expect(await done).toMatchObject({ integration: 'unmergedDraft' })

    await expect(app.current.flushBeforeAction(page)).rejects.toBeInstanceOf(UnmergedDraftError)
    expect(setToastMessage).toHaveBeenLastCalledWith(UNMERGED)
    setToastMessage.mockClear()
    await expect(app.current.handleFilenameRename(page, 'other')).rejects.toBeInstanceOf(UnmergedDraftError)
    expect(setToastMessage).toHaveBeenLastCalledWith(UNMERGED)
    await expect(app.current.prepareForTrash(page)).rejects.toBeInstanceOf(UnmergedDraftError)
    expect(handleRenameFilename).not.toHaveBeenCalled()
    expect(disk.get(page)).toBe(`---\ntitle: Plan\n${KEYS}---\nbody`)
  })

  it('refuses a Favorite while an older property write runs, then keeps the property, keys and body (L3)', async () => {
    const { app } = setup(page, '---\ntitle: Plan\n---\nold body')
    act(() => { app.current.handleContentChange(page, '---\ntitle: Plan\n---\nnew body') })
    gates.property = gate()
    const written = writeStatus(app, page)
    expect(app.current.mutateExistingDocument(page, favoriteMutation(ON))).toEqual({ admitted: false, reason: 'busy' })

    await act(async () => { gates.property?.open() })
    expect(await written).toBe('returned')
    const done = admit(app, page)
    await act(async () => { gates.favorite.open() })
    await done

    expect(disk.get(page)).toBe(`---\ntitle: Plan\nstatus: done\n${KEYS}---\nnew body`)
  })

  it('makes a property write wait for an earlier Favorite, then keeps the keys, property and body (L3)', async () => {
    const { app } = setup(page, '---\ntitle: Plan\n---\nold body')
    act(() => { app.current.handleContentChange(page, '---\ntitle: Plan\n---\nnew body') })
    const done = admit(app, page)
    const written = writeStatus(app, page)
    await settle()
    expect(log).toEqual([`save:${page}:---\ntitle: Plan\n---\nnew body`, `favorite:${page}`])

    await act(async () => { gates.favorite.open() })
    await done
    expect(await written).toBe('returned')

    expect(disk.get(page)).toBe(`---\ntitle: Plan\n${KEYS}status: done\n---\nnew body`)
  })

  it.each(['autosave', 'Cmd+S'])('holds a %s typed after the native read until the write ends, then saves body and property (L3)', async (how) => {
    const { app, tab } = setup(page, '---\ntitle: Plan\n---\nold body')
    act(() => { app.current.handleContentChange(page, '---\ntitle: Plan\n---\nnew body') })
    gates.property = gate()
    const written = writeStatus(app, page)
    await settle()
    expect(log).toEqual([`save:${page}:---\ntitle: Plan\n---\nnew body`, `property:${page}`])

    act(() => { app.current.handleContentChange(page, '---\ntitle: Plan\n---\nnewer body') })
    const saved = how === 'Cmd+S' ? app.current.handleSave() : null
    await wait(AUTO_SAVE_DEBOUNCE_MS + 10)
    expect(log).toHaveLength(2)

    await act(async () => { gates.property?.open() })
    expect(await written).toBe('returned')
    await saved
    await settle()
    const final = '---\ntitle: Plan\nstatus: done\n---\nnewer body'
    expect(log.slice(2)).toEqual([`save:${page}:${final}`])
    expect(disk.get(page)).toBe(final)
    expect(tab()).toBe(final)
  })

  it('starts the property write only after a slow earlier save ends (L3)', async () => {
    const { app } = setup(page, '---\ntitle: Plan\n---\nold body')
    gates.save = gate()
    act(() => { app.current.handleContentChange(page, '---\ntitle: Plan\n---\nnew body') })
    await wait(AUTO_SAVE_DEBOUNCE_MS + 10)
    const written = writeStatus(app, page)
    await settle()
    expect(log).toEqual([])

    await act(async () => { gates.save?.open() })
    expect(await written).toBe('returned')
    expect(log).toEqual([`save:${page}:---\ntitle: Plan\n---\nnew body`, `property:${page}`])
    expect(disk.get(page)).toBe('---\ntitle: Plan\nstatus: done\n---\nnew body')
  })

  it('carries the property into editor text that had not reached the save queue (L3)', async () => {
    let buffer: string | null = null
    const { app } = setup(page, '---\ntitle: Plan\n---\nbody', {
      flushEditorBuffers: path => { if (buffer) app.current.handleContentChange(path, buffer); buffer = null },
    })
    gates.property = gate()
    const written = writeStatus(app, page)
    await settle()
    buffer = '---\ntitle: Plan\n---\ntyped in the editor'

    await act(async () => { gates.property?.open() })
    expect(await written).toBe('returned')
    await act(async () => { await app.current.handleSave() })
    expect(disk.get(page)).toBe('---\ntitle: Plan\nstatus: done\n---\ntyped in the editor')
  })

  it('keeps invalid page properties exactly and unsaved until fixed, without calling the write failed (L3)', async () => {
    const { app, setToastMessage, tab } = setup(page, '---\ntitle: Plan\n---\nbody')
    const invalid = '---\ntitle: [oops\n---\nbody'
    act(() => { app.current.handleContentChange(page, invalid) })
    expect(await writeStatus(app, page)).toBe('invalidFrontmatter')
    act(() => { app.current.handleContentChange(page, '---\ntitle: Plan\n---\nbody') })
    await act(async () => { await app.current.flushBeforeAction(page) })

    gates.property = gate()
    const written = writeStatus(app, page)
    await settle()
    act(() => { app.current.handleContentChange(page, invalid) })
    await act(async () => { gates.property?.open() })
    expect(await written).toBe('returned')
    expect(tab()).toBe(invalid)
    await expect(app.current.flushBeforeAction(page)).rejects.toBeInstanceOf(UnmergedDraftError)
    expect(setToastMessage).toHaveBeenLastCalledWith(UNMERGED)
    expect(disk.get(page)).toBe('---\ntitle: Plan\nstatus: done\n---\nbody')

    act(() => { app.current.handleContentChange(page, '---\ntitle: Fixed\n---\nbody') })
    await act(async () => { await app.current.flushBeforeAction(page) })
    expect(disk.get(page)).toBe('---\ntitle: Fixed\nstatus: done\n---\nbody')
  })

  it.each([
    ['the save before it fails', 'save_note_content', 'notRun'],
    ['the native write rejects', 'update_frontmatter', 'unknown'],
  ])('lets the page go when %s (L3)', async (_case, command, kind) => {
    const { app } = setup(page, '---\ntitle: Plan\n---\nbody')
    act(() => { app.current.handleContentChange(page, '---\ntitle: Plan\n---\nnew body') })
    failing = command
    expect(await writeStatus(app, page)).toBe(kind)
    expect(app.current.mutateExistingDocument(page, favoriteMutation(ON)).admitted).toBe(true)
  })

  it('makes a folder move wait for a manual rename that is already running (L2)', async () => {
    const { app } = setup(page, 'body')
    gates.manual = gate()
    const renamed = app.current.handleFilenameRename(page, 'renamed')
    const reopen = app.current.holdManualRenameAdmission()
    let idle = false
    void app.current.whenManualRenamesIdle().then(() => { idle = true })
    await settle()
    expect(log).toEqual(['manual-rename'])
    expect(idle).toBe(false)

    await act(async () => { gates.manual?.open() })
    await renamed
    await settle()
    expect(idle).toBe(true)
    reopen()
  })

  it('refuses filename and title renames and property writes while a folder move holds them (L2)', async () => {
    const { app, setToastMessage, handleRenameFilename, handleRenameNote } = setup(page, 'body')
    const reopenRenames = app.current.holdManualRenameAdmission()
    const reopenChanges = app.current.holdMutationAdmission()
    const work = vi.fn(async () => true)

    await app.current.handleFilenameRename(page, 'renamed')
    act(() => { app.current.handleTitleSync(page, 'New title') })
    expect(await app.current.runPageExclusive(page, work)).toBe(false)
    await settle()

    expect(handleRenameFilename).not.toHaveBeenCalled()
    expect(handleRenameNote).not.toHaveBeenCalled()
    expect(work).not.toHaveBeenCalled()
    expect(setToastMessage.mock.calls).toEqual([[BUSY], [BUSY], [BUSY]])
    reopenRenames()
    reopenRenames()
    reopenChanges()
    await app.current.handleFilenameRename(page, 'renamed')
    expect(handleRenameFilename).toHaveBeenCalledTimes(1)
  })
  it.each(['autosave', 'Cmd+S'])('holds a %s typed while a manual rename stages the page, then writes it only at the new path (B1)', async (how) => {
    const { app } = setup(page, 'B0', { renameFilename: nativeRename })
    gates.manual = gate()
    const renamed = app.current.handleFilenameRename(page, 'renamed')
    await settle()
    act(() => { app.current.handleContentChange(page, 'B1') })
    const saved = how === 'Cmd+S' ? app.current.handleSave() : null
    await wait(AUTO_SAVE_DEBOUNCE_MS + 10)
    expect(log).toEqual([`stage:${page}:B0`])

    await act(async () => { gates.manual?.open() })
    await renamed
    await saved
    await wait(AUTO_SAVE_DEBOUNCE_MS + 10)
    expect(log.slice(1)).toEqual(['save:/vault/renamed.md:B1'])
    expect(disk.has(page)).toBe(false)
  })

  it('holds text the same way for a title follow-up that drains inside the barrier, without waiting on itself (B1)', async () => {
    const { app } = setup(page, 'B0')
    gates.manual = gate()
    const renamed = app.current.withManualRename(page, async () => {
      await app.current.flushBeforeAction(page)
      await nativeRename(page, 'titled', '/vault', (oldPath, entry) => app.current.trackRenamedPath(oldPath, entry.path))
    })
    await settle()
    act(() => { app.current.handleContentChange(page, 'B1') })
    await wait(AUTO_SAVE_DEBOUNCE_MS + 10)
    expect(log).toEqual([`stage:${page}:B0`])

    await act(async () => { gates.manual?.open() })
    await renamed
    await wait(AUTO_SAVE_DEBOUNCE_MS + 10)
    expect(log.slice(1)).toEqual(['save:/vault/titled.md:B1'])
  })

  it('writes editor text that had not reached the queue before the rename reads the page (B1)', async () => {
    let buffer: string | null = 'typed in the editor'
    const { app } = setup(page, 'B0', {
      renameFilename: nativeRename,
      flushEditorBuffers: path => { if (buffer) app.current.handleContentChange(path, buffer); buffer = null },
    })
    await act(async () => { await app.current.handleFilenameRename(page, 'renamed') })
    expect(log).toEqual([`save:${page}:typed in the editor`, `stage:${page}:typed in the editor`])
    expect(disk.get('/vault/renamed.md')).toBe('typed in the editor')
  })

  it('keeps the newest text at the old path and lets writes go when the native rename fails (B1)', async () => {
    const { app } = setup(page, 'B0', { renameFilename: nativeRename })
    gates.manual = gate()
    failing = 'rename_note_filename'
    const failed = expect(app.current.handleFilenameRename(page, 'renamed')).rejects.toThrow('rename failed')
    await settle()
    act(() => { app.current.handleContentChange(page, 'B1') })
    await act(async () => { gates.manual?.open() })
    await failed

    await wait(AUTO_SAVE_DEBOUNCE_MS + 10)
    expect(disk.get(page)).toBe('B1')
    expect(disk.has('/vault/renamed.md')).toBe(false)
  })
})
