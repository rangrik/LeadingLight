import { afterEach, describe, expect, it, vi } from 'vitest'

const marker = '<meta name="leadinglight-vault-api" content="disk">'
afterEach(() => {
  document.head.querySelector('meta[name="leadinglight-vault-api"]')?.remove()
  vi.resetModules()
  vi.unstubAllGlobals()
})

describe('folder relocation preview boundary', () => {
  it('sends a disk relocation to the dev server bridge and never falls back to memory', async () => {
    document.head.insertAdjacentHTML('beforeend', marker)
    const fetch = vi.fn(async (input: RequestInfo | URL) => String(input) === '/api/vault/ping'
      ? new Response(JSON.stringify({ ok: true }), { status: 200 })
      : new Response(JSON.stringify({ error: 'A note with that name already exists' }), { status: 409 }))
    vi.stubGlobal('fetch', fetch)
    const { tryVaultApi } = await import('./vault-api')
    await expect(tryVaultApi('move_note_to_folder', {
      vault_path: '/synthetic-vault', old_path: '/synthetic-vault/page.md', folder_path: 'filed', open_paths: ['/synthetic-vault/a.md'],
    })).rejects.toThrow('already exists')
    const [url, init] = fetch.mock.calls[1] as unknown as [string, RequestInit]
    expect(url).toBe('/api/vault/move-note-to-folder')
    expect(JSON.parse(String(init.body))).toEqual({
      vault_path: '/synthetic-vault', old_path: '/synthetic-vault/page.md', folder_path: 'filed', open_paths: ['/synthetic-vault/a.md'],
    })
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

  it('rebases ordinary destinations like native and refuses forms native refuses, before any change', async () => {
    const { mockHandlers } = await import('./mock-handlers')
    const root = '/Users/mock/relocation'
    const source = `${root}/draft.md`
    mockHandlers.save_note_content({ path: source, content: '![Synthetic](./photo.png)\n' })
    expect(mockHandlers.move_note_to_folder({ vault_path: root, old_path: source, folder_path: 'filed' }))
      .toMatchObject({ new_path: `${root}/filed/draft.md`, source_content: '![Synthetic](../photo.png)\n' })
    const html = `${root}/html.md`
    const content = "<img src='./photo.png'>\n"
    mockHandlers.save_note_content({ path: html, content })
    expect(() => mockHandlers.move_note_to_folder({ vault_path: root, old_path: html, folder_path: 'filed' })).toThrow('HTML link or image')
    expect(mockHandlers.get_note_content({ path: html })).toBe(content)
  })
})
