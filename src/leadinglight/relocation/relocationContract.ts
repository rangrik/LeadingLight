import { normalizeNotePathForIdentity, notePathsMatch } from '../../utils/notePathIdentity'

export interface RelocatedOpenPage { path: string; before_content: string; content: string }
export interface RelocationReceipt {
  new_path: string
  updated_files: number
  failed_updates: number
  source_before_content: string
  source_content: string
  updated_open_pages: RelocatedOpenPage[]
  unrefreshed_open_paths: string[]
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const text = (value: unknown): value is string => typeof value === 'string'
const identity = normalizeNotePathForIdentity

/** A malformed reply may follow a committed move; null never means it is safe to replay. */
export function parseRelocationReceipt(value: unknown, request: {
  sourcePath: string; destinationPath: string; openPaths: readonly string[]
}): RelocationReceipt | null {
  if (!record(value) || !text(value.new_path) || !notePathsMatch(value.new_path, request.destinationPath)
    || !count(value.updated_files) || !count(value.failed_updates)
    || !text(value.source_before_content) || !text(value.source_content)
    || !Array.isArray(value.updated_open_pages) || !Array.isArray(value.unrefreshed_open_paths)) return null
  const allowed = new Set(request.openPaths.map(identity))
  allowed.delete(identity(request.sourcePath))
  const seen = new Set<string>()
  const claim = (path: string) => {
    const key = identity(path)
    if (!allowed.has(key) || seen.has(key)) return false
    seen.add(key)
    return true
  }
  const updated: RelocatedOpenPage[] = []
  for (const page of value.updated_open_pages) {
    if (!record(page) || !text(page.path) || !text(page.before_content) || !text(page.content) || !claim(page.path)) return null
    updated.push({ path: page.path, before_content: page.before_content, content: page.content })
  }
  const unrefreshed: string[] = []
  for (const path of value.unrefreshed_open_paths) {
    if (!text(path) || !claim(path)) return null
    unrefreshed.push(path)
  }
  return {
    new_path: value.new_path, updated_files: value.updated_files, failed_updates: value.failed_updates,
    source_before_content: value.source_before_content, source_content: value.source_content,
    updated_open_pages: updated, unrefreshed_open_paths: unrefreshed,
  }
}

/** A saved baseline is reopened only when the receipt proves which bytes it replaced. */
export function relocatedPageContent(receipt: RelocationReceipt, path: string, before: string, sourcePath: string): string | null {
  if (notePathsMatch(path, sourcePath)) return receipt.source_before_content === before ? receipt.source_content : null
  if (receipt.unrefreshed_open_paths.some(item => notePathsMatch(item, path))) return null
  const updated = receipt.updated_open_pages.find(item => notePathsMatch(item.path, path))
  return updated ? (updated.before_content === before ? updated.content : null) : before
}
