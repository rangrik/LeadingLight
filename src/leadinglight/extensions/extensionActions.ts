import type { CommandAction } from '../../hooks/commands/types'
import { translate, type AppLocale } from '../../lib/i18n'

/** One palette entry while at least one extension command can run; the chooser handles several. */
export function buildExtensionCommands(locale: AppLocale, open: () => void): CommandAction[] {
  return [{ id: 'new-page-from-extension', label: translate(locale, 'leadinglight.extensions.action'), group: 'Note', enabled: true,
    keywords: ['extension', 'workflow', 'form', 'new page'], execute: open }]
}
