// The one website dialog (Fable's experience spec): an address and an explicit Fetch, then the
// page's title, the recipe's own question (rendered by the host), the folder and a passive preview
// of the whole note, and Save as the single confirmation. The host's controller does the one
// exclusive create, Check again, Undo and opening; nothing here writes or reads a note.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
import { Globe } from '@phosphor-icons/react'
import { Button } from '../../components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import type { AppLocale } from '../../lib/i18n'
import { fileNameForTitle } from '../extensions/extensionMarkdown'
import { ExtensionDialogContent, PassiveNote } from '../extensions/ExtensionPreviewDialog'
import { usableTitle } from './articleMarkdown'
import { hostLabel } from './articleUrls'
import type { CreateVerifyEditor } from './articleVerify'
import type { WebCaptureComposition } from './webCaptureComposition'
import type { WebCaptureIntroParagraph } from './webCaptureContract'
import type { SavedCopyLookup } from './webCaptureDuplicates'
import { useWebCaptureFlow, type WebCaptureFlow, type WebCaptureFlowState } from './webCaptureFlow'
import type { WebCaptureLabels, WebCaptureUncertainDetail } from './webCaptureLabels'
import { notWrittenReasonFor, numberedFileName, prepareWebCaptureNote, type PreparedWebCaptureNote } from './webCaptureNote'
import { entryPageTitle, entrySource, webPageCaptureValue, type WebCapturePageEntry, type WebPageCaptureValue } from './webCapturePageStore'
import './webCapture.css'

export interface WebCaptureFolder { readonly path: string; readonly label: string }


export interface WebCaptureSave {
  readonly folder: string
  readonly fileName: string
  readonly webPage: WebPageCaptureValue
  readonly prepared: Extract<PreparedWebCaptureNote, { status: 'ready' }>
  readonly packageParts: readonly string[]
}

interface SavedPage { readonly displayPath: string }

/** The answers of E2's `CreateOutcome` this dialog shows; E2's union is assignable to it. */
export type WebCaptureSaveOutcome =
  | { readonly status: 'opened'; readonly page: SavedPage; readonly durable: boolean }
  | { readonly status: 'created'; readonly page: SavedPage; readonly durable: boolean; readonly opened: 'notRequested' | 'notShown' }
  | { readonly status: 'committed'; readonly page: SavedPage; readonly receipt: { readonly durable: boolean } }
  | { readonly status: 'notWritten'; readonly reason: string }
  | { readonly status: 'uncertain'; readonly attempt: { readonly expected: SavedPage }; readonly detail: WebCaptureUncertainDetail }
  | { readonly status: 'revoked'; readonly reason: 'workspace' | 'package' }
  | { readonly status: 'invalid'; readonly problems: readonly unknown[] }
  | { readonly status: 'busy' } | { readonly status: 'cancelled' } | { readonly status: 'idle' }

export interface WebCaptureRevocation {
  subscribe(listener: () => void): () => void
  /** 'workspace' once the workspace changed, 'package' once the recipe was turned off or replaced. */
  reason(): 'workspace' | 'package' | null
}

export interface WebCaptureDialogProps {
  readonly labels: WebCaptureLabels
  readonly locale: AppLocale
  readonly commandTitle: string
  readonly flow: WebCaptureFlow
  readonly folders: readonly WebCaptureFolder[]
  readonly initialFolder: string
  /**
   * The recipe's question fields, rendered and validated by the host. As a function it is given
   * `locked`: true from Save until the Save is answered, so the host holds its fields read-only and
   * the words sent are the words shown. A form that does not hold itself is checked before sending.
   */
  readonly form: ReactNode | ((locked: boolean) => ReactNode)
  readonly formDirty: boolean
  /** Shows the host's field problems; false blocks Save. */
  checkForm(): boolean
  /** The recipe's title and own blocks for this page from the host's current answers (`composeWebCaptureNote`). */
  composeNote(webPage: WebPageCaptureValue): WebCaptureComposition
  /** The host's paragraphs after the title (e.g. a "Saved from" line); none by default. */
  intro?(entry: WebCapturePageEntry): readonly WebCaptureIntroParagraph[]
  findSavedCopies(urls: readonly string[]): SavedCopyLookup
  /** A listing hint for a vault-relative path; native still refuses any existing name. */
  pageExists(relativePath: string): boolean
  save(request: WebCaptureSave): Promise<WebCaptureSaveOutcome>
  checkAgain(): Promise<WebCaptureSaveOutcome>
  readonly revocation: WebCaptureRevocation
  onOpenSaved(path: string): void
  onOpenInBrowser(url: string): void
  onRemember(folder: string): void
  onNotice(message: string): void
  /** `handled`: focus moved to the opened page. `mode` tells the host to cancel or abandon its opening. */
  onClose(handled: boolean, mode: 'cancel' | 'abandon' | 'done'): void
  onCloseAutoFocus?(event: Event): void
  readonly createVerifyEditor?: CreateVerifyEditor
}

type Banner =
  | { readonly kind: 'exists' }
  | { readonly kind: 'notWritten'; readonly reason: string }
  | { readonly kind: 'form' }
  | { readonly kind: 'title' }

type SavePhase =
  | { readonly step: 'editing'; readonly banner: Banner | null }
  | { readonly step: 'saving' }
  | { readonly step: 'uncertain'; readonly path: string; readonly detail: WebCaptureUncertainDetail; readonly checking: boolean }
  | { readonly step: 'created'; readonly path: string; readonly durable: boolean; readonly how: 'created' | 'notOpened' | 'elsewhere' }
  | { readonly step: 'revoked'; readonly reason: 'workspace' | 'package' }

type Ready = Extract<WebCaptureFlowState, { step: 'ready' }>
type Preview = { readonly key: string; readonly prepared: PreparedWebCaptureNote }

const ROOT = ':root'
const PREVIEW_DELAY_MS = 250

function defaultTitle(entry: WebCapturePageEntry): string {
  return entry.kind === 'article' ? entry.conversion.note.title : entryPageTitle(entry) ?? hostLabel(entry.source.sourceUrl)
}

function mediaCount(entry: WebCapturePageEntry): number {
  return entry.kind === 'article' ? entry.conversion.adjustments.mediaLinks : 0
}

const sameParts = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((part, index) => part === right[index])

function joinPath(folder: string, fileName: string): string {
  return [folder, fileName].filter(Boolean).join('/')
}

export function WebCaptureDialog(props: WebCaptureDialogProps) {
  const { labels, flow, folders } = props
  const baseId = useId()
  const { state, address } = useWebCaptureFlow(flow)
  const revokedReason = useSyncExternalStore(props.revocation.subscribe, props.revocation.reason)
  const ready: Ready | null = state.step === 'ready' ? state : null
  // The title belongs to one page: a new token starts from that page's own title.
  const [draft, setDraft] = useState<{ token: string; title: string } | null>(null)
  const title = ready ? (draft?.token === ready.token ? draft.title : defaultTitle(ready.entry)) : ''
  const titleEdited = ready !== null && draft?.token === ready.token
  const [folder, setFolder] = useState(props.initialFolder)
  const [prior, setPrior] = useState<{ urls: string; lookup: SavedCopyLookup } | null>(null)
  const [fetchAnyway, setFetchAnyway] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [phase, setPhase] = useState<SavePhase>({ step: 'editing', banner: null })
  const [discard, setDiscard] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const addressRef = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  // The latest render's host, for the check a Save makes just before sending.
  const latest = useRef(props)
  useLayoutEffect(() => { latest.current = props })

  // Revocation stops any fetch at once; the status below says why.
  useEffect(() => { if (revokedReason) flow.revoke() }, [revokedReason, flow])

  // A new page's saved copies, by its final and requested addresses; before a page, the typed one.
  const { findSavedCopies } = props
  const pageLookup = useMemo(() => {
    if (!ready) return null
    const source = entrySource(ready.entry)
    return findSavedCopies([source.sourceUrl, source.requestedUrl])
  }, [ready, findSavedCopies])
  const lookup = ready ? pageLookup : prior?.lookup ?? null

  // A new page: its title focused and selected, ready to keep or change.
  const token = ready?.token ?? null
  useEffect(() => {
    if (!token) return
    const timer = window.setTimeout(() => { titleRef.current?.focus(); titleRef.current?.select() }, 0)
    return () => window.clearTimeout(timer)
  }, [token])

  const webPage = ready ? webPageCaptureValue(ready.token, ready.entry, title) : null
  const composition = webPage ? props.composeNote(webPage) : null
  const intro: readonly WebCaptureIntroParagraph[] = ready
    ? [...(props.intro?.(ready.entry) ?? []), ...(ready.entry.kind === 'linkOnly' ? [[{ text: labels.linkOnlyNotice }]] : [])]
    : []
  const previewKey = ready && composition?.status === 'ready' ? JSON.stringify([ready.token, composition.title, composition.packageParts, intro]) : null

  // The whole note, built and verified as it would be saved, a moment after the last change. The
  // effect runs per content key; it reads that render's inputs, recorded by the effect before it.
  const previewInputs = useRef<{ entry: WebCapturePageEntry; title: string; packageParts: readonly string[]; intro: readonly WebCaptureIntroParagraph[] } | null>(null)
  const { createVerifyEditor } = props
  useEffect(() => {
    previewInputs.current = ready && composition?.status === 'ready'
      ? { entry: ready.entry, title: composition.title, packageParts: composition.packageParts, intro }
      : null
  })
  useEffect(() => {
    const inputs = previewInputs.current
    if (previewKey === null || !inputs) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void prepareWebCaptureNote(inputs, { signal: controller.signal, createVerifyEditor })
        .then(result => { if (!controller.signal.aborted) setPreview({ key: previewKey, prepared: result }) })
    }, PREVIEW_DELAY_MS)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [previewKey, createVerifyEditor])

  const prepared = preview?.key === previewKey ? preview.prepared : null
  const duplicate = lookup && lookup.matches.length > 0 ? lookup.matches[0] : null
  const folderLabel = folders.find(option => option.path === folder)?.label ?? labels.rootFolder
  const baseFileName = prepared?.status === 'ready' ? prepared.fileName : ready ? fileNameForTitle(title.trim() || defaultTitle(ready.entry)) : null
  const fileName = baseFileName === null ? null
    : duplicate && ready ? numberedFileName(baseFileName, name => props.pageExists(joinPath(folder, name))) : baseFileName
  const taken = baseFileName !== null && fileName === baseFileName && props.pageExists(joinPath(folder, baseFileName))
  const titleOk = !ready || title.trim() === '' || (usableTitle(title) !== null && webPage !== null)
  const dirty = props.formDirty || titleEdited
  const view: SavePhase = revokedReason && (phase.step === 'editing' || phase.step === 'saving') ? { step: 'revoked', reason: revokedReason } : phase
  const working = state.step === 'fetching' || state.step === 'preparing'
  const locked = view.step !== 'editing'

  const focusAddress = () => window.setTimeout(() => addressRef.current?.focus(), 0)

  const startFetch = (anyway: boolean) => {
    if (locked || working) return
    setPhase({ step: 'editing', banner: null })
    const url = flow.requestUrl()
    if (url && !anyway) {
      const typed = findSavedCopies([url])
      setPrior({ urls: url, lookup: typed })
      // Saved before: no request is made unless the person chooses Fetch anyway.
      if (typed.matches.length > 0) { setFetchAnyway(true); return }
    }
    setFetchAnyway(false)
    void flow.fetch()
  }

  const apply = (outcome: WebCaptureSaveOutcome) => {
    if (!mounted.current) return
    switch (outcome.status) {
      case 'opened':
        props.onRemember(folder)
        if (!outcome.durable) props.onNotice(labels.notDurable)
        close(true, 'done')
        return
      case 'created':
      case 'committed': {
        props.onRemember(folder)
        const durable = outcome.status === 'created' ? outcome.durable : outcome.receipt.durable
        const how = props.revocation.reason() === 'workspace' ? 'elsewhere' : outcome.status === 'created' && outcome.opened === 'notRequested' ? 'notOpened' : 'created'
        setPhase({ step: 'created', path: outcome.page.displayPath, durable, how })
        return
      }
      case 'notWritten':
        setPhase({ step: 'editing', banner: outcome.reason === 'exists' ? { kind: 'exists' } : { kind: 'notWritten', reason: outcome.reason } })
        if (outcome.reason === 'exists') window.setTimeout(() => titleRef.current?.focus(), 0)
        return
      case 'uncertain':
        setPhase({ step: 'uncertain', path: outcome.attempt.expected.displayPath, detail: outcome.detail, checking: false })
        return
      case 'revoked':
        flow.revoke()
        setPhase({ step: 'revoked', reason: outcome.reason })
        return
      case 'invalid':
        props.checkForm()
        setPhase({ step: 'editing', banner: { kind: 'form' } })
        return
      case 'idle':
        setPhase({ step: 'editing', banner: null })
        return
      case 'busy':
      case 'cancelled':
        return
    }
  }

  const save = async () => {
    if (view.step !== 'editing' || !ready || !webPage) return
    if (!titleOk) { setPhase({ step: 'editing', banner: { kind: 'title' } }); titleRef.current?.focus(); return }
    if (!props.checkForm() || composition?.status !== 'ready') { setPhase({ step: 'editing', banner: { kind: 'form' } }); return }
    if (taken || fileName === null) { setPhase({ step: 'editing', banner: { kind: 'exists' } }); titleRef.current?.focus(); return }
    setDiscard(false)
    setPhase({ step: 'saving' })
    const current = prepared ?? await prepareWebCaptureNote(
      { entry: ready.entry, title: composition.title, packageParts: composition.packageParts, intro }, { createVerifyEditor: props.createVerifyEditor })
    if (!mounted.current) return
    // The page changed under the save (the run was revoked): nothing is sent.
    if (flow.store.resolve(ready.token) !== ready.entry) {
      setPhase({ step: 'editing', banner: null })
      return
    }
    if (current.status !== 'ready') {
      setPhase({ step: 'editing', banner: { kind: 'notWritten', reason: notWrittenReasonFor(current.reason) } })
      return
    }
    // Words the host's form took while this Save prepared are never dropped: the note is sent only
    // if it is still exactly what the form says now; otherwise nothing is sent and the newer words
    // stay for the person to review and save.
    const now = latest.current.composeNote(webPage)
    if (now.status !== 'ready' || now.title !== composition.title || !sameParts(now.packageParts, composition.packageParts)) {
      setPhase({ step: 'editing', banner: null })
      return
    }
    apply(await props.save({ folder, fileName, webPage, prepared: current, packageParts: composition.packageParts }))
  }

  const checkAgain = async () => {
    if (phase.step !== 'uncertain' || phase.checking) return
    setPhase({ ...phase, checking: true })
    apply(await props.checkAgain())
  }

  function close(handled: boolean, mode: 'cancel' | 'abandon' | 'done') {
    flow.revoke()
    props.onClose(handled, mode)
  }
  const requestClose = () => {
    if (view.step === 'saving' || (view.step === 'uncertain' && view.checking)) return
    if (discard) { setDiscard(false); return }
    if (view.step === 'uncertain' || (view.step === 'editing' && dirty)) { setDiscard(true); return }
    close(false, view.step === 'created' ? 'done' : 'cancel')
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
    event.preventDefault()
    event.stopPropagation()
    if (view.step === 'editing' && ready) void save()
    else if (view.step === 'uncertain') void checkAgain()
  }
  const onAddressKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    startFetch(fetchAnyway)
  }
  const editAddress = (text: string) => {
    if (locked) return
    flow.setAddress(text)
    setFetchAnyway(false)
    setPrior(null)
    setDraft(null)
    setPhase({ step: 'editing', banner: null })
  }
  const stop = () => { flow.stop(); focusAddress() }

  const willFetch = flow.requestUrl()
  const showWillFetch = state.step === 'address' && willFetch !== null && willFetch !== address.trim()
  const previewId = `${baseId}-preview`
  const stage = ready ? 'page' : 'address'

  return (
    <Dialog open onOpenChange={open => { if (!open) requestClose() }}>
      <ExtensionDialogContent className={stage === 'page' ? 'll-ext-run-dialog ll-web-capture-dialog' : 'll-web-capture-dialog'}
        data-testid="web-capture-dialog" data-stage={stage} data-step={view.step} data-flow={state.step}
        showCloseButton={view.step !== 'saving'} onCloseAutoFocus={props.onCloseAutoFocus} onKeyDown={onKeyDown}
        onEscapeKeyDown={event => { event.preventDefault(); if (working) stop(); else requestClose() }}
        onInteractOutside={event => { event.preventDefault() }}>
        <DialogHeader>
          <DialogTitle className="ll-ext-title"><Globe aria-hidden="true" />{props.commandTitle}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        <div className={stage === 'page' ? 'll-ext-run-body' : 'll-web-capture-body'}>
          <div className="ll-ext-run-form">
            <div className="ll-ext-field">
              <label htmlFor={`${baseId}-address`}>{labels.addressLabel}</label>
              <div className="ll-web-capture-address">
                <Input id={`${baseId}-address`} ref={addressRef} data-testid="web-capture-address" value={address} placeholder={labels.addressPlaceholder}
                  readOnly={locked} autoFocus inputMode="url" autoComplete="off" spellCheck={false}
                  onChange={event => editAddress(event.target.value)} onKeyDown={onAddressKeyDown} />
                {working
                  ? <Button variant="outline" data-testid="web-capture-stop" onClick={stop}>{labels.stop}</Button>
                  : <Button data-testid="web-capture-fetch" disabled={locked || address.trim() === ''} onClick={() => startFetch(fetchAnyway)}>
                    {fetchAnyway ? labels.fetchAnyway : labels.fetch}</Button>}
              </div>
              {showWillFetch && <p className="ll-ext-quiet" data-testid="web-capture-will-fetch">{labels.willFetch(willFetch)}</p>}
              {ready?.requestedUrl && hostLabel(ready.requestedUrl) !== hostLabel(entrySource(ready.entry).sourceUrl)
                && <p className="ll-ext-quiet">{labels.wasAddress(ready.requestedUrl)}</p>}
            </div>
            <FlowStatus labels={labels} state={state} title={ready ? title : ''} onLinkOnly={() => flow.saveLinkOnly()}
              onOpenInBrowser={url => props.onOpenInBrowser(url)} />
            {lookup && (duplicate || lookup.status === 'incomplete') && view.step === 'editing'
              && <SavedBefore labels={labels} lookup={lookup} onOpen={path => { close(false, 'cancel'); props.onOpenSaved(path) }} />}
            {ready && <>
              <div className="ll-ext-field">
                <label htmlFor={`${baseId}-title`}>{labels.pageTitle}</label>
                <Input id={`${baseId}-title`} ref={titleRef} data-testid="web-capture-title" value={title} readOnly={locked}
                  aria-invalid={titleOk ? undefined : true} aria-describedby={titleOk ? undefined : `${baseId}-title-error`}
                  onChange={event => { if (locked) return; setDraft({ token: ready.token, title: event.target.value }); setPhase({ step: 'editing', banner: null }) }} />
                {!titleOk && <p id={`${baseId}-title-error`} className="ll-ext-error">{labels.titleProblem}</p>}
              </div>
              {typeof props.form === 'function' ? props.form(locked) : props.form}
              <div className="ll-ext-field">
                <label htmlFor={`${baseId}-folder`}>{labels.createIn}</label>
                <Select value={folder || ROOT} disabled={locked} onValueChange={value => { setFolder(value === ROOT ? '' : value); if (phase.step === 'editing') setPhase({ step: 'editing', banner: null }) }}>
                  <SelectTrigger id={`${baseId}-folder`} className="w-full" data-testid="web-capture-folder"><SelectValue /></SelectTrigger>
                  <SelectContent data-settings-panel-portal="true" onEscapeKeyDown={event => event.stopPropagation()}>
                    {folders.map(option => <SelectItem key={option.path || ROOT} value={option.path || ROOT}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {(view.step === 'editing' || view.step === 'saving') && fileName !== null && (
                taken || (view.step === 'editing' && view.banner?.kind === 'exists')
                  ? <p className="ll-ext-destination ll-ext-destination-taken" role="alert" data-testid="web-capture-destination">{labels.exists(baseFileName ?? fileName, folderLabel)}</p>
                  : <p className="ll-ext-destination" role="status" data-testid="web-capture-destination">{labels.willCreate(joinPath(folder, fileName))}</p>)}
              {mediaCount(ready.entry) > 0 && <p className="ll-ext-quiet">{labels.imagesAsLinks}</p>}
            </>}
          </div>
          {ready && <>
            <Button variant="outline" size="sm" className="ll-ext-preview-toggle" aria-expanded={showPreview} aria-controls={previewId}
              onClick={() => setShowPreview(value => !value)}>{showPreview ? labels.hidePreview : labels.showPreview}</Button>
            <section id={previewId} className="ll-ext-run-preview" data-open={showPreview} aria-label={labels.previewLabel} data-testid="web-capture-preview">
              {prepared?.status === 'ready'
                ? <PassiveNote content={prepared.content} locale={props.locale} />
                : prepared ? <p className="ll-ext-notice" role="alert">{labels.notWritten(notWrittenReasonFor(prepared.reason))}</p>
                  : <p className="ll-ext-quiet" role="status">{labels.previewPreparing}</p>}
            </section>
          </>}
        </div>
        <SaveStatus labels={labels} view={view} />
        {discard && <div className="ll-ext-notice" role="alertdialog" aria-label={labels.discardQuestion} data-testid="web-capture-discard">
          <p>{view.step === 'uncertain' ? labels.discardUncertain : labels.discardQuestion}</p>
          {view.step !== 'uncertain' && <p className="ll-ext-quiet">{labels.discardHint}</p>}
          <div className="ll-ext-actions">
            <Button variant="outline" autoFocus onClick={() => setDiscard(false)}>{labels.keepEditing}</Button>
            <Button variant="secondary" onClick={() => close(false, view.step === 'uncertain' ? 'abandon' : 'cancel')}>
              {view.step === 'uncertain' ? labels.stopChecking : labels.discard}</Button>
          </div>
        </div>}
        <DialogFooter>
          {view.step === 'created'
            ? <Button data-testid="web-capture-done" onClick={() => close(false, 'done')}>{labels.done}</Button>
            : view.step === 'revoked'
              ? <Button data-testid="web-capture-close" onClick={() => close(false, 'cancel')}>{labels.close}</Button>
              : <>
                <Button variant="outline" disabled={view.step === 'saving' || (view.step === 'uncertain' && view.checking)} onClick={requestClose}>{labels.cancel}</Button>
                {view.step === 'uncertain'
                  ? <Button data-testid="web-capture-check" disabled={view.checking} onClick={() => { void checkAgain() }}>{view.checking ? labels.checking : labels.checkAgain}</Button>
                  : <Button data-testid="web-capture-save" disabled={!ready || view.step === 'saving'} onClick={() => { void save() }}>
                    {view.step === 'saving' ? labels.saving : duplicate ? labels.saveAnotherCopy : labels.save}</Button>}
              </>}
        </DialogFooter>
      </ExtensionDialogContent>
    </Dialog>
  )
}

function FlowStatus({ labels, state, title, onLinkOnly, onOpenInBrowser }: {
  labels: WebCaptureLabels; state: WebCaptureFlowState; title: string; onLinkOnly: () => void; onOpenInBrowser: (url: string) => void
}) {
  switch (state.step) {
    case 'fetching':
      return <p className="ll-ext-quiet" role="status" data-testid="web-capture-status">{labels.fetching(state.host)}</p>
    case 'preparing':
      return <p className="ll-ext-quiet" role="status" data-testid="web-capture-status">{labels.preparing}</p>
    case 'address':
      return state.stopped ? <p className="ll-ext-quiet" role="status" data-testid="web-capture-status">{labels.stopped}</p> : null
    case 'ready':
      return <p className="ll-web-capture-announce" role="status">{labels.pageReady(title)}</p>
    case 'failed':
      return <div className="ll-ext-notice" role="alert" data-testid="web-capture-failure" data-failure={state.failure}>
        <p>{labels.failure[state.failure]}</p>
        {(state.linkOnly || state.openInBrowser) && <div className="ll-ext-actions">
          {state.linkOnly && <Button variant="outline" size="sm" autoFocus data-testid="web-capture-link-only" onClick={onLinkOnly}>{labels.saveLinkOnly}</Button>}
          {state.openInBrowser && state.url && <Button variant="ghost" size="sm" onClick={() => onOpenInBrowser(state.url!)}>{labels.openInBrowser}</Button>}
        </div>}
      </div>
    case 'revoked':
      return null
  }
}

function SavedBefore({ labels, lookup, onOpen }: { labels: WebCaptureLabels; lookup: SavedCopyLookup; onOpen: (path: string) => void }) {
  const copy = lookup.matches[0]
  return <div className="ll-ext-notice" role="status" data-testid="web-capture-saved-before" data-complete={lookup.status === 'complete'}>
    {copy && <p>{labels.savedBefore(copy)}</p>}
    {lookup.status === 'incomplete' && <p className="ll-ext-quiet">{labels.savedBeforeIncomplete}</p>}
    {copy && <div className="ll-ext-actions"><Button variant="outline" size="sm" data-testid="web-capture-open-saved" onClick={() => onOpen(copy.path)}>{labels.openSavedCopy}</Button></div>}
  </div>
}

function SaveStatus({ labels, view }: { labels: WebCaptureLabels; view: SavePhase }) {
  switch (view.step) {
    case 'editing':
      if (!view.banner || view.banner.kind === 'exists' || view.banner.kind === 'title') return null
      return <p className="ll-ext-notice" role="alert" data-testid="web-capture-save-status">
        {view.banner.kind === 'form' ? labels.formProblem : labels.notWritten(view.banner.reason)}</p>
    case 'saving':
      return <p className="ll-ext-quiet" role="status">{labels.saving}</p>
    case 'uncertain':
      return <div className="ll-ext-notice" role="alert" data-testid="web-capture-save-status" data-detail={view.detail}>
        <p>{labels.uncertain(view.detail)}</p>
        <p className="ll-ext-quiet">{labels.uncertainWhere(view.path)}</p>
      </div>
    case 'created':
      return <div className="ll-ext-notice" role="status" data-testid="web-capture-save-status" data-path={view.path}>
        <p>{view.how === 'elsewhere' ? labels.createdElsewhere(view.path) : view.how === 'notOpened' ? labels.createdNotOpened(view.path) : labels.created(view.path)}</p>
        {!view.durable && <p className="ll-ext-quiet">{labels.notDurable}</p>}
      </div>
    case 'revoked':
      return <p className="ll-ext-notice" role="alert" data-testid="web-capture-save-status">{labels.revoked(view.reason)}</p>
  }
}
