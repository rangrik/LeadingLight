import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createAdaptController, type AdaptController, type AdaptSnapshot } from './adaptController'
import { createAdaptTransport } from './adaptTransport'

export interface Adapt {
  controller: AdaptController
  snapshot: AdaptSnapshot
  /**
   * Opens this vault's visit the first time the person opens Adapt here (and reopens one that
   * ended); afterwards reads the provider status again. False while the vault is not ready.
   */
  ensureVisit: () => boolean
}

/**
 * One controller for this window. Nothing reaches native until the person opens Adapt; leaving the
 * vault ends its visit, whose turns native stops, and coming back is a new visit.
 */
export function useAdapt({ vaultPath, ready, controller: injected }: { vaultPath: string; ready: boolean; controller?: AdaptController }): Adapt {
  const [controller] = useState(() => injected ?? createAdaptController({ api: createAdaptTransport() }))
  const visiting = useRef<string | null>(null)
  const latest = useRef({ vaultPath, ready })
  useLayoutEffect(() => {
    latest.current = { vaultPath, ready }
    if (visiting.current !== null && visiting.current !== vaultPath) {
      visiting.current = null
      void controller.exit()
    }
  }, [controller, ready, vaultPath])
  useEffect(() => () => {
    visiting.current = null
    void controller.exit()
  }, [controller])

  const ensureVisit = useCallback(() => {
    const { vaultPath: path, ready: isReady } = latest.current
    if (!isReady || !path) return false
    if (visiting.current !== path) {
      visiting.current = path
      void controller.enter(path)
      return true
    }
    const { visit } = controller.snapshot()
    if (visit === 'closed' || visit === 'noReply' || visit === 'refused') void controller.reopen()
    else void controller.refreshStatus()
    return true
  }, [controller])

  const snapshot = useSyncExternalStore(controller.subscribe, controller.snapshot)
  return { controller, snapshot, ensureVisit }
}
