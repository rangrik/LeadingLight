import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Archive } from '@phosphor-icons/react'
import { Button } from '../../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { translate, type AppLocale } from '../../lib/i18n'
import { pickFolder } from '../../utils/vault-dialog'
import { CaptureHeldError } from '../pendingCapture'
import { backupApi, type BackupApi } from './backupApi'
import type { BackupResult } from './backupContract'
import { PathLine, ResultView, Working } from './backupParts'
import { REFUSAL_KEYS, backupResultCopy, progressLines, type Refusal, type T } from './backupText'
import { runOperation, type Running } from './runOperation'
import './backup.css'

/** What the backup needs from the app; all of it is the existing close barrier and its holds. */
export interface WorkspaceGuard {
  /** Holds input and every page change until released; throws while a draft holds words. */
  begin: () => () => void
  /** The close barrier: settles running changes, saves both panes and every waiting page, or throws. */
  saveAll: () => Promise<void>
  /** A page still has a held or retriable save. */
  unresolvedSaves: () => boolean
  /** The window is closing or switching workspaces. */
  busy: () => boolean
}

export interface BackupDialogProps {
  locale: AppLocale
  vaultPath: string
  guard: WorkspaceGuard
  onClose: () => void
  api?: BackupApi
  pick?: (title: string) => Promise<string | null>
}

type View =
  | { step: 'intro' }
  | { step: 'choosing' }
  | { step: 'saving'; destination: string }
  | { step: 'running'; destination: string; operationId: string; running: Running | null; cancelling: boolean }
  | { step: 'refused'; reason: Refusal; destination: string | null }
  | { step: 'finished'; destination: string; result: BackupResult }
  | { step: 'uncertain'; destination: string }

interface Attempt { stopped: boolean; release: () => void }

const SETTLED: ReadonlySet<View['step']> = new Set(['intro', 'refused', 'finished', 'uncertain'])

/** Mounted per opening, so a new opening never shows an earlier answer. */
export function BackupDialog({ locale, vaultPath, guard, onClose, api = backupApi, pick = pickFolder }: BackupDialogProps) {
  const t: T = (key, values) => translate(locale, key, values)
  const [view, setView] = useState<View>({ step: 'intro' })
  const latest = useRef(guard)
  useLayoutEffect(() => { latest.current = guard })
  // Every change of workspace starts a new session, so A, then B, then A again is still stale.
  const session = useRef({ vaultPath, epoch: 0 })
  useLayoutEffect(() => {
    if (session.current.vaultPath !== vaultPath) session.current = { vaultPath, epoch: session.current.epoch + 1 }
  }, [vaultPath])
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const attempt = useRef<Attempt | null>(null)
  const settled = SETTLED.has(view.step)

  const backUp = async (bound: { vaultPath: string; epoch: number }, current: Attempt) => {
    const live = () => mounted.current && !current.stopped
    const stale = () => session.current.epoch !== bound.epoch || latest.current.busy()
    let picked: string | null
    try {
      picked = await pick(t('leadinglight.backup.pickTitle'))
    } catch (error) {
      console.warn('[backup] The folder picker failed:', error)
      if (live()) setView({ step: 'refused', reason: 'picker', destination: null })
      return
    }
    if (!live()) return
    if (picked === null) { setView({ step: 'intro' }); return }
    const destination = picked
    if (stale()) { setView({ step: 'refused', reason: 'changed', destination }); return }
    setView({ step: 'saving', destination })
    try {
      await latest.current.saveAll()
    } catch (error) {
      if (live()) setView({ step: 'refused', reason: error instanceof CaptureHeldError ? 'draft' : 'unsaved', destination })
      return
    }
    if (!live()) return
    if (latest.current.unresolvedSaves()) { setView({ step: 'refused', reason: 'held', destination }); return }
    if (stale()) { setView({ step: 'refused', reason: 'changed', destination }); return }
    const operationId = crypto.randomUUID()
    setView({ step: 'running', destination, operationId, running: null, cancelling: false })
    const end = await runOperation('backup', operationId, () => api.startBackup({ operationId, vaultPath: bound.vaultPath, destination }), {
      onRunning: running => setView(v => (v.step === 'running' && v.operationId === operationId ? { ...v, running } : v)),
      stopped: () => !mounted.current,
    }, api)
    if (end.end === 'stopped') return
    setView(end.end === 'finished' ? { step: 'finished', destination, result: end.result }
      : end.end === 'refused' ? { step: 'refused', reason: end.reason, destination }
        : { step: 'uncertain', destination })
  }

  const choose = () => {
    if (!settled) return
    const bound = session.current
    let release: () => void
    try {
      // Input and page changes stop now, before the picker or any save runs.
      release = latest.current.begin()
    } catch (error) {
      setView({ step: 'refused', reason: error instanceof CaptureHeldError ? 'draft' : 'unsaved', destination: null })
      return
    }
    const current: Attempt = { stopped: false, release }
    attempt.current = current
    setView({ step: 'choosing' })
    void backUp(bound, current).finally(release)
  }

  // Only before the copy starts; the barrier's own holds stay until it settles.
  const stop = () => {
    const current = attempt.current
    if (view.step !== 'saving' || !current) return
    current.stopped = true
    current.release()
    setView({ step: 'refused', reason: 'stopped', destination: view.destination })
  }

  const cancel = () => {
    if (view.step !== 'running' || !view.running || view.cancelling) return
    const { operationId } = view
    const mark = (cancelling: boolean) => setView(v => (v.step === 'running' && v.operationId === operationId ? { ...v, cancelling } : v))
    mark(true)
    // Not accepted means it already ended or was never seen; the next status answer says which.
    void api.cancel(operationId).then(accepted => { if (accepted !== true && mounted.current) mark(false) })
  }

  const again = () => setView({ step: 'intro' })

  return (
    <Dialog open onOpenChange={next => { if (!next && settled) onClose() }}>
      <DialogContent className="ll-backup-dialog" data-testid="backup-dialog" data-step={view.step} data-backup-dialog=""
        showCloseButton={settled}
        onEscapeKeyDown={event => { if (!settled) event.preventDefault() }}
        onInteractOutside={event => { if (!settled) event.preventDefault() }}>
        <DialogHeader>
          <DialogTitle className="ll-backup-title"><Archive aria-hidden="true" />{t('leadinglight.backup.title')}</DialogTitle>
          <DialogDescription>{t('leadinglight.backup.description')}</DialogDescription>
        </DialogHeader>
        <BackupBody t={t} locale={locale} view={view} />
        <DialogFooter>
          {view.step === 'intro' && <Button data-testid="backup-choose" onClick={choose}>{t('leadinglight.backup.choose')}</Button>}
          {view.step === 'saving' && <Button variant="outline" data-testid="backup-stop" onClick={stop}>{t('leadinglight.backup.stop')}</Button>}
          {view.step === 'running' && (
            <Button variant="outline" data-testid="backup-cancel" disabled={!view.running || view.cancelling || view.running.cancelRequested} onClick={cancel}>
              {t(view.cancelling || view.running?.cancelRequested ? 'leadinglight.backup.cancelling' : 'leadinglight.backup.cancel')}
            </Button>
          )}
          {settled && view.step !== 'intro' && !(view.step === 'finished' && succeeded(view.result)) && (
            <Button variant="outline" data-testid="backup-again" onClick={again}>{t('leadinglight.backup.again')}</Button>
          )}
          {settled && view.step !== 'intro' && (
            <Button data-testid="backup-done" onClick={onClose}>{t(view.step === 'finished' && succeeded(view.result) ? 'leadinglight.backup.done' : 'leadinglight.backup.close')}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const succeeded = (result: BackupResult) => result.status === 'complete' || result.status === 'incomplete'

function BackupBody({ t, locale, view }: { t: T; locale: AppLocale; view: View }) {
  switch (view.step) {
    case 'intro':
      return (
        <div className="ll-backup-text" data-testid="backup-intro">
          <p>{t('leadinglight.backup.intro.copies')}</p>
          <p>{t('leadinglight.backup.intro.excluded')}</p>
          <p>{t('leadinglight.backup.intro.pause')}</p>
          <p>{t('leadinglight.backup.intro.drive')}</p>
        </div>
      )
    case 'choosing':
      return <Working testId="backup-status" lines={[t('leadinglight.backup.choosing')]} />
    case 'saving':
      return (
        <>
          <Working testId="backup-status" lines={[t('leadinglight.backup.saving')]} />
          <PathLine t={t} label={t('leadinglight.backup.destination')} path={view.destination} testId="backup-destination" />
        </>
      )
    case 'running':
      return (
        <>
          <Working testId="backup-status" lines={[...progressLines(t, locale, view.running?.phase ?? null, view.running?.progress ?? null), t('leadinglight.backup.paused')]} />
          <PathLine t={t} label={t('leadinglight.backup.destination')} path={view.destination} testId="backup-destination" />
        </>
      )
    case 'refused':
      return (
        <>
          <div className="ll-backup-result" role="alert" data-testid="backup-refused" data-reason={view.reason}>
            <p>{t(REFUSAL_KEYS[view.reason])}</p>
            <p>{t('leadinglight.backup.nothingCopied')}</p>
          </div>
          {view.destination && <PathLine t={t} label={t('leadinglight.backup.destination')} path={view.destination} testId="backup-destination" />}
        </>
      )
    case 'finished':
      return <ResultView t={t} copy={backupResultCopy(t, locale, view.result)} testId="backup-result"
        pathLabel={t(succeeded(view.result) ? 'leadinglight.backup.savedIn' : 'leadinglight.backup.leftoverAt')} />
    case 'uncertain':
      return (
        <>
          <div className="ll-backup-result" role="alert" data-testid="backup-uncertain">
            <p className="ll-backup-result-title">{t('leadinglight.backup.uncertainTitle')}</p>
            <p>{t('leadinglight.backup.uncertain')}</p>
          </div>
          <PathLine t={t} label={t('leadinglight.backup.destination')} path={view.destination} testId="backup-destination" />
        </>
      )
  }
}
