// Amendment B §3: words still in the renamed page's rich or raw editor buffer (debounce not yet
// fired) when the rename's reply arrives. The editor is registered under the old path until React
// renders again, so routing must take its words first; otherwise settlement shows the receipt's
// text and the old-base words land later and restore the old title.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import type { EditorView } from '@codemirror/view'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { invoke, type InvokeArgs } from '@tauri-apps/api/core'
import { useAppSave } from './useAppSave'
import { AUTO_SAVE_DEBOUNCE_MS } from './useEditorSave'
import { RICH_EDITOR_CHANGE_DEBOUNCE_MS, useDebouncedEditorChange } from './editorChangeDebounce'
import { useRegisterEditorContentFlushes } from '../components/editorContentFlushRegistration'
import { RawEditorView } from '../components/RawEditorView'
import { runManagedRename } from '../leadinglight/rename/managedRename'
import type { VaultEntry } from '../types'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({ isTauri: () => true, mockInvoke: vi.fn(), updateMockContent: vi.fn() }))
vi.mock('../leadinglight/saveOutcome', async importOriginal => ({
  ...await importOriginal<typeof import('../leadinglight/saveOutcome')>(),
  sha256Hex: async () => 'a'.repeat(64),
}))

const OLD = '/vault/plan.md'
const NEW = '/vault/roadmap.md'
const BEFORE = '# Plan\n\nBody.\n'
const AFTER = '# Roadmap\n\nBody.\n'
const TYPED = `${BEFORE}Typed while renaming.\n`

const disk = new Map<string, string>()
const writes: { path: string; content: string }[] = []

interface Tab { entry: VaultEntry; content: string }
type App = ReturnType<typeof useAppSave>

function entry(path: string): VaultEntry {
  return { path, title: 'Plan', filename: path.split('/').pop(), isA: 'Note' } as unknown as VaultEntry
}

beforeEach(() => {
  vi.useFakeTimers()
  disk.clear()
  writes.length = 0
  disk.set(OLD, BEFORE)
  vi.mocked(invoke).mockImplementation(async (cmd: string, raw?: InvokeArgs) => {
    const args = (raw ?? {}) as { path: string; request: { path: string }; content: string }
    if (cmd === 'save_page_content') {
      writes.push({ path: args.request.path, content: args.content })
      disk.set(args.request.path, args.content)
      return { status: 'committed', written: true, durable: true, history: null }
    }
    if (cmd === 'get_note_content') return disk.get(args.path) ?? ''
    return null
  })
})
afterEach(() => { vi.useRealTimers() })

interface PaneProps {
  tab: Tab
  onContentChange: App['handleContentChange']
  richFlushRef: React.MutableRefObject<((path: string) => void) | null>
  rawFlushRef: React.MutableRefObject<((path: string) => void) | null>
}

const typeRich: { current: ((text: string) => void) | null } = { current: null }

/** The rich editor's own pieces: its document, its debounce and its registered flushers. */
function RichPane({ tab, onContentChange, richFlushRef, rawFlushRef }: PaneProps) {
  const documentText = useRef(tab.content)
  const suppress = useRef(false)
  const rawLatest = useRef<string | null>(null)
  const onFlush = useCallback(() => { onContentChange(tab.entry.path, documentText.current) }, [onContentChange, tab.entry.path])
  const { handleEditorChange, flushPendingEditorChange, hasPendingEditorChange } = useDebouncedEditorChange({ onFlush, suppressChangeRef: suppress })
  useRegisterEditorContentFlushes({
    activeTab: tab, flushPendingEditorChange, flushPendingEditorContentRef: richFlushRef, rawLatestContentRef: rawLatest,
    rawMode: false, onContentChange, flushPendingRawContentRef: rawFlushRef, hasPendingEditorChange,
  })
  useLayoutEffect(() => {
    typeRich.current = text => { documentText.current = text; handleEditorChange() }
  }, [handleEditorChange])
  return null
}

/** The actual raw editor with its own debounce, registered the way Editor registers it. */
function RawPane({ tab, onContentChange, richFlushRef, rawFlushRef }: PaneProps) {
  const rawLatest = useRef<string | null>(null)
  useRegisterEditorContentFlushes({
    activeTab: tab, flushPendingEditorChange: () => false, flushPendingEditorContentRef: richFlushRef, rawLatestContentRef: rawLatest,
    rawMode: true, onContentChange, flushPendingRawContentRef: rawFlushRef,
  })
  return <RawEditorView content={tab.content} path={tab.entry.path} entries={[]} onContentChange={onContentChange} onSave={vi.fn()} latestContentRef={rawLatest} />
}

const harness: { app: App | null; tabs: Tab[]; setTabs: (update: (tabs: Tab[]) => Tab[]) => void } = { app: null, tabs: [], setTabs: () => {} }
let reply: (receipt: unknown) => void = () => {}

function Harness({ mode }: { mode: 'rich' | 'raw' }) {
  const [tabs, setTabs] = useState<Tab[]>([{ entry: entry(OLD), content: BEFORE }])
  const richFlushRef = useRef<((path: string) => void) | null>(null)
  const rawFlushRef = useRef<((path: string) => void) | null>(null)
  // Like App: every registered rich and raw buffer for this exact path.
  const flushEditorBuffers = useCallback((path: string) => {
    richFlushRef.current?.(path)
    rawFlushRef.current?.(path)
  }, [])
  const app = useAppSave({
    updateEntry: vi.fn(), setTabs, handleSwitchTab: vi.fn(), setToastMessage: vi.fn(), loadModifiedFiles: vi.fn(), clearUnsaved: vi.fn(),
    unsavedPaths: new Set(), tabs, activeTabPath: tabs[0].entry.path, handleRenameNote: vi.fn(), handleRenameFilename: vi.fn(),
    replaceEntry: vi.fn(), resolvedPath: '/vault', initialH1AutoRenameEnabled: false, pageBusyMessage: 'busy', flushEditorBuffers,
  })
  useLayoutEffect(() => {
    harness.app = app
    harness.tabs = tabs
    harness.setTabs = setTabs
  }, [app, tabs])
  const Pane = mode === 'rich' ? RichPane : RawPane
  return <Pane tab={tabs[0]} onContentChange={app.handleContentChange} richFlushRef={richFlushRef} rawFlushRef={rawFlushRef} />
}

/** A manual title rename through the real barrier and managed flow, routed like the rename handler. */
function startRename(): Promise<void> {
  const app = harness.app!
  const tabsRef = { get current() { return harness.tabs } }
  return app.withManualRename(OLD, async () => {
    await runManagedRename({
      sourcePath: OLD,
      vaultPath: '/vault',
      oldTitle: 'Plan',
      destination: { siblingOf: OLD },
      sourceBaseline: BEFORE,
      dispatch: () => new Promise(resolve => { reply = resolve }),
      route: (oldPath, newPath) => {
        app.trackRenamedPath(oldPath, newPath)
        harness.setTabs(previous => previous.map(tab => tab.entry.path === oldPath ? { ...tab, entry: entry(newPath) } : tab))
      },
    }, {
      mutateExistingDocument: app.mutateExistingDocument,
      rebaseHeldDraft: app.rebaseHeldDraft,
      tabsRef,
      setTabs: update => harness.setTabs(update),
      linkedPaths: () => [],
    })
  })
}

/** Native's side of the rename: the page is published at its new path with the new title line. */
function answerRename() {
  disk.delete(OLD)
  disk.set(NEW, AFTER)
  reply({ new_path: NEW, updated_files: 0, failed_updates: 0, source_before_content: BEFORE, source_content: AFTER,
    updated_open_pages: [], unrefreshed_open_paths: [] })
}

async function settle(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

describe.each(['rich', 'raw'] as const)('%s editor words still in its buffer when the rename answers', mode => {
  it('join the held text before routing, take the new title and save at the new path', async () => {
    render(<Harness mode={mode} />)
    const renaming = startRename()
    await settle()
    // Typed under the rename's hold; the editor's own debounce has not fired yet.
    if (mode === 'rich') act(() => { typeRich.current!(TYPED) })
    else {
      const view = (screen.getByTestId('raw-editor-codemirror') as HTMLElement & { __cmView: EditorView }).__cmView
      act(() => { view.dispatch({ changes: { from: view.state.doc.length, insert: 'Typed while renaming.\n' }, userEvent: 'input.type' }) })
    }
    expect(writes).toEqual([])
    await act(async () => { answerRename() })
    await act(async () => { await renaming })
    await settle(Math.max(RICH_EDITOR_CHANGE_DEBOUNCE_MS, AUTO_SAVE_DEBOUNCE_MS) * 3)
    expect(disk.has(OLD)).toBe(false)
    expect(disk.get(NEW)).toBe(`${AFTER}Typed while renaming.\n`)
    expect(writes.every(write => write.path === NEW)).toBe(true)
    expect(harness.tabs[0]).toMatchObject({ entry: { path: NEW }, content: `${AFTER}Typed while renaming.\n` })
  })
})
