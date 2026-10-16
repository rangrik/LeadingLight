import { useEffect, useId, useRef, useState } from 'react'
import { ArrowCounterClockwise } from '@phosphor-icons/react'
import { Button } from '../../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import { translate, type AppLocale, type TranslationKey } from '../../lib/i18n'
import { pickFolder } from '../../utils/vault-dialog'
import { formatWhen } from '../pageHistory/pageHistoryText'
import { backupApi, type BackupApi } from './backupApi'
import type { InspectResult, RestoreResult } from './backupContract'
import { PathLine, ResultView, Working } from './backupParts'
import { REFUSAL_KEYS, formatBytes, formatCount, inspectFailureCopy, progressLines, restoreResultCopy, type Refusal, type T } from './backupText'
import { runOperation, type RunHooks, type Running } from './runOperation'
import './backup.css'

export interface RestoreDialogProps {
  locale: AppLocale
  /** Adds the folder to the workspace list, then switches; rejects when the current workspace refuses to close. */
  openWorkspace: (path: string, label: string) => Promise<void>
  onClose: () => void
  api?: BackupApi
  pick?: (title: string) => Promise<string | null>
}

type Inspected = Extract<InspectResult, { status: 'ok' }>
type Restored = Exclude<RestoreResult, { status: 'nameTaken' }>
type Notice = Refusal | 'nameTaken'
interface Form { backupPath: string; info: Inspected; name: string; notice: Notice | null }

type View =
  | { step: 'intro' }
  | { step: 'choosing' }
  | { step: 'checking'; backupPath: string; operationId: string; running: Running | null; cancelling: boolean }
  | { step: 'checkFailed'; backupPath: string; result: Exclude<InspectResult, { status: 'ok' }> }
  | ({ step: 'form' } & Form)
  | ({ step: 'choosingParent' } & Form)
  | ({ step: 'restoring'; target: string; operationId: string; running: Running | null; cancelling: boolean } & Form)
  | { step: 'finished'; result: Restored }
  | { step: 'refused'; reason: Refusal }
  | { step: 'uncertain'; what: 'check' | 'restore'; path: string }

const SETTLED: ReadonlySet<View['step']> = new Set(['intro', 'checkFailed', 'form', 'finished', 'refused', 'uncertain'])
const NAME_TAKEN: TranslationKey = 'leadinglight.restore.nameTaken'

const joinPath = (parent: string, name: string) => `${parent.replace(/\/+$/u, '')}/${name}`

function backedUpWhen(locale: AppLocale, createdAt: string): string {
  const ms = Date.parse(createdAt)
  return Number.isNaN(ms) ? createdAt : formatWhen(locale, ms)
}

/** Mounted per opening. Restore only ever writes a new folder; opening it is a separate, explicit step. */
export function RestoreDialog({ locale, openWorkspace, onClose, api = backupApi, pick = pickFolder }: RestoreDialogProps) {
  const t: T = (key, values) => translate(locale, key, values)
  const [view, setView] = useState<View>({ step: 'intro' })
  const [opening, setOpening] = useState<'idle' | 'opening' | 'failed'>('idle')
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const settled = SETTLED.has(view.step)

  const follow = (operationId: string): RunHooks => ({
    onRunning: running => setView(v => ((v.step === 'checking' || v.step === 'restoring') && v.operationId === operationId ? { ...v, running } : v)),
    stopped: () => !mounted.current,
  })

  const pickOr = async (title: string): Promise<string | null | undefined> => {
    try {
      return await pick(title)
    } catch (error) {
      console.warn('[restore] The folder picker failed:', error)
      return undefined
    }
  }

  const check = async () => {
    setView({ step: 'choosing' })
    const backupPath = await pickOr(t('leadinglight.restore.pickBackup'))
    if (!mounted.current) return
    if (backupPath === undefined) { setView({ step: 'refused', reason: 'picker' }); return }
    if (backupPath === null) { setView({ step: 'intro' }); return }
    const operationId = crypto.randomUUID()
    setView({ step: 'checking', backupPath, operationId, running: null, cancelling: false })
    const end = await runOperation('inspect', operationId, () => api.startInspection({ operationId, backupPath }), follow(operationId), api)
    if (end.end === 'stopped') return
    if (end.end === 'refused') setView({ step: 'refused', reason: end.reason })
    else if (end.end === 'uncertain') setView({ step: 'uncertain', what: 'check', path: backupPath })
    else if (end.result.status === 'ok') setView({ step: 'form', backupPath, info: end.result, name: t('leadinglight.restore.defaultName', { name: end.result.workspaceName }), notice: null })
    else setView({ step: 'checkFailed', backupPath, result: end.result })
  }

  const restore = async ({ backupPath, info, name: typed }: Form) => {
    const form: Form = { backupPath, info, name: typed, notice: null }
    const name = typed.trim()
    setView({ step: 'choosingParent', ...form, notice: null })
    const parent = await pickOr(t('leadinglight.restore.pickParent'))
    if (!mounted.current) return
    if (parent === undefined || parent === null) { setView({ step: 'form', ...form, notice: parent === undefined ? 'picker' : null }); return }
    const operationId = crypto.randomUUID()
    setView({ step: 'restoring', ...form, notice: null, target: joinPath(parent, name), operationId, running: null, cancelling: false })
    const end = await runOperation('restore', operationId,
      () => api.startRestore({ operationId, backupPath: form.backupPath, manifestSha256: form.info.manifestSha256, parent, name }), follow(operationId), api)
    if (end.end === 'stopped') return
    if (end.end === 'refused') setView({ step: 'form', ...form, notice: end.reason })
    else if (end.end === 'uncertain') setView({ step: 'uncertain', what: 'restore', path: joinPath(parent, name) })
    else if (end.result.status === 'nameTaken') setView({ step: 'form', ...form, notice: 'nameTaken' })
    else setView({ step: 'finished', result: end.result })
  }

  const cancel = () => {
    if ((view.step !== 'checking' && view.step !== 'restoring') || !view.running || view.cancelling) return
    const { operationId } = view
    const mark = (cancelling: boolean) => setView(v => ((v.step === 'checking' || v.step === 'restoring') && v.operationId === operationId ? { ...v, cancelling } : v))
    mark(true)
    void api.cancel(operationId).then(accepted => { if (accepted !== true && mounted.current) mark(false) })
  }

  // Awaits the real switch; a refusal keeps the result and its path on screen.
  const openRestored = (folder: string, label: string) => {
    setOpening('opening')
    openWorkspace(folder, label).then(
      () => { if (mounted.current) onClose() },
      error => {
        console.warn('[restore] The restored workspace did not open:', error)
        if (mounted.current) setOpening('failed')
      },
    )
  }

  const restored = view.step === 'finished' && view.result.status === 'restored' ? view.result : null
  const working = view.step === 'checking' || view.step === 'restoring' ? view : null

  return (
    <Dialog open onOpenChange={next => { if (!next && settled) onClose() }}>
      <DialogContent className="ll-backup-dialog" data-testid="restore-dialog" data-step={view.step} data-backup-dialog=""
        showCloseButton={settled}
        onEscapeKeyDown={event => { if (!settled) event.preventDefault() }}
        onInteractOutside={event => { if (!settled) event.preventDefault() }}>
        <DialogHeader>
          <DialogTitle className="ll-backup-title"><ArrowCounterClockwise aria-hidden="true" />{t('leadinglight.restore.title')}</DialogTitle>
          <DialogDescription>{t('leadinglight.restore.description')}</DialogDescription>
        </DialogHeader>
        <RestoreBody t={t} locale={locale} view={view} onName={name => setView(v => (v.step === 'form' ? { ...v, name, notice: null } : v))} />
        {restored && opening === 'failed' && <p className="ll-backup-result" role="alert" data-testid="restore-open-failed">{t('leadinglight.restore.openFailed', { path: restored.folder })}</p>}
        <DialogFooter>
          {view.step === 'intro' && <Button data-testid="restore-choose" onClick={() => { void check() }}>{t('leadinglight.restore.choose')}</Button>}
          {view.step === 'form' && (
            <Button data-testid="restore-start" disabled={view.name.trim() === ''} onClick={() => { void restore(view) }}>{t('leadinglight.restore.chooseLocation')}</Button>
          )}
          {working && (
            <Button variant="outline" data-testid="restore-cancel" disabled={!working.running || working.cancelling || working.running.cancelRequested} onClick={cancel}>
              {t(working.cancelling || working.running?.cancelRequested ? 'leadinglight.backup.cancelling' : 'leadinglight.backup.cancel')}
            </Button>
          )}
          {restored && (
            <Button data-testid="restore-open" disabled={opening === 'opening'} onClick={() => openRestored(restored.folder, restored.folderName)}>
              {t(opening === 'opening' ? 'leadinglight.restore.opening' : 'leadinglight.restore.open')}
            </Button>
          )}
          {settled && view.step !== 'intro' && view.step !== 'form' && !restored && (
            <Button variant="outline" data-testid="restore-again" onClick={() => setView({ step: 'intro' })}>{t('leadinglight.backup.again')}</Button>
          )}
          {settled && view.step !== 'intro' && (
            <Button variant={restored ? 'outline' : 'default'} data-testid="restore-done" onClick={onClose}>{t(restored ? 'leadinglight.backup.done' : 'leadinglight.backup.close')}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function noticeText(t: T, notice: Notice): string {
  return notice === 'nameTaken' ? t(NAME_TAKEN) : t(REFUSAL_KEYS[notice])
}

function Summary({ t, locale, info }: { t: T; locale: AppLocale; info: Inspected }) {
  return (
    <div className="ll-backup-text" data-testid="restore-summary">
      <p>{t('leadinglight.restore.summary.workspace', { name: info.workspaceName })}</p>
      <p>{t('leadinglight.restore.summary.date', { date: backedUpWhen(locale, info.createdAt) })}</p>
      <p>{t('leadinglight.restore.summary.files', { count: formatCount(locale, info.files), size: formatBytes(locale, info.bytes) })}</p>
      <p>{info.backupStatus === 'complete' ? t('leadinglight.restore.summary.checked') : t('leadinglight.restore.summary.gaps', { count: formatCount(locale, info.gaps) })}</p>
      {info.extraFiles > 0 && <p>{t('leadinglight.restore.summary.extra', { count: formatCount(locale, info.extraFiles) })}</p>}
      <p>{t('leadinglight.restore.summary.trash')}</p>
    </div>
  )
}

function RestoreForm({ t, locale, form, disabled, onName }: { t: T; locale: AppLocale; form: Form; disabled: boolean; onName: (name: string) => void }) {
  const id = useId()
  return (
    <>
      <Summary t={t} locale={locale} info={form.info} />
      <PathLine t={t} label={t('leadinglight.restore.backupAt')} path={form.backupPath} testId="restore-backup-path" />
      <div className="ll-backup-field">
        <label htmlFor={id}>{t('leadinglight.restore.nameLabel')}</label>
        <Input id={id} data-testid="restore-name" value={form.name} disabled={disabled} onChange={event => onName(event.target.value)} />
      </div>
      {form.notice && <p className="ll-backup-result" role="alert" data-testid="restore-notice" data-notice={form.notice}>{noticeText(t, form.notice)}</p>}
    </>
  )
}

function RestoreBody({ t, locale, view, onName }: { t: T; locale: AppLocale; view: View; onName: (name: string) => void }) {
  switch (view.step) {
    case 'intro':
      return (
        <div className="ll-backup-text" data-testid="restore-intro">
          <p>{t('leadinglight.restore.intro.how')}</p>
          <p>{t('leadinglight.restore.intro.safe')}</p>
        </div>
      )
    case 'choosing':
      return <Working testId="restore-status" lines={[t('leadinglight.restore.choosing')]} />
    case 'checking':
      return (
        <>
          <Working testId="restore-status" lines={[t('leadinglight.restore.checking'), ...(view.running ? progressLines(t, locale, view.running.phase, view.running.progress) : [])]} />
          <PathLine t={t} label={t('leadinglight.restore.backupAt')} path={view.backupPath} testId="restore-backup-path" />
        </>
      )
    case 'checkFailed':
      return (
        <>
          <ResultView t={t} copy={inspectFailureCopy(t, locale, view.result)} pathLabel="" testId="restore-check" />
          <PathLine t={t} label={t('leadinglight.restore.backupAt')} path={view.backupPath} testId="restore-backup-path" />
        </>
      )
    case 'form':
    case 'choosingParent':
      return <RestoreForm t={t} locale={locale} form={view} disabled={view.step === 'choosingParent'} onName={onName} />
    case 'restoring':
      return (
        <>
          <Working testId="restore-status" lines={[t('leadinglight.restore.restoring'), ...progressLines(t, locale, view.running?.phase ?? null, view.running?.progress ?? null)]} />
          <PathLine t={t} label={t('leadinglight.restore.target')} path={view.target} testId="restore-target" />
        </>
      )
    case 'finished':
      return <ResultView t={t} copy={restoreResultCopy(t, locale, view.result)} testId="restore-result"
        pathLabel={t(view.result.status === 'restored' ? 'leadinglight.restore.restoredTo' : 'leadinglight.backup.leftoverAt')} />
    case 'refused':
      return (
        <div className="ll-backup-result" role="alert" data-testid="restore-refused" data-reason={view.reason}>
          <p>{t(REFUSAL_KEYS[view.reason])}</p>
          <p>{t('leadinglight.restore.nothingChanged')}</p>
        </div>
      )
    case 'uncertain':
      return (
        <>
          <div className="ll-backup-result" role="alert" data-testid="restore-uncertain">
            <p className="ll-backup-result-title">{t('leadinglight.restore.uncertainTitle')}</p>
            <p>{t(view.what === 'check' ? 'leadinglight.restore.uncertainCheck' : 'leadinglight.restore.uncertain')}</p>
          </div>
          <PathLine t={t} label={t(view.what === 'check' ? 'leadinglight.restore.backupAt' : 'leadinglight.restore.target')} path={view.path} testId="restore-uncertain-path" />
        </>
      )
  }
}
