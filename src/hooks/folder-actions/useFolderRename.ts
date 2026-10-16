import { useCallback, useState } from 'react'
import type { SidebarSelection, VaultEntry } from '../../types'
import { createTranslator } from '../../lib/i18n'
import {
  folderAbsolutePath,
  folderLabel,
  invokeRenameFolder,
  type FolderMoveHold,
  type FolderRenameResult,
  type FolderTab,
  updateSelectionAfterFolderRename,
  updateTabsAfterFolderRename,
} from './folderActionUtils'

const translate = createTranslator()

interface UseFolderRenameInput {
  activeTabPathRef: React.MutableRefObject<string | null>
  handleSwitchTab: (path: string) => void
  /** Saves and holds the folder's pages; rejects, after saying why, when the folder must not move. */
  prepareFolderMove: (folderPath: string) => Promise<FolderMoveHold>
  reloadFolders: () => Promise<unknown>
  reloadVault: () => Promise<VaultEntry[]>
  selection: SidebarSelection
  setSelection: (selection: SidebarSelection) => void
  setTabs: React.Dispatch<React.SetStateAction<FolderTab[]>>
  setToastMessage: (message: string | null) => void
  vaultPath: string
}

export function useFolderRename(options: UseFolderRenameInput) {
  const { activeTabPathRef, handleSwitchTab, prepareFolderMove, reloadFolders, reloadVault, selection, setSelection, setTabs, setToastMessage, vaultPath } = options
  const [renamingFolderPath, setRenamingFolderPath] = useState<string | null>(null)

  const cancelFolderRename = useCallback(() => setRenamingFolderPath(null), [])
  const startFolderRename = useCallback((folderPath: string) => setRenamingFolderPath(folderPath), [])

  const renameFolder = useCallback(
    async (folderPath: string, nextName: string) => {
    const trimmedName = nextName.trim()
    if (trimmedName === folderLabel({ folderPath })) {
      setRenamingFolderPath(null)
      return true
    }

    const hold = await prepareFolderMove(folderAbsolutePath({ vaultPath, folderPath })).catch(() => null)
    if (!hold) return false
    let renameResult: FolderRenameResult
    try {
        renameResult = await invokeRenameFolder({
          vaultPath,
          folderPath,
          newName: trimmedName,
        })
    } catch (error) {
      hold.release()
      setToastMessage(`Failed to rename folder: ${error}`)
      return false
    }
    // The folder has moved: held writes and open pages follow it before anything else can run.
    try {
      hold.commit(folderAbsolutePath({ vaultPath, folderPath: renameResult.new_path }))
      setRenamingFolderPath(null)
      updateTabsAfterFolderRename({
        activeTabPathRef,
        handleSwitchTab,
        refreshedEntries: [],
        renameResult,
        setTabs,
        vaultPath,
      })
    } finally {
      hold.release()
    }
    let refreshedEntries: VaultEntry[] = []
    try {
      await reloadFolders()
      refreshedEntries = await reloadVault()
      setToastMessage(`Renamed folder to "${trimmedName}"`)
    } catch {
      setToastMessage(translate('leadinglight.folderRename.refreshFailed', { name: trimmedName }))
    }
    updateSelectionAfterFolderRename({
      refreshedEntries,
      renameResult,
      selection,
      setSelection,
      vaultPath,
    })
    return true
    },
    [
      activeTabPathRef,
      handleSwitchTab,
      prepareFolderMove,
      reloadFolders,
      reloadVault,
      selection,
      setSelection,
      setTabs,
      setToastMessage,
      vaultPath,
    ],
  )

  const renameSelectedFolder = useCallback(() => {
    if (selection.kind !== 'folder' || !selection.path) return
    startFolderRename(selection.path)
  }, [selection, startFolderRename])

  return {
    cancelFolderRename,
    renameFolder,
    renameSelectedFolder,
    renamingFolderPath,
    startFolderRename,
  }
}
