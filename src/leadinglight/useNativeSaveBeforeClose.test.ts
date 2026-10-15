import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNativeSaveBeforeClose } from './useNativeSaveBeforeClose'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), isTauri: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }))
vi.mock('../mock-tauri', () => ({ isTauri: mocks.isTauri }))

const handlers = new Map<string, (event: { payload: unknown }) => void>()
const stops: Array<ReturnType<typeof vi.fn>> = []
const request = (id: number) => handlers.get('leadinglight:save-before-close')?.({ payload: { id } })
const cancel = (id: number, reason = 'failed') => handlers.get('leadinglight:close-cancelled')?.({ payload: { id, reason } })
const settle = async () => { await act(async () => {}) }
function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
  handlers.clear()
  stops.length = 0
  mocks.isTauri.mockReturnValue(true)
  mocks.invoke.mockResolvedValue(undefined)
  mocks.listen.mockImplementation(async (name: string, handler: (event: { payload: unknown }) => void) => {
    handlers.set(name, handler)
    const stop = vi.fn(() => handlers.delete(name))
    stops.push(stop)
    return stop
  })
})
afterEach(() => { vi.useRealTimers() })

describe('native save before close', () => {
  it('blocks interaction before flushing and acknowledges only after the full flush completes', async () => {
    const pending = deferred()
    const flush = vi.fn(() => pending.promise)
    const { result } = renderHook(() => useNativeSaveBeforeClose({ flush, onError: vi.fn() }))
    await settle()
    expect(mocks.invoke).toHaveBeenCalledWith('shutdown_frontend_ready')
    act(() => request(1))
    expect(result.current.isClosing).toBe(true)
    expect(flush).toHaveBeenCalledOnce()
    expect(mocks.invoke).not.toHaveBeenCalledWith('complete_shutdown_save', expect.anything())
    const key = new KeyboardEvent('keydown', { key: 'n', metaKey: true, cancelable: true })
    window.dispatchEvent(key)
    expect(key.defaultPrevented).toBe(true)
    await act(async () => { pending.resolve() })
    expect(mocks.invoke).toHaveBeenCalledWith('complete_shutdown_save', { requestId: 1, saved: true })
    expect(result.current.isClosing).toBe(true)
  })

  it('keeps failed edits open, reports an error, and never acknowledges a successful save', async () => {
    const onError = vi.fn()
    const { result } = renderHook(() => useNativeSaveBeforeClose({ flush: () => Promise.reject(new Error('disk full')), onError }))
    await settle()
    await act(async () => request(1))
    expect(result.current.isClosing).toBe(false)
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('still open'))
    expect(mocks.invoke).toHaveBeenCalledWith('complete_shutdown_save', { requestId: 1, saved: false })
    expect(mocks.invoke).not.toHaveBeenCalledWith('complete_shutdown_save', { requestId: 1, saved: true })
  })

  it('cancels a stalled save without honoring its eventual success, then permits a new attempt', async () => {
    const pending = deferred()
    const flush = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined)
    const onError = vi.fn()
    const { result } = renderHook(() => useNativeSaveBeforeClose({ flush, onError }))
    await settle()
    act(() => request(1))
    act(() => cancel(1, 'timeout'))
    expect(result.current.isClosing).toBe(false)
    await act(async () => { pending.resolve() })
    expect(mocks.invoke).not.toHaveBeenCalledWith('complete_shutdown_save', { requestId: 1, saved: true })
    await act(async () => request(2))
    expect(mocks.invoke).toHaveBeenCalledWith('complete_shutdown_save', { requestId: 2, saved: true })
    expect(onError).toHaveBeenCalledOnce()
  })

  it('releases all windows when another window fails after this one saved', async () => {
    const onError = vi.fn()
    const { result } = renderHook(() => useNativeSaveBeforeClose({ flush: async () => {}, onError }))
    await settle()
    await act(async () => request(1))
    act(() => cancel(1))
    expect(result.current.isClosing).toBe(false)
    expect(onError).toHaveBeenCalledOnce()
  })

  it('deduplicates replayed native requests and uses the current flush callback', async () => {
    const first = vi.fn(async () => {})
    const second = vi.fn(async () => {})
    const { rerender } = renderHook(({ flush }) => useNativeSaveBeforeClose({ flush, onError: vi.fn() }), { initialProps: { flush: first } })
    await settle()
    rerender({ flush: second })
    await act(async () => { request(1); request(1) })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })

  it('has a renderer deadline if the native cancellation event does not arrive', async () => {
    vi.useFakeTimers()
    const pending = deferred()
    const onError = vi.fn()
    const { result } = renderHook(() => useNativeSaveBeforeClose({ flush: () => pending.promise, onError }))
    await settle()
    act(() => request(1))
    await act(async () => { vi.advanceTimersByTime(16_000) })
    expect(result.current.isClosing).toBe(false)
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('too long'))
    await act(async () => { pending.resolve() })
    expect(mocks.invoke).not.toHaveBeenCalledWith('complete_shutdown_save', { requestId: 1, saved: true })
  })

  it('removes listeners and cancels an active request on unmount', async () => {
    const pending = deferred()
    const { unmount } = renderHook(() => useNativeSaveBeforeClose({ flush: () => pending.promise, onError: vi.fn() }))
    await settle()
    act(() => request(1))
    unmount()
    expect(stops.every(stop => stop.mock.calls.length === 1)).toBe(true)
    expect(mocks.invoke).toHaveBeenCalledWith('complete_shutdown_save', { requestId: 1, saved: false })
  })

  it('does not register native hooks in the browser preview', async () => {
    mocks.isTauri.mockReturnValue(false)
    const { result } = renderHook(() => useNativeSaveBeforeClose({ flush: vi.fn(), onError: vi.fn() }))
    await settle()
    expect(result.current.isClosing).toBe(false)
    expect(mocks.listen).not.toHaveBeenCalled()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})
