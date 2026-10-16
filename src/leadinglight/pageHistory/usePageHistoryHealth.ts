import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { HistoryNote } from '../saveOutcome'
import { pageHistoryApi, type HistoryHealth, type HistoryReason, type PageHistoryApi } from './pageHistoryApi'

/** A raised warning, with the number of the last health request sent when it was raised. */
export interface HistoryWarning { reason: HistoryReason | null; raisedAt: number }

export interface HealthTracker {
  readonly session: string
  /** Numbers one health request before it is sent. */
  begin: () => number
  /** A saved page's note only ever raises; null says nothing. */
  note: (vaultPath: string, note: HistoryNote | null) => void
  answer: (vaultPath: string, request: number, health: HistoryHealth | null) => void
  warnings: () => ReadonlyMap<string, HistoryWarning>
  subscribe: (listener: () => void) => () => void
}

/** One vault session's history warnings (plan §7): only an `on` answer sent after a warning clears it. */
export function createHealthTracker(session: string): HealthTracker {
  let sent = 0
  let warnings: ReadonlyMap<string, HistoryWarning> = new Map()
  const answered = new Map<string, number>()
  const listeners = new Set<() => void>()
  const set = (vaultPath: string, warning: HistoryWarning | null) => {
    const next = new Map(warnings)
    if (warning) next.set(vaultPath, warning)
    else next.delete(vaultPath)
    warnings = next
    listeners.forEach(listener => listener())
  }
  return {
    session,
    begin: () => ++sent,
    note(vaultPath, note) {
      if (note) set(vaultPath, { reason: note.reason, raisedAt: sent })
    },
    answer(vaultPath, request, health) {
      // Answers count in request order, so a slow older answer never undoes a newer one.
      if (!health || health.state === 'unknown' || request <= (answered.get(vaultPath) ?? 0)) return
      answered.set(vaultPath, request)
      if (health.state === 'notKeeping') set(vaultPath, { reason: health.reason, raisedAt: sent })
      else if ((warnings.get(vaultPath)?.raisedAt ?? Infinity) < request) set(vaultPath, null)
    },
    warnings: () => warnings,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

export type PageHistoryHealth = ReturnType<typeof usePageHistoryHealth>

/** The warnings for this vault session; a new session starts with none and ignores older answers. */
export function usePageHistoryHealth(session: string, api: Pick<PageHistoryApi, 'health'> = pageHistoryApi, pollMs = 60_000) {
  const tracker = useMemo(() => createHealthTracker(session), [session])
  const warnings = useSyncExternalStore(tracker.subscribe, tracker.warnings)
  const check = useCallback(async (vaultPath: string) => {
    const request = tracker.begin()
    tracker.answer(vaultPath, request, await api.health(vaultPath))
  }, [api, tracker])
  const noteSaved = useCallback((vaultPath: string, note: HistoryNote) => tracker.note(vaultPath, note), [tracker])
  // While warned, ask now and then, so a recovered store clears the warning without any action.
  const warned = [...warnings.keys()].join('\n')
  useEffect(() => {
    if (!warned) return
    const timer = window.setInterval(() => { warned.split('\n').forEach(vaultPath => { void check(vaultPath) }) }, pollMs)
    return () => window.clearInterval(timer)
  }, [warned, check, pollMs])
  return { tracker, warnings, check, noteSaved }
}
