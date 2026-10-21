import { notePathsMatch } from '../../utils/notePathIdentity'

// Which conversation last asked about a page, so opening Ask about that page again returns to it.
// Paths and conversation ids only, per vault, in this window's local storage: page text never goes
// here, and nothing here is ever sent.

export interface AskResumeEntry {
  path: string
  conversationId: string
}

export const ASK_RESUME_LIMIT = 50
const storageKey = (vaultPath: string) => `leadinglight.askResume:${vaultPath}`

function isEntry(value: unknown): value is AskResumeEntry {
  const entry = value as AskResumeEntry | null
  return typeof entry?.path === 'string' && entry.path.length > 0 && typeof entry.conversationId === 'string' && entry.conversationId.length > 0
}

export function readAskResume(vaultPath: string): AskResumeEntry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey(vaultPath)) ?? '[]')
    return Array.isArray(value) ? value.filter(isEntry).slice(0, ASK_RESUME_LIMIT) : []
  } catch {
    return []
  }
}

function writeAskResume(vaultPath: string, entries: AskResumeEntry[]) {
  try {
    localStorage.setItem(storageKey(vaultPath), JSON.stringify(entries))
  } catch { /* Restricted storage remembers nothing; Ask still opens fresh. */ }
}

/** The conversation that last asked about this page, if this window remembers one. */
export const askedAbout = (vaultPath: string, path: string): string | null =>
  readAskResume(vaultPath).find(entry => notePathsMatch(entry.path, path))?.conversationId ?? null

/** A Send about these pages was admitted in this conversation: each now resumes there. */
export function rememberAskedAbout(vaultPath: string, paths: readonly string[], conversationId: string) {
  if (paths.length === 0) return
  const kept = readAskResume(vaultPath).filter(entry => !paths.some(path => notePathsMatch(entry.path, path)))
  writeAskResume(vaultPath, [...paths.map(path => ({ path, conversationId })), ...kept].slice(0, ASK_RESUME_LIMIT))
}
