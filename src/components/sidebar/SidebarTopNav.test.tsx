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
