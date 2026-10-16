import { describe, expect, it, vi } from 'vitest'
import { buildTemplateCommands } from './templateActions'
import { act, renderHook } from '@testing-library/react'
import { useAppCommands } from '../../hooks/useAppCommands'
import type { VaultEntry } from '../../types'

describe('template command', () => {
  it('opens an optional flow without assigning the blank capture shortcut', () => {
    const open = vi.fn()
    const [command] = buildTemplateCommands('en', open)
    expect(command.label).toBe('New page from template')
    expect(command.shortcut).toBeUndefined()
    command.execute()
    expect(open).toHaveBeenCalledOnce()
  })
})

const entries: VaultEntry[] = ['A', 'B', 'C'].map(title => ({
  path: `/vault/${title}.md`, filename: `${title}.md`, title, isA: 'Note', aliases: [], belongsTo: [], relatedTo: [], status: null,
  archived: false, modifiedAt: null, createdAt: null, fileSize: 0, snippet: '', wordCount: 0, relationships: {}, icon: null,
  color: null, order: null, sidebarLabel: null, template: null, sort: null, view: null, visible: null, organized: false,
  favorite: false, favoriteIndex: null, listPropertiesDisplay: [], outgoingLinks: [], properties: {}, hasH1: false,
}))

function commandsConfig(activeTabPath: string | null, isTemplateOpen: () => boolean): Parameters<typeof useAppCommands>[0] {
  return {
    activeTabPath, activeTabPathRef: { current: activeTabPath }, entries, visibleNotesRef: { current: entries },
    multiSelectionCommandRef: { current: null }, modifiedCount: 0, selection: { kind: 'filter', filter: 'all' },
    onQuickOpen: vi.fn(), onCommandPalette: vi.fn(), onSearch: vi.fn(), onPastePlainText: vi.fn(),
    onCreateNote: vi.fn(), onCreateNoteOfType: vi.fn(), onSave: vi.fn(), onOpenSettings: vi.fn(), onDeleteNote: vi.fn(),
    onArchiveNote: vi.fn(), onUnarchiveNote: vi.fn(), onCommitPush: vi.fn(), onSetViewMode: vi.fn(), onToggleInspector: vi.fn(),
    activeNoteModified: false, onZoomIn: vi.fn(), onZoomOut: vi.fn(), onZoomReset: vi.fn(), zoomLevel: 100,
    onSelect: vi.fn(), onReplaceActiveTab: vi.fn(), onSelectNote: vi.fn(), isTemplateOpen, aiFeaturesEnabled: false,
  }
}

describe('template modal keyboard navigation', () => {
  it.each(['metaKey', 'ctrlKey'] as const)('guards both %s+Alt+Arrow directions and restores ordinary replacement', modifier => {
    let modalOpen = true
    const config = commandsConfig(entries[1].path, () => modalOpen)
    renderHook(() => useAppCommands(config))
    const draft = document.createElement('textarea')
    draft.value = 'Unsaved template words'
    document.body.append(draft)
    draft.focus()
    const press = (key: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, altKey: true, [modifier]: true, bubbles: true })) })
    press('ArrowUp'); press('ArrowDown')
    expect(config.onReplaceActiveTab).not.toHaveBeenCalled()
    expect(config.onSelectNote).not.toHaveBeenCalled()
    expect(draft.value).toBe('Unsaved template words')
    modalOpen = false
    press('ArrowUp'); press('ArrowDown')
    expect(config.onReplaceActiveTab).toHaveBeenNthCalledWith(1, entries[0])
    expect(config.onReplaceActiveTab).toHaveBeenNthCalledWith(2, entries[2])
    expect(config.onSelectNote).not.toHaveBeenCalled()
    draft.remove()
  })

  it.each(['metaKey', 'ctrlKey'] as const)('guards %s+Alt+Arrow selection when the destination pane is empty', modifier => {
    let modalOpen = true
    const config = commandsConfig(null, () => modalOpen)
    renderHook(() => useAppCommands(config))
    const press = (key: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, altKey: true, [modifier]: true, bubbles: true })) })
    press('ArrowUp'); press('ArrowDown')
    expect(config.onSelectNote).not.toHaveBeenCalled()
    expect(config.onReplaceActiveTab).not.toHaveBeenCalled()
    modalOpen = false
    press('ArrowUp'); press('ArrowDown')
    expect(config.onSelectNote).toHaveBeenNthCalledWith(1, entries[2])
    expect(config.onSelectNote).toHaveBeenNthCalledWith(2, entries[0])
  })
})
