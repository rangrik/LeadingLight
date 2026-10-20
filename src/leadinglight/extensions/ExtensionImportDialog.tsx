import { useId, useState } from 'react'
import { ClipboardText } from '@phosphor-icons/react'
import { Button } from '../../components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { Textarea } from '../../components/ui/textarea'
import type { AppLocale } from '../../lib/i18n'
import { ExtensionDialogContent } from './ExtensionPreviewDialog'
import type { ImportOutcome } from './extensionSessionController'
import { diagnosticLocation, translator } from './extensionUiText'

type Candidate = Extract<ImportOutcome, { status: 'candidate' }>

interface Props {
  locale: AppLocale
  /** Checks locally, then stores a candidate natively; never turns anything on. */
  check: (text: string) => Promise<ImportOutcome>
  onCandidate: (candidate: Candidate) => void
  onClose: () => void
  onCloseAutoFocus?: (event: Event) => void
}

type Result = Exclude<ImportOutcome, { status: 'candidate' }> | { status: 'empty' }

/** Paste is the only way in for E1: the same in the browser and the desktop app. */
export function ExtensionImportDialog({ locale, check, onCandidate, onClose, onCloseAutoFocus }: Props) {
  const t = translator(locale)
  const fieldId = useId()
  const [text, setText] = useState('')
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const run = async () => {
    if (checking) return
    if (!text.trim()) { setResult({ status: 'empty' }); return }
    setChecking(true)
    try {
      const outcome = await check(text)
      if (outcome.status === 'candidate') onCandidate(outcome)
      else setResult(outcome)
    } finally {
      setChecking(false)
    }
  }
  return (
    <Dialog open onOpenChange={open => { if (!open && !checking) onClose() }}>
      <ExtensionDialogContent className="ll-ext-import-dialog" data-testid="extension-import-dialog" showCloseButton={!checking}
        onCloseAutoFocus={onCloseAutoFocus} onEscapeKeyDown={event => { if (checking) event.preventDefault() }}>
        <DialogHeader>
          <DialogTitle className="ll-ext-title"><ClipboardText aria-hidden="true" />{t('leadinglight.extensions.importTitle')}</DialogTitle>
          <DialogDescription>{t('leadinglight.extensions.importDescription')}</DialogDescription>
        </DialogHeader>
        <div className="ll-ext-field">
          <label htmlFor={fieldId}>{t('leadinglight.extensions.importLabel')}</label>
          <Textarea id={fieldId} className="ll-ext-import-text" value={text} spellCheck={false} disabled={checking}
            aria-describedby={result ? `${fieldId}-result` : undefined}
            onChange={event => { setText(event.target.value); setResult(null) }}
            onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.stopPropagation(); void run() } }} />
        </div>
        {result && <div id={`${fieldId}-result`} className="ll-ext-notice" role="alert" data-testid="extension-import-result" data-status={result.status}>
          <ImportResult t={t} result={result} />
        </div>}
        <DialogFooter>
          <Button variant="outline" disabled={checking} onClick={onClose}>{t('leadinglight.extensions.cancel')}</Button>
          <Button data-testid="extension-import-check" disabled={checking} onClick={() => { void run() }}>
            {t(checking ? 'leadinglight.extensions.checking' : 'leadinglight.extensions.check')}</Button>
        </DialogFooter>
      </ExtensionDialogContent>
    </Dialog>
  )
}

function ImportResult({ t, result }: { t: ReturnType<typeof translator>; result: Result }) {
  switch (result.status) {
    case 'empty': return <p>{t('leadinglight.extensions.import.empty')}</p>
    case 'noReply': return <p>{t('leadinglight.extensions.import.noReply')}</p>
    case 'refused': return <p>{t(result.reason === 'reservedId' ? 'leadinglight.extensions.import.reservedId' : 'leadinglight.extensions.import.storageUnavailable')}</p>
    case 'invalid': return <InvalidDetails t={t} result={result} />
  }
}

/** The first problem in plain words with the validator's own location; the rest behind Details. */
function InvalidDetails({ t, result }: { t: ReturnType<typeof translator>; result: Extract<Result, { status: 'invalid' }> }) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const [first] = result.diagnostics
  return <>
    <p>{t('leadinglight.extensions.invalid', { message: first?.message ?? '' })}</p>
    {first && <p className="ll-ext-quiet"><code>{diagnosticLocation(t, first.path)}</code></p>}
    <Button variant="ghost" size="sm" className="ll-ext-disclosure" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(value => !value)}>
      {t('leadinglight.extensions.details')}
    </Button>
    {open && <div id={listId} className="ll-ext-details" data-testid="extension-import-details">
      <ul>{result.diagnostics.map((item, index) => <li key={`${index}:${item.path}`}><code>{item.code}</code> <code>{item.path || '/'}</code> {item.message}</li>)}</ul>
      {result.truncated && <p className="ll-ext-quiet">{t('leadinglight.extensions.moreProblems')}</p>}
    </div>}
  </>
}
