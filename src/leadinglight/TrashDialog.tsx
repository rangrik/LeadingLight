import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowCounterClockwise, File, FileText, Warning } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Button } from '../components/ui/button'
import { translate, type AppLocale, type TranslationKey, type TranslationValues } from '../lib/i18n'
import { listLocalTrash, type TrashItem, type TrashRestored, type TrashRestoreResult } from './localTrash'
import './trash.css'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  vaultPath: string
  locale: AppLocale
  restore: (ids: string[]) => Promise<TrashRestoreResult | null>
  /** Opens a restored page; resolves whether it is now shown. */
  onOpenPage: (path: string) => Promise<boolean>
}

interface Restored { id: string, path: string, message: string }

const FAILURE_KEYS: Record<string, TranslationKey> = {
  originalLocationUnavailable: 'leadinglight.trash.failed.originalLocationUnavailable',
  nameUnavailable: 'leadinglight.trash.failed.nameUnavailable',
  notFound: 'leadinglight.trash.failed.notFound',
  payloadMissing: 'leadinglight.trash.failed.payloadMissing',
  unavailable: 'leadinglight.trash.failed.unavailable',
}

function restoredMessage(locale: AppLocale, item: TrashRestored): string {
  const key: TranslationKey = item.relocated ? 'leadinglight.trash.restoredRecovered'
    : item.renamed ? 'leadinglight.trash.restoredRenamed' : 'leadinglight.trash.restored'
  const message = translate(locale, key, { path: item.relativePath })
  return item.cleanupPending ? `${message} ${translate(locale, 'leadinglight.trash.cleanupNote')}` : message
}

function TrashRow({ item, busy, failure, locale, onRestore, onOpen }: {
  item: TrashItem
  busy: boolean
  failure: string | undefined
  locale: AppLocale
  onRestore: () => void
  onOpen: (path: string) => void
}) {
  const t = (key: TranslationKey, values?: TranslationValues) => translate(locale, key, values)
  const Icon = item.fileKind === 'binary' ? File : FileText
  const date = item.deletedAt ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.deletedAt)) : null
  const meta = [item.originalPath && t('leadinglight.trash.from', { path: item.originalPath }), date && t('leadinglight.trash.movedOn', { date })].filter(Boolean).join(' · ')
  const restoredPath = item.state === 'cleanupPending' ? item.restoredPath ?? null : null
  const note = restoredPath ? t('leadinglight.trash.cleanupPending', { path: restoredPath })
    : item.state === 'needsAttention' ? t('leadinglight.trash.needsAttention')
      : item.state === 'missing' ? t('leadinglight.trash.missing') : null
  return (
    <li className="ll-trash-row" data-state={item.state}>
      <Icon className="ll-trash-icon" aria-hidden="true" />
      <div className="ll-trash-text">
        <span className="ll-trash-title">{item.title || item.filename || t('leadinglight.trash.unknownTitle')}</span>
        {meta && <span className="ll-trash-meta">{meta}</span>}
        {note && <span className="ll-trash-note">{!restoredPath && <Warning aria-hidden="true" />}{note}</span>}
        {failure && <span className="ll-trash-result" role="alert">{failure}</span>}
      </div>
      <div className="ll-trash-actions">
        {restoredPath ? (
          <Button variant="outline" size="sm" onClick={() => onOpen(restoredPath)}>{t('leadinglight.trash.open')}</Button>
        ) : item.state !== 'missing' && (
          <Button variant="outline" size="sm" disabled={busy} onClick={onRestore}>
            <ArrowCounterClockwise aria-hidden="true" />
            {t(busy ? 'leadinglight.trash.restoring' : 'leadinglight.trash.restore')}
          </Button>
        )}
      </div>
    </li>
  )
}

/** Local Trash: recoverable pages with their original path and date, each with a labeled Restore. */
export function TrashDialog({ open, onOpenChange, vaultPath, locale, restore, onOpenPage }: Props) {
  const t = (key: TranslationKey) => translate(locale, key)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="ll-trash-dialog" data-testid="trash-dialog">
        <DialogHeader>
          <DialogTitle>{t('leadinglight.trash.title')}</DialogTitle>
          <DialogDescription>{t('leadinglight.trash.description')}</DialogDescription>
        </DialogHeader>
        {/* Mounted per opening and vault, so nothing from an earlier one shows or lands here. */}
        <TrashBody key={vaultPath} vaultPath={vaultPath} locale={locale} restore={restore} onOpenPage={onOpenPage} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  )
}

function TrashBody({ vaultPath, locale, restore, onOpenPage, onOpenChange }: Omit<Props, 'open'>) {
  const t = (key: TranslationKey) => translate(locale, key)
  const [listing, setListing] = useState<{ status: 'loading' | 'failed' | 'ready', items: TrashItem[] }>({ status: 'loading', items: [] })
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [failures, setFailures] = useState<Record<string, string>>({})
  const [restored, setRestored] = useState<Restored[]>([])
  const request = useRef(0)

  const fetchItems = useCallback((id: number) => {
    listLocalTrash(vaultPath).then(
      items => { if (request.current === id) setListing({ status: 'ready', items }) },
      () => { if (request.current === id) setListing({ status: 'failed', items: [] }) },
    )
  }, [vaultPath])
  useEffect(() => {
    fetchItems(++request.current)
    return () => { request.current += 1 }
  }, [fetchItems])
  const load = () => {
    setListing(current => ({ status: 'loading', items: current.items }))
    fetchItems(++request.current)
  }

  const restoreItem = (id: string) => {
    const session = request.current
    setBusy(current => new Set(current).add(id))
    setFailures(current => {
      const next = { ...current }
      delete next[id]
      return next
    })
    void restore([id]).then(result => {
      if (request.current !== session) return
      setBusy(current => { const next = new Set(current); next.delete(id); return next })
      const done = result?.restored.find(item => item.id === id)
      if (done) {
        // A restored page leaves the list; its status stays until Trash closes.
        setRestored(current => [...current, { id, path: done.path, message: restoredMessage(locale, done) }])
        setListing(current => ({ ...current, items: current.items.filter(item => item.id !== id) }))
        return
      }
      const code = result?.failed.find(item => item.id === id)?.code ?? 'unavailable'
      setFailures(current => ({ ...current, [id]: translate(locale, FAILURE_KEYS[code] ?? 'leadinglight.trash.failed.generic') }))
    })
  }
  const openPage = (path: string) => {
    const absolute = path.startsWith('/') ? path : `${vaultPath.replace(/\/+$/u, '')}/${path}`
    void onOpenPage(absolute).then(shown => { if (shown) onOpenChange(false) })
  }

  return (
    <>
      {restored.length > 0 && (
        <div className="ll-trash-restored">
          {restored.map(item => (
            <div key={item.id} className="ll-trash-restored-row">
              <p role="status">{item.message}</p>
              <Button variant="outline" size="sm" onClick={() => openPage(item.path)}>{t('leadinglight.trash.open')}</Button>
            </div>
          ))}
        </div>
      )}
      {listing.status === 'failed' ? (
        <div className="ll-trash-empty" role="alert">
          <p>{t('leadinglight.trash.loadFailed')}</p>
          <Button variant="outline" size="sm" onClick={load}>{t('leadinglight.trash.retry')}</Button>
        </div>
      ) : listing.status === 'loading' && listing.items.length === 0 ? (
        <p className="ll-trash-empty" role="status">{t('leadinglight.trash.loading')}</p>
      ) : listing.items.length === 0 ? (
        restored.length === 0 && <p className="ll-trash-empty">{t('leadinglight.trash.empty')}</p>
      ) : (
        <ul className="ll-trash-list" aria-label={t('leadinglight.trash.title')}>
          {listing.items.map(item => (
            <TrashRow key={item.id} item={item} busy={busy.has(item.id)} failure={failures[item.id]} locale={locale}
              onRestore={() => restoreItem(item.id)} onOpen={openPage} />
          ))}
        </ul>
      )}
    </>
  )
}
