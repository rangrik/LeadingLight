import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import type { MouseEvent } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPanel } from '../components/SettingsPanel'
import { VaultMenuList } from '../components/status-bar/VaultMenuList'
import { routeNoteClick } from '../components/note-list/noteListUtils'
import { useWorkspaceGraphState } from '../hooks/useWorkspaceGraphState'
import { clearPrefetchCache } from '../hooks/useTabManagement'
import type { Settings, VaultEntry } from '../types'
import { openNoteInNewWindow } from '../utils/openNoteWindow'
import { openVaultInNewWindow } from '../utils/openVaultWindow'
import { MULTI_WORKSPACE_ENABLED, SEPARATE_WINDOWS_ENABLED } from './localPolicy'
import { useSplitWorkspace } from './useSplitWorkspace'

const native = vi.hoisted(() => ({ invoke: vi.fn(), createWindow: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: class {
  constructor(...args: unknown[]) { native.createWindow(...args) }
} }))
vi.mock('../mock-tauri', () => ({ isTauri: () => true, mockInvoke: vi.fn() }))

const settings: Settings = {
  auto_pull_interval_minutes: null, autogit_enabled: null, telemetry_consent: null,
  crash_reporting_enabled: null, analytics_enabled: null, anonymous_id: null,
  release_channel: null, multi_workspace_enabled: true,
}
const vaults = [
  { path: '/vault', label: 'Primary', available: true, mounted: true },
  { path: '/other', label: 'Other', available: true, mounted: true },
]
const entries: VaultEntry[] = ['one', 'two', 'three'].map(name => ({
  path: `/vault/${name}.md`, filename: `${name}.md`, title: name,
  isA: 'Note', aliases: [], belongsTo: [], relatedTo: [], status: null, archived: false,
  modifiedAt: 1, createdAt: 1, fileSize: 1, snippet: '', wordCount: 0, relationships: {},
  icon: null, color: null, order: null, template: null, sort: null, outgoingLinks: [],
}))

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  clearPrefetchCache()
  native.invoke.mockImplementation(async (command: string, args?: { path?: string }) =>
    command === 'read_note' ? `# ${args?.path}` : undefined)
})

describe('shipping local workspace safety policy', () => {
  it('cannot create note or vault windows even when running inside Tauri', async () => {
    expect(SEPARATE_WINDOWS_ENABLED).toBe(false)
    await openNoteInNewWindow(entries[0].path, '/vault', 'One')
    await openVaultInNewWindow(vaults[1])
    expect(native.createWindow).not.toHaveBeenCalled()
    expect(native.invoke).not.toHaveBeenCalled()
  })

  it('ignores a stored multi-workspace opt-in and keeps one writable root', () => {
    expect(MULTI_WORKSPACE_ENABLED).toBe(false)
    const { result } = renderHook(() => useWorkspaceGraphState({
      allVaults: vaults, defaultWorkspacePath: '/other', resolvedPath: '/vault', settings,
      vaultSwitcherLoaded: false, windowMode: false,
    }))
    expect(result.current.multiWorkspaceEnabled).toBe(false)
    expect(result.current.writableVaultPaths).toEqual(['/vault'])
    expect(result.current.graphVaults).toBeUndefined()
    expect(result.current.folderVaults).toBeUndefined()
  })

  it('hides multi-workspace settings and clears a stored opt-in when saving', () => {
    const onSave = vi.fn()
    render(<SettingsPanel open settings={settings} onSave={onSave} onClose={() => {}} vaults={vaults} />)
    expect(screen.queryByText('Vaults')).not.toBeInTheDocument()
    expect(screen.queryByTestId('settings-multi-workspace-enabled')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('settings-save'))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ multi_workspace_enabled: false }))
  })

  it('keeps normal folder switching available without mount or window actions', () => {
    const onSelectVault = vi.fn()
    render(<VaultMenuList vaults={vaults} defaultPath="/vault" locale="en"
      multiWorkspaceEnabled canRemove={false} disableMountToggleForPath={() => false}
      onMountedChange={vi.fn()} onSelectVault={onSelectVault} setVaultPendingRemoval={vi.fn()} />)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByTestId('vault-menu-open-window-Other')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('vault-menu-item-label-Other'))
    expect(onSelectVault).toHaveBeenCalledWith('/other')
  })

  it.each(['metaKey', 'ctrlKey'] as const)('routes %s+Shift note clicks to the active local pane', async modifier => {
    const { result } = renderHook(() => useSplitWorkspace({ vaultPath: '/vault', entries }))
    await act(() => result.current.handleSelectNote(entries[0]))
    act(() => result.current.splitWorkspace.openSplit('horizontal'))
    await act(() => result.current.handleSelectNote(entries[1]))
    const onOpenInNewWindow = vi.fn()
    const onEnterNeighborhood = vi.fn()
    await act(async () => routeNoteClick(entries[2], {
      metaKey: false, ctrlKey: false, shiftKey: true, [modifier]: true,
    } as MouseEvent, {
      onReplace: entry => { void result.current.handleSelectNote(entry) },
      onOpenInNewWindow, onEnterNeighborhood,
      multiSelect: { clear: vi.fn(), setAnchor: vi.fn(), selectRange: vi.fn() },
    }))
    expect(result.current.splitWorkspace.paths).toEqual([entries[0].path, entries[2].path])
    expect(onOpenInNewWindow).not.toHaveBeenCalled()
    expect(onEnterNeighborhood).not.toHaveBeenCalled()
    expect(native.createWindow).not.toHaveBeenCalled()
  })
})
