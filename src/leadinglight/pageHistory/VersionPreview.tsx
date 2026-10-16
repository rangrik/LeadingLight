import { useMemo, useState } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '../../components/ui/button'
import { ScrollArea } from '../../components/ui/scroll-area'
import { translate, type AppLocale, type TranslationKey, type TranslationValues } from '../../lib/i18n'
import type { VersionPreview as Preview } from './pageHistoryApi'
import { formatSize } from './pageHistoryText'

type ShownPreview = Extract<Preview, { status: 'ok' }>
const FRONTMATTER = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/

/** Notes about what is shown, so a cut or unusual file is never mistaken for the whole page. */
function previewNotes(preview: ShownPreview, locale: AppLocale): string[] {
  const t = (key: TranslationKey, values?: TranslationValues) => translate(locale, key, values)
  return [
    preview.truncated && t('leadinglight.history.preview.truncated', { shown: formatSize(locale, preview.shownBytes), total: formatSize(locale, preview.length) }),
    preview.bom && t('leadinglight.history.preview.bom'),
    preview.crlf && t('leadinglight.history.preview.crlf'),
  ].filter((note): note is string => Boolean(note))
}

/** A verified version, shown passively: nothing in it can fetch, navigate, embed or be edited. */
export function VersionPreview({ preview, locale }: { preview: ShownPreview; locale: AppLocale }) {
  const t = (key: TranslationKey, values?: TranslationValues) => translate(locale, key, values)
  const [view, setView] = useState<'formatted' | 'source'>('formatted')
  const components = useMemo<Components>(() => ({
    a: ({ children }) => <span className="ll-history-link">{children}</span>,
    img: ({ alt }) => <span className="ll-history-image">{translate(locale, 'leadinglight.history.preview.image', { alt: alt ?? '' })}</span>,
  }), [locale])
  const notes = previewNotes(preview, locale)
  if (preview.text === null) {
    return <p className="ll-history-quiet" data-testid="page-history-preview-binary">{t('leadinglight.history.preview.notText')}</p>
  }
  return (
    <div className="ll-history-preview" data-testid="page-history-preview">
      <div className="ll-history-preview-bar" role="group" aria-label={t('leadinglight.history.preview.view')}>
        <Button variant={view === 'formatted' ? 'secondary' : 'ghost'} size="sm" aria-pressed={view === 'formatted'}
          data-testid="page-history-view-formatted" onClick={() => setView('formatted')}>{t('leadinglight.history.preview.formatted')}</Button>
        <Button variant={view === 'source' ? 'secondary' : 'ghost'} size="sm" aria-pressed={view === 'source'}
          data-testid="page-history-view-source" onClick={() => setView('source')}>{t('leadinglight.history.preview.source')}</Button>
      </div>
      {notes.length > 0 && <div className="ll-history-notes" data-testid="page-history-preview-notes">{notes.map(note => <p key={note}>{note}</p>)}</div>}
      <ScrollArea className="ll-history-preview-scroll">
        {view === 'source'
          // The exact decoded text, as React text: never parsed, never markup.
          ? <pre className="ll-history-source" data-testid="page-history-preview-source">{preview.text}</pre>
          : <div className="ll-history-rendered" data-testid="page-history-preview-formatted">
            <Markdown remarkPlugins={[remarkGfm]} skipHtml components={components} urlTransform={() => ''}>
              {preview.text.replace(FRONTMATTER, '')}
            </Markdown>
          </div>}
      </ScrollArea>
    </div>
  )
}
