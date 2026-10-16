import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { VaultEntry } from '../types'
import { useNoteActions, type NoteActionsConfig } from './useNoteActions'
import { deleteMockFrontmatterProperty } from './mockFrontmatterHelpers'
import type { MutateExistingDocument, RunManualRename, RunPageExclusive } from './useAppSave'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({
  isTauri: vi.fn(() => false),
  addMockEntry: vi.fn(),
  updateMockContent: vi.fn(),
  trackMockChange: vi.fn(),
  mockInvoke: vi.fn().mockResolvedValue(''),
}))
vi.mock('./mockFrontmatterHelpers', () => ({
  updateMockFrontmatter: vi.fn().mockReturnValue('---\ntitle: New Name\n---\n# New Name\n'),
  deleteMockFrontmatterProperty: vi.fn().mockReturnValue('---\n---\n'),
}))

function makeEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    path: '/vault/old-name.md',
    filename: 'old-name.md',
    title: 'Old Name',
    isA: 'Note',
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: 'Active',
    archived: false,
    modifiedAt: 1700000000,
    createdAt: 1700000000,
    fileSize: 100,
    snippet: '',
    wordCount: 0,
    relationships: {},
    icon: null,
    color: null,
    order: null,
    outgoingLinks: [],
    template: null,
    sort: null,
    sidebarLabel: null,
    view: null,
    visible: null,
    properties: {},
    organized: false,
    favorite: false,
    favoriteIndex: null,
    listPropertiesDisplay: [],
    hasH1: false,
    ...overrides,
  }
}

function makeConfig(
  entry: VaultEntry,
  overrides: Partial<NoteActionsConfig> = {},
): NoteActionsConfig {
  return {
    addEntry: vi.fn(),
    removeEntry: vi.fn(),
    entries: [entry],
    setToastMessage: vi.fn(),
    updateEntry: vi.fn(),
    vaultPath: '/vault',
    ...overrides,
  }
}

describe('useNoteActions title rename guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(false)
  })

  it('flushes pending editor work before renaming through the title property', async () => {
    const entry = makeEntry()
    const events: string[] = []
    const flushBeforeNoteMutation = vi.fn(async (path: string) => {
      events.push(`flush:${path}`)
    })

    vi.mocked(mockInvoke).mockImplementation(async (command: string) => {
      if (command === 'rename_note') {
        events.push('rename')
        return { new_path: '/vault/new-name.md', updated_files: 0 }
      }
      if (command === 'get_note_content') return '---\ntitle: New Name\n---\n# New Name\n'
      return ''
    })

    const { result } = renderHook(() => useNoteActions(makeConfig(entry, { flushBeforeNoteMutation })))

    await act(async () => {
      result.current.handleSelectNote(entry)
    })

    await act(async () => {
      await result.current.handleUpdateFrontmatter(entry.path, 'title', 'New Name')
    })

    expect(flushBeforeNoteMutation).toHaveBeenCalledTimes(1)
    expect(flushBeforeNoteMutation).toHaveBeenCalledWith(entry.path)
    expect(events).toEqual([`flush:${entry.path}`, 'rename'])
  })

  it('stops the title rename flow when pending editor work fails to flush', async () => {
    const entry = makeEntry()
    const flushBeforeNoteMutation = vi.fn().mockRejectedValue(new Error('disk full'))
    const updateEntry = vi.fn()

    const { result } = renderHook(() => useNoteActions(makeConfig(entry, {
      flushBeforeNoteMutation,
      updateEntry,
    })))

    await act(async () => {
      await result.current.handleUpdateFrontmatter(entry.path, 'title', 'New Name')
    })

    expect(mockInvoke).not.toHaveBeenCalledWith('rename_note', expect.anything())
    expect(updateEntry).not.toHaveBeenCalledWith(entry.path, expect.objectContaining({ title: 'New Name' }))
  })
})

describe('property writes through the page save queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(false)
  })

  /** Admits the real property change and reports it written at `written`. */
  function pageQueue(events: string[], written: string, integration: 'none' | 'unmergedDraft' = 'none') {
    let claimed = false
    const mutate: MutateExistingDocument = (path, mutation) => {
      events.push(`write:${path}`)
      const done = mutation.publish(written).then(result =>
        ({ kind: 'returned' as const, path: written, result, current: true, integration, latest: null }))
      return { admitted: true, path: written, done }
    }
    return {
      runPageExclusive: vi.fn<RunPageExclusive>(async (_path, work) => {
        claimed = true
        try { return await work(mutate) } finally { claimed = false }
      }),
      runManualRename: vi.fn<RunManualRename>(async (path, rename) => {
        events.push(`barrier:${path}:${claimed ? 'claimed' : 'free'}`)
        await rename()
      }),
    }
  }

  it('renames a retitled page after its claim ends, on the written path, saving its text first', async () => {
    const entry = makeEntry()
    const events: string[] = []
    const flushBeforeNoteMutation = vi.fn(async (path: string) => { events.push(`flush:${path}`) })
    vi.mocked(mockInvoke).mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'rename_note') {
        events.push(`rename:${String(args?.old_path)}`)
        return { new_path: '/vault/new-name.md', updated_files: 0 }
      }
      return command === 'get_note_content' ? '---\ntitle: New Name\n---\n# New Name\n' : ''
    })
    const queue = pageQueue(events, '/vault/settled.md')
    const { result } = renderHook(() => useNoteActions(makeConfig(entry, { ...queue, flushBeforeNoteMutation })))

    await act(async () => { await result.current.handleUpdateFrontmatter(entry.path, 'title', 'New Name') })

    expect(events).toEqual([
      `write:${entry.path}`,
      'barrier:/vault/settled.md:free',
      'flush:/vault/settled.md',
      'rename:/vault/settled.md',
    ])
  })

  it('undoes an added property with a delete through the page queue', async () => {
    const entry = makeEntry()
    const events: string[] = []
    const queue = pageQueue(events, entry.path)
    const { result } = renderHook(() => useNoteActions(makeConfig(entry, queue)))
    await act(async () => { result.current.handleSelectNote(entry) })

    await act(async () => { await result.current.handleAddProperty(entry.path, 'priority', 'high') })
    await act(async () => { await result.current.handleUndo() })

    expect(events).toEqual([`write:${entry.path}`, `write:${entry.path}`])
    expect(deleteMockFrontmatterProperty).toHaveBeenCalledWith(entry.path, 'priority')
  })

  it('says newer edits are held when the written property could not join them', async () => {
    const entry = makeEntry()
    const setToastMessage = vi.fn()
    const queue = pageQueue([], entry.path, 'unmergedDraft')
    const { result } = renderHook(() => useNoteActions(makeConfig(entry, { ...queue, setToastMessage })))

    await act(async () => { await result.current.handleAddProperty(entry.path, 'priority', 'high') })

    expect(setToastMessage).toHaveBeenLastCalledWith("Can't save yet. Fix the page's properties first. Your edits are kept.")
  })
})
