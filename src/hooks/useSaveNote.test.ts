import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { checkSaveOutcome, useSaveNote } from './useSaveNote'
import { clearNoteContentCache, getCachedNoteContentEntry } from './noteContentCache'

const mockInvokeFn = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>(() => Promise.resolve(null))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: (cmd: string, args?: Record<string, unknown>) => mockInvokeFn(cmd, args),
  updateMockContent: vi.fn(),
}))

// Seam: the page writer's transport. Anything but a known answer must read as no reply, never as saved.
const request = {
  requestId: '2b6f0c1e-6a59-4f6a-9d0e-6f1d1b2c3a4d', vaultPath: '/test', session: 's:0',
  path: '/test/note.md', seq: 1, submittedSha256: 'b'.repeat(64),
}
const COMMITTED = { status: 'committed', written: true, durable: true, history: null }

describe('useSaveNote', () => {
  let updateContent: (path: string, content: string) => void

  beforeEach(() => {
    updateContent = vi.fn<(path: string, content: string) => void>()
    mockInvokeFn.mockReset()
    clearNoteContentCache()
  })

  it('sends the exact request and content and returns the parsed outcome without touching memory', async () => {
    mockInvokeFn.mockResolvedValue(COMMITTED)
    const { result } = renderHook(() => useSaveNote(updateContent))

    let outcome: unknown
    await act(async () => { outcome = await result.current.saveNote(request, '# Test') })

    expect(mockInvokeFn).toHaveBeenCalledWith('save_page_content', { request, content: '# Test' })
    expect(outcome).toEqual(COMMITTED)
    expect(updateContent).not.toHaveBeenCalled()
  })

  it.each([
    ['a rejected invoke', () => mockInvokeFn.mockRejectedValue(new Error('IPC closed'))],
    ['an unknown shape', () => mockInvokeFn.mockResolvedValue({ status: 'saved' })],
  ])('turns %s into no reply instead of throwing', async (_case, arrange) => {
    arrange()
    const { result } = renderHook(() => useSaveNote(updateContent))
    expect(await result.current.saveNote(request, 'content')).toBeNull()
    expect(await checkSaveOutcome(request)).toBeNull()
    expect(updateContent).not.toHaveBeenCalled()
  })

  it('records committed bytes in memory and the note-open cache only when asked', async () => {
    const { result } = renderHook(() => useSaveNote(updateContent))

    act(() => { result.current.commitSaved('/test/swap.md', '# Draft saved before swapping tabs') })

    expect(updateContent).toHaveBeenCalledWith('/test/swap.md', '# Draft saved before swapping tabs')
    expect(getCachedNoteContentEntry('/test/swap.md')?.value).toBe('# Draft saved before swapping tabs')
  })
})
