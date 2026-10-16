import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { readyPageFor, requestEditorFocus, tryFocusReadyPage, useEditorFocus } from './useEditorFocus'
import type { FocusableEditor } from './editorFocusUtils'
import { resumeEditorFocus, suspendEditorFocus } from './editorFocusOwnership'
import { trackEvent } from '../lib/telemetry'

vi.mock('../lib/telemetry', () => ({
  trackEvent: vi.fn(),
}))

function makeTiptapMock(hasHeading: boolean | Array<number | null> = true, headingNodeSize = 15) {
  const headingSizes = Array.isArray(hasHeading)
    ? hasHeading
    : [hasHeading ? headingNodeSize : null]
  const chainResult = { setTextSelection: vi.fn().mockReturnThis(), run: vi.fn() }
  let headingAttempt = 0
  const descendantsMock = vi.fn().mockImplementation((cb: (node: { type: { name: string }; nodeSize: number }, pos: number) => boolean | void) => {
    const currentHeadingSize = headingSizes[Math.min(headingAttempt, headingSizes.length - 1)]
    headingAttempt += 1
    if (currentHeadingSize !== null) cb({ type: { name: 'heading' }, nodeSize: currentHeadingSize }, 2)
  })
  return {
    state: { doc: { descendants: descendantsMock } },
    chain: vi.fn(() => chainResult),
    _chainResult: chainResult,
    _descendantsMock: descendantsMock,
  }
}

function expectSelectionRange(
  tiptap: ReturnType<typeof makeTiptapMock>,
  range: { from: number; to: number },
) {
  expect(tiptap.chain).toHaveBeenCalled()
  expect(tiptap._chainResult.setTextSelection).toHaveBeenCalledWith(range)
  expect(tiptap._chainResult.run).toHaveBeenCalled()
}

describe('useEditorFocus', () => {
  afterEach(() => {
    resumeEditorFocus()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  function setup(
    isMounted: boolean,
    tiptap?: ReturnType<typeof makeTiptapMock>,
    editorOverrides: Record<string, unknown> = {},
  ) {
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    editable.tabIndex = -1
    document.body.appendChild(editable)
    const editor = {
      focus: vi.fn(() => editable.focus()),
      _tiptapEditor: tiptap,
      ...editorOverrides,
    } as FocusableEditor & Record<string, unknown>
    const mountedRef = { current: isMounted }
    const hook = renderHook(() => useEditorFocus(editor, mountedRef))
    return { editor, tiptap, editable, unmount: hook.unmount }
  }

  it('focuses editor via rAF when already mounted', async () => {
    const rAF = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
    const { editor } = setup(true)

    window.dispatchEvent(new CustomEvent('laputa:focus-editor'))

    expect(rAF).toHaveBeenCalled()
    expect(editor.focus).toHaveBeenCalled()
  })

  it('focuses editor via setTimeout when not yet mounted', () => {
    vi.useFakeTimers()
    const { editor } = setup(false)

    window.dispatchEvent(new CustomEvent('laputa:focus-editor'))

    expect(editor.focus).not.toHaveBeenCalled()
    vi.advanceTimersByTime(80)
    expect(editor.focus).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('waits for the matching tab swap event when a target path is provided', () => {
    const rAF = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
    vi.spyOn(window, 'setTimeout')
    const { editor } = setup(true)

    window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { path: '/vault/new-note.md' } }))

    expect(editor.focus).not.toHaveBeenCalled()
    expect(rAF).not.toHaveBeenCalled()

    window.dispatchEvent(new CustomEvent('laputa:editor-tab-swapped', { detail: { path: '/vault/other.md' } }))
    expect(editor.focus).not.toHaveBeenCalled()

    window.dispatchEvent(new CustomEvent('laputa:editor-tab-swapped', { detail: { path: '/vault/new-note.md' } }))
    expect(rAF).toHaveBeenCalled()
    expect(editor.focus).toHaveBeenCalled()
  })

  it('recovers new-note focus when late rendering returns focus to the document chrome', () => {
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
    const { editor } = setup(true)

    window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { path: '/vault/new-note.md' } }))
    window.dispatchEvent(new CustomEvent('laputa:editor-tab-swapped', { detail: { path: '/vault/new-note.md' } }))
    expect(editor.focus).toHaveBeenCalledTimes(1)

    document.body.tabIndex = -1
    document.body.focus()
    vi.advanceTimersByTime(200)

    expect(editor.focus).toHaveBeenCalledTimes(2)

    document.body.focus()
    vi.advanceTimersByTime(400)

    expect(editor.focus).toHaveBeenCalledTimes(3)

    document.body.focus()
    vi.advanceTimersByTime(600)

    expect(editor.focus).toHaveBeenCalledTimes(4)

    document.body.focus()
    vi.advanceTimersByTime(1_000)

    expect(editor.focus).toHaveBeenCalledTimes(5)

    document.body.focus()
    vi.advanceTimersByTime(2_000)

    expect(editor.focus).toHaveBeenCalledTimes(6)
    vi.useRealTimers()
  })

  it('recovers document focus while the editor mount ref is still settling', () => {
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
    const { editor } = setup(false)

    window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { path: '/vault/new-note.md' } }))
    window.dispatchEvent(new CustomEvent('laputa:editor-tab-swapped', { detail: { path: '/vault/new-note.md' } }))
    vi.advanceTimersByTime(80)
    expect(editor.focus).toHaveBeenCalledTimes(1)

    document.body.tabIndex = -1
    document.body.focus()
    vi.advanceTimersByTime(80)

    expect(editor.focus).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('resumes editor focus ownership for an explicit new-note target', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
    const { editor } = setup(true)
    suspendEditorFocus(document.body)

    window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { path: '/vault/new-note.md' } }))
    window.dispatchEvent(new CustomEvent('laputa:editor-tab-swapped', { detail: { path: '/vault/new-note.md' } }))

    expect(editor.focus).toHaveBeenCalledTimes(1)
  })

  it('moves focus from the control that explicitly created the note', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
    const { editor } = setup(true)
    const createButton = document.createElement('button')
    document.body.appendChild(createButton)
    createButton.focus()

    window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { path: '/vault/new-note.md' } }))
    window.dispatchEvent(new CustomEvent('laputa:editor-tab-swapped', { detail: { path: '/vault/new-note.md' } }))

    expect(editor.focus).toHaveBeenCalledTimes(1)
  })

  it('reclaims focus ownership when the launching surface suspends it during the tab swap', () => {
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
    const { editor } = setup(true)

    window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { path: '/vault/new-note.md' } }))
    suspendEditorFocus(document.body)
    window.dispatchEvent(new CustomEvent('laputa:editor-tab-swapped', { detail: { path: '/vault/new-note.md' } }))

    expect(editor.focus).toHaveBeenCalledTimes(1)

    suspendEditorFocus(document.body)
    document.body.tabIndex = -1
    document.body.focus()
    vi.advanceTimersByTime(200)

    expect(editor.focus).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('carries a pending focus request across an editor remount', () => {
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
    requestEditorFocus({ path: '/vault/new-note.md', selectTitle: true })

    const first = setup(true)
    first.unmount()
    const second = setup(true)
    window.dispatchEvent(new CustomEvent('laputa:editor-tab-swapped', { detail: { path: '/vault/new-note.md' } }))

    expect(first.editor.focus).not.toHaveBeenCalled()
    expect(second.editor.focus).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('moves focus into its own pane when an editor in another pane has focus', () => {
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
    const paneEditable = (path: string, active: boolean) => {
      const pane = document.createElement('div')
      Object.assign(pane.dataset, { paneId: path, notePath: path, paneActive: String(active) })
      const editable = Object.assign(document.createElement('div'), { tabIndex: -1 })
      editable.setAttribute('contenteditable', 'true')
      document.body.appendChild(pane).appendChild(editable)
      return editable
    }
    const today = paneEditable('/vault/today.md', true)
    const garden = paneEditable('/vault/garden.md', false)
    const editor = { focus: vi.fn(() => today.focus()), prosemirrorView: { dom: today } }
    renderHook(() => useEditorFocus(editor, { current: true }, '/vault/today.md'))
    garden.focus()

    window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { path: '/vault/today.md' } }))
    vi.advanceTimersByTime(250)

    expect(document.activeElement).toBe(today)
    vi.useRealTimers()
  })

  it('focuses a new page whose editor was unmounted when its swap finished', () => {
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
    const pane = document.body.appendChild(document.createElement('section'))
    Object.assign(pane.dataset, { paneId: '0', notePath: '/vault/today.md', paneActive: 'true' })
    const today = Object.assign(document.createElement('div'), { className: 'ProseMirror', tabIndex: -1 })
    today.setAttribute('contenteditable', 'true')
    // Like Tiptap: while the canvas is away, reading the view's DOM throws.
    const view = { get dom() { if (!today.isConnected) throw new Error('view not available'); return today } }
    renderHook(() => useEditorFocus({ focus: vi.fn(), prosemirrorView: view }, { current: true }, '/vault/today.md'))

    window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { path: '/vault/today.md' } }))
    window.dispatchEvent(new CustomEvent('laputa:editor-tab-swapped', { detail: { path: '/vault/today.md' } }))
    pane.appendChild(today)
    vi.advanceTimersByTime(160)

    expect(document.activeElement).toBe(today)
    vi.useRealTimers()
  })

  describe('a page its editor already shows', () => {
    const paneEditable = (path: string, active: boolean) => {
      const pane = document.body.appendChild(document.createElement('section'))
      Object.assign(pane.dataset, { paneId: path, notePath: path, paneActive: String(active) })
      const editable = pane.appendChild(Object.assign(document.createElement('div'), { tabIndex: -1 }))
      editable.setAttribute('contenteditable', 'true')
      return { pane, editable }
    }
    const readyEditor = (dom: () => HTMLElement) => ({
      focus: vi.fn(() => dom().focus()),
      prosemirrorView: { get dom() { return dom() } },
      document: [{ id: 'first' }, { id: 'last' }],
      setTextCursorPosition: vi.fn(),
    })

    it('takes the keyboard now with the caret at the end, even when it already had focus', () => {
      const { editable } = paneEditable('/vault/today.md', true)
      const editor = readyEditor(() => editable)
      renderHook(() => useEditorFocus(editor, { current: true }, '/vault/today.md', '/vault/today.md'))

      expect(tryFocusReadyPage('/vault/today.md')).toBe(true)
      expect(document.activeElement).toBe(editable)
      expect(editor.setTextCursorPosition).toHaveBeenLastCalledWith('last', 'end')
      editor.setTextCursorPosition.mockClear()
      expect(tryFocusReadyPage('/vault/today.md')).toBe(true)
      expect(editor.setTextCursorPosition).toHaveBeenCalledWith('last', 'end')
    })

    it('moves the keyboard from the other pane only once the page pane is active', () => {
      const garden = paneEditable('/vault/garden.md', true).editable
      const today = paneEditable('/vault/today-other.md', false)
      renderHook(() => useEditorFocus(readyEditor(() => today.editable), { current: true }, '/vault/today-other.md', '/vault/today-other.md'))
      garden.focus()

      expect(tryFocusReadyPage('/vault/today-other.md')).toBe(false)
      expect(document.activeElement).toBe(garden)
      today.pane.dataset.paneActive = 'true'
      expect(tryFocusReadyPage('/vault/today-other.md')).toBe(true)
      expect(document.activeElement).toBe(today.editable)
    })

    it('refuses without taking focus when the editor is not ready, sits in another page pane, or has no view', () => {
      const { editable } = paneEditable('/vault/loading.md', true)
      const elsewhere = paneEditable('/vault/elsewhere.md', true).editable
      const notReady = readyEditor(() => editable)
      renderHook(() => useEditorFocus(notReady, { current: true }, '/vault/loading.md', null))
      const misplaced = readyEditor(() => elsewhere)
      renderHook(() => useEditorFocus(misplaced, { current: true }, '/vault/misplaced.md', '/vault/misplaced.md'))
      // Raw or diff mode unmounts the rich canvas; then reading the view's DOM throws.
      const unmounted = readyEditor(() => { throw new Error('view not available') })
      const raw = renderHook(() => useEditorFocus(unmounted, { current: true }, '/vault/raw.md', '/vault/raw.md'))

      expect(tryFocusReadyPage('/vault/loading.md')).toBe(false)
      expect(tryFocusReadyPage('/vault/misplaced.md')).toBe(false)
      expect(tryFocusReadyPage('/vault/raw.md')).toBe(false)
      for (const editor of [notReady, misplaced, unmounted]) expect(editor.focus).not.toHaveBeenCalled()
      raw.unmount()
      expect(tryFocusReadyPage('/vault/raw.md')).toBe(false)
    })

    // Seam: the page takes the keyboard before the draft goes in, only in an active pane; only the queue's receipt counts.
    it('takes the keyboard before queueing the draft, and reports a failed insert as uncertain', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { pane, editable } = paneEditable('/vault/new.md', false)
      const steps: string[] = []
      const view = { dom: editable, editable: true, focus: vi.fn(() => { steps.push('focus'); editable.focus() }) }
      const editor = { ...readyEditor(() => editable), prosemirrorView: view }
      const receipt = { path: '/vault/new.md', content: 'words', session: 1, seq: 1 }
      const takeDraft = vi.fn((text: string) => { steps.push(`queued ${text}`); return receipt })
      renderHook(() => useEditorFocus(editor, { current: true }, '/vault/new.md', '/vault/new.md', takeDraft))
      const page = readyPageFor('/vault/new.md')

      expect(page?.accept('words')).toEqual({ kind: 'notReady' })
      pane.dataset.paneActive = 'true'
      expect(page?.pane()).toBe('/vault/new.md')
      expect(page?.accept('words')).toEqual({ kind: 'delivered', receipt, focused: true })
      expect(steps).toEqual(['focus', 'queued words'])

      takeDraft.mockImplementation(() => { throw new Error('not queued') })
      expect(page?.accept('again')).toEqual({ kind: 'uncertain' })
    })

    it('a background focus request does not take the keyboard from a pending draft field', () => {
      vi.useFakeTimers()
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
      const { editable } = paneEditable('/vault/late.md', true)
      renderHook(() => useEditorFocus(readyEditor(() => editable), { current: true }, '/vault/late.md'))
      const draft = document.body.appendChild(document.createElement('div'))
      draft.dataset.pendingCapture = 'true'
      const field = draft.appendChild(document.createElement('textarea'))
      field.focus()

      requestEditorFocus({ path: '/vault/late.md', cursorAtEnd: true })
      vi.advanceTimersByTime(6_000)
      expect(document.activeElement).toBe(field)
      vi.useRealTimers()
    })
  })

  it('falls back to focusing when the swap event never arrives', () => {
    vi.useFakeTimers()
    const rAF = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
    const { editor } = setup(true)

    window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { path: '/vault/new-note.md' } }))

    expect(editor.focus).not.toHaveBeenCalled()
    vi.advanceTimersByTime(249)
    expect(editor.focus).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(rAF).toHaveBeenCalled()
    expect(editor.focus).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('cleans up event listener on unmount', () => {
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    editable.tabIndex = -1
    document.body.appendChild(editable)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal mock for test
    const editor = { focus: vi.fn(() => editable.focus()) } as any
    const mountedRef = { current: true }
    const { unmount } = renderHook(() => useEditorFocus(editor, mountedRef))

    unmount()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
    window.dispatchEvent(new CustomEvent('laputa:focus-editor'))

    expect(editor.focus).not.toHaveBeenCalled()
  })

  it('falls back to focusing the editable DOM node when editor.focus does not make it active', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
    const editable = document.createElement('div')
    editable.className = 'ProseMirror'
    editable.setAttribute('contenteditable', 'true')
    editable.tabIndex = -1
    document.body.appendChild(editable)
    const editableFocus = vi.spyOn(editable, 'focus')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal mock for test
    const editor = { focus: vi.fn(), _tiptapEditor: undefined } as any
    const mountedRef = { current: true }
    renderHook(() => useEditorFocus(editor, mountedRef))

    window.dispatchEvent(new CustomEvent('laputa:focus-editor'))

    expect(editor.focus).toHaveBeenCalled()
    expect(editableFocus).toHaveBeenCalled()
  })

  describe('selectTitle behavior', () => {
    it('selects H1 text when selectTitle is true and editor is mounted', () => {
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
      const tiptap = makeTiptapMock(true)
      const { editor } = setup(true, tiptap)

      window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { selectTitle: true } }))

      expect(editor.focus).toHaveBeenCalled()
      expectSelectionRange(tiptap, { from: 3, to: 16 })
    })

    it('does not select title when selectTitle is false (default)', () => {
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
      const tiptap = makeTiptapMock(true)
      const { editor } = setup(true, tiptap)

      window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { selectTitle: false } }))

      expect(editor.focus).toHaveBeenCalled()
      expect(tiptap.chain).not.toHaveBeenCalled()
    })

    it('does not select title when selectTitle is absent from event detail', () => {
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
      const tiptap = makeTiptapMock(true)
      const { editor } = setup(true, tiptap)

      window.dispatchEvent(new CustomEvent('laputa:focus-editor'))

      expect(editor.focus).toHaveBeenCalled()
      expect(tiptap.chain).not.toHaveBeenCalled()
    })

    it('skips selection when no heading found in document', () => {
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
      const tiptap = makeTiptapMock(false)
      const { editor } = setup(true, tiptap)

      window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { selectTitle: true } }))

      expect(editor.focus).toHaveBeenCalled()
      expect(tiptap.chain).not.toHaveBeenCalled()
    })

    it('places a text cursor inside an empty H1 instead of selecting through the next block', () => {
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
      const tiptap = makeTiptapMock(true)
      const setTextCursorPosition = vi.fn()
      const { editor } = setup(true, tiptap, {
        document: [
          { id: 'title', type: 'heading', props: { level: 1 }, content: [] },
          { id: 'body', type: 'paragraph', props: {}, content: [] },
        ],
        setTextCursorPosition,
      })

      window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { selectTitle: true } }))

      expect(editor.focus).toHaveBeenCalled()
      expect(setTextCursorPosition).toHaveBeenCalledWith('title', 'start')
      expect(tiptap.chain).not.toHaveBeenCalled()
    })

    it('selects H1 text after timeout when editor not yet mounted', () => {
      vi.useFakeTimers()
      // Mock rAF synchronously so the deferred selectFirstHeading call inside doFocus
      // runs immediately when requestAnimationFrame is invoked, keeping the test simple.
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
      const tiptap = makeTiptapMock(true)
      const { editor } = setup(false, tiptap)

      window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { selectTitle: true } }))

      expect(editor.focus).not.toHaveBeenCalled()
      vi.advanceTimersByTime(80)
      expect(editor.focus).toHaveBeenCalled()
      expect(tiptap.chain).toHaveBeenCalled()
      expect(tiptap._chainResult.setTextSelection).toHaveBeenCalledWith({ from: 3, to: 16 })
      vi.useRealTimers()
    })

    it('selection happens in second rAF (not first), allowing content swap to complete', () => {
      // Verify the double-rAF contract: focus in rAF1, selection deferred to rAF2.
      // This ensures the new note's blocks are applied (via queueMicrotask between frames)
      // before selectFirstHeading runs.
      const callbacks: FrameRequestCallback[] = []
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        callbacks.push(cb)
        return callbacks.length
      })
      const tiptap = makeTiptapMock(true)
      const { editor } = setup(true, tiptap)

      window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { selectTitle: true } }))

      // rAF 1 is scheduled (doFocus)
      expect(callbacks.length).toBe(1)
      callbacks[0](0)

      // After rAF 1: editor focused, but selection NOT yet triggered
      expect(editor.focus).toHaveBeenCalled()
      expect(tiptap.chain).not.toHaveBeenCalled()

      // rAF 2 is now scheduled (selectFirstHeading)
      expect(callbacks.length).toBe(2)
      callbacks[1](0)

      // After rAF 2: heading is selected
      expectSelectionRange(tiptap, { from: 3, to: 16 })
    })

    it('retries title selection until the heading arrives on a later frame', () => {
      const callbacks: FrameRequestCallback[] = []
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        callbacks.push(cb)
        return callbacks.length
      })
      const tiptap = makeTiptapMock([null, 15])
      const { editor } = setup(true, tiptap)

      window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { selectTitle: true } }))

      expect(callbacks.length).toBe(1)
      callbacks[0](0)

      expect(editor.focus).toHaveBeenCalled()
      expect(tiptap.chain).not.toHaveBeenCalled()

      expect(callbacks.length).toBe(2)
      callbacks[1](0)

      expect(tiptap.chain).not.toHaveBeenCalled()
      expect(callbacks.length).toBe(3)

      callbacks[2](0)

      expectSelectionRange(tiptap, { from: 3, to: 16 })
    })

    it('recovers and retries a mismatched title-selection transaction', () => {
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const tiptap = makeTiptapMock(true)
      tiptap._chainResult.run.mockImplementationOnce(() => {
        throw new RangeError('Applying a mismatched transaction')
      })
      const { editor } = setup(true, tiptap)

      window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { selectTitle: true } }))

      expect(editor.focus).toHaveBeenCalled()
      expect(tiptap._chainResult.run).toHaveBeenCalledTimes(2)
      expect(consoleWarn).toHaveBeenCalledWith(
        '[editor] Recovered rich-editor transform error:',
        expect.any(RangeError),
      )
      expect(trackEvent).toHaveBeenCalledWith('rich_editor_transform_error_recovered', {
        reason: 'mismatched_transaction',
      })
    })

    it('collapses selection to the caret for an empty H1', () => {
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0 })
      const tiptap = makeTiptapMock(true, 2)
      const { editor } = setup(true, tiptap)

      window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { selectTitle: true } }))

      expect(editor.focus).toHaveBeenCalled()
      expectSelectionRange(tiptap, { from: 3, to: 3 })
    })
  })
})
