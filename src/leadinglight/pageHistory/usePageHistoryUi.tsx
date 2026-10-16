import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { requestEditorFocus } from '../../hooks/useEditorFocus'
import type { OpenReservation } from '../../hooks/useNoteCreation'
import type { AppLocale } from '../../lib/i18n'
import { isTauri, mockInvoke } from '../../mock-tauri'
import type { FolderNode, VaultEntry } from '../../types'
import { notePathsMatch } from '../../utils/notePathIdentity'
import { flattenRetargetFolders, prependVaultRootFolderDestination } from '../../utils/noteRetargetingPaths'
import { vaultPathForEntry } from '../../utils/workspaces'
import { pageLabel } from '../pageLabel'
import type { PaneId } from '../useSplitWorkspace'
import { PageHistoryDialog, PageHistoryWarning, type HistoryFolder, type PageHistoryTarget } from './PageHistoryDialog'
import { absoluteIn } from './pageHistoryText'
import type { PageHistoryHealth } from './usePageHistoryHealth'

interface Opening extends PageHistoryTarget { session: string; pane: PaneId; returnFocus: HTMLElement | null }

const local = <T,>(command: string, args: Record<string, unknown>) => isTauri() ? invoke<T>(command, args) : mockInvoke<T>(command, args)

/** The copy as it is on disk now, at its exact path; never a guess from the list. */
async function readCopy(path: string, vaultPath: string): Promise<{ entry: VaultEntry; content: string } | null> {
  try {
    const args = { path, vaultPath }
    const [entry, content] = await Promise.all([local<VaultEntry>('reload_vault_entry', args), local<string>('get_note_content', args)])
    if (notePathsMatch(entry?.path, path) && typeof content === 'string') return { entry, content }
  } catch (error) {
    console.warn('[page history] The copy could not be read:', error)
  }
  return null
}

/** Earlier versions for the app: who asked, from which pane, and the quiet per-vault warning. */
export function usePageHistoryUi({ vaultPath, entries, folders, locale, health, focusPane, reserveOpen, addEntry, onCopyCreated }: {
  /** The open vault; a switch ends any opening. */
  vaultPath: string
  entries: VaultEntry[]
  folders: FolderNode[]
  locale: AppLocale
  health: PageHistoryHealth
  focusPane: (pane: PaneId) => void
  reserveOpen: () => OpenReservation
  addEntry: (entry: VaultEntry) => void
  onCopyCreated: () => void
}) {
  const [opening, setOpening] = useState<Opening | null>(null)
  const [session, setSession] = useState(vaultPath)
  if (session !== vaultPath) {
    // A vault switch ends every opening, so returning to that vault never brings one back.
    setSession(vaultPath)
    setOpening(null)
  }
  const latest = useRef({ entries, vaultPath, onCopyCreated })
  useLayoutEffect(() => { latest.current = { entries, vaultPath, onCopyCreated } })
  const pageVault = useCallback((path: string) => {
    const entry = latest.current.entries.find(item => notePathsMatch(item.path, path))
    return { entry, vault: entry ? vaultPathForEntry(entry, vaultPath) : vaultPath }
  }, [vaultPath])
  const open = useCallback((path: string, pane: PaneId, returnFocus: HTMLElement | null) => {
    const { entry, vault } = pageVault(path)
    const title = entry ? pageLabel(entry, locale) : path.split('/').pop() ?? path
    setOpening({ session: vaultPath, pane, returnFocus, path, vaultPath: vault, title })
  }, [locale, pageVault, vaultPath])
  const target = session === vaultPath ? opening : null
  const close = useCallback(() => setOpening(null), [])
  // The copy is real either way; only the vault it was made in, while open, is refreshed.
  const copyCreated = useCallback((madeIn: string) => {
    if (latest.current.vaultPath === madeIn) latest.current.onCopyCreated()
  }, [])

  const openCopy = useCallback(async (path: string) => {
    if (!target) return false
    // The pane that asked; the other pane keeps its page and focus.
    focusPane(target.pane)
    const reservation = reserveOpen()
    const page = await readCopy(path, target.vaultPath)
    if (!page || !reservation.inSession()) return false
    addEntry(page.entry)
    try {
      const shown = await reservation.open(page.entry, page.content)
      if (shown && reservation.isActive()) requestEditorFocus({ path: page.entry.path })
      return shown
    } catch (error) {
      console.warn('[page history] The copy could not be opened:', error)
      return false
    }
  }, [addEntry, focusPane, reserveOpen, target])

  const historyFolders = useMemo<HistoryFolder[]>(() => {
    if (!target) return []
    const nodes = folders.filter(node => (node.rootPath ?? vaultPath) === target.vaultPath)
    return prependVaultRootFolderDestination(flattenRetargetFolders(nodes), target.vaultPath)
      .map(folder => ({ path: folder.path ? absoluteIn(target.vaultPath, folder.path) : target.vaultPath, label: folder.label, detail: folder.path || '/' }))
  }, [folders, target, vaultPath])

  const { warnings, check, tracker } = health
  const renderStatus = (path: string, pane: PaneId) => {
    const warning = warnings.get(pageVault(path).vault)
    return warning ? <PageHistoryWarning warning={warning} locale={locale} onOpen={trigger => open(path, pane, trigger)} /> : null
  }
  const dialog = (
    <PageHistoryDialog target={target} locale={locale} returnFocus={target?.returnFocus ?? null}
      warning={target ? warnings.get(target.vaultPath) ?? null : null} tracker={tracker}
      onCheckHealth={() => { if (target) void check(target.vaultPath) }}
      folders={historyFolders} onClose={close} onOpenCopy={openCopy} onCopyCreated={() => { if (target) copyCreated(target.session) }} />
  )
  return { open, renderStatus, dialog }
}
