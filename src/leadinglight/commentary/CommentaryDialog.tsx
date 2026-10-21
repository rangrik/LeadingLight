import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { Quotes } from '@phosphor-icons/react'
import { Button } from '../../components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { Switch } from '../../components/ui/switch'
import type { AppLocale } from '../../lib/i18n'
import type { AnswerValue, FormAnswers, FormField, InputProblem } from '../extensions/extensionContract'
import { ExtensionDialogContent, PassiveNote } from '../extensions/ExtensionPreviewDialog'
import { RunField } from '../extensions/ExtensionRunDialog'
import { fieldProblems, filled, initialAnswers } from '../extensions/extensionRunForm'
import type { NotWrittenReason, UncertainDetail } from '../extensions/extensionSessionController'
import { notWrittenText, translator, type FieldProblem, type T } from '../extensions/extensionUiText'
import './commentary.css'

/** Where the passage goes: added to a linked note, or a new note (numbered when separate). */
export type CommentaryChoice = { readonly kind: 'append'; readonly path: string } | { readonly kind: 'create'; readonly separate: boolean }

export interface CommentaryOption { readonly path: string; readonly title: string }

export type CommentaryDestinations =
  | { readonly status: 'loading' }
  /** `options`: linked notes that can be added to, most recently edited first. */
  | { readonly status: 'ready'; readonly options: readonly CommentaryOption[]; readonly incomplete: boolean; readonly initial: CommentaryChoice }

/** What opening the note would do to the other pane, said before Add. */
export type PaneEffect = { readonly kind: 'shown' } | { readonly kind: 'beside' } | { readonly kind: 'replaces'; readonly page: string }

/** How one Add or Create ended, as the dialog shows it. */
export type CommentarySubmit =
  /** Written and shown beside the source; the dialog closes and focus is in that note. */
  | { readonly status: 'shown' }
  /** Written; never written again from here. */
  | { readonly status: 'notShown'; readonly kind: 'create' | 'append'; readonly title: string }
  | { readonly status: 'notWritten'; readonly reason: NotWrittenReason | 'settleFailed'; readonly title: string }
  | { readonly status: 'uncertain'; readonly detail: UncertainDetail }
  | { readonly status: 'revoked'; readonly reason: 'workspace' | 'package' }
  | { readonly status: 'invalid'; readonly problems: readonly InputProblem[] }
  | { readonly status: 'busy' }

export type SubmitPhase = 'saving' | 'adding' | 'creating'

/** The host's side of one run: everything the dialog asks or does goes through here. */
export interface CommentaryRunView {
  readonly commandTitle: string
  readonly quote: string
  readonly fields: readonly FormField[]
  /** Re-read on every render; the host updates it once its local search finishes. */
  destinations(): CommentaryDestinations
  /** A new note's title for these answers, and whether a note already has its name; null when none is free. */
  createName(answers: FormAnswers, separate: boolean): { readonly title: string; readonly taken: boolean } | null
  paneEffect(choice: CommentaryChoice): PaneEffect
  /** The new entry's Markdown for a passive preview, with the recipe's own problems. */
  preview(answers: FormAnswers, choice: CommentaryChoice): { readonly markdown: string | null; readonly problems: readonly InputProblem[] }
  submit(answers: FormAnswers, choice: CommentaryChoice, phase: (phase: SubmitPhase) => void): Promise<CommentarySubmit>
  /** Asks about the unresolved write again; never writes. */
  checkAgain(): Promise<CommentarySubmit>
  /** Workspace or package revocation, as it happens. */
  revoked(): 'workspace' | 'package' | null
  subscribe(listener: () => void): () => void
  /** The dialog closed without a shown note: `abandoned` retires an unresolved write. */
  close(how: 'cancelled' | 'abandoned' | 'done'): void
}

type Banner = { kind: 'form' } | { kind: 'notWritten'; reason: NotWrittenReason | 'settleFailed'; title: string }
type Phase =
  | { step: 'editing'; banner: Banner | null }
  | { step: 'working'; phase: SubmitPhase }
  | { step: 'uncertain'; detail: UncertainDetail; checking: boolean }
  | { step: 'committed'; kind: 'create' | 'append'; title: string }
  | { step: 'revoked'; reason: 'workspace' | 'package' }

const NEW_NOTE = ':new'

interface Props {
  locale: AppLocale
  run: CommentaryRunView
  /** `handled`: focus already moved to the note. */
  onClose: (handled: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
}

const choiceKey = (choice: CommentaryChoice) => (choice.kind === 'append' ? choice.path : NEW_NOTE)

/** One run of a passage command: the passage, the recipe's questions, where it goes, Add or Create. */
export function CommentaryDialog({ locale, run, onClose, onCloseAutoFocus }: Props) {
  const t = translator(locale)
  const baseId = useId()
  const { fields } = run
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>(() => initialAnswers(fields))
  const [errors, setErrors] = useState<Map<string, FieldProblem>>(new Map())
  const [phase, setPhase] = useState<Phase>({ step: 'editing', banner: null })
  const [discard, setDiscard] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [showAll, setShowAll] = useState(false)
  useSyncExternalStore(run.subscribe, run.destinations)
  const revoked = useSyncExternalStore(run.subscribe, run.revoked)
  const destinations = run.destinations()
  const [chosen, setChosen] = useState<CommentaryChoice | null>(null)
  const choice: CommentaryChoice | null = chosen ?? (destinations.status === 'ready' ? destinations.initial : null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const view: Phase = revoked && phase.step === 'editing' ? { step: 'revoked', reason: revoked } : phase
  const locked = view.step !== 'editing'
  const dirty = fields.some(field => filled(answers[field.id]))
  const preview = choice ? run.preview(answers, choice) : null
  const name = choice?.kind === 'create' ? run.createName(answers, choice.separate) : null

  const apply = (outcome: CommentarySubmit) => {
    if (!mounted.current) return
    switch (outcome.status) {
      case 'shown':
        onClose(true)
        return
      case 'notShown':
        setPhase({ step: 'committed', kind: outcome.kind, title: outcome.title })
        return
      case 'notWritten':
        setPhase({ step: 'editing', banner: { kind: 'notWritten', reason: outcome.reason, title: outcome.title } })
        return
      case 'uncertain':
        setPhase({ step: 'uncertain', detail: outcome.detail, checking: false })
        return
      case 'revoked':
        setPhase({ step: 'revoked', reason: outcome.reason })
        return
      case 'invalid': {
        const found = fieldProblems(fields, { ...answers }, outcome.problems)
        setErrors(found)
        setPhase({ step: 'editing', banner: { kind: 'form' } })
        return
      }
      case 'busy':
        setPhase({ step: 'editing', banner: { kind: 'notWritten', reason: 'busy', title: '' } })
    }
  }

  const submit = async () => {
    if (view.step !== 'editing' || !choice || destinations.status !== 'ready') return
    const current: FormAnswers = { ...answers }
    const found = fieldProblems(fields, current, preview?.problems ?? [])
    setErrors(found)
    if (found.size > 0 || (choice.kind === 'create' && !name)) {
      setPhase({ step: 'editing', banner: { kind: 'form' } })
      return
    }
    setDiscard(false)
    setPhase({ step: 'working', phase: choice.kind === 'append' ? 'saving' : 'creating' })
    apply(await run.submit(current, choice, next => { if (mounted.current) setPhase({ step: 'working', phase: next }) }))
  }

  const checkAgain = async () => {
    if (phase.step !== 'uncertain' || phase.checking) return
    setPhase({ ...phase, checking: true })
    apply(await run.checkAgain())
  }

  const close = () => {
    run.close(phase.step === 'uncertain' ? 'abandoned' : phase.step === 'committed' ? 'done' : 'cancelled')
    onClose(false)
  }
  const requestClose = () => {
    if (view.step === 'working' || (view.step === 'uncertain' && view.checking)) return
    if (discard) { setDiscard(false); return }
    if (view.step === 'uncertain' || (view.step === 'editing' && dirty)) { setDiscard(true); return }
    close()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
    event.preventDefault()
    event.stopPropagation()
    if (view.step === 'editing') void submit()
    else if (view.step === 'uncertain') void checkAgain()
  }
  const setAnswer = (fieldId: string, value: AnswerValue) => {
    if (locked) return
    setAnswers(current => ({ ...current, [fieldId]: value }))
    setErrors(current => { if (!current.has(fieldId)) return current; const next = new Map(current); next.delete(fieldId); return next })
  }
  const choose = (next: CommentaryChoice) => {
    if (locked) return
    setChosen(next)
    if (phase.step === 'editing' && phase.banner?.kind === 'notWritten') setPhase({ step: 'editing', banner: null })
  }

  const previewId = `${baseId}-preview`
  const passageId = `${baseId}-passage`
  const appendTitle = choice?.kind === 'append' && destinations.status === 'ready'
    ? destinations.options.find(option => option.path === choice.path)?.title ?? '' : ''
  return (
    <Dialog open onOpenChange={open => { if (!open) requestClose() }}>
      <ExtensionDialogContent className="ll-commentary-dialog" data-testid="commentary-dialog" data-step={view.step}
        showCloseButton={view.step !== 'working'} onCloseAutoFocus={onCloseAutoFocus} onKeyDown={onKeyDown}
        onEscapeKeyDown={event => { event.preventDefault(); requestClose() }}
        onInteractOutside={event => { event.preventDefault(); requestClose() }}>
        <DialogHeader>
          <DialogTitle className="ll-ext-title"><Quotes aria-hidden="true" />{run.commandTitle}</DialogTitle>
          <DialogDescription>{t('leadinglight.commentary.description')}</DialogDescription>
        </DialogHeader>
        <div className="ll-commentary-body">
          <figure className="ll-commentary-passage" aria-label={t('leadinglight.commentary.passage')}>
            <blockquote id={passageId} data-expanded={showAll} data-testid="commentary-passage">{run.quote}</blockquote>
            <Button variant="link" size="sm" className="ll-commentary-show-all" aria-expanded={showAll} aria-controls={passageId}
              onClick={() => setShowAll(value => !value)}>{t(showAll ? 'leadinglight.commentary.showLess' : 'leadinglight.commentary.showAll')}</Button>
          </figure>
          <div className="ll-commentary-form">
            {fields.map((field, index) => <RunField key={field.id} t={t} field={field} id={`${baseId}-field-${field.id}`} value={answers[field.id] ?? null}
              error={errors.get(field.id) ?? null} readOnly={locked} autoFocus={index === 0} onChange={value => setAnswer(field.id, value)} />)}
          </div>
          <Destination t={t} baseId={baseId} run={run} destinations={destinations} choice={choice} name={name} appendTitle={appendTitle}
            locked={locked} onChoose={choose} />
          <Button variant="outline" size="sm" className="ll-commentary-preview-toggle" aria-expanded={showPreview} aria-controls={previewId}
            onClick={() => setShowPreview(value => !value)}>{t(showPreview ? 'leadinglight.extensions.hidePreview' : 'leadinglight.extensions.showPreview')}</Button>
          <section id={previewId} className="ll-commentary-preview" data-open={showPreview}
            aria-label={t(choice?.kind === 'append' ? 'leadinglight.commentary.previewAdded' : 'leadinglight.commentary.previewNew')}>
            <p className="ll-ext-quiet">{t(choice?.kind === 'append' ? 'leadinglight.commentary.previewAdded' : 'leadinglight.commentary.previewNew')}</p>
            {preview?.markdown && <PassiveNote content={preview.markdown} locale={locale} />}
          </section>
        </div>
        <Status t={t} view={view} appendTitle={appendTitle} />
        {discard && <div className="ll-ext-notice" role="alertdialog" aria-label={t('leadinglight.commentary.discardQuestion')} data-testid="commentary-discard">
          <p>{t(view.step === 'uncertain' ? 'leadinglight.extensions.discardUncertain' : 'leadinglight.commentary.discardQuestion')}</p>
          <div className="ll-ext-actions">
            <Button variant="outline" autoFocus onClick={() => setDiscard(false)}>{t('leadinglight.extensions.keepEditing')}</Button>
            <Button variant="secondary" onClick={close}>{t(view.step === 'uncertain' ? 'leadinglight.extensions.stopChecking' : 'leadinglight.extensions.discard')}</Button>
          </div>
        </div>}
        <DialogFooter>
          <Actions t={t} view={view} choice={choice} ready={destinations.status === 'ready'}
            onCancel={requestClose} onSubmit={() => { void submit() }} onCheckAgain={() => { void checkAgain() }} onDone={close}
            onUseSeparate={view.step === 'editing' && view.banner?.kind === 'notWritten' && view.banner.reason === 'exists'
              ? () => choose({ kind: 'create', separate: true }) : null} />
        </DialogFooter>
      </ExtensionDialogContent>
    </Dialog>
  )
}

function Destination({ t, baseId, run, destinations, choice, name, appendTitle, locked, onChoose }: {
  t: T; baseId: string; run: CommentaryRunView; destinations: CommentaryDestinations; choice: CommentaryChoice | null
  name: { title: string; taken: boolean } | null; appendTitle: string; locked: boolean; onChoose: (choice: CommentaryChoice) => void
}) {
  if (destinations.status === 'loading' || !choice) {
    return <p className="ll-commentary-destination" role="status" data-testid="commentary-destination">{t('leadinglight.commentary.checking')}</p>
  }
  const { options, incomplete } = destinations
  const separate = choice.kind === 'create' && choice.separate
  const selecting = options.length > 1 || (incomplete && options.length > 0)
  const effect = run.paneEffect(choice)
  const line = choice.kind === 'append'
    ? t('leadinglight.commentary.willAdd', { title: appendTitle })
    : name ? t(separate ? 'leadinglight.commentary.willCreateSeparate' : 'leadinglight.commentary.willCreate', { title: name.title }) : null
  return (
    <div className="ll-commentary-destinations" data-testid="commentary-destination" data-choice={choiceKey(choice)}>
      {selecting && <div className="ll-ext-field">
        <label htmlFor={`${baseId}-target`}>{t('leadinglight.commentary.addTo')}</label>
        <Select value={choiceKey(choice)} disabled={locked}
          onValueChange={value => onChoose(value === NEW_NOTE ? { kind: 'create', separate: true } : { kind: 'append', path: value })}>
          <SelectTrigger id={`${baseId}-target`} className="w-full" data-testid="commentary-target"><SelectValue /></SelectTrigger>
          <SelectContent data-settings-panel-portal="true" onEscapeKeyDown={event => event.stopPropagation()}>
            {options.map(option => <SelectItem key={option.path} value={option.path}>{option.title}</SelectItem>)}
            <SelectItem value={NEW_NOTE}>{t('leadinglight.commentary.newSeparate')}</SelectItem>
          </SelectContent>
        </Select>
      </div>}
      {line && <p className="ll-commentary-destination" role="status">{line}</p>}
      {choice.kind === 'create' && name?.taken && !separate &&
        <p className="ll-commentary-destination ll-ext-destination-taken" role="status">{t('leadinglight.commentary.nameTaken', { title: name.title })}</p>}
      <p className="ll-commentary-destination ll-ext-quiet" role="status" data-testid="commentary-pane-effect" data-effect={effect.kind}>
        {effect.kind === 'shown' ? t('leadinglight.commentary.alreadyOpen')
          : effect.kind === 'replaces' ? t('leadinglight.commentary.opensInPlaceOf', { page: effect.page }) : t('leadinglight.commentary.opensBeside')}
      </p>
      {incomplete && <p className="ll-ext-quiet" role="status">{t('leadinglight.commentary.incomplete')}</p>}
      <div className="ll-ext-switch-field">
        <Switch id={`${baseId}-separate`} checked={separate} disabled={locked} data-testid="commentary-separate"
          onCheckedChange={on => onChoose(on ? { kind: 'create', separate: true } : destinations.initial.kind === 'create' && !destinations.initial.separate
            ? destinations.initial : options[0] ? { kind: 'append', path: options[0].path } : { kind: 'create', separate: false })} />
        <label htmlFor={`${baseId}-separate`}>{t('leadinglight.commentary.separate')}</label>
      </div>
    </div>
  )
}

const UNCERTAIN_KEYS = {
  noReply: 'leadinglight.commentary.uncertain', running: 'leadinglight.commentary.uncertainRunning', unknown: 'leadinglight.commentary.uncertainUnknown',
} as const

function bannerText(t: T, banner: Extract<Banner, { kind: 'notWritten' }>, appendTitle: string): string {
  const title = banner.title || appendTitle
  switch (banner.reason) {
    case 'settleFailed': return t('leadinglight.commentary.settleFailed')
    case 'changed': return t('leadinglight.commentary.changed', { title })
    case 'exists': return t('leadinglight.commentary.exists', { title })
    case 'unsafeTail': return t('leadinglight.commentary.unsafeTail')
    case 'notAssociated': return t('leadinglight.commentary.notAssociated', { title })
    case 'busy': return t('leadinglight.commentary.busy')
    default: return notWrittenText(t, banner.reason)
  }
}

function Status({ t, view, appendTitle }: { t: T; view: Phase; appendTitle: string }) {
  switch (view.step) {
    case 'editing':
      if (!view.banner) return null
      return <p className="ll-ext-notice" role="alert" data-testid="commentary-status" data-reason={view.banner.kind === 'form' ? 'form' : view.banner.reason}>
        {view.banner.kind === 'form' ? t('leadinglight.extensions.problem.form') : bannerText(t, view.banner, appendTitle)}</p>
    case 'working':
      return null
    case 'uncertain':
      return <p className="ll-ext-notice" role="alert" data-testid="commentary-status" data-detail={view.detail}>{t(UNCERTAIN_KEYS[view.detail])}</p>
    case 'committed':
      return <p className="ll-ext-notice" role="status" data-testid="commentary-status" data-reason="notShown">
        {t(view.kind === 'append' ? 'leadinglight.commentary.addedNotShown' : 'leadinglight.commentary.createdNotShown', { title: view.title })}</p>
    case 'revoked':
      return <p className="ll-ext-notice" role="alert" data-testid="commentary-status">
        {t(view.reason === 'workspace' ? 'leadinglight.extensions.revokedWorkspace' : 'leadinglight.extensions.revokedPackage')}</p>
  }
}

const WORKING_KEYS = { saving: 'leadinglight.commentary.saving', adding: 'leadinglight.commentary.adding', creating: 'leadinglight.commentary.creating' } as const

function Actions({ t, view, choice, ready, onCancel, onSubmit, onCheckAgain, onDone, onUseSeparate }: {
  t: T; view: Phase; choice: CommentaryChoice | null; ready: boolean
  onCancel: () => void; onSubmit: () => void; onCheckAgain: () => void; onDone: () => void; onUseSeparate: (() => void) | null
}) {
  if (view.step === 'committed') return <Button data-testid="commentary-done" onClick={onDone}>{t('leadinglight.extensions.done')}</Button>
  if (view.step === 'revoked') return <Button data-testid="commentary-close" onClick={onDone}>{t('leadinglight.extensions.close')}</Button>
  const checking = view.step === 'uncertain' && view.checking
  const submitLabel = view.step === 'working' ? WORKING_KEYS[view.phase]
    : choice?.kind === 'append' ? 'leadinglight.commentary.add' : 'leadinglight.commentary.create'
  return <>
    {onUseSeparate && <Button variant="outline" data-testid="commentary-use-separate" onClick={onUseSeparate}>{t('leadinglight.commentary.useSeparate')}</Button>}
    <Button variant="outline" disabled={view.step === 'working' || checking} onClick={onCancel}>{t('leadinglight.extensions.cancel')}</Button>
    {view.step === 'uncertain'
      ? <Button data-testid="commentary-check" disabled={checking} onClick={onCheckAgain}>{t(checking ? 'leadinglight.extensions.checking' : 'leadinglight.extensions.checkAgain')}</Button>
      : <Button data-testid="commentary-submit" disabled={view.step === 'working' || !ready || !choice} onClick={onSubmit}>{t(submitLabel)}</Button>}
  </>
}
