import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PageHistoryDialog, type PageHistoryTarget } from './PageHistoryDialog'

// Seam: the five history commands -> the dialog. Catches stale answers landing, unverified text shown,
// unbounded fetching, a second copy from a lost reply, a silent folder fallback and focus lost on close.
type Args = Record<string, unknown>
const calls: Array<[string, Args]> = []
let answer: (command: string, args: Args) => unknown = () => null
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: async (command: string, args: Args) => { calls.push([command, args]); return answer(command, args) },
}))

const PAGE: PageHistoryTarget = { vaultPath: '/vault', path: '/vault/Notes/plan.md', title: 'Plan' }
const FOLDERS = [{ path: '/vault', label: 'Vault', detail: '/' }, { path: '/vault/Archive', label: 'Archive', detail: 'Archive' }]
const HEALTH = { state: 'on', reason: null, usedBytes: 0, budgetBytes: 100, unreadable: 0, attention: [] }
const row = (n: number) => ({
  id: `${'a'.repeat(32)}/${1_760_000_000_000 + n}-${'b'.repeat(16)}-00000${n}`,
  recordedPath: 'Notes/plan.md', capturedAt: 1_760_000_000_000 + n * 60_000, reason: 'checkpoint', length: 10, sha256: 'c'.repeat(64),
})
const page = (versions: unknown[], nextCursor: string | null = null) => ({ status: 'ok', versions, nextCursor, health: HEALTH })
const text = (body: string) => ({ status: 'ok', text: body, length: body.length, shownBytes: body.length, truncated: false, bom: false, crlf: false })
const CREATED = { status: 'created', path: '/vault/Notes/plan (copy).md', relativePath: 'Notes/plan (copy).md', durable: true }
const named = (command: string) => calls.filter(([name]) => name === command).map(([, args]) => args)

function later() {
  let resolve: (value: unknown) => void = () => {}
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

const trigger = document.createElement('button')
const props = {
  locale: 'en' as const, warning: null, tracker: null, onCheckHealth: () => {}, folders: FOLDERS, returnFocus: trigger,
  onClose: vi.fn(), onOpenCopy: vi.fn(async () => true), onCopyCreated: vi.fn(),
}
const dialog = (target: PageHistoryTarget | null) => <PageHistoryDialog {...props} target={target} />
const versionRows = () => screen.queryAllByTestId('page-history-version')
async function choose(n: number) {
  const pick = () => versionRows().find(item => item.dataset.versionId === row(n).id)
  await waitFor(() => expect(pick()).toBeDefined())
  fireEvent.click(pick()!)
}

beforeEach(() => {
  calls.length = 0
  document.body.append(trigger)
  answer = command => command === 'list_page_versions' ? page([row(1), row(2)]) : command === 'read_page_version' ? text('kept words') : null
  vi.clearAllMocks()
  props.onClose.mockReset()
})
afterEach(() => trigger.remove())

describe('earlier versions dialog', () => {
  it('shows only the newest preview after A, B, A, and never an unverified or damaged one', async () => {
    const reads: ReturnType<typeof later>[] = []
    answer = command => {
      if (command === 'list_page_versions') return page([row(1), row(2), row(3), row(4)])
      const pending = later()
      reads.push(pending)
      return pending.promise
    }
    render(dialog(PAGE))
    await choose(1)
    await choose(2)
    await choose(1)
    await act(async () => { reads[2].resolve(text('A newest')) })
    expect(await screen.findByTestId('page-history-preview-formatted')).toHaveTextContent('A newest')
    await act(async () => { reads[0].resolve(text('A stale')); reads[1].resolve(text('B stale')) })
    expect(screen.getByTestId('page-history-preview-formatted')).toHaveTextContent('A newest')

    await choose(3)
    await act(async () => { reads[3].resolve({ ...text('lies about its size'), length: 2 }) })
    expect(await screen.findByText('Couldn’t read this version. Try choosing it again.')).toBeInTheDocument()
    await choose(4)
    await act(async () => { reads[4].resolve({ status: 'damaged' }) })
    expect(await screen.findByTestId('page-history-preview-unavailable')).toHaveTextContent('damaged')
    expect(screen.queryByTestId('page-history-preview')).toBeNull()
    expect(screen.queryByTestId('page-history-save-copy')).toBeNull()
  })

  it('pages older versions only on request and reads saved locations only when that tab is chosen', async () => {
    answer = (command, args) => {
      if (command === 'list_page_versions') return args.cursor === 'c1' ? page([row(2)]) : page([row(1)], 'c1')
      if (command === 'list_saved_locations') return { status: 'ok', nextCursor: null, locations: [{ path: 'Old/plan.md', newestAt: 1_760_000_000_000, count: 2, exists: false }] }
      return null
    }
    render(dialog(PAGE))
    fireEvent.click(await screen.findByTestId('page-history-more'))
    await waitFor(() => expect(versionRows()).toHaveLength(2))
    expect(named('list_page_versions')).toEqual([
      { vaultPath: '/vault', path: '/vault/Notes/plan.md', cursor: null },
      { vaultPath: '/vault', path: '/vault/Notes/plan.md', cursor: 'c1' },
    ])
    expect(screen.queryByTestId('page-history-more')).toBeNull()
    expect(named('list_saved_locations')).toHaveLength(0)

    fireEvent.mouseDown(screen.getByTestId('page-history-tab-locations'))
    const location = await screen.findByTestId('page-history-location')
    expect(location).toHaveTextContent('Old/plan.md')
    expect(location).toHaveTextContent('no page there now')
    fireEvent.click(location)
    await waitFor(() => expect(named('list_page_versions').at(-1)).toEqual({ vaultPath: '/vault', path: '/vault/Old/plan.md', cursor: null }))
    expect(named('list_saved_locations')).toHaveLength(1)
  })

  it('checks a lost copy reply with the same operation, then opens the copy only when asked', async () => {
    const copies = [() => { throw new Error('reply lost') }, () => CREATED]
    answer = command => command === 'list_page_versions' ? page([row(1)])
      : command === 'read_page_version' ? text('kept words') : copies.shift()?.()
    const view = render(dialog(PAGE))
    await choose(1)
    fireEvent.click(await screen.findByTestId('page-history-save-copy'))
    expect(await screen.findByText('We couldn’t confirm the copy. Checking again won’t make a second one.')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('page-history-copy-retry'))
    expect(await screen.findByText('Saved as a new page: Notes/plan (copy).md.')).toBeInTheDocument()

    const [first, second] = named('save_page_version_as_copy')
    expect(first).toEqual({ vaultPath: '/vault', id: row(1).id, sha256: row(1).sha256, folder: null, operationId: expect.stringMatching(/^[0-9a-f-]{36}$/) })
    expect(second).toEqual(first)
    // Nothing but reads and the one copy: the original page is never written.
    expect(new Set(calls.map(([name]) => name))).toEqual(new Set(['list_page_versions', 'read_page_version', 'save_page_version_as_copy']))
    expect(props.onCopyCreated).toHaveBeenCalledTimes(1)
    expect(props.onOpenCopy).not.toHaveBeenCalled()

    props.onClose.mockImplementation(() => view.rerender(dialog(null)))
    fireEvent.click(screen.getByTestId('page-history-open-copy'))
    await waitFor(() => expect(screen.queryByTestId('page-history-dialog')).toBeNull())
    expect(props.onOpenCopy).toHaveBeenCalledWith('/vault/Notes/plan (copy).md')
    // The opened copy keeps focus; the trigger does not take it back once Radix hands focus over.
    await act(() => new Promise(done => setTimeout(done, 10)))
    expect(document.activeElement).not.toBe(trigger)
  })

  it('asks where to put a copy whose folder is gone and warns about its links', async () => {
    const copies = [{ status: 'folderUnavailable', recordedFolder: 'Notes' }, { ...CREATED, path: '/vault/Archive/plan.md', relativePath: 'Archive/plan.md' }]
    answer = command => command === 'list_page_versions' ? page([row(1)])
      : command === 'read_page_version' ? text('kept words') : copies.shift()
    render(dialog(PAGE))
    await choose(1)
    fireEvent.click(await screen.findByTestId('page-history-save-copy'))
    expect(await screen.findByText(/The folder this version was saved in \(Notes\) is gone/)).toBeInTheDocument()
    expect(screen.queryByTestId('page-history-copy-retry')).toBeNull()

    fireEvent.click(screen.getByTestId('page-history-choose-folder'))
    fireEvent.click(await screen.findByTestId('page-history-folder-option:/vault/Archive'))
    expect(await screen.findByText('Saved as a new page: Archive/plan.md.')).toBeInTheDocument()
    expect(screen.getByText(/different folder from the original, so its links/)).toBeInTheDocument()
    const [first, second] = named('save_page_version_as_copy')
    expect(first.folder).toBeNull()
    expect(second.folder).toBe('/vault/Archive')
    expect(second.operationId).not.toBe(first.operationId)
  })

  it('drops a list answer meant for the previous vault', async () => {
    const slow = later()
    answer = (command, args) => command !== 'list_page_versions' ? null
      : args.vaultPath === '/vault' ? slow.promise : page([{ ...row(9), recordedPath: 'other.md' }])
    const view = render(dialog(PAGE))
    view.rerender(dialog({ vaultPath: '/other', path: '/other/other.md', title: 'Other' }))
    await waitFor(() => expect(versionRows()).toHaveLength(1))
    await act(async () => { slow.resolve(page([row(1), row(2)])) })
    expect(versionRows().map(item => item.dataset.versionId)).toEqual([row(9).id])
  })

  it('closes on Escape and gives focus back to what opened it', async () => {
    const view = render(dialog(PAGE))
    await screen.findByTestId('page-history-dialog')
    props.onClose.mockImplementation(() => view.rerender(dialog(null)))
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('page-history-dialog')).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })
})
