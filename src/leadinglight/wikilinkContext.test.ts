import { describe, expect, it } from 'vitest'
import { contextualWikilinkPaths, orderWikilinkSuggestions, withWikilinkFolderCues } from './wikilinkContext'

const entry = (path: string, fileKind: 'markdown' | 'binary' = 'markdown') => ({ path, fileKind })

describe('contextual wikilink discovery', () => {
  it('prefers the other page then real recent pages, excluding self, stale and ineligible paths', () => {
    const entries = ['/vault/source.md', '/vault/other.md', '/vault/recent.md', '/vault/fallback.md', '/vault-other/foreign.md'].map(path => entry(path))
    entries.push(entry('/vault/image.png', 'binary'))
    const preferred = contextualWikilinkPaths({
      entries, vaultPath: '/vault/', sourcePath: '/vault/source.md', otherPanePath: '/vault/other.md',
      recentPaths: ['/vault/source.md', '/vault/recent.md', '/vault/other.md', '/vault/recent.md', '/vault/deleted.md', '/vault-other/foreign.md', '/vault/image.png'],
    })
    expect(preferred).toEqual(['/vault/other.md', '/vault/recent.md'])
    expect(orderWikilinkSuggestions(entries, preferred).map(item => item.path)).toEqual([
      '/vault/other.md', '/vault/recent.md', '/vault/source.md', '/vault/fallback.md', '/vault-other/foreign.md', '/vault/image.png',
    ])
  })

  it('normalizes Windows separators and never guesses a vault when absent', () => {
    const entries = [entry('C:\\Vault\\Other.md')]
    expect(contextualWikilinkPaths({ entries, vaultPath: 'C:\\Vault', recentPaths: ['C:/Vault/Other.md'] })).toEqual(['C:\\Vault\\Other.md'])
    expect(contextualWikilinkPaths({ entries, recentPaths: ['C:/Vault/Other.md'] })).toEqual([])
    expect(contextualWikilinkPaths({ entries: [entry('/vault/../outside.md')], vaultPath: '/vault', recentPaths: ['/vault/../outside.md'] })).toEqual([])
  })
})

describe('wikilink folder cues', () => {
  it('distinguishes equal immediate folders without exposing the absolute vault path or changing metadata', () => {
    const click = () => {}
    const items = [
      { title: 'Plan', path: '/Users/synthetic/Vault/work/shared/plan.md', aliases: ['Roadmap'], onItemClick: click },
      { title: 'Plan', path: '/Users/synthetic/Vault/home/shared/plan.md', aliases: [], onItemClick: click },
      { title: 'Unique', path: '/Users/synthetic/Vault/unique.md', aliases: [], onItemClick: click },
    ]
    const result = withWikilinkFolderCues(items, '/Users/synthetic/Vault')
    expect(result.map(item => item.secondaryLabel)).toEqual(['work/shared', 'home/shared', undefined])
    expect(result[0]).toMatchObject(items[0])
    expect(result[0].onItemClick).toBe(click)
    expect(items[0]).not.toHaveProperty('secondaryLabel')
  })

  it('uses relative filenames when duplicate titles share a folder and omits unsafe paths', () => {
    const items = [
      { title: 'Plan', path: '/vault/a.md' }, { title: 'Plan', path: '/vault/b.md' },
      { title: 'Other', path: '/outside/a.md' }, { title: 'Other', path: '/outside/b.md' },
    ]
    expect(withWikilinkFolderCues(items, '/vault').map(item => item.secondaryLabel)).toEqual(['a.md', 'b.md', undefined, undefined])
  })
})
