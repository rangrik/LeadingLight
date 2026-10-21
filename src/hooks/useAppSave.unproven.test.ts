// Amendment B (with the manager's correction) through the real save lanes: a linked page whose
// state a rename did not prove keeps its words, typed before or after, and never writes them over
// what native did, including when native finishes only after the reply was already lost.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { SetStateAction } from 'react'
import { invoke, type InvokeArgs } from '@tauri-apps/api/core'
import { useAppSave } from './useAppSave'
import { AUTO_SAVE_DEBOUNCE_MS, UnmergedDraftError, type DocumentMutation, type MutationSettled } from './useEditorSave'
import { runManagedRename } from '../leadinglight/rename/managedRename'
import { useLocalTrash } from '../leadinglight/useLocalTrash'
import { usePageRelocation } from '../leadinglight/relocation/usePageRelocation'
import type { SplitWorkspaceController } from '../leadinglight/useSplitWorkspace'
import type { VaultEntry } from '../types'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({ isTauri: () => true, mockInvoke: vi.fn(), updateMockContent: vi.fn() }))
vi.mock('../leadinglight/saveOutcome', async importOriginal => ({
  ...await importOriginal<typeof import('../leadinglight/saveOutcome')>(),
  sha256Hex: async () => 'a'.repeat(64),
}))

const B = '/vault/notes.md'
const OLD_B = '# Notes\n\nSee [Plan](./plan.md).\n'
const RETARGETED = '# Notes\n\nSee [Plan](./roadmap.md).\n'
const EXTERNAL = '# Notes\n\nSee [Plan](./plan.md).\n\nAdded in another editor.\n'
const UNPROVEN_COPY = "Can't save this page. LeadingLight couldn't confirm whether a rename changed it, so your edits are kept here but not saved in this window. Copy anything you need to keep."

const disk = new Map<string, string>()
const writes: string[] = []
/** Every other backend command the page sent: renames, moves, Trash. */
const dispatched: string[] = []

interface Tab { entry: VaultEntry; content: string }
let tabs: Tab[] = []
const shown = () => tabs.find(tab => tab.entry.path === B)?.content

function entry(path: string): VaultEntry {
  return { path, title: 'Notes', filename: path.split('/').pop(), isA: 'Note' } as unknown as VaultEntry
}

/** How one claimed linked page settles; the shape RENAME's `LinkedPageResult` gives the lane. */
type PageResult = { kind: 'committed'; content: string } | { kind: 'unchanged' } | { kind: 'unproven'; current: string | null }

/** A linked page's change as RENAME builds it: claimed, then waiting on the one rename's reply. */
function linkedPage(reply: Promise<PageResult>): DocumentMutation<PageResult> {
  let settled: PageResult | null = null
  return {
    publish: async () => (settled = await reply),
    committedContent: result => (result.kind === 'committed' ? result.content : null),
    unproven: result => (result.kind === 'unproven' ? { current: result.current } : null),
    rebase: draft => (settled?.kind === 'unproven' ? null : draft),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

const setToastMessage = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  disk.clear()
  writes.length = 0
  dispatched.length = 0
  setToastMessage.mockReset()
  disk.set(B, OLD_B)
  tabs = [{ entry: entry(B), content: OLD_B }]
  vi.mocked(invoke).mockImplementation(async (cmd: string, raw?: InvokeArgs) => {
    const args = (raw ?? {}) as { path: string; request: { path: string }; content: string }
    if (cmd === 'save_page_content') {
      writes.push(args.content)
      disk.set(args.request.path, args.content)
      return { status: 'committed', written: true, durable: true, history: null }
    }
    if (cmd === 'get_note_content') return disk.get(args.path) ?? ''
    dispatched.push(cmd)
    if (cmd === 'auto_rename_untitled') throw new Error('The connection to the backend was lost')
    if (cmd === 'move_to_local_trash') return { moved: [], failed: [] }
    return null
  })
})
afterEach(() => { vi.useRealTimers() })

function appOptions(flushEditorBuffers?: (path: string) => void, autoRename = false) {
  return {
    flushEditorBuffers,
    updateEntry: vi.fn(),
    setTabs: (update: SetStateAction<Tab[]>) => { tabs = typeof update === 'function' ? update(tabs) : update },
    handleSwitchTab: vi.fn(), setToastMessage, loadModifiedFiles: vi.fn(), clearUnsaved: vi.fn(),
    unsavedPaths: new Set<string>(), tabs, activeTabPath: tabs[0]?.entry.path ?? B, handleRenameNote: vi.fn(), handleRenameFilename: vi.fn(),
    replaceEntry: vi.fn(), resolvedPath: '/vault', initialH1AutoRenameEnabled: autoRename, pageBusyMessage: 'busy',
  }
}

function render(flushEditorBuffers?: (path: string) => void) {
  return renderHook(() => useAppSave({
    flushEditorBuffers,
    updateEntry: vi.fn(),
    setTabs: (update: SetStateAction<Tab[]>) => { tabs = typeof update === 'function' ? update(tabs) : update },
    handleSwitchTab: vi.fn(), setToastMessage, loadModifiedFiles: vi.fn(), clearUnsaved: vi.fn(),
    unsavedPaths: new Set(), tabs, activeTabPath: B, handleRenameNote: vi.fn(), handleRenameFilename: vi.fn(),
    replaceEntry: vi.fn(), resolvedPath: '/vault', initialH1AutoRenameEnabled: false, pageBusyMessage: 'busy',
  }))
}

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

/** Claims B's lane for a rename and answers with `result` once the test says the reply arrived. */
function claimB(app: ReturnType<typeof render>['result']) {
  const reply = deferred<PageResult>()
  const admission = app.current.mutateExistingDocument(B, linkedPage(reply.promise))
  if (!admission.admitted) throw new Error(`B was not claimed: ${admission.reason}`)
  return { reply, done: admission.done as Promise<MutationSettled<PageResult>> }
}

async function typeIntoB(app: ReturnType<typeof render>['result'], content: string) {
  act(() => { app.current.handleContentChange(B, content) })
  await advance(AUTO_SAVE_DEBOUNCE_MS + 10)
}

/** Autosave, explicit save and leaving the page: none writes B, and each refusal is visible. */
async function expectNothingEscapes(app: ReturnType<typeof render>['result'], onDisk: string) {
  await advance(AUTO_SAVE_DEBOUNCE_MS * 3)
  await expect(app.current.savePendingForPath(B)).rejects.toBeInstanceOf(UnmergedDraftError)
  await expect(app.current.flushBeforeAction(B)).rejects.toBeInstanceOf(UnmergedDraftError)
  await advance(AUTO_SAVE_DEBOUNCE_MS * 3)
  expect(writes).toEqual([])
  expect(disk.get(B)).toBe(onDisk)
}

describe('a linked page a rename did not prove', () => {
  it('receipt lists it unrefreshed after an external edit: the newer draft stays held and the edit stays on disk', async () => {
    const app = render()
    const { reply, done } = claimB(app.result)
    await advance(0)
    await typeIntoB(app.result, `${OLD_B}\nTyped while renaming.\n`)
    disk.set(B, EXTERNAL)
    // A completed receipt: native skipped B; the read under the lane hands its exact bytes over.
    await act(async () => { reply.resolve({ kind: 'unproven', current: EXTERNAL }) })
    expect(await done).toMatchObject({ kind: 'returned', integration: 'unmergedDraft', latest: `${OLD_B}\nTyped while renaming.\n` })
    expect(shown()).toBe(`${OLD_B}\nTyped while renaming.\n`)
    await expectNothingEscapes(app.result, EXTERNAL)
  })

  it('native retargets B but the reply is malformed: the old-link draft is held and never saved over the retarget', async () => {
    const app = render()
    const { reply, done } = claimB(app.result)
    await advance(0)
    await typeIntoB(app.result, `${OLD_B}\nTyped while renaming.\n`)
    disk.set(B, RETARGETED)
    await act(async () => { reply.resolve({ kind: 'unproven', current: null }) })
    expect(await done).toMatchObject({ kind: 'returned', integration: 'unmergedDraft', latest: `${OLD_B}\nTyped while renaming.\n` })
    await expectNothingEscapes(app.result, RETARGETED)
    expect(setToastMessage).toHaveBeenLastCalledWith(UNPROVEN_COPY)
  })

  it('transport rejects BEFORE a deferred native commit: a clean B is protected, so later typing never restores the old link', async () => {
    const app = render()
    const { reply, done } = claimB(app.result)
    await advance(0)
    // The reply is lost while native's worker has not yet touched B; nothing is reread or released.
    await act(async () => { reply.resolve({ kind: 'unproven', current: null }) })
    expect(await done).toMatchObject({ kind: 'returned', integration: 'unmergedDraft', latest: null })
    expect(shown()).toBe(OLD_B)
    // The worker finishes afterwards and retargets B; the tab still shows the old link.
    disk.set(B, RETARGETED)
    await typeIntoB(app.result, `${OLD_B}\nTyped after the lost reply.\n`)
    await expectNothingEscapes(app.result, RETARGETED)
    // The words stay on screen.
    expect(shown()).toBe(`${OLD_B}\nTyped after the lost reply.\n`)
    // Nor does it take another page change before LeadingLight is reopened.
    expect(app.result.current.mutateExistingDocument(B, linkedPage(Promise.resolve({ kind: 'unchanged' })))).toEqual({ admitted: false, reason: 'busy' })
  })

  it('a completed receipt lets a clean unrefreshed page continue from the exact bytes read, not the stale tab', async () => {
    const app = render()
    const { reply, done } = claimB(app.result)
    await advance(0)
    disk.set(B, EXTERNAL)
    await act(async () => { reply.resolve({ kind: 'unproven', current: EXTERNAL }) })
    expect(await done).toMatchObject({ kind: 'returned', integration: 'none', latest: EXTERNAL })
    expect(shown()).toBe(EXTERNAL)
    expect(writes).toEqual([])
    await typeIntoB(app.result, `${EXTERNAL}More.\n`)
    expect(writes).toEqual([`${EXTERNAL}More.\n`])
  })

  it('a known refusal before dispatch releases the claimed lane at once and holds nothing', async () => {
    const app = render()
    const { reply, done } = claimB(app.result)
    await advance(0)
    await act(async () => { reply.resolve({ kind: 'unchanged' }) })
    expect(await done).toMatchObject({ kind: 'returned', integration: 'none' })
    await typeIntoB(app.result, `${OLD_B}More.\n`)
    expect(writes).toEqual([`${OLD_B}More.\n`])
  })
})

describe('a renamed page whose own rename ended unknown', () => {
  it('keeps text typed later on screen and unsaved, so a late native rename is never overwritten', async () => {
    const app = render()
    expect(app.result.current.holdUnproven(B)).toBe('none')
    disk.set(B, RETARGETED)
    await typeIntoB(app.result, `${OLD_B}Later.\n`)
    await expectNothingEscapes(app.result, RETARGETED)
  })
})

describe('the real managed rename, rejected before native finishes (B1)', () => {
  const A = '/vault/plan.md'
  const A_TEXT = '# Plan\n\nBody.\n'
  const B_TEXT = '# Notes\n\nSee [Plan](./plan.md).\n'

  it('holds the clean source and the clean linked page, so typing after the late commit writes neither', async () => {
    disk.set(A, A_TEXT)
    disk.set(B, B_TEXT)
    tabs = [{ entry: entry(A), content: A_TEXT }, { entry: entry(B), content: B_TEXT }]
    const app = render()
    // The transport gives up first; native's worker is still running and commits a moment later.
    const lateCommit = () => {
      disk.delete(A)
      disk.set('/vault/roadmap.md', A_TEXT)
      disk.set(B, B_TEXT.replace('./plan.md', './roadmap.md'))
    }
    let result: unknown
    await act(async () => {
      await app.result.current.withManualRename(A, async () => {
        result = await runManagedRename({
          sourcePath: A, vaultPath: '/vault', oldTitle: 'Plan', destination: { exact: '/vault/roadmap.md' }, sourceBaseline: A_TEXT,
          dispatch: async () => {
            setTimeout(lateCommit, 50)
            throw new Error('The connection to the backend was lost')
          },
          route: () => { throw new Error('nothing may be routed without a receipt') },
        }, {
          mutateExistingDocument: app.result.current.mutateExistingDocument,
          rebaseHeldDraft: app.result.current.rebaseHeldDraft,
          flushEditorBuffers: () => {},
          tabsRef: { get current() { return tabs } },
          setTabs: update => { tabs = update(tabs) },
          linkedPaths: app.result.current.managedRenameLinkedPaths,
        })
        // What the rename handlers do on an unknown reply, still under the rename's hold.
        if ((result as { status: string }).status === 'unknown') app.result.current.holdUnproven(A)
      })
    })
    expect(result).toMatchObject({ status: 'unknown', unprovenPaths: [B] })
    await advance(100)
    expect(disk.get(B)).toBe(B_TEXT.replace('./plan.md', './roadmap.md'))

    // Both tabs still show the old text; typing there must not undo what native did late.
    act(() => { app.result.current.handleContentChange(A, `${A_TEXT}More.\n`) })
    act(() => { app.result.current.handleContentChange(B, `${B_TEXT}More.\n`) })
    await advance(AUTO_SAVE_DEBOUNCE_MS * 3)
    await expect(app.result.current.savePendingForPath(A)).rejects.toBeInstanceOf(UnmergedDraftError)
    await expect(app.result.current.savePendingForPath(B)).rejects.toBeInstanceOf(UnmergedDraftError)
    expect(writes).toEqual([])
    expect(disk.has(A)).toBe(false)
    expect(disk.get('/vault/roadmap.md')).toBe(A_TEXT)
  })
})

describe('a clean page left unknown takes no further change, typed or not (Astra B1 residual 1)', () => {
  async function leaveBUnknown(app: ReturnType<typeof render>['result']) {
    const { reply, done } = claimB(app)
    await advance(0)
    await act(async () => { reply.resolve({ kind: 'unproven', current: null }) })
    expect(await done).toMatchObject({ integration: 'unmergedDraft', latest: null })
  }

  it('refuses a second page change and a property claim before anything is sent', async () => {
    const app = render()
    await leaveBUnknown(app.result)
    const publish = vi.fn(async () => ({ kind: 'unchanged' }) as PageResult)
    expect(app.result.current.mutateExistingDocument(B, { ...linkedPage(Promise.resolve({ kind: 'unchanged' })), publish }))
      .toEqual({ admitted: false, reason: 'busy' })
    const work = vi.fn(async () => true)
    let ran: boolean | undefined
    await act(async () => { ran = await app.result.current.runPageExclusive(B, work) })
    expect(ran).toBe(false)
    expect(publish).not.toHaveBeenCalled()
    expect(work).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })

  it('refuses a manual rename of it, so a lost rename is never sent a second time', async () => {
    const app = render()
    await leaveBUnknown(app.result)
    const rename = vi.fn(async () => {})
    await act(async () => { await app.result.current.withManualRename(B, rename) })
    expect(rename).not.toHaveBeenCalled()
    expect(setToastMessage).toHaveBeenLastCalledWith(
      "This page can't be renamed or moved now. LeadingLight couldn't confirm whether an earlier rename changed it; reopen LeadingLight to see it as saved.",
    )
  })

  it('refuses a manual rename that was already waiting when the earlier change ended unknown', async () => {
    const app = render()
    const { reply, done } = claimB(app.result)
    await advance(0)
    const rename = vi.fn(async () => {})
    let renaming!: Promise<void>
    act(() => { renaming = app.result.current.withManualRename(B, rename) })
    await act(async () => { reply.resolve({ kind: 'unproven', current: null }) })
    await done
    await act(async () => { await renaming })
    expect(rename).not.toHaveBeenCalled()
  })

  it('still keeps words typed later, unsaved', async () => {
    const app = render()
    await leaveBUnknown(app.result)
    await typeIntoB(app.result, `${OLD_B}Later.\n`)
    await expectNothingEscapes(app.result, OLD_B)
    expect(shown()).toBe(`${OLD_B}Later.\n`)
  })
})

describe('a buffer that cannot be read is never settled clean (Astra B1 residual 2)', () => {
  it('a completed read is not taken when the final flush throws: the tab keeps its text and later writes stay blocked', async () => {
    let failing = false
    const app = render(() => { if (failing) throw new Error('The rich editor could not serialize') })
    const { reply, done } = claimB(app.result)
    await advance(0)
    disk.set(B, EXTERNAL)
    failing = true
    await act(async () => { reply.resolve({ kind: 'unproven', current: EXTERNAL }) })
    expect(await done).toMatchObject({ integration: 'unmergedDraft', latest: null })
    expect(shown()).toBe(OLD_B)
    failing = false
    await typeIntoB(app.result, `${OLD_B}Later.\n`)
    await expectNothingEscapes(app.result, EXTERNAL)
    expect(app.result.current.mutateExistingDocument(B, linkedPage(Promise.resolve({ kind: 'unchanged' })))).toMatchObject({ admitted: false })
  })

  it('a successful ordinary change is unaffected by the guard', async () => {
    const app = render(() => {})
    const { reply, done } = claimB(app.result)
    await advance(0)
    await act(async () => { reply.resolve({ kind: 'committed', content: RETARGETED }) })
    expect(await done).toMatchObject({ integration: 'none', latest: RETARGETED })
    expect(shown()).toBe(RETARGETED)
    await typeIntoB(app.result, `${RETARGETED}More.\n`)
    expect(writes).toEqual([`${RETARGETED}More.\n`])
  })

  it('the source hold is taken even when its editor flush throws', async () => {
    const app = render(() => { throw new Error('The raw editor buffer could not be read') })
    expect(app.result.current.holdUnproven(B)).toBe('unmergedDraft')
    await typeIntoB(app.result, `${OLD_B}Later.\n`)
    await expectNothingEscapes(app.result, OLD_B)
  })

  it('routing whose old-identity handover throws still records the move and never settles the page as clean', async () => {
    let failing = true
    const app = render(() => { if (failing) throw new Error('The rich editor could not serialize') })
    act(() => { app.result.current.trackRenamedPath(B, '/vault/renamed.md') })
    failing = false
    expect(app.result.current.rebaseHeldDraft('/vault/renamed.md', draft => draft)).toBe('unmergedDraft')
    act(() => { app.result.current.handleContentChange(B, `${OLD_B}Later.\n`) })
    await advance(AUTO_SAVE_DEBOUNCE_MS * 3)
    await expect(app.result.current.savePendingForPath('/vault/renamed.md')).rejects.toBeInstanceOf(UnmergedDraftError)
    expect(writes).toEqual([])
  })
})

describe('an automatic rename whose reply was lost (B1 helper delta)', () => {
  const UNTITLED = '/vault/untitled-note-1.md'

  it('holds the clean renamed page: later words, a second rename, a page change, a move or Trash send nothing', async () => {
    disk.set(UNTITLED, '')
    tabs = [{ entry: entry(UNTITLED), content: '' }]
    const app = renderHook(() => useAppSave(appOptions(undefined, true)))
    act(() => { app.result.current.handleContentChange(UNTITLED, '# Alpha\n\nBody.\n') })
    await advance(AUTO_SAVE_DEBOUNCE_MS + 2_600)
    expect(writes).toEqual(['# Alpha\n\nBody.\n'])
    expect(dispatched).toEqual(['auto_rename_untitled'])
    // The worker finishes after the transport gave up: the page now lives at its new name.
    disk.delete(UNTITLED)
    disk.set('/vault/alpha.md', '# Alpha\n\nBody.\n')

    act(() => { app.result.current.handleContentChange(UNTITLED, '# Alpha\n\nBody.\nLater.\n') })
    await advance(AUTO_SAVE_DEBOUNCE_MS + 2_600)
    await expect(app.result.current.savePendingForPath(UNTITLED)).rejects.toBeInstanceOf(UnmergedDraftError)
    const rename = vi.fn(async () => {})
    await act(async () => { await app.result.current.withManualRename(UNTITLED, rename) })
    expect(app.result.current.mutateExistingDocument(UNTITLED, linkedPage(Promise.resolve({ kind: 'unchanged' })))).toMatchObject({ admitted: false })
    await expect(app.result.current.prepareForTrash(UNTITLED)).rejects.toBeInstanceOf(UnmergedDraftError)
    await advance(AUTO_SAVE_DEBOUNCE_MS + 2_600)

    expect(rename).not.toHaveBeenCalled()
    expect(writes).toEqual(['# Alpha\n\nBody.\n'])
    expect(dispatched).toEqual(['auto_rename_untitled'])
    expect(disk.has(UNTITLED)).toBe(false)
  })
})

/** Runs timers until the operation settles; both flows wait on timers before they prepare. */
async function settleWhile<T>(operation: Promise<T>): Promise<T> {
  let settled = false
  const result = operation.finally(() => { settled = true })
  for (let turn = 0; turn < 50 && !settled; turn += 1) await advance(100)
  return result
}

describe('moving a page left unknown, to a folder or to Trash', () => {
  async function leaveBUnknown(app: { current: Pick<ReturnType<typeof useAppSave>, 'mutateExistingDocument'> }) {
    const reply = deferred<PageResult>()
    const admission = app.current.mutateExistingDocument(B, linkedPage(reply.promise))
    if (!admission.admitted) throw new Error('B was not claimed')
    await advance(0)
    await act(async () => { reply.resolve({ kind: 'unproven', current: null }) })
    await admission.done
  }

  function renderTrash() {
    return renderHook(() => {
      const app = useAppSave(appOptions())
      const trash = useLocalTrash({
        vaultPath: '/vault', entries: [entry(B)], prepare: app.prepareForTrash, flushBuffers: () => {},
        hasPendingWrite: app.hasPendingWrite, holdWrites: app.holdWrites, releaseHeldWrites: app.releaseHeldWrites,
        closePages: vi.fn(), removeEntries: vi.fn(), addEntry: vi.fn(), clearUnsaved: vi.fn(), markInternalWrite: vi.fn(), reloadVault: vi.fn(),
      })
      return { app, trash }
    })
  }

  it.each([['clean', false], ['with words typed after', true]])('Trash refuses it, %s, before anything is sent', async (_case, typed) => {
    const hook = renderTrash()
    const app = { get current() { return hook.result.current.app } }
    await leaveBUnknown(app)
    if (typed) act(() => { hook.result.current.app.handleContentChange(B, `${OLD_B}Later.\n`) })
    await settleWhile(hook.result.current.trash.moveToTrash([B]))
    expect(dispatched).toEqual([])
    expect(writes).toEqual([])
    expect(disk.get(B)).toBe(OLD_B)
    // Reading and typing stay available; the words stay on screen.
    act(() => { hook.result.current.app.handleContentChange(B, `${OLD_B}Still here.\n`) })
    expect(shown()).toBe(`${OLD_B}Still here.\n`)
  })

  it('Trash still moves a page whose state is known', async () => {
    const hook = renderTrash()
    const app = { get current() { return hook.result.current.app } }
    const admission = app.current.mutateExistingDocument(B, linkedPage(Promise.resolve({ kind: 'unchanged' })))
    if (admission.admitted) await act(async () => { await admission.done })
    await settleWhile(hook.result.current.trash.moveToTrash([B]))
    expect(dispatched).toEqual(['move_to_local_trash'])
  })

  function renderRelocation() {
    const workspace = {
      activePane: 0, split: false, orientation: 'horizontal', ratio: 50, paths: [B, null], order: [0, 1],
      placePane: vi.fn(() => true), placeNote: vi.fn(async () => true),
      editorModes: ['preview', 'preview'], editorModesReady: true, beginEditorModeChange: vi.fn(() => vi.fn(() => true)),
      pendingPanes: [false, false], suspendPersistence: vi.fn(), focusPane: vi.fn(), selectNoteInPane: vi.fn(async () => {}),
      closePane: vi.fn(), openSplit: vi.fn(), resize: vi.fn(), canGoBack: false, canGoForward: false, goBack: vi.fn(), goForward: vi.fn(),
      closePages: vi.fn(), closePageAndReserveOpen: vi.fn(() => null), currentTabs: () => tabs,
      markNavigation: vi.fn(() => ({ pane: 0 as const, current: () => true })), openNoteWhenLoaded: vi.fn(async () => true), readyForVisits: true,
    } as unknown as SplitWorkspaceController
    const notify = vi.fn()
    const hook = renderHook(() => {
      const app = useAppSave(appOptions())
      const relocation = usePageRelocation({
        vaultPath: '/vault', locale: 'en', entries: [entry(B)], unsavedPaths: new Set(), workspace, saves: app,
        structural: { current: { running: null, holds: 0 } }, settlement: { current: { idle: () => true, close: () => null } },
        blocked: () => false, begin: () => () => {}, joinEarlier: async () => {}, assertClear: () => {}, flushBuffers: () => {},
        commitSource: vi.fn(), setTabs: update => { tabs = typeof update === 'function' ? update(tabs) : update },
        refresh: async () => {}, notify,
      })
      return { app, relocation }
    })
    return { hook, notify }
  }

  it.each([['clean', false], ['with words typed after', true]])('a folder move refuses it, %s, before anything is sent', async (_case, typed) => {
    const { hook, notify } = renderRelocation()
    const app = { get current() { return hook.result.current.app } }
    await leaveBUnknown(app)
    if (typed) act(() => { hook.result.current.app.handleContentChange(B, `${OLD_B}Later.\n`) })
    expect(await settleWhile(hook.result.current.relocation.move(B, 'filed', '/vault', vi.fn()))).toBeNull()
    expect(dispatched).toEqual([])
    expect(writes).toEqual([])
    expect(notify).toHaveBeenLastCalledWith(expect.stringContaining('The page was not moved'))
  })

  it('a folder move of a page whose state is known still reaches the backend', async () => {
    const { hook } = renderRelocation()
    await settleWhile(hook.result.current.relocation.move(B, 'filed', '/vault', vi.fn()))
    expect(dispatched).toContain('move_note_to_folder')
  })
})
