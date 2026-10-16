import { useCallback, useEffect, useRef, useState } from 'react'
import {
  pageHistoryApi, type PageHistoryApi, type SavedLocation, type VersionCopyOutcome, type VersionPreview, type VersionRow,
} from './pageHistoryApi'
import type { HealthTracker } from './usePageHistoryHealth'

export interface Listing<T> {
  status: 'loading' | 'ready' | 'failed' | 'refused'
  items: T[]
  next: string | null
  more: 'idle' | 'loading' | 'failed'
}
export type PreviewState = { id: string; status: 'loading' | 'failed' } | { id: string; status: 'ready'; preview: VersionPreview }
export interface CopyAttempt { versionId: string; folder: string | null; operationId: string; saving: boolean; outcome: VersionCopyOutcome | null }
type PageReply<T> = { status: 'ok'; items: T[]; next: string | null } | { status: 'refused' } | null

const loading = <T,>(): Listing<T> => ({ status: 'loading', items: [], next: null, more: 'idle' })

function applyPage<T>(current: Listing<T>, more: boolean, reply: PageReply<T>): Listing<T> {
  if (more) return reply?.status === 'ok' ? { ...current, items: [...current.items, ...reply.items], next: reply.next, more: 'idle' } : { ...current, more: 'failed' }
  if (!reply) return { ...loading<T>(), status: 'failed' }
  return reply.status === 'ok' ? { status: 'ready', items: reply.items, next: reply.next, more: 'idle' } : { ...loading<T>(), status: 'refused' }
}

/** A finished answer: asking again means a new copy. Anything else retries the same operation. */
const settled = (outcome: VersionCopyOutcome | null) => outcome !== null
  && (outcome.status === 'created' || outcome.status === 'folderUnavailable' || (outcome.status === 'refused' && outcome.reason !== 'busy'))

interface Options {
  vaultPath: string
  pagePath: string
  tracker: HealthTracker | null
  api?: PageHistoryApi
  onCopyCreated?: (path: string) => void
}

/** One opening of Earlier versions for one page in one vault; later answers never land on newer choices. */
export function usePageHistory({ vaultPath, pagePath, tracker, api = pageHistoryApi, onCopyCreated }: Options) {
  const seq = useRef({ versions: 0, locations: 0, preview: 0, copy: 0, alive: true })
  const [tab, setTabState] = useState<'page' | 'locations'>('page')
  const [location, setLocation] = useState(pagePath)
  const [versions, setVersions] = useState<Listing<VersionRow>>(loading)
  const [locations, setLocations] = useState<Listing<SavedLocation> | null>(null)
  const [selected, setSelected] = useState<VersionRow | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [copy, setCopy] = useState<CopyAttempt | null>(null)
  useEffect(() => {
    const current = seq.current
    current.alive = true
    return () => { current.alive = false }
  }, [])

  const loadVersions = useCallback((path: string, cursor: string | null) => {
    const n = ++seq.current.versions
    const request = tracker?.begin()
    void api.listVersions(vaultPath, path, cursor).then(reply => {
      if (!seq.current.alive) return
      if (request !== undefined) tracker?.answer(vaultPath, request, reply?.status === 'ok' ? reply.health : null)
      if (seq.current.versions !== n) return
      setVersions(current => applyPage(current, cursor !== null, reply && (reply.status === 'ok' ? { status: 'ok', items: reply.versions, next: reply.nextCursor } : reply)))
    })
  }, [api, tracker, vaultPath])
  const loadLocations = useCallback((cursor: string | null) => {
    const n = ++seq.current.locations
    void api.listLocations(vaultPath, cursor).then(reply => {
      if (!seq.current.alive || seq.current.locations !== n) return
      setLocations(current => applyPage(current ?? loading(), cursor !== null, reply && (reply.status === 'ok' ? { status: 'ok', items: reply.locations, next: reply.nextCursor } : reply)))
    })
  }, [api, vaultPath])
  useEffect(() => { loadVersions(location, null) }, [loadVersions, location])

  const retryVersions = () => { setVersions(loading()); loadVersions(location, null) }
  const moreVersions = () => {
    if (!versions.next) return
    setVersions(current => ({ ...current, more: 'loading' }))
    loadVersions(location, versions.next)
  }
  const showLocations = () => { setLocations(loading()); loadLocations(null) }
  const moreLocations = () => {
    if (!locations?.next) return
    setLocations(current => current && { ...current, more: 'loading' })
    loadLocations(locations.next)
  }
  const setTab = (next: 'page' | 'locations') => {
    setTabState(next)
    // Fetched once, when first asked for; the counter, unlike state, already counts a same-tick repeat.
    if (next === 'locations' && seq.current.locations === 0) showLocations()
  }
  const browse = (path: string) => {
    setTabState('page')
    if (path === location) return
    seq.current.preview += 1
    setVersions(loading())
    setSelected(null)
    setPreview(null)
    setLocation(path)
  }
  const select = (row: VersionRow) => {
    const n = ++seq.current.preview
    setSelected(row)
    setPreview({ id: row.id, status: 'loading' })
    void api.readVersion(vaultPath, row).then(reply => {
      if (!seq.current.alive || seq.current.preview !== n) return
      setPreview(reply ? { id: row.id, status: 'ready', preview: reply } : { id: row.id, status: 'failed' })
    })
  }
  const saveCopy = (folder: string | null) => {
    if (!selected || copy?.saving) return
    const again = copy !== null && copy.versionId === selected.id && copy.folder === folder && !settled(copy.outcome)
    const attempt: CopyAttempt = {
      versionId: selected.id, folder, saving: true, outcome: null,
      operationId: again ? copy.operationId : globalThis.crypto.randomUUID(),
    }
    const n = ++seq.current.copy
    setCopy(attempt)
    void api.saveCopy(vaultPath, selected, folder, attempt.operationId).then(outcome => {
      // The copy exists whether or not this dialog is still open to say so.
      if (outcome?.status === 'created') onCopyCreated?.(outcome.path)
      if (!seq.current.alive || seq.current.copy !== n) return
      setCopy({ ...attempt, saving: false, outcome })
    })
  }

  return {
    tab, setTab, location, browse,
    versions, retryVersions, moreVersions,
    locations, retryLocations: showLocations, moreLocations,
    selected, select, preview,
    copy: copy && selected && copy.versionId === selected.id ? copy : null,
    copyBusy: copy?.saving === true,
    saveCopy,
  }
}
