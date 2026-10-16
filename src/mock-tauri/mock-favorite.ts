import { patchFavoriteKeys, type FavoriteState, type NativeFavoriteResult } from '../leadinglight/favoriteKeys'

export interface SetNoteFavoriteArgs {
  path: string
  favorite: boolean
  favoriteIndex: number | null
}

type ReadNote = (path: string) => Promise<string>
type WriteNote = (path: string, content: string) => Promise<unknown>

function requestedState({ favorite, favoriteIndex }: SetNoteFavoriteArgs): FavoriteState {
  if (!favorite) return { favorite: false, favoriteIndex: null }
  if (!Number.isInteger(favoriteIndex)) throw new Error('A Favorite needs a whole-number position')
  return { favorite: true, favoriteIndex: favoriteIndex as number }
}

/**
 * Browser stand-in for native `set_note_favorite`: one read, Safety's two-key patch, one plain write.
 * Nothing here is atomic or synced, so a failed write is uncertain, never "unchanged".
 */
export async function setNoteFavorite(args: SetNoteFavoriteArgs, read: ReadNote, write: WriteNote): Promise<NativeFavoriteResult> {
  const state = requestedState(args)
  let content: string
  try {
    content = await read(args.path)
  } catch {
    // Nothing was written.
    return { status: 'failed', reason: 'stage' }
  }
  const patched = patchFavoriteKeys(content, state)
  if (patched === null) return { status: 'refused', reason: 'invalidFrontmatter' }
  if (patched === content) return { status: 'committed', content, written: false, durable: true }
  try {
    await write(args.path, patched)
  } catch {
    return { status: 'uncertain', originalAt: null, stagedAt: null }
  }
  return { status: 'committed', content: patched, written: true, durable: false }
}
