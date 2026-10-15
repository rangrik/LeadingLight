import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '../types'
import { useVaultLoader } from './useVaultLoader'

const backend = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke: backend }))
vi.mock('../mock-tauri', () => ({ isTauri: () => true, mockInvoke: backend }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function entry(vault: string): VaultEntry {
  return {
    path: `${vault}/note.md`, filename: 'note.md', title: vault,
    isA: 'Note', aliases: [], belongsTo: [], relatedTo: [], status: null,
    archived: false, modifiedAt: 1, createdAt: 1, fileSize: 1, snippet: '',
    wordCount: 0, relationships: {}, icon: null, color: null, order: null,
    template: null, sort: null, outgoingLinks: [],
  }
}

function installBackend(options: {
  list: (path: string) => Promise<VaultEntry[]>
  snapshot?: (path: string) => VaultEntry[] | null
  reload?: (path: string) => Promise<VaultEntry[]>
  available?: boolean
}) {
  backend.mockImplementation((command: string, args?: { path?: string }) => {
    const path = args?.path ?? ''
    if (command === 'read_vault_snapshot') return Promise.resolve(options.snapshot?.(path) ?? null)
    if (command === 'list_vault') return options.list(path)
    if (command === 'reload_vault') return (options.reload ?? options.list)(path)
    if (command === 'check_vault_exists') return Promise.resolve(options.available ?? true)
    return Promise.resolve([])
  })
}

beforeEach(() => backend.mockReset())

describe('vault listing readiness provenance', () => {
  it('never presents old-vault entries as a completed new-vault listing, including a valid empty result', async () => {
    const next = deferred<VaultEntry[]>()
    installBackend({ list: path => path === '/a' ? Promise.resolve([entry('/a')]) : next.promise })
    const renders: Array<{ path: string; loaded: string | null; entries: string[] }> = []
    const { result, rerender } = renderHook(({ path }) => {
      const value = useVaultLoader(path)
      renders.push({ path, loaded: value.loadedVaultPath, entries: value.entries.map(note => note.path) })
      return value
    }, { initialProps: { path: '/a' } })
    await waitFor(() => expect(result.current.loadedVaultPath).toBe('/a'))

    rerender({ path: '/b' })
    expect(result.current.loadedVaultPath).not.toBe('/b')
    expect(renders.some(value => value.path === '/b' && value.loaded === '/b')).toBe(false)
    await act(async () => next.resolve([]))
    await waitFor(() => expect(result.current.loadedVaultPath).toBe('/b'))
    expect(result.current.entries).toEqual([])
    expect(result.current.isLoading).toBe(false)
    expect(renders.some(value => value.path === '/b' && value.loaded === '/b' && value.entries.includes('/a/note.md'))).toBe(false)
  })

  it('does not accept a superseded vault load as current readiness', async () => {
    const first = deferred<VaultEntry[]>()
    const second = deferred<VaultEntry[]>()
    installBackend({ list: path => path === '/a' ? first.promise : second.promise })
    const { result, rerender } = renderHook(({ path }) => useVaultLoader(path), { initialProps: { path: '/a' } })
    await waitFor(() => expect(backend).toHaveBeenCalledWith('list_vault', { path: '/a' }))
    rerender({ path: '/b' })
    await act(async () => first.resolve([entry('/a')]))
    expect(result.current.loadedVaultPath).toBeNull()
    expect(result.current.entries).toEqual([])
    await act(async () => second.resolve([entry('/b')]))
    await waitFor(() => expect(result.current.loadedVaultPath).toBe('/b'))
  })

  it('renders an empty snapshot early but waits for reconciliation before restoration can treat paths as missing', async () => {
    const reconciliation = deferred<VaultEntry[]>()
    installBackend({ snapshot: () => [], list: () => reconciliation.promise })
    const { result } = renderHook(() => useVaultLoader('/a'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.entries).toEqual([])
    expect(result.current.loadedVaultPath).toBeNull()
    await act(async () => reconciliation.resolve([entry('/a')]))
    await waitFor(() => expect(result.current.loadedVaultPath).toBe('/a'))
    expect(result.current.entries.map(note => note.path)).toEqual(['/a/note.md'])
  })

  it.each([false, true])('a failed listing is not a valid empty list (vault available: %s), and a successful retry can recover', async available => {
    installBackend({ list: () => Promise.reject(new Error('Read failed')), reload: () => Promise.resolve([entry('/a')]), available })
    const { result } = renderHook(() => useVaultLoader('/a'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.loadedVaultPath).toBeNull()
    await act(async () => { await result.current.reloadVault() })
    expect(result.current.loadedVaultPath).toBe('/a')
    expect(result.current.entries.map(note => note.path)).toEqual(['/a/note.md'])
  })

  it('does not authorize restoration when snapshot reconciliation fails', async () => {
    const reconciliation = deferred<VaultEntry[]>()
    installBackend({ snapshot: () => [entry('/a')], list: () => reconciliation.promise })
    const { result } = renderHook(() => useVaultLoader('/a'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => reconciliation.reject(new Error('Scan failed')))
    expect(result.current.loadedVaultPath).toBeNull()
    expect(result.current.entries).toHaveLength(1)
  })

  it('does not promote snapshot-only entries to completed workspace reuse when metadata arrives', async () => {
    const reconciliation = deferred<VaultEntry[]>()
    installBackend({ snapshot: () => [entry('/a')], list: () => reconciliation.promise })
    const { result, rerender } = renderHook(
      ({ vaults }: { vaults?: Array<{ label: string; path: string }> }) => useVaultLoader('/a', vaults),
      { initialProps: { vaults: undefined } },
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    rerender({ vaults: [{ label: 'A', path: '/a' }] })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.loadedVaultPath).toBeNull()
    await act(async () => reconciliation.resolve([entry('/a')]))
    await waitFor(() => expect(result.current.loadedVaultPath).toBe('/a'))
  })

  it('marks a reused workspace ready only after its progressive listing previously completed', async () => {
    const second = deferred<VaultEntry[]>()
    installBackend({ list: path => path === '/a' ? Promise.resolve([entry('/a')]) : second.promise })
    const vaults = [{ label: 'A', path: '/a' }, { label: 'B', path: '/b' }]
    const { result, rerender } = renderHook(({ path }) => useVaultLoader(path, vaults, '/a'), { initialProps: { path: '/a' } })
    await waitFor(() => expect(result.current.loadedVaultPath).toBe('/a'))
    await waitFor(() => expect(backend).toHaveBeenCalledWith('list_vault', { path: '/b' }))
    await act(async () => second.resolve([entry('/b')]))
    await waitFor(() => expect(result.current.entries).toHaveLength(2))
    const previousLoads = backend.mock.calls.filter(([command, args]) => command === 'list_vault' && args?.path === '/b').length
    rerender({ path: '/b' })
    await waitFor(() => expect(result.current.loadedVaultPath).toBe('/b'))
    expect(result.current.entries).toHaveLength(2)
    expect(backend.mock.calls.filter(([command, args]) => command === 'list_vault' && args?.path === '/b')).toHaveLength(previousLoads)
  })
})
