import { useEffect } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SplitEditorWorkspace } from './SplitEditorWorkspace'
import type { EditorProps } from '../components/Editor'
import type { SplitWorkspaceController } from './useSplitWorkspace'
import type { VaultEntry } from '../types'
import { NoteItem } from '../components/NoteItem'
import { useSidebarNoteDropTargets } from '../hooks/useSidebarNoteDropTargets'
import { usePageHistoryAction } from './pageHistory/pageHistoryContext'
import { usePageRelocationAction } from './relocation/pageRelocationContext'

const activity = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn(), raw: vi.fn(), flush: vi.fn(), render: vi.fn() }))
vi.mock('../components/LazyEditor', () => ({ LazyEditor: function TestEditor(props: EditorProps) {
  const { activeTabPath: path, rawToggleRef, flushPendingEditorContentRef } = props
  activity.render(path)
  const openHistory = usePageHistoryAction()
  const movePage = usePageRelocationAction()
  useEffect(() => {
    activity.mount(path)
    return () => { activity.unmount(path) }
  }, [path])
  useEffect(() => {
    if (rawToggleRef) rawToggleRef.current = () => activity.raw(path)
    if (flushPendingEditorContentRef) flushPendingEditorContentRef.current = target => { if (target === path) activity.flush(path) }
  }, [path, rawToggleRef, flushPendingEditorContentRef])
  return <>
    <div contentEditable suppressContentEditableWarning data-mode={props.editorModeControl?.mode} data-wikilink-preferences={JSON.stringify(props.wikilinkPreferredPaths)} data-testid={`editor-${path}`}>{path}</div>
    {openHistory && <button data-testid={`history-${path}`} onClick={event => openHistory(event.currentTarget)}>history</button>}
    {movePage && <button data-testid={`move-${path}`} onClick={event => movePage(event.currentTarget)}>move</button>}
    {!props.inspectorCollapsed && <div data-testid={`inspector-${path}`} tabIndex={-1} data-inspector-overlay={props.inspectorOverlay ? '' : undefined} />}
  </>
} }))

const entry = (path: string) => ({ path, title: path, filename: path, fileKind: 'markdown', aliases: [], outgoingLinks: [], relationships: {} }) as unknown as VaultEntry
function fixture() {
  const entries = [entry('/left.md'), entry('/right.md')]
  const workspace: SplitWorkspaceController = {
    activePane: 0, split: true, orientation: 'horizontal', ratio: 50, paths: ['/left.md', '/right.md'], order: [0, 1], placePane: vi.fn(() => true), placeNote: vi.fn(async () => true),
    editorModes: ['preview', 'raw'], editorModesReady: true, beginEditorModeChange: vi.fn(() => vi.fn(() => true)),
    pendingPanes: [false, false], suspendPersistence: vi.fn(), focusPane: vi.fn(), selectNoteInPane: vi.fn(async () => {}),
    closePane: vi.fn(), openSplit: vi.fn(), resize: vi.fn(), canGoBack: false, canGoForward: false, goBack: vi.fn(), goForward: vi.fn(),
    closePages: vi.fn(), closePageAndReserveOpen: vi.fn(() => null), currentTabs: vi.fn(() => []),
    markNavigation: vi.fn(() => ({ pane: 0 as const, current: () => true })), openNoteWhenLoaded: vi.fn(async () => true), readyForVisits: true,
  }
  const props = { workspace, unsavedPaths: new Set<string>(), tabs: entries.map(item => ({ entry: item, content: `# ${item.title}` })),
    activeTabPath: '/left.md', entries, onNavigateWikilink: vi.fn(), inspectorCollapsed: true, onToggleInspector: vi.fn(),
    inspectorWidth: 280, onInspectorResize: vi.fn(), inspectorEntry: entries[0], inspectorContent: '', gitHistory: [],
    rawToggleRef: { current: vi.fn() }, flushPendingEditorContentRef: { current: null as ((path: string) => void) | null },
  }
  return props
}

describe('split editor integration', () => {
  it('provides the other visible loaded page before recents without remounting or moving focus', () => {
    activity.mount.mockClear(); activity.unmount.mockClear()
    const props = fixture()
    const recent = entry('/recent.md')
    const inputs = { ...props, entries: [...props.entries, recent], vaultPath: '/', wikilinkPreferredPaths: ['/left.md', '/recent.md'] }
    const { rerender } = render(<SplitEditorWorkspace {...inputs} />)
    const left = screen.getByTestId('editor-/left.md')
    left.focus()
    expect(left).toHaveAttribute('data-wikilink-preferences', JSON.stringify(['/right.md', '/recent.md']))
    expect(screen.getByTestId('editor-/right.md')).toHaveAttribute('data-wikilink-preferences', JSON.stringify(['/left.md', '/recent.md']))
    rerender(<SplitEditorWorkspace {...inputs} workspace={{ ...props.workspace, pendingPanes: [false, true] }} />)
    expect(left).toHaveAttribute('data-wikilink-preferences', JSON.stringify(['/recent.md']))
    expect(document.activeElement).toBe(left)
    expect(activity.mount).toHaveBeenCalledTimes(2)
    expect(activity.unmount).not.toHaveBeenCalled()
    rerender(<SplitEditorWorkspace {...inputs} workspace={{ ...props.workspace, split: false }} />)
    expect(left).toHaveAttribute('data-wikilink-preferences', JSON.stringify(['/recent.md']))
    expect(document.activeElement).toBe(left)
  })

  it('ignores unloaded and deleted retained other-pane pages as contextual preferences', () => {
    const props = fixture()
    const { rerender } = render(<SplitEditorWorkspace {...props} vaultPath="/" tabs={[props.tabs[0]]} />)
    expect(screen.getByTestId('editor-/left.md')).toHaveAttribute('data-wikilink-preferences', '[]')
    rerender(<SplitEditorWorkspace {...props} vaultPath="/" entries={[props.entries[0]]} unsavedPaths={new Set(['/right.md'])} wikilinkPreferredPaths={['/right.md']} />)
    expect(screen.getByTestId('editor-/left.md')).toHaveAttribute('data-wikilink-preferences', '[]')
  })
  it('routes global commands to the focused pane and flushes by document path', () => {
    const props = fixture()
    render(<SplitEditorWorkspace {...props} />)
    fireEvent.pointerDown(screen.getByTestId('editor-/right.md'))
    props.rawToggleRef.current()
    expect(activity.raw).toHaveBeenLastCalledWith('/right.md')
    props.flushPendingEditorContentRef.current?.('/left.md')
    props.flushPendingEditorContentRef.current?.('/right.md')
    expect(activity.flush).toHaveBeenCalledWith('/left.md')
    expect(activity.flush).toHaveBeenCalledWith('/right.md')
  })
  it('passes each pane its own mode and guards commands while preferences or workspace transitions are pending', () => {
    activity.raw.mockClear()
    const props = fixture()
    const { rerender } = render(<SplitEditorWorkspace {...props} />)
    expect(screen.getByTestId('editor-/left.md')).toHaveAttribute('data-mode', 'preview')
    expect(screen.getByTestId('editor-/right.md')).toHaveAttribute('data-mode', 'raw')
    props.workspace.editorModesReady = false
    rerender(<SplitEditorWorkspace {...props} />)
    expect(screen.getByTestId('editor-/left.md').closest('[inert]')).not.toBeNull()
    props.rawToggleRef.current()
    expect(activity.raw).not.toHaveBeenCalled()
    props.workspace.editorModesReady = true
    rerender(<SplitEditorWorkspace {...props} transitionPending />)
    props.rawToggleRef.current()
    expect(activity.raw).not.toHaveBeenCalled()
  })
  // Seam: a final save choice blocks only its own pane. Catches typing or page commands reaching it, or the other pane frozen too.
  it('blocks input and page commands only in the pane inside a final save choice', () => {
    activity.raw.mockClear()
    const props = fixture()
    render(<SplitEditorWorkspace {...props} blockedPaths={new Set(['/left.md'])} renderPageNotice={path => <p>notice {path}</p>} />)
    expect(screen.getByTestId('editor-/left.md').closest('[inert]')).not.toBeNull()
    expect(screen.getByText('notice /left.md').closest('[inert]')).toBeNull()
    expect(screen.getByTestId('editor-/right.md').closest('[inert]')).toBeNull()
    props.rawToggleRef.current()
    expect(activity.raw).not.toHaveBeenCalled()
    fireEvent.pointerDown(screen.getByTestId('editor-/right.md'))
    props.rawToggleRef.current()
    expect(activity.raw).toHaveBeenLastCalledWith('/right.md')
  })
  it('keeps both editor instances mounted when orientation or ratio changes', () => {
    activity.mount.mockClear(); activity.unmount.mockClear()
    const props = fixture()
    const { rerender } = render(<SplitEditorWorkspace {...props} />)
    expect(activity.mount).toHaveBeenCalledTimes(2)
    rerender(<SplitEditorWorkspace {...props} workspace={{ ...props.workspace, orientation: 'vertical', ratio: 65 }} />)
    expect(activity.mount).toHaveBeenCalledTimes(2)
    expect(activity.unmount).not.toHaveBeenCalled()
    const separator = screen.getByRole('separator')
    expect(separator).toHaveAttribute('aria-orientation', 'horizontal')
    fireEvent.keyDown(separator, { key: 'ArrowUp' })
    expect(props.workspace.resize).toHaveBeenCalledWith(60)
  })
  it('supports explicit pane keyboard focus without consuming note-list up/down shortcuts', () => {
    const props = fixture()
    render(<SplitEditorWorkspace {...props} />)
    fireEvent.keyDown(window, { key: '™', code: 'Digit2', metaKey: true, altKey: true })
    expect(props.workspace.focusPane).toHaveBeenCalledWith(1)
    expect(document.activeElement).toBe(screen.getByTestId('editor-/right.md'))
    fireEvent.keyDown(window, { key: '¡', code: 'Digit1', metaKey: true, altKey: true })
    expect(props.workspace.focusPane).toHaveBeenLastCalledWith(0)
    expect(document.activeElement).toBe(screen.getByTestId('editor-/left.md'))
  })
})

// Seam: a pane's page menu -> Earlier versions. Catches history opening for the other pane's page or pane.
describe('earlier versions from a pane', () => {
  it('opens history for the page and pane it was asked from', () => {
    const onOpenPageHistory = vi.fn()
    render(<SplitEditorWorkspace {...fixture()} onOpenPageHistory={onOpenPageHistory} />)
    fireEvent.click(screen.getByTestId('history-/right.md'))
    expect(onOpenPageHistory).toHaveBeenLastCalledWith('/right.md', 1, screen.getByTestId('history-/right.md'))
    fireEvent.click(screen.getByTestId('history-/left.md'))
    expect(onOpenPageHistory).toHaveBeenLastCalledWith('/left.md', 0, screen.getByTestId('history-/left.md'))
  })
})

it('binds Move to folder to the exact pane and page that opened its menu', () => {
  const onOpenMovePage = vi.fn()
  const props = fixture()
  render(<SplitEditorWorkspace {...props} onOpenMovePage={onOpenMovePage} />)
  fireEvent.click(screen.getByTestId('move-/right.md'))
  expect(props.workspace.focusPane).toHaveBeenLastCalledWith(1)
  expect(onOpenMovePage).toHaveBeenLastCalledWith('/right.md', 1, screen.getByTestId('move-/right.md'))
  fireEvent.click(screen.getByTestId('move-/left.md'))
  expect(onOpenMovePage).toHaveBeenLastCalledWith('/left.md', 0, screen.getByTestId('move-/left.md'))
})

describe('empty pane', () => {
  const withEmptyRight = (extra: Partial<ReturnType<typeof fixture>> & { onResume?: () => void, emptyVault?: boolean } = {}) => {
    const props = fixture()
    return { ...props, tabs: props.tabs.slice(0, 1), workspace: { ...props.workspace, paths: ['/left.md', null] as const }, ...extra }
  }

  // Seam: WebKit does not focus a clicked button, so Escape from the finder would land nowhere useful.
  it('Resume activates its own pane and holds focus before opening the finder', () => {
    let focusedAtOpen: Element | null = null
    const onResume = vi.fn(() => { focusedAtOpen = document.activeElement })
    const props = withEmptyRight({ onResume })
    render(<SplitEditorWorkspace {...props} />)
    const resume = screen.getByRole('button', { name: 'Resume a page' })
    fireEvent.click(resume)
    expect(props.workspace.focusPane).toHaveBeenLastCalledWith(1)
    expect(onResume).toHaveBeenCalledOnce()
    expect(focusedAtOpen).toBe(resume)
  })

  it('offers only creation when nothing can be resumed or the vault is empty', () => {
    const { rerender } = render(<SplitEditorWorkspace {...withEmptyRight()} />)
    expect(screen.getByText('Open a page here')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resume a page' })).not.toBeInTheDocument()
    rerender(<SplitEditorWorkspace {...withEmptyRight({ onResume: vi.fn(), emptyVault: true })} />)
    expect(screen.getByText('Start with a thought.')).toBeInTheDocument()
    expect(screen.getByText('Create a page and begin writing.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resume a page' })).not.toBeInTheDocument()
  })
})

it('takes pane-focus shortcuts before the editor while split, and leaves them to the editor otherwise', () => {
  const props = fixture()
  const { rerender } = render(<SplitEditorWorkspace {...props} />)
  const headingShortcut = vi.fn()
  screen.getByTestId('editor-/left.md').addEventListener('keydown', headingShortcut)
  const split = fireEvent.keyDown(screen.getByTestId('editor-/left.md'), { key: '™', code: 'Digit2', metaKey: true, altKey: true })
  expect(split).toBe(false)
  expect(props.workspace.focusPane).toHaveBeenCalledWith(1)
  expect(headingShortcut).not.toHaveBeenCalled()
  const focusCalls = vi.mocked(props.workspace.focusPane).mock.calls.length
  fireEvent.keyDown(screen.getByTestId('editor-/left.md'), { key: '™', code: 'Digit2', metaKey: true, altKey: true, shiftKey: true })
  rerender(<SplitEditorWorkspace {...props} transitionPending />)
  fireEvent.keyDown(screen.getByTestId('editor-/left.md'), { key: '™', code: 'Digit2', metaKey: true, altKey: true })
  rerender(<SplitEditorWorkspace {...props} workspace={{ ...props.workspace, split: false }} />)
  fireEvent.keyDown(screen.getByTestId('editor-/left.md'), { key: '™', code: 'Digit2', metaKey: true, altKey: true })
  expect(headingShortcut).toHaveBeenCalledTimes(3)
  expect(props.workspace.focusPane).toHaveBeenCalledTimes(focusCalls)
})

it('opens searchable bounded results in the clicked pane and returns focus on Escape', async () => {
  const props = fixture()
  props.entries = Array.from({ length: 100 }, (_, index) => ({ ...entry(`/page-${index}.md`), title: `Page ${index}`, aliases: [], outgoingLinks: [], belongsTo: [], relatedTo: [], relationships: {} }))
  render(<SplitEditorWorkspace {...props} />)
  const trigger = screen.getAllByRole('button', { name: 'Choose a page' })[1]
  fireEvent.click(trigger)
  const input = await screen.findByPlaceholderText('Search notes...')
  fireEvent.change(input, { target: { value: 'Page 42' } })
  fireEvent.keyDown(window, { key: 'Enter' })
  expect(props.workspace.selectNoteInPane).toHaveBeenCalledWith(expect.objectContaining({ path: '/page-42.md' }), 1)
  fireEvent.click(trigger)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(document.activeElement).toBe(trigger)
})

it('floats the Inspector only over a pane too narrow to share, and gives focus back when Escape closes it', () => {
  const widths = [425, 900]
  const resized: Array<() => void> = []
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resized.push(callback) } observe() {} disconnect() {} })
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { width: this.dataset.paneId ? widths[Number(this.dataset.paneId)] : 0 } as DOMRect
  })
  const props = fixture()
  const { rerender } = render(<SplitEditorWorkspace {...props} />)
  const backlinks = screen.getAllByRole('button', { name: 'Backlinks (0)' })[0]
  backlinks.focus()
  fireEvent.click(backlinks)
  rerender(<SplitEditorWorkspace {...props} inspectorCollapsed={false} />)
  const overlay = screen.getByTestId('inspector-/left.md')
  expect(overlay).toHaveAttribute('data-inspector-overlay')
  expect(document.activeElement).toBe(overlay)
  fireEvent.keyDown(overlay, { key: 'Escape' })
  expect(props.onToggleInspector).toHaveBeenCalledTimes(2)
  rerender(<SplitEditorWorkspace {...props} inspectorCollapsed />)
  expect(document.activeElement).toBe(backlinks)

  const right = { ...props, inspectorCollapsed: false, workspace: { ...props.workspace, activePane: 1 as const } }
  rerender(<SplitEditorWorkspace {...right} />)
  expect(screen.getByTestId('inspector-/right.md')).not.toHaveAttribute('data-inspector-overlay')
  widths[1] = 500
  act(() => resized.forEach(callback => callback()))
  expect(screen.getByTestId('inspector-/right.md')).toHaveAttribute('data-inspector-overlay')
  rect.mockRestore()
  vi.unstubAllGlobals()
})

describe('dragging a page tab', () => {
  // A 1000x600 page area; edge bands reach 30% in from each side.
  function renderDraggable(props: ReturnType<typeof fixture>) {
    const view = render(<SplitEditorWorkspace {...props} />)
    const area = view.container.querySelector('.ll-panes') as HTMLElement
    vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600, x: 0, y: 0, toJSON: () => ({}) })
    return view
  }
  // A normal mouse press reports the held button; some accessibility input reports none.
  const press = (tab: HTMLElement, buttons = 1) => fireEvent.pointerDown(tab, { clientX: 500, clientY: 20, button: 0, buttons, isPrimary: true })
  const moveTo = (clientX: number, clientY: number, buttons = 1) => fireEvent.pointerMove(window, { clientX, clientY, buttons, isPrimary: true })
  const release = (clientX: number, clientY: number) => fireEvent.pointerUp(window, { clientX, clientY, isPrimary: true })
  const offered = () => [...document.querySelectorAll<HTMLElement>('.ll-drop-zone')].map(zone => zone.dataset.edge)
  const pageTabs = () => screen.getAllByRole('button', { name: 'Choose a page' })

  it('previews edges, places the sole page on release, and does not open the picker', () => {
    const props = fixture()
    props.workspace = { ...props.workspace, split: false }
    renderDraggable(props)
    const [tab] = pageTabs()
    expect(tab).toHaveAttribute('title', 'Click to choose a page. Drag to an edge to split.')
    press(tab)
    moveTo(900, 300)
    expect(offered()).toEqual(['left', 'right', 'top', 'bottom'])
    expect(document.querySelector('.ll-drop-zone[data-active="true"]')).toHaveAttribute('data-edge', 'right')
    expect(screen.getByText('Place right', { selector: '[role="status"]' })).toBeInTheDocument()
    expect(props.workspace.placePane).not.toHaveBeenCalled()
    release(900, 300)
    fireEvent.click(tab)
    expect(props.workspace.placePane).toHaveBeenCalledWith(0, 'right')
    expect(document.querySelector('.ll-drop-overlay')).toBeNull()
    expect(tab).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps a short press as click-to-pick', () => {
    const props = fixture()
    renderDraggable(props)
    const [tab] = pageTabs()
    press(tab)
    moveTo(502, 21)
    release(502, 21)
    fireEvent.click(tab)
    expect(tab).toHaveAttribute('aria-expanded', 'true')
    expect(props.workspace.placePane).not.toHaveBeenCalled()
  })

  it('changes nothing, not even the active pane, on Escape, pointer cancel or a release away from an edge', () => {
    const props = fixture()
    renderDraggable(props)
    const otherTab = pageTabs()[1]
    press(otherTab)
    moveTo(100, 300)
    expect(offered()).toEqual(['left', 'top', 'bottom'])
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.querySelector('.ll-drop-overlay')).toBeNull()
    release(100, 300)
    fireEvent.click(otherTab)
    press(otherTab)
    moveTo(100, 300)
    fireEvent.pointerCancel(window)
    for (const [x, y] of [[500, 300], [1200, 300]]) {
      press(otherTab)
      moveTo(x, y)
      release(x, y)
    }
    // A valid preview followed by a release outside must not commit the old edge.
    press(otherTab)
    moveTo(100, 300)
    release(1200, 300)
    expect(props.workspace.placePane).not.toHaveBeenCalled()
    expect(props.workspace.focusPane).not.toHaveBeenCalled()
    expect(otherTab).toHaveAttribute('aria-expanded', 'false')
  })

  it('ends a drag released outside the window without moving anything', () => {
    const props = fixture()
    renderDraggable(props)
    const [tab] = pageTabs()
    press(tab)
    moveTo(900, 300)
    fireEvent.pointerMove(window, { clientX: 900, clientY: 300, buttons: 0, isPrimary: true })
    expect(document.querySelector('.ll-drop-overlay')).toBeNull()
    release(900, 300)
    press(tab)
    moveTo(900, 300)
    fireEvent.lostPointerCapture(tab)
    expect(document.querySelector('.ll-drop-overlay')).toBeNull()
    release(900, 300)
    expect(props.workspace.placePane).not.toHaveBeenCalled()
    expect(props.workspace.focusPane).not.toHaveBeenCalled()
  })

  it('drags with input that never reports a held button, and still cancels it every other way', () => {
    const props = fixture()
    props.workspace = { ...props.workspace, split: false }
    renderDraggable(props)
    const [tab] = pageTabs()
    press(tab, 0)
    moveTo(900, 300, 0)
    expect(document.querySelector('.ll-drop-zone[data-active="true"]')).toHaveAttribute('data-edge', 'right')
    release(900, 300)
    fireEvent.click(tab)
    expect(props.workspace.placePane).toHaveBeenCalledTimes(1)
    expect(props.workspace.placePane).toHaveBeenCalledWith(0, 'right')
    expect(tab).toHaveAttribute('aria-expanded', 'false')
    const cancels: Array<() => void> = [
      () => fireEvent.keyDown(window, { key: 'Escape' }),
      () => fireEvent.pointerCancel(window),
      () => fireEvent.lostPointerCapture(tab),
      () => fireEvent.blur(window),
      () => fireEvent.pointerDown(document.body, { button: 0, buttons: 0, isPrimary: true }),
    ]
    for (const cancel of cancels) {
      press(tab, 0)
      moveTo(900, 300, 0)
      cancel()
      expect(document.querySelector('.ll-drop-overlay')).toBeNull()
      release(900, 300)
    }
    press(tab, 0)
    moveTo(900, 300, 0)
    release(1200, 300)
    expect(props.workspace.placePane).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['the vault changes', (props: ReturnType<typeof fixture>) => ({ ...props, vaultPath: '/other-vault' })],
    ['the dragged page changes', (props: ReturnType<typeof fixture>) => ({ ...props, workspace: { ...props.workspace, paths: ['/new.md', '/right.md'] as const } })],
    ['a save or close transition starts', (props: ReturnType<typeof fixture>) => ({ ...props, transitionPending: true })],
  ])('cancels a drag in progress when %s', (_change, change) => {
    const props = { ...fixture(), vaultPath: '/vault' }
    const view = renderDraggable(props)
    press(pageTabs()[0])
    moveTo(900, 300)
    view.rerender(<SplitEditorWorkspace {...change(props)} />)
    expect(document.querySelector('.ll-drop-overlay')).toBeNull()
    release(900, 300)
    expect(props.workspace.placePane).not.toHaveBeenCalled()
  })

  it('follows visual slots after a swap without remounting editors', () => {
    activity.mount.mockClear(); activity.unmount.mockClear()
    const props = fixture()
    const { rerender } = render(<SplitEditorWorkspace {...props} />)
    rerender(<SplitEditorWorkspace {...props} workspace={{ ...props.workspace, order: [1, 0] }} />)
    expect(activity.mount).toHaveBeenCalledTimes(2)
    expect(activity.unmount).not.toHaveBeenCalled()
    const panes = [...document.querySelectorAll('section[data-pane-id]')]
    expect(panes.map(pane => [pane.getAttribute('data-pane-id'), pane.getAttribute('aria-label')])).toEqual([['1', 'Page pane 1'], ['0', 'Page pane 2']])
    fireEvent.keyDown(window, { key: '¡', code: 'Digit1', metaKey: true, altKey: true })
    expect(props.workspace.focusPane).toHaveBeenLastCalledWith(1)
  })

  it('places a focused page tab with Alt+Shift+Arrow but leaves editor keys alone', () => {
    const props = fixture()
    renderDraggable(props)
    fireEvent.keyDown(screen.getByTestId('editor-/left.md'), { key: 'ArrowRight', altKey: true, shiftKey: true })
    expect(props.workspace.placePane).not.toHaveBeenCalled()
    fireEvent.keyDown(pageTabs()[0], { key: 'ArrowRight', altKey: true, shiftKey: true })
    expect(props.workspace.placePane).toHaveBeenCalledWith(0, 'right')
  })
})

describe('dragging a note from the list', () => {
  type Props = ReturnType<typeof fixture> & { vaultPath?: string; transitionPending?: boolean }
  const third = { ...entry('/third.md'), title: 'Third', isA: null, archived: false, snippet: '', modifiedAt: null, createdAt: null, icon: null } as VaultEntry
  const onClickNote = vi.fn()
  const moveNoteToFolder = vi.fn()
  // jsdom has no layout: each step names the element under the pointer.
  let under: Element | null = null
  beforeEach(() => {
    under = null
    onClickNote.mockClear()
    moveNoteToFolder.mockClear()
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => under })
  })
  function SidebarFolder() {
    useSidebarNoteDropTargets({ canDropNoteOnType: () => false, canDropNoteOnFolder: () => true, changeNoteType: vi.fn(), moveNoteToFolder })
    return <div data-note-drop-folder="archive" data-testid="folder" />
  }
  // A real list row, a sidebar folder and a 1000x600 page area, as in the app.
  function renderWithNote(vaultPath?: string, rowEntry: VaultEntry = third) {
    const props: Props = { ...fixture(), vaultPath }
    props.entries = [...props.entries, third]
    const ui = (next: Props | null) => <>
      <NoteItem entry={rowEntry} isSelected={false} typeEntryMap={{}} onClickNote={onClickNote} />
      <SidebarFolder />
      {next && <SplitEditorWorkspace {...next} />}
    </>
    const view = render(ui(props))
    const area = view.container.querySelector('.ll-panes') as HTMLElement
    vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600, x: 0, y: 0, toJSON: () => ({}) })
    return { props, rerender: (next: Props | null) => view.rerender(ui(next)) }
  }
  const row = () => screen.getByRole('option')
  const press = (buttons = 1, extra = {}) =>
    fireEvent.pointerDown(row(), { pointerId: 1, clientX: 10, clientY: 10, button: 0, buttons, isPrimary: true, ...extra })
  const moveTo = (element: Element | null, clientX: number, clientY: number, buttons = 1) => {
    under = element
    fireEvent.pointerMove(window, { pointerId: 1, clientX, clientY, buttons, isPrimary: true })
  }
  const release = (element: Element | null, clientX: number, clientY: number) => {
    under = element
    fireEvent.pointerUp(window, { pointerId: 1, clientX, clientY, button: 0, isPrimary: true })
  }
  // The browser's click after a release lands where the pointer was released.
  const clickRow = (clientX: number, clientY: number) => fireEvent.click(row(), { detail: 1, clientX, clientY })
  const editor = (path: string) => screen.getByTestId(`editor-${path}`)
  const folder = () => screen.getByTestId('folder')
  const chip = () => document.querySelector('.ll-drag-chip')
  const zones = () => [...document.querySelectorAll<HTMLElement>('.ll-drop-zone')].map(zone => zone.dataset.edge)
  const activeZone = () => document.querySelector<HTMLElement>('.ll-drop-zone[data-active="true"]')?.dataset.edge

  it('previews an edge with the title chip, opens the note there once, and swallows only the release click', () => {
    const { props } = renderWithNote()
    press()
    moveTo(row(), 13, 10)
    expect(chip()).toBeNull()
    moveTo(editor('/left.md'), 900, 300)
    expect(activeZone()).toBe('right')
    expect(chip()).toHaveTextContent('Third')
    expect(chip()).toHaveStyle({ left: '900px', top: '300px' })
    expect(screen.getByText('Place right', { selector: '[role="status"]' })).toBeInTheDocument()
    expect(props.workspace.placeNote).not.toHaveBeenCalled()
    release(editor('/left.md'), 900, 300)
    clickRow(900, 300)
    expect(props.workspace.placeNote).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ path: '/third.md' }), { edge: 'right' })
    expect(document.querySelector('.ll-drop-overlay')).toBeNull()
    expect(chip()).toBeNull()
    expect(onClickNote).not.toHaveBeenCalled()
    clickRow(10, 10)
    expect(onClickNote).toHaveBeenCalledTimes(1)
  })

  it('moves the chip without rerendering the panes until the drop zone changes', () => {
    renderWithNote()
    press()
    moveTo(editor('/left.md'), 900, 300)
    activity.render.mockClear()
    moveTo(editor('/left.md'), 905, 310)
    moveTo(editor('/left.md'), 910, 320)
    expect(chip()).toHaveStyle({ left: '910px', top: '320px' })
    expect(activity.render).not.toHaveBeenCalled()
    moveTo(folder(), 50, 50)
    const zoneChange = activity.render.mock.calls.length
    expect(zoneChange).toBeGreaterThan(0)
    moveTo(folder(), 52, 50)
    moveTo(folder(), 54, 50)
    expect(chip()).toHaveStyle({ left: '54px', top: '50px' })
    expect(activity.render).toHaveBeenCalledTimes(zoneChange)
    release(null, 54, 50)
  })

  it('opens the note in the pane under the pointer for a centre drop', () => {
    const { props } = renderWithNote()
    press()
    moveTo(editor('/right.md'), 600, 300)
    expect(zones()).toContain('center')
    expect(screen.getByText('Open here', { selector: '[role="status"]' })).toBeInTheDocument()
    release(editor('/right.md'), 600, 300)
    expect(props.workspace.placeNote).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ path: '/third.md' }), { pane: 1 })
  })

  it('offers a page that is already open only the edges that move it', () => {
    const shown = { ...third, path: '/right.md', title: 'Right' } as VaultEntry
    const { props } = renderWithNote(undefined, shown)
    press()
    moveTo(editor('/left.md'), 100, 300)
    expect(zones()).toEqual(['left', 'top', 'bottom'])
    expect(activeZone()).toBe('left')
    release(editor('/left.md'), 100, 300)
    expect(props.workspace.placeNote).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ path: '/right.md' }), { edge: 'left' })
  })

  it('keeps a short press as a click and modified or secondary presses as list selection', () => {
    const { props } = renderWithNote()
    press()
    release(row(), 10, 10)
    clickRow(10, 10)
    expect(onClickNote).toHaveBeenCalledTimes(1)
    for (const extra of [{ metaKey: true }, { shiftKey: true }, { ctrlKey: true }, { button: 2 }]) {
      press(1, extra)
      moveTo(editor('/left.md'), 900, 300)
      expect(chip()).toBeNull()
      release(editor('/left.md'), 900, 300)
    }
    expect(props.workspace.placeNote).not.toHaveBeenCalled()
    expect(row()).toHaveAttribute('draggable', 'false')
    expect(fireEvent.dragStart(row())).toBe(false)
  })

  it('shows only the chip away from the page area and commits no earlier preview on an outside release', () => {
    const { props } = renderWithNote()
    const toolbar = document.querySelector('.ll-workspace-toolbar') as HTMLElement
    press()
    moveTo(editor('/left.md'), 900, 300)
    expect(activeZone()).toBe('right')
    moveTo(toolbar, 900, -10)
    expect(document.querySelector('.ll-drop-overlay')).toBeNull()
    expect(chip()).toHaveStyle({ left: '900px', top: '-10px' })
    expect(screen.getByText(/^Moving Third\./, { selector: '[role="status"]' })).toBeInTheDocument()
    release(toolbar, 900, -10)
    expect(chip()).toBeNull()
    const separator = screen.getByRole('separator')
    press()
    moveTo(separator, 500, 300)
    release(separator, 500, 300)
    expect(props.workspace.placeNote).not.toHaveBeenCalled()
  })

  it('cancels on Escape: clears the preview, drops nothing and still swallows the release click', () => {
    const { props } = renderWithNote()
    press()
    moveTo(editor('/left.md'), 900, 300)
    expect(fireEvent.keyDown(window, { key: 'Escape' })).toBe(false)
    expect(document.querySelector('.ll-drop-overlay')).toBeNull()
    expect(chip()).toBeNull()
    moveTo(editor('/left.md'), 900, 300)
    expect(chip()).toBeNull()
    release(editor('/left.md'), 900, 300)
    clickRow(900, 300)
    expect(props.workspace.placeNote).not.toHaveBeenCalled()
    expect(onClickNote).not.toHaveBeenCalled()
  })

  it('drags with input that never reports a held button, but a missed release cancels a normal press', () => {
    const { props } = renderWithNote()
    press(0)
    moveTo(editor('/left.md'), 900, 300, 0)
    expect(activeZone()).toBe('right')
    release(editor('/left.md'), 900, 300)
    expect(props.workspace.placeNote).toHaveBeenCalledTimes(1)
    press()
    moveTo(editor('/left.md'), 900, 300)
    moveTo(editor('/left.md'), 900, 300, 0)
    expect(chip()).toBeNull()
    release(editor('/left.md'), 900, 300)
    expect(props.workspace.placeNote).toHaveBeenCalledTimes(1)
  })

  it('sends one release to exactly one destination: a sidebar folder or the page area', () => {
    const { props } = renderWithNote()
    press()
    moveTo(editor('/left.md'), 900, 300)
    moveTo(folder(), 50, 50)
    expect(document.querySelector('.ll-drop-overlay')).toBeNull()
    expect(chip()).toHaveTextContent('Third')
    expect(folder()).toHaveAttribute('data-note-drop-state', 'valid')
    release(folder(), 50, 50)
    expect(moveNoteToFolder).toHaveBeenCalledExactlyOnceWith('/third.md', 'archive')
    expect(folder()).not.toHaveAttribute('data-note-drop-state')
    press()
    moveTo(folder(), 50, 50)
    moveTo(editor('/left.md'), 900, 300)
    expect(folder()).not.toHaveAttribute('data-note-drop-state')
    release(editor('/left.md'), 900, 300)
    expect(props.workspace.placeNote).toHaveBeenCalledTimes(1)
    expect(moveNoteToFolder).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['the vault changes', (props: Props): Props => ({ ...props, vaultPath: '/other-vault' })],
    ['a shown page changes', (props: Props): Props => ({ ...props, workspace: { ...props.workspace, paths: ['/left.md', '/moved.md'] } })],
    ['the layout changes', (props: Props): Props => ({ ...props, workspace: { ...props.workspace, orientation: 'vertical' } })],
    ['a save or close transition starts', (props: Props): Props => ({ ...props, transitionPending: true })],
  ])('revokes pane and sidebar destinations, before and after the threshold, when %s', (_change, change) => {
    const { props, rerender } = renderWithNote('/vault')
    press()
    moveTo(editor('/left.md'), 900, 300)
    moveTo(folder(), 50, 50)
    expect(folder()).toHaveAttribute('data-note-drop-state', 'valid')
    rerender(change(props))
    expect(folder()).not.toHaveAttribute('data-note-drop-state')
    expect(chip()).toBeNull()
    moveTo(folder(), 50, 50)
    expect(folder()).not.toHaveAttribute('data-note-drop-state')
    release(folder(), 50, 50)
    // Switching away and back must not revive a press made before the change.
    rerender(props)
    press()
    rerender(change(props))
    rerender(props)
    moveTo(folder(), 50, 50)
    expect(chip()).toBeNull()
    release(folder(), 50, 50)
    expect(moveNoteToFolder).not.toHaveBeenCalled()
    expect(props.workspace.placeNote).not.toHaveBeenCalled()
    press()
    moveTo(folder(), 50, 50)
    release(folder(), 50, 50)
    expect(moveNoteToFolder).toHaveBeenCalledExactlyOnceWith('/third.md', 'archive')
  })

  it('revokes the sidebar destination too when the page area unmounts mid-drag', () => {
    const { rerender } = renderWithNote()
    press()
    moveTo(folder(), 50, 50)
    expect(folder()).toHaveAttribute('data-note-drop-state', 'valid')
    rerender(null)
    expect(folder()).not.toHaveAttribute('data-note-drop-state')
    moveTo(folder(), 50, 50)
    expect(folder()).not.toHaveAttribute('data-note-drop-state')
    release(folder(), 50, 50)
    expect(moveNoteToFolder).not.toHaveBeenCalled()
  })

  it('leaves external editor drops to their own handlers', () => {
    const { props } = renderWithNote()
    const editorDrop = vi.fn()
    editor('/left.md').addEventListener('drop', editorDrop)
    const drop = new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 600, clientY: 300 })
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files', 'text/plain'], dropEffect: 'none', getData: () => '/Users/someone/notes.md' } })
    fireEvent(editor('/left.md'), drop)
    expect(drop.defaultPrevented).toBe(false)
    expect(editorDrop).toHaveBeenCalledTimes(1)
    expect(props.workspace.placeNote).not.toHaveBeenCalled()
  })
})
