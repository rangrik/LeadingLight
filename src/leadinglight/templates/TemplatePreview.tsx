import { useMemo, useState } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '../../components/ui/button'
import { ScrollArea } from '../../components/ui/scroll-area'
import { translate, type AppLocale } from '../../lib/i18n'

const FRONTMATTER = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/

/** Proposed page bytes, rendered without navigation, embedded content or resource access. */
export function TemplatePreview({ content, locale }: { content: string; locale: AppLocale }) {
  const [source, setSource] = useState(false)
  const components = useMemo<Components>(() => ({
    a: ({ children }) => <span className="ll-template-link">{children}</span>,
    img: ({ alt }) => <span className="ll-template-image">{translate(locale, 'leadinglight.templates.image', { alt: alt ?? '' })}</span>,
    input: ({ checked }) => <span aria-hidden="true">{checked ? '☑ ' : '☐ '}</span>,
  }), [locale])
  return (
    <div className="ll-template-preview" data-testid="template-preview">
      <div className="ll-template-preview-tabs" role="group" aria-label={translate(locale, 'leadinglight.templates.preview')}>
        <Button variant={source ? 'ghost' : 'secondary'} size="sm" aria-pressed={!source} onClick={() => setSource(false)}>{translate(locale, 'leadinglight.templates.formatted')}</Button>
        <Button variant={source ? 'secondary' : 'ghost'} size="sm" aria-pressed={source} onClick={() => setSource(true)}>{translate(locale, 'leadinglight.templates.markdown')}</Button>
      </div>
      <ScrollArea className="ll-template-preview-scroll">
        {source ? <pre className="ll-template-source" data-testid="template-preview-source">{content}</pre>
          : <div className="ll-template-rendered" data-testid="template-preview-formatted">
            <Markdown remarkPlugins={[remarkGfm]} skipHtml components={components} urlTransform={() => ''}>{content.replace(FRONTMATTER, '')}</Markdown>
          </div>}
      </ScrollArea>
      <p className="ll-template-quiet">{translate(locale, 'leadinglight.templates.passive')}</p>
    </div>
  )
}
