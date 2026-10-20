import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAppCommands } from '../../hooks/useAppCommands'
import { buildExtensionCommands } from './extensionActions'

function config(onCreateFromExtension?: () => void): Parameters<typeof useAppCommands>[0] {
  return {
    activeTabPath: null, activeTabPathRef: { current: null }, entries: [], visibleNotesRef: { current: [] },
    multiSelectionCommandRef: { current: null }, modifiedCount: 0, selection: { kind: 'filter', filter: 'all' },
    onQuickOpen: vi.fn(), onCommandPalette: vi.fn(), onSearch: vi.fn(), onPastePlainText: vi.fn(),
    onCreateNote: vi.fn(), onCreateNoteOfType: vi.fn(), onSave: vi.fn(), onOpenSettings: vi.fn(), onDeleteNote: vi.fn(),
    onArchiveNote: vi.fn(), onUnarchiveNote: vi.fn(), onCommitPush: vi.fn(), onSetViewMode: vi.fn(), onToggleInspector: vi.fn(),
    activeNoteModified: false, onZoomIn: vi.fn(), onZoomOut: vi.fn(), onZoomReset: vi.fn(), zoomLevel: 100,
    onSelect: vi.fn(), onReplaceActiveTab: vi.fn(), onSelectNote: vi.fn(), aiFeaturesEnabled: false, onCreateFromExtension,
  }
}

describe('From extension… in the palette', () => {
  it('is one Note command with no shortcut that opens the extension flow', () => {
    const open = vi.fn()
    const [command, ...rest] = buildExtensionCommands('en', open)
    expect(rest).toEqual([])
    expect(command).toMatchObject({ id: 'new-page-from-extension', label: 'New page from extension…', group: 'Note', enabled: true })
    expect(command.shortcut).toBeUndefined()
    command.execute()
    expect(open).toHaveBeenCalledOnce()
  })

  it('appears only while an extension command can run', () => {
    const ids = (onCreate?: () => void) => renderHook(() => useAppCommands(config(onCreate))).result.current.map(command => command.id)
    expect(ids()).not.toContain('new-page-from-extension')
    expect(ids(vi.fn()).filter(id => id === 'new-page-from-extension')).toHaveLength(1)
  })
})
