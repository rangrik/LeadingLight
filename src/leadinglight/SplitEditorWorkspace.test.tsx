import { useEffect } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SplitEditorWorkspace } from './SplitEditorWorkspace'
import type { EditorProps } from '../components/Editor'
import type { SplitWorkspaceController } from './useSplitWorkspace'
import type { VaultEntry } from '../types'
import { NOTE_DRAG_MIME_TYPE, readDraggedNotePath, writeNoteDragData } from '../utils/noteDragDrop'
import { usePageHistoryAction } from './pageHistory/pageHistoryContext'

const activity = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn(), raw: vi.fn(), flush: vi.fn() }))
vi.mock('../components/LazyEditor', () => ({ LazyEditor: function TestEditor(props: EditorProps) {
  const { activeTabPath: path, rawToggleRef, flushPendingEditorContentRef } = props
  const openHistory = usePageHistoryAction()
  useEffect(() => {
    activity.mount(path)
    return () => { activity.unmount(path) }
  }, [path])
  useEffect(() => {
    if (rawToggleRef) rawToggleRef.current = () => activity.raw(path)
    if (flushPendingEditorContentRef) flushPendingEditorContentRef.current = target => { if (target === path) activity.flush(path) }
  }, [path, rawToggleRef, flushPendingEditorContentRef])
  return <>
    <div contentEditable suppressContentEditableWarning data-testid={`editor-${path}`}>{path}</div>
    {openHistory && <button data-testid={`history-${path}`} onClick={event => openHistory(event.currentTarget)}>history</button>}
    {!props.inspectorCollapsed && <div data-testid={`inspector-${path}`} tabIndex={-1} data-inspector-overlay={props.inspectorOverlay ? '' : undefined} />}
  </>
} }))

const entry = (path: string) => ({ path, title: path, filename: path, fileKind: 'markdown', aliases: [], outgoingLinks: [], relationships: {} }) as unknown as VaultEntry
function fixture() {
  const entries = [entry('/left.md'), entry('/right.md')]
  const workspace: SplitWorkspaceController = {
    activePane: 0, split: true, orientation: 'horizontal', ratio: 50, paths: ['/left.md', '/right.md'], order: [0, 1], placePane: vi.fn(() => true), placeNote: vi.fn(async () => true),
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
  function renderWithNote() {
    const props = fixture()
    props.entries = [...props.entries, entry('/third.md')]
    const view = render(<SplitEditorWorkspace {...props} />)
    const area = view.container.querySelector('.ll-panes') as HTMLElement
    vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600, x: 0, y: 0, toJSON: () => ({}) })
    return { props, view }
  }
  // jsdom has no DragEvent; browsers hide the payload (getData) until drop.
  function drag(type: string, target: Element, { x = 0, y = 0, data = '', types = [NOTE_DRAG_MIME_TYPE, 'text/plain'], synthetic = false } = {}) {
    const transfer = { types, dropEffect: 'none', getData: () => data }
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
    Object.defineProperty(event, 'dataTransfer', { value: transfer })
    if (synthetic) Object.defineProperty(event, 'synthetic', { value: true })
    fireEvent(target, event)
    return { event, transfer }
  }
  // Starts a list drag the way a note row does: write the payload, then let dragstart bubble.
  const startListDrag = (path: string) => {
    writeNoteDragData({ setData: vi.fn(), effectAllowed: 'none' } as unknown as DataTransfer, path)
    drag('dragstart', document.body)
  }
  const editor = (path: string) => screen.getByTestId(`editor-${path}`)

  it('previews a locked list drag at an edge, then opens the note there without reaching the editor', () => {
    const { props } = renderWithNote()
    const editorDrop = vi.fn()
    const sidebarDrop = vi.fn()
    editor('/left.md').addEventListener('drop', editorDrop)
    document.addEventListener('drop', sidebarDrop, true)
    try {
      startListDrag('/third.md')
      const over = drag('dragover', editor('/left.md'), { x: 900, y: 300 })
      expect(over.event.defaultPrevented).toBe(true)
      expect(over.transfer.dropEffect).toBe('move')
      expect(document.querySelector('.ll-drop-zone[data-active="true"]')).toHaveAttribute('data-edge', 'right')
      const dropped = drag('drop', editor('/left.md'), { x: 900, y: 300, data: '/third.md' })
      expect(dropped.event.defaultPrevented).toBe(true)
      expect(props.workspace.placeNote).toHaveBeenCalledWith(expect.objectContaining({ path: '/third.md' }), { edge: 'right' })
      expect(editorDrop).not.toHaveBeenCalled()
      expect(sidebarDrop).not.toHaveBeenCalled()
      expect(readDraggedNotePath(null)).toBeNull()
      expect(document.querySelector('.ll-drop-overlay')).toBeNull()
    } finally { document.removeEventListener('drop', sidebarDrop, true) }
  })

  it('opens a list note in the pane under the pointer for a centre drop', () => {
    const { props } = renderWithNote()
    startListDrag('/third.md')
    drag('dragover', editor('/right.md'), { x: 600, y: 300 })
    expect(document.querySelector('.ll-drop-zone[data-edge="center"]')).toBeInTheDocument()
    expect(screen.getByText('Open here', { selector: '[role="status"]' })).toBeInTheDocument()
    drag('drop', editor('/right.md'), { x: 600, y: 300, data: '/third.md' })
    expect(props.workspace.placeNote).toHaveBeenCalledWith(expect.objectContaining({ path: '/third.md' }), { pane: 1 })
  })

  it('consumes stale, invalid and mid-transition drops so the path never reaches the editor', () => {
    const { props, view } = renderWithNote()
    const editorDrop = vi.fn()
    editor('/left.md').addEventListener('drop', editorDrop)
    startListDrag('/other-vault/ghost.md')
    expect(drag('drop', editor('/left.md'), { x: 600, y: 300, data: '/other-vault/ghost.md' }).event.defaultPrevented).toBe(true)
    startListDrag('/third.md')
    expect(drag('drop', screen.getByRole('separator'), { x: 500, y: 300, data: '/third.md' }).event.defaultPrevented).toBe(true)
    view.rerender(<SplitEditorWorkspace {...props} transitionPending />)
    startListDrag('/third.md')
    expect(drag('drop', editor('/left.md'), { x: 900, y: 300, data: '/third.md' }).event.defaultPrevented).toBe(true)
    expect(editorDrop).not.toHaveBeenCalled()
    expect(props.workspace.placeNote).not.toHaveBeenCalled()
  })

  it('ignores a list drag that started before the pages changed, but still keeps its path out of the editor', () => {
    const { props, view } = renderWithNote()
    const editorDrop = vi.fn()
    editor('/left.md').addEventListener('drop', editorDrop)
    startListDrag('/third.md')
    view.rerender(<SplitEditorWorkspace {...props} workspace={{ ...props.workspace, paths: ['/left.md', '/third-moved.md'] as const }} />)
    const over = drag('dragover', editor('/left.md'), { x: 900, y: 300 })
    expect(over.event.defaultPrevented).toBe(true)
    expect(document.querySelector('.ll-drop-overlay')).toBeNull()
    expect(drag('drop', editor('/left.md'), { x: 900, y: 300, data: '/third.md' }).event.defaultPrevented).toBe(true)
    writeNoteDragData({ setData: vi.fn(), effectAllowed: 'none' } as unknown as DataTransfer, '/third.md')
    expect(drag('drop', editor('/left.md'), { x: 900, y: 300, data: '/third.md' }).event.defaultPrevented).toBe(true)
    expect(editorDrop).not.toHaveBeenCalled()
    expect(props.workspace.placeNote).not.toHaveBeenCalled()
  })

  it('leaves external drops and sidebar targets to their own handlers, once each', () => {
    const { props } = renderWithNote()
    const editorDrop = vi.fn()
    editor('/left.md').addEventListener('drop', editorDrop)
    const external = drag('drop', editor('/left.md'), { x: 600, y: 300, data: '/Users/someone/notes.md', types: ['text/plain'] })
    expect(external.event.defaultPrevented).toBe(false)
    expect(editorDrop).toHaveBeenCalledTimes(1)
    const folder = document.body.appendChild(document.createElement('div'))
    const folderDrop = vi.fn()
    folder.addEventListener('drop', folderDrop)
    try {
      startListDrag('/third.md')
      expect(drag('drop', folder, { data: '/third.md' }).event.defaultPrevented).toBe(false)
      expect(folderDrop).toHaveBeenCalledTimes(1)
      expect(readDraggedNotePath(null)).toBe('/third.md')
    } finally { folder.remove() }
    expect(props.workspace.placeNote).not.toHaveBeenCalled()
  })

  it('rejects a toolbar drop forwarded into an editor without inserting its note path', () => {
    const { props, view } = renderWithNote()
    const toolbar = view.container.querySelector('.ll-workspace-toolbar') as HTMLElement
    const editorDrop = vi.fn()
    editor('/left.md').addEventListener('drop', editorDrop)
    // BlockNote forwards nearby out-of-editor drops from its document listener.
    const forwardOutsideDrop = vi.fn(() => {
      // Sidebar handlers still need the original session when the drop is outside.
      expect(readDraggedNotePath(null)).toBe('/third.md')
      const forwarded = drag('drop', editor('/left.md'), { x: 600, y: 300, data: '/third.md', synthetic: true })
      expect(forwarded.event.defaultPrevented).toBe(true)
    })
    document.addEventListener('drop', forwardOutsideDrop, true)
    try {
      startListDrag('/third.md')
      const original = drag('drop', toolbar, { x: 600, y: -10, data: '/third.md' })
      expect(original.event.defaultPrevented).toBe(false)
      expect(forwardOutsideDrop).toHaveBeenCalledTimes(1)
      expect(props.workspace.placeNote).not.toHaveBeenCalled()
      expect(editorDrop).not.toHaveBeenCalled()
      expect(document.querySelector('.ll-drop-overlay')).toBeNull()
    } finally { document.removeEventListener('drop', forwardOutsideDrop, true) }
  })

  it('ignores a toolbar hover forwarded into an editor and still previews a real return to the pane', () => {
    const { view } = renderWithNote()
    const toolbar = view.container.querySelector('.ll-workspace-toolbar') as HTMLElement
    const forwardOutsideHover = vi.fn(() => {
      drag('dragover', editor('/left.md'), { x: 600, y: 300, synthetic: true })
    })
    document.addEventListener('dragover', forwardOutsideHover, true)
    try {
      startListDrag('/third.md')
      drag('dragover', toolbar, { x: 600, y: -10 })
      expect(forwardOutsideHover).toHaveBeenCalledTimes(1)
      expect(document.querySelector('.ll-drop-overlay')).toBeNull()
      drag('dragover', editor('/left.md'), { x: 900, y: 300 })
      expect(document.querySelector('.ll-drop-zone[data-active="true"]')).toHaveAttribute('data-edge', 'right')
    } finally { document.removeEventListener('dragover', forwardOutsideHover, true) }
  })

  it('clears the preview when the drag ends or moves outside the page area', () => {
    renderWithNote()
    const outside = document.body.appendChild(document.createElement('div'))
    try {
      startListDrag('/third.md')
      drag('dragover', editor('/left.md'), { x: 900, y: 300 })
      expect(document.querySelector('.ll-drop-overlay')).toBeInTheDocument()
      drag('dragover', outside)
      expect(document.querySelector('.ll-drop-overlay')).toBeNull()
      drag('dragover', editor('/left.md'), { x: 900, y: 300 })
      fireEvent(window, new Event('dragend'))
      expect(document.querySelector('.ll-drop-overlay')).toBeNull()
    } finally { outside.remove() }
  })
})
