import { useState } from 'react'
import { MagnifyingGlass, PuzzlePiece } from '@phosphor-icons/react'
import { Button } from '../../components/ui/button'
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import type { AppLocale } from '../../lib/i18n'
import { ExtensionDialogContent } from './ExtensionPreviewDialog'
import type { RunnableCommand } from './extensionSessionController'
import { translator } from './extensionUiText'

const SEARCH_FROM = 7

interface Props {
  locale: AppLocale
  commands: readonly RunnableCommand[]
  onChoose: (key: string) => void
  onClose: () => void
  onCloseAutoFocus?: (event: Event) => void
}

/** Shown only when more than one command can run; every command of every package is its own row. */
export function ExtensionChooserDialog({ locale, commands, onChoose, onClose, onCloseAutoFocus }: Props) {
  const t = translator(locale)
  const [query, setQuery] = useState('')
  const needle = query.trim().toLocaleLowerCase()
  const shown = commands.filter(item => `${item.command.title}\n${item.packageName}`.toLocaleLowerCase().includes(needle))
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <ExtensionDialogContent className="ll-ext-chooser-dialog" data-testid="extension-chooser" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle className="ll-ext-title"><PuzzlePiece aria-hidden="true" />{t('leadinglight.extensions.chooseTitle')}</DialogTitle>
          <DialogDescription>{t('leadinglight.extensions.chooseDescription')}</DialogDescription>
        </DialogHeader>
        {commands.length >= SEARCH_FROM && <div className="ll-ext-search">
          <MagnifyingGlass aria-hidden="true" />
          <Input value={query} aria-label={t('leadinglight.extensions.search')} placeholder={t('leadinglight.extensions.search')} onChange={event => setQuery(event.target.value)} />
        </div>}
        <ul className="ll-ext-choices" aria-label={t('leadinglight.extensions.list')}>
          {shown.map(item => <li key={item.key}>
            <Button variant="ghost" className="ll-ext-choice" data-testid="extension-choice" data-key={item.key} onClick={() => onChoose(item.key)}>
              <span className="ll-ext-choice-text"><span className="ll-ext-choice-title">{item.command.title}</span>
                <span className="ll-ext-choice-detail">{item.packageName}</span></span>
            </Button>
          </li>)}
        </ul>
        {shown.length === 0 && <p className="ll-ext-quiet" role="status">{t('leadinglight.extensions.noMatches')}</p>}
      </ExtensionDialogContent>
    </Dialog>
  )
}
