import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorEntryMetadataRequest } from '../hooks/editorEntryMetadata'
import { useEditorSaveWithLinks } from '../hooks/useEditorSaveWithLinks'
import type { VaultEntry } from '../types'
import { pageLabel } from './pageLabel'

// The two boundaries this test controls: a save that succeeded, and when the metadata worker answers.
const boundary = vi.hoisted(() => ({
  savedContent: null as ((path: string, content: string) => void) | null,
  requests: [] as { request: unknown, onResult: (metadata: object) => void, cancelled: boolean }[],
}))
vi.mock('../hooks/useEditorSave', () => ({
  useEditorSave: vi.fn((config: { updateVaultContent: (path: string, content: string) => void }) => {
    boundary.savedContent = config.updateVaultContent
    return { handleContentChange: vi.fn(), handleSave: vi.fn(), savePendingForPath: vi.fn() }
  }),
}))
vi.mock('../hooks/editorEntryMetadataWorkerClient', () => ({
  requestEditorEntryMetadata: (request: unknown, onResult: (metadata: object) => void) => {
    const pending = { request, onResult, cancelled: false }
    boundary.requests.push(pending)
    return () => { pending.cancelled = true }
  },
}))

const { deriveEditorEntryContentMetadata } = await vi.importActual<typeof import('../hooks/editorEntryMetadata')>('../hooks/editorEntryMetadata')
const PATH = '/vault/untitled-page-1797000000.md'
let entry: VaultEntry
let idle: IdleRequestCallback[] = []

// Runs scheduled syncs, then answers every request the hook did not cancel, newest first,
// so an older answer always arrives late.
function settle() {
  act(() => {
    const callbacks = idle
    idle = []
    callbacks.forEach(callback => callback({ didTimeout: false, timeRemaining: () => 50 }))
    const requests = boundary.requests.splice(0).reverse()
    for (const pending of requests) {
      if (!pending.cancelled) pending.onResult(deriveEditorEntryContentMetadata(pending.request as EditorEntryMetadataRequest))
    }
  })
}

describe('New page label freshness', () => {
  beforeEach(() => {
    idle = []
    boundary.requests = []
    vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => idle.push(callback))
    vi.stubGlobal('cancelIdleCallback', () => {})
    entry = { path: PATH, filename: 'untitled-page-1797000000.md', title: 'Untitled Page 1797000000', titleSource: 'filename', snippet: '' } as VaultEntry
  })
  afterEach(() => vi.unstubAllGlobals())

  function renderEditorSave() {
    const updateEntry = (path: string, patch: Partial<VaultEntry>) => { if (path === PATH) entry = { ...entry, ...patch } }
    return renderHook(() => useEditorSaveWithLinks({ updateEntry, setTabs: vi.fn(), setToastMessage: vi.fn(), onAfterSave: vi.fn() })).result
  }
  const label = () => pageLabel(entry, 'en')
  const save = (content: string) => { act(() => boundary.savedContent?.(PATH, content)); settle() }

  // Seam: the label is the last saved body, never a stale or unsaved one.
  it('follows the last saved body, and keeps it when a save fails', () => {
    const editor = renderEditorSave()
    expect(label()).toBe('Untitled')

    act(() => editor.current.handleContentChange(PATH, 'first thought'))
    settle()
    expect(label()).toBe('Untitled')
    save('first thought')
    expect(label()).toBe('first thought')

    save('second idea')
    expect(label()).toBe('second idea')

    // Typed but never saved: the label stays on what is on disk.
    act(() => editor.current.handleContentChange(PATH, 'unsaved words'))
    settle()
    expect(label()).toBe('second idea')

    save('')
    expect(label()).toBe('Untitled')
  })

  it('never lets an older metadata answer bring back an earlier body', () => {
    renderEditorSave()
    save('kept')
    act(() => boundary.savedContent?.(PATH, 'stale draft'))
    act(() => idle.splice(0).forEach(callback => callback({ didTimeout: false, timeRemaining: () => 50 })))
    // A newer save arrives while the older answer is still out.
    save('')
    expect(label()).toBe('Untitled')
    expect(entry.snippet).toBe('')
  })

  it('shows an authored title as soon as it is typed', () => {
    const editor = renderEditorSave()
    save('body text')
    act(() => editor.current.handleContentChange(PATH, '# Harbor plan\n\nbody text'))
    settle()
    expect(label()).toBe('Harbor plan')
  })
})
