import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { useRef, useState } from 'react'
import { runScopeHandlers, type EditorView } from '@codemirror/view'
import { invoke } from '@tauri-apps/api/core'
import { RawEditorView } from './RawEditorView'
import { useRegisterEditorContentFlushes } from './editorContentFlushRegistration'
import { useAppSave } from '../hooks/useAppSave'
import { AUTO_SAVE_DEBOUNCE_MS } from '../hooks/useEditorSave'
import { propertyChange } from '../hooks/frontmatterOps'
import type { VaultEntry } from '../types'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({ isTauri: () => true, mockInvoke: vi.fn(), updateMockContent: vi.fn() }))

const PATH = '/vault/plan.md'
const disk = new Map<string, string>()
let release: () => void = () => {}

type App = ReturnType<typeof useAppSave>

// The real raw editor, its registered flush and the save coordinator, wired like the app does.
function Page({ onApp, raw = true }: { onApp: (app: App) => void; raw?: boolean }) {
  const [tabs, setTabs] = useState([{ entry: { path: PATH, title: 'Plan', filename: 'plan.md' } as VaultEntry, content: disk.get(PATH)! }])
  const rawLatestContentRef = useRef<string | null>(null)
  const flushRawRef = useRef<((path: string) => void) | null>(null)
  const app = useAppSave({
    updateEntry: vi.fn(), setTabs, handleSwitchTab: vi.fn(), setToastMessage: vi.fn(), loadModifiedFiles: vi.fn(),
    clearUnsaved: vi.fn(), unsavedPaths: new Set(), tabs, activeTabPath: PATH, handleRenameNote: vi.fn(),
    handleRenameFilename: vi.fn(), replaceEntry: vi.fn(), resolvedPath: '/vault', initialH1AutoRenameEnabled: false,
    pageBusyMessage: 'busy', flushEditorBuffers: path => flushRawRef.current?.(path),
  })
  onApp(app)
  useRegisterEditorContentFlushes({
    activeTab: tabs[0], flushPendingEditorChange: () => false, rawLatestContentRef, rawMode: raw,
    onContentChange: app.handleContentChange, flushPendingRawContentRef: flushRawRef,
  })
  return raw ? <RawEditorView content={tabs[0].content} path={PATH} entries={[]} onContentChange={app.handleContentChange} onSave={() => { void app.handleSave() }} latestContentRef={rawLatestContentRef} /> : null
}

beforeEach(() => {
  vi.useFakeTimers()
  disk.set(PATH, '---\ntitle: Plan\n---\nbody')
  const held = new Promise<void>(resolve => { release = resolve })
  vi.mocked(invoke).mockImplementation(async (cmd: string, raw?: unknown) => {
    const args = raw as { path: string; content: string; request: { path: string } }
    if (cmd === 'save_page_content') {
      disk.set(args.request.path, args.content)
      return { status: 'committed', written: true, durable: true, history: null }
    }
    if (cmd === 'update_frontmatter') {
      const after = disk.get(args.path)!.replace('\n---\n', '\nstatus: done\n---\n') // read first, write later
      await held
      disk.set(args.path, after)
      return after
    }
    return null
  })
})
afterEach(() => { vi.useRealTimers() })

const cmView = (container: HTMLElement) => (container.querySelector('[data-testid="raw-editor-codemirror"]') as HTMLElement & { __cmView: EditorView }).__cmView
const writeStatus = (app: App) => act(() => { void app.runPageExclusive(PATH, async mutate => (mutate(PATH, propertyChange('update', 'status', 'done')), true)) })

it('keeps a property settled while raw text was still on its own timer', async () => {
  let app!: App
  const { container } = render(<Page onApp={next => { app = next }} />)
  const view = cmView(container)
  writeStatus(app)
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  act(() => { view.dispatch({ changes: { from: view.state.doc.length, insert: '\nnew words' } }) })
  await act(async () => { release(); await vi.advanceTimersByTimeAsync(0) })
  await act(async () => { await vi.advanceTimersByTimeAsync(500 + AUTO_SAVE_DEBOUNCE_MS + 50) })

  const settled = '---\ntitle: Plan\nstatus: done\n---\nbody\nnew words'
  expect(view.state.doc.toString()).toBe(settled)
  expect(disk.get(PATH)).toBe(settled)
})

it.each(['closes', 'saves'])('keeps a settled property when the raw editor %s after its own timer already ran', async how => {
  let app!: App
  const onApp = (next: App) => { app = next }
  const { container, rerender } = render(<Page onApp={onApp} />)
  const view = cmView(container)
  act(() => { view.dispatch({ changes: { from: view.state.doc.length, insert: '\nnew words' } }) })
  await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  writeStatus(app)
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  await act(async () => { release(); await vi.advanceTimersByTimeAsync(0) })

  const settled = '---\ntitle: Plan\nstatus: done\n---\nbody\nnew words'
  expect(view.state.doc.toString()).toBe(settled)
  if (how === 'closes') rerender(<Page onApp={onApp} raw={false} />)
  else {
    const mac = /Mac/.test(navigator.platform)
    act(() => { expect(runScopeHandlers(view, new KeyboardEvent('keydown', { key: 's', ctrlKey: !mac, metaKey: mac }), 'editor')).toBe(true) })
  }
  await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS + 50) })
  expect(disk.get(PATH)).toBe(settled)
})
