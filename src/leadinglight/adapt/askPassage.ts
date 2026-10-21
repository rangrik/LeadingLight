import { rawSelectedText } from '../commentary/rawPassageAdapter'
import type { EditorPassageRead } from '../commentary/commentaryContext'
import type { PassageSnapshot } from './adaptPage'

/**
 * The selection a pane's editor held at the person's click (E2's synchronous capture), as Ask
 * attaches it: the visible text of a rich selection, the exact Markdown of a raw one. Nothing is
 * saved or read for this; `titleOf` names the open page, or null when it is not one Ask can take.
 */
export function passageFrom(read: EditorPassageRead, titleOf: (path: string) => string | null): PassageSnapshot {
  if (read.status === 'empty') return 'noSelection'
  if (read.status !== 'ok') return 'noPage'
  const { passage } = read
  const title = titleOf(passage.path)
  if (title === null) return 'noPage'
  const text = passage.selection.mode === 'rich' ? passage.selection.text : rawSelectedText(passage.markdown, passage.selection)
  return text.trim() === '' ? 'noSelection' : { title, text, key: passage.path }
}
