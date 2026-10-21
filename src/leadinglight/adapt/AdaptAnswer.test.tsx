import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { translator } from '../extensions/extensionUiText'
import { AdaptAnswer } from './AdaptAnswer'
import type { AskLabels } from './askLabels'

const t = translator('en')
const ask: AskLabels = {
  copy: 'Copy', copied: 'Copied.', copyFailed: 'Couldn’t copy the answer.', attachPassage: 'Selected passage',
  attachAnotherPage: 'Another page…', noSelection: 'Select a passage first.', passageFrom: title => `Passage from ${title}`,
}

// A model's answer that tries everything a page preview must never do.
const HOSTILE = [
  '# Why it matters',
  '',
  'Some **bold** words and a [link](https://evil.example/x "go") and <https://evil.example/auto> and www.evil.example.',
  '',
  '![tracking pixel](https://evil.example/pixel.png)',
  '',
  '<script>alert(1)</script>',
  '',
  '<img src="https://evil.example/raw.png" onerror="steal()"><iframe src="https://evil.example/frame"></iframe>',
  '',
  'Inline <a href="https://evil.example/inline">anchor</a> and <b>bold</b>.',
  '',
  '[[Private page]] and $x^2$ and <!-- leadinglight:capture -->',
  '',
  '> [!NOTE]',
  '> A callout',
  '',
  '- [x] done',
  '- [ ] not yet',
].join('\n')

function show(answer: string, options: { ask?: AskLabels | null; copyText?: (text: string) => Promise<void> } = {}) {
  const copyText = vi.fn(options.copyText ?? (async () => {}))
  const view = render(<AdaptAnswer t={t} answer={answer} ask={options.ask === undefined ? ask : options.ask} copyText={copyText} />)
  return { ...view, copyText }
}

describe('an answer shown in the conversation', () => {
  it('renders formatting but creates no link, image, frame, script, form control or URL from hostile Markdown', () => {
    const { container } = show(HOSTILE)
    const formatted = screen.getByTestId('adapt-answer-formatted')
    expect(formatted.querySelector('h1')?.textContent).toBe('Why it matters')
    expect(formatted.querySelector('strong')?.textContent).toBe('bold')
    expect(container.querySelectorAll('a, img, iframe, script, input, [href], [src], [onerror]')).toHaveLength(0)
    // Raw HTML stays as the characters it is; link and image text stay readable, their targets do not.
    expect(formatted.textContent).toContain('<script>alert(1)</script>')
    expect(formatted.textContent).toContain('<iframe src="https://evil.example/frame"></iframe>')
    expect(formatted.textContent).toContain('link')
    expect(formatted.textContent).toContain('Image: tracking pixel')
    expect(formatted.textContent).not.toContain('https://evil.example/x')
    // Workspace syntax is never interpreted: it is literal text.
    expect(formatted.textContent).toContain('[[Private page]]')
    expect(formatted.textContent).toContain('$x^2$')
    expect(formatted.textContent).toMatch(/☑\s+done/)
  })

  it('shows the exact answer as Markdown on request', () => {
    show(HOSTILE)
    fireEvent.click(screen.getByTestId('adapt-answer-source-view'))
    expect(screen.getByTestId('adapt-answer-source').textContent).toBe(HOSTILE)
  })

  it('copies the exact answer, not what is rendered, and says so', async () => {
    const { copyText } = show(HOSTILE)
    fireEvent.click(screen.getByTestId('adapt-answer-copy'))
    expect(await screen.findByTestId('adapt-answer-copied')).toHaveTextContent('Copied.')
    expect(copyText).toHaveBeenCalledExactlyOnceWith(HOSTILE)
  })

  it('keeps the answer and shows it as Markdown when copying fails', async () => {
    show('**Keep** this', { copyText: async () => { throw new Error('denied') } })
    fireEvent.click(screen.getByTestId('adapt-answer-copy'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t copy the answer.')
    await waitFor(() => expect(screen.getByTestId('adapt-answer-source').textContent).toBe('**Keep** this'))
  })

  it('offers no Copy until the host supplies its words', () => {
    show('Plain answer', { ask: null })
    expect(screen.queryByTestId('adapt-answer-copy')).toBeNull()
    expect(screen.getByTestId('adapt-answer-formatted')).toHaveTextContent('Plain answer')
  })
})
