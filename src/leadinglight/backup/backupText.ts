import type { AppLocale, TranslationKey, TranslationValues } from '../../lib/i18n'
import {
  BACKUP_LIMITS, type BackupFailure, type BackupResult, type GapReason, type InspectResult, type Phase, type Problem,
  type Progress, type RestoreFailure, type RestoreResult, type StartRefusal, type Summary,
} from './backupContract'

export type T = (key: TranslationKey, values?: TranslationValues) => string

/** Reasons the dialog itself refuses before anything is copied. */
export type LocalRefusal = 'draft' | 'unsaved' | 'held' | 'changed' | 'picker' | 'stopped'
export type Refusal = StartRefusal | LocalRefusal

export const REFUSAL_KEYS: Record<Refusal, TranslationKey> = {
  busy: 'leadinglight.backup.refused.busy',
  operationMismatch: 'leadinglight.backup.refused.operationMismatch',
  notWorkspace: 'leadinglight.backup.refused.notWorkspace',
  destinationMissing: 'leadinglight.backup.refused.folderMissing',
  destinationNotFolder: 'leadinglight.backup.refused.notFolder',
  destinationInWorkspace: 'leadinglight.backup.refused.inWorkspace',
  backupMissing: 'leadinglight.backup.refused.backupMissing',
  backupNotFolder: 'leadinglight.backup.refused.notFolder',
  parentMissing: 'leadinglight.backup.refused.folderMissing',
  parentNotFolder: 'leadinglight.backup.refused.notFolder',
  parentInWorkspace: 'leadinglight.backup.refused.inWorkspace',
  parentInBackup: 'leadinglight.backup.refused.inBackup',
  nameInvalid: 'leadinglight.backup.refused.nameInvalid',
  unavailable: 'leadinglight.backup.refused.unavailable',
  draft: 'leadinglight.backup.refused.draft',
  unsaved: 'leadinglight.backup.refused.unsaved',
  held: 'leadinglight.backup.refused.held',
  changed: 'leadinglight.backup.refused.changed',
  picker: 'leadinglight.backup.refused.picker',
  stopped: 'leadinglight.backup.refused.stopped',
}

const GAP_KEYS: Record<GapReason, TranslationKey> = {
  unreadable: 'leadinglight.backup.gap.unreadable',
  changing: 'leadinglight.backup.gap.changing',
  missing: 'leadinglight.backup.gap.missing',
  link: 'leadinglight.backup.gap.link',
  special: 'leadinglight.backup.gap.special',
  notText: 'leadinglight.backup.gap.notText',
  tooLong: 'leadinglight.backup.gap.tooLong',
  tooDeep: 'leadinglight.backup.gap.tooDeep',
}

const PROBLEM_KEYS: Record<Problem, TranslationKey> = {
  manifestMissing: 'leadinglight.restore.problem.manifestMissing',
  manifestTooLarge: 'leadinglight.restore.problem.manifestTooLarge',
  manifestInvalid: 'leadinglight.restore.problem.manifestInvalid',
  unsupportedVersion: 'leadinglight.restore.problem.unsupportedVersion',
  badPath: 'leadinglight.restore.problem.badPath',
  duplicatePath: 'leadinglight.restore.problem.duplicatePath',
  pathConflict: 'leadinglight.restore.problem.pathConflict',
  missing: 'leadinglight.restore.problem.missing',
  notRegularFile: 'leadinglight.restore.problem.notRegularFile',
  sizeMismatch: 'leadinglight.restore.problem.sizeMismatch',
  hashMismatch: 'leadinglight.restore.problem.hashMismatch',
  unreadable: 'leadinglight.restore.problem.unreadable',
  tooLarge: 'leadinglight.restore.problem.tooLarge',
}

const BACKUP_FAILURE_KEYS: Record<BackupFailure, TranslationKey> = {
  tooLarge: 'leadinglight.backup.failure.tooLarge',
  manifestTooLarge: 'leadinglight.backup.failure.manifestTooLarge',
  noSpace: 'leadinglight.backup.failure.noSpace',
  destinationNotWritable: 'leadinglight.backup.failure.notWritable',
  destinationChanged: 'leadinglight.backup.failure.changed',
  checkFailed: 'leadinglight.backup.failure.checkFailed',
  io: 'leadinglight.backup.failure.io',
  internal: 'leadinglight.backup.failure.io',
}

const RESTORE_FAILURE_KEYS: Record<RestoreFailure, TranslationKey> = {
  noSpace: 'leadinglight.backup.failure.noSpace',
  parentNotWritable: 'leadinglight.backup.failure.notWritable',
  destinationChanged: 'leadinglight.backup.failure.changed',
  checkFailed: 'leadinglight.backup.failure.checkFailed',
  io: 'leadinglight.backup.failure.io',
  internal: 'leadinglight.backup.failure.io',
}

const PHASE_KEYS: Record<Phase, TranslationKey> = {
  counting: 'leadinglight.backup.phase.counting',
  copying: 'leadinglight.backup.phase.copying',
  checking: 'leadinglight.backup.phase.checking',
  finishing: 'leadinglight.backup.phase.finishing',
}

const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const

export function formatBytes(locale: AppLocale, bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) { value /= 1024; unit += 1 }
  return new Intl.NumberFormat(locale, { style: 'unit', unit: UNITS[unit], unitDisplay: unit === 0 ? 'long' : 'short', maximumFractionDigits: 1 }).format(value)
}

export const formatCount = (locale: AppLocale, count: number) => new Intl.NumberFormat(locale).format(count)

export function progressLines(t: T, locale: AppLocale, phase: Phase | null, progress: Progress | null): string[] {
  const lines = [t(phase ? PHASE_KEYS[phase] : 'leadinglight.backup.phase.starting')]
  if (progress) {
    const done = formatCount(locale, progress.files)
    lines.push(progress.totalFiles === null ? t('leadinglight.backup.progress.count', { done })
      : t('leadinglight.backup.progress.of', { done, total: formatCount(locale, progress.totalFiles) }))
  }
  return lines
}

/** Counts per reason, then the sampled paths; never claims a count beyond the total it was given. */
export function summaryLines<R extends string>(t: T, locale: AppLocale, summary: Summary<R>, keys: Record<R, TranslationKey>): string[] {
  const lines: string[] = []
  for (const [reason, count] of Object.entries(summary.counts) as [R, number][]) {
    lines.push(t('leadinglight.backup.summary.count', { label: t(keys[reason]), count: formatCount(locale, count) }))
  }
  for (const item of summary.sample) {
    lines.push(item.path === null ? t(keys[item.reason]) : t('leadinglight.backup.summary.sample', { path: item.path, label: t(keys[item.reason]) }))
  }
  const more = summary.total - summary.sample.length
  if (summary.sample.length > 0 && more > 0) lines.push(t('leadinglight.backup.summary.more', { count: formatCount(locale, more) }))
  return lines
}

export const gapLines = (t: T, locale: AppLocale, gaps: Summary<GapReason>) => summaryLines(t, locale, gaps, GAP_KEYS)
export const problemLines = (t: T, locale: AppLocale, problems: Summary<Problem>) => summaryLines(t, locale, problems, PROBLEM_KEYS)

/** Trash is never in a backup, so every intro and result says so; a capped count is only a lower bound. */
export function trashLine(t: T, locale: AppLocale, count: number): string {
  if (count === 0) return t('leadinglight.backup.trash.none')
  const shown = formatCount(locale, count)
  return count >= BACKUP_LIMITS.trashItemsCounted ? t('leadinglight.backup.trash.atLeast', { count: shown }) : t('leadinglight.backup.trash.count', { count: shown })
}

export interface ResultCopy {
  title: string
  lines: string[]
  /** Lines that need to stand out: gaps, problems and anything left behind. */
  details: string[]
  /** Where the user can look: the new folder, or what was left. */
  path: string | null
}

const leftoverLines = (t: T, leftover: string | null, unfinished: TranslationKey, nothing: TranslationKey) =>
  leftover === null ? [t(nothing)] : [t(unfinished, { path: leftover })]

export function backupResultCopy(t: T, locale: AppLocale, result: BackupResult): ResultCopy {
  switch (result.status) {
    case 'complete':
    case 'incomplete': {
      const lines = [t('leadinglight.backup.result.copied', { count: formatCount(locale, result.files), size: formatBytes(locale, result.bytes) })]
      if (result.versionsSkipped > 0) lines.push(t('leadinglight.backup.result.versionsSkipped', { count: formatCount(locale, result.versionsSkipped) }))
      lines.push(trashLine(t, locale, result.trashItemsNotIncluded))
      if (!result.durable) lines.push(t('leadinglight.backup.result.notDurable'))
      const details = result.status === 'incomplete'
        ? [t('leadinglight.backup.result.gaps', { count: formatCount(locale, result.gaps.total) }), ...gapLines(t, locale, result.gaps)]
        : []
      return { title: t(`leadinglight.backup.result.${result.status}`), lines, details, path: result.folder }
    }
    case 'cancelled':
      return { title: t('leadinglight.backup.result.cancelled'), lines: [t('leadinglight.backup.result.noBackup')],
        details: result.leftover === null ? [] : [t('leadinglight.backup.result.leftover', { path: result.leftover })], path: result.leftover }
    case 'failed':
      return {
        title: t('leadinglight.backup.result.failed'),
        lines: [t(BACKUP_FAILURE_KEYS[result.reason]), t('leadinglight.backup.result.noBackup')],
        details: [
          ...(result.path === null ? [] : [t('leadinglight.backup.result.at', { path: result.path })]),
          ...(result.leftover === null ? [] : [t('leadinglight.backup.result.leftover', { path: result.leftover })]),
        ],
        path: result.leftover,
      }
  }
}

/** For an inspection that cannot lead to a restore. */
export function inspectFailureCopy(t: T, locale: AppLocale, result: Exclude<InspectResult, { status: 'ok' }>): ResultCopy {
  switch (result.status) {
    case 'notBackup': return { title: t('leadinglight.restore.check.notBackupTitle'), lines: [t('leadinglight.restore.check.notBackup')], details: [], path: null }
    case 'damaged': return { title: t('leadinglight.restore.check.damagedTitle'), lines: [t('leadinglight.restore.check.damaged')], details: problemLines(t, locale, result.problems), path: null }
    case 'cancelled': return { title: t('leadinglight.restore.check.cancelled'), lines: [t('leadinglight.restore.check.cancelledBody')], details: [], path: null }
    case 'failed': return { title: t('leadinglight.restore.check.failedTitle'), lines: [t(BACKUP_FAILURE_KEYS[result.reason])], details: [], path: null }
  }
}

/** For every restore answer except `nameTaken`, which returns to the form. */
export function restoreResultCopy(t: T, locale: AppLocale, result: Exclude<RestoreResult, { status: 'nameTaken' }>): ResultCopy {
  const left = (leftover: string | null) => leftoverLines(t, leftover, 'leadinglight.restore.result.leftover', 'leadinglight.restore.result.noWorkspace')
  switch (result.status) {
    case 'restored': {
      const lines = [t('leadinglight.restore.result.copied', { count: formatCount(locale, result.files), size: formatBytes(locale, result.bytes) })]
      if (!result.timesKept) lines.push(t('leadinglight.restore.result.timesNotKept'))
      if (!result.durable) lines.push(t('leadinglight.restore.result.notDurable'))
      return { title: t('leadinglight.restore.result.restored'), lines, details: [], path: result.folder }
    }
    case 'backupChanged':
      return { title: t('leadinglight.restore.result.failed'), lines: [t('leadinglight.restore.result.backupChanged'), ...left(result.leftover)],
        details: problemLines(t, locale, result.problems), path: result.leftover }
    case 'damaged':
      return { title: t('leadinglight.restore.check.damagedTitle'), lines: [t('leadinglight.restore.check.damaged'), t('leadinglight.restore.result.noWorkspace')],
        details: problemLines(t, locale, result.problems), path: null }
    case 'cancelled':
      return { title: t('leadinglight.restore.result.cancelled'), lines: left(result.leftover), details: [], path: result.leftover }
    case 'failed':
      return {
        title: t('leadinglight.restore.result.failed'),
        lines: [t(RESTORE_FAILURE_KEYS[result.reason]), ...left(result.leftover)],
        details: result.path === null ? [] : [t('leadinglight.backup.result.at', { path: result.path })],
        path: result.leftover,
      }
  }
}
