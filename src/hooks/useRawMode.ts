import { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo } from 'react'
import { getVaultConfig, getVaultConfigPath, updateVaultConfigField, subscribeVaultConfig } from '../utils/vaultConfigStore'
import type { PaneEditorModeControl } from '../leadinglight/paneEditorMode'
import { trackEvent } from '../lib/telemetry'

interface UseRawModeParams {
  activeTabPath: string | null
  /** Prepare the current rich buffer for raw mode. This does not acknowledge a disk save. */
  onFlushPending?: () => Promise<boolean>
  /** Forward the latest raw buffer synchronously before leaving raw mode. */
  onBeforeRawEnd?: () => void
  control?: PaneEditorModeControl
  onError?: (error: unknown) => void
}

/** Controlled panes own their preference; standalone editors retain the vault preference. */
export function useRawMode({ activeTabPath, onFlushPending, onBeforeRawEnd, control, onError }: UseRawModeParams) {
  const [storedRaw, setStoredRaw] = useState(() => getVaultConfig().editor_mode === 'raw')
  const controlled = control !== undefined
  useEffect(() => {
    if (controlled) return
    return subscribeVaultConfig(() => setStoredRaw(getVaultConfig().editor_mode === 'raw'))
  }, [controlled])
  const rawEnabled = control ? control.mode === 'raw' : storedRaw
  const identity = useMemo(() => ({ path: activeTabPath, begin: control?.begin }), [activeTabPath, control?.begin])
  const liveIdentity = useRef<typeof identity | null>(identity)
  const generation = useRef(0)
  const pending = useRef(false)
  // Invalidate replacement pages and unmounted editors, including A → B → A.
  useLayoutEffect(() => {
    liveIdentity.current = identity
    generation.current += 1
    return () => { generation.current += 1; liveIdentity.current = null }
  }, [identity])

  const handleToggleRaw = useCallback(async (): Promise<boolean> => {
    if (pending.current || liveIdentity.current !== identity) return false
    const commit = control?.begin()
    if (control && !commit) return false
    const request = generation.current
    const vault = getVaultConfigPath()
    const current = () => generation.current === request && (control !== undefined || getVaultConfigPath() === vault)
    pending.current = true
    try {
      if (rawEnabled) onBeforeRawEnd?.()
      else if (await onFlushPending?.() === false) return false
      if (!current()) return false
      const mode = rawEnabled ? 'preview' : 'raw'
      if (commit) {
        if (!commit(mode)) return false
      } else {
        setStoredRaw(!rawEnabled)
        updateVaultConfigField('editor_mode', mode)
      }
      trackEvent('raw_mode_toggled')
      return true
    } catch (error) {
      if (current()) onError?.(error)
      return false
    } finally { pending.current = false }
  }, [rawEnabled, onFlushPending, onBeforeRawEnd, control, onError, identity])

  return { rawMode: rawEnabled && activeTabPath !== null, handleToggleRaw }
}
