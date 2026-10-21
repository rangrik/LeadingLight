import { useEffect, useId, useMemo, useRef, useState, type ComponentProps, type RefObject } from 'react'
import { ClockCounterClockwise, Paperclip, Plus, ShieldCheck, Sparkle, Trash } from '@phosphor-icons/react'
import { Button } from '../../components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu'
import { Textarea } from '../../components/ui/textarea'
import type { AppLocale } from '../../lib/i18n'
import { ExtensionDialogContent } from '../extensions/ExtensionPreviewDialog'
import type { PackageView, RegistrySnapshot } from '../extensions/extensionSessionController'
import { commandSentences, diagnosticLocation, missingSentence, translator, type T } from '../extensions/extensionUiText'
import { writeClipboardText } from '../../utils/clipboardText'
import type { Adoption } from './adaptAdoption'
import { AdaptAnswer } from './AdaptAnswer'
import { AdaptChips } from './AdaptChipPreview'
import { canAttach, isPassage, type AdaptAttachment } from './adaptAttachments'
import { candidateFor, type CandidateState, type HostReview } from './adaptCandidate'
import type { AdaptConversation, AdaptEntry, AdaptReply } from './adaptContract'
import {
  canSendIn, includedTurnsOf, isConnected, isSettled, turnPhaseOf,
  type AdaptController, type AdaptSnapshot, type Winding,
} from './adaptController'
import { failedText, noticeText, phaseText, stoppedText, unavailableText } from './adaptText'
import type { AskLabels } from './askLabels'
import './adapt.css'

type Request = Extract<AdaptEntry, { kind: 'request' }>
type Outcome = Exclude<AdaptEntry, { kind: 'request' }>

/** What the candidate cards ask the host to do; each goes through E1 and nothing else. */
export interface CandidateActions {
  preview: (turnId: string, packageText: string, expected: string | null) => void
  keep: (turnId: string, packageText: string, available: boolean) => void
  tryIt: (turnId: string) => void
  undo: (turnId: string) => void
}

interface Props {
  locale: AppLocale
  snapshot: AdaptSnapshot
  controller: AdaptController
  registry: RegistrySnapshot
  /** The extension host's review (its controller's), so a candidate is available exactly when Turn on would be. */
  review: HostReview
  adoptions: Readonly<Record<string, Adoption>>
  candidates: CandidateActions
  /** Settles and snapshots the page in front, on this click only. */
  onAttachPage: () => void
  /** The host's Ask words. Without them Copy, Selected passage and Another page… are not offered. */
  ask?: AskLabels | null
  /** Captures the active pane's selection on this click; offered only with `ask`. */
  onAttachPassage?: () => void
  /** Lets the person choose another page, then settles and snapshots it; offered only with `ask`. */
  onAttachAnotherPage?: () => void
  /** Puts exact text on the clipboard; rejects when it could not. */
  copyText?: (text: string) => Promise<void>
  /** Escape or the close button: back to whatever opened Adapt. */
  onClose: () => void
  /** Keep writing: back to the page, leaving what opened Adapt (Settings) too. */
  onKeepWriting: () => void
  onCloseAutoFocus: (event: Event) => void
}

/** Above the Adapt dialog, which is above Settings; keeps Escape from reaching Settings too. */
function MenuContent(props: ComponentProps<typeof DropdownMenuContent>) {
  return <DropdownMenuContent {...props} data-settings-panel-portal="true" className="ll-adapt-menu" onEscapeKeyDown={event => event.stopPropagation()} />
}

/**
 * One calm dialog: provider status, the conversation, and the composer. Closing it (Keep writing)
 * keeps the request and any running turn; nothing is sent or turned on without a click here or in
 * the E1 preview it opens.
 */
export function AdaptDialog(props: Props) {
  const { locale, snapshot, controller, registry, review, adoptions, candidates, onAttachPage, onClose, onKeepWriting, onCloseAutoFocus } = props
  const ask = props.ask ?? null
  const copyText = props.copyText ?? writeClipboardText
  const t = translator(locale)
  const composer = useRef<HTMLTextAreaElement | null>(null)
  const focusComposer = () => composer.current?.focus()
  const answer = (text: string) => { controller.setRequest(text); focusComposer() }
  const { conversation, notice, visit } = snapshot
  const ready = visit === 'open' && isConnected(snapshot)
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <ExtensionDialogContent className="ll-adapt-dialog" data-testid="adapt-dialog" onCloseAutoFocus={onCloseAutoFocus}
        onOpenAutoFocus={event => { if (composer.current) { event.preventDefault(); composer.current.focus() } }}>
        <DialogHeader className="ll-adapt-header">
          <DialogTitle className="ll-ext-title"><Sparkle aria-hidden="true" />{t('leadinglight.adapt.title')}</DialogTitle>
          <DialogDescription>{t('leadinglight.adapt.description')}</DialogDescription>
          <HeaderActions t={t} snapshot={snapshot} controller={controller} />
        </DialogHeader>
        <div className="ll-adapt-scroll" data-testid="adapt-conversation">
          <ProviderPanel t={t} snapshot={snapshot} controller={controller} />
          <VisitPanel t={t} snapshot={snapshot} controller={controller} />
          <WindingLine t={t} kind="closingVisit" winding={snapshot.closingVisit} />
          <WindingLine t={t} kind="signingOut" winding={snapshot.signingOut} />
          {conversation && conversation.entries.length > 0 && (
            <Transcript t={t} locale={locale} snapshot={snapshot} conversation={conversation} controller={controller} registry={registry} review={review}
              adoptions={adoptions} candidates={candidates} onAnswer={answer} onChange={focusComposer} ask={ask} copyText={copyText} />
          )}
          {conversation && conversation.storage !== 'saved' && <StorageLine t={t} snapshot={snapshot} controller={controller} storage={conversation.storage} />}
        </div>
        <StatusLine t={t} snapshot={snapshot} controller={controller} />
        {notice && <p className="ll-ext-notice" role="alert" data-testid="adapt-notice">{noticeText(t, notice, ask)}</p>}
        {ready && <Composer t={t} snapshot={snapshot} controller={controller} registry={registry} inputRef={composer} onAttachPage={onAttachPage}
          more={ask ? { ask, passage: props.onAttachPassage, anotherPage: props.onAttachAnotherPage } : null} />}
        <DialogFooter className="ll-adapt-footer">
          <Accounts t={t} snapshot={snapshot} controller={controller} />
          <Button variant="outline" data-testid="adapt-keep-writing" onClick={onKeepWriting}>{t('leadinglight.adapt.keepWriting')}</Button>
        </DialogFooter>
      </ExtensionDialogContent>
    </Dialog>
  )
}

function HeaderActions({ t, snapshot, controller }: { t: T; snapshot: AdaptSnapshot; controller: AdaptController }) {
  const [confirming, setConfirming] = useState(false)
  const settled = isSettled(snapshot)
  const { conversation, conversations } = snapshot
  return <>
    <div className="ll-adapt-header-actions">
      <Button variant="ghost" size="sm" data-testid="adapt-new-request" disabled={!settled || !snapshot.conversationId} onClick={() => controller.newRequest()}>
        <Plus aria-hidden="true" />{t('leadinglight.adapt.newRequest')}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" data-testid="adapt-history" disabled={!settled || conversations.length === 0}>
            <ClockCounterClockwise aria-hidden="true" />{t('leadinglight.adapt.history')}
          </Button>
        </DropdownMenuTrigger>
        <MenuContent align="start">
          {conversations.map(item => (
            <DropdownMenuItem key={item.conversationId} data-testid="adapt-history-item" onSelect={() => { void controller.show(item.conversationId) }}>
              <span className="ll-adapt-menu-text">{item.title || t('leadinglight.adapt.untitled')}</span>
            </DropdownMenuItem>
          ))}
        </MenuContent>
      </DropdownMenu>
      {conversation && <Button variant="ghost" size="sm" data-testid="adapt-delete" disabled={!settled} onClick={() => setConfirming(true)}>
        <Trash aria-hidden="true" />{t('leadinglight.adapt.delete')}
      </Button>}
    </div>
    {confirming && conversation && <div className="ll-ext-notice" role="group" aria-label={t('leadinglight.adapt.delete')} data-testid="adapt-delete-confirm">
      <p>{t('leadinglight.adapt.deleteQuestion')}</p>
      <p className="ll-ext-quiet">{t('leadinglight.adapt.deleteHint')}</p>
      <div className="ll-ext-actions">
        <Button size="sm" variant="destructive" onClick={() => { setConfirming(false); void controller.deleteConversation() }}>{t('leadinglight.adapt.deleteConfirm')}</Button>
        <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>{t('leadinglight.adapt.pasteCancel')}</Button>
      </div>
    </div>}
  </>
}

/** Only what the host reports about Codex; Connect is a separate sign-in, started by this click. */
function ProviderPanel({ t, snapshot, controller }: { t: T; snapshot: AdaptSnapshot; controller: AdaptController }) {
  const { provider } = snapshot
  const recheck = <Button variant="outline" size="sm" onClick={() => { void controller.refreshStatus() }}>{t('leadinglight.adapt.recheck')}</Button>
  if (provider.status === 'checking') return <p className="ll-ext-quiet" role="status" data-testid="adapt-provider" data-status="checking">{t('leadinglight.adapt.checking')}</p>
  if (provider.status === 'noReply') {
    return <div className="ll-ext-notice" data-testid="adapt-provider" data-status="noReply"><p>{t('leadinglight.adapt.unavailable.noHost')}</p>{recheck}</div>
  }
  const { codex } = provider
  switch (codex.status) {
    case 'connected': return null
    case 'unavailable':
      return <div className="ll-ext-notice" data-testid="adapt-provider" data-status="unavailable"><p>{unavailableText(t, codex)}</p>{recheck}</div>
    case 'signedOut':
      return <div className="ll-ext-notice ll-adapt-connect" data-testid="adapt-provider" data-status="signedOut">
        <p className="ll-adapt-strong">{t('leadinglight.adapt.connectTitle')}</p>
        <p>{t('leadinglight.adapt.connectBody')}</p>
        {codex.lastConnect && <p className="ll-ext-quiet">{t(codex.lastConnect === 'failed' ? 'leadinglight.adapt.lastConnect.failed' : 'leadinglight.adapt.lastConnect.cancelled')}</p>}
        <Button size="sm" data-testid="adapt-connect" disabled={snapshot.signingOut === 'stopping'} onClick={() => { void controller.connect() }}>{t('leadinglight.adapt.connect')}</Button>
      </div>
    case 'connecting':
      return <div className="ll-ext-notice" data-testid="adapt-provider" data-status="connecting">
        <p role="status">{t('leadinglight.adapt.connecting')}</p>
        <Button variant="outline" size="sm" onClick={() => { void controller.cancelConnect() }}>{t('leadinglight.adapt.connectCancel')}</Button>
      </div>
    case 'refused':
      return <div className="ll-ext-notice" data-testid="adapt-provider" data-status="refused">
        <p>{t('leadinglight.adapt.accountNotSupported')}</p>
        <Button variant="outline" size="sm" onClick={() => { void controller.disconnect() }}>{t('leadinglight.adapt.disconnect')}</Button>
      </div>
  }
}

function VisitPanel({ t, snapshot, controller }: { t: T; snapshot: AdaptSnapshot; controller: AdaptController }) {
  const { visit } = snapshot
  if (visit !== 'refused' && visit !== 'noReply' && visit !== 'closed') return null
  return <div className="ll-ext-notice" data-testid="adapt-visit" data-status={visit}>
    <p>{t(visit === 'closed' ? 'leadinglight.adapt.visitEnded' : 'leadinglight.adapt.visitRefused')}</p>
    <Button variant="outline" size="sm" onClick={() => { void controller.reopen() }}>{t('leadinglight.adapt.reopen')}</Button>
  </div>
}

function WindingLine({ t, kind, winding }: { t: T; kind: 'closingVisit' | 'signingOut'; winding: Winding }) {
  if (winding === 'none') return null
  const key = kind === 'closingVisit'
    ? (winding === 'stopping' ? 'leadinglight.adapt.closingVisit.stopping' : 'leadinglight.adapt.closingVisit.unconfirmed')
    : (winding === 'stopping' ? 'leadinglight.adapt.signingOut.stopping' : 'leadinglight.adapt.signingOut.unconfirmed')
  return <p className="ll-ext-quiet" role="status" data-testid={`adapt-${kind}`} data-status={winding}>{t(key)}</p>
}

/** Native's own word on local saving; never shown as saved until native says so. */
function StorageLine({ t, snapshot, controller, storage }: { t: T; snapshot: AdaptSnapshot; controller: AdaptController; storage: 'unsaved' | 'unconfirmed' }) {
  return <div className="ll-ext-notice" role="status" data-testid="adapt-storage" data-storage={storage}>
    <p>{t(storage === 'unsaved' ? 'leadinglight.adapt.storage.unsaved' : 'leadinglight.adapt.storage.unconfirmed')}</p>
    <div className="ll-ext-actions">
      <Button variant="outline" size="sm" data-testid="adapt-save-again" disabled={snapshot.saving || snapshot.visit !== 'open'} onClick={() => { void controller.saveConversation() }}>
        {t(snapshot.saving ? 'leadinglight.adapt.saving' : 'leadinglight.adapt.saveAgain')}
      </Button>
      <span className="ll-ext-quiet">{t('leadinglight.adapt.saveLocalOnly')}</span>
    </div>
  </div>
}

/** Host-known phases only, and the one Cancel for the Send in flight or the turn running. */
function StatusLine({ t, snapshot, controller }: { t: T; snapshot: AdaptSnapshot; controller: AdaptController }) {
  const phase = turnPhaseOf(snapshot)
  const canStop = phase !== null && (phase !== 'stopping' || snapshot.attempt?.cancel === 'unconfirmed')
  return <div className="ll-adapt-status" role="status" aria-label={t('leadinglight.adapt.statusLabel')} data-testid="adapt-status" data-phase={phase ?? 'none'}>
    {phase && <span>{phaseText(t, phase)}</span>}
    {canStop && <Button variant="outline" size="sm" data-testid="adapt-cancel" onClick={() => { void controller.cancel() }}>{t('leadinglight.adapt.cancel')}</Button>}
  </div>
}

interface TranscriptProps {
  t: T
  locale: AppLocale
  snapshot: AdaptSnapshot
  conversation: AdaptConversation
  controller: AdaptController
  registry: RegistrySnapshot
  review: HostReview
  adoptions: Readonly<Record<string, Adoption>>
  candidates: CandidateActions
  onAnswer: (text: string) => void
  onChange: () => void
  ask: AskLabels | null
  copyText: (text: string) => Promise<void>
}

function turnsOf(entries: readonly AdaptEntry[]): { request: Request; outcome: Outcome | null }[] {
  const requests = entries.filter((entry): entry is Request => entry.kind === 'request')
  return requests.map(request => ({
    request, outcome: entries.find((entry): entry is Outcome => entry.kind !== 'request' && entry.turnId === request.turnId) ?? null,
  }))
}

function Transcript(props: TranscriptProps) {
  const { t, snapshot, conversation, controller } = props
  const turns = turnsOf(conversation.entries)
  const formatTime = (iso: string) => new Date(iso).toLocaleString(props.locale, { dateStyle: 'medium', timeStyle: 'short' })
  const settled = isSettled(snapshot)
  return <ol className="ll-adapt-turns" data-testid="adapt-turns">
    {turns.map(({ request, outcome }, index) => {
      const last = index === turns.length - 1
      return <li key={request.turnId} className="ll-adapt-turn" data-testid="adapt-turn" data-turn-id={request.turnId}>
        <RequestView t={t} request={request} />
        {outcome?.kind === 'reply' && <ReplyView {...props} request={request} turnId={outcome.turnId} reply={outcome.reply} actionable={last && settled} />}
        {outcome?.kind === 'failed' && <div className="ll-ext-notice" data-testid="adapt-failed" data-reason={outcome.reason}>
          <p>{failedText(t, outcome, formatTime)}</p>
          {last && <Button variant="outline" size="sm" data-testid="adapt-try-again" disabled={!canSendIn(snapshot)} onClick={() => { void controller.send() }}>{t('leadinglight.adapt.tryAgain')}</Button>}
        </div>}
        {outcome?.kind === 'stopped' && <p className="ll-ext-quiet" data-testid="adapt-stopped" data-confirmed={String(outcome.confirmed)}>{stoppedText(t, outcome)}</p>}
      </li>
    })}
  </ol>
}

function RequestView({ t, request }: { t: T; request: Request }) {
  return <div className="ll-adapt-request">
    <p className="ll-adapt-who">{t('leadinglight.adapt.you')}</p>
    <p className="ll-adapt-prose">{request.text}</p>
    {request.attachments.length > 0 && <p className="ll-ext-quiet">{t('leadinglight.adapt.sentAttachments', { list: request.attachments.map(item => item.label).join(', ') })}</p>}
    {request.includedTurnIds.length > 0 && <p className="ll-ext-quiet">{t('leadinglight.adapt.sentEarlier')}</p>}
  </div>
}

const WHO = {
  question: 'leadinglight.adapt.question', unsupported: 'leadinglight.adapt.unsupported', answer: 'leadinglight.adapt.answer', candidate: 'leadinglight.adapt.reply',
} as const

/**
 * The model's words as plain text, apart from anything LeadingLight itself checked. An answer's
 * Markdown is shown only inertly, and nothing acts on it but Copy.
 */
function ReplyView(props: TranscriptProps & { request: Request; turnId: string; reply: AdaptReply; actionable: boolean }) {
  const { t, reply, actionable, onAnswer } = props
  return <div className="ll-adapt-reply" data-testid="adapt-reply" data-kind={reply.kind}>
    <p className="ll-adapt-who">{t(WHO[reply.kind])}</p>
    <p className="ll-adapt-prose">{reply.message}</p>
    {reply.kind === 'question' && <p className="ll-ext-quiet" data-testid="adapt-question-hint">{t('leadinglight.ask.questionHint')}</p>}
    {reply.kind === 'answer' && <AdaptAnswer t={t} answer={reply.answer} ask={props.ask} copyText={props.copyText} />}
    {reply.kind === 'question' && actionable && <div className="ll-ext-actions">
      {reply.choices.map(choice => <Button key={choice} variant="outline" size="sm" data-testid="adapt-choice" onClick={() => onAnswer(choice)}>{choice}</Button>)}
    </div>}
    {reply.kind === 'unsupported' && reply.alternative && <>
      <p className="ll-adapt-prose">{t('leadinglight.adapt.instead', { alternative: reply.alternative })}</p>
      {actionable && <Button variant="outline" size="sm" data-testid="adapt-make-instead" onClick={() => onAnswer(reply.alternative!)}>{t('leadinglight.adapt.makeInstead')}</Button>}
    </>}
    {reply.kind === 'candidate' && <CandidateCard {...props} packageText={reply.packageText} />}
  </div>
}

function CandidateCard(props: TranscriptProps & { request: Request; turnId: string; packageText: string }) {
  const { t, locale, registry, review, request, packageText, turnId, adoptions, candidates, snapshot, onChange } = props
  const state = useMemo(() => candidateFor(packageText, request, registry, review), [packageText, request, registry, review])
  const adoption = adoptions[turnId] ?? null
  const here = snapshot.visit === 'open'
  return <section className="ll-adapt-check" aria-label={t('leadinglight.adapt.checkedBy')} data-testid="adapt-candidate" data-state={state.status}
    data-check={state.status === 'checked' ? state.check.status : undefined}>
    <p className="ll-adapt-check-title"><ShieldCheck aria-hidden="true" />{t('leadinglight.adapt.checkedBy')}</p>
    <CandidateFacts t={t} locale={locale} state={state} />
    {!here ? <p className="ll-ext-quiet">{t('leadinglight.adapt.unavailableHere')}</p>
      : adoption && adoption.status !== 'notTurnedOn' ? <AdoptionView t={t} adoption={adoption} turnId={turnId} candidates={candidates} onChange={onChange} />
        : <CandidateChoices t={t} state={state} adoption={adoption} turnId={turnId} packageText={packageText} candidates={candidates} onChange={onChange} />}
  </section>
}

function CandidateFacts({ t, locale, state }: { t: T; locale: AppLocale; state: CandidateState }) {
  switch (state.status) {
    case 'waiting': return <p className="ll-ext-quiet" role="status">{t('leadinglight.adapt.waiting')}</p>
    case 'baseMissing': return <p>{t('leadinglight.adapt.baseMissing')}</p>
    case 'stale': return <p>{t('leadinglight.adapt.stale', { name: state.name })}</p>
    case 'stored': return <p>{t('leadinglight.adapt.stored', { name: state.name })}</p>
    case 'checked': break
  }
  const { check, change } = state
  if (check.status === 'invalid') return <InvalidFacts t={t} check={check} />
  if (check.status === 'identity') return <p>{t(`leadinglight.adapt.identity.${check.problem}`)}</p>
  const { extension, review } = check
  const heading = change.kind === 'revision' ? t('leadinglight.adapt.replaces', { name: change.name, from: change.from, to: extension.version })
    : change.kind === 'copy' ? t('leadinglight.adapt.copyOf', { name: change.of }) : t('leadinglight.adapt.newExtension', { name: extension.name })
  const needs = missingSentence(t, locale, review.missing)
  return <>
    <p data-testid="adapt-candidate-heading">{heading}</p>
    <p className="ll-ext-quiet">{extension.description}</p>
    {needs && <p className="ll-ext-notice" role="note" data-testid="adapt-candidate-needs">{needs}</p>}
    <div className="ll-ext-section">
      <p className="ll-ext-heading">{t('leadinglight.extensions.whatItDoes')}</p>
      {review.commands.map(command => <div key={command.id} className="ll-ext-command">
        <p className="ll-ext-command-title">{command.title}</p>
        <ul className="ll-ext-sentences">{commandSentences(t, command).map(sentence => <li key={sentence}>{sentence}</li>)}</ul>
      </div>)}
      <p className="ll-ext-quiet">{t('leadinglight.extensions.does.local')}</p>
    </div>
  </>
}

function InvalidFacts({ t, check }: { t: T; check: Extract<Extract<CandidateState, { status: 'checked' }>['check'], { status: 'invalid' }> }) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const [first] = check.diagnostics
  return <>
    <p data-testid="adapt-candidate-invalid">{t('leadinglight.adapt.invalid')}</p>
    {first && <p className="ll-ext-quiet">{first.message} <code>{diagnosticLocation(t, first.path)}</code></p>}
    <Button variant="ghost" size="sm" className="ll-ext-disclosure" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(value => !value)}>{t('leadinglight.adapt.details')}</Button>
    {open && <div id={listId} className="ll-ext-details">
      <ul>{check.diagnostics.map((item, index) => <li key={`${index}:${item.path}`}><code>{item.path || '/'}</code> {item.message}</li>)}</ul>
      {check.truncated && <p className="ll-ext-quiet">{t('leadinglight.extensions.moreProblems')}</p>}
    </div>}
  </>
}

function CandidateChoices({ t, state, adoption, turnId, packageText, candidates, onChange }: {
  t: T; state: CandidateState; adoption: Adoption | null; turnId: string; packageText: string; candidates: CandidateActions; onChange: () => void
}) {
  const check = state.status === 'checked' ? state.check : null
  const usable = check?.status === 'ready' || check?.status === 'unavailable'
  return <>
    {adoption?.status === 'notTurnedOn' && <p className="ll-ext-quiet" role="status">{t('leadinglight.adapt.notTurnedOn')}</p>}
    <div className="ll-ext-actions">
      {check?.status === 'ready' && state.status === 'checked' && <Button size="sm" data-testid="adapt-preview" onClick={() => candidates.preview(turnId, packageText, state.expected)}>
        {t('leadinglight.adapt.previewTurnOn')}</Button>}
      {usable && <Button variant="outline" size="sm" data-testid="adapt-keep" onClick={() => candidates.keep(turnId, packageText, check.status === 'ready')}>
        {t('leadinglight.adapt.keepForLater')}</Button>}
      <Button variant="ghost" size="sm" data-testid="adapt-change" onClick={onChange}>{t('leadinglight.adapt.changeSomething')}</Button>
    </div>
  </>
}

function AdoptionView({ t, adoption, turnId, candidates, onChange }: { t: T; adoption: Adoption; turnId: string; candidates: CandidateActions; onChange: () => void }) {
  switch (adoption.status) {
    case 'working':
    case 'notTurnedOn':
      return <p className="ll-ext-quiet" role="status">{t('leadinglight.extensions.checking')}</p>
    case 'kept': return <p role="status" data-testid="adapt-adoption" data-status="kept">{t(adoption.available ? 'leadinglight.adapt.keptReady' : 'leadinglight.adapt.kept')}</p>
    case 'undone': return <p role="status" data-testid="adapt-adoption" data-status="undone">{adoption.text}</p>
    case 'refused': return <div data-testid="adapt-adoption" data-status="refused">
      <p role="status">{adoption.text}</p>
      <Button variant="ghost" size="sm" onClick={onChange}>{t('leadinglight.adapt.changeSomething')}</Button>
    </div>
    case 'on': return <div data-testid="adapt-adoption" data-status="on">
      <p role="status">{t('leadinglight.adapt.on', { name: adoption.name })}</p>
      {adoption.made && <p className="ll-ext-quiet" data-testid="adapt-made">{t('leadinglight.adapt.madeNote', { path: adoption.made })}</p>}
      {adoption.problem && <p className="ll-ext-notice" role="alert">{adoption.problem}</p>}
      <div className="ll-ext-actions">
        {adoption.tryKey && <Button size="sm" data-testid="adapt-try" disabled={adoption.undoing} onClick={() => candidates.tryIt(turnId)}>{t('leadinglight.adapt.tryIt')}</Button>}
        <Button variant="outline" size="sm" data-testid="adapt-undo" disabled={adoption.undoing} onClick={() => candidates.undo(turnId)}>{t('leadinglight.adapt.undo')}</Button>
      </div>
    </div>
  }
}

const EXAMPLES = {
  text: ['leadinglight.ask.example.passage1', 'leadinglight.ask.example.passage2', 'leadinglight.ask.example.passage3'],
  page: ['leadinglight.ask.example.page1', 'leadinglight.ask.example.page2', 'leadinglight.ask.example.page3'],
  extension: ['leadinglight.adapt.example1', 'leadinglight.adapt.example2', 'leadinglight.adapt.example3'],
} as const

/** What a fresh request might say, by what is attached; none suggests a write. */
function examplesFor(attachments: readonly AdaptAttachment[]) {
  if (attachments.length === 0) return EXAMPLES.extension
  if (attachments.some(item => isPassage(item) || item.kind === 'pastedText')) return EXAMPLES.text
  if (attachments.some(item => item.kind === 'pageSnapshot')) return EXAMPLES.page
  return null
}

interface ComposerProps {
  t: T
  snapshot: AdaptSnapshot
  controller: AdaptController
  registry: RegistrySnapshot
  inputRef: RefObject<HTMLTextAreaElement | null>
  onAttachPage: () => void
  /** The Ask attach choices the host offers, with its words; null when it offers none. */
  more: { ask: AskLabels; passage?: () => void; anotherPage?: () => void } | null
}

/** The request, its visible attachments, and exactly what Send will include. */
function Composer({ t, snapshot, controller, registry, inputRef, onAttachPage, more }: ComposerProps) {
  const fieldId = useId()
  const [pasting, setPasting] = useState(false)
  const { draft, conversation } = snapshot
  const earlier = includedTurnsOf(conversation).length
  const examples = !conversation && draft.request === '' ? examplesFor(draft.attachments) : null
  const send = () => { if (canSendIn(snapshot)) void controller.send() }
  const packages: readonly PackageView[] = registry.status === 'ready' ? registry.packages.filter(canAttach) : []
  // The composer appears once the visit is open and Codex is connected; it takes focus then, unless
  // the person is already typing somewhere.
  useEffect(() => {
    const active = document.activeElement
    if (!(active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement)) inputRef.current?.focus()
  }, [inputRef])
  const pastedCount = draft.attachments.filter(item => item.kind === 'pastedText').length
  return <div className="ll-adapt-composer" data-testid="adapt-composer">
    <label htmlFor={fieldId} className="ll-adapt-label">{t(conversation ? 'leadinglight.adapt.composerChange' : 'leadinglight.adapt.composerLabel')}</label>
    <Textarea id={fieldId} ref={inputRef} className="ll-adapt-input" data-testid="adapt-request" value={draft.request}
      onChange={event => controller.setRequest(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.stopPropagation(); send() } }} />
    {examples && <div className="ll-adapt-examples" role="group" aria-label={t('leadinglight.adapt.examples')}>
      {examples.map(key => (
        <Button key={key} variant="outline" size="sm" className="ll-adapt-example" onClick={() => { controller.setRequest(t(key)); inputRef.current?.focus() }}>{t(key)}</Button>
      ))}
    </div>}
    {draft.attachments.length > 0 && <AdaptChips t={t} attachments={draft.attachments} openSingle={!conversation}
      onRemove={id => controller.removeAttachment(id)} />}
    {pasting && <PasteArea t={t} onAttach={text => {
      if (controller.attachText(text, pastedCount ? `${t('leadinglight.adapt.pastedLabel')} ${pastedCount + 1}` : t('leadinglight.adapt.pastedLabel'))) {
        setPasting(false); inputRef.current?.focus()
      }
    }} onCancel={() => setPasting(false)} />}
    <p className="ll-ext-quiet" data-testid="adapt-sends-what">
      {earlier > 0 ? t('leadinglight.adapt.sendsWhatWithEarlier', { count: earlier }) : t('leadinglight.adapt.sendsWhat')}
    </p>
    {earlier > 0 && <p className="ll-ext-quiet" data-testid="adapt-earlier-warning">{t('leadinglight.adapt.earlierWarning')}</p>}
    <div className="ll-adapt-composer-actions">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" data-testid="adapt-attach"><Paperclip aria-hidden="true" />{t('leadinglight.adapt.attach')}</Button>
        </DropdownMenuTrigger>
        <MenuContent align="start">
          {more?.passage && <DropdownMenuItem data-testid="adapt-attach-passage" onSelect={more.passage}>{more.ask.attachPassage}</DropdownMenuItem>}
          <DropdownMenuItem data-testid="adapt-attach-page" onSelect={onAttachPage}>{t('leadinglight.adapt.attachPage')}</DropdownMenuItem>
          {more?.anotherPage && <DropdownMenuItem data-testid="adapt-attach-another-page" onSelect={more.anotherPage}>{more.ask.attachAnotherPage}</DropdownMenuItem>}
          <DropdownMenuItem data-testid="adapt-attach-pasted" onSelect={() => setPasting(true)}>{t('leadinglight.adapt.attachPasted')}</DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid="adapt-attach-extension">{t('leadinglight.adapt.attachExtension')}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent data-settings-panel-portal="true" className="ll-adapt-menu" onEscapeKeyDown={event => event.stopPropagation()}>
              {packages.length === 0 && <DropdownMenuItem disabled>{t('leadinglight.adapt.noExtensions')}</DropdownMenuItem>}
              {packages.map(view => <DropdownMenuItem key={view.packageId} onSelect={() => { controller.attachFromView(view) }}>
                <span className="ll-adapt-menu-text">{view.name}</span>
              </DropdownMenuItem>)}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </MenuContent>
      </DropdownMenu>
      <Button data-testid="adapt-send" disabled={!canSendIn(snapshot)} onClick={send}>{t('leadinglight.adapt.send')}</Button>
    </div>
  </div>
}

function PasteArea({ t, onAttach, onCancel }: { t: T; onAttach: (text: string) => void; onCancel: () => void }) {
  const fieldId = useId()
  const [text, setText] = useState('')
  const field = useRef<HTMLTextAreaElement | null>(null)
  // Opened by the person's own menu choice, so the field takes focus once.
  useEffect(() => { field.current?.focus() }, [])
  return <div className="ll-adapt-paste" data-testid="adapt-paste">
    <label htmlFor={fieldId} className="ll-adapt-label">{t('leadinglight.adapt.pasteLabel')}</label>
    <Textarea id={fieldId} ref={field} className="ll-adapt-paste-input" value={text} onChange={event => setText(event.target.value)}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onCancel() } }} />
    <div className="ll-ext-actions">
      <Button size="sm" variant="outline" data-testid="adapt-paste-add" onClick={() => onAttach(text)}>{t('leadinglight.adapt.pasteAdd')}</Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>{t('leadinglight.adapt.pasteCancel')}</Button>
    </div>
  </div>
}

function Accounts({ t, snapshot, controller }: { t: T; snapshot: AdaptSnapshot; controller: AdaptController }) {
  const { provider } = snapshot
  const claudeOut = provider.status === 'known' && provider.claude.status === 'unavailable'
  return <div className="ll-adapt-accounts">
    {isConnected(snapshot) && <p className="ll-adapt-account" data-testid="adapt-connected">
      <span>{t('leadinglight.adapt.connected')}</span>
      <Button variant="link" size="sm" data-testid="adapt-disconnect" disabled={snapshot.signingOut === 'stopping'} onClick={() => { void controller.disconnect() }}>
        {t('leadinglight.adapt.disconnect')}</Button>
    </p>}
    {claudeOut && <p className="ll-ext-quiet" data-testid="adapt-claude">{t('leadinglight.adapt.claudeUnavailable')}</p>}
  </div>
}
