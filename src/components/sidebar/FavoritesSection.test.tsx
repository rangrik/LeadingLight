import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeEntry } from '../../test-utils/noteListTestUtils'
import { FavoritesSection } from './FavoritesSection'

const favorite = (path: string, title: string, favoriteIndex: number) =>
  makeEntry({ path, filename: path.split('/').pop(), title, favorite: true, favoriteIndex })

function renderFavorites(entries = [favorite('/v/lantern.md', 'Lantern', 0), favorite('/v/harbor/lantern.md', 'Lantern', 1), favorite('/v/garden.md', 'Garden', 2)], activePath: string | null = null) {
  return render(<FavoritesSection entries={entries} selection={{ kind: 'filter', filter: 'all' }} onSelect={vi.fn()}
    onSelectNote={vi.fn()} activePath={activePath} vaultRootPath="/v" collapsed={false} onToggle={vi.fn()} />)
}

describe('FavoritesSection', () => {
  // Seam: two starred pages with one title must be told apart, while unique titles stay uncluttered.
  it('adds a path cue only to same-title favorites and marks the open page', () => {
    renderFavorites(undefined, '/v/harbor/lantern.md')
    const row = (text: string) => screen.getByText(text).closest('button[type="button"]')
    expect(row('harbor/lantern')).toHaveAttribute('aria-current', 'page')
    expect(row('lantern')).not.toHaveAttribute('aria-current')
    expect(row('Garden')).toHaveTextContent(/^Garden$/)
  })

  it('shows one quiet first-use line only while a page is open', () => {
    const { rerender } = renderFavorites([], null)
    expect(screen.queryByText('Star a page to keep it here.')).not.toBeInTheDocument()
    rerender(<FavoritesSection entries={[]} selection={{ kind: 'filter', filter: 'all' }} onSelect={vi.fn()}
      activePath="/v/garden.md" collapsed={false} onToggle={vi.fn()} />)
    expect(screen.getByText('Star a page to keep it here.')).toBeInTheDocument()
  })
})
