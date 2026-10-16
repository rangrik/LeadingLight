import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { TrashDialog } from './TrashDialog'
import type { TrashItem, TrashRestoreResult } from './localTrash'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({ isTauri: () => true, mockInvoke: vi.fn() }))

const id = (n: number) => String(n).padStart(32, '0')
const item = (n: number, patch: Partial<TrashItem> = {}): TrashItem => ({ id: id(n), state: 'ready', title: `Page ${n}`,
  filename: `page-${n}.md`, originalPath: `drafts/page-${n}.md`, deletedAt: 1_760_550_000_000, fileKind: 'markdown',
  sizeBytes: 10, restoredPath: null, ...patch })

function renderDialog(items: TrashItem[], restore: (ids: string[]) => Promise<TrashRestoreResult | null>) {
  vi.mocked(invoke).mockResolvedValue(items)
  const onOpenPage = vi.fn(async () => true)
  render(<TrashDialog open onOpenChange={vi.fn()} vaultPath="/vault" locale="en" restore={restore} onOpenPage={onOpenPage} />)
  return { onOpenPage }
}

describe('Trash dialog', () => {
  it('shows where a page came from, and after Restore names where it went and drops it from the list', async () => {
    const restore = vi.fn(async () => ({ restored: [{ id: id(1), path: '/vault/drafts/page-1-2.md', relativePath: 'drafts/page-1-2.md',
      renamed: true, relocated: false, cleanupPending: false, entry: null }], failed: [] }))
    const { onOpenPage } = renderDialog([item(1)], restore)
    const row = await screen.findByRole('listitem')
    expect(row).toHaveTextContent('drafts/page-1.md')
    fireEvent.click(within(row).getByRole('button', { name: /^Restore/ }))
    expect(await screen.findByRole('status')).toHaveTextContent('Restored as drafts/page-1-2.md')
    expect(screen.queryByRole('listitem')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(onOpenPage).toHaveBeenCalledWith('/vault/drafts/page-1-2.md'))
  })

  it('keeps an item that could not be restored and says why', async () => {
    renderDialog([item(1)], async () => ({ restored: [], failed: [{ id: id(1), code: 'originalLocationUnavailable', message: '' }] }))
    fireEvent.click(await screen.findByRole('button', { name: /^Restore/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('stays in Trash')
    expect(screen.getByRole('listitem')).toBeInTheDocument()
  })

  it('shows an already restored page as restored, with Open and no second Restore', async () => {
    const restore = vi.fn()
    const { onOpenPage } = renderDialog([item(1, { state: 'cleanupPending', restoredPath: 'drafts/page-1.md' })], restore)
    const row = await screen.findByRole('listitem')
    expect(row).toHaveTextContent('Already restored to drafts/page-1.md')
    expect(within(row).queryByRole('button', { name: /^Restore/ })).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(onOpenPage).toHaveBeenCalledWith('/vault/drafts/page-1.md'))
    expect(restore).not.toHaveBeenCalled()
  })

  it('reports a restore whose leftover copy is tidied later as restored, not failed', async () => {
    renderDialog([item(1)], async () => ({ restored: [{ id: id(1), path: '/vault/drafts/page-1.md', relativePath: 'drafts/page-1.md',
      renamed: false, relocated: false, cleanupPending: true, entry: null }], failed: [] }))
    fireEvent.click(await screen.findByRole('button', { name: /^Restore/ }))
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Restored to drafts/page-1.md.')
    expect(status).toHaveTextContent('tidied up automatically')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('warns that a page with unreadable details comes back without its folder, and offers no Restore for a missing file', async () => {
    renderDialog([item(1, { state: 'needsAttention', title: null, originalPath: null, deletedAt: null, filename: 'recovered-00000000.md' }),
      item(2, { state: 'missing', sizeBytes: null })], vi.fn())
    const [unknown, missing] = await screen.findAllByRole('listitem')
    expect(unknown).toHaveTextContent('links or images in it may need repair')
    expect(within(unknown).getByRole('button', { name: /^Restore/ })).toBeInTheDocument()
    expect(missing).toHaveTextContent('can’t be restored')
    expect(within(missing).queryByRole('button')).toBeNull()
  })
})
