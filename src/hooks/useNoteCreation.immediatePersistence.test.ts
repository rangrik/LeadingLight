import { act, renderHook, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isTauri } from '../mock-tauri'
import type { VaultEntry } from '../types'
import type { FocusEventDetail } from './useEditorFocus'
import type { NoteCreationConfig } from './useNoteCreation'
import { useNoteCreation } from './useNoteCreation'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({
  isTauri: vi.fn(() => false),
  addMockEntry: vi.fn(),
  updateMockContent: vi.fn(),
  trackMockChange: vi.fn(),
  mockInvoke: vi.fn().mockResolvedValue(''),
}))

describe('immediate note persistence', () => {
  const addEntry = vi.fn()
  const removeEntry = vi.fn()
  const setToastMessage = vi.fn()
  const openTabWithContent = vi.fn()
  const makeConfig = (): NoteCreationConfig => ({
    addEntry,
    removeEntry,
    entries: [],
    setToastMessage,
    vaultPath: '/test/vault',
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(false)
  })

  it('creates the backing file before opening the note', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockResolvedValueOnce(undefined)
    const addPendingSave = vi.fn()
    const removePendingSave = vi.fn()
    const onNewNotePersisted = vi.fn()
    const config = {
      ...makeConfig(),
      addPendingSave,
      removePendingSave,
      onNewNotePersisted,
    }
    const { result } = renderHook(() => useNoteCreation(config, { openTabWithContent }))

    act(() => { result.current.handleCreateNoteImmediate() })
    await waitFor(() => { expect(addEntry).toHaveBeenCalledOnce() })

    const createdPath = expect.stringMatching(/untitled-note-\d+\.md$/)
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('create_note_content', {
      path: createdPath,
      content: expect.stringContaining('type: Note'),
      vaultPath: '/test/vault',
    })
    expect(addPendingSave).toHaveBeenCalledWith(createdPath)
    expect(removePendingSave).toHaveBeenCalledWith(createdPath)
    expect(onNewNotePersisted).toHaveBeenCalledWith(createdPath)
    expect(openTabWithContent).toHaveBeenCalledOnce()
    expect(vi.mocked(invoke).mock.invocationCallOrder[0]).toBeLessThan(
      openTabWithContent.mock.invocationCallOrder[0],
    )
  })

  it('does not open an optimistic note when disk creation fails', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockRejectedValueOnce(new Error('disk full'))
    const { result } = renderHook(() => useNoteCreation(makeConfig(), { openTabWithContent }))

    act(() => { result.current.handleCreateNoteImmediate() })
    await waitFor(() => {
      expect(setToastMessage).toHaveBeenCalledWith('Failed to create note — disk write error')
    })

    expect(addEntry).not.toHaveBeenCalled()
    expect(openTabWithContent).not.toHaveBeenCalled()
  })

  it('requests editor focus for the new path', async () => {
    const focusEvent = new Promise<CustomEvent>((resolve) => {
      window.addEventListener(
        'laputa:focus-editor',
        (event) => { resolve(event as CustomEvent) },
        { once: true },
      )
    })
    const { result } = renderHook(() => useNoteCreation(makeConfig(), { openTabWithContent }))

    act(() => { result.current.handleCreateNoteImmediate() })
    const event = await focusEvent

    expect(event.detail.path).toMatch(/\/test\/vault\/untitled-note-\d+\.md$/)
    expect(event.detail.selectTitle).toBe(true)
  })

  describe('plain New page', () => {
    // A Note type with a template must not leak into an ordinary capture.
    const noteType = {
      path: '/test/vault/note.md', filename: 'note.md', title: 'Note', isA: 'Type', template: '## Agenda\n',
    } as VaultEntry
    const focusDetail = () => new Promise<FocusEventDetail>((resolve) => {
      window.addEventListener('laputa:focus-editor', (event) => { resolve((event as CustomEvent).detail) }, { once: true })
    })

    it('writes an empty untyped page and puts the caret in the body', async () => {
      vi.mocked(isTauri).mockReturnValue(true)
      vi.mocked(invoke).mockResolvedValueOnce(undefined)
      const focus = focusDetail()
      const { result } = renderHook(() => useNoteCreation({ ...makeConfig(), entries: [noteType] }, { openTabWithContent }))

      act(() => { result.current.handleCreateNoteImmediate(undefined, { plain: true }) })
      const detail = await focus

      expect(vi.mocked(invoke)).toHaveBeenCalledWith('create_note_content', {
        path: expect.stringMatching(/\/test\/vault\/untitled-page-\d+\.md$/),
        content: '',
        vaultPath: '/test/vault',
      })
      expect(addEntry).toHaveBeenCalledWith(expect.objectContaining({ isA: null, titleSource: 'filename' }))
      expect(detail.selectTitle).toBe(false)
    })

    // Seam: the draft field must tell a failed write, a page made but not shown, and a shown page apart.
    describe('with a draft field', () => {
      const report = () => ({ failed: vi.fn(), created: vi.fn(), shown: vi.fn() })
      const target = (shown: boolean) => ({ inSession: () => true, isActive: () => true, open: vi.fn(async () => shown) })

      it('reports a refused write, then a fresh name that is shown, without a background focus request', async () => {
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(invoke).mockRejectedValueOnce(new Error('disk refused')).mockResolvedValue(undefined)
        const requests: unknown[] = []
        const listen = (event: Event) => requests.push(event)
        window.addEventListener('laputa:focus-editor', listen)
        const { result } = renderHook(() => useNoteCreation(makeConfig(), { openTabWithContent, reserveOpen: () => target(true) }))
        const first = report()
        const second = report()

        act(() => { result.current.handleCreateNoteImmediate(undefined, { plain: true, onOutcome: first }) })
        await waitFor(() => { expect(first.failed).toHaveBeenCalledOnce() })
        act(() => { result.current.handleCreateNoteImmediate(undefined, { plain: true, onOutcome: second }) })
        await waitFor(() => { expect(second.shown).toHaveBeenCalledOnce() })
        await new Promise(resolve => setTimeout(resolve, 0))
        window.removeEventListener('laputa:focus-editor', listen)

        const [refused, created] = vi.mocked(invoke).mock.calls.map(call => (call[1] as { path: string }).path)
        expect(second.shown).toHaveBeenCalledWith(created)
        expect(created).not.toBe(refused)
        expect(requests).toEqual([])
      })

      it('reports a page written but not shown as created', async () => {
        const outcome = report()
        const { result } = renderHook(() => useNoteCreation(makeConfig(), { openTabWithContent, reserveOpen: () => target(false) }))
        act(() => { result.current.handleCreateNoteImmediate(undefined, { plain: true, onOutcome: outcome }) })
        await waitFor(() => { expect(outcome.created).toHaveBeenCalledWith(expect.stringMatching(/untitled-page-\d+\.md$/)) })
        expect(outcome.shown).not.toHaveBeenCalled()
      })
    })

    // Seam: an explicit type, folder or sheet keeps its own route even if plain is also passed.
    it.each([
      ['type', 'Project', {}, /\/untitled-project-\d+\.md$/, 'type: Project'],
      ['folder', undefined, { folderPath: 'inbox' }, /\/inbox\/untitled-note-\d+\.md$/, 'type: Note'],
      ['sheet', undefined, { format: 'sheet' as const }, /\/untitled-sheet-\d+\.md$/, '_display: sheet'],
    ])('keeps the contextual %s route', async (_name, type, options, path, content) => {
      vi.mocked(isTauri).mockReturnValue(true)
      vi.mocked(invoke).mockResolvedValueOnce(undefined)
      const { result } = renderHook(() => useNoteCreation(makeConfig(), { openTabWithContent }))

      act(() => { result.current.handleCreateNoteImmediate(type, { ...options, plain: true }) })
      await waitFor(() => { expect(addEntry).toHaveBeenCalledOnce() })

      expect(vi.mocked(invoke)).toHaveBeenCalledWith('create_note_content', expect.objectContaining({
        path: expect.stringMatching(path),
        content: expect.stringContaining(content),
      }))
    })
  })
})
