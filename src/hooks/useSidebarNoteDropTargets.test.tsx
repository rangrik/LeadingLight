import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startNoteRowDrag } from '../leadinglight/noteRowDrag'
import { useSidebarNoteDropTargets } from './useSidebarNoteDropTargets'

const NOTE_PATH = '/vault/notes/alpha.md'

// jsdom has no layout: each step names the element under the pointer.
let under: Element | null = null
beforeEach(() => {
  under = null
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => under })
})
afterEach(() => { fireEvent.blur(window) })

function DropTargets(options: {
  canDropType?: (notePath: string, type: string) => boolean
  canDropFolder?: boolean
  changeNoteType: (notePath: string, type: string) => Promise<unknown>
  moveNoteToFolder: (notePath: string, folderPath: string) => Promise<unknown>
}) {
  useSidebarNoteDropTargets({
    canDropNoteOnType: options.canDropType ?? (() => true),
    canDropNoteOnFolder: () => options.canDropFolder ?? true,
    changeNoteType: options.changeNoteType,
    moveNoteToFolder: options.moveNoteToFolder,
  })

  return (
    <>
      <div data-testid="row" onPointerDown={event => startNoteRowDrag(event, { path: NOTE_PATH })} />
      <div data-note-drop-type="Project" data-testid="type-target">
        <span data-testid="type-child">Project</span>
        <div data-note-drop-folder="archive" data-testid="folder-target">
          <span data-testid="folder-child">Archive</span>
        </div>
      </div>
      <div data-note-drop-folder="" data-testid="root-target" />
    </>
  )
}

const pointer = { pointerId: 3, button: 0, isPrimary: true }
function press() { fireEvent.pointerDown(screen.getByTestId('row'), { ...pointer, buttons: 1, clientX: 0, clientY: 0 }) }
function moveOver(testId: string | null, clientX = 40) {
  under = testId ? screen.getByTestId(testId) : null
  fireEvent.pointerMove(window, { ...pointer, buttons: 1, clientX, clientY: 0 })
}
function releaseOver(testId: string | null) {
  under = testId ? screen.getByTestId(testId) : null
  fireEvent.pointerUp(window, { ...pointer, buttons: 0, clientX: 40, clientY: 0 })
}

describe('useSidebarNoteDropTargets', () => {
  it('highlights one valid target without flicker across its child content', () => {
    const changeNoteType = vi.fn()
    const view = render(<DropTargets changeNoteType={changeNoteType} moveNoteToFolder={vi.fn()} />)
    const target = screen.getByTestId('type-target')
    const setAttribute = vi.spyOn(target, 'setAttribute')
    const removeAttribute = vi.spyOn(target, 'removeAttribute')

    press()
    moveOver('type-child')
    view.rerender(<DropTargets changeNoteType={changeNoteType} moveNoteToFolder={vi.fn()} />)
    moveOver('type-target', 41)
    moveOver('type-child', 42)

    expect(target).toHaveAttribute('data-note-drop-state', 'valid')
    expect(setAttribute).toHaveBeenCalledTimes(1)
    expect(removeAttribute).not.toHaveBeenCalled()
    expect(changeNoteType).not.toHaveBeenCalled()
  })

  it('runs only the closest destination mutation once, at the release point, and clears hover state', () => {
    const changeNoteType = vi.fn().mockResolvedValue('updated')
    const moveNoteToFolder = vi.fn().mockResolvedValue('updated')
    render(<DropTargets changeNoteType={changeNoteType} moveNoteToFolder={moveNoteToFolder} />)
    const typeTarget = screen.getByTestId('type-target')
    const folderTarget = screen.getByTestId('folder-target')

    press()
    moveOver('type-child')
    expect(typeTarget).toHaveAttribute('data-note-drop-state', 'valid')
    moveOver('folder-child', 41)
    expect(typeTarget).not.toHaveAttribute('data-note-drop-state')
    expect(folderTarget).toHaveAttribute('data-note-drop-state', 'valid')
    releaseOver('folder-child')
    releaseOver('folder-child')

    expect(moveNoteToFolder).toHaveBeenCalledExactlyOnceWith(NOTE_PATH, 'archive')
    expect(changeNoteType).not.toHaveBeenCalled()
    expect(typeTarget).not.toHaveAttribute('data-note-drop-state')
    expect(folderTarget).not.toHaveAttribute('data-note-drop-state')
  })

  it('accepts the vault root folder', () => {
    const moveNoteToFolder = vi.fn().mockResolvedValue('updated')
    render(<DropTargets changeNoteType={vi.fn()} moveNoteToFolder={moveNoteToFolder} />)
    press()
    moveOver('root-target')
    releaseOver('root-target')
    expect(moveNoteToFolder).toHaveBeenCalledExactlyOnceWith(NOTE_PATH, '')
  })

  it('does not highlight or mutate invalid and no-op destinations', () => {
    const changeNoteType = vi.fn()
    render(<DropTargets canDropType={() => false} changeNoteType={changeNoteType} moveNoteToFolder={vi.fn()} />)
    const target = screen.getByTestId('type-target')

    press()
    moveOver('type-child')
    expect(target).not.toHaveAttribute('data-note-drop-state')
    releaseOver('type-child')

    expect(changeNoteType).not.toHaveBeenCalled()
  })

  it('checks current eligibility at release, so an earlier valid preview cannot authorize the drop', () => {
    let eligible = true
    const changeNoteType = vi.fn()
    render(<DropTargets canDropType={() => eligible} changeNoteType={changeNoteType} moveNoteToFolder={vi.fn()} />)
    press()
    moveOver('type-child')
    expect(screen.getByTestId('type-target')).toHaveAttribute('data-note-drop-state', 'valid')
    eligible = false
    releaseOver('type-child')
    expect(changeNoteType).not.toHaveBeenCalled()
  })

  it('commits nothing from an earlier preview when released elsewhere', () => {
    const changeNoteType = vi.fn()
    render(<DropTargets changeNoteType={changeNoteType} moveNoteToFolder={vi.fn()} />)
    press()
    moveOver('type-child')
    releaseOver(null)
    expect(changeNoteType).not.toHaveBeenCalled()
    expect(screen.getByTestId('type-target')).not.toHaveAttribute('data-note-drop-state')
  })

  it('clears the active highlight when the drag is cancelled, and ignores the stale release', () => {
    const changeNoteType = vi.fn()
    render(<DropTargets changeNoteType={changeNoteType} moveNoteToFolder={vi.fn()} />)
    const target = screen.getByTestId('type-target')

    press()
    moveOver('type-target')
    expect(target).toHaveAttribute('data-note-drop-state', 'valid')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(target).not.toHaveAttribute('data-note-drop-state')
    moveOver('type-target')
    releaseOver('type-target')
    expect(target).not.toHaveAttribute('data-note-drop-state')
    expect(changeNoteType).not.toHaveBeenCalled()
  })

  it('keeps a failed mutation from escaping the gesture', () => {
    const changeNoteType = vi.fn(() => { throw new Error('synthetic failure') })
    render(<DropTargets changeNoteType={changeNoteType} moveNoteToFolder={vi.fn()} />)
    press()
    moveOver('type-target')
    expect(() => releaseOver('type-target')).not.toThrow()
    expect(changeNoteType).toHaveBeenCalledTimes(1)
  })
})
