import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sha256Hex } from '../leadinglight/saveOutcome'
import { MOCK_CONTENT } from './mock-content'
import './index'

// The browser's two extension paths: the mock vault in memory, and a disk session that reaches
// the dev server with an owner it issued and never falls back to memory.
const QUICK = readFileSync(`${process.cwd()}/src/leadinglight/extensions/fixtures/quick-note.json`, 'utf8')
const MARKER = 'meta[name="leadinglight-vault-api"]'
type Handler = (args?: unknown) => Promise<Record<string, unknown>>
const handler = (command: string) => window.__mockHandlers?.[command] as Handler

describe('the mock vault', () => {
  it('runs a whole create in memory and the page joins the mock vault', async () => {
    const vaultPath = '/Users/luca/Laputa'
    const listed = await handler('list_extensions')({ vaultPath })
    // Meeting debrief ships off; passage commentary is on wherever nobody turned it off. The website
    // recipe is listed but off: without the test fixture this page does not fetch.
    expect(listed).toMatchObject({ status: 'ok', extensions: [
      { packageId: 'leadinglight.meeting-debrief', activeSha256: null },
      { packageId: 'leadinglight.passage-commentary', activeSha256: expect.stringMatching(/^[0-9a-f]{64}$/), previousSha256: null },
      { packageId: 'leadinglight.website-capture', activeSha256: null },
    ] })
    expect(window.__mockHandlers?.web_capture_fetch).toBeUndefined()
    const imported = await handler('import_extension_candidate')({ packageText: QUICK })
    const packageSha256 = imported.packageSha256 as string
    expect(await handler('activate_extension_version')({ vaultPath, packageId: 'local.quick-note', packageSha256, expectedActiveSha256: null }))
      .toMatchObject({ status: 'active' })
    const { sessionId } = await handler('open_extension_session')({ vaultPath })
    const admission = await handler('begin_extension_run')({ sessionId, packageSha256, commandId: 'quick', invocationId: crypto.randomUUID() })
    const runId = (admission.scope as Record<string, string>).runId
    const { folderHandle } = await handler('bind_extension_folder')({ runId, folder: '' })
    const content = '# E1 synthetic page\n'
    const proposal = { kind: 'create', operationId: crypto.randomUUID(), runId, content, contentSha256: await sha256Hex(content), folderHandle, fileName: 'E1 synthetic page.md' }
    const receipt = await handler('submit_document_proposal')({ proposal })
    expect(receipt).toMatchObject({ status: 'committed', path: `${vaultPath}/E1 synthetic page.md`, durable: true })
    expect(MOCK_CONTENT[`${vaultPath}/E1 synthetic page.md`]).toBe(content)
    expect(await handler('query_document_proposal')({ operationId: proposal.operationId })).toEqual(receipt)
    expect(await handler('close_extension_session')({ sessionId })).toEqual({ status: 'closed' })
    await expect(handler('list_extensions')({})).rejects.toThrow()
  })
})

describe('a disk session', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
    document.head.querySelector(MARKER)?.remove()
    vi.resetModules()
    vi.restoreAllMocks()
  })

  function diskServer(reply: (url: string, body: Record<string, unknown>) => Response) {
    document.head.insertAdjacentHTML('beforeend', '<meta name="leadinglight-vault-api" content="disk">')
    const requests: [string, Record<string, unknown>][] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push([url, body])
      return reply(url, body)
    }) as typeof fetch
    return requests
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

  it('sends every command with the owner the server issued, registering once per page', async () => {
    let owners = 0
    const requests = diskServer(url => url === '/api/extensions/owner'
      ? json({ owner: `owner-${++owners}` })
      : json({ status: 'ok', extensions: [] }))
    const { tryVaultApi } = await import('./vault-api')
    expect(await tryVaultApi('list_extensions', { vaultPath: '/fixture' })).toEqual({ status: 'ok', extensions: [] })
    expect(await tryVaultApi('list_extensions', { vaultPath: '/fixture' })).toEqual({ status: 'ok', extensions: [] })
    expect(requests.map(([url]) => url)).toEqual(['/api/extensions/owner', '/api/extensions/list_extensions', '/api/extensions/list_extensions'])
    expect(requests[1][1]).toEqual({ owner: 'owner-1', args: { vaultPath: '/fixture' } })
    const beacon = vi.fn(() => true)
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true })
    window.dispatchEvent(new Event('pagehide'))
    expect(beacon).toHaveBeenCalledWith('/api/extensions/owner-end', expect.any(Blob))
    await tryVaultApi('list_extensions', { vaultPath: '/fixture' })
    expect(requests.at(-1)?.[1]).toEqual({ owner: 'owner-2', args: { vaultPath: '/fixture' } })
  })

  it('surfaces a failed or missing server instead of answering from memory', async () => {
    let ownerAvailable = false
    diskServer(url => {
      if (url === '/api/extensions/owner') return ownerAvailable ? json({ owner: 'owner-1' }) : json({ error: 'down' }, 503)
      return json({ error: 'The extension registry is not a folder' }, 500)
    })
    const { tryVaultApi } = await import('./vault-api')
    await expect(tryVaultApi('list_extensions', { vaultPath: '/Users/luca/Laputa' })).rejects.toThrow('not answering')
    ownerAvailable = true
    await expect(tryVaultApi('submit_document_proposal', { proposal: {} })).rejects.toThrow('not a folder')
    await expect(handler('open_extension_session')({ vaultPath: '/Users/luca/Laputa' })).rejects.toThrow()
  })
})
