import { useState } from 'react'
import { Info, WarningCircle } from '@phosphor-icons/react'
import { Button } from '../../components/ui/button'
import { Dialog, DialogTrigger } from '../../components/ui/dialog'
import { SAVE_REFUSAL_KEYS, type SaveCopyView, type SaveHoldKind } from '../../hooks/useEditorSave'
import { translate, type AppLocale, type TranslationKey, type TranslationValues } from '../../lib/i18n'
import { SaveHoldDialog } from './SaveHoldDialog'
import type { PageRecoveryView, SaveHoldActions } from './useSaveHoldActions'
import './saveHold.css'

const HOLD_KEYS: Record<SaveHoldKind, TranslationKey> = {
  unknown: 'saveHold.unknown',
  conflict: 'saveHold.conflict',
  missing: 'saveHold.missing',
  linked: 'saveHold.linked',
  uncertain: 'saveHold.uncertain',
  unsafe: 'saveHold.unsafe',
}

type Line = [TranslationKey, TranslationValues?]

function copyLine(copy: SaveCopyView | null, canKeepCopy: boolean): Line | null {
  if (!copy) return null
  const outcome = copy.outcome
  if (!outcome) return ['saveHold.copy.noReply']
  if (outcome.status === 'created') return canKeepCopy ? ['saveHold.copy.saved', { path: outcome.relativePath }] : ['saveHold.copy.newer']
  if (outcome.status === 'folderUnavailable') return ['saveHold.copy.folderMissing']
  if (outcome.status === 'uncertain') return ['saveHold.copy.uncertain']
  if (outcome.status === 'refused' && outcome.reason === 'busy') return ['save.refused.busy']
  return ['saveHold.copy.failed']
}

function mainLine(view: PageRecoveryView, t: (key: TranslationKey, values?: TranslationValues) => string): Line | null {
  if (view.hold) return [HOLD_KEYS[view.hold.kind]]
  if (view.retriable) {
    const reason = view.retriable.reason === 'noVault' ? 'save.toast.missingActiveVault' : SAVE_REFUSAL_KEYS[view.retriable.reason]
    return ['saveHold.retriable', { reason: t(reason) }]
  }
  return view.notDurable ? ['saveHold.notDurable'] : null
}

/** A calm, persistent note on one page whose text could not be saved, with the choices that keep it safe. */
export function SaveHoldBanner({ view, actions, title, locale, named = false }: {
  view: PageRecoveryView
  actions: Pick<SaveHoldActions, 'checkAgain' | 'saveCopy' | 'finish'>
  title: string
  locale: AppLocale
  /** Away from its pane the note names its page. */
  named?: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  const t = (key: TranslationKey, values?: TranslationValues) => translate(locale, key, values)
  const record = view.hold ?? view.retriable
  const rows = Object.entries({
    page: named ? ['saveHold.page', { title }] as Line : null,
    state: mainLine(view, t),
    final: view.hold?.nativeUnknown ? ['saveHold.final.noReply'] as Line : null,
    copy: record ? copyLine(view.copy, view.canKeepCopy) : null,
    notice: view.notice ? [view.notice.key, view.notice.values] as Line : null,
    busy: view.busy ? ['saveHold.working'] as Line : null,
  }).flatMap(([id, line]) => line ? [[id, t(...line)] as const] : [])
    // A notice can repeat the copy line word for word; say it once.
    .filter(([, text], index, all) => all.findIndex(([, other]) => other === text) === index)
  if (rows.length === (named ? 1 : 0)) return null

  const busy = view.busy !== null
  const folderMissing = view.copy?.outcome?.status === 'folderUnavailable'
  const Icon = record ? WarningCircle : Info
  return (
    <Dialog open={confirming} onOpenChange={setConfirming}>
      <div className="ll-save-hold" role="status" aria-busy={busy} data-testid="save-hold-banner">
        <Icon className="ll-save-hold-icon" aria-hidden="true" />
        <div className="ll-save-hold-text">{rows.map(([id, text]) => <p key={id}>{text}</p>)}</div>
        {record && (
          <div className="ll-save-hold-actions">
            {view.hold && <Button variant="outline" size="sm" disabled={busy} onClick={() => { void actions.checkAgain(view.path) }}>{t('saveHold.action.check')}</Button>}
            {folderMissing
              // The page's own folder is gone; a copy elsewhere is the person's explicit choice.
              ? <Button variant="outline" size="sm" disabled={busy} onClick={() => { void actions.saveCopy(view.path, record.request.vaultPath) }}>{t('saveHold.action.copyAtTop')}</Button>
              : <Button variant="outline" size="sm" disabled={busy} onClick={() => { void actions.saveCopy(view.path, null) }}>{t('saveHold.action.copy')}</Button>}
            {view.canKeepCopy && <Button variant="outline" size="sm" disabled={busy} onClick={() => { void actions.finish(view.path, 'keepCopy') }}>{t('saveHold.action.keepCopy')}</Button>}
            {/* The trigger is where Escape and Cancel return focus. */}
            <DialogTrigger asChild><Button variant="ghost" size="sm" disabled={busy}>{t('saveHold.action.discard')}</Button></DialogTrigger>
          </div>
        )}
      </div>
      <SaveHoldDialog title={title} locale={locale}
        onConfirm={() => { setConfirming(false); void actions.finish(view.path, 'discard') }} />
    </Dialog>
  )
}
