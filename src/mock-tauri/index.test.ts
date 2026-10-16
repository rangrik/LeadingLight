import { afterEach, describe, expect, it, vi } from 'vitest'
import { isTauri } from './index'

// The desktop harness calls window.__mockHandlers directly, bypassing mockInvoke's vault API step.
describe('save recovery handlers', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
    document.head.querySelector('meta[name="leadinglight-vault-api"]')?.remove()
  })

  it('answer a disk vault from the dev server and surface its failure instead of a memory answer', async () => {
    document.head.insertAdjacentHTML('beforeend', '<meta name="leadinglight-vault-api" content="disk">')
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => String(input) === '/api/vault/ping'
      ? new Response(JSON.stringify({ ok: true }))
      : new Response(JSON.stringify({ error: 'Save recovery failed' }), { status: 500 })) as typeof fetch
    const handler = window.__mockHandlers?.save_page_content
    await expect(Promise.resolve(handler?.({ request: {}, content: '' }))).rejects.toThrow('Save recovery failed')
  })
})

const originalIsTauri = (globalThis as { isTauri?: unknown }).isTauri
const windowWithLegacyMarkers = window as Window & {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

describe('isTauri', () => {
  afterEach(() => {
    if (originalIsTauri === undefined) {
      delete (globalThis as { isTauri?: unknown }).isTauri
    } else {
      ;(globalThis as { isTauri?: unknown }).isTauri = originalIsTauri
    }

    delete windowWithLegacyMarkers.__TAURI__
    delete windowWithLegacyMarkers.__TAURI_INTERNALS__
  })

  it('prefers the Tauri v2 global runtime flag', () => {
    ;(globalThis as { isTauri?: unknown }).isTauri = true

    expect(isTauri()).toBe(true)
  })

  it('respects an explicit false runtime flag', () => {
    ;(globalThis as { isTauri?: unknown }).isTauri = false
    windowWithLegacyMarkers.__TAURI__ = {}

    expect(isTauri()).toBe(false)
  })

  it('falls back to the legacy window markers when the runtime flag is absent', () => {
    delete (globalThis as { isTauri?: unknown }).isTauri
    windowWithLegacyMarkers.__TAURI_INTERNALS__ = {}

    expect(isTauri()).toBe(true)
  })
})
