import { useMemo, useState } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy } from '@phosphor-icons/react'
import { Button } from '../../components/ui/button'
import type { T } from '../extensions/extensionUiText'
import type { AskLabels } from './askLabels'

const noUrl = () => ''

/**
 * A model's answer, read only. Its Markdown is untrusted, so it is shown the way the app's other
 * passive previews show page text (the same renderer and the same rules): raw HTML stays literal
 * text, links are plain text, images are a placeholder, no URL survives and nothing is fetched,
 * navigated or embedded. Copy takes the exact answer, never the rendered page.
 */
export function AdaptAnswer({ t, answer, ask, copyText }: {
  t: T
  answer: string
  /** The host's Ask words; without them Copy is not offered. */
  ask: AskLabels | null
  copyText: (text: string) => Promise<void>
}) {
  const [view, setView] = useState<'formatted' | 'source'>('formatted')
  const [copy, setCopy] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')
  const components = useMemo<Components>(() => ({
    a: ({ children }) => <span className="ll-adapt-answer-link">{children}</span>,
    img: ({ alt }) => <span className="ll-adapt-answer-image">{t('leadinglight.templates.image', { alt: alt ?? '' })}</span>,
    input: ({ checked }) => <span aria-hidden="true">{checked ? '☑ ' : '☐ '}</span>,
  }), [t])
  const copyAnswer = async () => {
    setCopy('copying')
    try {
      await copyText(answer)
      setCopy('copied')
    } catch {
      // Nothing is lost: the exact text stays here, shown as Markdown so it can be selected.
      setCopy('failed')
      setView('source')
    }
  }
  return (
    <div className="ll-adapt-answer" data-testid="adapt-answer">
      <div className="ll-adapt-answer-bar">
        <div role="group" aria-label={t('leadinglight.adapt.answer')} className="ll-adapt-answer-views">
          <Button variant={view === 'formatted' ? 'secondary' : 'ghost'} size="sm" aria-pressed={view === 'formatted'}
            data-testid="adapt-answer-formatted-view" onClick={() => setView('formatted')}>{t('leadinglight.templates.formatted')}</Button>
          <Button variant={view === 'source' ? 'secondary' : 'ghost'} size="sm" aria-pressed={view === 'source'}
            data-testid="adapt-answer-source-view" onClick={() => setView('source')}>{t('leadinglight.templates.markdown')}</Button>
        </div>
        {ask && <Button variant="outline" size="sm" data-testid="adapt-answer-copy" disabled={copy === 'copying'} onClick={() => { void copyAnswer() }}>
          <Copy aria-hidden="true" />{ask.copy}
        </Button>}
      </div>
      {view === 'source'
        // The exact answer as React text: never parsed, never markup.
        ? <pre className="ll-adapt-answer-source" data-testid="adapt-answer-source">{answer}</pre>
        : <div className="ll-adapt-answer-formatted" data-testid="adapt-answer-formatted">
          <Markdown remarkPlugins={[remarkGfm]} components={components} urlTransform={noUrl}>{answer}</Markdown>
        </div>}
      {ask && copy === 'copied' && <p className="ll-ext-quiet" role="status" data-testid="adapt-answer-copied">{ask.copied}</p>}
      {ask && copy === 'failed' && <p className="ll-ext-notice" role="alert" data-testid="adapt-answer-copy-failed">{ask.copyFailed}</p>}
    </div>
  )
}
