import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { VersionPreview as Preview } from './pageHistoryApi'
import { VersionPreview } from './VersionPreview'

// Seam: verified version text -> what is drawn. Catches a stored page fetching, navigating, running markup or losing exact bytes.
const HOSTILE = [
  '﻿# Plan\r\n',
  '[site](https://example.test/x) https://auto.test and ![cat](https://example.test/cat.png)\r\n',
  '<img src="https://evil.test/p.png" onerror="alert(1)"><a href="javascript:alert(1)">x</a>\r\n',
  '<script>alert(1)</script>\r\n<iframe src="https://evil.test"></iframe>\r\n',
].join('')
const shown = (overrides: Partial<Extract<Preview, { status: 'ok' }>> = {}) => ({
  status: 'ok' as const, text: HOSTILE, length: 300_000, shownBytes: 262_144, truncated: true, bom: true, crlf: true, ...overrides,
})

describe('version preview', () => {
  it('draws Markdown without links, images, raw HTML or any URL', () => {
    render(<VersionPreview preview={shown()} locale="en" />)
    const formatted = screen.getByTestId('page-history-preview-formatted')
    expect(formatted.querySelector('a, img, script, iframe, video, audio, object, embed, [href], [src]')).toBeNull()
    expect(formatted).toHaveTextContent('Plan')
    expect(formatted).toHaveTextContent('site')
    expect(formatted).toHaveTextContent('Image: cat')
    expect(formatted).not.toHaveTextContent('alert(1)')
  })

  it('shows the exact decoded text as source and says what is cut or unusual', () => {
    render(<VersionPreview preview={shown()} locale="en" />)
    fireEvent.click(screen.getByTestId('page-history-view-source'))
    expect(screen.getByTestId('page-history-preview-source').textContent).toBe(HOSTILE)
    const notes = screen.getByTestId('page-history-preview-notes')
    expect(notes).toHaveTextContent(/Showing the first .+ of .+\. A copy keeps all of it\./)
    expect(notes).toHaveTextContent('Starts with a byte order mark.')
    expect(notes).toHaveTextContent('Uses Windows line endings (CRLF).')
  })

  it('says a version is not text instead of drawing it', () => {
    render(<VersionPreview preview={shown({ text: null, truncated: false, bom: false, crlf: false })} locale="en" />)
    expect(screen.getByTestId('page-history-preview-binary')).toHaveTextContent('can’t be shown as text')
    expect(screen.queryByTestId('page-history-preview')).toBeNull()
  })
})
