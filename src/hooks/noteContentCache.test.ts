import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockInvoke } from '../mock-tauri'
import type { VaultEntry } from '../types'
import {
  cacheNoteContent,
  clearNoteContentCache,
  getCachedNoteContentEntry,
  loadContentForOpen,
} from './noteContentCache'

vi.mock('../mock-tauri', () => ({
  isTauri: vi.fn(() => false),
  mockInvoke: vi.fn(),
}))

const PATH = '/vault/page.md'
const entry: VaultEntry = {
  path: PATH, filename: 'page.md', title: 'Page', isA: null, aliases: [], belongsTo: [], relatedTo: [],
  status: null, archived: false, modifiedAt: 1700000000, createdAt: null, fileSize: 100, snippet: '',
  wordCount: 0, relationships: {}, icon: null, color: null, order: null, sidebarLabel: null,
  template: null, sort: null, view: null, visible: null, organized: false, favorite: false,
  favoriteIndex: null, listPropertiesDisplay: [], outgoingLinks: [], properties: {}, hasH1: false,
}

describe('note-content cache validation', () => {
  beforeEach(() => {
    clearNoteContentCache()
    vi.mocked(mockInvoke).mockReset()
  })

  // Seam: the wait on validate_note_content. Catches an old answer restoring text that a clear or
  // a newer save removed, and handing that stale text to the opener.
  it.each([
    ['cleared', () => clearNoteContentCache()],
    ['replaced by a newer save', () => cacheNoteContent(PATH, 'current')],
  ])('a validation that ends after the cache was %s cannot bring back the old text', async (_, interrupt) => {
    let disk = 'old'
    let answerValidation!: (fresh: boolean) => void
    vi.mocked(mockInvoke).mockImplementation((command: string) => {
      if (command === 'validate_note_content') return new Promise(resolve => { answerValidation = resolve })
      return Promise.resolve(disk)
    })
    cacheNoteContent(PATH, 'old')

    const opening = loadContentForOpen({ entry, forceReload: false, cachedEntry: getCachedNoteContentEntry(PATH) })
    disk = 'current'
    interrupt()
    answerValidation(true)

    expect(await opening).toBe('current')
    expect(getCachedNoteContentEntry(PATH)?.value).toBe('current')
  })
})
