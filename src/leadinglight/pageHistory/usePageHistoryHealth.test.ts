import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { HistoryHealth } from './pageHistoryApi'
import { createHealthTracker, usePageHistoryHealth } from './usePageHistoryHealth'

// Seam: save notes and health answers -> the warning. Catches null, replayed, unknown, older or other-session answers clearing or raising it.
const V = '/vault'
const health = (state: HistoryHealth['state'], reason: HistoryHealth['reason'] = null): HistoryHealth =>
  ({ state, reason, usedBytes: 0, budgetBytes: 100, unreadable: 0, attention: [] })

describe('history warning', () => {
  it('is raised by a note and cleared only by an on answer to a request sent after it', () => {
    const tracker = createHealthTracker('s1')
    const before = tracker.begin()
    tracker.note(V, null)
    expect(tracker.warnings().size).toBe(0)
    tracker.note(V, { status: 'notKept', reason: 'lowSpace' })
    tracker.answer(V, before, health('on'))
    expect(tracker.warnings().get(V)?.reason).toBe('lowSpace')

    const after = tracker.begin()
    tracker.answer(V, after, health('unknown'))
    tracker.answer(V, after, null)
    tracker.note(V, null)
    expect(tracker.warnings().get(V)?.reason).toBe('lowSpace')
    tracker.answer(V, after, health('on'))
    expect(tracker.warnings().has(V)).toBe(false)
  })

  it('raises on notKeeping and never lets an older answer undo a newer one', () => {
    const tracker = createHealthTracker('s1')
    const older = tracker.begin()
    const newer = tracker.begin()
    tracker.answer(V, newer, health('notKeeping', 'full'))
    tracker.answer(V, older, health('on'))
    expect(tracker.warnings().get(V)?.reason).toBe('full')
    // A note raised again moves the bar: an answer already in flight cannot clear it.
    const inFlight = tracker.begin()
    tracker.note(V, { status: 'notKept', reason: 'busy' })
    tracker.answer(V, inFlight, health('on'))
    expect(tracker.warnings().get(V)?.reason).toBe('busy')
  })

  it('starts each vault session clean and ignores answers to the previous one', async () => {
    let answer: (value: HistoryHealth) => void = () => {}
    const api = { health: vi.fn(() => new Promise<HistoryHealth | null>(resolve => { answer = resolve })) }
    const { result, rerender } = renderHook(({ session }) => usePageHistoryHealth(session, api), { initialProps: { session: 'A' } })
    act(() => { result.current.noteSaved(V, { status: 'notKept', reason: 'unavailable' }) })
    let pending: Promise<void> = Promise.resolve()
    act(() => { pending = result.current.check(V) })
    rerender({ session: 'B' })
    expect(result.current.warnings.size).toBe(0)
    await act(async () => { answer(health('notKeeping', 'full')); await pending })
    expect(result.current.warnings.size).toBe(0)
  })
})
