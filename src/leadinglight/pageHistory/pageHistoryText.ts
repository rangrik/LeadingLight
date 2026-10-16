import type { AppLocale, TranslationKey } from '../../lib/i18n'
import type { HistoryReason, VersionReason } from './pageHistoryApi'

export const REASON_KEYS: Record<VersionReason, TranslationKey> = {
  firstSave: 'leadinglight.history.reason.firstSave',
  sessionStart: 'leadinglight.history.reason.sessionStart',
  changedElsewhere: 'leadinglight.history.reason.changedElsewhere',
  bigChange: 'leadinglight.history.reason.bigChange',
  checkpoint: 'leadinglight.history.reason.checkpoint',
}

export const WARNING_KEYS: Record<HistoryReason, TranslationKey> = {
  tooLarge: 'leadinglight.history.warning.tooLarge',
  full: 'leadinglight.history.warning.full',
  lowSpace: 'leadinglight.history.warning.lowSpace',
  busy: 'leadinglight.history.warning.busy',
  unavailable: 'leadinglight.history.warning.unavailable',
}

export const formatSize = (locale: AppLocale, bytes: number) => bytes < 1024
  ? new Intl.NumberFormat(locale, { style: 'unit', unit: 'byte', unitDisplay: 'long' }).format(bytes)
  : new Intl.NumberFormat(locale, { style: 'unit', unit: 'kilobyte', maximumFractionDigits: 1 }).format(bytes / 1024)

export const formatWhen = (locale: AppLocale, ms: number) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms))

const trimEnd = (path: string) => path.replace(/\/+$/u, '')

/** Native names saved locations by full path and the browser bridge by vault path; both read the same here. */
export function absoluteIn(vaultPath: string, path: string): string {
  return path.startsWith('/') ? path : `${trimEnd(vaultPath)}/${path.replace(/^\/+/u, '')}`
}

export function vaultRelative(vaultPath: string, path: string): string {
  const root = `${trimEnd(vaultPath)}/`
  return path.startsWith(root) ? path.slice(root.length) : path
}

export const parentFolder = (path: string) => trimEnd(path).replace(/\/[^/]*$/u, '')
