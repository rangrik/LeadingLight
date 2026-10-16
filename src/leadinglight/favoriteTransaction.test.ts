import { describe, expect, it, vi } from 'vitest'
import contract from '../shared/favoriteFrontmatterContract.json'
import { carryTopLevelKeys, favoriteMutation, favoriteOutcome, favoriteStateOf, patchFavoriteKeys, requestFavoriteState, type FavoriteState } from './favoriteTransaction'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: vi.fn(async (command: string) => (command === 'get_note_content' ? '---\n_favorite: true\n_favorite_index: 3\n---\nBody' : undefined)),
}))

const ON: FavoriteState = { favorite: true, favoriteIndex: 3 }
const OFF: FavoriteState = { favorite: false, favoriteIndex: null }

describe('the Favorite key patch', () => {
  // Same cases as the native transform, so rebased text matches what disk gets.
  it.each(contract.cases)('$name', ({ content, state, expected }) => {
    expect(patchFavoriteKeys(content, state as FavoriteState)).toBe(expected)
  })

  it('reads the keys back for an uncertain outcome', () => {
    expect(favoriteStateOf('---\n_favorite: true\n_favorite_index: 4\n---\nBody')).toEqual({ favorite: true, favoriteIndex: 4 })
    expect(favoriteStateOf('Body')).toEqual(OFF)
    expect(favoriteStateOf('---\ntitle: [unfinished\n---\nBody')).toBeNull()
  })
})

describe('carrying a written property into newer text', () => {
  const written = '---\ntitle: Old\nstatus: done\n---\nold body'
  // Newer text keeps every other byte; null keeps it unsaved rather than guess.
  it.each([
    ['replaces the key in place', '---\ntitle: New\n"status": old\ntags: [a]\n---\nnew', written, '---\ntitle: New\nstatus: done\ntags: [a]\n---\nnew'],
    ['adds a missing key', '---\ntitle: New\n---\nnew', written, '---\ntitle: New\nstatus: done\n---\nnew'],
    ['removes a deleted key', '---\nstatus: old\ntitle: New\n---\nnew', '---\ntitle: Old\n---\nold body', '---\ntitle: New\n---\nnew'],
    ['adds a block to plain text', 'new', written, '---\nstatus: done\n---\nnew'],
    ['refuses invalid properties', '---\ntitle: [oops\n---\nnew', written, null],
    ['refuses to drop a comment in the value', '---\nstatus:\n  # keep\n  - a\n---\nnew', written, null],
  ])('%s', (_name, draft, committed, expected) => {
    expect(carryTopLevelKeys(draft, committed, key => key === 'status')).toBe(expected)
  })
})

describe('Favorite outcomes', () => {
  it('never reports a missing native result as a rollback, and reads the page inside the change', async () => {
    await expect(favoriteMutation(ON).publish('/vault/a.md'))
      .resolves.toEqual({ status: 'uncertain', originalAt: null, stagedAt: null, onDisk: ON })
    expect(favoriteOutcome(ON, { kind: 'unknown', path: '/vault/a.md', error: new Error('IPC'), current: true }))
      .toEqual({ status: 'uncertain', path: '/vault/a.md', originalAt: null, stagedAt: null, onDisk: null, current: true })
    expect(favoriteOutcome(ON, { kind: 'notRun', path: '/vault/a.md', error: new Error('disk full'), current: false }))
      .toEqual({ status: 'failed', reason: 'saveFailed', current: false })
  })

  it('keeps the draft integration on a committed result and refuses without a save queue', () => {
    const result = { status: 'committed' as const, content: 'x', written: false, durable: true }
    expect(favoriteOutcome(ON, { kind: 'returned', path: '/vault/a.md', result, current: true, integration: 'unmergedDraft', latest: 'draft' }))
      .toMatchObject({ status: 'committed', written: false, integration: 'unmergedDraft' })
    expect(requestFavoriteState(undefined, '/vault/a.md', ON)).toEqual({ status: 'refused', reason: 'noVault' })
  })
})
