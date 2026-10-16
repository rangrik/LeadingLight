import { blockNoteViewState, mockEditor, mockEntry, render, resetEditorTestState } from '../../components/Editor.helpers.test'
import { act } from '@testing-library/react'
import { useLayoutEffect, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { invoke } from '@tauri-apps/api/core'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppSave } from '../../hooks/useAppSave'
import { clearPrefetchCache } from '../../hooks/useTabManagement'
import type { VaultEntry } from '../../types'
import { resetVaultConfigStore } from '../../utils/vaultConfigStore'
import { SplitEditorWorkspace } from '../SplitEditorWorkspace'
import { useSplitWorkspace } from '../useSplitWorkspace'
import type { PageSettlement } from './paneSettlement'
import { useSaveHoldActions, type SaveHoldActions } from './useSaveHoldActions'

vi.mock('../../mock-tauri', async original => ({ ...await original<typeof import('../../mock-tauri')>(), isTauri: () => true }))
vi.mock('../saveOutcome', async original => ({ ...await original<typeof import('../saveOutcome')>(), sha256Hex: async () => 'a'.repeat(64) }))

// Seam: closing a recovered page, then opening it again, or its kept copy, through the real split controller and editor.
// Catches the note-open cache handing back the text from before recovery, so new edits overwrite a file nobody saw,
// and a kept copy opening in the wrong pane, over a newer navigation, from a stale list, or not at all without saying so.
// Also catches a change event that edits nothing making the copy outdated, and a held page turning read-only off the list.
// Limit: BlockNote itself is the shared test stub; the editor, tab swap, debounce and raw view are real.
const A = '/vault/plan.md'
const B = '/vault/other.md'
const COPY = '/vault/plan copy.md'
const D = '/vault/notes.md'
const OLD = '# Plan\n\nold body\n'
const NOW = '# Plan\n\nchanged on disk\n'
const entry = (path: string): VaultEntry => ({ ...mockEntry, path, filename: path.split('/').pop()!, title: path, fileSize: 100, modifiedAt: 1 })
// The other pane holds a sheet: it keeps its own editor and never takes the shared rich-stub typing.
const sheet = { ...entry(B), display: 'sheet' } as VaultEntry
// The copy is never listed: the whole-list refresh a copy starts never lands here.
const entries = [entry(A), sheet, entry(D)]
const disk = new Map<string, string>()
const calls: Array<{ cmd: string; args: Record<string, unknown> }> = []
let saves: 'lost' | 'commit' = 'lost'
let copyRead: 'ok' | 'fails' | Promise<void> = 'ok'
let proofGate: Promise<void> | null = null
const addEntry = vi.fn()
const notify = vi.fn()
type State = { split: ReturnType<typeof useSplitWorkspace>; app: ReturnType<typeof useAppSave>; actions: SaveHoldActions
  setVault: (vault: string) => void; setListed: (list: VaultEntry[]) => void }
let h: State
let unsaved = new Set<string>()
// The app's raw-mode command; Editor fills it for the active pane.
const rawToggle = { current: () => {} }

function Workspace({ onState }: { onState: (state: State) => void }) {
  const appRef = useRef<ReturnType<typeof useAppSave> | null>(null)
  const flushRich = useRef<((path: string) => void) | null>(null)
  const flushRaw = useRef<((path: string) => void) | null>(null)
  const settlementRef = useRef<PageSettlement | null>(null)
  const [vault, setVault] = useState('/vault')
  const [listed, setListed] = useState(entries)
  const flushBuffers = (path: string) => { flushRich.current?.(path); flushRaw.current?.(path) }
  const split = useSplitWorkspace({ vaultPath: '/vault', entries, restoreWorkspace: false,
    beforeNavigate: async path => { flushBuffers(path); await appRef.current?.flushBeforeAction(path) } })
  const app = useAppSave({
    updateEntry: vi.fn(), setTabs: split.setTabs, handleSwitchTab: split.handleSwitchTab, setToastMessage: vi.fn(), loadModifiedFiles: vi.fn(),
    clearUnsaved: vi.fn(), unsavedPaths: new Set(), tabs: split.tabs, activeTabPath: split.activeTabPath, handleRenameNote: vi.fn(),
    handleRenameFilename: vi.fn(), replaceEntry: vi.fn(), resolvedPath: vault, initialH1AutoRenameEnabled: false,
    pageBusyMessage: 'busy', flushEditorBuffers: flushBuffers,
  })
  useLayoutEffect(() => { appRef.current = app })
  const actions = useSaveHoldActions({ recovery: app.saveRecovery, flushBuffers, settlementRef, clearUnsaved: vi.fn(), onCopyCreated: vi.fn(),
    addEntry, notify, pageTitle: () => 'Plan', locale: 'en' })
  onState({ split, app, actions, setVault, setListed })
  return <SplitEditorWorkspace workspace={split.splitWorkspace} unsavedPaths={unsaved} tabs={split.tabs} activeTabPath={split.activeTabPath}
    entries={listed} onNavigateWikilink={vi.fn()} inspectorCollapsed onToggleInspector={vi.fn()} inspectorWidth={280} onInspectorResize={vi.fn()}
    inspectorEntry={null} inspectorContent={null} gitHistory={[]} vaultPath="/vault" onContentChange={app.handleContentChange}
    onSave={() => { void app.handleSave() }} flushPendingEditorContentRef={flushRich} flushPendingRawContentRef={flushRaw} rawToggleRef={rawToggle}
    blockedPaths={actions.blockedPaths} settlementRef={settlementRef} />
}

beforeEach(() => {
  vi.useFakeTimers()
  resetEditorTestState()
  resetVaultConfigStore()
  clearPrefetchCache()
  disk.clear()
  disk.set(A, OLD).set(B, '# Other\n\nkept\n').set(D, '# Notes\n')
  calls.length = 0
  unsaved = new Set()
  saves = 'lost'
  copyRead = 'ok'
  proofGate = null
  addEntry.mockReset()
  notify.mockReset()
  vi.mocked(invoke).mockImplementation(async (cmd: string, raw?: unknown) => {
    const args = (raw ?? {}) as Record<string, unknown> & { path?: string; content?: string; request?: { path: string }; actionId?: string; draft?: { content: string } }
    calls.push({ cmd, args })
    if (cmd === 'get_note_content' || cmd === 'reload_vault_entry') {
      if (args.path === COPY && copyRead !== 'ok') {
        if (copyRead === 'fails') throw new Error('Permission denied')
        await copyRead
      }
      if (!disk.has(args.path!)) throw new Error(`File does not exist: ${args.path}`)
      return cmd === 'get_note_content' ? disk.get(args.path!) : { ...entry(args.path!), title: 'Plan copy, read from disk' }
    }
    if (cmd === 'validate_note_content') return disk.get(args.path!) === args.content
    if (cmd === 'save_page_content') {
      if (saves === 'lost') throw new Error('no reply')
      disk.set(args.request!.path, args.content!)
      return { status: 'committed', written: true, durable: true, history: null }
    }
    if (cmd === 'release_hold_with_copy') await proofGate
    if (cmd === 'discard_hold' || cmd === 'release_hold_with_copy') return { status: 'resolved', actionId: args.actionId, holdRetired: true, leftovers: [] }
    if (cmd === 'save_draft_as_new_page') {
      disk.set(COPY, args.draft!.content)
      return { status: 'created', path: COPY, relativePath: 'plan copy.md', durable: true }
    }
    return null
  })
})
afterEach(() => { vi.useRealTimers() })

const tick = (ms = 10) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const open = async (path: string) => {
  let opened = false
  await act(async () => { void h.split.splitWorkspace.openNoteWhenLoaded(entry(path)).then(value => { opened = value }) })
  await tick(50)
  return opened
}
const shown = (pane: 0 | 1) => h.split.tabs.find(tab => tab.entry.path === h.split.splitWorkspace.paths[pane]) ?? null
function typeRich(text: string) {
  mockEditor.document = [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }], children: [] }] as never
  // Each edit makes a new document object, as ProseMirror does.
  Object.assign(mockEditor, { prosemirrorState: { doc: { text } } })
  act(() => { blockNoteViewState.onChange?.() })
}
const savedWith = (text: string) => calls.filter(call => call.cmd === 'save_page_content' && String(call.args.content).includes(text)).length
async function holdA() {
  expect(await open(A)).toBe(true)
  expect(shown(0)?.content).toBe(OLD)
  typeRich('Held words.')
  await tick(3_100)
  expect(h.actions.snapshot.holds).toHaveLength(1)
}
async function choose(kind: 'discard' | 'keepCopy') {
  await act(async () => {
    const running = h.actions.finish(A, kind)
    await vi.advanceTimersByTimeAsync(20)
    await running
  })
}

it.each(['changed', 'removed'] as const)('reopens a discarded page from the file as it is now (%s), and the other pane keeps its page', async how => {
  const { container } = render(<Workspace onState={next => { h = next }} />)
  await holdA()
  act(() => h.split.splitWorkspace.openSplit('horizontal'))
  await act(async () => { void h.split.splitWorkspace.selectNoteInPane(sheet, 1) })
  await tick(50)
  expect(container.querySelector('[data-pane-id="1"] [data-testid="sheet-editor"]')).not.toBeNull()
  const otherEditor = container.querySelector('[data-pane-id="1"] .editor')
  act(() => h.split.splitWorkspace.focusPane(0))
  if (how === 'changed') disk.set(A, NOW)
  else disk.delete(A)

  // One batch, so no empty render lands first: discard, Save, raw toggle (vault-wide) on the closing editor, reopen.
  let opened: boolean | null = null
  await act(async () => {
    const running = h.actions.finish(A, 'discard')
    await vi.advanceTimersByTimeAsync(20)
    await running
    await h.app.handleSave()
    rawToggle.current()
    void h.split.splitWorkspace.openNoteWhenLoaded(entry(A)).then(value => { opened = value })
  })
  await tick(5_000)

  expect(savedWith('Held words.')).toBe(1)
  if (how === 'changed') {
    expect(opened).toBe(true)
    expect(shown(0)?.content).toBe(NOW)
    const raw = (container.querySelector('[data-pane-id="0"] [data-testid="raw-editor-codemirror"]') as HTMLElement & { __cmView: EditorView }).__cmView
    expect(raw.state.doc.toString()).toBe(NOW)
    saves = 'commit'
    act(() => { raw.dispatch({ changes: { from: raw.state.doc.length, insert: 'fresh\n' } }) })
    await tick(3_100)
    expect(disk.get(A)).toBe(`${NOW}fresh\n`)
  } else {
    expect(opened).toBe(false)
    expect(disk.has(A)).toBe(false)
  }
  // Same editor, never remounted, still on its own page; raw mode now shows its source.
  expect(container.querySelector('[data-pane-id="1"] .editor')).toBe(otherEditor)
  expect(container.querySelector('[data-pane-id="1"] [data-testid="raw-editor-codemirror"]')?.textContent).toContain('kept')
  expect(shown(1)?.content).toBe(disk.get(B))
})

const gate = () => { let release = () => {}; const done = new Promise<void>(resolve => { release = resolve }); return { done, release } }
const callsFor = (cmd: string, path: string) => calls.filter(call => call.cmd === cmd && call.args.path === path)
async function keepWithCopy(otherPane: boolean) {
  render(<Workspace onState={next => { h = next }} />)
  await holdA()
  if (otherPane) {
    act(() => h.split.splitWorkspace.openSplit('horizontal'))
    await act(async () => { void h.split.splitWorkspace.selectNoteInPane(sheet, 1) })
    await tick(50)
    act(() => h.split.splitWorkspace.focusPane(0))
  }
  await act(async () => { await h.actions.saveCopy(A, null) })
  expect(h.actions.viewFor(A).canKeepCopy).toBe(true)
}

it('opens the kept copy in the original pane from fresh reads, unlisted, while the other pane stays active', async () => {
  await keepWithCopy(true)
  disk.set(A, NOW)
  const proof = gate()
  proofGate = proof.done
  let choice = Promise.resolve()
  act(() => { choice = h.actions.finish(A, 'keepCopy') })
  await tick(20)
  // The person works in the other pane while the proof is out.
  act(() => h.split.splitWorkspace.focusPane(1))
  await act(async () => { proof.release(); await vi.advanceTimersByTimeAsync(20); await choice })
  await tick(50)

  expect(calls.filter(call => call.cmd === 'release_hold_with_copy')).toHaveLength(1)
  expect(callsFor('reload_vault_entry', COPY)).toEqual([expect.objectContaining({ args: { path: COPY, vaultPath: '/vault' } })])
  expect(callsFor('get_note_content', COPY)).toHaveLength(1)
  expect(shown(0)?.entry).toMatchObject({ path: COPY, title: 'Plan copy, read from disk' })
  expect(shown(0)?.content).toBe(disk.get(COPY))
  expect(addEntry).toHaveBeenCalledWith(expect.objectContaining({ path: COPY }))
  expect(notify).toHaveBeenCalledWith('Your words are kept in plan copy.md.')
  expect(h.split.splitWorkspace.activePane).toBe(1)
  expect(shown(1)).toMatchObject({ entry: { path: B }, content: disk.get(B) })

  act(() => h.split.splitWorkspace.focusPane(0))
  expect(await open(A)).toBe(true)
  expect(shown(0)?.content).toBe(NOW)
  await tick(5_000)
  expect(savedWith('Held words.')).toBe(1)
})

it('keeps the page, its words and the hold when the copy cannot be read', async () => {
  await keepWithCopy(false)
  copyRead = 'fails'
  await choose('keepCopy')

  expect(h.actions.viewFor(A).notice?.key).toBe('saveHold.copy.readFailed')
  expect(calls.some(call => call.cmd === 'release_hold_with_copy')).toBe(false)
  expect(h.actions.snapshot.holds).toHaveLength(1)
  expect(shown(0)?.entry.path).toBe(A)
  expect(addEntry).not.toHaveBeenCalled()
  expect(disk.has(COPY)).toBe(true)
})

it('drops a copy read that finishes after the vault switched away and back', async () => {
  await keepWithCopy(false)
  const read = gate()
  copyRead = read.done
  let choice = Promise.resolve()
  act(() => { choice = h.actions.finish(A, 'keepCopy') })
  await tick(20)
  act(() => h.setVault('/other'))
  act(() => h.setVault('/vault'))
  await act(async () => { read.release(); await vi.advanceTimersByTimeAsync(20); await choice })

  expect(calls.some(call => call.cmd === 'release_hold_with_copy')).toBe(false)
  expect(addEntry).not.toHaveBeenCalled()
  expect(shown(0)?.entry.path).toBe(A)
  expect(h.actions.blockedPaths.size).toBe(0)
  expect(h.actions.viewFor(A).notice).toBeNull()
})

it('leaves a navigation made right after settling in place, and says the copy was kept but not opened', async () => {
  await keepWithCopy(false)
  // The person opens another page in that pane after the choice applied, before the copy opens.
  addEntry.mockImplementationOnce(() => { void h.split.splitWorkspace.openNoteWhenLoaded(entry(D)) })
  await choose('keepCopy')
  await tick(50)

  expect(shown(0)?.entry.path).toBe(D)
  expect(h.split.tabs.some(tab => tab.entry.path === COPY)).toBe(false)
  expect(notify).toHaveBeenCalledWith('Your words are kept in plan copy.md. It wasn\'t opened, so you can find it in your pages.')
  expect(disk.has(COPY)).toBe(true)
})

it('keeps a page with unsaved words writable, in the same editor, after its file leaves the list', async () => {
  unsaved = new Set([A])
  const { container } = render(<Workspace onState={next => { h = next }} />)
  await holdA()
  const view = container.querySelector('[data-pane-id="0"] [data-testid="blocknote-view"]')
  disk.delete(A)
  act(() => h.setListed(entries.filter(item => item.path !== A)))

  expect(container.querySelector('[data-pane-id="0"] [data-testid="blocknote-view"]')).toBe(view)
  expect(view).toHaveAttribute('data-editable', 'true')
})

it('keeps the copy current through a change event that edits nothing, so Keep sends the proof', async () => {
  await keepWithCopy(false)
  // TipTap reports a change when only editability flips; the document stays the same object.
  act(() => { blockNoteViewState.onChange?.() })
  await tick(3_100)

  expect(h.actions.viewFor(A).canKeepCopy).toBe(true)
  await choose('keepCopy')
  expect(calls.filter(call => call.cmd === 'release_hold_with_copy')).toHaveLength(1)
})

it('needs a new copy after a real edit, even one typed back to the copied words', async () => {
  await keepWithCopy(false)
  typeRich('Held words, and more.')
  typeRich('Held words.')
  await tick(3_100)

  expect(h.actions.viewFor(A).canKeepCopy).toBe(false)
  await choose('keepCopy')
  expect(calls.some(call => call.cmd === 'release_hold_with_copy')).toBe(false)
})
