import type { ContentReceipt, ReceiptStatus } from '../hooks/useEditorSave'

export interface FlushDeps {
  savePendingForPath: (path: string) => Promise<boolean>
  getTabContent: (path: string) => string | undefined
  isUnsaved: (path: string) => boolean
  /** The save queue's admission; null when the page can't take text now. */
  admitContent: (path: string, content: string) => ContentReceipt | null
  receiptStatus: (receipt: ContentReceipt) => ReceiptStatus
  onSaved?: (path: string, content: string) => void
}

/** Unsaved tab text the queue could not take, or could not prove written; nothing was written by this flush. */
export class UnsavedTabTextError extends Error {
  readonly path: string

  constructor(path: string) {
    super("The page's unsaved text couldn't be saved yet.")
    this.name = 'UnsavedTabTextError'
    this.path = path
  }
}

/**
 * Flush unsaved editor content for a path before a destructive action.
 *
 * 1. Save the page's pending text (the currently edited note).
 * 2. If nothing was pending but the tab has unsaved text, send it through the same queue and
 *    report it saved only when this exact admission settled.
 */
export async function flushEditorContent(path: string, deps: FlushDeps): Promise<void> {
  const flushed = await deps.savePendingForPath(path)
  if (flushed) return

  const tabContent = deps.getTabContent(path)
  if (tabContent === undefined || !deps.isUnsaved(path)) return

  const receipt = deps.admitContent(path, tabContent)
  if (!receipt) throw new UnsavedTabTextError(path)
  await deps.savePendingForPath(path)
  const status = deps.receiptStatus(receipt)
  // Newer text took its place in the queue; that text is still the queue's to save.
  if (status === 'pending') return
  if (status !== 'settled') throw new UnsavedTabTextError(path)
  deps.onSaved?.(path, tabContent)
}
