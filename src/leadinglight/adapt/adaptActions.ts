import type { CommandAction } from '../../hooks/commands/types'
import { translate, type AppLocale } from '../../lib/i18n'

/** One palette entry; it opens the Adapt dialog and sends nothing by itself. */
export function buildAdaptCommands(locale: AppLocale, open: () => void): CommandAction[] {
  return [{ id: 'adapt-leadinglight', label: translate(locale, 'leadinglight.adapt.menu'), group: 'Note', enabled: true,
    keywords: ['adapt', 'extension', 'ask', 'codex', 'customize', 'workflow'], execute: open }]
}
