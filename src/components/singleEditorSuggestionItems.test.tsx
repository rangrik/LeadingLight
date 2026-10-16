import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '../types'
import { buildBaseSuggestionItems, useSuggestionMenuItems } from './singleEditorSuggestionItems'

vi.mock('./tolariaEditorFormattingConfig', () => ({ getTolariaSlashMenuItems: () => [] }))

function entry(path: string, title: string, aliases: string[] = []): VaultEntry {
  return { path, title, aliases, filename: path.split('/').at(-1), fileKind: 'markdown' } as VaultEntry
}

function options(entries: VaultEntry[], preferredPaths: readonly string[] = []) {
  return {
    baseItems: buildBaseSuggestionItems(entries), entries, editor: {} as never, locale: 'en' as const,
    insertWikilink: vi.fn(), onNavigateWikilink: vi.fn(), runEditorAction: (action: () => void) => action(),
    sourceEntry: entry('/vault/source.md', 'Source'), vaultPath: '/vault', typeEntryMap: {},
    wikilinkPreferredPaths: preferredPaths,
  }
}

describe('rich wikilink contextual suggestions', () => {
  it('promotes before the 20 result limit, retains self fallback, and refreshes preferences without insertion', async () => {
    const entries = [entry('/vault/source.md', 'Source'), ...Array.from({ length: 25 }, (_, index) => entry(`/vault/${index}.md`, `Page ${index}`))]
    const initial = options(entries, ['/vault/source.md', '/vault/24.md', '/vault/23.md', '/vault/24.md', '/vault/deleted.md'])
    const { result, rerender } = renderHook(props => useSuggestionMenuItems(props), { initialProps: initial })
    const items = await result.current.getWikilinkItems('')
    expect(items).toHaveLength(20)
    expect(items.slice(0, 4).map(item => item.path)).toEqual(['/vault/24.md', '/vault/23.md', '/vault/source.md', '/vault/0.md'])
    expect(await result.current.getAtWikilinkItems('')).toEqual([])
    rerender({ ...initial, wikilinkPreferredPaths: ['/vault/22.md'] })
    expect((await result.current.getWikilinkItems('[['))[0].path).toBe('/vault/22.md')
    expect(initial.insertWikilink).not.toHaveBeenCalled()
    expect(initial.onNavigateWikilink).not.toHaveBeenCalled()
  })

  it('keeps typed bracket and @ relevance identical regardless of preferred paths', async () => {
    const entries = [entry('/vault/ideas.md', 'Plan Ideas'), entry('/vault/plan.md', 'Plan'), entry('/vault/notes.md', 'Notes', ['Plan Notes'])]
    const initial = options(entries)
    const { result, rerender } = renderHook(props => useSuggestionMenuItems(props), { initialProps: initial })
    for (const query of ['P', 'Plan', 'Plan Notes']) {
      rerender(initial)
      const bracketBefore = await result.current.getWikilinkItems(query)
      const atBefore = await result.current.getAtWikilinkItems(query)
      rerender({ ...initial, wikilinkPreferredPaths: ['/vault/notes.md', '/vault/ideas.md'] })
      expect((await result.current.getWikilinkItems(query)).map(item => item.path)).toEqual(bracketBefore.map(item => item.path))
      expect((await result.current.getAtWikilinkItems(query)).map(item => item.path)).toEqual(atBefore.map(item => item.path))
    }
    expect((await result.current.getWikilinkItems('Plan'))[0].path).toBe('/vault/plan.md')
  })

  it('shows separate folder cues while inserting the existing canonical target once and never navigating', async () => {
    const initial = options([entry('/vault/work/shared/plan.md', 'Plan', ['Roadmap']), entry('/vault/home/shared/plan.md', 'Plan')])
    const { result } = renderHook(() => useSuggestionMenuItems(initial))
    const items = await result.current.getWikilinkItems('')
    expect(items.map(item => [item.title, item.secondaryLabel])).toEqual([['Plan', 'work/shared'], ['Plan', 'home/shared']])
    expect(items[0].aliases).toContain('Roadmap')
    items[1].onItemClick()
    expect(initial.insertWikilink).toHaveBeenCalledExactlyOnceWith('home/shared/plan', '[[')
    expect(initial.onNavigateWikilink).not.toHaveBeenCalled()
  })

  it('retains the explicit unresolved-create action and exact-title exclusion', async () => {
    const initial = options([entry('/vault/plan.md', 'Plan')], ['/vault/plan.md'])
    const { result } = renderHook(() => useSuggestionMenuItems(initial))
    expect((await result.current.getWikilinkItems('Plan')).map(item => item.path)).toEqual(['/vault/plan.md'])
    const items = await result.current.getWikilinkItems('New thought')
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Create a new note called “New thought”')
    items[0].onItemClick()
    expect(initial.insertWikilink).toHaveBeenCalledExactlyOnceWith('New thought', '[[')
    expect(initial.onNavigateWikilink).toHaveBeenCalledExactlyOnceWith('New thought')
  })
})
