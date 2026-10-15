import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useCommandRegistry } from '../hooks/useCommandRegistry'
import { buildVaultActions } from '../components/status-bar/vaultMenuActions'
import { isLocalCommandVisible } from './localCommands'

describe('LeadingLight command surfaces', () => {
  it('removes remote palette commands even when their callbacks are supplied', () => {
    const action = vi.fn()
    const { result } = renderHook(() => useCommandRegistry({
      activeTabPath: '/synthetic/note.md', entries: [], modifiedCount: 1,
      activeNoteModified: false, zoomLevel: 100,
      aiFeaturesEnabled: true, gitFeaturesEnabled: true,
      onQuickOpen: action, onCreateNote: action, onCreateNoteOfType: action,
      onSave: action, onPastePlainText: action, onOpenSettings: action,
      onDeleteNote: action, onArchiveNote: action, onUnarchiveNote: action,
      onCommitPush: action, onSetViewMode: action, onToggleInspector: action,
      onZoomIn: action, onZoomOut: action, onZoomReset: action, onSelect: action,
      onOpenAiAgents: action, onInstallMcp: action, onCheckForUpdates: action,
      onToggleAIChat: action, onRestoreGettingStarted: action,
      onOpenVault: action, onCreateEmptyVault: action, onExportNoteAsPdf: action,
    }))
    const ids = result.current.map(command => command.id)
    for (const id of ['open-ai-agents', 'toggle-ai-panel', 'new-ai-chat', 'install-mcp', 'check-updates', 'restore-getting-started', 'git-pull', 'commit-push', 'open-contribute']) {
      expect(ids).not.toContain(id)
    }
    for (const id of ['search-notes', 'save-note', 'open-vault', 'create-empty-vault']) {
      expect(ids).toContain(id)
    }
    expect(isLocalCommandVisible({ id: 'switch-ai-agent-codex' })).toBe(false)
    expect(isLocalCommandVisible({ id: 'git-pull-synthetic-vault' })).toBe(false)
    expect(isLocalCommandVisible({ id: 'open-in-new-window' })).toBe(false)
  })

  it('keeps local vault creation and opening while omitting clones', () => {
    const create = vi.fn()
    const open = vi.fn()
    const remote = vi.fn()
    const actions = buildVaultActions({
      multiWorkspaceEnabled: false,
      onCreateEmptyVault: create, onOpenLocalFolder: open,
      onCloneVault: remote, onCloneGettingStarted: remote,
    })
    expect(actions.map(action => action.key)).toEqual(['create-empty', 'open-local'])
    actions[0].onClick()
    actions[1].onClick()
    expect(create).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledOnce()
    expect(remote).not.toHaveBeenCalled()
  })
})
