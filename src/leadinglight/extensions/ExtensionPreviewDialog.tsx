import { useMemo, useState, type ComponentProps } from 'react'
import { PuzzlePiece } from '@phosphor-icons/react'
import { Button } from '../../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs'
import type { AppLocale } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import { TemplatePreview } from '../templates/TemplatePreview'
import type { ExtensionCommand, PackageReview } from './extensionContract'
import { buildExtensionMarkdown } from './extensionMarkdown'
import { previewDocument } from './extensionRecipe'
import { changedSentences, commandSentences, missingSentence, sampleAnswers, translator, type T } from './extensionUiText'
import type { PackageLoad } from './extensionSessionController'
import './extensions.css'

/**
 * Every extension dialog: marked as a Settings portal so the Settings focus trap lets Tab through,
 * stacked above Settings, and keeping Escape from reaching the Settings window listener, so only
 * the topmost surface answers it.
 */
export function ExtensionDialogContent({ className, onEscapeKeyDown, ...props }: ComponentProps<typeof DialogContent>) {
  return <DialogContent {...props} data-settings-panel-portal="true" className={cn('ll-ext-dialog', className)}
    onEscapeKeyDown={event => { event.stopPropagation(); onEscapeKeyDown?.(event) }} />
}

/** A note's proposed bytes, shown passively: no live HTML, links or fetched media. */
export function PassiveNote({ content, locale }: { content: string; locale: AppLocale }) {
  return <div className="ll-ext-note"><TemplatePreview content={content} locale={locale} /></div>
}

type Ready = Extract<PackageLoad, { status: 'ready' }>

export interface PreviewTarget {
  version: string
  load: PackageLoad
  /** The version on now, when this one would replace it. */
  replacing: { version: string; review: PackageReview } | null
}

interface Props {
  locale: AppLocale
  name: string
  target: PreviewTarget
  /** Absent when this version is already on, so there is nothing to turn on. */
  onTurnOn?: () => Promise<void>
  onClose: () => void
  onCloseAutoFocus?: (event: Event) => void
}

/** Synthetic and effect-free: it reads only the package already in memory and writes nothing. */
export function ExtensionPreviewDialog({ locale, name, target, onTurnOn, onClose, onCloseAutoFocus }: Props) {
  const t = translator(locale)
  const [turning, setTurning] = useState(false)
  const ready = target.load.status === 'ready' ? target.load : null
  const blocked = !ready || ready.review.activation !== 'available'
  const turnOn = async () => {
    if (!onTurnOn || blocked || turning) return
    setTurning(true)
    try { await onTurnOn() } finally { setTurning(false) }
  }
  return (
    <Dialog open onOpenChange={open => { if (!open && !turning) onClose() }}>
      <ExtensionDialogContent className="ll-ext-preview-dialog" data-testid="extension-preview-dialog"
        showCloseButton={!turning} onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={event => { if (turning) event.preventDefault() }}
        onInteractOutside={event => { if (turning) event.preventDefault() }}>
        <DialogHeader>
          <DialogTitle className="ll-ext-title"><PuzzlePiece aria-hidden="true" />{name}</DialogTitle>
          <DialogDescription>{ready?.extension.description ?? t('leadinglight.extensions.previewUnreadable')}</DialogDescription>
        </DialogHeader>
        <div className="ll-ext-scroll">
          {ready ? <PreviewBody t={t} locale={locale} ready={ready} target={target} /> : null}
          <p className="ll-ext-quiet" role="status">{t('leadinglight.extensions.writesNothing')}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={turning} onClick={onClose}>{t(onTurnOn ? 'leadinglight.extensions.notNow' : 'leadinglight.extensions.close')}</Button>
          {onTurnOn && <Button data-testid="extension-turn-on" disabled={blocked || turning} onClick={() => { void turnOn() }}>
            {t(turning ? 'leadinglight.extensions.turningOn' : 'leadinglight.extensions.turnOn')}</Button>}
        </DialogFooter>
      </ExtensionDialogContent>
    </Dialog>
  )
}

function PreviewBody({ t, locale, ready, target }: { t: T; locale: AppLocale; ready: Ready; target: PreviewTarget }) {
  const { review, extension } = ready
  const needs = missingSentence(t, locale, review.missing)
  const changes = target.replacing ? changedSentences(t, target.replacing.review, review) : []
  return <>
    <p className="ll-ext-version" data-testid="extension-preview-version">
      {target.replacing ? t('leadinglight.extensions.replaces', { from: target.replacing.version, to: target.version }) : t('leadinglight.extensions.version', { version: target.version })}
    </p>
    {needs && <p className="ll-ext-notice" role="note" data-testid="extension-preview-needs">{needs}</p>}
    <section className="ll-ext-section" aria-labelledby="ll-ext-does">
      <h3 id="ll-ext-does" className="ll-ext-heading">{t('leadinglight.extensions.whatItDoes')}</h3>
      {review.commands.map(command => (
        <div key={command.id} className="ll-ext-command" data-testid="extension-preview-command">
          <p className="ll-ext-command-title">{command.title}</p>
          <ul className="ll-ext-sentences">{commandSentences(t, command).map(sentence => <li key={sentence}>{sentence}</li>)}</ul>
          {command.missing.length > 0 && review.missing.length === 0 && <p className="ll-ext-quiet">{missingSentence(t, locale, command.missing)}</p>}
        </div>
      ))}
      <p className="ll-ext-quiet">{t('leadinglight.extensions.does.local')}</p>
    </section>
    {target.replacing && <section className="ll-ext-section" aria-labelledby="ll-ext-changes">
      <h3 id="ll-ext-changes" className="ll-ext-heading">{t('leadinglight.extensions.changes')}</h3>
      {changes.length ? <ul className="ll-ext-sentences" data-testid="extension-preview-changes">{changes.map(line => <li key={line}>{line}</li>)}</ul>
        : <p className="ll-ext-quiet">{t('leadinglight.extensions.noChanges')}</p>}
    </section>}
    <Samples t={t} locale={locale} commands={extension.commands} review={review} />
  </>
}

function Samples({ t, locale, commands, review }: { t: T; locale: AppLocale; commands: readonly ExtensionCommand[]; review: PackageReview }) {
  if (commands.length === 1) {
    return <section className="ll-ext-section" aria-label={t('leadinglight.extensions.sample')}>
      <h3 className="ll-ext-heading">{t('leadinglight.extensions.sample')}</h3>
      <Sample t={t} locale={locale} command={commands[0]} review={review} />
    </section>
  }
  return <section className="ll-ext-section" aria-label={t('leadinglight.extensions.sample')}>
    <h3 className="ll-ext-heading">{t('leadinglight.extensions.sample')}</h3>
    <Tabs defaultValue={commands[0].id}>
      <TabsList aria-label={t('leadinglight.extensions.sampleFor')}>
        {commands.map(command => <TabsTrigger key={command.id} value={command.id}>{command.title}</TabsTrigger>)}
      </TabsList>
      {commands.map(command => <TabsContent key={command.id} value={command.id}><Sample t={t} locale={locale} command={command} review={review} /></TabsContent>)}
    </Tabs>
  </section>
}

function Sample({ t, locale, command, review }: { t: T; locale: AppLocale; command: ExtensionCommand; review: PackageReview }) {
  const missing = review.commands.find(item => item.id === command.id)?.missing ?? []
  const built = useMemo(() => {
    if (missing.length > 0) return null
    const { document } = previewDocument(command, { capture: null, answers: sampleAnswers(t, command), destination: { kind: 'newInFolder', folderHandle: 'sample' } })
    return document ? buildExtensionMarkdown(document, command.title) : null
  }, [command, missing.length, t])
  if (missing.length > 0) return <p className="ll-ext-quiet">{t('leadinglight.extensions.sampleUnavailable')}</p>
  if (built?.status !== 'built') return <p className="ll-ext-notice" role="note">{t('leadinglight.extensions.sampleUnsafe')}</p>
  return <div className="ll-ext-sample" data-testid="extension-preview-sample">
    <p className="ll-ext-quiet">{t('leadinglight.extensions.sampleDestination', { name: built.markdown.fileName })}</p>
    <PassiveNote content={built.markdown.content} locale={locale} />
  </div>
}
