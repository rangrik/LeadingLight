import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { PuzzlePiece } from '@phosphor-icons/react'
import { Button } from '../../components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { Switch } from '../../components/ui/switch'
import { Textarea } from '../../components/ui/textarea'
import type { AppLocale } from '../../lib/i18n'
import type { AnswerValue, FormAnswers, FormField } from './extensionContract'
import { ExtensionDialogContent, PassiveNote } from './ExtensionPreviewDialog'
import type { CreateOutcome, CreatedPage, ExtensionController, NotWrittenReason, OpenTarget, PendingAttempt, RunOpening } from './extensionSessionController'
import { fieldProblems, filled, initialAnswers } from './extensionRunForm'
import { notWrittenText, problemText, translator, type FieldProblem, type T } from './extensionUiText'

export interface FolderOption { path: string; label: string }

interface Props {
  locale: AppLocale
  controller: ExtensionController
  opening: RunOpening
  target: OpenTarget
  /** Host folder choices, the workspace folder first. */
  folders: readonly FolderOption[]
  initialFolder: string
  /** A page the listing already shows at this path; a hint only, native decides. */
  pageExists: (path: string) => boolean
  blocked: boolean
  onRemember: (folder: string) => void
  onNotice: (message: string) => void
  /** `handled`: focus moved on to the opened page. */
  onClose: (handled: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
}

type Banner = { kind: 'exists' } | { kind: 'notWritten'; reason: Exclude<NotWrittenReason, 'exists'> } | { kind: 'form' }
type Phase =
  | { step: 'editing'; banner: Banner | null }
  | { step: 'creating' }
  | { step: 'uncertain'; attempt: PendingAttempt; detail: 'noReply' | 'running' | 'unknown'; checking: boolean }
  | { step: 'created'; page: CreatedPage; durable: boolean; opened: 'notRequested' | 'notShown'; elsewhere: boolean }
  | { step: 'revoked'; reason: 'workspace' | 'package' }

const NONE = ':none'
const ROOT = ':root'

function fieldsOf(opening: RunOpening): readonly FormField[] {
  const form = opening.runnable.command.steps.find(step => step.op === 'collectForm')
  return form?.op === 'collectForm' ? form.fields : []
}

/** The first form field the title uses, which a name collision asks the person to change. */
function titleField(opening: RunOpening): string | null {
  const compose = opening.runnable.command.steps.find(step => step.op === 'composeDocument')
  const part = compose?.op === 'composeDocument' ? compose.title?.find(item => typeof item !== 'string') : undefined
  return part && typeof part !== 'string' ? part.field : null
}

/** One opening, one form; its answers survive every outcome but a shown, created note. */
export function ExtensionRunDialog(props: Props) {
  const { locale, controller, opening, target, folders, blocked, onClose } = props
  const t = translator(locale)
  const baseId = useId()
  const fields = fieldsOf(opening)
  const domId = (fieldId: string) => `${baseId}-field-${fieldId}`
  const [answers, setAnswers] = useState(() => initialAnswers(fields))
  const [folder, setFolder] = useState(props.initialFolder)
  const [phase, setPhase] = useState<Phase>({ step: 'editing', banner: null })
  const [errors, setErrors] = useState<Map<string, FieldProblem>>(new Map())
  const [discard, setDiscard] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  // Revocation (workspace switched, extension turned off or replaced) shows as it happens.
  useSyncExternalStore(controller.subscribe, controller.snapshot)
  const revoked = controller.revokedReason(opening)

  const formAnswers = (): FormAnswers => ({ ...answers })
  const checked = useMemo(() => controller.check(opening, answers), [controller, opening, answers])
  const markdown = checked.markdown?.status === 'built' ? checked.markdown.markdown : null
  const folderLabel = folders.find(option => option.path === folder)?.label ?? t('leadinglight.extensions.rootFolder')
  const relative = markdown ? [folder, markdown.fileName].filter(Boolean).join('/') : null
  const taken = relative !== null && props.pageExists(relative)
  const dirty = fields.some(field => filled(answers[field.id]))
  const locked = phase.step !== 'editing' || !!revoked
  const view: Phase = revoked && phase.step === 'editing' ? { step: 'revoked', reason: revoked } : phase

  const focusField = (fieldId: string | null) => {
    if (fieldId) window.setTimeout(() => document.getElementById(domId(fieldId))?.focus(), 0)
  }
  const apply = (outcome: CreateOutcome) => {
    if (!mounted.current) return
    switch (outcome.status) {
      case 'opened':
        props.onRemember(folder)
        if (!outcome.durable) props.onNotice(t('leadinglight.extensions.notDurable'))
        onClose(true)
        return
      case 'created':
        props.onRemember(folder)
        setPhase({ step: 'created', page: outcome.page, durable: outcome.durable, opened: outcome.opened,
          elsewhere: controller.revokedReason(opening) === 'workspace' })
        return
      case 'committed':
        // Only a capture command answers this, and this form never runs one; shown as written.
        setPhase({ step: 'created', page: outcome.page, durable: outcome.receipt.durable, opened: 'notShown',
          elsewhere: controller.revokedReason(opening) === 'workspace' })
        return
      case 'notWritten':
        setPhase({ step: 'editing', banner: outcome.reason === 'exists' ? { kind: 'exists' } : { kind: 'notWritten', reason: outcome.reason } })
        if (outcome.reason === 'exists') focusField(titleField(opening))
        if (outcome.reason === 'folderMissing' || outcome.reason === 'link') window.setTimeout(() => document.getElementById(`${baseId}-folder`)?.focus(), 0)
        return
      case 'uncertain':
        setPhase({ step: 'uncertain', attempt: outcome.attempt, detail: outcome.detail, checking: false })
        return
      case 'revoked':
        setPhase({ step: 'revoked', reason: outcome.reason })
        return
      case 'invalid': {
        const found = fieldProblems(fields, formAnswers(), outcome.problems)
        setErrors(found)
        setPhase({ step: 'editing', banner: { kind: 'form' } })
        focusField(fields.find(field => found.has(field.id))?.id ?? null)
        return
      }
      case 'idle':
        setPhase({ step: 'editing', banner: null })
        return
      case 'busy':
      case 'cancelled':
        return
    }
  }

  const create = async () => {
    if (view.step !== 'editing' || blocked) return
    const current = formAnswers()
    const found = fieldProblems(fields, current, controller.check(opening, current).problems)
    setErrors(found)
    if (found.size > 0) {
      setPhase({ step: 'editing', banner: { kind: 'form' } })
      focusField(fields.find(field => found.has(field.id))?.id ?? null)
      return
    }
    setDiscard(false)
    setPhase({ step: 'creating' })
    apply(await controller.create(opening, { answers: current, folder, target }))
  }

  const checkAgain = async () => {
    if (phase.step !== 'uncertain' || phase.checking) return
    setPhase({ ...phase, checking: true })
    // The controller asks about its own retained operation; nothing here can make it write again.
    apply(await controller.recheck(opening))
  }

  const close = () => {
    // Stopping while uncertain retires the opening, so its operation never becomes a fresh Create.
    if (phase.step === 'uncertain') controller.abandon(opening)
    else controller.cancel(opening)
    onClose(false)
  }
  const requestClose = () => {
    if (view.step === 'creating' || (view.step === 'uncertain' && view.checking)) return
    if (discard) { setDiscard(false); return }
    if (view.step === 'uncertain' || (view.step === 'editing' && dirty)) { setDiscard(true); return }
    close()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
    // Settings listens for the same shortcut on the window; this dialog's Create comes first.
    event.preventDefault()
    event.stopPropagation()
    if (view.step === 'editing') void create()
    else if (view.step === 'uncertain') void checkAgain()
  }
  const setAnswer = (fieldId: string, value: AnswerValue) => {
    if (locked) return
    setAnswers(current => ({ ...current, [fieldId]: value }))
    setErrors(current => { if (!current.has(fieldId)) return current; const next = new Map(current); next.delete(fieldId); return next })
    if (phase.step === 'editing' && phase.banner) setPhase({ step: 'editing', banner: phase.banner.kind === 'form' ? phase.banner : null })
  }

  const previewId = `${baseId}-preview`
  return (
    <Dialog open onOpenChange={open => { if (!open) requestClose() }}>
      <ExtensionDialogContent className="ll-ext-run-dialog" data-testid="extension-run-dialog" data-step={view.step}
        showCloseButton={view.step !== 'creating'} onCloseAutoFocus={props.onCloseAutoFocus} onKeyDown={onKeyDown}
        onEscapeKeyDown={event => { event.preventDefault(); requestClose() }}
        onInteractOutside={event => { event.preventDefault() }}>
        <DialogHeader>
          <DialogTitle className="ll-ext-title"><PuzzlePiece aria-hidden="true" />{opening.runnable.command.title}</DialogTitle>
          <DialogDescription>{t('leadinglight.extensions.runDescription', { name: opening.runnable.packageName })}</DialogDescription>
        </DialogHeader>
        <div className="ll-ext-run-body">
          <div className="ll-ext-run-form">
            {fields.map((field, index) => <RunField key={field.id} t={t} field={field} id={domId(field.id)} value={answers[field.id] ?? null}
              error={errors.get(field.id) ?? null} readOnly={locked} autoFocus={index === 0} onChange={value => setAnswer(field.id, value)} />)}
            <div className="ll-ext-field">
              <label htmlFor={`${baseId}-folder`}>{t('leadinglight.extensions.createIn')}</label>
              <Select value={folder || ROOT} disabled={locked} onValueChange={value => { setFolder(value === ROOT ? '' : value); if (phase.step === 'editing') setPhase({ step: 'editing', banner: null }) }}>
                <SelectTrigger id={`${baseId}-folder`} className="w-full" data-testid="extension-folder"><SelectValue /></SelectTrigger>
                <SelectContent data-settings-panel-portal="true" onEscapeKeyDown={event => event.stopPropagation()}>
                  {folders.map(option => <SelectItem key={option.path || ROOT} value={option.path || ROOT}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {/* A draft that may still be created; once a write is in flight, done, unresolved or
                revoked, the status below names the location and the listing may already hold it. */}
            {(view.step === 'editing' || view.step === 'creating') && <Destination t={t} relative={relative} folderLabel={folderLabel}
              fileName={markdown?.fileName ?? ''} taken={view.step === 'editing' && taken}
              collided={view.step === 'editing' && view.banner?.kind === 'exists'} />}
          </div>
          <Button variant="outline" size="sm" className="ll-ext-preview-toggle" aria-expanded={showPreview} aria-controls={previewId}
            onClick={() => setShowPreview(value => !value)}>{t(showPreview ? 'leadinglight.extensions.hidePreview' : 'leadinglight.extensions.showPreview')}</Button>
          <section id={previewId} className="ll-ext-run-preview" data-open={showPreview} aria-label={t('leadinglight.extensions.previewLabel')}>
            {markdown && <PassiveNote content={markdown.content} locale={locale} />}
          </section>
        </div>
        <RunStatus t={t} view={view} />
        {discard && <div className="ll-ext-notice" role="alertdialog" aria-label={t('leadinglight.extensions.discardQuestion')} data-testid="extension-discard">
          <p>{t(view.step === 'uncertain' ? 'leadinglight.extensions.discardUncertain' : 'leadinglight.extensions.discardQuestion')}</p>
          {view.step !== 'uncertain' && <p className="ll-ext-quiet">{t('leadinglight.extensions.discardHint')}</p>}
          <div className="ll-ext-actions">
            <Button variant="outline" autoFocus onClick={() => setDiscard(false)}>{t('leadinglight.extensions.keepEditing')}</Button>
            <Button variant="secondary" onClick={close}>{t(view.step === 'uncertain' ? 'leadinglight.extensions.stopChecking' : 'leadinglight.extensions.discard')}</Button>
          </div>
        </div>}
        <DialogFooter>
          <RunActions t={t} view={view} blocked={blocked} onCancel={requestClose} onCreate={() => { void create() }} onCheckAgain={() => { void checkAgain() }} onDone={() => close()} />
        </DialogFooter>
      </ExtensionDialogContent>
    </Dialog>
  )
}

/** One recipe form field with its label, problem and the control its kind asks for. */
export function RunField({ t, field, id, value, error, readOnly, autoFocus, onChange }: {
  t: T; field: FormField; id: string; value: AnswerValue; error: FieldProblem | null; readOnly: boolean; autoFocus: boolean
  onChange: (value: AnswerValue) => void
}) {
  const errorId = `${id}-error`
  const required = field.kind !== 'boolean' && field.required
  const described = { 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? errorId : undefined }
  const label = <label htmlFor={id}>{field.label}{required && <span className="ll-ext-required"> · {t('leadinglight.extensions.required')}</span>}</label>
  const message = error && <p id={errorId} className="ll-ext-error">{problemText(t, error)}</p>
  if (field.kind === 'boolean') {
    return <div className="ll-ext-switch-field">
      <Switch id={id} checked={value === true} disabled={readOnly} autoFocus={autoFocus} onCheckedChange={onChange} />
      {label}
    </div>
  }
  if (field.kind === 'choice') {
    return <div className="ll-ext-field">
      {label}
      <Select value={typeof value === 'string' ? value : NONE} disabled={readOnly} onValueChange={next => onChange(next === NONE ? null : next)}>
        <SelectTrigger id={id} className="w-full" autoFocus={autoFocus} {...described}><SelectValue placeholder={t('leadinglight.extensions.noAnswer')} /></SelectTrigger>
        <SelectContent data-settings-panel-portal="true" onEscapeKeyDown={event => event.stopPropagation()}>
          {!field.required && <SelectItem value={NONE}>{t('leadinglight.extensions.noAnswer')}</SelectItem>}
          {field.options.map(option => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {message}
    </div>
  }
  const text = typeof value === 'string' ? value : ''
  return <div className="ll-ext-field">
    {label}
    {field.kind === 'multilineText'
      ? <Textarea id={id} className="ll-ext-textarea" value={text} readOnly={readOnly} autoFocus={autoFocus} aria-required={required} {...described} onChange={event => onChange(event.target.value)} />
      : <Input id={id} value={text} readOnly={readOnly} autoFocus={autoFocus} aria-required={required} {...described} onChange={event => onChange(event.target.value)} />}
    {message}
  </div>
}

function Destination({ t, relative, folderLabel, fileName, taken, collided }: {
  t: T; relative: string | null; folderLabel: string; fileName: string; taken: boolean; collided: boolean
}) {
  if (relative === null) return null
  if (collided || taken) {
    return <p className="ll-ext-destination ll-ext-destination-taken" role={collided ? 'alert' : 'status'} data-testid="extension-destination" data-path={relative}>
      {t('leadinglight.extensions.exists', { name: fileName, folder: folderLabel })}</p>
  }
  return <p className="ll-ext-destination" role="status" data-testid="extension-destination" data-path={relative}>{t('leadinglight.extensions.willCreate', { path: relative })}</p>
}

function RunStatus({ t, view }: { t: T; view: Phase }) {
  switch (view.step) {
    case 'editing':
      if (!view.banner || view.banner.kind === 'exists') return null
      return <p className="ll-ext-notice" role="alert" data-testid="extension-run-status">
        {view.banner.kind === 'form' ? t('leadinglight.extensions.problem.form') : notWrittenText(t, view.banner.reason)}</p>
    case 'creating':
      return <p className="ll-ext-quiet" role="status">{t('leadinglight.extensions.creating')}</p>
    case 'uncertain':
      return <div className="ll-ext-notice" role="alert" data-testid="extension-run-status" data-detail={view.detail}>
        <p>{t(view.detail === 'running' ? 'leadinglight.extensions.uncertainRunning' : view.detail === 'unknown' ? 'leadinglight.extensions.uncertainUnknown' : 'leadinglight.extensions.uncertain')}</p>
        <p className="ll-ext-quiet">{t('leadinglight.extensions.uncertainWhere', { path: view.attempt.expected.displayPath })}</p>
      </div>
    case 'created':
      return <div className="ll-ext-notice" role="status" data-testid="extension-run-status" data-path={view.page.displayPath}>
        <p>{t(view.elsewhere ? 'leadinglight.extensions.createdElsewhere' : view.opened === 'notRequested' ? 'leadinglight.extensions.createdNotOpened' : 'leadinglight.extensions.created', { path: view.page.displayPath })}</p>
        {!view.durable && <p className="ll-ext-quiet">{t('leadinglight.extensions.notDurable')}</p>}
      </div>
    case 'revoked':
      return <p className="ll-ext-notice" role="alert" data-testid="extension-run-status">
        {t(view.reason === 'workspace' ? 'leadinglight.extensions.revokedWorkspace' : 'leadinglight.extensions.revokedPackage')}</p>
  }
}

function RunActions({ t, view, blocked, onCancel, onCreate, onCheckAgain, onDone }: {
  t: T; view: Phase; blocked: boolean; onCancel: () => void; onCreate: () => void; onCheckAgain: () => void; onDone: () => void
}) {
  if (view.step === 'created') return <Button data-testid="extension-run-done" onClick={onDone}>{t('leadinglight.extensions.done')}</Button>
  if (view.step === 'revoked') return <Button data-testid="extension-run-close" onClick={onDone}>{t('leadinglight.extensions.close')}</Button>
  const checking = view.step === 'uncertain' && view.checking
  return <>
    <Button variant="outline" disabled={view.step === 'creating' || checking} onClick={onCancel}>{t('leadinglight.extensions.cancel')}</Button>
    {view.step === 'uncertain'
      ? <Button data-testid="extension-run-check" disabled={checking} onClick={onCheckAgain}>{t(checking ? 'leadinglight.extensions.checking' : 'leadinglight.extensions.checkAgain')}</Button>
      : <Button data-testid="extension-run-create" disabled={view.step === 'creating' || blocked} onClick={onCreate}>
        {t(view.step === 'creating' ? 'leadinglight.extensions.creating' : 'leadinglight.extensions.create')}</Button>}
  </>
}
