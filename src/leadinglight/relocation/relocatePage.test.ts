import { describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '../../types'
import { relocatePage, type RelocationServices, type RelocationSnapshot } from './relocatePage'

const source = { entry: { path: '/vault/drafts/page.md' } as VaultEntry, content: 'saved source' }
const incoming = { entry: { path: '/vault/incoming.md' } as VaultEntry, content: 'saved incoming' }
const snapshot: RelocationSnapshot = { source, pages: [source, incoming], destinationPath: '/vault/filed/page.md' }
const receipt = { new_path: snapshot.destinationPath, updated_files: 1, failed_updates: 0, source_before_content: source.content,
  source_content: 'rebased source', updated_open_pages: [{ path: incoming.entry.path, before_content: incoming.content, content: 'rebased incoming' }], unrefreshed_open_paths: [] }

function fixture() {
  const events: string[] = []
  const release = vi.fn(() => { events.push('release') })
  const services: RelocationServices = {
    current: () => true,
    begin: () => { events.push('hold'); return release },
    prepare: async () => { events.push('drain'); return snapshot },
    detach: () => { events.push('detach') },
    dispatch: vi.fn(async () => { events.push('native'); return receipt }),
    sourceUnchanged: vi.fn(async () => false),
    commit: () => { events.push('canonical') },
    reopen: vi.fn(async () => { events.push('reopen'); return [] }),
    closeUnconfirmed: vi.fn(() => { events.push('closeUnconfirmed') }),
    refresh: async () => { events.push('refresh') },
  }
  return { services, events, release }
}

describe('saved folder relocation boundary', () => {
  it('holds synchronously, retires old editors before native and commits canonical routing before reopen', async () => {
    const { services, events, release } = fixture()
    const work = relocatePage(services)
    expect(events).toEqual(['hold', 'drain'])
    expect((await work).status).toBe('moved')
    expect(events).toEqual(['hold', 'drain', 'detach', 'native', 'canonical', 'reopen', 'refresh', 'release'])
    expect(release).toHaveBeenCalledOnce()
  })
  it('does not detach or dispatch when admitted imports/composition/save cannot settle', async () => {
    const { services, events } = fixture()
    services.prepare = async () => { throw new Error('composition still reconciling') }
    expect(await relocatePage(services)).toEqual({ status: 'refused', reason: 'notSaved' })
    expect(events).toEqual(['hold', 'release'])
  })
  it('never reopens an unproven old source or retries a missing native reply', async () => {
    const { services, release } = fixture()
    services.dispatch = vi.fn(async () => { throw new Error('reply lost') })
    expect(await relocatePage(services)).toEqual({ status: 'unknown' })
    expect(services.dispatch).toHaveBeenCalledOnce()
    expect(services.reopen).not.toHaveBeenCalled()
    expect(services.closeUnconfirmed).toHaveBeenCalledWith(snapshot)
    expect(release).toHaveBeenCalledOnce()
  })
  it('reopens saved originals only after an exact old-source proof', async () => {
    const { services } = fixture()
    services.dispatch = async () => { throw new Error('collision') }
    services.sourceUnchanged = async () => true
    expect(await relocatePage(services)).toEqual({ status: 'refused', reason: 'move' })
    expect(services.reopen).toHaveBeenCalledWith(snapshot, null)
  })
  it('keeps a committed move successful when list refresh fails or some saved editors remain closed', async () => {
    const { services } = fixture()
    services.reopen = async () => ['/vault/incoming.md']
    services.refresh = async () => { throw new Error('list unreadable') }
    expect(await relocatePage(services)).toEqual({ status: 'moved', receipt, refreshPending: true, unavailable: ['/vault/incoming.md'] })
  })
})
