import { translate, type AppLocale, type TranslationKey } from '../../lib/i18n'
import type { TemplateFailure } from './templateContract'

const FAILURES: Record<TemplateFailure, TranslationKey> = {
  busy: 'leadinglight.templates.failure.busy', stale: 'leadinglight.templates.failure.stale',
  missing: 'leadinglight.templates.failure.missing', invalidSource: 'leadinglight.templates.failure.invalidSource',
  empty: 'leadinglight.templates.failure.empty', saveHeld: 'leadinglight.templates.failure.saveHeld',
  readFailed: 'leadinglight.templates.failure.readFailed', writeFailed: 'leadinglight.templates.failure.writeFailed',
  collision: 'leadinglight.templates.failure.collision', unconfirmed: 'leadinglight.templates.failure.unconfirmed',
}

export const templateFailureText = (locale: AppLocale, reason: TemplateFailure) => translate(locale, FAILURES[reason])

export function templateRelativePath(vaultPath: string, path: string): string {
  const root = vaultPath.replace(/\/+$/, '')
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}
