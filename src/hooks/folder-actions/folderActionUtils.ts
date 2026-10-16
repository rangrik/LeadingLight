import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../../mock-tauri'
import type { SidebarSelection, VaultEntry } from '../../types'
import type { RunManualRename } from '../useAppSave'

export interface FolderRenameResult {
  old_path: string
  new_path: string
}

export interface FolderTab {
  entry: VaultEntry
  content: string
}

export interface ConfirmFolderDeleteState {
  path: string
  title: string
  message: string
  confirmLabel: string
}

export const DEFAULT_SELECTION: SidebarSelection = { kind: 'filter', filter: 'all' }

function trimTrailingSlash(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path
}

export function folderAbsolutePath(params: { vaultPath: string; folderPath: string }): string {
  const normalizedVaultPath = trimTrailingSlash(params.vaultPath)
  const normalizedFolderPath = params.folderPath.replace(/^\/+/, '')
  return normalizedFolderPath ? `${normalizedVaultPath}/${normalizedFolderPath}` : normalizedVaultPath
}

export function isWithinPrefix(params: { path: string; prefix: string }): boolean {
  return params.path === params.prefix || params.path.startsWith(`${params.prefix}/`)
}

export function replaceFolderPrefix(params: {
  path: string
  oldPrefix: string
  newPrefix: string
}): string {
  if (!isWithinPrefix({ path: params.path, prefix: params.oldPrefix })) return params.path
  return `${params.newPrefix}${params.path.slice(params.oldPrefix.length)}`
}

export function replaceRelativeFolderPrefix(params: {
  path: string
  oldPrefix: string
  newPrefix: string
}): string {
  if (!isWithinPrefix({ path: params.path, prefix: params.oldPrefix })) return params.path
  return `${params.newPrefix}${params.path.slice(params.oldPrefix.length)}`
}

export function folderLabel(params: { folderPath: string }): string {
  return params.folderPath.split('/').filter(Boolean).at(-1) ?? params.folderPath
}

/** A folder's pages, saved and kept still while the folder moves. */
export interface FolderMoveHold {
  /** Points every held page's later writes at its path in the moved folder. */
  commit: (newFolderPath: string) => void
  release: () => void
}

export interface FolderMoveSaves {
  /** Stops new manual renames, Trash and page changes, waits for running ones, and returns the reopen call. */
  quiet: () => Promise<() => void>
  pagePaths: () => string[]
  holdWrites: (paths: readonly string[]) => void
  /** Writes a held page's latest text and returns its settled path; throws when it can't. */
  saveHeld: (path: string) => Promise<string>
  releaseWrites: (paths: readonly string[]) => void
  trackRenamedPath: (oldPath: string, newPath: string) => void
}

/** Saves and holds every page in a folder before it moves, so no write can follow the old path. */
export async function holdFolderForMove(folderPath: string, saves: FolderMoveSaves): Promise<FolderMoveHold> {
  const reopen = await saves.quiet()
  const held: string[] = []
  let open = true
  const release = () => {
    if (!open) return
    open = false
    saves.releaseWrites(held)
    reopen()
  }
  // Only the pages' current paths move; older names already forward to them, so they must not be remapped.
  const moved = new Set<string>()
  try {
    // Read after running renames settle; an older name still listed is forwarded to its page by saveHeld.
    held.push(...new Set(saves.pagePaths().filter(path => isWithinPrefix({ path, prefix: folderPath }))))
    saves.holdWrites(held)
    for (const path of [...held]) {
      const settled = await saves.saveHeld(path)
      moved.add(settled)
      if (!held.includes(settled)) held.push(settled)
    }
  } catch (error) {
    release()
    throw error
  }
  return {
    commit: newFolderPath => {
      for (const path of moved) saves.trackRenamedPath(path, replaceFolderPrefix({ path, oldPrefix: folderPath, newPrefix: newFolderPath }))
    },
    release,
  }
}

export interface PageMoveSaves {
  /** The manual rename barrier: refuses while a folder move, close or vault switch holds, else registers at once. */
  withManualRename: RunManualRename
  holdWrites: (paths: readonly string[]) => void
  /** Writes the page's latest text, settles any automatic rename and returns the path to move. */
  saveHeld: (path: string) => Promise<string>
  releaseWrites: (paths: readonly string[]) => void
}

/** Moves a page as a manual rename, with its writes held while the file moves; null when refused or failed. */
export function admitPageMove<Rest extends unknown[], R>(
  saves: PageMoveSaves,
  move: (path: string, ...rest: Rest) => Promise<R | null>,
): (path: string, ...rest: Rest) => Promise<R | null> {
  return async (path, ...rest) => {
    let moved: R | null = null
    await saves.withManualRename(path, async () => {
      const held = [path]
      saves.holdWrites(held)
      try {
        const settled = await saves.saveHeld(path)
        if (settled !== path) held.push(settled)
        moved = await move(settled, ...rest)
      } finally {
        saves.releaseWrites(held)
      }
    }).catch((error: unknown) => { console.warn('[move] The page was not moved:', error) })
    return moved
  }
}

export async function invokeRenameFolder(params: {
  vaultPath: string
  folderPath: string
  newName: string
}): Promise<FolderRenameResult> {
  if (isTauri()) {
    return invoke<FolderRenameResult>('rename_vault_folder', params)
  }
  return mockInvoke<FolderRenameResult>('rename_vault_folder', params)
}

export async function invokeDeleteFolder(params: { vaultPath: string; folderPath: string }): Promise<string> {
  if (isTauri()) {
    return invoke<string>('delete_vault_folder', params)
  }
  return mockInvoke<string>('delete_vault_folder', params)
}

export function updateSelectionAfterFolderRename(params: {
  refreshedEntries: VaultEntry[]
  renameResult: FolderRenameResult
  selection: SidebarSelection
  setSelection: (selection: SidebarSelection) => void
  vaultPath: string
}) {
  const {
    refreshedEntries,
    renameResult,
    selection,
    setSelection,
    vaultPath,
  } = params

  if (selection.kind === 'folder') {
    if (!isWithinPrefix({ path: selection.path, prefix: renameResult.old_path })) return
    setSelection({
      kind: 'folder',
      path: replaceRelativeFolderPrefix({
        path: selection.path,
        oldPrefix: renameResult.old_path,
        newPrefix: renameResult.new_path,
      }),
    })
    return
  }

  if (selection.kind !== 'entity') return

  const oldPrefix = folderAbsolutePath({ vaultPath, folderPath: renameResult.old_path })
  if (!isWithinPrefix({ path: selection.entry.path, prefix: oldPrefix })) return

  const renamedPath = replaceFolderPrefix({
    path: selection.entry.path,
    oldPrefix,
    newPrefix: folderAbsolutePath({ vaultPath, folderPath: renameResult.new_path }),
  })
  const refreshedEntry = refreshedEntries.find((entry) => entry.path === renamedPath)
  setSelection(refreshedEntry ? { kind: 'entity', entry: refreshedEntry } : DEFAULT_SELECTION)
}

export function updateTabsAfterFolderRename(params: {
  activeTabPathRef: React.MutableRefObject<string | null>
  handleSwitchTab: (path: string) => void
  refreshedEntries: VaultEntry[]
  renameResult: FolderRenameResult
  setTabs: React.Dispatch<React.SetStateAction<FolderTab[]>>
  vaultPath: string
}) {
  const {
    activeTabPathRef,
    handleSwitchTab,
    refreshedEntries,
    renameResult,
    setTabs,
    vaultPath,
  } = params
  const oldPrefix = folderAbsolutePath({ vaultPath, folderPath: renameResult.old_path })
  const newPrefix = folderAbsolutePath({ vaultPath, folderPath: renameResult.new_path })

  setTabs((currentTabs) => currentTabs.map((tab) => {
    if (!isWithinPrefix({ path: tab.entry.path, prefix: oldPrefix })) return tab
    const nextPath = replaceFolderPrefix({ path: tab.entry.path, oldPrefix, newPrefix })
    const refreshedEntry = refreshedEntries.find((entry) => entry.path === nextPath)
    return refreshedEntry ? { ...tab, entry: refreshedEntry } : { ...tab, entry: { ...tab.entry, path: nextPath } }
  }))

  const activeTabPath = activeTabPathRef.current
  if (!activeTabPath || !isWithinPrefix({ path: activeTabPath, prefix: oldPrefix })) return
  handleSwitchTab(replaceFolderPrefix({ path: activeTabPath, oldPrefix, newPrefix }))
}

export function clearDeletedFolderTabs(params: {
  activeTabPathRef: React.MutableRefObject<string | null>
  closeAllTabs: () => void
  folderPath: string
  setTabs: React.Dispatch<React.SetStateAction<FolderTab[]>>
  vaultPath: string
}) {
  const {
    activeTabPathRef,
    closeAllTabs,
    folderPath,
    setTabs,
    vaultPath,
  } = params
  const folderPrefix = folderAbsolutePath({ vaultPath, folderPath })
  const hasActiveTabInFolder = !!activeTabPathRef.current
    && isWithinPrefix({ path: activeTabPathRef.current, prefix: folderPrefix })

  if (hasActiveTabInFolder) {
    closeAllTabs()
    return
  }

  setTabs((currentTabs) => currentTabs.filter((tab) => !isWithinPrefix({ path: tab.entry.path, prefix: folderPrefix })))
}

export function resetSelectionIfFolderDeleted(params: {
  folderPath: string
  refreshedEntries: VaultEntry[]
  selection: SidebarSelection
  setSelection: (selection: SidebarSelection) => void
  vaultPath: string
}) {
  const {
    folderPath,
    refreshedEntries,
    selection,
    setSelection,
    vaultPath,
  } = params

  if (selection.kind === 'folder' && isWithinPrefix({ path: selection.path, prefix: folderPath })) {
    setSelection(DEFAULT_SELECTION)
    return
  }

  if (selection.kind !== 'entity') return

  const folderPrefix = folderAbsolutePath({ vaultPath, folderPath })
  if (!isWithinPrefix({ path: selection.entry.path, prefix: folderPrefix })) return

  const replacement = refreshedEntries.find((entry) => entry.path === selection.entry.path)
  setSelection(replacement ? { kind: 'entity', entry: replacement } : DEFAULT_SELECTION)
}
