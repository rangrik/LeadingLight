import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PageCreationOutcome } from '../hooks/useNoteCreation'
import type { VaultEntry } from '../types'
import { QuickFind } from './QuickFind'

vi.mock('../mock-tauri', () => ({ mockInvoke: vi.fn(), isTauri: () => false }))
vi.mock('../hooks/useEditorFocus', () => ({ requestEditorFocus: vi.fn() }))
import { mockInvoke } from '../mock-tauri'
import { requestEditorFocus } from '../hooks/useEditorFocus'

const page = (name: string, title: string, extra: Partial<VaultEntry> = {}) => ({
  path: `/vault/${name}.md`, filename: `${name}.md`, title, isA: 'Note', aliases: [], archived: false,
  modifiedAt: 0, icon: null, fileKind: 'markdown', ...extra,
}) as VaultEntry
const garden = page('garden', 'Garden plan', { modifiedAt: 3 })
const gardenLog = page('garden-log', 'Garden log', { modifiedAt: 2 })
const water = page('water', 'Watering', { modifiedAt: 1 })
const old = page('old', 'Old garden', { archived: true })
const photo = page('garden-photo', 'Garden photo', { fileKind: 'binary', modifiedAt: 9 })
const entries = [garden, gardenLog, water, old, photo]

type Search = { args: unknown, resolve: (value: unknown) => void, reject: (error: unknown) => void }
let searches: Search[] = []
const hit = (path: string, snippet: string) => ({ title: '', path, snippet, score: 1, note_type: null })
const respond = (index: number, results: ReturnType<typeof hit>[]) =>
  act(async () => searches[index].resolve({ results, elapsed_ms: 1 }))

type Props = Parameters<typeof QuickFind>[0]
function renderFind(overrides: Partial<Props> = {}, { strict = false } = {}) {
  let props: Props = {
    open: true, vaultPath: '/vault', entries, ready: true, recentPaths: [],
    onOpen: vi.fn(async () => true), onCreate: vi.fn(async (): Promise<PageCreationOutcome> => 'opened'), onClose: vi.fn(), ...overrides,
  }
  const ui = () => (strict ? <StrictMode><QuickFind {...props} /></StrictMode> : <QuickFind {...props} />)
  const view = render(ui())
  const update = (next: Partial<Props>) => {
    props = { ...props, ...next }
    view.rerender(ui())
  }
  return { ...props, update, input: screen.getByRole('combobox') }
}
const options = () => screen.queryAllByRole('option').map(option => option.textContent)
const selectedOption = () => screen.getAllByRole('option').find(option => option.getAttribute('aria-selected') === 'true')
const type = (value: string) => fireEvent.change(screen.getByRole('combobox'), { target: { value } })
const key = (name: string, init: Record<string, unknown> = {}) => fireEvent.keyDown(screen.getByRole('combobox'), { key: name, ...init })
function focusOutside() {
  const before = document.body.appendChild(document.createElement('button'))
  before.dataset.beforeFind = ''
  before.focus()
  return before
}

describe('QuickFind', () => {
  beforeEach(() => {
    searches = []
    vi.mocked(requestEditorFocus).mockClear()
    vi.mocked(mockInvoke).mockReset().mockImplementation((_command, args) =>
      new Promise((resolve, reject) => { searches.push({ args, resolve, reject }) }))
  })
  afterEach(() => document.querySelectorAll('[data-before-find]').forEach(element => element.remove()))

  it('lists recently opened pages in visit order, including the open one, skipping anything not openable', () => {
    // Visit order Garden plan (open now) → Watering → Garden log; modification order differs.
    renderFind({
      recentPaths: [garden.path, old.path, photo.path, '/vault/gone.md', '/other-vault/water.md', water.path, gardenLog.path],
    })
    expect(screen.getByRole('group', { name: 'Recent' })).toBeInTheDocument()
    expect(options()).toEqual(['Garden plan', 'Watering', 'Garden log'])
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('shows the only page of a one-page vault as recent', () => {
    renderFind({ entries: [water], recentPaths: [water.path] })
    expect(screen.getByRole('group', { name: 'Recent' })).toBeInTheDocument()
    expect(options()).toEqual(['Watering'])
  })

  // Seam: two pages called "Lantern" were indistinguishable, and a full relative path found nothing.
  it('tells same-title pages apart by path and finds a page by its relative path', () => {
    const lantern = page('lantern', 'Lantern', { modifiedAt: 5 })
    const harborLantern = page('harbor/lantern', 'Lantern', { filename: 'lantern.md', modifiedAt: 4 })
    renderFind({ entries: [lantern, harborLantern, water] })
    expect(options()).toEqual(['Lanternlantern', 'Lanternharbor/lantern', 'Watering'])

    for (const query of ['harbor/lantern.md', 'harbor/lantern', './Harbor/Lantern.md']) {
      type(query)
      expect(options()[0]).toBe('Lanternharbor/lantern')
      expect(options()).not.toContain('Lanternlantern')
      expect(options().some(option => option?.startsWith('Create page'))).toBe(false)
    }
  })

  it('falls back to recently edited pages, labeled as such, when nothing was opened yet', () => {
    renderFind()
    expect(screen.getByRole('group', { name: 'Recently edited' })).toBeInTheDocument()
    expect(options()).toEqual(['Garden plan', 'Garden log', 'Watering'])
  })

  it('shows title matches at once, then text-only matches with a plain snippet, each page once', async () => {
    renderFind()
    type('garden')
    expect(options()).toEqual(['Garden plan', 'Garden log', 'Create page “garden”'])
    expect(screen.getByRole('status')).toHaveTextContent('Searching page text…')
    await waitFor(() => expect(searches).toHaveLength(1))
    expect(searches[0].args).toEqual({ vaultPath: '/vault', query: 'garden', limit: 20, excludeFrontmatter: true })
    await respond(0, [
      hit(garden.path, '# Garden plan'), hit(water.path, '- **Water** the [[garden|Garden]] <b>daily</b>'),
      hit(old.path, 'old garden'), hit(photo.path, 'garden'), hit('/vault/gone.md', 'garden'),
    ])
    expect(screen.getByRole('group', { name: 'In page text' })).toHaveTextContent('WateringWater the Garden daily')
    expect(options()).toEqual(['Garden plan', 'Garden log', 'WateringWater the Garden daily', 'Create page “garden”'])
  })

  it('never shows an earlier reply, even when the same query comes back', async () => {
    const { update } = renderFind()
    type('garden')
    await waitFor(() => expect(searches).toHaveLength(1))
    await respond(0, [hit(water.path, 'first garden reply')])
    expect(screen.getByText('first garden reply')).toBeInTheDocument()

    type('wat')
    await waitFor(() => expect(searches).toHaveLength(2))
    type('garden')
    expect(screen.queryByText('first garden reply')).not.toBeInTheDocument()
    await respond(1, [hit(water.path, 'late wat reply')])
    expect(screen.queryByText('late wat reply')).not.toBeInTheDocument()
    await waitFor(() => expect(searches).toHaveLength(3))
    await respond(2, [hit(water.path, 'second garden reply')])
    expect(screen.getByText('second garden reply')).toBeInTheDocument()

    // A new dialog starts empty and asks again rather than reusing the last session.
    update({ open: false })
    update({ open: true })
    expect(screen.getByRole('combobox')).toHaveValue('')
    type('garden')
    expect(screen.queryByText('second garden reply')).not.toBeInTheDocument()
    await waitFor(() => expect(searches).toHaveLength(4))
  })

  it('reports a failed text search apart from title matches, and retries it', async () => {
    renderFind()
    type('daily')
    await waitFor(() => expect(searches).toHaveLength(1))
    await act(async () => searches[0].reject(new Error('read failed')))
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t search page text.')
    expect(screen.queryByText(/No pages match/)).not.toBeInTheDocument()

    type('garden')
    await waitFor(() => expect(searches).toHaveLength(2))
    await act(async () => searches[1].reject(new Error('read failed')))
    expect(options()).toEqual(['Garden plan', 'Garden log', 'Create page “garden”'])
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByRole('combobox')).toHaveFocus()
    await waitFor(() => expect(searches).toHaveLength(3))
    await respond(2, [hit(water.path, 'water the garden')])
    expect(screen.getByText('water the garden')).toBeInTheDocument()
    expect(screen.queryByText('Couldn’t search page text.')).not.toBeInTheDocument()
  })

  it('says plainly when nothing matches', async () => {
    renderFind()
    type('zz')
    await waitFor(() => expect(searches).toHaveLength(1))
    await respond(0, [])
    expect(screen.getByText('No pages match “zz”.')).toBeInTheDocument()
    expect(options()).toEqual(['Create page “zz”'])
  })

  it('keeps the chosen row while text matches arrive, and ignores Enter during IME composition', async () => {
    const { onOpen, onCreate, input } = renderFind()
    type('garden')
    key('ArrowDown')
    key('ArrowDown')
    const create = screen.getByRole('option', { name: 'Create page “garden”' })
    expect(create).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', create.id)
    await waitFor(() => expect(searches).toHaveLength(1))
    // The text match lands above the chosen row; the choice must not move.
    await respond(0, [hit(water.path, 'garden water')])
    expect(selectedOption()).toBe(screen.getByRole('option', { name: 'Create page “garden”' }))
    key('ArrowDown')
    expect(selectedOption()?.textContent).toBe('Create page “garden”')
    key('ArrowUp')
    expect(input).toHaveAttribute('aria-activedescendant', selectedOption()?.id)
    key('Enter', { isComposing: true })
    key('Enter', { keyCode: 229 })
    expect(onOpen).not.toHaveBeenCalled()
    expect(onCreate).not.toHaveBeenCalled()
    key('Enter')
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(water))
  })

  it('opens with the mouse, closes only after the page opened, then focuses that page', async () => {
    const before = focusOutside()
    const onOpen = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const { onClose, update } = renderFind({ onOpen, recentPaths: [water.path], onClose: vi.fn(() => update({ open: false })) })
    expect(screen.getByRole('combobox')).toHaveFocus()

    fireEvent.click(screen.getByRole('option', { name: 'Watering' }))
    expect(await screen.findByText('Couldn’t open “Watering”.')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('option', { name: 'Watering' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Focus moves after the dialog has gone, to the opened page and not back to the old control.
    await waitFor(() => expect(requestEditorFocus).toHaveBeenCalledWith({ path: water.path }))
    expect(before).not.toHaveFocus()
  })

  it('behaves the same under StrictMode: focus stays in the field, and opening still closes', async () => {
    const before = focusOutside()
    const { onClose } = renderFind({ recentPaths: [water.path] }, { strict: true })
    // The replayed mount must not hand focus back to the old control.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(screen.getByRole('combobox')).toHaveFocus()
    expect(before).not.toHaveFocus()
    key('Enter')
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('returns focus where it was on Escape, but not while composing', async () => {
    const before = focusOutside()
    const { onClose, update } = renderFind({ onClose: vi.fn(() => update({ open: false })) })
    expect(screen.getByRole('combobox')).toHaveFocus()
    key('Escape', { isComposing: true })
    expect(onClose).not.toHaveBeenCalled()
    key('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(before).toHaveFocus())
    expect(requestEditorFocus).not.toHaveBeenCalled()
  })

  it('starts over in the field when the vault changes, dropping late results; Escape still returns focus', async () => {
    const before = focusOutside()
    let finish!: (opened: boolean) => void
    const onOpen = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
    const { onClose, update } = renderFind({ onOpen, recentPaths: [water.path], onClose: vi.fn(() => update({ open: false })) })
    key('Enter')
    update({ vaultPath: '/other', entries: [], recentPaths: [] })
    expect(screen.getByRole('combobox')).toHaveFocus()
    expect(screen.getByRole('combobox')).toHaveValue('')
    await act(async () => finish(true))
    expect(onClose).not.toHaveBeenCalled()
    expect(requestEditorFocus).not.toHaveBeenCalled()

    key('Escape')
    await waitFor(() => expect(before).toHaveFocus())
  })

  it('creates a page from the query once and holds the query while it is created', async () => {
    let finish!: (outcome: PageCreationOutcome) => void
    const onCreate = vi.fn(() => new Promise<PageCreationOutcome>(resolve => { finish = resolve }))
    const { onClose, input, update } = renderFind({ onCreate, onClose: vi.fn(() => update({ open: false })) })
    type('Trip ideas')
    const create = screen.getByRole('option', { name: 'Create page “Trip ideas”' })
    fireEvent.click(create)
    fireEvent.click(create)
    key('Enter')
    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onCreate).toHaveBeenCalledWith('Trip ideas')
    expect(create).toHaveTextContent('Creating “Trip ideas”…')
    expect(input).toHaveAttribute('readonly')
    type('Something else')
    expect(input).toHaveValue('Trip ideas')

    // Opened: the dialog closes and the new page's editor (the active pane) gets focus.
    await act(async () => finish('opened'))
    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(requestEditorFocus).toHaveBeenCalledWith({}))
  })

  it('keeps showing Creating until the write finishes, even once the new page is listed', async () => {
    const finishes: Array<(outcome: PageCreationOutcome) => void> = []
    const onCreate = vi.fn(() => new Promise<PageCreationOutcome>(resolve => { finishes.push(resolve) }))
    const { input, update } = renderFind({ onCreate })
    const trip = page('trip-ideas', 'Trip ideas')
    type('Trip ideas')
    key('Enter')
    // Creation lists the page before its file is written.
    update({ entries: [...entries, trip] })
    const creating = screen.getByRole('option', { name: 'Creating “Trip ideas”…' })
    expect(creating).toBeDisabled()
    expect(creating).toHaveAttribute('aria-selected', 'true')
    expect(options()).toEqual(['Creating “Trip ideas”…'])
    fireEvent.click(creating)
    key('Enter')
    expect(onCreate).toHaveBeenCalledTimes(1)

    // A failed write takes the listed page away again; creating is offered once more.
    update({ entries })
    await act(async () => finishes[0]('failed'))
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t create the page. Try again.')
    expect(options()).toEqual(['Create page “Trip ideas”'])

    key('Enter')
    update({ entries: [...entries, trip] })
    expect(options()).toEqual(['Creating “Trip ideas”…'])
    await act(async () => finishes[1]('created'))
    expect(options()).toEqual(['Trip ideas'])
    expect(screen.getByText('Created “Trip ideas”. Choose it below to open it.')).toBeInTheDocument()
    expect(input).not.toHaveAttribute('readonly')
    expect(onCreate).toHaveBeenCalledTimes(2)
  })

  it('says a page was created but not shown, without calling it a failure', async () => {
    const onCreate = vi.fn(async (): Promise<PageCreationOutcome> => 'created')
    const { onClose, onOpen, input, update } = renderFind({ onCreate })
    type('Trip ideas')
    key('Enter')
    const notice = await screen.findByText('Created “Trip ideas”. Choose it below to open it.')
    expect(notice).toHaveAttribute('role', 'status')
    expect(screen.queryByText(/Couldn’t create/)).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(input).not.toHaveAttribute('readonly')

    // Once listed, the page is a normal row to open, and creating it again is not offered.
    const trip = page('trip-ideas', 'Trip ideas')
    update({ entries: [...entries, trip] })
    expect(options()).toEqual(['Trip ideas'])
    key('Enter')
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(trip))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('lets a failed create be tried again', async () => {
    const onCreate = vi.fn<(title: string) => Promise<PageCreationOutcome>>()
      .mockResolvedValueOnce('failed').mockRejectedValueOnce(new Error('disk')).mockResolvedValueOnce('opened')
    const { onClose } = renderFind({ onCreate })
    type('Trip ideas')
    key('Enter')
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t create the page. Try again.')
    key('Enter')
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t create the page. Try again.')
    expect(onClose).not.toHaveBeenCalled()
    key('Enter')
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })
})

describe('QuickFind choosing a page for Ask', () => {
  beforeEach(() => {
    searches = []
    vi.mocked(requestEditorFocus).mockClear()
    vi.mocked(mockInvoke).mockReset().mockImplementation((_command, args) =>
      new Promise((resolve, reject) => { searches.push({ args, resolve, reject }) }))
  })

  it('hands the chosen page over and closes, opening, creating and focusing nothing', async () => {
    const onPick = vi.fn()
    const { onOpen, onCreate, onClose } = renderFind({ recentPaths: [water.path], pick: { title: 'Choose a page to attach', onPick } })
    expect(screen.getByRole('dialog', { name: 'Choose a page to attach' })).toBeInTheDocument()
    type('Garden')
    fireEvent.click(screen.getByRole('option', { name: 'Garden plan' }))
    expect(onPick).toHaveBeenCalledExactlyOnceWith(garden)
    expect(onClose).toHaveBeenCalledOnce()
    expect(onOpen).not.toHaveBeenCalled()
    expect(onCreate).not.toHaveBeenCalled()
    await waitFor(() => expect(requestEditorFocus).not.toHaveBeenCalled())
  })

  it('never searches page text while choosing, even past the search delay; ordinary find still does', async () => {
    vi.useFakeTimers()
    try {
      const view = renderFind({ pick: { title: 'Choose a page to attach', onPick: vi.fn() } })
      type('garden')
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
      // Titles and paths only: no search reads other pages' text before one is chosen.
      expect(searches).toEqual([])
      expect(mockInvoke).not.toHaveBeenCalled()
      expect(options()).toEqual(['Garden plan', 'Garden log'])
      expect(screen.queryByRole('status')).toBeNull()
      view.update({ open: false })
      cleanup()

      renderFind()
      type('garden')
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
      expect(searches).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('offers no new page for a title nothing has', () => {
    renderFind({ pick: { title: 'Choose a page to attach', onPick: vi.fn() } })
    type('A page that does not exist')
    expect(options()).not.toContainEqual(expect.stringContaining('A page that does not exist'))
  })
})
