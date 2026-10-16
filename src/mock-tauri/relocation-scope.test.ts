import { afterEach, describe, expect, it, vi } from 'vitest'

const marker = '<meta name="leadinglight-vault-api" content="disk">'
afterEach(() => {
  document.head.querySelector('meta[name="leadinglight-vault-api"]')?.remove()
  vi.resetModules()
  vi.unstubAllGlobals()
})

describe('folder relocation preview boundary', () => {
  it('refuses a disk relocation when the browser cannot provide native reference preservation', async () => {
    document.head.insertAdjacentHTML('beforeend', marker)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const { tryVaultApi } = await import('./vault-api')
    await expect(tryVaultApi('move_note_to_folder', {
      vault_path: '/synthetic-vault', old_path: '/synthetic-vault/page.md', folder_path: 'filed',
    })).rejects.toThrow('desktop app')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns exact receipts for in-memory plain-page relocation, including incoming wiki links', async () => {
    const { mockHandlers } = await import('./mock-handlers')
    const root = '/Users/mock/relocation'
    const source = `${root}/drafts/draft.md`
    const other = `${root}/other.md`
    mockHandlers.save_note_content({ path: source, content: '# Synthetic draft\n[[drafts/draft]]\n' })
    mockHandlers.save_note_content({ path: other, content: '[[drafts/draft]]\n' })
    const result = mockHandlers.move_note_to_folder({
      vault_path: root, old_path: source, folder_path: 'filed', open_paths: [source, other],
    })
    expect(result).toMatchObject({
      new_path: `${root}/filed/draft.md`, source_before_content: '# Synthetic draft\n[[drafts/draft]]\n',
      source_content: '# Synthetic draft\n[[filed/draft]]\n', updated_open_pages: [{
        path: other, before_content: '[[drafts/draft]]\n', content: '[[filed/draft]]\n',
      }], unrefreshed_open_paths: [],
    })
  })

  it('refuses unsupported memory-reference transforms before changing any page', async () => {
    const { mockHandlers } = await import('./mock-handlers')
    const root = '/Users/mock/relocation'
    const source = `${root}/draft.md`
    const content = '![Synthetic](./photo.png)\n'
    mockHandlers.save_note_content({ path: source, content })
    expect(() => mockHandlers.move_note_to_folder({ vault_path: root, old_path: source, folder_path: 'filed' })).toThrow('desktop app')
    expect(mockHandlers.get_note_content({ path: source })).toBe(content)
  })
})
