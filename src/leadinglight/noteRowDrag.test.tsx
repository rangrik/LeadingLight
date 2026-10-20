import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelNoteRowDrag, registerNoteRowDropTarget, startNoteRowDrag, type NoteRowPoint } from './noteRowDrag'

// jsdom has no layout; each test chooses what lies under the pointer.
beforeEach(() => { Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null }) })

const disposers: Array<() => void> = []
const point = { pointerId: 7, button: 0, buttons: 1, isPrimary: true, clientX: 10, clientY: 10 }
function Row({ path = '/vault/alpha.md' }: { path?: string }) {
  return <div data-testid="row" onPointerDown={event => startNoteRowDrag(event, { path })}>
    <button data-property-chip="true" data-testid="chip">Related</button>
  </div>
}
function target(accepts: (element: Element | null) => boolean = element => element === document.body) {
  const drop = vi.fn(), preview = vi.fn(), clear = vi.fn(), follow = vi.fn()
  const begin = vi.fn((origin: { path: string }) => ({
    hit: ({ element }: NoteRowPoint) => accepts(element) ? { preview, drop: () => drop(origin.path) } : null,
    follow,
    clear,
  }))
  disposers.push(registerNoteRowDropTarget(begin))
  return { drop, preview, clear, follow, begin }
}
function press(buttons = 1) { fireEvent.pointerDown(screen.getByTestId('row'), { ...point, buttons }) }
function move(buttons = 1, clientX = 100) { fireEvent.pointerMove(window, { ...point, clientX, buttons }) }
function release() { fireEvent.pointerUp(window, { ...point, clientX: 100, buttons: 0 }) }
const dragging = () => document.documentElement.hasAttribute('data-note-row-dragging')

afterEach(() => {
  fireEvent.blur(window)
  for (const dispose of disposers.splice(0)) dispose()
  vi.restoreAllMocks()
})

describe('internal note row gesture', () => {
  it('waits for threshold, captures on the stable root, and drops once using the original path after row recycling', () => {
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(document.body)
    const capture = vi.fn()
    Object.defineProperty(document.documentElement, 'setPointerCapture', { configurable: true, value: capture })
    const first = target(), second = target(() => false)
    const view = render(<Row />)
    press()
    expect(first.begin).toHaveBeenCalledExactlyOnceWith({ path: '/vault/alpha.md' })
    expect(capture).not.toHaveBeenCalled()
    move(1, 12)
    expect(first.preview).not.toHaveBeenCalled()
    expect(dragging()).toBe(false)
    move()
    expect(capture).toHaveBeenCalledWith(7)
    expect(dragging()).toBe(true)
    expect(first.preview).toHaveBeenCalledTimes(1)
    // Every destination follows the pointer; only the one not under it clears.
    expect(second.follow).toHaveBeenLastCalledWith(expect.objectContaining({ x: 100, y: 10, element: document.body }))
    expect(second.clear).toHaveBeenCalled()
    expect(first.clear).not.toHaveBeenCalled()
    view.rerender(<Row path="/vault/recycled.md" />)
    view.unmount()
    release(); release()
    expect(first.drop).toHaveBeenCalledExactlyOnceWith('/vault/alpha.md')
    expect(second.drop).not.toHaveBeenCalled()
    expect(first.follow).toHaveBeenLastCalledWith(null)
    expect(first.clear).toHaveBeenCalled()
    expect(dragging()).toBe(false)
  })

  it('ends the session and clears every preview before the drop runs', () => {
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(document.body)
    const order: string[] = []
    const late = vi.fn()
    disposers.push(registerNoteRowDropTarget(() => ({
      hit: () => ({ preview: () => {}, drop: () => {
        order.push(document.documentElement.hasAttribute('data-note-row-dragging') ? 'drop while dragging' : 'drop')
        // A destination reacting to its own drop cannot cancel or re-enter a finished gesture.
        cancelNoteRowDrag()
        fireEvent.pointerUp(window, { ...point, clientX: 100 })
      } }),
      clear: () => order.push('clear'),
    })))
    disposers.push(registerNoteRowDropTarget(() => ({ hit: () => null, clear: () => {}, follow: late })))
    render(<Row />)
    press(); move()
    order.length = 0
    release()
    expect(order).toEqual(['clear', 'drop'])
    expect(late).toHaveBeenLastCalledWith(null)
  })

  it('uses release coordinates, not the last preview, and never admits a target registered after press', () => {
    const hit = vi.spyOn(document, 'elementFromPoint').mockReturnValue(document.body)
    const original = target()
    render(<Row />)
    press(); move()
    expect(original.preview).toHaveBeenCalled()
    hit.mockReturnValue(null)
    release()
    expect(original.drop).not.toHaveBeenCalled()
    disposers.splice(0).forEach(dispose => dispose())
    const early = target(() => false)
    press()
    const late = target()
    hit.mockReturnValue(document.body)
    move(); release()
    expect(late.begin).not.toHaveBeenCalled()
    expect(late.drop).not.toHaveBeenCalled()
    expect(early.begin).toHaveBeenCalledTimes(1)
  })

  it.each(['Escape', 'blur', 'lostcapture', 'newpress', 'pointercancel', 'missedrelease', 'invalidate', 'unregister'])(
    'cancels on %s without allowing a later stale release', reason => {
      vi.spyOn(document, 'elementFromPoint').mockReturnValue(document.body)
      const destination = target()
      const other = target(() => false)
      render(<Row />)
      press(); move()
      expect(destination.preview).toHaveBeenCalled()
      if (reason === 'Escape') fireEvent.keyDown(window, { key: 'Escape' })
      if (reason === 'blur') fireEvent.blur(window)
      if (reason === 'lostcapture') fireEvent.lostPointerCapture(document.documentElement, { pointerId: 7 })
      if (reason === 'newpress') fireEvent.pointerDown(document.body, { ...point })
      if (reason === 'pointercancel') fireEvent.pointerCancel(window, { pointerId: 7 })
      if (reason === 'missedrelease') move(0)
      if (reason === 'invalidate') cancelNoteRowDrag()
      // The pane hook unmounting (startup, onboarding) revokes the sidebar destination too.
      if (reason === 'unregister') disposers.shift()?.()
      expect(destination.clear).toHaveBeenCalled()
      expect(destination.follow).toHaveBeenLastCalledWith(null)
      expect(dragging()).toBe(false)
      const previews = destination.preview.mock.calls.length
      move(); release()
      expect(destination.drop).not.toHaveBeenCalled()
      expect(other.drop).not.toHaveBeenCalled()
      expect(destination.preview).toHaveBeenCalledTimes(previews)
    },
  )

  it('invalidates even a press before threshold and cannot revive it after a context return', () => {
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(document.body)
    const destination = target()
    render(<Row />)
    press(); cancelNoteRowDrag(); move(); release()
    expect(destination.preview).not.toHaveBeenCalled()
    expect(destination.drop).not.toHaveBeenCalled()
    // Unregister and register again, like a vault switch away and back.
    disposers.splice(0).forEach(dispose => dispose())
    press()
    const returned = target()
    move(); release()
    expect(returned.drop).not.toHaveBeenCalled()
  })

  it('allows zero-button input only when the original press also reported zero', () => {
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(document.body)
    const destination = target()
    render(<Row />)
    press(0); move(0); release()
    expect(destination.drop).toHaveBeenCalledTimes(1)
    press(); move(0); release()
    expect(destination.drop).toHaveBeenCalledTimes(1)
  })

  it('swallows only the release click after a drag, including after Escape, and never a later click', () => {
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(document.body)
    target()
    render(<Row />)
    const click = vi.fn()
    document.body.addEventListener('click', click)
    try {
      press(); move(); release()
      fireEvent.click(document.body, { detail: 1, clientX: 100, clientY: 10 })
      expect(click).not.toHaveBeenCalled()
      fireEvent.click(document.body, { detail: 1, clientX: 100, clientY: 10 })
      fireEvent.click(document.body, { detail: 0 })
      expect(click).toHaveBeenCalledTimes(2)
      press(); move(); release()
      fireEvent.pointerDown(document.body, { ...point })
      fireEvent.click(document.body, { detail: 1, clientX: 100, clientY: 10 })
      expect(click).toHaveBeenCalledTimes(3)
      press(); move()
      const escape = fireEvent.keyDown(window, { key: 'Escape' })
      expect(escape).toBe(false)
      // After cancel, another Escape belongs to the app again.
      expect(fireEvent.keyDown(window, { key: 'Escape' })).toBe(true)
      release()
      fireEvent.click(document.body, { detail: 1, clientX: 100, clientY: 10 })
      expect(click).toHaveBeenCalledTimes(3)
      // A short press is an ordinary click.
      press(); release()
      fireEvent.click(document.body, { detail: 1, clientX: 100, clientY: 10 })
      expect(click).toHaveBeenCalledTimes(4)
    } finally { document.body.removeEventListener('click', click) }
  })

  it('leaves Escape alone before the threshold', () => {
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(document.body)
    const destination = target()
    render(<Row />)
    press()
    expect(fireEvent.keyDown(window, { key: 'Escape' })).toBe(true)
    move(); release()
    expect(destination.drop).not.toHaveBeenCalled()
  })

  it('preserves modifiers, secondary clicks, row controls and touch scrolling as non-drag interactions', () => {
    const destination = target()
    render(<Row />)
    for (const extra of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 2 }, { isPrimary: false }, { pointerType: 'touch' }]) {
      fireEvent.pointerDown(screen.getByTestId('row'), { ...point, ...extra })
      move(); release()
    }
    fireEvent.pointerDown(screen.getByTestId('chip'), { ...point })
    move(); release()
    expect(destination.begin).not.toHaveBeenCalled()
  })

  it('starts nothing when no destination participates', () => {
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(document.body)
    disposers.push(registerNoteRowDropTarget(() => null))
    render(<Row />)
    press(); move()
    expect(dragging()).toBe(false)
    release()
  })
})
