import type { VaultEntry } from '../../types'
import { parseRelocationReceipt, type RelocationReceipt } from './relocationContract'

export interface RelocationPage { entry: VaultEntry; content: string }
export interface RelocationSnapshot {
  source: RelocationPage
  pages: RelocationPage[]
  destinationPath: string
}
export type RelocationOutcome =
  | { status: 'refused'; reason: 'notSaved' | 'changed' | 'move' }
  | { status: 'unknown' }
  | { status: 'moved'; receipt: RelocationReceipt; refreshPending: boolean; unavailable: string[] }

export interface RelocationServices {
  current: () => boolean
  /** Synchronous input and admission holds; idempotent release. */
  begin: () => () => void
  /** Joins earlier work, drains held writes and captures saved text. */
  prepare: () => Promise<RelocationSnapshot>
  /** Synchronously retires visible editors after the saved baseline proof. */
  detach: (snapshot: RelocationSnapshot) => void
  dispatch: (snapshot: RelocationSnapshot) => Promise<unknown>
  /** A missing reply is not a refusal; prove the saved source still exists before reopening originals. */
  sourceUnchanged: (snapshot: RelocationSnapshot) => Promise<boolean>
  commit: (snapshot: RelocationSnapshot, receipt: RelocationReceipt) => void
  reopen: (snapshot: RelocationSnapshot, receipt: RelocationReceipt | null) => Promise<string[]>
  /** Retire hidden retained tabs too before input resumes after an unknown result. */
  closeUnconfirmed: (snapshot: RelocationSnapshot) => void
  refresh: () => Promise<void>
}

/** Runs outside the manual rename registry: close/backup join its structural slot, never the reverse. */
export async function relocatePage(services: RelocationServices): Promise<RelocationOutcome> {
  let release: (() => void) | undefined
  let snapshot: RelocationSnapshot | undefined
  let detached = false
  let settled = false
  try {
    if (!services.current()) return { status: 'refused', reason: 'changed' }
    release = services.begin()
    snapshot = await services.prepare()
    if (!services.current()) return { status: 'refused', reason: 'changed' }
    services.detach(snapshot)
    detached = true
    let reply: unknown
    try { reply = await services.dispatch(snapshot) } catch { reply = null }
    if (!services.current()) return { status: 'unknown' }
    const receipt = parseRelocationReceipt(reply, {
      sourcePath: snapshot.source.entry.path,
      destinationPath: snapshot.destinationPath,
      openPaths: snapshot.pages.map(page => page.entry.path),
    })
    if (!receipt) {
      let unchanged = false
      try { unchanged = await services.sourceUnchanged(snapshot) } catch { /* No proof: stay closed. */ }
      if (unchanged && services.current()) {
        await services.reopen(snapshot, null)
        settled = true
        return { status: 'refused', reason: 'move' }
      }
      await services.refresh().catch(() => {})
      return { status: 'unknown' }
    }
    // Canonical routing precedes every subsequent await, even if some editor cannot reopen.
    services.commit(snapshot, receipt)
    const unavailable = await services.reopen(snapshot, receipt)
    settled = true
    let refreshPending = false
    try { await services.refresh() } catch { refreshPending = true }
    return { status: 'moved', receipt, refreshPending, unavailable }
  } catch (error) {
    console.warn('[relocation] The page move could not settle:', error)
    // After detach, an unexpected apply failure must never resurrect saved old-path editors.
    return detached ? { status: 'unknown' } : { status: 'refused', reason: 'notSaved' }
  } finally {
    try { if (detached && !settled && snapshot) services.closeUnconfirmed(snapshot) }
    finally { release?.() }
  }
}
