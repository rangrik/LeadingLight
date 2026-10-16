import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FolderNode, SidebarSelection, VaultEntry } from '../types'
import { makeEntry } from '../test-utils/noteListTestUtils'
import { useNoteRetargetingUi } from './useNoteRetargetingUi'

const vaultPath = '/Users/luca/Laputa'
const activeEntry = makeEntry({
  path: `${vaultPath}/projects/alpha.md`,
  filename: 'alpha.md',
  title: 'Alpha',
})

function renderUi(overrides: {
  activeEntry?: VaultEntry | null
  entries?: VaultEntry[]
  folders?: FolderNode[]
  selection?: SidebarSelection
  vaultPath?: string
  captureFolderContext?: (path: string) => () => boolean
  moveNoteToFolder?: Parameters<typeof useNoteRetargetingUi>[0]['moveNoteToFolder']
} = {}) {
  return renderHook(() => useNoteRetargetingUi({
    activeEntry: overrides.activeEntry ?? activeEntry,
    activeNoteBlocked: false,
    entries: overrides.entries ?? [activeEntry],
    folders: overrides.folders ?? [],
    selection: overrides.selection ?? { kind: 'filter', filter: 'all' },
    setSelection: vi.fn(),
    setToastMessage: vi.fn(),
    vaultPath: overrides.vaultPath ?? vaultPath,
    updateFrontmatter: vi.fn(),
    moveNoteToFolder: overrides.moveNoteToFolder ?? vi.fn(),
    captureFolderContext: overrides.captureFolderContext,
  }))
}

describe('useNoteRetargetingUi', () => {
  it('keeps the explicitly requested page and refuses a changed navigation context', async () => {
    const other = makeEntry({ path: `${vaultPath}/other.md`, filename: 'other.md', title: 'Other' })
    const current = vi.fn(() => true)
    const captureFolderContext = vi.fn(() => current)
    const moveNoteToFolder = vi.fn(async () => ({ new_path: `${vaultPath}/projects/other.md` }))
    const { result } = renderUi({ entries: [activeEntry, other], folders: [{ name: 'projects', path: 'projects', children: [] }], captureFolderContext, moveNoteToFolder })
    act(() => { result.current.openMovePageToFolderDialog(other.path) })
    expect(captureFolderContext).toHaveBeenCalledWith(other.path)
    expect(result.current.dialogEntry?.path).toBe(other.path)
    current.mockReturnValue(false)
    await act(async () => { expect(await result.current.selectFolder('projects')).toBe(false) })
    expect(moveNoteToFolder).not.toHaveBeenCalled()
    current.mockReturnValue(true)
    await act(async () => { expect(await result.current.selectFolder('projects')).toBe(true) })
    expect(moveNoteToFolder).toHaveBeenCalledWith(other.path, 'projects', vaultPath, expect.any(Function))
  })
  it('offers the vault root as a folder move destination for nested notes', () => {
    const { result } = renderUi()

    expect(result.current.canMoveActiveNoteToFolder).toBe(true)

    act(() => {
      result.current.openMoveNoteToFolderDialog()
    })

    expect(result.current.folderOptions).toEqual([
      expect.objectContaining({
        current: false,
        id: '',
        label: 'Laputa',
      }),
    ])
  })

  it('marks the current Windows-style folder with the same normalization used by drops', () => {
    const windowsVaultPath = 'C:\\Users\\luca\\Laputa'
    const windowsEntry = makeEntry({
      path: `${windowsVaultPath}\\projects\\alpha.md`,
      filename: 'alpha.md',
      title: 'Alpha',
    })

    const { result } = renderUi({
      activeEntry: windowsEntry,
      entries: [windowsEntry],
      folders: [{ name: 'projects', path: 'projects', children: [] }],
      vaultPath: windowsVaultPath,
    })

    act(() => {
      result.current.openMoveNoteToFolderDialog()
    })

    expect(result.current.canMoveActiveNoteToFolder).toBe(true)
    expect(result.current.folderOptions).toEqual([
      expect.objectContaining({
        current: false,
        id: '',
        label: 'Laputa',
      }),
      expect.objectContaining({
        current: true,
        id: 'projects',
        label: 'projects',
      }),
    ])
  })
})
