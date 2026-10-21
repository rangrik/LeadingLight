// The listing entry for a page a website run created, from the exact bytes it wrote. Its frontmatter
// is read the way the editor reads a saved page's, so the page's `source` is listed at once and the
// next "saved before" finds it without a reload. Nothing is read from disk and nothing is written.
import { deriveRawEditorEntryState } from '../../hooks/rawEditorEntryState'
import { buildNewEntry } from '../../hooks/useNoteCreation'
import type { VaultEntry } from '../../types'
import { detectFrontmatterState } from '../../utils/frontmatter'
import { notePathFilename } from '../../utils/notePathIdentity'
import { deriveDisplayTitleState } from '../../utils/noteTitle'
import type { CreatedPage } from '../extensions/extensionSessionController'

/** A listing entry for the exact bytes written, as the app's other creators add one. */
export function webCaptureEntry(page: CreatedPage): VaultEntry {
  const filename = notePathFilename(page.path)
  // Only a well-formed frontmatter block, as the editor's own sync; the display title comes last.
  const metadata = detectFrontmatterState(page.content) === 'valid' ? deriveRawEditorEntryState(page.content) : {}
  return { ...buildNewEntry({ path: page.path, slug: filename.replace(/\.md$/i, ''), title: page.title, type: 'Note', status: null }),
    isA: null, ...metadata, ...deriveDisplayTitleState({ content: page.content, filename }) }
}
