import { useEffect, useState } from 'react'
import { Button } from '../components/ui/button'
import { translate, type AppLocale, type TranslationKey, type TranslationValues } from '../lib/i18n'
import type { TrashRestoreResult } from './localTrash'
import type { TrashActivity as Activity, TrashMoveOutcome } from './useLocalTrash'
import './trash.css'

const NOTICE_MS = 8_000
const ACTIVITY_DELAY_MS = 400

function outcomeLines(locale: AppLocale, outcome: TrashMoveOutcome): string[] {
  const t = (key: TranslationKey, values?: TranslationValues) => translate(locale, key, values)
  if (outcome.unavailable) return [t('leadinglight.trash.unavailable')]
  const lines: string[] = []
  if (outcome.moved.length === 1) lines.push(t('leadinglight.trash.moved', { title: outcome.moved[0].title }))
  if (outcome.moved.length > 1) lines.push(t('leadinglight.trash.movedMany', { count: outcome.moved.length }))
  for (const item of outcome.changed) lines.push(t('leadinglight.trash.changed', { title: item.title }))
  for (const item of outcome.uncertain) lines.push(t('leadinglight.trash.uncertain', { title: item.title }))
  const unsaved = outcome.failed.filter(item => item.code === 'saveFailed')
  const refused = outcome.failed.filter(item => item.code !== 'saveFailed')
  for (const item of unsaved) lines.push(t('leadinglight.trash.moveFailedSave', { title: item.title }))
  if (refused.length === 1) lines.push(t('leadinglight.trash.moveFailed', { title: refused[0].title }))
  if (refused.length > 1) lines.push(t('leadinglight.trash.moveFailedMany', { count: refused.length }))
  return lines
}

/** Result of a move, with Undo for the pages that left. Undo is bound to the move's own vault visit. */
export function TrashNotice({ outcome, locale, onUndo, onDismiss }: {
  outcome: TrashMoveOutcome
  locale: AppLocale
  onUndo: () => Promise<TrashRestoreResult | null>
  onDismiss: () => void
}) {
  const [undo, setUndo] = useState<'idle' | 'running' | 'done' | 'failed'>('idle')
  useEffect(() => {
    if (undo === 'running') return
    const timer = window.setTimeout(onDismiss, NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [onDismiss, undo])

  const canUndo = outcome.moved.length + outcome.uncertain.length > 0
  const lines = undo === 'done' ? [translate(locale, 'leadinglight.trash.undone')]
    : undo === 'failed' ? [translate(locale, 'leadinglight.trash.undoFailed')]
      : outcomeLines(locale, outcome)
  const runUndo = () => {
    setUndo('running')
    void onUndo().then(result => setUndo(result && result.failed.length === 0 && result.restored.length > 0 ? 'done' : 'failed'))
  }

  return (
    <div className="ll-trash-notice" role="status" data-testid="trash-notice">
      <div className="ll-trash-notice-text">{lines.map(line => <p key={line}>{line}</p>)}</div>
      {canUndo && (undo === 'idle' || undo === 'running') && (
        <Button variant="outline" size="sm" disabled={undo === 'running'} onClick={runUndo}>{translate(locale, 'leadinglight.trash.undo')}</Button>
      )}
      <Button variant="ghost" size="sm" onClick={onDismiss}>{translate(locale, 'leadinglight.trash.dismiss')}</Button>
    </div>
  )
}

/** A quiet note while a move or restore takes more than a moment; it never takes focus. */
export function TrashActivity({ activity, locale }: { activity: Activity, locale: AppLocale }) {
  const [shown, setShown] = useState<Activity>(null)
  useEffect(() => {
    if (!activity) return
    const timer = window.setTimeout(() => setShown(activity), ACTIVITY_DELAY_MS)
    return () => { window.clearTimeout(timer); setShown(null) }
  }, [activity])
  if (!activity || shown !== activity) return null
  return (
    <div className="ll-trash-notice ll-trash-activity" role="status" aria-live="polite">
      {translate(locale, activity === 'move' ? 'leadinglight.trash.moving' : 'leadinglight.trash.restoringStatus')}
    </div>
  )
}
