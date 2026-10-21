import { fireEvent, render, renderHook, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SidebarTopNav } from '../../components/sidebar/SidebarTopNav'
import { useAppCommands } from '../../hooks/useAppCommands'
import { buildWebCaptureCommands } from './webCaptureActions'

function config(onCreateFromWebsite?: () => void): Parameters<typeof useAppCommands>[0] {
  return {
    activeTabPath: null, activeTabPathRef: { current: null }, entries: [], visibleNotesRef: { current: [] },
    multiSelectionCommandRef: { current: null }, modifiedCount: 0, selection: { kind: 'filter', filter: 'all' },
    onQuickOpen: vi.fn(), onCommandPalette: vi.fn(), onSearch: vi.fn(), onPastePlainText: vi.fn(),
    onCreateNote: vi.fn(), onCreateNoteOfType: vi.fn(), onSave: vi.fn(), onOpenSettings: vi.fn(), onDeleteNote: vi.fn(),
    onArchiveNote: vi.fn(), onUnarchiveNote: vi.fn(), onCommitPush: vi.fn(), onSetViewMode: vi.fn(), onToggleInspector: vi.fn(),
    activeNoteModified: false, onZoomIn: vi.fn(), onZoomOut: vi.fn(), onZoomReset: vi.fn(), zoomLevel: 100,
    onSelect: vi.fn(), onReplaceActiveTab: vi.fn(), onSelectNote: vi.fn(), aiFeaturesEnabled: false, onCreateFromExtension: vi.fn(), onCreateFromWebsite,
  }
}

describe('Save from website… in the palette', () => {
  it('is one Note command with no shortcut that opens the website flow', () => {
    const open = vi.fn()
    const [command, ...rest] = buildWebCaptureCommands('en', open)
    expect(rest).toEqual([])
    expect(command).toMatchObject({ id: 'save-from-website', label: 'Save from website…', group: 'Note', enabled: true })
    expect(command.shortcut).toBeUndefined()
    command.execute()
    expect(open).toHaveBeenCalledOnce()
  })

  it('appears only while a website command can run, beside From extension', () => {
    const ids = (onCreate?: () => void) => renderHook(() => useAppCommands(config(onCreate))).result.current.map(command => command.id)
    expect(ids()).not.toContain('save-from-website')
    expect(ids()).toContain('new-page-from-extension')
    expect(ids(vi.fn()).filter(id => id === 'save-from-website')).toHaveLength(1)
  })
})

describe('From website… in the sidebar', () => {
  const nav = (onCreateFromWebsite?: () => void) => render(<SidebarTopNav selection={{ kind: 'filter', filter: 'all' }} onSelect={vi.fn()} showInbox={false}
    inboxCount={0} activeCount={0} archivedCount={0} onCreatePage={vi.fn()} onCreateFromTemplate={vi.fn()} onCreateFromExtension={vi.fn()}
    onCreateFromWebsite={onCreateFromWebsite} />)

  it('is absent while no website command can run', () => {
    nav()
    expect(screen.queryByRole('button', { name: 'From website…' })).not.toBeInTheDocument()
  })

  it('sits under From extension in the same style and opens the website flow', () => {
    const website = vi.fn()
    nav(website)
    const buttons = screen.getAllByRole('button')
    const labels = buttons.map(button => button.textContent)
    const index = labels.indexOf('From website…')
    expect(index).toBe(labels.indexOf('From extension…') + 1)
    expect(buttons[index].className).toBe(buttons[index - 1].className)
    fireEvent.click(buttons[index])
    expect(website).toHaveBeenCalledExactlyOnceWith()
  })
})
