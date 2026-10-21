import { describe, expect, it } from 'vitest'
import type { RenameReceipt } from './renameReceipt'
import { parseRenameReceipt } from './renameReceipt'
import { frontMatterReplay, linkedRebase, provenRebase, replayLines, sourceRebase, splitFrontMatter } from './renameSettlement'

const receipt = (overrides: Partial<RenameReceipt>): RenameReceipt => ({
  new_path: '/vault/Topics/plan-2.md', updated_files: 0, failed_updates: 0,
  source_before_content: '', source_content: '', updated_open_pages: [], unrefreshed_open_paths: [],
  ...overrides,
})

describe('source settlement under the source hold', () => {
  // Native title rename: front matter title written, the explicit self-link follows the new name.
  const before = '---\ntitle: Draft\n---\n# Draft\n\n[Top](./draft.md#draft) [Neighbor](./plan.md)\n'
  const after = '---\ntitle: Plan\n---\n# Draft\n\n[Top](./plan-2.md#draft) [Neighbor](./plan.md)\n'
  const renamed = receipt({ source_before_content: before, source_content: after })
  const source = { vaultPath: '/vault', oldPath: '/vault/Topics/draft.md' }

  it('turns the exact before-image into the receipt bytes', () => {
    expect(sourceRebase(renamed, source, before)(before)).toBe(after)
  })

  it('gives words typed during the rename the new title and self-link', () => {
    const draft = `${before}\nTyped during the rename, see [Top](./draft.md).\n`
    expect(sourceRebase(renamed, source, before)(draft))
      .toBe(`${after}\nTyped during the rename, see [Top](./plan-2.md).\n`)
  })

  it('holds a draft whose front matter changed under the title edit and whose lines collide', () => {
    const draft = before.replace('title: Draft', 'title: Mine')
    expect(sourceRebase(renamed, source, before)(draft)).toBeNull()
  })

  it('holds any draft when the native before-image is not the text the page was based on', () => {
    const externalBase = before.replace('# Draft', '# Draft (edited elsewhere)')
    expect(sourceRebase(renamed, source, externalBase)(`${before}More.\n`)).toBeNull()
    // The exact before-image itself still becomes the receipt bytes.
    expect(sourceRebase(renamed, source, externalBase)(before)).toBe(after)
  })

  it('applies a same-path title change too', () => {
    const unchangedPath = receipt({ new_path: '/vault/note/plan.md', source_before_content: '# Old heading\n', source_content: '---\ntitle: Plan\n---\n# Old heading\n' })
    expect(sourceRebase(unchangedPath, { vaultPath: '/vault', oldPath: '/vault/note/plan.md' }, '# Old heading\n')('# Old heading\nMore.\n'))
      .toBe('---\ntitle: Plan\n---\n# Old heading\nMore.\n')
  })

  it('leaves newer text as it is when the rename did not change the page', () => {
    const same = receipt({ source_before_content: '# Plan\n', source_content: '# Plan\n' })
    expect(sourceRebase(same, source, '# Plan\n')('# Plan\nMore.\n')).toBe('# Plan\nMore.\n')
  })
})

describe('proven rebase and exact line replay', () => {
  it('uses the transform only after it reproduces the receipt', () => {
    const rebase = provenRebase('a\nOLD\n', 'a\nNEW\n', content => content.replaceAll('OLD', 'NEW'))
    expect(rebase('a\nOLD\nOLD again\n')).toBe('a\nNEW\nNEW again\n')
    const unproven = provenRebase('a\nOLD\n', 'a\n<NEW>\n', content => content.replaceAll('OLD', 'NEW'))
    // Falls back to replaying the receipt's own changed line onto an untouched line.
    expect(unproven('a\nOLD\nmine\n')).toBe('a\n<NEW>\nmine\n')
  })

  it('replays non-overlapping changes and refuses overlapping ones', () => {
    expect(replayLines('1\n2\n3\n', '1\nTWO\n3\n', '0\n1\n2\n3\n4\n')).toBe('0\n1\nTWO\n3\n4\n')
    expect(replayLines('1\n2\n3\n', '1\nTWO\n3\n', '1\n2 mine\n3\n')).toBeNull()
    expect(replayLines('1\n2\n3\n', '1\nTWO\n3\n', '1\nTWO\n3\nx\n')).toBe('1\nTWO\n3\nx\n')
    expect(replayLines('', 'title\n', 'mine\n')).toBeNull()
    expect(replayLines('a\nb', 'a\nB', 'z\na\nb')).toBe('z\na\nB')
  })

  it('splits and replays front matter exactly', () => {
    expect(splitFrontMatter('---\na: 1\n---\nbody')).toEqual({ frontMatter: '---\na: 1\n---\n', body: 'body' })
    expect(splitFrontMatter('---\nunclosed\nbody')).toEqual({ frontMatter: '', body: '---\nunclosed\nbody' })
    const prepend = frontMatterReplay('# H\n', '---\ntitle: T\n---\n# H\n')
    expect(prepend('# H\nmore\n')).toBe('---\ntitle: T\n---\n# H\nmore\n')
    expect(prepend('---\nother: 1\n---\n# H\n')).toBeNull()
  })
})

describe('linked page settlement', () => {
  const page = { path: '/vault/Notes/c.md', before: '[Source](../Topics/plan.md)\n', after: '[Source](../Topics/goals.md)\n' }
  const renamed = receipt({ new_path: '/vault/Topics/goals.md' })
  const context = { vaultPath: '/vault', oldPath: '/vault/Topics/plan.md', oldTitle: 'Plan' }

  it('rebases a draft based on the claimed baseline', () => {
    expect(linkedRebase(renamed, { ...page, baseline: page.before }, context)('[Source](../Topics/plan.md)\nMore.\n'))
      .toBe('[Source](../Topics/goals.md)\nMore.\n')
  })

  it('never merges a draft into a different native before-image', () => {
    const rebase = linkedRebase(renamed, { ...page, before: 'External\n[Source](../Topics/plan.md)\n', after: 'External\n[Source](../Topics/goals.md)\n', baseline: page.before }, context)
    expect(rebase('[Source](../Topics/plan.md)\nMore.\n')).toBeNull()
  })
})

describe('rename receipts', () => {
  const valid = receipt({ new_path: '/vault/Topics/plan-2.md', updated_open_pages: [{ path: '/vault/Notes/c.md', before_content: 'a', content: 'b' }] })

  it('accepts a sibling destination and only requested open pages', () => {
    expect(parseRenameReceipt(valid, { sourcePath: '/vault/Topics/draft.md', openPaths: ['/vault/Notes/c.md'], destination: { siblingOf: '/vault/Topics/draft.md' } })).toEqual(valid)
    expect(parseRenameReceipt(valid, { sourcePath: '/vault/Topics/draft.md', openPaths: [], destination: { siblingOf: '/vault/Topics/draft.md' } })).toBeNull()
  })

  it('rejects another folder, a non-Markdown path and the legacy reply shape', () => {
    const request = { sourcePath: '/vault/Topics/draft.md', openPaths: ['/vault/Notes/c.md'], destination: { siblingOf: '/vault/Topics/draft.md' } }
    expect(parseRenameReceipt({ ...valid, new_path: '/vault/Other/plan.md' }, request)).toBeNull()
    expect(parseRenameReceipt({ ...valid, new_path: '/vault/Topics/plan.txt' }, request)).toBeNull()
    expect(parseRenameReceipt({ new_path: '/vault/Topics/plan.md', updated_files: 1 }, request)).toBeNull()
  })
})
