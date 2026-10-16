import { invoke } from '@tauri-apps/api/core'
import { favoriteStateOf, patchFavoriteKeys, type FavoriteState, type NativeFavoriteResult, type NativeRefusal } from './favoriteKeys'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { DocumentMutation, MutationIntegration, MutationRefusal, MutationSettled } from '../hooks/useEditorSave'
import type { MutateExistingDocument } from '../hooks/useAppSave'

export { carryTopLevelKeys, favoriteStateOf, patchFavoriteKeys } from './favoriteKeys'
export type { FavoriteState, NativeFavoriteResult } from './favoriteKeys'

type NativeUncertain = Extract<NativeFavoriteResult, { status: 'uncertain' }>

/** An uncertain result carries what the page held, read before its lane was let go. */
export type FavoriteResult = Exclude<NativeFavoriteResult, NativeUncertain> | (NativeUncertain & { onDisk: FavoriteState | null })

/** `current` is false once the vault session that admitted the change has closed. */
export type FavoriteOutcome = { current: boolean } & (
  | { status: 'committed'; path: string; state: FavoriteState; written: boolean; durable: boolean; integration: MutationIntegration }
  | { status: 'refused'; reason: MutationRefusal | NativeRefusal }
  | { status: 'failed'; reason: 'saveFailed' | 'stage' | 'publish' }
  | { status: 'uncertain'; path: string; originalAt: string | null; stagedAt: string | null; onDisk: FavoriteState | null }
)

export type FavoriteRequest =
  | { status: 'refused'; reason: MutationRefusal }
  | { status: 'admitted'; path: string; done: Promise<FavoriteOutcome> }

export type ApplyFavoriteState = (path: string, state: FavoriteState) => FavoriteRequest

const RESULT_STATUSES = new Set(['committed', 'refused', 'failed', 'uncertain'])

async function writeFavorite(path: string, state: FavoriteState): Promise<NativeFavoriteResult> {
  const args = { path, favorite: state.favorite, favoriteIndex: state.favoriteIndex }
  try {
    const result = isTauri()
      ? await invoke<NativeFavoriteResult>('set_note_favorite', args)
      : await mockInvoke<NativeFavoriteResult>('set_note_favorite', args)
    if (result && RESULT_STATUSES.has(result.status)) return result
  } catch (error) {
    console.warn('[favorites] The Favorite change returned no known result:', error)
  }
  // Anything else is an unknown outcome, never a rollback.
  return { status: 'uncertain', originalAt: null, stagedAt: null }
}

export function favoriteMutation(state: FavoriteState): Omit<DocumentMutation<FavoriteResult>, 'flushBuffers'> {
  return {
    publish: async path => {
      const result = await writeFavorite(path, state)
      // Read while the lane is still held, so no later write of this page shows up in it.
      return result.status === 'uncertain' ? { ...result, onDisk: await readFavoriteOnDisk(path) } : result
    },
    committedContent: result => (result.status === 'committed' ? result.content : null),
    rebase: content => patchFavoriteKeys(content, state),
  }
}

export function favoriteOutcome(state: FavoriteState, settled: MutationSettled<FavoriteResult>): FavoriteOutcome {
  const { current } = settled
  if (settled.kind === 'notRun') return { status: 'failed', reason: 'saveFailed', current }
  if (settled.kind === 'unknown') return { status: 'uncertain', path: settled.path, originalAt: null, stagedAt: null, onDisk: null, current }
  const { result, path } = settled
  switch (result.status) {
    case 'committed':
      return { status: 'committed', path, state, written: result.written, durable: result.durable, integration: settled.integration, current }
    case 'refused':
      return { status: 'refused', reason: result.reason, current }
    case 'failed':
      return { status: 'failed', reason: result.reason, current }
    case 'uncertain':
      return { status: 'uncertain', path, originalAt: result.originalAt, stagedAt: result.stagedAt, onDisk: result.onDisk, current }
  }
}

export function requestFavoriteState(
  mutateExistingDocument: MutateExistingDocument | undefined,
  path: string,
  state: FavoriteState,
): FavoriteRequest {
  if (!mutateExistingDocument) return { status: 'refused', reason: 'noVault' }
  const admission = mutateExistingDocument(path, favoriteMutation(state))
  if (!admission.admitted) return { status: 'refused', reason: admission.reason }
  return { status: 'admitted', path: admission.path, done: admission.done.then(settled => favoriteOutcome(state, settled)) }
}

/** One read after an uncertain outcome, to show what the page actually holds. */
async function readFavoriteOnDisk(path: string): Promise<FavoriteState | null> {
  try {
    const content = isTauri()
      ? await invoke<string>('get_note_content', { path })
      : await mockInvoke<string>('get_note_content', { path })
    return typeof content === 'string' ? favoriteStateOf(content) : null
  } catch {
    return null
  }
}
