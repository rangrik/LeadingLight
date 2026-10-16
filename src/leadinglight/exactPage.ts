import { useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import { buildNewEntry, type OpenReservation } from '../hooks/useNoteCreation'
import { requestEditorFocus } from '../hooks/useEditorFocus'
import { joinVaultPath, notePathFilename } from '../utils/notePathIdentity'
import type { VaultEntry } from '../types'

/** Shown; on disk but not shown (newer navigation, another vault, a failed outgoing save); or not available. */
export type ExactPageOutcome = 'opened' | 'created' | 'failed'

export interface ExactPageRequest {
  vaultPath: string
  relativePath: string
  title: string
  content: string
}

export interface ExactPageDeps {
  addEntry: (entry: VaultEntry) => void
  markInternalWrite?: (path: string) => void
  onNewNotePersisted?: (path: string) => void
  reserveOpen: () => OpenReservation
}

interface Page { entry: VaultEntry, content: string }

function local<T>(command: string, args: Record<string, unknown>): Promise<T> {
  return isTauri() ? invoke<T>(command, args) : mockInvoke<T>(command, args)
}

function draftEntry(path: string, title: string): VaultEntry {
  const slug = notePathFilename(path).replace(/\.md$/i, '')
  return { ...buildNewEntry({ path, slug, title, type: 'Note', status: null }), isA: null, hasH1: true }
}

/** Native create refuses an existing file, so a page made elsewhere is never replaced. */
async function createExclusively(path: string, request: ExactPageRequest): Promise<boolean> {
  try {
    await local('create_note_content', { path, content: request.content, vaultPath: request.vaultPath })
    return true
  } catch {
    return false
  }
}

/** A refused create may mean the page already exists; reading the exact path tells, without parsing errors. */
async function readExisting(path: string, vaultPath: string): Promise<Page | null> {
  const args = { path, vaultPath }
  try {
    const [content, entry] = await Promise.all([
      local<string>('get_note_content', args),
      local<VaultEntry>('reload_vault_entry', args),
    ])
    return entry?.path ? { entry, content } : null
  } catch {
    return null
  }
}

/**
 * Opens the page at an exact vault path, creating it only when no file is there.
 * Nothing reaches the listing before the disk says so, and nothing reaches another vault session.
 */
export async function openOrCreateExactPage(deps: ExactPageDeps, request: ExactPageRequest): Promise<ExactPageOutcome> {
  // Taken at the request: later navigation, a vault change or closing the pane cancels the open.
  const target = deps.reserveOpen()
  const path = joinVaultPath(request.vaultPath, request.relativePath)
  deps.markInternalWrite?.(path)
  let page: Page | null = null
  if (await createExclusively(path, request)) {
    page = { entry: draftEntry(path, request.title), content: request.content }
    if (target.inSession()) deps.onNewNotePersisted?.(path)
  } else {
    page = await readExisting(path, request.vaultPath)
    if (!page) return 'failed'
  }
  if (!target.inSession()) return 'created'
  deps.addEntry(page.entry)
  const shown = await target.open(page.entry, page.content)
  if (shown && target.isActive()) requestEditorFocus({ path: page.entry.path, cursorAtEnd: true })
  return shown ? 'opened' : 'created'
}

export function useExactPageCreation(deps: Omit<ExactPageDeps, 'reserveOpen'> & { reserveOpen?: () => OpenReservation }) {
  const { addEntry, markInternalWrite, onNewNotePersisted, reserveOpen } = deps
  return useCallback((request: ExactPageRequest): Promise<ExactPageOutcome> => {
    if (!reserveOpen) return Promise.resolve('failed')
    return openOrCreateExactPage({ addEntry, markInternalWrite, onNewNotePersisted, reserveOpen }, request)
  }, [addEntry, markInternalWrite, onNewNotePersisted, reserveOpen])
}
