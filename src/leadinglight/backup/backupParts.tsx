import { CircleNotch, FolderOpen } from '@phosphor-icons/react'
import { Button } from '../../components/ui/button'
import { isTauri } from '../../mock-tauri'
import { revealLocalPath } from '../../utils/url'
import type { ResultCopy, T } from './backupText'

/** Reveal only exists in the desktop app; elsewhere the path is shown and can be selected. */
const revealPath = (path: string) => { void revealLocalPath(path).catch(error => console.warn('[backup] Reveal failed:', error)) }

export function PathLine({ t, label, path, testId }: { t: T; label: string; path: string; testId: string }) {
  return (
    <div className="ll-backup-path">
      <p>{label}</p>
      <code data-testid={testId}>{path}</code>
      {isTauri() && (
        <Button variant="ghost" size="sm" onClick={() => revealPath(path)}>
          <FolderOpen aria-hidden="true" />{t('leadinglight.backup.reveal')}
        </Button>
      )}
    </div>
  )
}

export function Working({ lines, testId }: { lines: string[]; testId: string }) {
  return (
    <div className="ll-backup-working" role="status" data-testid={testId}>
      <CircleNotch className="animate-spin" aria-hidden="true" />
      <div>{lines.map((line, index) => <p key={`${index}:${line}`}>{line}</p>)}</div>
    </div>
  )
}

export function ResultView({ t, copy, pathLabel, testId }: { t: T; copy: ResultCopy; pathLabel: string; testId: string }) {
  return (
    <div className="ll-backup-result" role="status" data-testid={testId}>
      <p className="ll-backup-result-title">{copy.title}</p>
      {copy.lines.map((line, index) => <p key={`${index}:${line}`}>{line}</p>)}
      {copy.details.length > 0 && <ul className="ll-backup-details">{copy.details.map((line, index) => <li key={`${index}:${line}`}>{line}</li>)}</ul>}
      {copy.path && <PathLine t={t} label={pathLabel} path={copy.path} testId={`${testId}-path`} />}
    </div>
  )
}
