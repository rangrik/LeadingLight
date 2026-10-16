import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorSave, AUTO_SAVE_DEBOUNCE_MS } from '../../hooks/useEditorSave'
import { useNoteRetargetingUi } from '../../hooks/useNoteRetargetingUi'
import { makeEntry } from '../../test-utils/noteListTestUtils'
import { backupInputHeld } from '../backup/backupInputGate'
import { trackEditorWork } from '../editorWork'
import type { SplitWorkspaceController } from '../useSplitWorkspace'
import { usePageRelocation } from './usePageRelocation'
import type { RelocationPage } from './relocatePage'

const native = vi.hoisted(() => ({ move: vi.fn(), read: vi.fn(), save: vi.fn() }))
vi.mock('../../hooks/useNoteRename', async importOriginal => ({
  ...await importOriginal<typeof import('../../hooks/useNoteRename')>(),
  performFolderRelocation: native.move,
  loadNoteContent: native.read,
}))
vi.mock('../../mock-tauri', () => ({
  isTauri: () => false, updateMockContent: vi.fn(),
  mockInvoke: (command: string, args?: Record<string, unknown>) => native.save(command, args),
}))

const path = '/vault/drafts/page.md'
const incoming = '/vault/incoming.md'
const queued = '/vault/queued.md'
const destination = '/vault/filed/page.md'
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function fixture() {
  const entries = [path, incoming, queued].map(item => makeEntry({ path: item, filename: item.split('/').at(-1), fileKind: 'markdown' }))
  let tabs: RelocationPage[] = entries.slice(0, 2).map(entry => ({ entry, content: `saved ${entry.path}` }))
  let navigationGeneration = 0
  const opened = vi.fn(async () => true)
  const close = vi.fn(() => {
    navigationGeneration += 1
    return { inSession: () => true, isActive: () => true, open: opened }
  })
  const setTabs = vi.fn<Parameters<typeof usePageRelocation>[0]['setTabs']>(next => { tabs = typeof next === 'function' ? next(tabs) : next })
  const workspace: SplitWorkspaceController = {
    activePane: 0, split: true, orientation: 'horizontal', ratio: 50, paths: [path, incoming], order: [0, 1],
    placePane: vi.fn(() => true), placeNote: vi.fn(async () => true),
    editorModes: ['preview', 'raw'], editorModesReady: true, beginEditorModeChange: vi.fn(() => vi.fn(() => true)),
    pendingPanes: [false, false], suspendPersistence: vi.fn(), focusPane: vi.fn(), selectNoteInPane: vi.fn(async () => {}),
    closePane: vi.fn(), openSplit: vi.fn(), resize: vi.fn(), canGoBack: false, canGoForward: false, goBack: vi.fn(), goForward: vi.fn(),
    closePages: vi.fn(), closePageAndReserveOpen: vi.fn(() => null), currentTabs: () => tabs,
    markNavigation: vi.fn(() => {
      const generation = navigationGeneration
      return { pane: 0 as const, current: () => navigationGeneration === generation }
    }), openNoteWhenLoaded: vi.fn(async () => true), readyForVisits: true,
  }
  const structural = { current: { running: null as Promise<boolean> | null, holds: 0 } }
  const options = {
    vaultPath: '/vault', locale: 'en' as const, entries, unsavedPaths: new Set<string>(), workspace,
    structural, settlement: { current: { idle: vi.fn(() => true), close } }, blocked: () => false,
    begin: vi.fn(() => vi.fn()), joinEarlier: vi.fn(async () => {}), assertClear: vi.fn(), flushBuffers: vi.fn(),
    commitSource: vi.fn(), setTabs, refresh: vi.fn(async () => {}), notify: vi.fn(),
  }
  const prepare = vi.fn<(candidate: string) => Promise<string>>()
  const result = renderHook(() => {
    const queue = useEditorSave({ persistenceScope: options.vaultPath, setTabs, updateVaultContent: vi.fn(), setToastMessage: vi.fn() })
    const relocation = usePageRelocation({ ...options, saves: {
      holdWrites: queue.holdAutosave, releaseHeldWrites: queue.releaseAutosave,
      hasPendingWrite: queue.hasPendingWrite, saveRecovery: queue.recovery,
      prepareForTrash: candidate => prepare(candidate),
    } })
    const ui = useNoteRetargetingUi({
      activeEntry: entries[0], activeNoteBlocked: false, entries, folders: [{ name: 'filed', path: 'filed', children: [] }, { name: 'garden', path: 'garden', children: [] }],
      selection: { kind: 'filter', filter: 'all' }, setSelection: vi.fn(), setToastMessage: vi.fn(), vaultPath: options.vaultPath,
      updateFrontmatter: vi.fn(), moveNoteToFolder: relocation.move, captureFolderContext: relocation.captureContext,
    })
    return { relocation, queue, ui }
  })
  prepare.mockImplementation(async candidate => { await result.result.current.queue.drainHeld(candidate); return candidate })
  native.move.mockImplementation(async () => ({
    new_path: destination, updated_files: 1, failed_updates: 0,
    source_before_content: tabs[0].content, source_content: 'rebased source',
    updated_open_pages: [{ path: incoming, before_content: tabs[1].content, content: 'rebased incoming' }],
    unrefreshed_open_paths: [],
  }))
  return { ...result, options, prepare, close, opened, structural, setTabs, navigate: () => { navigationGeneration += 1 } }
}

beforeEach(() => {
  native.move.mockReset(); native.read.mockReset(); native.save.mockReset()
  native.save.mockResolvedValue({ status: 'committed', written: true, durable: true, history: null })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('folder relocation with the editor save queue', () => {
  it('retries another destination in the same picker after a proven collision, while real navigation still expires it', async () => {
    const state = fixture()
    native.move.mockRejectedValue(new Error('collision'))
    native.read.mockResolvedValue(`saved ${path}`)
    act(() => { state.result.current.ui.openMovePageToFolderDialog(path) })
    await act(async () => { expect(await state.result.current.ui.selectFolder('filed')).toBe(false) })
    expect(state.result.current.ui.isDialogOpen).toBe(true)
    await act(async () => { expect(await state.result.current.ui.selectFolder('garden')).toBe(false) })
    expect(native.move).toHaveBeenCalledTimes(2)
    expect(native.move).toHaveBeenLastCalledWith(expect.objectContaining({ path, folderPath: 'garden' }))
    state.navigate()
    await act(async () => { expect(await state.result.current.ui.selectFolder('filed')).toBe(false) })
    expect(native.move).toHaveBeenCalledTimes(2)
    expect(state.options.notify).toHaveBeenLastCalledWith(expect.stringContaining('page changed'))
  })

  it('does not renew the picker after a failed original reopen or a vault A-to-B-to-A session change', async () => {
    const state = fixture()
    native.move.mockRejectedValue(new Error('collision'))
    native.read.mockResolvedValue(`saved ${path}`)
    state.opened.mockResolvedValue(false)
    act(() => { state.result.current.ui.openMovePageToFolderDialog(path) })
    await act(async () => { await state.result.current.ui.selectFolder('filed') })
    await act(async () => { expect(await state.result.current.ui.selectFolder('garden')).toBe(false) })
    expect(native.move).toHaveBeenCalledOnce()
    act(() => { state.result.current.ui.openMovePageToFolderDialog(path) })
    state.options.vaultPath = '/other'
    state.rerender()
    state.options.vaultPath = '/vault'
    state.rerender()
    await act(async () => { expect(await state.result.current.ui.selectFolder('garden')).toBe(false) })
    expect(native.move).toHaveBeenCalledOnce()
  })
  it('reschedules held pending text after preparation refuses, even when its original timer already fired', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const state = fixture()
    const paused = deferred<string>()
    state.prepare.mockImplementationOnce(() => paused.promise)
    act(() => { state.result.current.queue.handleContentChange(path, 'newer words') })
    let moving!: Promise<unknown>
    act(() => { moving = state.result.current.relocation.move(path, 'filed', '/vault', vi.fn()) })
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS + 1) })
    expect(state.prepare).toHaveBeenCalledWith(path)
    expect(state.result.current.queue.isHeld(path)).toBe(true)
    expect(native.save).not.toHaveBeenCalled()
    await act(async () => { paused.reject(new Error('preparation refused')); await moving })
    expect(state.result.current.queue.hasPendingWrite(path)).toBe(true)
    expect(state.result.current.queue.isHeld(path)).toBe(false)
    expect(state.close).not.toHaveBeenCalled()
    expect(native.move).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS + 1) })
    expect(native.save).toHaveBeenCalledWith('save_page_content', expect.objectContaining({ content: 'newer words' }))
    expect(state.result.current.queue.hasPendingWrite(path)).toBe(false)
    expect(backupInputHeld()).toBe(false)
    expect(state.structural.current.running).toBeNull()
  })

  it('joins an admitted import, saves both panes and an inactive queued page, then opens only receipt text', async () => {
    const state = fixture()
    const imported = deferred<void>()
    void trackEditorWork(imported.promise)
    let moving!: Promise<unknown>
    act(() => { moving = state.result.current.relocation.move(path, 'filed', '/vault', vi.fn()) })
    expect(state.structural.current.running).not.toBeNull()
    expect(backupInputHeld()).toBe(true)
    expect(state.close).not.toHaveBeenCalled()
    act(() => {
      state.result.current.queue.handleContentChange(path, 'accepted image import')
      state.result.current.queue.handleContentChange(incoming, 'new incoming words')
      state.result.current.queue.handleContentChange(queued, 'inactive queued words')
    })
    await act(async () => { imported.resolve(); await moving })
    expect(native.save).toHaveBeenCalledTimes(3)
    expect(state.prepare).toHaveBeenCalledWith(queued)
    expect(state.close).toHaveBeenCalledTimes(2)
    expect(native.move).toHaveBeenCalledWith({ path, folderPath: 'filed', vaultPath: '/vault', openPaths: [path, incoming] })
    expect(state.opened).toHaveBeenCalledWith(expect.objectContaining({ path: destination }), 'rebased source')
    expect(state.opened).toHaveBeenCalledWith(expect.objectContaining({ path: incoming }), 'rebased incoming')
    expect(native.save.mock.invocationCallOrder.at(-1)).toBeLessThan(native.move.mock.invocationCallOrder[0])
    expect(state.close.mock.invocationCallOrder.at(-1)).toBeLessThan(native.move.mock.invocationCallOrder[0])
    expect(backupInputHeld()).toBe(false)
  })

  it('closes hidden retained pages on an unknown reply and does not replay that source', async () => {
    const state = fixture()
    state.options.workspace.split = false
    native.move.mockRejectedValue(new Error('reply lost'))
    native.read.mockRejectedValue(new Error('old source absent'))
    await act(async () => { await state.result.current.relocation.move(path, 'filed', '/vault', vi.fn()) })
    expect(native.read).toHaveBeenCalledWith({ path, vaultPath: '/vault' })
    expect(state.close).toHaveBeenCalledOnce()
    expect(state.options.workspace.closePages).toHaveBeenCalledWith([path, incoming, destination])
    expect(state.opened).not.toHaveBeenCalled()
    expect(state.options.notify).toHaveBeenLastCalledWith(expect.stringContaining('could not be confirmed'))
    await act(async () => { await state.result.current.relocation.move(path, 'filed', '/vault', vi.fn()) })
    expect(native.move).toHaveBeenCalledOnce()
    expect(backupInputHeld()).toBe(false)
  })

  it('reopens a proven precommit refusal using the captured vault and exact saved original', async () => {
    const state = fixture()
    native.move.mockRejectedValue(new Error('collision'))
    native.read.mockResolvedValue(`saved ${path}`)
    await act(async () => { await state.result.current.relocation.move(path, 'filed', '/vault', vi.fn()) })
    expect(native.read).toHaveBeenCalledWith({ path, vaultPath: '/vault' })
    expect(state.opened).toHaveBeenCalledWith(expect.objectContaining({ path }), `saved ${path}`)
    expect(state.options.commitSource).not.toHaveBeenCalled()
  })

  it('keeps an unrefreshed incoming page closed while a committed move survives a list read failure', async () => {
    const state = fixture()
    state.options.refresh.mockRejectedValue(new Error('listing unavailable'))
    native.move.mockResolvedValue({ new_path: destination, updated_files: 0, failed_updates: 1,
      source_before_content: `saved ${path}`, source_content: 'committed source',
      updated_open_pages: [], unrefreshed_open_paths: [incoming] })
    await act(async () => {
      expect(await state.result.current.relocation.move(path, 'filed', '/vault', vi.fn())).toEqual({ new_path: destination })
    })
    expect(state.opened).toHaveBeenCalledOnce()
    expect(state.opened).toHaveBeenCalledWith(expect.objectContaining({ path: destination }), 'committed source')
    expect(state.options.workspace.closePages).toHaveBeenCalledWith([incoming, incoming])
    expect(state.options.notify).toHaveBeenLastCalledWith(expect.stringContaining('page moved'))
    await waitFor(() => { expect(backupInputHeld()).toBe(false) })
  })
})
