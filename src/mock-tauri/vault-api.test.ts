import { afterEach, describe, expect, it, vi } from 'vitest'

const originalFetch = globalThis.fetch

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function requestUrl(input: RequestInfo | URL) {
  return input instanceof Request ? input.url : String(input)
}

function requestBody(init?: RequestInit) {
  return JSON.parse(String(init?.body)) as Record<string, unknown>
}

function mockNoteContentFetch(content: string) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input)
    if (url === '/api/vault/ping') {
      return jsonResponse({ ok: true })
    }
    if (url === '/api/vault/content') {
      expect(requestBody(init)).toEqual({ path: '/fixture/alpha.md' })
      return jsonResponse({ content })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  })
  globalThis.fetch = fetchMock as typeof fetch
  return fetchMock
}

describe('tryVaultApi', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    globalThis.fetch = originalFetch
  })

  it('retries vault API discovery after an unavailable response', async () => {
    let vaultApiOnline = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      if (url === '/api/vault/ping') {
        return jsonResponse({ ok: vaultApiOnline }, vaultApiOnline ? 200 : 503)
      }
      if (url === '/api/vault/list') {
        expect(requestBody(init)).toEqual({ path: '/fixture', reload: false })
        return jsonResponse([{ title: 'Alpha Project' }])
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    globalThis.fetch = fetchMock as typeof fetch

    const { tryVaultApi } = await import('./vault-api')

    await expect(tryVaultApi('list_vault', { path: '/fixture' })).resolves.toBeUndefined()

    vaultApiOnline = true

    await expect(tryVaultApi('list_vault', { path: '/fixture' })).resolves.toEqual([{ title: 'Alpha Project' }])
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/vault/ping')).toHaveLength(2)
  })

  it('unwraps note content responses from the vault API', async () => {
    const fetchMock = mockNoteContentFetch('# Alpha Project')
    const { tryVaultApi } = await import('./vault-api')

    await expect(tryVaultApi('get_note_content', { path: '/fixture/alpha.md' })).resolves.toBe('# Alpha Project')
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/vault/ping')).toHaveLength(1)
  })

  it('validates cached note content through the vault API', async () => {
    mockNoteContentFetch('# Alpha Project')
    const { tryVaultApi } = await import('./vault-api')

    await expect(tryVaultApi('validate_note_content', {
      path: '/fixture/alpha.md',
      content: '# Alpha Project',
    })).resolves.toBe(true)
    await expect(tryVaultApi('validate_note_content', {
      path: '/fixture/alpha.md',
      content: '# Stale',
    })).resolves.toBe(false)
  })

  // Seam: a page served with a disk vault never turns a failed write into an in-memory success.
  describe('on a page served by the dev vault server', () => {
    afterEach(() => document.head.querySelector('meta[name="leadinglight-vault-api"]')?.remove())
    const servedByDevVault = () => document.head.insertAdjacentHTML('beforeend', '<meta name="leadinglight-vault-api" content="disk">')
    const replying = (...replies: (Response | Error)[]) => vi.fn(async (input: RequestInfo | URL) => {
      if (requestUrl(input) === '/api/vault/ping') return jsonResponse({ ok: true })
      const reply = replies.shift() ?? new Error('no server')
      if (reply instanceof Error) throw reply
      return reply
    })

    it('answers a save recovery command from disk or fails, and keeps the mock vault in memory', async () => {
      const args = { request: { requestId: 'r', vaultPath: '/fixture' }, content: 'text' }
      const fetchMock = replying(
        jsonResponse({ status: 'committed', written: true, durable: true, history: null }),
        jsonResponse({ error: 'Save recovery failed' }, 500),
        jsonResponse({ error: 'notDiskVault' }, 404),
      )
      globalThis.fetch = fetchMock as typeof fetch
      const { tryVaultApi } = await import('./vault-api')
      const memoryArgs = { request: { vaultPath: '/Users/mock/demo-vault-v2' } }
      await expect(tryVaultApi('save_page_content', args)).resolves.toBeUndefined()
      servedByDevVault()

      await expect(tryVaultApi('save_page_content', args)).resolves.toMatchObject({ status: 'committed' })
      const [url, init] = fetchMock.mock.calls[1] as unknown as [RequestInfo, RequestInit]
      expect([requestUrl(url), requestBody(init)]).toEqual(['/api/vault/save-page-content', args])
      await expect(tryVaultApi('save_page_content', args)).rejects.toThrow('Save recovery failed')
      await expect(tryVaultApi('save_page_content', args)).rejects.toThrow('notDiskVault')
      await expect(tryVaultApi('save_page_content', args)).rejects.toThrow('no server')
      await expect(tryVaultApi('save_page_content', memoryArgs)).resolves.toBeUndefined()
      expect(fetchMock).toHaveBeenCalledTimes(5)
    })

    it('answers page history from disk or fails, never from memory, and keeps the mock vault in memory', async () => {
      const args = { vaultPath: '/fixture' }
      const fetchMock = replying(
        jsonResponse({ state: 'on', reason: null, usedBytes: 0, budgetBytes: 1, unreadable: 0, attention: [] }),
        jsonResponse({ error: 'notDiskVault' }, 404),
      )
      globalThis.fetch = fetchMock as typeof fetch
      const { tryVaultApi } = await import('./vault-api')
      servedByDevVault()

      await expect(tryVaultApi('page_history_health', args)).resolves.toMatchObject({ state: 'on' })
      const [url, init] = fetchMock.mock.calls[1] as unknown as [RequestInfo, RequestInit]
      expect([requestUrl(url), requestBody(init)]).toEqual(['/api/vault/page-history-health', args])
      await expect(tryVaultApi('page_history_health', args)).rejects.toThrow('notDiskVault')
      await expect(tryVaultApi('read_page_version', { vaultPath: '/fixture', id: 'x', sha256: 'y' })).rejects.toThrow('no server')
      await expect(tryVaultApi('list_saved_locations', { vaultPath: '/Users/mock', cursor: null })).resolves.toBeUndefined()
    })

    it('fails a legacy write when the server is unavailable, errs or goes away; only the mock vault falls back', async () => {
      const save = { path: '/fixture/alpha.md', content: 'new' }
      globalThis.fetch = vi.fn(async () => jsonResponse({ ok: false }, 503)) as typeof fetch
      const { tryVaultApi } = await import('./vault-api')
      servedByDevVault()
      await expect(tryVaultApi('save_note_content', save)).rejects.toThrow('not answering')

      globalThis.fetch = replying(jsonResponse({ error: 'EACCES' }, 500), jsonResponse({}, 500)) as typeof fetch
      await expect(tryVaultApi('save_note_content', save)).rejects.toThrow('EACCES')
      await expect(tryVaultApi('save_note_content', { path: '/Users/luca/Laputa/alpha.md', content: 'new' })).resolves.toBeUndefined()
      await expect(tryVaultApi('move_to_local_trash', { vaultPath: '/fixture', paths: ['alpha.md'] })).rejects.toThrow('no server')
    })
  })

  it('accepts nested Tauri command args when routing browser vault API writes', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      if (url === '/api/vault/ping') {
        return jsonResponse({ ok: true })
      }
      if (url === '/api/vault/rename') {
        expect(requestBody(init)).toEqual({
          old_path: '/fixture/untitled-note-123.md',
          new_title: 'Fresh Title',
          vault_path: '/fixture',
        })
        return jsonResponse({ new_path: '/fixture/fresh-title.md', updated_files: 0 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    globalThis.fetch = fetchMock as typeof fetch

    const { tryVaultApi } = await import('./vault-api')

    await expect(tryVaultApi('rename_note', {
      args: {
        old_path: '/fixture/untitled-note-123.md',
        new_title: 'Fresh Title',
        vault_path: '/fixture',
      },
    })).resolves.toEqual({ new_path: '/fixture/fresh-title.md', updated_files: 0 })
  })
})
