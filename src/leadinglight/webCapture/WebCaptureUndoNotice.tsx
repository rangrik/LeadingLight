// Under a saved page's header: where it came from, Undo while it is still exactly as saved, and
// dismiss. The same states as the commentary notice; Undo moves the new note to Trash.
import { X } from '@phosphor-icons/react'
import { Button } from '../../components/ui/button'
import type { NoticeState } from '../commentary/CommentaryNotices'
import type { T } from '../extensions/extensionUiText'
import './webCapture.css'

export interface WebCaptureNoticeView {
  /** The page's site name, as the note's `site` records it. */
  readonly site: string
  readonly durable: boolean
  readonly canUndo: boolean
  readonly state: NoticeState
}

const BLOCKED_KEYS = {
  changed: 'leadinglight.webCapture.notice.changed',
  missing: 'leadinglight.webCapture.notice.missing',
  unavailable: 'leadinglight.webCapture.notice.unavailable',
  notUndone: 'leadinglight.webCapture.notice.notUndone',
} as const

function noticeText(t: T, view: WebCaptureNoticeView): string {
  switch (view.state.step) {
    case 'blocked': return t(BLOCKED_KEYS[view.state.reason])
    case 'busy': return t('leadinglight.webCapture.notice.busy')
    case 'uncertain': return t('leadinglight.webCapture.notice.uncertain')
    default: return view.durable ? t('leadinglight.webCapture.notice.created', { site: view.site }) : t('leadinglight.extensions.notDurable')
  }
}

export function WebCaptureUndoNotice({ t, view, onUndo, onCheckAgain, onDismiss }: {
  t: T; view: WebCaptureNoticeView; onUndo: () => void; onCheckAgain: () => void; onDismiss: () => void
}) {
  const { state } = view
  const undoable = view.canUndo && (state.step === 'offered' || state.step === 'busy' || state.step === 'undoing')
  return (
    <div className="ll-web-capture-notice" data-testid="web-capture-notice" data-step={state.step}
      role={state.step === 'blocked' || state.step === 'uncertain' ? 'alert' : 'status'} aria-live="polite">
      <p>{noticeText(t, view)}</p>
      <div className="ll-web-capture-notice-actions">
        {undoable && <Button variant="outline" size="sm" data-testid="web-capture-undo" disabled={state.step === 'undoing'} onClick={onUndo}>
          {t(state.step === 'undoing' ? 'leadinglight.commentary.notice.undoing' : 'leadinglight.commentary.notice.undo')}</Button>}
        {state.step === 'uncertain' && <Button variant="outline" size="sm" data-testid="web-capture-undo-check" disabled={state.checking} onClick={onCheckAgain}>
          {t(state.checking ? 'leadinglight.extensions.checking' : 'leadinglight.extensions.checkAgain')}</Button>}
        <Button variant="ghost" size="icon-sm" aria-label={t('leadinglight.commentary.notice.dismiss')} title={t('leadinglight.commentary.notice.dismiss')}
          disabled={state.step === 'undoing' || (state.step === 'uncertain' && state.checking)} onClick={onDismiss}><X /></Button>
      </div>
    </div>
  )
}
