import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import type { VaultEntry } from '../../types'
import type { PageHistoryTarget } from './PageHistoryDialog'
import { createHealthTracker } from './usePageHistoryHealth'
import { usePageHistoryUi } from './usePageHistoryUi'

// Seam: a history opening and its copies -> the vault session. Catches the copy opening in the other pane,
// another file opening, a dialog coming back with its old vault, or a late copy refreshing another vault.
type Args = Record<string, unknown>
let readEntry: (args: Args) => unknown = () => null
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: async (command: string, args: Args) =>
    command === 'reload_vault_entry' ? readEntry(args) : command === 'get_note_content' ? 'copied words' : null,
}))

const COPY = '/vault/plan (copy).md'
const entry = (path: string) => ({ path, title: 'Plan', filename: 'plan.md', fileKind: 'markdown', aliases: [], outgoingLinks: [], relationships: {} }) as unknown as VaultEntry
type DialogProps = { target: PageHistoryTarget | null; onOpenCopy: (path: string) => Promise<boolean>; onCopyCreated: (path: string) => void }

function setup() {
  const order: string[] = []
  const reservation = {
    inSession: vi.fn(() => true), isActive: vi.fn(() => false),
    open: vi.fn(async () => { order.push('open'); return true }),
  }
  const deps = {
    vaultPath: '/vault', entries: [entry('/vault/plan.md')], folders: [], locale: 'en' as const,
    health: { tracker: createHealthTracker('/vault'), warnings: new Map(), check: vi.fn(), noteSaved: vi.fn() },
    focusPane: vi.fn((pane: number) => { order.push(`focus ${pane}`) }),
    reserveOpen: vi.fn(() => { order.push('reserve'); return reservation }),
    addEntry: vi.fn(), onCopyCreated: vi.fn(),
  }
  const hook = renderHook(props => usePageHistoryUi(props), { initialProps: deps })
  const dialog = () => (hook.result.current.dialog as ReactElement<DialogProps>).props
  const openCopy = async () => {
    let shown = false
    await act(async () => { shown = await dialog().onOpenCopy(COPY) })
    return shown
  }
  act(() => hook.result.current.open('/vault/plan.md', 1, null))
  return { ...hook, deps, reservation, order, dialog, openCopy }
}

describe('Open copy', () => {
  it('opens the exact copy in the pane that asked for history', async () => {
    readEntry = args => entry(args.path as string)
    const h = setup()
    expect(await h.openCopy()).toBe(true)
    expect(h.order).toEqual(['focus 1', 'reserve', 'open'])
    expect(h.reservation.open).toHaveBeenCalledWith(expect.objectContaining({ path: COPY }), 'copied words')
    expect(h.deps.addEntry).toHaveBeenCalledWith(expect.objectContaining({ path: COPY }))
  })

  it('opens nothing for another file, a moved-on session or another vault', async () => {
    readEntry = () => entry('/vault/other.md')
    const h = setup()
    expect(await h.openCopy()).toBe(false)

    readEntry = args => entry(args.path as string)
    h.reservation.inSession.mockReturnValue(false)
    expect(await h.openCopy()).toBe(false)
    expect(h.reservation.open).not.toHaveBeenCalled()
    expect(h.deps.addEntry).not.toHaveBeenCalled()

    h.rerender({ ...h.deps, vaultPath: '/other' })
    expect(h.dialog().target).toBeNull()
    expect(await h.openCopy()).toBe(false)
  })
})

describe('closing', () => {
  // Seam: the app clears the opening, and its trigger with it, before Radix hands focus back.
  it('gives focus back to the trigger after Escape, though focus was elsewhere as it opened', async () => {
    const trigger = document.createElement('button')
    const editor = document.createElement('input')
    document.body.append(trigger, editor)
    const deps = {
      vaultPath: '/vault', entries: [entry('/vault/plan.md')], folders: [], locale: 'en' as const,
      health: { tracker: createHealthTracker('/vault'), warnings: new Map(), check: vi.fn(), noteSaved: vi.fn() },
      focusPane: vi.fn(), reserveOpen: vi.fn(), addEntry: vi.fn(), onCopyCreated: vi.fn(),
    }
    let ui: ReturnType<typeof usePageHistoryUi> | null = null
    function Host() {
      ui = usePageHistoryUi(deps)
      return ui.dialog
    }
    render(<Host />)
    editor.focus()
    act(() => ui?.open('/vault/plan.md', 1, trigger))
    await screen.findByTestId('page-history-dialog')
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('page-history-dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    trigger.remove()
    editor.remove()
  })
})

describe('vault sessions', () => {
  it('never brings back an opening after its vault was left, even when that vault returns', () => {
    const h = setup()
    expect(h.dialog().target?.path).toBe('/vault/plan.md')
    h.rerender({ ...h.deps, vaultPath: '/other' })
    expect(h.dialog().target).toBeNull()
    h.rerender({ ...h.deps, vaultPath: '/vault' })
    expect(h.dialog().target).toBeNull()
    act(() => h.result.current.open('/vault/plan.md', 0, null))
    expect(h.dialog().target?.path).toBe('/vault/plan.md')
  })

  it('refreshes for a late copy only while the vault it was made in is open', () => {
    const h = setup()
    const created = h.dialog().onCopyCreated
    created(COPY)
    expect(h.deps.onCopyCreated).toHaveBeenCalledTimes(1)
    h.rerender({ ...h.deps, vaultPath: '/other' })
    created(COPY)
    expect(h.deps.onCopyCreated).toHaveBeenCalledTimes(1)
    // Back in its vault, the copy's list may still lack it, so refreshing is right.
    h.rerender({ ...h.deps, vaultPath: '/vault' })
    created(COPY)
    expect(h.deps.onCopyCreated).toHaveBeenCalledTimes(2)
  })
})
