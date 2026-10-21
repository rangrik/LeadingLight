// The commentary surfaces outside the dialog: the "Commentary" header button on a source, the
// one-line source card under a commentary's header, and the Undo notice after Add or Create.
// Header button and card come from the notes' own Source links, so they stay when the recipe is off.
import { Quotes, X } from '@phosphor-icons/react'
import { Button } from '../../components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu'
import type { T } from '../extensions/extensionUiText'
import './commentary.css'

export interface LinkedNote { readonly path: string; readonly title: string }

/** Opens the one linked note beside, or lists several; no count or badge. */
export function CommentaryHeaderButton({ t, linked, onOpen }: { t: T; linked: readonly LinkedNote[]; onOpen: (path: string) => void }) {
  if (linked.length === 0) return null
  const label = t('leadinglight.commentary.header')
  if (linked.length === 1) {
    return <Button variant="ghost" size="sm" className="ll-commentary-header" data-testid="commentary-header" title={linked[0].title}
      onClick={() => onOpen(linked[0].path)}><Quotes aria-hidden="true" />{label}</Button>
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="ll-commentary-header" data-testid="commentary-header" aria-label={t('leadinglight.commentary.headerMenu')}>
          <Quotes aria-hidden="true" />{label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onEscapeKeyDown={event => event.stopPropagation()}>
        {linked.map(note => <DropdownMenuItem key={note.path} data-testid="commentary-header-item" onSelect={() => onOpen(note.path)}>{note.title}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export type SourceCardState =
  | { readonly kind: 'found'; readonly title: string; readonly visible: boolean }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unreadable' }

/** What the card can say about the page only; it never claims the passage is still there. */
export function CommentarySourceCard({ t, state, onOpen, onFind }: { t: T; state: SourceCardState; onOpen: () => void; onFind: () => void }) {
  switch (state.kind) {
    case 'found':
      return <div className="ll-commentary-card" data-testid="commentary-source-card" data-state="found">
        <p>{t('leadinglight.commentary.card.source', { title: state.title })}</p>
        <Button variant="outline" size="sm" data-testid="commentary-source-open" onClick={onOpen}>
          {t(state.visible ? 'leadinglight.commentary.card.show' : 'leadinglight.commentary.card.openBeside')}
        </Button>
      </div>
    case 'missing':
      return <div className="ll-commentary-card" data-testid="commentary-source-card" data-state="missing" role="status">
        <p>{t('leadinglight.commentary.card.missing')}</p>
        <Button variant="outline" size="sm" onClick={onFind}>{t('leadinglight.commentary.card.find')}</Button>
      </div>
    case 'unreadable':
      return <div className="ll-commentary-card" data-testid="commentary-source-card" data-state="unreadable" role="status">
        <p>{t('leadinglight.commentary.card.unreadable')}</p>
      </div>
  }
}

export type NoticeState =
  | { readonly step: 'offered' }
  | { readonly step: 'undoing' }
  /** Undo is no longer possible here; the notice says why until dismissed. */
  | { readonly step: 'blocked'; readonly reason: 'changed' | 'missing' | 'unavailable' | 'notUndone' }
  | { readonly step: 'busy' }
  | { readonly step: 'uncertain'; readonly operationId: string; readonly checking: boolean }

export interface UndoNoticeView {
  readonly kind: 'create' | 'append'
  readonly sourceTitle: string
  readonly durable: boolean
  readonly canUndo: boolean
  readonly state: NoticeState
}

const BLOCKED_KEYS = {
  changed: 'leadinglight.commentary.notice.changed',
  missing: 'leadinglight.commentary.notice.missing',
  unavailable: 'leadinglight.commentary.notice.unavailable',
  notUndone: 'leadinglight.commentary.notice.notUndone',
} as const

function noticeText(t: T, view: UndoNoticeView): string {
  switch (view.state.step) {
    case 'blocked': return t(BLOCKED_KEYS[view.state.reason])
    case 'busy': return t('leadinglight.commentary.notice.busy')
    case 'uncertain': return t('leadinglight.commentary.notice.uncertain')
    default:
      if (!view.durable) return t('leadinglight.commentary.notDurable')
      return view.kind === 'append' ? t('leadinglight.commentary.notice.added') : t('leadinglight.commentary.notice.created', { title: view.sourceTitle })
  }
}

/** Under the note's header: what was written, Undo while it is still exactly that, and dismiss. */
export function CommentaryUndoNotice({ t, view, onUndo, onCheckAgain, onDismiss }: {
  t: T; view: UndoNoticeView; onUndo: () => void; onCheckAgain: () => void; onDismiss: () => void
}) {
  const { state } = view
  const undoable = view.canUndo && (state.step === 'offered' || state.step === 'busy' || state.step === 'undoing')
  return (
    <div className="ll-commentary-notice" data-testid="commentary-notice" data-step={state.step}
      role={state.step === 'blocked' || state.step === 'uncertain' ? 'alert' : 'status'} aria-live="polite">
      <p>{noticeText(t, view)}</p>
      <div className="ll-commentary-actions">
        {undoable && <Button variant="outline" size="sm" data-testid="commentary-undo" disabled={state.step === 'undoing'} onClick={onUndo}>
          {t(state.step === 'undoing' ? 'leadinglight.commentary.notice.undoing' : 'leadinglight.commentary.notice.undo')}</Button>}
        {state.step === 'uncertain' && <Button variant="outline" size="sm" data-testid="commentary-undo-check" disabled={state.checking} onClick={onCheckAgain}>
          {t(state.checking ? 'leadinglight.extensions.checking' : 'leadinglight.extensions.checkAgain')}</Button>}
        <Button variant="ghost" size="icon-sm" aria-label={t('leadinglight.commentary.notice.dismiss')} title={t('leadinglight.commentary.notice.dismiss')}
          disabled={state.step === 'undoing' || (state.step === 'uncertain' && state.checking)} onClick={onDismiss}><X /></Button>
      </div>
    </div>
  )
}
