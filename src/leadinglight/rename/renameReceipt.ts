import { notePathsMatch } from '../../utils/notePathIdentity'
import { parseRelocationReceipt, type RelocationReceipt } from '../relocation/relocationContract'

/** Filename, title, automatic and folder renames share the folder move's receipt shape. */
export type RenameReceipt = RelocationReceipt

/** A title rename may take a numbered sibling; a filename rename names its exact path. */
export type RenameDestination = { exact: string } | { siblingOf: string }

const parentOf = (path: string) => path.replace(/\\/g, '/').replace(/\/[^/]*$/, '')

function destinationAllowed(newPath: string, destination: RenameDestination): boolean {
  if ('exact' in destination) return notePathsMatch(newPath, destination.exact)
  return notePathsMatch(parentOf(newPath), parentOf(destination.siblingOf)) && /\.md$/i.test(newPath)
}

/** A malformed reply may follow a committed rename; null never means it is safe to replay. */
export function parseRenameReceipt(value: unknown, request: {
  sourcePath: string
  openPaths: readonly string[]
  destination: RenameDestination
}): RenameReceipt | null {
  if (typeof value !== 'object' || value === null) return null
  const newPath = (value as { new_path?: unknown }).new_path
  if (typeof newPath !== 'string' || !destinationAllowed(newPath, request.destination)) return null
  return parseRelocationReceipt(value, { sourcePath: request.sourcePath, destinationPath: newPath, openPaths: request.openPaths })
}

/** The receipt's committed text for one open page, or null when it did not change it. */
export function receiptPage(receipt: RenameReceipt, path: string) {
  return receipt.updated_open_pages.find(page => notePathsMatch(page.path, path)) ?? null
}
