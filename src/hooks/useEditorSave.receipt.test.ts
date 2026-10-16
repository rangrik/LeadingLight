import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEditorSave } from './useEditorSave'

const mockInvokeFn = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<null>>(() => Promise.resolve(null))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: (cmd: string, args?: Record<string, unknown>) => mockInvokeFn(cmd, args),
  updateMockContent: vi.fn(),
}))

const TODAY = '/vault/Daily/2026-10-15.md'

function renderQueue(initial: { scope?: string, renames?: Map<string, string> } = {}) {
  const renames = initial.renames ?? new Map<string, string>()
  return renderHook(({ scope }) => useEditorSave({
    updateVaultContent: vi.fn(), setTabs: vi.fn(), setToastMessage: vi.fn(),
    persistenceScope: scope, resolvePath: path => renames.get(path) ?? path,
  }), { initialProps: { scope: initial.scope ?? '/vault' } })
}

beforeEach(() => {
  mockInvokeFn.mockReset()
  mockInvokeFn.mockResolvedValue(null)
})

// Seam: a pending draft counts as delivered only on the queue's own record of these exact bytes, in this session.
describe('save queue admission receipt', () => {
  it('returns the canonical page, the full accepted text and its session, and nothing for a page it refuses', () => {
    const { result } = renderQueue({ renames: new Map([['/vault/old.md', '/vault/new.md']]) })
    let receipt: ReturnType<typeof result.current.handleContentChange> = null
    act(() => { receipt = result.current.handleContentChange('/vault/old.md', '# New\n\nFirst thought') })
    expect(receipt).toMatchObject({ path: '/vault/new.md', content: '# New\n\nFirst thought' })
    expect(Object.isFrozen(receipt)).toBe(true)

    act(() => { receipt = result.current.handleContentChange('/elsewhere/page.md', 'text') })
    expect(receipt).toBeNull()
  })

  it('admits new Today text at once behind an older write, and settles only after the latest text is saved', async () => {
    let failOlder: (error: Error) => void = () => {}
    mockInvokeFn.mockImplementationOnce(() => new Promise((_resolve, reject) => { failOlder = reject }))
    const { result } = renderQueue()
    act(() => { result.current.handleContentChange(TODAY, '# Today\n\nolder') })
    let older: Promise<boolean> = Promise.resolve(false)
    act(() => { older = result.current.savePendingForPath(TODAY) })

    let receipt: ReturnType<typeof result.current.handleContentChange> = null
    act(() => { receipt = result.current.handleContentChange(TODAY, '# Today\n\nolder\n\ndraft') })
    expect(receipt).toMatchObject({ content: '# Today\n\nolder\n\ndraft' })
    expect(result.current.receiptStatus(receipt!)).toBe('pending')

    await act(async () => { failOlder(new Error('disk full')); await older.catch(() => false) })
    expect(result.current.receiptStatus(receipt!)).toBe('pending')
    await act(async () => { await result.current.savePendingForPath(TODAY) })
    expect(mockInvokeFn).toHaveBeenLastCalledWith('save_note_content', { path: TODAY, content: '# Today\n\nolder\n\ndraft' })
    expect(result.current.receiptStatus(receipt!)).toBe('settled')
  })

  it('follows a page renamed after admission to its new name', async () => {
    const renames = new Map<string, string>()
    const { result } = renderQueue({ renames })
    let receipt: ReturnType<typeof result.current.handleContentChange> = null
    act(() => { receipt = result.current.handleContentChange('/vault/untitled-page-1.md', 'draft') })
    renames.set('/vault/untitled-page-1.md', '/vault/harbor.md')
    expect(result.current.receiptStatus(receipt!)).toBe('pending')
    await act(async () => { await result.current.savePendingForPath('/vault/harbor.md') })
    expect(mockInvokeFn).toHaveBeenLastCalledWith('save_note_content', { path: '/vault/harbor.md', content: 'draft' })
    expect(result.current.receiptStatus(receipt!)).toBe('settled')
  })

  it('stays unsettled while held, after the page was dropped, or after a later session saves it; a completed Trash move settles it', async () => {
    const { result, rerender } = renderQueue()
    let held: ReturnType<typeof result.current.handleContentChange> = null
    act(() => { held = result.current.handleContentChange(TODAY, 'held') })
    act(() => { result.current.holdAutosave([TODAY]) })
    await act(async () => { await result.current.savePending() })
    expect(result.current.receiptStatus(held!)).toBe('pending')
    act(() => { result.current.releaseAutosave([TODAY], 'discard') })
    expect(result.current.receiptStatus(held!)).toBe('settled')

    let moved: ReturnType<typeof result.current.handleContentChange> = null
    act(() => { moved = result.current.handleContentChange('/vault/away.md', 'moved') })
    rerender({ scope: '/other' })
    expect(result.current.receiptStatus(moved!)).toBe('unproven')
    rerender({ scope: '/vault' })
    act(() => { result.current.handleContentChange('/vault/away.md', 'typed later') })
    await act(async () => { await result.current.savePending() })
    expect(result.current.receiptStatus(moved!)).toBe('unproven')
  })
})
