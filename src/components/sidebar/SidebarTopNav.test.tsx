import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SidebarTopNav } from './SidebarTopNav'

describe('optional template entry', () => {
  it('keeps blank New page immediate and template creation separate', () => {
    const blank = vi.fn(), template = vi.fn()
    render(<SidebarTopNav selection={{ kind: 'filter', filter: 'all' }} onSelect={vi.fn()} showInbox={false}
      inboxCount={0} activeCount={0} archivedCount={0} onCreatePage={blank} onCreateFromTemplate={template} />)
    fireEvent.click(screen.getByRole('button', { name: 'New page' }))
    expect(blank).toHaveBeenCalledExactlyOnceWith()
    expect(template).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'From template' }))
    expect(template).toHaveBeenCalledExactlyOnceWith()
    expect(blank).toHaveBeenCalledTimes(1)
  })
})

describe('optional extension entry', () => {
  const nav = (onCreateFromExtension?: () => void) => render(<SidebarTopNav selection={{ kind: 'filter', filter: 'all' }} onSelect={vi.fn()} showInbox={false}
    inboxCount={0} activeCount={0} archivedCount={0} onCreatePage={vi.fn()} onCreateFromTemplate={vi.fn()} onCreateFromExtension={onCreateFromExtension} />)

  it('is absent while no extension command can run', () => {
    nav()
    expect(screen.queryByRole('button', { name: 'From extension…' })).not.toBeInTheDocument()
  })

  it('sits under From template and opens the extension flow without touching blank New page', () => {
    const extension = vi.fn()
    nav(extension)
    const buttons = screen.getAllByRole('button').map(button => button.textContent)
    expect(buttons.indexOf('From extension…')).toBe(buttons.indexOf('From template') + 1)
    fireEvent.click(screen.getByRole('button', { name: 'From extension…' }))
    expect(extension).toHaveBeenCalledExactlyOnceWith()
  })
})
