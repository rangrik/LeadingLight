import { describe, expect, it } from 'vitest'
import { mockInvoke } from './index'
import { setNoteFavorite } from './mock-favorite'

type Result = { status: string, content?: string, written?: boolean, durable?: boolean, reason?: string }
const PATH = '/vault/m4-favorite-mock.md'
const read = (path: string) => mockInvoke<string>('get_note_content', { path })

describe('browser set_note_favorite', () => {
  // Seam: in the browser the star must land in the page itself, so a reload still shows it.
  it('stars and unstars through the registered command, touching only the two keys', async () => {
    await mockInvoke('save_note_content', { path: PATH, content: '---\nstatus: Active\n---\nBody\n' })

    const starred = await mockInvoke<Result>('set_note_favorite', { path: PATH, favorite: true, favoriteIndex: 2 })
    expect(starred).toMatchObject({ status: 'committed', written: true, durable: false })
    expect(await read(PATH)).toBe(starred.content)
    expect(starred.content).toContain('status: Active')
    expect(starred.content).toContain('_favorite: true')
    expect(starred.content).toContain('_favorite_index: 2')
    expect(starred.content?.endsWith('Body\n')).toBe(true)

    // Already in the requested state: no write, and the page text comes back for the rebase.
    const again = await mockInvoke<Result>('set_note_favorite', { path: PATH, favorite: true, favoriteIndex: 2 })
    expect(again).toEqual({ status: 'committed', content: starred.content, written: false, durable: true })

    const unstarred = await mockInvoke<Result>('set_note_favorite', { path: PATH, favorite: false, favoriteIndex: null })
    expect(unstarred.content).not.toContain('_favorite')
    expect(await read(PATH)).toBe(unstarred.content)
  })

  it('refuses a page it cannot patch and never claims an unchanged file after a failed write', async () => {
    let writes = 0
    const write = async () => { writes += 1; throw new Error('disk gone') }
    expect(await setNoteFavorite({ path: PATH, favorite: true, favoriteIndex: 1 }, async () => '---\ntitle: open', write))
      .toEqual({ status: 'refused', reason: 'invalidFrontmatter' })
    expect(writes).toBe(0)
    expect(await setNoteFavorite({ path: PATH, favorite: true, favoriteIndex: 1 }, async () => 'Body\n', write))
      .toEqual({ status: 'uncertain', originalAt: null, stagedAt: null })
  })
})
