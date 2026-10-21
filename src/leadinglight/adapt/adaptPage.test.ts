import { describe, expect, it, vi } from 'vitest'
import { snapshotPage, type PageSeam } from './adaptPage'

function seam(pages: Record<string, string>) {
  const state = { active: 'A.md' as string | null, vault: '/vaults/one' }
  let release: () => void = () => {}
  const settle = vi.fn<(path: string) => Promise<void>>(() => new Promise<void>(done => { release = done }))
  const read = vi.fn((path: string) => (path in pages ? { title: path.replace('.md', ''), text: pages[path] } : null))
  const value: PageSeam = { activePath: () => state.active, vault: () => state.vault, settle, read }
  return { value, state, settle, read, release: () => release() }
}

describe('attaching the current page', () => {
  it('attaches the clicked page once its text is saved', async () => {
    const page = seam({ 'A.md': '# A\n\nsaved' })
    const taking = snapshotPage(page.value)
    expect(page.settle).toHaveBeenCalledWith('A.md')
    page.release()
    expect(await taking).toEqual({ title: 'A', text: '# A\n\nsaved' })
  })

  it('attaches nothing when another page comes to the front while the clicked one is saving', async () => {
    const page = seam({ 'A.md': 'a', 'B.md': 'b, unsaved' })
    const taking = snapshotPage(page.value)
    page.state.active = 'B.md'
    page.release()
    expect(await taking).toBe('pageChanged')
    expect(page.read).not.toHaveBeenCalled()
  })

  it('attaches nothing when the vault changes while saving, or when saving fails, or with no page open', async () => {
    const moved = seam({ 'A.md': 'a' })
    const taking = snapshotPage(moved.value)
    moved.state.vault = '/vaults/two'
    moved.release()
    expect(await taking).toBe('pageChanged')

    const failing = seam({ 'A.md': 'a' })
    failing.settle.mockRejectedValueOnce(new Error('disk full'))
    expect(await snapshotPage(failing.value)).toBe('notSaved')
    expect(failing.read).not.toHaveBeenCalled()

    const none = seam({})
    none.state.active = null
    expect(await snapshotPage(none.value)).toBe('noPage')
    expect(none.settle).not.toHaveBeenCalled()
  })
})
