import { useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { VaultEntry, WorkspaceIdentity } from '../types'
import { slugify } from './useNoteCreation'
import { createTranslator } from '../lib/i18n'
import {
  findByNotePath,
  normalizeVaultRelativePath,
  notePathFilename,
  notePathsMatch,
  vaultRelativePathLabel,
} from '../utils/notePathIdentity'
import { deriveDisplayTitleState, filenameStemToTitle } from '../utils/noteTitle'
import { vaultPathForEntry } from '../utils/workspaces'
import { relativePathStem } from '../utils/wikilink'
import type { MutateExistingDocument } from './useAppSave'
import type { RenameAdmission } from '../leadinglight/rename/renameAdmission'
import { runManagedRename, type ManagedRenameResult, type RebaseHeldDraft } from '../leadinglight/rename/managedRename'

interface RenameResult {
  new_path: string
  updated_files: number
  failed_updates?: number
}

export { slugify }

const translate = createTranslator()

interface RenameRequest {
  path: string
  newTitle: string
  vaultPath: string
  oldTitle?: string
  /** Open pages whose exact before/after text the receipt reports. */
  openPaths?: readonly string[]
}

interface FilenameRenameRequest {
  path: string
  newFilenameStem: string
  vaultPath: string
  openPaths?: readonly string[]
}

interface AutoRenameRequest {
  path: string
  vaultPath: string
  openPaths?: readonly string[]
}

interface FolderMoveRequest {
  path: string
  folderPath: string
  vaultPath: string
}

/** Folder relocation's stronger boundary owns validation and editor settlement. */
export function performFolderRelocation(request: FolderMoveRequest & { openPaths: string[] }): Promise<unknown> {
  return invokeStructuredRenameCommand({
    command: 'move_note_to_folder',
    args: { vaultPath: request.vaultPath, oldPath: request.path, folderPath: request.folderPath, openPaths: request.openPaths },
    mockArgs: { vault_path: request.vaultPath, old_path: request.path, folder_path: request.folderPath, open_paths: request.openPaths },
  })
}

interface WorkspaceMoveRequest {
  path: string
  sourceVaultPath: string
  destinationVaultPath: string
  replacementTarget?: string
}

interface LoadNoteContentRequest {
  path: string
  vaultPath?: string
}

interface ReloadTabsAfterRenameRequest {
  tabPaths: string[]
  updateTabContent: (path: string, content: string) => void
}

type RenameCommand = 'rename_note' | 'rename_note_filename' | 'move_note_to_folder' | 'move_note_to_workspace'
type NoteCommandExtra = Record<string, unknown>

interface NoteCommandRequest {
  command: RenameCommand
  mockExtra: NoteCommandExtra
  path: string
  tauriExtra: NoteCommandExtra
  vaultPath: string
}

interface SingleValueNoteCommand {
  command: RenameCommand
  mockKey: string
  tauriKey: string
}

const FILENAME_RENAME_COMMAND: SingleValueNoteCommand = {
  command: 'rename_note_filename',
  mockKey: 'new_filename_stem',
  tauriKey: 'newFilenameStem',
}

const FOLDER_MOVE_COMMAND: SingleValueNoteCommand = {
  command: 'move_note_to_folder',
  mockKey: 'folder_path',
  tauriKey: 'folderPath',
}

/** Check if a note's filename doesn't match the slug of its current title. */
export function needsRenameOnSave(title: string, filename: string): boolean {
  if (!filename.toLowerCase().endsWith('.md')) return false
  return `${slugify(title)}.md` !== filename
}

export async function performRename({ path, newTitle, vaultPath, oldTitle, openPaths = [] }: RenameRequest): Promise<RenameResult> {
  const oldTitleArg = oldTitle ?? null
  return invokeNoteCommand({
    command: 'rename_note',
    path,
    vaultPath,
    tauriExtra: { newTitle, oldTitle: oldTitleArg, openPaths: [...openPaths] },
    mockExtra: { new_title: newTitle, old_title: oldTitleArg, open_paths: [...openPaths] },
  })
}

/** The one-shot untitled rename; null when the page is not renamed. */
export async function performAutoRename({ path, vaultPath, openPaths = [] }: AutoRenameRequest): Promise<unknown> {
  return isTauri()
    ? invoke('auto_rename_untitled', { args: { vaultPath, notePath: path, openPaths: [...openPaths] } })
    : mockInvoke('auto_rename_untitled', { vault_path: vaultPath, note_path: path, open_paths: [...openPaths] })
}

function invokeRenameCommand(params: {
    command: RenameCommand
    tauriArgs: Record<string, unknown>
    mockArgs: Record<string, unknown>
}): Promise<RenameResult> {
  return isTauri()
    ? invoke<RenameResult>(params.command, params.tauriArgs)
    : mockInvoke<RenameResult>(params.command, params.mockArgs)
}

function invokeStructuredRenameCommand(params: {
  command: RenameCommand
  args: Record<string, unknown>
  mockArgs: Record<string, unknown>
}): Promise<RenameResult> {
  return invokeRenameCommand({
    command: params.command,
    tauriArgs: { args: params.args },
    mockArgs: params.mockArgs,
  })
}

function noteCommandArgs({
  mockExtra,
  path,
  style,
  tauriExtra,
  vaultPath,
}: {
  mockExtra: NoteCommandExtra
  path: string
  style: 'mock' | 'tauri'
  tauriExtra: NoteCommandExtra
  vaultPath: string
}) {
  return style === 'tauri'
    ? { vaultPath, oldPath: path, ...tauriExtra }
    : { vault_path: vaultPath, old_path: path, ...mockExtra }
}

function invokeNoteCommand(params: NoteCommandRequest): Promise<RenameResult> {
  return invokeStructuredRenameCommand({
    command: params.command,
    args: noteCommandArgs({ ...params, style: 'tauri' }),
    mockArgs: noteCommandArgs({ ...params, style: 'mock' }),
  })
}

function performSingleValueNoteCommand({
  descriptor,
  path,
  value,
  vaultPath,
  openPaths,
}: {
  descriptor: SingleValueNoteCommand
  path: string
  value: string
  vaultPath: string
  openPaths?: readonly string[]
}) {
  const open = openPaths ? { tauri: { openPaths: [...openPaths] }, mock: { open_paths: [...openPaths] } } : { tauri: {}, mock: {} }
  return invokeNoteCommand({
    command: descriptor.command,
    path,
    vaultPath,
    tauriExtra: { [descriptor.tauriKey]: value, ...open.tauri },
    mockExtra: { [descriptor.mockKey]: value, ...open.mock },
  })
}

export async function performFilenameRename({
  path,
  newFilenameStem,
  vaultPath,
  openPaths = [],
}: FilenameRenameRequest): Promise<RenameResult> {
  return performSingleValueNoteCommand({
    descriptor: FILENAME_RENAME_COMMAND,
    path,
    value: newFilenameStem,
    vaultPath,
    openPaths,
  })
}

export async function performMoveNoteToFolder({
  path,
  folderPath,
  vaultPath,
}: FolderMoveRequest): Promise<RenameResult> {
  return performSingleValueNoteCommand({
    descriptor: FOLDER_MOVE_COMMAND,
    path,
    value: folderPath,
    vaultPath,
  })
}

export async function performMoveNoteToWorkspace({
  path,
  sourceVaultPath,
  destinationVaultPath,
  replacementTarget,
}: WorkspaceMoveRequest): Promise<RenameResult> {
  const tauriReplacementTarget = replacementTarget ?? null
  return invokeRenameCommand({
    command: 'move_note_to_workspace',
    tauriArgs: {
      args: {
        sourceVaultPath,
        destinationVaultPath,
        oldPath: path,
        replacementTarget: tauriReplacementTarget,
      },
    },
    mockArgs: {
      source_vault_path: sourceVaultPath,
      destination_vault_path: destinationVaultPath,
      old_path: path,
      replacement_target: tauriReplacementTarget,
    },
  })
}

export function buildRenamedEntry(entry: VaultEntry, newTitle: string, newPath: string): VaultEntry {
  const filename = notePathFilename(newPath)
  // The old source does not describe the new title.
  return { ...entry, path: newPath, filename, title: newTitle, titleSource: undefined }
}

function titleFollowsFilename(entry: VaultEntry): boolean {
  if (entry.titleSource) return entry.titleSource === 'filename'
  return !entry.hasH1 && entry.title === filenameStemToTitle(entry.filename)
}

export function buildFilenameRenamedEntry(entry: VaultEntry, newPath: string): VaultEntry {
  const filename = notePathFilename(newPath)
  const title = titleFollowsFilename(entry) ? filenameStemToTitle(filename) : entry.title
  return { ...entry, path: newPath, filename, title }
}

/** The renamed file's own content decides its title, as a native reload would. */
function withContentTitle(entry: VaultEntry, content: string): VaultEntry {
  if (entry.fileKind && entry.fileKind !== 'markdown') return entry
  return { ...entry, ...deriveDisplayTitleState({ content, filename: notePathFilename(entry.path) }) }
}

export function buildWorkspaceMovedEntry(entry: VaultEntry, newPath: string, workspace: WorkspaceIdentity): VaultEntry {
  return {
    ...buildFilenameRenamedEntry(entry, newPath),
    workspace,
  }
}

export function workspaceMoveReplacementTarget({
  entry,
  sourceVaultPath,
  destinationWorkspace,
}: {
  entry: VaultEntry
  sourceVaultPath: string
  destinationWorkspace: WorkspaceIdentity
}): string {
  const localTarget = relativePathStem(entry.path, sourceVaultPath)
  const sourceAlias = entry.workspace?.alias
  return destinationWorkspace.alias && destinationWorkspace.alias !== sourceAlias
    ? `${destinationWorkspace.alias}/${localTarget}`
    : localTarget
}

export async function loadNoteContent({ path, vaultPath }: LoadNoteContentRequest): Promise<string> {
  const args = vaultPath ? { path, vaultPath } : { path }
  return isTauri() ? invoke<string>('get_note_content', args) : mockInvoke<string>('get_note_content', args)
}

/** Null when the moved file can't be read back; the move itself has still happened. */
async function readRenamedContent(path: string): Promise<string | null> {
  try {
    return await loadNoteContent({ path })
  } catch (err) {
    console.warn('Failed to reload a renamed note:', err)
    return null
  }
}

function rewriteSummaryLabel(params: { updatedFiles: number }): string {
  return params.updatedFiles === 1 ? 'Updated 1 note' : `Updated ${params.updatedFiles} notes`
}

function manualUpdateWarning(params: { failedUpdates: number }): string {
  const { failedUpdates } = params
  return `${failedUpdates} linked note${failedUpdates > 1 ? 's' : ''} need${failedUpdates === 1 ? 's' : ''} manual updates`
}

function formatRewriteToast(params: {
    action: string
    updatedFiles: number
    failedUpdates?: number
    preferBareUpdate?: boolean
}): string {
  const { action, updatedFiles, failedUpdates = 0, preferBareUpdate = false } = params
  if (failedUpdates > 0) {
    if (updatedFiles === 0) {
      return `${action}, but ${manualUpdateWarning({ failedUpdates })}`
    }
    if (preferBareUpdate) {
      return `${rewriteSummaryLabel({ updatedFiles })}, but ${manualUpdateWarning({ failedUpdates })}`
    }
    return `${action} and ${rewriteSummaryLabel({ updatedFiles }).toLowerCase()}, but ${manualUpdateWarning({ failedUpdates })}`
  }
  if (updatedFiles === 0) return action
  return preferBareUpdate
    ? rewriteSummaryLabel({ updatedFiles })
    : `${action} and ${rewriteSummaryLabel({ updatedFiles }).toLowerCase()}`
}

export function renameToastMessage(updatedFiles: number, failedUpdates = 0): string {
  return formatRewriteToast({
    action: 'Renamed',
    updatedFiles,
    failedUpdates,
    preferBareUpdate: true,
  })
}

function folderLabel(params: { folderPath: string }): string {
  return vaultRelativePathLabel(params.folderPath)
}

function moveToastMessage(folderPath: string, updatedFiles: number, failedUpdates = 0): string {
  return formatRewriteToast({
    action: `Moved to "${folderLabel({ folderPath })}"`,
    updatedFiles,
    failedUpdates,
  })
}

function moveWorkspaceToastMessage(workspaceLabel: string, updatedFiles: number, failedUpdates = 0): string {
  return formatRewriteToast({
    action: `Moved to "${workspaceLabel}"`,
    updatedFiles,
    failedUpdates,
  })
}

export async function reloadVaultAfterRename(reloadVault?: () => Promise<unknown>): Promise<void> {
  if (!reloadVault) return
  try {
    await reloadVault()
  } catch (err) {
    console.warn('Failed to reload vault after rename:', err)
  }
}

/**
 * Legacy blind reload, kept only for workspace moves and callers not yet on the managed rename
 * seam. It replaces tab text without before-image proof; managed renames never use it.
 * @deprecated Use `runManagedRename` receipts for filename, title and automatic renames.
 */
export async function reloadTabsAfterRename({
  tabPaths,
  updateTabContent,
}: ReloadTabsAfterRenameRequest): Promise<void> {
  for (const tabPath of tabPaths) {
    try {
      updateTabContent(tabPath, await loadNoteContent({ path: tabPath }))
    } catch {
      /* skip tabs that fail to reload */
    }
  }
}

interface Tab {
  entry: VaultEntry
  content: string
}

function findRenameEntry(entries: VaultEntry[], tabs: Tab[], path: string): VaultEntry | undefined {
  return findByNotePath(entries, path) ?? tabs.find((tab) => notePathsMatch(tab.entry.path, path))?.entry
}

function resolveRenameVaultPath(entry: VaultEntry | undefined, fallbackVaultPath: string): string {
  return entry ? vaultPathForEntry(entry, fallbackVaultPath) : fallbackVaultPath
}

function renameErrorMessage(err: unknown): string {
  const message = typeof err === 'string' ? err.trim() : err instanceof Error ? err.message.trim() : ''
  if (message === 'A note with that name already exists' || message === 'Invalid filename') {
    return message
  }
  return 'Failed to rename note'
}

function moveNoteErrorMessage(err: unknown): string {
  const message = typeof err === 'string' ? err.trim() : err instanceof Error ? err.message.trim() : ''
  return message || 'Failed to move note'
}

export interface NoteRenameConfig {
  entries: VaultEntry[]
  setToastMessage: (msg: string | null) => void
  reloadVault?: () => Promise<unknown>
  onPathRenamed?: (oldPath: string, newPath: string) => void
  /** Claims each linked open page's save lane for a managed rename (useAppSave seam). */
  mutateExistingDocument?: MutateExistingDocument
  /** Rebases or holds the renamed page's newer text before its hold is released (useAppSave seam). */
  rebaseHeldDraft?: RebaseHeldDraft
  /** Pages besides the source whose text the app holds: open tabs and pending writes. */
  linkedPaths?: (sourcePath: string) => readonly string[]
  /** Defaults to the window's one admission shared with automatic renames. */
  admission?: RenameAdmission
  /** The settled outcome, for callers that keep a page path (commentary capture, cards). */
  onRenameSettled?: (oldPath: string, result: ManagedRenameResult) => void
}

interface RenameTabDeps {
  tabs: Tab[]
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>
  activeTabPathRef: React.MutableRefObject<string | null>
  handleSwitchTab: (path: string) => void
  updateTabContent: (path: string, content: string) => void
}

interface ApplyRenameOptions {
  successMessage?: (result: RenameResult) => string
  /** The page's tab text when the native operation started; undefined when it was not open. */
  sourceContent?: string
}

function shownTabContent(tabs: Tab[], path: string): string | undefined {
  return tabs.find((tab) => notePathsMatch(tab.entry.path, path))?.content
}

function useRenameResultApplier(config: NoteRenameConfig, tabDeps: RenameTabDeps) {
  const { entries, setToastMessage, reloadVault, onPathRenamed } = config
  const { setTabs, activeTabPathRef, handleSwitchTab, updateTabContent } = tabDeps

  const tabsRef = useRef(tabDeps.tabs)
  // eslint-disable-next-line react-hooks/refs
  tabsRef.current = tabDeps.tabs

  const applyRenameResult = useCallback(
    async (
    oldPath: string,
    result: RenameResult,
    buildEntry: (entry: VaultEntry | undefined, newPath: string) => VaultEntry,
    onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void,
    options?: ApplyRenameOptions,
  ) => {
    const currentTabs = tabsRef.current
    const entry = findRenameEntry(entries, currentTabs, oldPath)
    const shownContent = shownTabContent(currentTabs, oldPath)
    const movedEntry = buildEntry(entry, result.new_path)
    const otherTabPaths = currentTabs
      .filter((tab) => !notePathsMatch(tab.entry.path, oldPath) && !notePathsMatch(tab.entry.path, result.new_path))
      .map((tab) => tab.entry.path)
    // The file has already moved: its new path and tab go live before the optional read, so nothing saves to the old name.
    if (!notePathsMatch(oldPath, result.new_path)) onPathRenamed?.(oldPath, result.new_path)
    setTabs((prev) =>
      prev.map((tab) => (notePathsMatch(tab.entry.path, oldPath) ? { entry: movedEntry, content: tab.content } : tab)),
    )
    if (notePathsMatch(activeTabPathRef.current, oldPath)) handleSwitchTab(result.new_path)
    const refreshed = await readRenamedContent(result.new_path)
    // The copy read back replaces only the text the operation started from; text typed during it is newer.
    const settled = (content: string) => (refreshed !== null && content === options?.sourceContent ? refreshed : content)
    const entryFor = (content: string | undefined) => (content === undefined ? movedEntry : withContentTitle(movedEntry, content))
    setTabs((prev) => prev.map((tab) => {
      if (!notePathsMatch(tab.entry.path, result.new_path)) return tab
      const content = settled(tab.content)
      return { entry: entryFor(content), content }
    }))
    const newContent = shownContent === undefined ? refreshed ?? undefined : settled(shownContent)
    onEntryRenamed(oldPath, entryFor(newContent), newContent ?? '')
      await reloadTabsAfterRename({
        tabPaths: otherTabPaths,
        updateTabContent,
      })
    await reloadVaultAfterRename(reloadVault)
    const successMessage = options?.successMessage
      ? options.successMessage(result)
      : renameToastMessage(result.updated_files, result.failed_updates ?? 0)
    setToastMessage(refreshed === null ? translate('leadinglight.rename.refreshFailed', { done: successMessage }) : successMessage)
    return result
    },
    [
      entries,
      setTabs,
      activeTabPathRef,
      handleSwitchTab,
      updateTabContent,
      reloadVault,
      setToastMessage,
      onPathRenamed,
    ],
  )

  return {
    tabsRef,
    applyRenameResult,
  }
}

async function runRenameAction(options: {
  path: string
  perform: () => Promise<RenameResult>
  applyRenameResult: (
    oldPath: string,
    result: RenameResult,
    buildEntry: (entry: VaultEntry | undefined, newPath: string) => VaultEntry,
    onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void,
    options?: ApplyRenameOptions,
  ) => Promise<RenameResult>
  buildEntry: (entry: VaultEntry | undefined, newPath: string) => VaultEntry
  onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void
  setToastMessage: (message: string | null) => void
  errorMessage: (err: unknown) => string
  logLabel: string
  successMessage?: (result: RenameResult) => string
  allowUnchangedResult?: boolean
  sourceContent?: string
}): Promise<RenameResult | null> {
  const { path, perform, applyRenameResult, buildEntry, onEntryRenamed, setToastMessage, errorMessage, logLabel, successMessage, allowUnchangedResult = false, sourceContent } = options
  try {
    const result = await perform()
    if (allowUnchangedResult && notePathsMatch(result.new_path, path)) return result
    await applyRenameResult(path, result, buildEntry, onEntryRenamed, {
      successMessage,
      sourceContent,
    })
    return result
  } catch (err) {
    console.error(`${logLabel}:`, err)
    setToastMessage(errorMessage(err))
    return null
  }
}

type ApplyRenameResult = ReturnType<typeof useRenameResultApplier>['applyRenameResult']

function useWorkspaceMoveHandler({
  applyRenameResult,
  entries,
  setToastMessage,
  tabsRef,
}: {
  applyRenameResult: ApplyRenameResult
  entries: VaultEntry[]
  setToastMessage: (message: string | null) => void
  tabsRef: React.MutableRefObject<Tab[]>
}) {
  return useCallback(
    async (
    path: string,
    destinationWorkspace: WorkspaceIdentity,
    vaultPath: string,
    onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void,
  ) => {
    const entry = findRenameEntry(entries, tabsRef.current, path)
    if (!entry) {
      setToastMessage('Failed to move note: note not found')
      return null
    }

    const sourceVaultPath = resolveRenameVaultPath(entry, vaultPath)
    if (sourceVaultPath === destinationWorkspace.path) {
      return { new_path: path, updated_files: 0, failed_updates: 0 }
    }

    return runRenameAction({
      path,
        perform: () =>
          performMoveNoteToWorkspace({
        path,
        sourceVaultPath,
        destinationVaultPath: destinationWorkspace.path,
            replacementTarget: workspaceMoveReplacementTarget({
              entry,
              sourceVaultPath,
              destinationWorkspace,
            }),
      }),
      applyRenameResult,
        buildEntry: (currentEntry, newPath) =>
          buildWorkspaceMovedEntry(currentEntry ?? entry, newPath, destinationWorkspace),
      onEntryRenamed,
      setToastMessage,
      errorMessage: moveNoteErrorMessage,
      logLabel: 'Failed to move note to workspace',
        successMessage: (result) =>
          moveWorkspaceToastMessage(destinationWorkspace.label, result.updated_files, result.failed_updates ?? 0),
      allowUnchangedResult: true,
      sourceContent: shownTabContent(tabsRef.current, path),
    })
    },
    [applyRenameResult, entries, setToastMessage, tabsRef],
  )
}

interface LocalRenameHandlerContext {
  config: NoteRenameConfig
  tabDeps: RenameTabDeps
  entries: VaultEntry[]
  setToastMessage: NoteRenameConfig['setToastMessage']
  tabsRef: ReturnType<typeof useRenameResultApplier>['tabsRef']
}

/** Plain-language outcome of a managed rename; counts failed and held pages truthfully. */
export function managedRenameToast(result: ManagedRenameResult, refused: (result: Extract<ManagedRenameResult, { status: 'refused' }>) => string): string | null {
  switch (result.status) {
    case 'unchanged':
      return null
    case 'refused':
      return refused(result)
    case 'unknown':
      return translate('leadinglight.rename.unknown')
    case 'renamed': {
      const { receipt } = result
      const failed = receipt.failed_updates + result.heldPaths.length + result.stalePaths.length
      const done = renameToastMessage(receipt.updated_files, failed)
      return result.sourceHeld
        ? translate('leadinglight.rename.draftHeld', { done })
        : done
    }
  }
}

/** The existing refusal copy for a managed rename that sent nothing or was refused before commit. */
export function refusedRenameMessage(result: Extract<ManagedRenameResult, { status: 'refused' }>): string {
  if (result.reason === 'native') return renameErrorMessage(result.error)
  if (result.reason === 'busy') return translate('leadinglight.page.busy')
  return translate('leadinglight.rename.notSaved')
}

function filenameRenameOldTitle(entry: VaultEntry | undefined, content: string | undefined, path: string): string {
  if (content !== undefined) return deriveDisplayTitleState({ content, filename: notePathFilename(path) }).title
  return entry?.title ?? filenameStemToTitle(notePathFilename(path))
}

function useLocalRenameHandler(context: LocalRenameHandlerContext, mode: 'title' | 'filename') {
  const { config, tabDeps, entries, setToastMessage, tabsRef } = context
  return useCallback(
    async (
      path: string,
      value: string,
      vaultPath: string,
      onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void,
    ) => {
      const entry = findRenameEntry(entries, tabsRef.current, path)
      const renameVaultPath = resolveRenameVaultPath(entry, vaultPath)
      const buildEntry = mode === 'title'
        ? (currentEntry: VaultEntry | undefined, newPath: string) => buildRenamedEntry(currentEntry ?? ({} as VaultEntry), value, newPath)
        : (currentEntry: VaultEntry | undefined, newPath: string) => buildFilenameRenamedEntry(currentEntry ?? ({} as VaultEntry), newPath)
      const shown = shownTabContent(tabsRef.current, path)
      try {
        const result = await runManagedRename({
          sourcePath: path,
          vaultPath: renameVaultPath,
          oldTitle: mode === 'title' ? entry?.title ?? '' : filenameRenameOldTitle(entry, shown, path),
          destination: { siblingOf: path },
          readSource: () => loadNoteContent({ path, vaultPath: renameVaultPath }),
          // Only after a valid receipt: a page it left unrefreshed continues from its exact bytes.
          readPage: page => loadNoteContent({ path: page, vaultPath: renameVaultPath }),
          dispatch: openPaths => mode === 'title'
            ? performRename({ path, newTitle: value, vaultPath: renameVaultPath, oldTitle: entry?.title, openPaths })
            : performFilenameRename({ path, newFilenameStem: value, vaultPath: renameVaultPath, openPaths }),
          // The file has already moved: its new path and tab go live before anything else.
          route: (oldPath, newPath) => {
            const moved = buildEntry(entry, newPath)
            config.onPathRenamed?.(oldPath, newPath)
            tabDeps.setTabs(prev => prev.map(tab => notePathsMatch(tab.entry.path, oldPath) ? { entry: moved, content: tab.content } : tab))
            if (notePathsMatch(tabDeps.activeTabPathRef.current, oldPath)) tabDeps.handleSwitchTab(newPath)
          },
        }, {
          admission: config.admission,
          mutateExistingDocument: config.mutateExistingDocument,
          rebaseHeldDraft: config.rebaseHeldDraft,
          tabsRef,
          setTabs: tabDeps.setTabs,
          linkedPaths: config.linkedPaths,
        })
        config.onRenameSettled?.(path, result)
        if (result.status === 'renamed') {
          const renamed = withContentTitle(buildEntry(entry, result.receipt.new_path), result.sourceText)
          tabDeps.setTabs(prev => prev.map(tab => notePathsMatch(tab.entry.path, result.receipt.new_path) ? { ...tab, entry: renamed } : tab))
          onEntryRenamed(path, renamed, result.sourceText)
          await reloadVaultAfterRename(config.reloadVault)
        } else if (result.status === 'unknown') {
          await reloadVaultAfterRename(config.reloadVault)
        }
        const message = managedRenameToast(result, refusedRenameMessage)
        if (message) setToastMessage(message)
      } catch (err) {
        console.error(mode === 'title' ? 'Failed to rename note:' : 'Failed to rename note filename:', err)
        setToastMessage(renameErrorMessage(err))
      }
    },
    [config, entries, mode, setToastMessage, tabDeps, tabsRef],
  )
}

export function useNoteRename(config: NoteRenameConfig, tabDeps: RenameTabDeps) {
  const { entries, setToastMessage, onPathRenamed } = config
  const { tabsRef, applyRenameResult } = useRenameResultApplier(config, tabDeps)
  const handlerContext = { config, tabDeps, entries, setToastMessage, tabsRef }
  const handleRenameNote = useLocalRenameHandler(handlerContext, 'title')
  const handleRenameFilename = useLocalRenameHandler(handlerContext, 'filename')
  const commitFolderRelocation = useCallback((oldPath: string, newPath: string) => {
    if (!notePathsMatch(oldPath, newPath)) onPathRenamed?.(oldPath, newPath)
  }, [onPathRenamed])

  const handleMoveNoteToFolder = useCallback(
    async (
      path: string,
      folderPath: string,
      vaultPath: string,
      onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void,
    ) => {
    const normalizedFolderPath = normalizeVaultRelativePath(folderPath)
    const entry = findRenameEntry(entries, tabsRef.current, path)
    const moveVaultPath = resolveRenameVaultPath(entry, vaultPath)
    return runRenameAction({
      path,
        perform: () =>
          performMoveNoteToFolder({
            path,
            folderPath: normalizedFolderPath,
            vaultPath: moveVaultPath,
          }),
      applyRenameResult,
      buildEntry: (currentEntry, newPath) => buildFilenameRenamedEntry(currentEntry ?? ({} as VaultEntry), newPath),
      onEntryRenamed,
      setToastMessage,
      errorMessage: moveNoteErrorMessage,
      logLabel: 'Failed to move note to folder',
        successMessage: (result) =>
          moveToastMessage(normalizedFolderPath, result.updated_files, result.failed_updates ?? 0),
      allowUnchangedResult: true,
      sourceContent: shownTabContent(tabsRef.current, path),
    })
    },
    [entries, tabsRef, applyRenameResult, setToastMessage],
  )

  const handleMoveNoteToWorkspace = useWorkspaceMoveHandler({
    applyRenameResult,
    entries,
    setToastMessage,
    tabsRef,
  })

  return {
    commitFolderRelocation,
    handleRenameNote,
    handleRenameFilename,
    handleMoveNoteToFolder,
    handleMoveNoteToWorkspace,
    tabsRef,
  }
}
