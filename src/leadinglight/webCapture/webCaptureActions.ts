import type { CommandAction } from '../../hooks/commands/types'
import { translate, type AppLocale } from '../../lib/i18n'

/** One palette entry while a website command can run; several website commands open the chooser. */
export function buildWebCaptureCommands(locale: AppLocale, open: () => void): CommandAction[] {
  return [{ id: 'save-from-website', label: translate(locale, 'leadinglight.webCapture.action'), group: 'Note', enabled: true,
    keywords: ['website', 'web page', 'url', 'link', 'article', 'clip', 'save'], execute: open }]
}
