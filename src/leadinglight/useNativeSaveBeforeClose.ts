import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { isTauri } from '../mock-tauri'
import { translate, type AppLocale } from '../lib/i18n'

interface Options {
  flush: () => Promise<void>
  onError: (message: string) => void
  locale?: AppLocale
}
interface SaveRequest { id: number }
interface CancelledRequest extends SaveRequest { reason: 'failed' | 'timeout' }

/** Native close and quit are authorized only after every buffered editor write succeeds. */
export function useNativeSaveBeforeClose(options: Options) {
  const optionsRef = useRef(options)
  useLayoutEffect(() => { optionsRef.current = options }, [options])
  const [isClosing, setClosing] = useState(false)

  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    let activeId: number | null = null
    let lastId = 0
    let deadline: ReturnType<typeof setTimeout> | undefined
    const unlisten: UnlistenFn[] = []
    const errorMessage = (reason: 'failed' | 'timeout') => translate(optionsRef.current.locale ?? 'en',
      reason === 'timeout' ? 'leadinglight.shutdown.timeout' : 'leadinglight.shutdown.failed')
    const cancel = (id: number, reason: 'failed' | 'timeout') => {
      if (disposed || activeId !== id) return
      clearTimeout(deadline)
      activeId = null
      setClosing(false)
      optionsRef.current.onError(errorMessage(reason))
    }
    const save = async ({ id }: SaveRequest) => {
      if (disposed || id <= lastId) return
      lastId = id
      activeId = id
      // Commit the input guard before reading editor buffers or awaiting disk I/O.
      flushSync(() => setClosing(true))
      // Native has its own 15s deadline; this also releases a live UI if its cancel event is lost.
      deadline = setTimeout(() => {
        cancel(id, 'timeout')
        void invoke('complete_shutdown_save', { requestId: id, saved: false }).catch(() => {})
      }, 16_000)
      try {
        await optionsRef.current.flush()
        if (disposed || activeId !== id) return
        await invoke('complete_shutdown_save', { requestId: id, saved: true })
        // Keep the window inert until native close/quit, or a cancellation from another window.
      } catch {
        if (disposed || activeId !== id) return
        cancel(id, 'failed')
        await invoke('complete_shutdown_save', { requestId: id, saved: false }).catch(() => {})
      }
    }
    const guardCommand = (event: Event) => {
      if (activeId === null) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('laputa:dispatch-command', guardCommand, true)
    window.addEventListener('keydown', guardCommand, true)
    const install = async () => {
      const requests = await listen<SaveRequest>('leadinglight:save-before-close', event => { void save(event.payload) })
      if (disposed) { requests(); return }
      unlisten.push(requests)
      const cancellations = await listen<CancelledRequest>('leadinglight:close-cancelled', event => cancel(event.payload.id, event.payload.reason))
      if (disposed) { cancellations(); return }
      unlisten.push(cancellations)
      await invoke('shutdown_frontend_ready')
    }
    void install().catch(() => {
      if (!disposed) optionsRef.current.onError(errorMessage('failed'))
    })
    return () => {
      disposed = true
      clearTimeout(deadline)
      window.removeEventListener('laputa:dispatch-command', guardCommand, true)
      window.removeEventListener('keydown', guardCommand, true)
      unlisten.forEach(stop => stop())
      if (activeId !== null) void invoke('complete_shutdown_save', { requestId: activeId, saved: false }).catch(() => {})
    }
  }, [])

  return { isClosing }
}
