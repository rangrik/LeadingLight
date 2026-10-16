import { useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke, updateMockContent } from '../mock-tauri'
import { cacheNoteContent } from './useTabManagement'
import {
  parseCopyOutcome, parseResolutionOutcome, parseSaveOutcome, parseSaveRequestState,
  type ConfirmedSnapshot, type CopyOutcome, type DraftSnapshot, type OriginalRequest,
  type ResolutionOutcome, type SaveOutcome, type SaveRequestState,
} from '../leadinglight/saveOutcome'

/** The parsed answer, or null when there is no usable reply: the caller must hold the page, never retry. */
async function ask<T>(command: string, args: Record<string, unknown>, parse: (value: unknown) => T | null): Promise<T | null> {
  try {
    const reply = isTauri() ? await invoke(command, args) : await mockInvoke(command, args)
    const parsed = parse(reply)
    if (parsed === null) console.warn(`[save] ${command} returned an unknown answer`)
    return parsed
  } catch (error) {
    console.warn(`[save] ${command} gave no reply:`, error)
    return null
  }
}

export const savePageContent = (request: OriginalRequest, content: string): Promise<SaveOutcome | null> =>
  ask('save_page_content', { request, content }, parseSaveOutcome)

/** A query only; it never saves. */
export const checkSaveOutcome = (request: OriginalRequest): Promise<SaveRequestState | null> =>
  ask('check_save_outcome', { request }, parseSaveRequestState)

export const saveDraftAsNewPage = (
  request: OriginalRequest, draft: DraftSnapshot, operationId: string, folder: string | null,
): Promise<CopyOutcome | null> =>
  ask('save_draft_as_new_page', { request, draft, operationId, folder }, parseCopyOutcome)

export const releaseHoldWithCopy = (
  request: OriginalRequest, actionId: string, confirmed: ConfirmedSnapshot, operationId: string,
): Promise<ResolutionOutcome | null> =>
  ask('release_hold_with_copy', { request, actionId, confirmed, operationId }, parseResolutionOutcome)

export const discardHold = (
  request: OriginalRequest, actionId: string, confirmed: ConfirmedSnapshot,
): Promise<ResolutionOutcome | null> =>
  ask('discard_hold', { request, actionId, confirmed }, parseResolutionOutcome)

/**
 * The page writer. `saveNote` only asks native; `commitSaved` records committed bytes in memory,
 * and the queue calls it only for a committed outcome of its current session.
 */
export function useSaveNote(updateContent: (path: string, content: string) => void) {
  const saveNote = useCallback((request: OriginalRequest, content: string) => savePageContent(request, content), [])
  const commitSaved = useCallback((path: string, content: string) => {
    cacheNoteContent(path, content)
    if (!isTauri()) updateMockContent(path, content)
    updateContent(path, content)
  }, [updateContent])
  return { saveNote, commitSaved }
}
