import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { SetStateAction } from 'react'
import { useSaveNote } from './useSaveNote'
import { createTranslator, type AppLocale } from '../lib/i18n'
import { canWritePathToVault } from '../utils/vaultPathContainment'
import { errorMessage } from '../utils/vaultErrors'
import type { VaultEntry } from '../types'

interface Tab {
  entry: VaultEntry
  content: string
}

interface EditorSaveConfig {
  updateVaultContent: (path: string, content: string) => void
  setTabs: (fn: SetStateAction<Tab[]>) => void
  setToastMessage: (msg: string | null) => void
  onAfterSave?: () => void
  /** Called immediately before content is persisted to disk. */
  onBeforePersist?: (path: string) => void
  /** Called after content is persisted — used to clear unsaved state and live-reload themes. */
  onNotePersisted?: (path: string, content: string) => void
  /** Resolve stale paths (for example after a note rename) before persisting buffered content. */
  resolvePath?: (path: string) => string
  /** Wait for an in-flight path change to settle before persisting buffered content. */
  resolvePathBeforeSave?: (path: string) => Promise<string>
  /** False when editor state is present but no vault is available to receive writes. */
  canPersist?: boolean
  /** Clears pending debounced content when the persistence target changes. */
  persistenceScope?: string | readonly string[]
  disabledSaveMessage?: string
  locale?: AppLocale
}

/** One debounce and ordered write lane per note; editing another pane never replaces pending data. */
export const AUTO_SAVE_DEBOUNCE_MS = 1_500
export const MISSING_ACTIVE_VAULT_SAVE_MESSAGE = 'Select or restore a vault before saving.'
interface PendingContent { path: string; content: string }
function persistenceScopeKey(scope: EditorSaveConfig['persistenceScope']): string {
  return JSON.stringify(typeof scope === 'string' ? [scope] : [...(scope ?? [])].sort())
}

export function useEditorSave(options: EditorSaveConfig) {
  const optionsRef = useRef(options)
  useLayoutEffect(() => { optionsRef.current = options }, [options])
  const pending = useRef(new Map<string, PendingContent>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const inFlight = useRef(new Map<string, Promise<boolean>>())
  const scopeKey = persistenceScopeKey(options.persistenceScope)
  const scopeRef = useRef(scopeKey)
  const t = useMemo(() => createTranslator(options.locale ?? 'en'), [options.locale])
  const currentPath = useCallback((path: string) => optionsRef.current.resolvePath?.(path) ?? path, [])
  const findPending = useCallback((path: string) => [...pending.current.entries()].find(([key]) => currentPath(key) === currentPath(path)), [currentPath])
  const updateTabs = useCallback((path: string, content: string) => {
    optionsRef.current.setTabs(previous => {
      let changed = false
      const next = previous.map(tab => {
        if (tab.entry.path !== path || tab.content === content) return tab
        changed = true
        return { ...tab, content }
      })
      return changed ? next : previous
    })
  }, [])
  const updateSavedContent = useCallback((path: string, content: string) => {
    const latest = findPending(path)?.[1]
    if (latest && latest.content !== content) return
    optionsRef.current.updateVaultContent(path, content)
    updateTabs(path, content)
  }, [findPending, updateTabs])
  const { saveNote } = useSaveNote(updateSavedContent)
  const cancelTimer = useCallback((path?: string) => {
    for (const [key, timer] of timers.current) {
      if (path && currentPath(key) !== currentPath(path)) continue
      clearTimeout(timer)
      timers.current.delete(key)
    }
  }, [currentPath])
  useEffect(() => () => cancelTimer(), [cancelTimer])
  useLayoutEffect(() => {
    if (scopeRef.current === scopeKey) return
    scopeRef.current = scopeKey
    for (const [path, snapshot] of pending.current) {
      if (canWritePathToVault(currentPath(snapshot.path), optionsRef.current.persistenceScope ?? '')) continue
      pending.current.delete(path)
      cancelTimer(path)
    }
  }, [cancelTimer, currentPath, scopeKey])
  const flushPath = useCallback(async function flushDocument(path: string, drain = true): Promise<boolean> {
    cancelTimer(path)
    if (optionsRef.current.canPersist === false) return false
    const lane = currentPath(path)
    const existing = [...inFlight.current].find(([key]) => currentPath(key) === lane)?.[1]
    if (existing) {
      const saved = await existing
      // A manual flush waits for changes typed during the earlier write too.
      const stillDebouncing = [...timers.current.keys()].some(key => currentPath(key) === lane)
      // An autosave whose idle timer already expired waits behind the older write.
      // Only a newer, still-running timer may defer the next snapshot again.
      return findPending(path) && (drain || !stillDebouncing) ? flushDocument(path, drain) : saved
    }
    const item = findPending(path)
    if (!item) return false
    const [key, snapshot] = item
    const persist = async () => {
      const config = optionsRef.current
      const resolved = currentPath(snapshot.path)
      const target = config.resolvePathBeforeSave ? await config.resolvePathBeforeSave(resolved) : resolved
      if (!canWritePathToVault(target, optionsRef.current.persistenceScope ?? '')) {
        if (pending.current.get(key) === snapshot) pending.current.delete(key)
        return false
      }
      config.onBeforePersist?.(target)
      await saveNote(target, snapshot.content)
      if (pending.current.get(key) !== snapshot) return false
      pending.current.delete(key)
      optionsRef.current.onNotePersisted?.(target, snapshot.content)
      return true
    }
    const promise = persist()
    inFlight.current.set(lane, promise)
    let saved: boolean
    try { saved = await promise } finally {
      if (inFlight.current.get(lane) === promise) inFlight.current.delete(lane)
    }
    return drain && findPending(path) ? flushDocument(path, drain) : saved
  }, [cancelTimer, currentPath, findPending, saveNote])
  const savePendingForPath = useCallback((path: string) => flushPath(path), [flushPath])
  const savePending = useCallback(async () => {
    let saved = false
    // Await every lane even if one fails: the other page must still reach disk.
    const results = await Promise.allSettled([...pending.current.keys()].map(path => savePendingForPath(path)))
    let failure: unknown
    for (const result of results) {
      if (result.status === 'fulfilled') saved = result.value || saved
      else failure = result.reason
    }
    if (failure) throw failure
    return saved
  }, [savePendingForPath])
  const showFailure = useCallback((error: unknown) => {
    const message = errorMessage(error)
    const invalid = /os error 123|filename, directory name, or volume label syntax is incorrect|path is invalid on this platform/i.test(message)
    optionsRef.current.setToastMessage(invalid ? t('save.error.invalidPath') : t('save.error.failed', { error: message }))
  }, [t])
  const handleContentChange = useCallback((path: string, content: string) => {
    const target = currentPath(path)
    if (!canWritePathToVault(target, optionsRef.current.persistenceScope ?? '')) return
    const old = findPending(path)
    const key = old?.[0] ?? target
    pending.current.set(key, { path: target, content })
    updateTabs(target, content)
    cancelTimer(key)
    if (optionsRef.current.canPersist === false) return
    timers.current.set(key, setTimeout(() => {
      timers.current.delete(key)
      void flushPath(key, false).then(saved => {
        if (saved) optionsRef.current.onAfterSave?.()
      }).catch(error => { console.error('Auto-save failed:', error); showFailure(error) })
    }, AUTO_SAVE_DEBOUNCE_MS))
  }, [cancelTimer, currentPath, findPending, flushPath, showFailure, updateTabs])
  const handleSave = useCallback(async (fallback?: PendingContent): Promise<boolean> => {
    cancelTimer()
    const config = optionsRef.current
    if (config.canPersist === false) {
      const dirty = pending.current.size > 0 || fallback !== undefined
      config.setToastMessage(dirty ? config.disabledSaveMessage ?? t('save.toast.missingActiveVault') : t('save.toast.nothingToSave'))
      return !dirty
    }
    try {
      const hadPendingFallback = fallback ? !!findPending(fallback.path) : false
      let saved = await savePending()
      if (fallback && !hadPendingFallback && !saved) {
        pending.current.set(fallback.path, fallback)
        saved = await savePendingForPath(fallback.path)
      }
      config.setToastMessage(saved ? t('save.toast.saved') : t('save.toast.nothingToSave'))
      config.onAfterSave?.()
      return true
    } catch (error) { console.error('Save failed:', error); showFailure(error); return false }
  }, [cancelTimer, findPending, savePending, savePendingForPath, showFailure, t])
  return { handleContentChange, handleSave, savePending, savePendingForPath }
}
