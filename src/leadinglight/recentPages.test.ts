import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RECENT_PAGES_LIMIT, readRecentPages, renameRecentPage, touchRecentPage, writeRecentPages } from './recentPages'

describe('recent pages storage', () => {
  beforeEach(() => localStorage.clear())

  it('keeps one bounded most-recent-first entry per page', () => {
    let pages = touchRecentPage([], '/vault/a.md', 1)
    for (let i = 0; i < RECENT_PAGES_LIMIT + 5; i++) pages = touchRecentPage(pages, `/vault/${i}.md`, i + 2)
    pages = touchRecentPage(pages, '/vault/3.md', 99)
    expect(pages).toHaveLength(RECENT_PAGES_LIMIT)
    expect(pages[0]).toEqual({ path: '/vault/3.md', openedAt: 99 })
    expect(pages.filter(page => page.path === '/vault/3.md')).toHaveLength(1)
    expect(pages.some(page => page.path === '/vault/a.md')).toBe(false)
  })

  it('round-trips per vault and treats malformed or unavailable storage as empty', () => {
    writeRecentPages('/vault', [{ path: '/vault/a.md', openedAt: 1 }])
    expect(readRecentPages('/vault')).toEqual([{ path: '/vault/a.md', openedAt: 1 }])
    expect(readRecentPages('/other')).toEqual([])

    localStorage.setItem('leadinglight.recentPages:/broken', '{not json')
    localStorage.setItem('leadinglight.recentPages:/shape', JSON.stringify([{ path: 4 }, { path: '/shape/a.md', openedAt: 2 }, 'x']))
    expect(readRecentPages('/broken')).toEqual([])
    expect(readRecentPages('/shape')).toEqual([{ path: '/shape/a.md', openedAt: 2 }])

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    expect(() => writeRecentPages('/vault', [])).not.toThrow()
    setItem.mockRestore()
  })

  it('moves a renamed page without losing its place', () => {
    const pages = [{ path: '/vault/b.md', openedAt: 2 }, { path: '/vault/a.md', openedAt: 1 }, { path: '/vault/c.md', openedAt: 0 }]
    expect(renameRecentPage(pages, '/vault/a.md', '/vault/a2.md')).toEqual([
      { path: '/vault/b.md', openedAt: 2 }, { path: '/vault/a2.md', openedAt: 1 }, { path: '/vault/c.md', openedAt: 0 },
    ])
    // Renaming onto a path already in history keeps one entry, at the renamed page's place.
    expect(renameRecentPage(pages, '/vault/a.md', '/vault/c.md')).toEqual([
      { path: '/vault/b.md', openedAt: 2 }, { path: '/vault/c.md', openedAt: 1 },
    ])
    expect(renameRecentPage(pages, '/vault/x.md', '/vault/y.md')).toBe(pages)
  })

  it('keeps a page whose rename only changes case or path spelling', () => {
    const pages = [{ path: '/vault/b.md', openedAt: 2 }, { path: '/private/tmp/a.md', openedAt: 1 }]
    expect(renameRecentPage(pages, '/private/tmp/a.md', '/tmp/a.md')).toEqual([
      { path: '/vault/b.md', openedAt: 2 }, { path: '/tmp/a.md', openedAt: 1 },
    ])
    expect(renameRecentPage(pages, '/vault/b.md', '/vault/B.md')).toEqual([
      { path: '/vault/B.md', openedAt: 2 }, { path: '/private/tmp/a.md', openedAt: 1 },
    ])
  })
})
