import { describe, expect, it } from 'vitest'
import { isUntitledFilename, normalizeFilenameStem, setFrontmatterTitle, titleToSlug } from './renameNaming'

// Mirrors src-tauri/src/vault/rename.rs and frontmatter/ops.rs so the browser names pages like native.
describe('native rename naming parity', () => {
  it('slugs titles like title_to_slug', () => {
    expect(titleToSlug('Weekly Review')).toBe('weekly-review')
    expect(titleToSlug('My  Note!  ')).toBe('my-note')
    expect(titleToSlug('你好')).toBe('你好')
    expect(titleToSlug('My Note 你好')).toBe('my-note-你好')
    expect(titleToSlug('项目-2025  ✦  Q1')).toBe('项目-2025-q1')
    expect(titleToSlug('！？')).toBe('untitled')
    expect(titleToSlug('---')).toBe('untitled')
  })

  it('validates filename stems like validate_filename_stem', () => {
    expect(normalizeFilenameStem(' draft.v2.md ')).toBe('draft.v2')
    expect(() => normalizeFilenameStem('   ')).toThrow('New filename cannot be empty')
    for (const stem of ['quarterly:plan', 'con', 'Lpt1.txt', 'trailing.', 'a/b', '..']) {
      expect(() => normalizeFilenameStem(stem), stem).toThrow('Invalid filename')
    }
  })

  it('recognises one-shot untitled candidates', () => {
    expect(isUntitledFilename('untitled-note-1700000000.md')).toBe(true)
    expect(isUntitledFilename('untitled-42.md')).toBe(true)
    expect(isUntitledFilename('untitled-note.md')).toBe(false)
    expect(isUntitledFilename('note-1700000000.md')).toBe(false)
  })

  it('writes the title field like update_frontmatter_content', () => {
    expect(setFrontmatterTitle('# Old Heading\n', 'New Heading')).toBe('---\ntitle: New Heading\n---\n# Old Heading\n')
    expect(setFrontmatterTitle('---\nIs A: Note\n---\n# Weekly Review\n', 'Sprint')).toBe('---\nIs A: Note\ntitle: Sprint\n---\n# Weekly Review\n')
    expect(setFrontmatterTitle('---\ntitle: Old Name\nIs A: Note\n---\n# Old\n', 'New Name')).toBe('---\ntitle: New Name\nIs A: Note\n---\n# Old\n')
    expect(setFrontmatterTitle('---\r\ntitle: Old\r\ntype: Note\r\n---\r\nBody', 'New')).toBe('---\r\ntitle: New\r\ntype: Note\r\n---\r\nBody')
    expect(setFrontmatterTitle('---\n---\n', 'Renamed Note')).toBe('---\ntitle: Renamed Note\n---\n')
    expect(setFrontmatterTitle('---\ntitle:\n  - a\n  - b\nnext: 1\n---\n', 'Plain')).toBe('---\ntitle: Plain\nnext: 1\n---\n')
    expect(setFrontmatterTitle('# H\n', 'Plan: Q1 #2')).toBe('---\ntitle: "Plan: Q1 #2"\n---\n# H\n')
    expect(setFrontmatterTitle('# H\n', '2025')).toBe('---\ntitle: "2025"\n---\n# H\n')
    expect(setFrontmatterTitle('---\ntitle: x\nunclosed\n', 'New')).toBe('---\ntitle: x\nunclosed\n')
  })
})
