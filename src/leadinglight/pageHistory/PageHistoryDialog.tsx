import { useLayoutEffect, useRef, useState } from 'react'
import { ClockCounterClockwise, CopySimple, WarningCircle } from '@phosphor-icons/react'
import { Button } from '../../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { ScrollArea } from '../../components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs'
import { RetargetNoteDialog } from '../../components/note-retargeting/RetargetNoteDialog'
import { translate, type AppLocale, type TranslationKey, type TranslationValues } from '../../lib/i18n'
import type { PageHistoryApi, VersionCopyOutcome, VersionRow } from './pageHistoryApi'
import { REASON_KEYS, WARNING_KEYS, formatSize, formatWhen, vaultRelative } from './pageHistoryText'
import { usePageHistory, type CopyAttempt } from './usePageHistory'
import type { HealthTracker, HistoryWarning } from './usePageHistoryHealth'
import { SavedLocationsView } from './SavedLocationsView'
import { VersionPreview } from './VersionPreview'
import './pageHistory.css'

export interface PageHistoryTarget { vaultPath: string; path: string; title: string }
export interface HistoryFolder { path: string; label: string; detail: string }

interface Props {
  target: PageHistoryTarget | null
  locale: AppLocale
  warning: HistoryWarning | null
  tracker: HealthTracker | null
  onCheckHealth: () => void
  /** Real folders of the target's vault, as full paths, for a copy whose own folder is gone. */
  folders: HistoryFolder[]
  onClose: () => void
  /** Opens the copy at this exact path; resolves whether it is now shown. */
  onOpenCopy: (path: string) => Promise<boolean>
  onCopyCreated: (path: string) => void
  /** Where focus goes back on close; Radix' own choice when absent. */
  returnFocus: HTMLElement | null
  api?: PageHistoryApi
}

type T = (key: TranslationKey, values?: TranslationValues) => string
const warningText = (t: T, warning: HistoryWarning) => t(warning.reason ? WARNING_KEYS[warning.reason] : 'leadinglight.history.warning.generic')

/** A quiet note, beside Saved, that earlier versions are not being kept right now. */
export function PageHistoryWarning({ warning, locale, onOpen }: { warning: HistoryWarning; locale: AppLocale; onOpen: (trigger: HTMLElement) => void }) {
  const t: T = (key, values) => translate(locale, key, values)
  const label = `${warningText(t, warning)} ${t('leadinglight.history.warning.details')}`
  return (
    <Button variant="ghost" size="sm" className="ll-history-warning-chip" data-testid="page-history-warning"
      aria-label={label} title={label} onClick={event => onOpen(event.currentTarget)}>
      <WarningCircle aria-hidden="true" />{t('leadinglight.history.warning.chip')}
    </Button>
  )
}

/** Earlier versions of one page: lists, a passive preview and Save as a copy. */
export function PageHistoryDialog(props: Props) {
  const { target, locale, returnFocus } = props
  const t: T = (key, values) => translate(locale, key, values)
  // Opening a copy moves focus to its editor; the trigger must not take it back.
  const focusHandled = useRef(false)
  // The parent clears the trigger with the target, before Radix hands focus back; keep this opening's.
  const openedFrom = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => { if (target) openedFrom.current = returnFocus }, [target, returnFocus])
  return (
    <Dialog open={target !== null} onOpenChange={open => { if (!open) props.onClose() }}>
      <DialogContent className="ll-history-dialog" data-testid="page-history-dialog"
        onOpenAutoFocus={() => { focusHandled.current = false }}
        onCloseAutoFocus={event => {
          const back = openedFrom.current
          openedFrom.current = null
          if (focusHandled.current) event.preventDefault()
          else if (back?.isConnected) { event.preventDefault(); back.focus() }
        }}>
        <DialogHeader>
          <DialogTitle className="ll-history-title"><ClockCounterClockwise aria-hidden="true" />{t('leadinglight.history.title')}</DialogTitle>
          <DialogDescription>{t('leadinglight.history.description', { title: target?.title ?? '' })}</DialogDescription>
        </DialogHeader>
        {props.warning && (
          <div className="ll-history-health" role="status" data-testid="page-history-health">
            <WarningCircle aria-hidden="true" />
            <div className="ll-history-health-text">
              <p>{warningText(t, props.warning)}</p>
              <p>{t('leadinglight.history.warning.saveStatus')}</p>
            </div>
            <Button variant="outline" size="sm" data-testid="page-history-health-check" onClick={props.onCheckHealth}>{t('leadinglight.history.warning.check')}</Button>
          </div>
        )}
        {/* Mounted per page and vault, so nothing from an earlier opening shows or lands here. */}
        {target && <HistoryBody key={`${target.vaultPath}\n${target.path}`} {...props} target={target}
          onOpened={() => { focusHandled.current = true; props.onClose() }} />}
      </DialogContent>
    </Dialog>
  )
}

function VersionRows({ rows, selectedId, locale, onSelect }: { rows: VersionRow[]; selectedId: string | null; locale: AppLocale; onSelect: (row: VersionRow) => void }) {
  return (
    <ul className="ll-history-list" aria-label={translate(locale, 'leadinglight.history.list')}>
      {rows.map(row => (
        <li key={row.id}>
          <Button variant="ghost" className="ll-history-row" data-testid="page-history-version" data-version-id={row.id}
            aria-current={row.id === selectedId ? 'true' : undefined} onClick={() => onSelect(row)}>
            <span className="ll-history-row-text">
              <span className="ll-history-row-title">{formatWhen(locale, row.capturedAt)}</span>
              <span className="ll-history-row-meta">{translate(locale, REASON_KEYS[row.reason])} · {formatSize(locale, row.length)}</span>
            </span>
          </Button>
        </li>
      ))}
    </ul>
  )
}

function copyLines(t: T, copy: CopyAttempt, vaultPath: string): string[] {
  const outcome: VersionCopyOutcome | null = copy.outcome
  if (copy.saving) return [t('leadinglight.history.copy.saving')]
  if (!outcome) return [t('leadinglight.history.copy.noReply')]
  switch (outcome.status) {
    case 'created': return [
      t('leadinglight.history.copy.created', { path: outcome.relativePath }),
      copy.folder !== null && t('leadinglight.history.copy.links'),
      !outcome.durable && t('leadinglight.history.copy.notDurable'),
    ].filter((line): line is string => Boolean(line))
    case 'folderUnavailable': return [t('leadinglight.history.copy.folderGone', { folder: vaultRelative(vaultPath, outcome.recordedFolder) }), t('leadinglight.history.copy.linksChoice')]
    case 'uncertain': return [t('leadinglight.history.copy.uncertain'),
      ...(outcome.candidatePath ? [t('leadinglight.history.copy.maybeAt', { path: vaultRelative(vaultPath, outcome.candidatePath) })] : [])]
    case 'refused':
      if (outcome.reason === 'busy') return [t('leadinglight.history.copy.busy')]
      if (outcome.reason === 'nameUnavailable') return [t('leadinglight.history.copy.noName')]
      if (outcome.reason === 'damaged' || outcome.reason === 'missing') return [t(`leadinglight.history.preview.${outcome.reason}`)]
      return [t('leadinglight.history.copy.failed')]
    case 'failed': return [t('leadinglight.history.copy.failed')]
  }
}

function CopyPanel({ copy, busy, vaultPath, folders, locale, onSave, onOpenCopy, onOpened }: {
  copy: CopyAttempt | null
  busy: boolean
  vaultPath: string
  folders: HistoryFolder[]
  locale: AppLocale
  onSave: (folder: string | null) => void
  onOpenCopy: (path: string) => Promise<boolean>
  onOpened: () => void
}) {
  const t: T = (key, values) => translate(locale, key, values)
  const [choosing, setChoosing] = useState(false)
  const [openFailed, setOpenFailed] = useState<string | null>(null)
  const outcome = copy?.saving ? null : copy?.outcome ?? null
  const retry = copy !== null && !copy.saving && (outcome === null || outcome.status === 'uncertain' || (outcome.status === 'refused' && outcome.reason === 'busy'))
  const open = (path: string) => {
    setOpenFailed(null)
    void onOpenCopy(path).then(shown => { if (shown) onOpened(); else setOpenFailed(path) })
  }
  return (
    <div className="ll-history-copy">
      <div className="ll-history-copy-actions">
        <Button size="sm" data-testid="page-history-save-copy" disabled={busy} onClick={() => onSave(null)}>
          <CopySimple aria-hidden="true" />{t('leadinglight.history.copy.action')}
        </Button>
        {retry && copy && <Button variant="outline" size="sm" data-testid="page-history-copy-retry" disabled={busy}
          onClick={() => onSave(copy.folder)}>{t('leadinglight.history.copy.retry')}</Button>}
        {outcome?.status === 'folderUnavailable' && <Button variant="outline" size="sm" data-testid="page-history-choose-folder"
          disabled={busy} onClick={() => setChoosing(true)}>{t('leadinglight.history.copy.chooseFolder')}</Button>}
        {outcome?.status === 'created' && <Button variant="outline" size="sm" data-testid="page-history-open-copy"
          onClick={() => open(outcome.path)}>{t('leadinglight.history.copy.open')}</Button>}
      </div>
      <p className="ll-history-quiet">{t('leadinglight.history.copy.explain')}</p>
      {copy && (
        <div className="ll-history-copy-result" role="status" data-testid="page-history-copy-result" data-outcome={copy.saving ? 'saving' : outcome?.status ?? 'noReply'}>
          {copyLines(t, copy, vaultPath).map(line => <p key={line}>{line}</p>)}
          {openFailed && <p>{t('leadinglight.history.copy.openFailed', { path: vaultRelative(vaultPath, openFailed) })}</p>}
        </div>
      )}
      <RetargetNoteDialog open={choosing} title={t('leadinglight.history.folder.title')} description={t('leadinglight.history.folder.description')}
        searchPlaceholder={t('leadinglight.history.folder.search')} emptyMessage={t('leadinglight.history.folder.empty')}
        options={folders.map(folder => ({ id: folder.path, label: folder.label, detail: folder.detail }))}
        onClose={() => setChoosing(false)}
        onSelect={folder => { setChoosing(false); onSave(folder); return true }} testIdPrefix="page-history-folder" />
    </div>
  )
}

function HistoryBody({ target, locale, tracker, folders, api, onOpenCopy, onCopyCreated, onOpened }: Props & { target: PageHistoryTarget; onOpened: () => void }) {
  const t: T = (key, values) => translate(locale, key, values)
  const history = usePageHistory({ vaultPath: target.vaultPath, pagePath: target.path, tracker, api, onCopyCreated })
  const { versions, preview, selected } = history
  const shown = preview?.status === 'ready' ? preview.preview : null
  const awayFromPage = history.location !== target.path
  return (
    <div className="ll-history-body">
      <Tabs className="ll-history-side" value={history.tab} onValueChange={value => history.setTab(value === 'locations' ? 'locations' : 'page')}>
        <TabsList className="ll-history-tabs">
          <TabsTrigger value="page" data-testid="page-history-tab-page">{t('leadinglight.history.tab.page')}</TabsTrigger>
          <TabsTrigger value="locations" data-testid="page-history-tab-locations">{t('leadinglight.history.tab.locations')}</TabsTrigger>
        </TabsList>
        <TabsContent value="page" className="ll-history-pane">
          {awayFromPage && (
            <div className="ll-history-browsing">
              <p>{t('leadinglight.history.browsing', { path: vaultRelative(target.vaultPath, history.location) })}</p>
              <Button variant="ghost" size="sm" data-testid="page-history-back" onClick={() => history.browse(target.path)}>{t('leadinglight.history.back')}</Button>
            </div>
          )}
          {versions.status === 'loading' ? <p className="ll-history-quiet" role="status">{t('leadinglight.history.loading')}</p>
            : versions.status === 'failed' ? (
              <div className="ll-history-quiet" role="alert">
                <p>{t('leadinglight.history.failed')}</p>
                <Button variant="outline" size="sm" onClick={history.retryVersions}>{t('leadinglight.history.retry')}</Button>
              </div>
            ) : versions.status === 'refused' ? <p className="ll-history-quiet" role="alert">{t('leadinglight.history.outsideVault')}</p>
              : versions.items.length === 0 ? <p className="ll-history-quiet" data-testid="page-history-empty">{t('leadinglight.history.empty')}</p>
                : (
                  <ScrollArea className="ll-history-list-scroll">
                    <VersionRows rows={versions.items} selectedId={selected?.id ?? null} locale={locale} onSelect={history.select} />
                    {versions.next && (
                      <Button variant="ghost" size="sm" className="ll-history-more" data-testid="page-history-more"
                        disabled={versions.more === 'loading'} onClick={history.moreVersions}>
                        {t(versions.more === 'failed' ? 'leadinglight.history.moreFailed' : 'leadinglight.history.more')}
                      </Button>
                    )}
                  </ScrollArea>
                )}
          <p className="ll-history-note">{t('leadinglight.history.renameNote')}</p>
        </TabsContent>
        <TabsContent value="locations" className="ll-history-pane">
          <p className="ll-history-note">{t('leadinglight.history.renameNote')}</p>
          {history.locations && <SavedLocationsView listing={history.locations} vaultPath={target.vaultPath} current={history.location}
            locale={locale} onBrowse={history.browse} onMore={history.moreLocations} onRetry={history.retryLocations} />}
        </TabsContent>
      </Tabs>
      <section className="ll-history-main" aria-label={t('leadinglight.history.preview.label')}>
        {!selected ? <p className="ll-history-quiet">{t('leadinglight.history.choose')}</p>
          : preview?.status === 'loading' ? <p className="ll-history-quiet" role="status">{t('leadinglight.history.preview.loading')}</p>
            : !shown ? <p className="ll-history-quiet" role="alert">{t('leadinglight.history.preview.failed')}</p>
              : shown.status !== 'ok' ? (
                <p className="ll-history-quiet" role="alert" data-testid="page-history-preview-unavailable">
                  {t(shown.status === 'refused' ? 'leadinglight.history.outsideVault' : `leadinglight.history.preview.${shown.status}`)}
                </p>
              ) : (
                <>
                  <VersionPreview key={selected.id} preview={shown} locale={locale} />
                  <CopyPanel key={selected.id} copy={history.copy} busy={history.copyBusy} vaultPath={target.vaultPath} folders={folders} locale={locale}
                    onSave={history.saveCopy} onOpenCopy={onOpenCopy} onOpened={onOpened} />
                </>
              )}
      </section>
    </div>
  )
}
