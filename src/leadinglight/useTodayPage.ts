import { useCallback, useLayoutEffect, useRef } from 'react'
import type { VaultEntry } from '../types'
import { requestEditorFocus, tryFocusReadyPage } from '../hooks/useEditorFocus'
import { formatDateForDisplay, type DateDisplayFormat } from '../utils/dateDisplay'
import { joinVaultPath, notePathsMatch } from '../utils/notePathIdentity'
import type { ExactPageOutcome, ExactPageRequest } from './exactPage'

const two = (value: number) => String(value).padStart(2, '0')

/** Local calendar fields, never UTC: an evening click must not land on tomorrow's page. */
export function dailyPagePath(date: Date): string {
  return `Daily/${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}.md`
}

export function dailyPageContent(title: string): string {
  return `# ${title}\n\n`
}

interface Options {
  vaultPath: string
  /** True only once this vault's listing and restored layout are settled. */
  ready: boolean
  entries: VaultEntry[]
  dateDisplayFormat: DateDisplayFormat
  openNoteWhenLoaded: (entry: VaultEntry, options?: { commitNow?: boolean }) => Promise<boolean>
  createPageAt: (request: ExactPageRequest) => Promise<ExactPageOutcome>
  onFailed: () => void
  now?: () => Date
}

/** Where a pending draft field learns what happened to the page. */
export interface TodayOutcome {
  failed: () => void
  created: (path: string) => void
  shown: (path: string) => void
}

/** Asked in the command turn, after the ready-page attempt; returns where to report, if a draft field took the keys. */
export type HoldTodayInput = (path: string, ready: boolean) => TodayOutcome | null

/** One page per local day at a fixed path; the path, not the editable title, is its identity. */
export function useTodayPage(options: Options) {
  const latest = useRef(options)
  useLayoutEffect(() => { latest.current = options })
  // Leaving and returning to a vault starts a new session; its requests never join older ones.
  const session = useRef({ vaultPath: options.vaultPath, epoch: 0 })
  useLayoutEffect(() => {
    if (session.current.vaultPath !== options.vaultPath) session.current = { vaultPath: options.vaultPath, epoch: session.current.epoch + 1 }
  }, [options.vaultPath])
  // Repeated requests for the same session and day join the one already running.
  const inFlight = useRef(new Map<string, Promise<void>>())

  const openToday = useCallback((hold?: HoldTodayInput): Promise<void> => {
    const { vaultPath, ready, entries, dateDisplayFormat, openNoteWhenLoaded, createPageAt, onFailed, now } = latest.current
    if (!ready || !vaultPath) return Promise.resolve()
    const date = now?.() ?? new Date()
    const relativePath = dailyPagePath(date)
    const key = `${session.current.epoch}\n${vaultPath}\n${relativePath}`
    const running = inFlight.current.get(key)
    if (running) return running
    const path = joinVaultPath(vaultPath, relativePath)
    const existing = entries.find(entry => notePathsMatch(entry.path, path))
    const title = formatDateForDisplay(date, dateDisplayFormat)
    let open: Promise<ExactPageOutcome>
    if (existing) {
      const opening = openNoteWhenLoaded(existing, { commitNow: true })
      // Same task turn as the command: a ready page takes the next key; otherwise a draft field may.
      const focused = tryFocusReadyPage(existing.path)
      const report = hold?.(existing.path, focused) ?? null
      open = opening.then((shown): ExactPageOutcome => {
        if (shown && report) report.shown(existing.path)
        else if (!shown) report?.created(existing.path)
        else if (!focused) requestEditorFocus({ path: existing.path, cursorAtEnd: true })
        return shown ? 'opened' : 'created'
      }, (error: unknown) => {
        report?.created(existing.path)
        throw error
      })
    } else {
      const report = hold?.(path, false) ?? null
      open = createPageAt({ vaultPath, relativePath, title, content: dailyPageContent(title) }).then(outcome => {
        if (outcome === 'opened') report?.shown(path)
        else if (outcome === 'created') report?.created(path)
        else report?.failed()
        return outcome
      }, (error: unknown) => {
        report?.failed()
        throw error
      })
    }
    const epoch = session.current.epoch
    // A failure from an earlier vault session is not news for the current one.
    const fail = () => { if (session.current.epoch === epoch) onFailed() }
    const request = open
      .then(outcome => { if (outcome === 'failed') fail() }, fail)
      .finally(() => inFlight.current.delete(key))
    inFlight.current.set(key, request)
    return request
  }, [])

  return { openToday, canOpenToday: options.ready && !!options.vaultPath }
}
