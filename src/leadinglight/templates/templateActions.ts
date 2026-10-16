import type { CommandAction } from '../../hooks/commands/types'
import { translate, type AppLocale } from '../../lib/i18n'

export function buildTemplateCommands(locale: AppLocale, open: () => void): CommandAction[] {
  return [{ id: 'new-page-from-template', label: translate(locale, 'leadinglight.templates.action'), group: 'Note', enabled: true,
    keywords: ['template', 'starting point', 'new page'], execute: open }]
}
