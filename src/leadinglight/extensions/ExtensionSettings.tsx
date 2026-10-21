import { useState } from 'react'
import { ArrowCounterClockwise, PuzzlePiece } from '@phosphor-icons/react'
import { SectionHeading, SettingsGroup, SettingsGroupItem, SettingsRow } from '../../components/SettingsControls'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { Switch } from '../../components/ui/switch'
import type { AppLocale } from '../../lib/i18n'
import { canAttach } from '../adapt/adaptAttachments'
import { ExtensionDialogContent } from './ExtensionPreviewDialog'
import type { PackageView } from './extensionSessionController'
import { chipFor, chipText, translator, type T } from './extensionUiText'
import type { ExtensionUi } from './useExtensionUi'
import './extensions.css'

/** Adapt's entry points in this section: ask for a new extension, or change an existing one. */
export interface ExtensionAdaptActions {
  ask: () => void
  adjust: (view: PackageView) => void
}

/** Settings → Extensions: each stored package for this workspace, from the registry itself. */
export function ExtensionSettings({ ui, adapt }: { ui: ExtensionUi; adapt?: ExtensionAdaptActions }) {
  const t = translator(ui.locale)
  const { snapshot, notice } = ui
  return (
    <div className="ll-ext-settings" data-testid="extension-settings">
      <SectionHeading icon={<PuzzlePiece size={16} aria-hidden="true" />} title={t('leadinglight.extensions.title')} />
      <p className="ll-ext-settings-text">{t('leadinglight.extensions.description')}</p>
      {snapshot.status === 'ready' ? (
        <SettingsGroup>
          {adapt && <SettingsRow label={t('leadinglight.adapt.askRow')} description={t('leadinglight.adapt.askRowDescription')} controlWidth="auto">
            <Button variant="outline" size="sm" data-testid="extension-adapt" onClick={adapt.ask}>{t('leadinglight.adapt.askButton')}</Button>
          </SettingsRow>}
          {snapshot.packages.length === 0 && <SettingsGroupItem><p className="ll-ext-quiet">{t('leadinglight.extensions.empty')}</p></SettingsGroupItem>}
          {snapshot.packages.map(view => <PackageRow key={view.packageId} t={t} ui={ui} view={view} adapt={adapt} />)}
          <SettingsRow label={t('leadinglight.extensions.addRow')} description={t('leadinglight.extensions.addDescription')} controlWidth="auto">
            <Button variant="outline" size="sm" data-testid="extension-paste" onClick={ui.paste}>{t('leadinglight.extensions.paste')}</Button>
          </SettingsRow>
        </SettingsGroup>
      ) : snapshot.status === 'failed' || snapshot.status === 'unsettled' ? (
        <div className="ll-ext-notice" role="alert" data-testid="extension-settings-failed" data-status={snapshot.status}>
          <p>{t(snapshot.status === 'unsettled' ? 'leadinglight.extensions.unsettled'
            : snapshot.reason === 'vaultUnavailable' ? 'leadinglight.extensions.vaultUnavailable' : 'leadinglight.extensions.failed')}</p>
          <Button variant="outline" size="sm" data-testid="extension-settings-retry" onClick={ui.retry}>{t('leadinglight.extensions.retry')}</Button>
        </div>
      ) : (
        <p className="ll-ext-quiet" role="status">{t('leadinglight.extensions.loading')}</p>
      )}
      <div className="ll-ext-settings-status" role="status" data-testid="extension-notice">
        {notice && <>
          <span>{notice.text}</span>
          {notice.tryKey && <Button variant="outline" size="sm" data-testid="extension-try" onClick={() => ui.openRun(notice.tryKey!)}>{t('leadinglight.extensions.tryIt')}</Button>}
        </>}
      </div>
      <p className="ll-ext-quiet" data-testid="extension-backup-limitation">{t('leadinglight.extensions.backup')}</p>
    </div>
  )
}

function summaryOf(view: PackageView): string {
  const load = view.activeSha256 !== null ? view.active : view.candidate?.load
  return load?.status === 'ready' ? load.extension.description : ''
}

function PackageRow({ t, ui, view, adapt }: { t: T; ui: ExtensionUi; view: PackageView; adapt?: ExtensionAdaptActions }) {
  const chip = chipFor(view)
  const on = view.activeSha256 !== null
  const busy = ui.busyPackage !== null
  const canPreview = view.candidate !== null || (on && view.active?.status === 'ready')
  const canTurnOn = on || (chip !== 'unavailable' && chip !== 'unreadable')
  // Adjust needs a readable version to start from: the one on, else the newest stored one.
  const canAdjust = adapt !== undefined && canAttach(view)
  return (
    <div data-testid="extension-row" data-package-id={view.packageId} data-chip={chip}>
      <SettingsRow label={view.name} description={summaryOf(view)} controlWidth="auto">
        <div className="ll-ext-row-controls">
          <Badge variant="outline" data-testid="extension-chip">{chipText(t, chip)}</Badge>
          {canPreview && <Button variant="ghost" size="sm" data-testid="extension-preview" disabled={busy} onClick={() => ui.preview(view)}>
            {on && view.candidate ? t('leadinglight.extensions.reviewVersion', { version: view.candidate.stored.version }) : t('leadinglight.extensions.preview')}
          </Button>}
          {on && view.rollback && <Button variant="ghost" size="sm" data-testid="extension-rollback" disabled={busy || !view.rollback.readable} onClick={() => ui.rollback(view)}>
            <ArrowCounterClockwise aria-hidden="true" />{t('leadinglight.extensions.rollback', { version: view.rollback.version })}
          </Button>}
          {canAdjust && <Button variant="ghost" size="sm" data-testid="extension-adjust" disabled={busy}
            aria-label={t('leadinglight.adapt.adjustLabel', { name: view.name })} onClick={() => adapt!.adjust(view)}>{t('leadinglight.adapt.adjust')}</Button>}
          <Switch data-testid="extension-switch" checked={on} disabled={busy || !canTurnOn} aria-label={t('leadinglight.extensions.switch', { name: view.name })}
            onCheckedChange={next => { void ui.toggle(view, next) }} />
        </div>
      </SettingsRow>
    </div>
  )
}

/** Asks once; behaviour only. Notes keep their content, and Page history is the way to change one. */
export function ExtensionRollbackDialog({ locale, name, version, onConfirm, onCancel, onCloseAutoFocus }: {
  locale: AppLocale; name: string; version: string; onConfirm: () => Promise<void>; onCancel: () => void; onCloseAutoFocus?: (event: Event) => void
}) {
  const t = translator(locale)
  const [working, setWorking] = useState(false)
  const confirm = async () => {
    if (working) return
    setWorking(true)
    try { await onConfirm() } finally { setWorking(false) }
  }
  return (
    <Dialog open onOpenChange={open => { if (!open && !working) onCancel() }}>
      <ExtensionDialogContent className="ll-ext-confirm-dialog" data-testid="extension-rollback-dialog" showCloseButton={!working}
        onCloseAutoFocus={onCloseAutoFocus} onEscapeKeyDown={event => { if (working) event.preventDefault() }}>
        <DialogHeader>
          <DialogTitle>{t('leadinglight.extensions.rollbackTitle', { version })}</DialogTitle>
          <DialogDescription>{name}</DialogDescription>
        </DialogHeader>
        <p className="ll-ext-text">{t('leadinglight.extensions.rollbackBody')}</p>
        <DialogFooter>
          <Button variant="outline" disabled={working} onClick={onCancel}>{t('leadinglight.extensions.cancel')}</Button>
          <Button data-testid="extension-rollback-confirm" disabled={working} onClick={() => { void confirm() }}>{t('leadinglight.extensions.rollbackConfirm')}</Button>
        </DialogFooter>
      </ExtensionDialogContent>
    </Dialog>
  )
}
