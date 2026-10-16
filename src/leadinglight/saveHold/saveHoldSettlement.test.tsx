import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import type { EditorView } from '@codemirror/view'
import { invoke } from '@tauri-apps/api/core'
import { RawEditorView } from '../../components/RawEditorView'
import { useRegisterEditorContentFlushes, type EditorIdleCheck } from '../../components/editorContentFlushRegistration'
import { useDebouncedEditorChange } from '../../hooks/editorChangeDebounce'
import { trackEditorWork } from '../editorWork'
import { useAppSave } from '../../hooks/useAppSave'
import type { VaultEntry } from '../../types'
import { usePaneSettlement, type PageSettlement } from './paneSettlement'
import { useSaveHoldActions, type SaveHoldActions } from './useSaveHoldActions'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../../mock-tauri', () => ({ isTauri: () => true, mockInvoke: vi.fn(), updateMockContent: vi.fn() }))
// The real hash resolves outside fake time.
vi.mock('../saveOutcome', async original => ({ ...await original<typeof import('../saveOutcome')>(), sha256Hex: async () => 'a'.repeat(64) }))

// Seam: a final recovery choice against the page's real buffers and save queue.
// Catches discarded words saved again after the page closes, and newer words lost when a choice cannot settle.
const PATH = '/vault/plan.md'
const DISK = '# Plan\n\nbody'
type Kind = 'raw' | 'rich'
type Change = (path: string, content: string) => unknown
const disk = new Map<string, string>()
const calls: Array<{ cmd: string; args: Record<string, unknown> }> = []
let saves: 'lost' | 'commit' | 'refuse' = 'lost'
let duringChoice: () => void = () => {}
type State = { app: ReturnType<typeof useAppSave>; actions: SaveHoldActions; shown: boolean; reopen: () => void; setVault: (vault: string) => void }
let h: State
let typer: (text: string) => void = () => {}
const setTyper = (next: (text: string) => void) => { typer = next }
const notify = vi.fn()
const clearUnsaved = vi.fn()
const flushes: string[] = []

function RawPane({ tab, change, flush, idle }: PaneProps) {
  const latest = useRef<string | null>(null)
  useRegisterEditorContentFlushes({ activeTab: tab, flushPendingEditorChange: () => false, rawLatestContentRef: latest, rawMode: true,
    onContentChange: change, flushPendingRawContentRef: flush, editorIdleRef: idle })
  return <RawEditorView content={tab.content} path={PATH} entries={[]} onContentChange={change as never} onSave={() => {}} latestContentRef={latest} />
}

function RichPane({ tab, change, flush, idle }: PaneProps) {
  const text = useRef(tab.content)
  const suppress = useRef(false)
  const debounce = useDebouncedEditorChange({ onFlush: () => { change(PATH, text.current) }, suppressChangeRef: suppress })
  const { handleEditorChange } = debounce
  useEffect(() => setTyper(more => { text.current += more; handleEditorChange() }), [handleEditorChange])
  useRegisterEditorContentFlushes({ activeTab: tab, flushPendingEditorChange: debounce.flushPendingEditorChange, flushPendingEditorContentRef: flush,
    rawLatestContentRef: useRef(null), rawMode: false, onContentChange: change, hasPendingEditorChange: debounce.hasPendingEditorChange, editorIdleRef: idle })
  return null
}

type Tab = { entry: VaultEntry; content: string }
type PaneProps = { tab: Tab; change: Change; flush: MutableRefObject<((path: string) => void) | null>; idle: MutableRefObject<EditorIdleCheck | null> }

function Workspace({ kind, onState }: { kind: Kind; onState: (state: State) => void }) {
  const [shown, setShown] = useState(true)
  const [vault, setVault] = useState('/vault')
  const [tabs, setTabs] = useState<Tab[]>([{ entry: { path: PATH, title: 'Plan', filename: 'plan.md' } as VaultEntry, content: DISK }])
  const flushRef = useRef<((path: string) => void) | null>(null)
  const idleRef = useRef<EditorIdleCheck | null>(null)
  const idleRefs = useMemo(() => [idleRef, { current: null }] as const, [])
  const settlementRef = useRef<PageSettlement | null>(null)
  const flushBuffers = (path: string) => { flushes.push(path); flushRef.current?.(path) }
  const app = useAppSave({
    updateEntry: vi.fn(), setTabs, handleSwitchTab: vi.fn(), setToastMessage: vi.fn(), loadModifiedFiles: vi.fn(),
    clearUnsaved: vi.fn(), unsavedPaths: new Set(), tabs, activeTabPath: PATH, handleRenameNote: vi.fn(),
    handleRenameFilename: vi.fn(), replaceEntry: vi.fn(), resolvedPath: vault, initialH1AutoRenameEnabled: false,
    pageBusyMessage: 'busy', flushEditorBuffers: flushBuffers,
  })
  const pane = usePaneSettlement({ paths: [shown ? PATH : null, null], onContentChange: app.handleContentChange, idleRefs,
    closePageAndReserveOpen: () => { setShown(false); return null }, settlementRef })
  const actions = useSaveHoldActions({ recovery: app.saveRecovery, flushBuffers, settlementRef, clearUnsaved, onCopyCreated: vi.fn(),
    addEntry: vi.fn(), notify, pageTitle: () => 'Plan', locale: 'en' })
  // Like the app, a reopened page reads its file again.
  const reopen = () => { setTabs(current => [{ ...current[0], content: disk.get(PATH)! }]); setShown(true) }
  onState({ app, actions, shown, reopen, setVault })
  if (!shown) return null
  const Pane = kind === 'raw' ? RawPane : RichPane
  return <Pane tab={tabs[0]} change={pane.contentChanges[0]} flush={flushRef} idle={idleRef} />
}

beforeEach(() => {
  vi.useFakeTimers()
  disk.set(PATH, DISK)
  calls.length = 0
  saves = 'lost'
  duringChoice = () => {}
  notify.mockReset()
  clearUnsaved.mockReset()
  flushes.length = 0
  vi.mocked(invoke).mockImplementation(async (cmd: string, raw?: unknown) => {
    const args = (raw ?? {}) as { request?: { path: string }; content?: string; actionId?: string }
    calls.push({ cmd, args })
    if (cmd === 'save_page_content') {
      if (saves === 'lost') throw new Error('no reply')
      if (saves === 'refuse') return { status: 'refused', reason: 'stageFailed' }
      disk.set(args.request!.path, args.content!)
      return { status: 'committed', written: true, durable: true, history: null }
    }
    if (cmd === 'discard_hold' || cmd === 'release_hold_with_copy') {
      duringChoice()
      return { status: 'resolved', actionId: args.actionId, holdRetired: true, leftovers: [] }
    }
    if (cmd === 'save_draft_as_new_page') return { status: 'created', path: '/vault/plan copy.md', relativePath: 'plan copy.md', durable: true }
    return null
  })
})
afterEach(() => { vi.useRealTimers() })

const cmView = (container: HTMLElement) => (container.querySelector('[data-testid="raw-editor-codemirror"]') as HTMLElement & { __cmView: EditorView }).__cmView
const settleTime = () => act(async () => { await vi.advanceTimersByTimeAsync(3_000) })
const pageSaves = () => calls.filter(call => call.cmd === 'save_page_content').map(call => call.args.content as string)

async function holdWithWords(kind: Kind) {
  const view = render(<Workspace kind={kind} onState={next => { h = next }} />)
  type(kind, view.container, '\nheld words')
  await settleTime()
  expect(h.actions.snapshot.holds).toHaveLength(1)
  return view
}

function typeNow(kind: Kind, container: HTMLElement, text: string) {
  if (kind === 'rich') return typer(text)
  const cm = cmView(container)
  cm.dispatch({ changes: { from: cm.state.doc.length, insert: text } })
}
const type = (kind: Kind, container: HTMLElement, text: string) => act(() => typeNow(kind, container, text))

async function choose(kind: 'discard' | 'keepCopy') {
  await act(async () => {
    const running = h.actions.finish(PATH, kind)
    await vi.advanceTimersByTimeAsync(10)
    await running
  })
}

it.each<Kind>(['raw', 'rich'])('discards %s words: the page closes, its late writes are refused, and it saves normally once reopened', async kind => {
  const { container } = await holdWithWords(kind)
  const before = pageSaves().length
  // A change landing after the choice, so the closing editor's own timer or unmount tries to send it.
  notify.mockImplementationOnce(() => typeNow(kind, container, '\nlate'))
  await choose('discard')

  expect(h.shown).toBe(false)
  expect(notify).toHaveBeenCalledWith('Discarded the unsaved changes to “Plan”.')
  expect(h.actions.snapshot.holds).toHaveLength(0)
  expect(h.actions.blockedPaths.size).toBe(0)
  await act(async () => { await h.app.handleSave() })
  await settleTime()
  expect(pageSaves()).toHaveLength(before)
  expect(disk.get(PATH)).toBe(DISK)

  saves = 'commit'
  act(() => h.reopen())
  type(kind, container, '\nfresh')
  await settleTime()
  expect(disk.get(PATH)).toBe(`${DISK}\nfresh`)
})

it.each<Kind>(['raw', 'rich'])('keeps %s words written during the choice: nothing settles, and they are in the next copy', async kind => {
  const { container } = await holdWithWords(kind)
  duringChoice = () => type(kind, container, '\nnewer')
  await choose('discard')

  expect(h.shown).toBe(true)
  expect(h.actions.viewFor(PATH).notice?.key).toBe('saveHold.newerWords')
  expect(h.actions.snapshot.holds).toHaveLength(1)
  await settleTime()
  await act(async () => { await h.actions.saveCopy(PATH, null) })
  const copy = calls.find(call => call.cmd === 'save_draft_as_new_page')
  expect(copy?.args.draft).toMatchObject({ content: `${DISK}\nheld words\nnewer` })
})

it('stops at once while closing holds the page, and gives the pane back', async () => {
  await holdWithWords('raw')
  const reopen = h.app.holdMutationAdmission()
  await choose('discard')

  expect(h.actions.viewFor(PATH).notice?.key).toBe('saveHold.tryAgain')
  expect(h.actions.blockedPaths.size).toBe(0)
  expect(calls.some(call => call.cmd === 'discard_hold')).toBe(false)
  reopen()
})

// Seam: a final choice waits for an import before it binds. Catches that wait outliving the page it was made for,
// so the choice settles a later save, a later vault visit or a newer record the person never saw.
async function choiceWaitingForImport() {
  saves = 'refuse'
  const view = render(<Workspace kind="raw" onState={next => { h = next }} />)
  type('raw', view.container, '\nheld words')
  await settleTime()
  expect(h.actions.snapshot.retriable).toHaveLength(1)
  let releaseImport = () => {}
  void trackEditorWork(new Promise<void>(resolve => { releaseImport = resolve }))
  let choice = Promise.resolve()
  act(() => { choice = h.actions.finish(PATH, 'discard') })
  const finishChoice = () => act(async () => { releaseImport(); await vi.advanceTimersByTimeAsync(10); await choice })
  return { container: view.container, finishChoice }
}
const newestRequest = () => h.actions.snapshot.retriable[0]?.request.requestId

it('leaves a page that saved and came back after a vault switch alone', async () => {
  const { container, finishChoice } = await choiceWaitingForImport()
  saves = 'commit'
  await act(async () => { await h.app.handleSave() })
  act(() => h.setVault('/other'))
  act(() => h.setVault('/vault'))
  saves = 'refuse'
  type('raw', container, '\nnew visit')
  await settleTime()
  const returned = newestRequest()
  expect(returned).toBeDefined()
  const flushed = flushes.length
  await finishChoice()

  expect(flushes).toHaveLength(flushed)
  expect(calls.some(call => call.cmd === 'discard_hold')).toBe(false)
  expect(h.shown).toBe(true)
  expect(clearUnsaved).not.toHaveBeenCalled()
  expect(newestRequest()).toBe(returned)
  expect(cmView(container).state.doc.toString()).toBe(`${DISK}\nheld words\nnew visit`)
  expect(h.actions.blockedPaths.size).toBe(0)
  expect(h.actions.viewFor(PATH)).toMatchObject({ busy: null, notice: null })
})

it('does not settle a newer record that replaced the one shown in the same session', async () => {
  const { container, finishChoice } = await choiceWaitingForImport()
  const shown = newestRequest()
  type('raw', container, '\nnewer')
  await settleTime()
  expect(newestRequest()).not.toBe(shown)
  await finishChoice()

  expect(calls.some(call => call.cmd === 'discard_hold')).toBe(false)
  expect(h.shown).toBe(true)
  expect(h.actions.viewFor(PATH).notice?.key).toBe('saveHold.tryAgain')
  expect(h.actions.blockedPaths.size).toBe(0)
})
