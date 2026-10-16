import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TemplatePreview } from './TemplatePreview'

const MARKDOWN = '---\r\ntype: Journal\r\n---\r\n# A start\r\n\n[link](https://example.test) ![photo](../photo.png)\n- [ ] Plan\n<img src="https://example.test/p.png"><script>alert(1)</script>'

describe('template preview', () => {
  it('shows passive Markdown without navigable, fetching or interactive elements', () => {
    render(<TemplatePreview content={MARKDOWN} locale="en" />)
    const preview = screen.getByTestId('template-preview-formatted')
    expect(preview).toHaveTextContent('A start')
    expect(preview).toHaveTextContent('Image: photo')
    expect(preview).toHaveTextContent('Plan')
    expect(preview).not.toHaveTextContent('type: Journal')
    expect(preview.querySelector('a, img, input, script, iframe, video, audio, object, embed, [href], [src]')).toBeNull()
  })

  it('shows exact proposed bytes in the Markdown view', () => {
    render(<TemplatePreview content={MARKDOWN} locale="en" />)
    fireEvent.click(screen.getByRole('button', { name: 'Markdown' }))
    expect(screen.getByTestId('template-preview-source').textContent).toBe(MARKDOWN)
  })
})
