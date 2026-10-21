// One website command's opening: the recipe's own questions around the website dialog, and Save
// as the controller's one guarded create for that opening. Nothing here writes or reads a note; the
// note's bytes are the ones the dialog verified, checked again against the proposal's document.
import { useCallback, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { AppLocale } from '../../lib/i18n'
import type { AnswerValue, FormAnswers, FormField } from '../extensions/extensionContract'
import { RunField } from '../extensions/ExtensionRunDialog'
import { fieldProblems, filled, initialAnswers } from '../extensions/extensionRunForm'
import type { CreateOutcome, ExtensionController, OpenTarget, RunOpening } from '../extensions/extensionSessionController'
import { translator, type FieldProblem } from '../extensions/extensionUiText'
import type { CreateVerifyEditor } from './articleVerify'
import { composeWebCaptureNote, webCaptureContentFor } from './webCaptureComposition'
import { WebCaptureDialog, type WebCaptureFolder, type WebCaptureRevocation, type WebCaptureSave } from './WebCaptureDialog'
import type { SavedCopyLookup } from './webCaptureDuplicates'
import type { WebCaptureFlow } from './webCaptureFlow'
import type { WebCaptureLabels } from './webCaptureLabels'
import type { WebPageCaptureValue } from './webCapturePageStore'

export interface WebCaptureRunDialogProps {
  readonly locale: AppLocale
  readonly labels: WebCaptureLabels
  readonly controller: ExtensionController
  readonly opening: RunOpening
  readonly target: OpenTarget
  readonly flow: WebCaptureFlow
  readonly folders: readonly WebCaptureFolder[]
  readonly initialFolder: string
  findSavedCopies(urls: readonly string[]): SavedCopyLookup
  pageExists(relativePath: string): boolean
  /** Every answer of this opening's Save or Check again, so the host can offer Undo for a created note. */
  onOutcome(outcome: CreateOutcome, webPage: WebPageCaptureValue | null): void
  onOpenSaved(path: string): void
  onOpenInBrowser(url: string): void
  onRemember(folder: string): void
  onNotice(message: string): void
  onClose(handled: boolean): void
  onCloseAutoFocus?(event: Event): void
  readonly createVerifyEditor?: CreateVerifyEditor
}

function fieldsOf(opening: RunOpening): readonly FormField[] {
  const form = opening.runnable.command.steps.find(step => step.op === 'collectForm')
  return form?.op === 'collectForm' ? form.fields : []
}

/** Answers stay editable until a Save may have written; a refused Save hands them back. */
const EDITABLE: ReadonlySet<CreateOutcome['status']> = new Set(['notWritten', 'invalid', 'idle', 'busy'])

export function WebCaptureRunDialog(props: WebCaptureRunDialogProps) {
  const { locale, controller, opening, target, onOutcome } = props
  const t = useMemo(() => translator(locale), [locale])
  const baseId = useId()
  const [fields] = useState(() => fieldsOf(opening))
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>(() => initialAnswers(fields))
  const [errors, setErrors] = useState<Map<string, FieldProblem>>(new Map())
  const [held, setHeld] = useState(false)
  // The page of the last Save, for the answer a later Check again gives.
  const savedPage = useRef<WebPageCaptureValue | null>(null)
  const domId = (fieldId: string) => `${baseId}-field-${fieldId}`
  // Revocation (workspace switched, recipe turned off or replaced) shows as it happens.
  const revocation = useMemo<WebCaptureRevocation>(() => ({
    subscribe: listener => controller.subscribe(listener),
    reason: () => controller.revokedReason(opening),
  }), [controller, opening])
  const revoked = useSyncExternalStore(revocation.subscribe, revocation.reason)
  const locked = held || revoked !== null

  const setAnswer = (fieldId: string, value: AnswerValue) => {
    if (locked) return
    setAnswers(current => ({ ...current, [fieldId]: value }))
    setErrors(current => { if (!current.has(fieldId)) return current; const next = new Map(current); next.delete(fieldId); return next })
  }

  const checkForm = () => {
    const current: FormAnswers = { ...answers }
    const found = fieldProblems(fields, current, controller.check(opening, current).problems)
    setErrors(found)
    const first = fields.find(field => found.has(field.id))
    if (first) window.setTimeout(() => document.getElementById(domId(first.id))?.focus(), 0)
    return found.size === 0
  }

  const composeNote = (webPage: WebPageCaptureValue) => composeWebCaptureNote(opening.runnable.command, answers, webPage)

  const answer = useCallback((outcome: CreateOutcome, webPage: WebPageCaptureValue | null) => {
    setHeld(!EDITABLE.has(outcome.status))
    onOutcome(outcome, webPage)
    return outcome
  }, [onOutcome])

  // The answers of the render whose composition the dialog verified; the controller composes again
  // from them and `webCaptureContentFor` writes only if that is exactly the verified note.
  const save = async (request: WebCaptureSave) => {
    setHeld(true)
    savedPage.current = request.webPage
    const outcome = await controller.submit(opening, {
      answers: { ...answers },
      webPage: request.webPage,
      destination: { kind: 'create', folder: request.folder, fileName: request.fileName },
      prepare: (document, destination) => (destination.kind === 'create'
        ? webCaptureContentFor(document, { page: request.webPage.page, fileName: destination.fileName, prepared: request.prepared })
        : { status: 'refused', reason: 'internal' }),
      target,
    })
    return answer(outcome, request.webPage)
  }

  // The address field keeps first focus; the questions follow the page's title. `frozen` is the
  // dialog's own hold, from Save through preparation and sending until it is answered, so a Save
  // always sends the words shown; a refused Save releases them.
  const form = (frozen: boolean) => fields.map(field => <RunField key={field.id} t={t} field={field} id={domId(field.id)} value={answers[field.id] ?? null}
    error={errors.get(field.id) ?? null} readOnly={locked || frozen} autoFocus={false} onChange={value => { if (!frozen) setAnswer(field.id, value) }} />)

  return <WebCaptureDialog labels={props.labels} locale={locale} commandTitle={opening.runnable.command.title} flow={props.flow}
    folders={props.folders} initialFolder={props.initialFolder}
    form={form} formDirty={fields.some(field => filled(answers[field.id]))} checkForm={checkForm} composeNote={composeNote}
    findSavedCopies={props.findSavedCopies} pageExists={props.pageExists}
    save={save} checkAgain={async () => answer(await controller.recheck(opening), savedPage.current)}
    revocation={revocation}
    onOpenSaved={props.onOpenSaved} onOpenInBrowser={props.onOpenInBrowser} onRemember={props.onRemember} onNotice={props.onNotice}
    onClose={(handled, mode) => {
      // Stopping while uncertain retires the opening, so its operation never becomes a fresh Save.
      if (mode === 'abandon') controller.abandon(opening)
      else if (mode === 'cancel') controller.cancel(opening)
      props.onClose(handled)
    }}
    onCloseAutoFocus={props.onCloseAutoFocus} createVerifyEditor={props.createVerifyEditor} />
}
