import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { VaultEntry } from '../types'
import { useEditorFocus } from '../hooks/useEditorFocus'
import { dailyPagePath, useTodayPage } from './useTodayPage'
import type { ExactPageOutcome } from './exactPage'

const entry = (path: string) => ({ path, title: 'Renamed title' }) as VaultEntry

function setup(entries: VaultEntry[] = [], date = new Date(2026, 9, 15, 23, 30)) {
  const pending: ((outcome: ExactPageOutcome) => void)[] = []
  const createPageAt = vi.fn(() => new Promise<ExactPageOutcome>(resolve => { pending.push(resolve) }))
  const openNoteWhenLoaded = vi.fn(async () => true)
  const onFailed = vi.fn()
  const now = vi.fn(() => date)
  const hook = renderHook(({ vaultPath }: { vaultPath: string }) => useTodayPage({ vaultPath, ready: true, entries,
    dateDisplayFormat: 'friendly', openNoteWhenLoaded, createPageAt, onFailed, now }), { initialProps: { vaultPath: '/vault' } })
  const finish = (outcome: ExactPageOutcome, index = 0) => pending[index](outcome)
  return { hook, createPageAt, openNoteWhenLoaded, onFailed, now, finish }
}

describe('Today page', () => {
  it('uses local calendar fields, so a late evening stays on the same day', () => {
    expect(dailyPagePath(new Date(2026, 9, 15, 23, 59))).toBe('Daily/2026-10-15.md')
    expect(dailyPagePath(new Date(2026, 0, 1, 0, 0))).toBe('Daily/2026-01-01.md')
  })

  it('creates one untyped page with a date heading, and repeated clicks join that request', async () => {
    const { hook, createPageAt, finish } = setup()
    act(() => { void hook.result.current.openToday(); void hook.result.current.openToday() })
    expect(createPageAt).toHaveBeenCalledTimes(1)
    expect(createPageAt).toHaveBeenCalledWith({ vaultPath: '/vault', relativePath: 'Daily/2026-10-15.md',
      title: 'October 15, 2026', content: '# October 15, 2026\n\n' })
    await act(async () => finish('opened'))
  })

  it('opens the page at the fixed path even after its title changed', async () => {
    const { hook, createPageAt, openNoteWhenLoaded } = setup([entry('/vault/Daily/2026-10-15.md')])
    await act(() => hook.result.current.openToday())
    expect(createPageAt).not.toHaveBeenCalled()
    expect(openNoteWhenLoaded).toHaveBeenCalledWith(expect.objectContaining({ path: '/vault/Daily/2026-10-15.md' }), { commitNow: true })
  })

  describe('an existing page', () => {
    const path = '/vault/Daily/2026-10-15.md'
    afterEach(() => {
      vi.useRealTimers()
      document.body.innerHTML = ''
    })

    it('takes the keyboard before the next input when its editor is ready, with the caret at the end', async () => {
      vi.useFakeTimers()
      const pane = document.body.appendChild(document.createElement('section'))
      Object.assign(pane.dataset, { paneId: '1', notePath: path, paneActive: 'true' })
      const today = pane.appendChild(Object.assign(document.createElement('div'), { tabIndex: -1 }))
      today.setAttribute('contenteditable', 'true')
      const editor = { focus: () => today.focus(), prosemirrorView: { dom: today }, document: [{ id: 'end' }], setTextCursorPosition: vi.fn() }
      renderHook(() => useEditorFocus(editor, { current: true }, path, path))
      const { hook } = setup([entry(path)])

      // No timer runs: only the command's own promise turn.
      await hook.result.current.openToday()
      expect(document.activeElement).toBe(today)
      expect(editor.setTextCursorPosition).toHaveBeenCalledWith('end', 'end')
    })

    it('keeps the delayed focus request when no editor shows it ready', async () => {
      vi.useFakeTimers()
      const requests: unknown[] = []
      const listen = (event: Event) => requests.push((event as CustomEvent).detail)
      window.addEventListener('laputa:focus-editor', listen)
      const { hook } = setup([entry(path)])

      await hook.result.current.openToday()
      vi.advanceTimersByTime(6_000)
      window.removeEventListener('laputa:focus-editor', listen)
      expect(requests).toEqual([{ path, cursorAtEnd: true }])
    })

    it('lets a draft field take the keys instead, and tells it when the page is shown', async () => {
      vi.useFakeTimers()
      const requests: unknown[] = []
      const listen = (event: Event) => requests.push((event as CustomEvent).detail)
      window.addEventListener('laputa:focus-editor', listen)
      const report = { failed: vi.fn(), created: vi.fn(), shown: vi.fn() }
      const hold = vi.fn(() => report)
      const { hook } = setup([entry(path)])

      await hook.result.current.openToday(hold)
      vi.advanceTimersByTime(6_000)
      window.removeEventListener('laputa:focus-editor', listen)
      expect(hold).toHaveBeenCalledWith(path, false)
      expect(report.shown).toHaveBeenCalledWith(path)
      expect(requests).toEqual([])
    })
  })

  it('asks for a draft field before any await while a new page is made, and reports a page made but not shown', async () => {
    const { hook, finish } = setup()
    const report = { failed: vi.fn(), created: vi.fn(), shown: vi.fn() }
    const hold = vi.fn(() => report)
    act(() => { void hook.result.current.openToday(hold) })
    expect(hold).toHaveBeenCalledWith('/vault/Daily/2026-10-15.md', false)

    await act(async () => finish('created'))
    expect(report.created).toHaveBeenCalledWith('/vault/Daily/2026-10-15.md')
    expect(report.shown).not.toHaveBeenCalled()
  })

  it('picks the new day after midnight', async () => {
    const { hook, createPageAt, now, finish } = setup()
    act(() => { void hook.result.current.openToday() })
    now.mockReturnValue(new Date(2026, 9, 16, 0, 1))
    act(() => { void hook.result.current.openToday() })
    expect(createPageAt.mock.calls.map(call => (call as unknown[])[0])).toEqual([
      expect.objectContaining({ relativePath: 'Daily/2026-10-15.md' }),
      expect.objectContaining({ relativePath: 'Daily/2026-10-16.md' }),
    ])
    await act(async () => { finish('opened', 0); finish('opened', 1) })
  })

  it('does not join or report a request from an earlier visit to the vault', async () => {
    const { hook, createPageAt, onFailed, finish } = setup()
    act(() => { void hook.result.current.openToday() })
    hook.rerender({ vaultPath: '/other' })
    hook.rerender({ vaultPath: '/vault' })
    act(() => { void hook.result.current.openToday() })
    expect(createPageAt).toHaveBeenCalledTimes(2)
    await act(async () => finish('failed', 0))
    expect(onFailed).not.toHaveBeenCalled()
    await act(async () => finish('failed', 1))
    expect(onFailed).toHaveBeenCalledTimes(1)
  })
})
