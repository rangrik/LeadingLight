import { useEffect, useEffectEvent } from 'react'
import { registerNoteRowDropTarget } from '../leadinglight/noteRowDrag'

const NOTE_DROP_TARGET_SELECTOR = '[data-note-drop-type], [data-note-drop-folder]'
const NOTE_DROP_STATE_ATTRIBUTE = 'data-note-drop-state'

type NoteDropMutation = (notePath: string, destination: string) => Promise<unknown> | unknown

interface SidebarNoteDropTargetsInput {
  canDropNoteOnType: (notePath: string, type: string) => boolean
  canDropNoteOnFolder: (notePath: string, folderPath: string) => boolean
  changeNoteType: NoteDropMutation
  moveNoteToFolder: NoteDropMutation
}

type NoteDropDestination = {
  element: HTMLElement
  kind: 'type' | 'folder'
  value: string
}

function destinationForElement(element: Element | null): NoteDropDestination | null {
  const target = element?.closest<HTMLElement>(NOTE_DROP_TARGET_SELECTOR)
  if (!target) return null
  const type = target.dataset.noteDropType
  if (type !== undefined) return { element: target, kind: 'type', value: type }
  const folder = target.dataset.noteDropFolder
  if (folder !== undefined) return { element: target, kind: 'folder', value: folder }
  return null
}

function canAcceptDestination(
  options: SidebarNoteDropTargetsInput,
  notePath: string,
  destination: NoteDropDestination,
): boolean {
  return destination.kind === 'type'
    ? options.canDropNoteOnType(notePath, destination.value)
    : options.canDropNoteOnFolder(notePath, destination.value)
}

function runDestinationMutation(
  options: SidebarNoteDropTargetsInput,
  notePath: string,
  destination: NoteDropDestination,
): void {
  const mutation = destination.kind === 'type' ? options.changeNoteType : options.moveNoteToFolder
  try {
    void Promise.resolve(mutation(notePath, destination.value)).catch(() => {})
  } catch { /* The mutation reports its own failure. */ }
}

/**
 * Sidebar Types and Folders as destinations of the internal note-row gesture.
 * The closest target under the release point is checked against current eligibility.
 */
export function useSidebarNoteDropTargets(options: SidebarNoteDropTargetsInput): void {
  const canAccept = useEffectEvent((notePath: string, destination: NoteDropDestination) =>
    canAcceptDestination(options, notePath, destination),
  )
  const runMutation = useEffectEvent((notePath: string, destination: NoteDropDestination) =>
    runDestinationMutation(options, notePath, destination),
  )

  useEffect(() => registerNoteRowDropTarget(({ path }) => {
    let activeTarget: HTMLElement | null = null
    const setActiveTarget = (nextTarget: HTMLElement | null) => {
      if (activeTarget === nextTarget) return
      activeTarget?.removeAttribute(NOTE_DROP_STATE_ATTRIBUTE)
      activeTarget = nextTarget
      activeTarget?.setAttribute(NOTE_DROP_STATE_ATTRIBUTE, 'valid')
    }
    return {
      clear: () => setActiveTarget(null),
      hit: point => {
        const destination = destinationForElement(point.element)
        if (!destination || !canAccept(path, destination)) return null
        return {
          preview: () => setActiveTarget(destination.element),
          drop: () => runMutation(path, destination),
        }
      },
    }
  }), [])
}
