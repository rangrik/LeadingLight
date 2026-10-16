import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushEditorContent, UnsavedTabTextError, type FlushDeps } from './autoSave'
import type { ContentReceipt, ReceiptStatus } from '../hooks/useEditorSave'

// Seam: the fallback writer. Unsaved tab text must go through the queue and be called saved only by its own receipt.
const receipt: ContentReceipt = Object.freeze({ path: '/vault/note.md', content: 'edited body', session: 0, seq: 3 })

function makeDeps(status: ReceiptStatus = 'settled'): FlushDeps {
  return {
    savePendingForPath: vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true),
    getTabContent: vi.fn().mockReturnValue('edited body'),
    isUnsaved: vi.fn().mockReturnValue(true),
    admitContent: vi.fn().mockReturnValue(receipt),
    receiptStatus: vi.fn().mockReturnValue(status),
    onSaved: vi.fn(),
  }
}

describe('flushEditorContent', () => {
  let deps: FlushDeps

  beforeEach(() => { deps = makeDeps() })

  it('stops after the pending flush when the queue already had the page', async () => {
    deps.savePendingForPath = vi.fn().mockResolvedValue(true)
    await flushEditorContent('/vault/note.md', deps)
    expect(deps.getTabContent).not.toHaveBeenCalled()
    expect(deps.admitContent).not.toHaveBeenCalled()
  })

  it('queues unsaved tab text and reports it saved once its own receipt settled', async () => {
    await flushEditorContent('/vault/note.md', deps)
    expect(deps.admitContent).toHaveBeenCalledWith('/vault/note.md', 'edited body')
    expect(deps.savePendingForPath).toHaveBeenCalledTimes(2)
    expect(deps.receiptStatus).toHaveBeenCalledWith(receipt)
    expect(deps.onSaved).toHaveBeenCalledWith('/vault/note.md', 'edited body')
  })

  it('writes nothing and says so when the queue refuses the text', async () => {
    deps.admitContent = vi.fn().mockReturnValue(null)
    await expect(flushEditorContent('/vault/note.md', deps)).rejects.toBeInstanceOf(UnsavedTabTextError)
    expect(deps.savePendingForPath).toHaveBeenCalledTimes(1)
    expect(deps.onSaved).not.toHaveBeenCalled()
  })

  it('never reports a save its receipt cannot prove', async () => {
    deps = makeDeps('unproven')
    await expect(flushEditorContent('/vault/note.md', deps)).rejects.toBeInstanceOf(UnsavedTabTextError)
    expect(deps.onSaved).not.toHaveBeenCalled()
  })

  it('leaves newer queued text to the queue without calling it saved', async () => {
    deps = makeDeps('pending')
    await flushEditorContent('/vault/note.md', deps)
    expect(deps.onSaved).not.toHaveBeenCalled()
  })

  it('does nothing for a clean or closed page', async () => {
    deps.isUnsaved = vi.fn().mockReturnValue(false)
    await flushEditorContent('/vault/note.md', deps)
    deps.getTabContent = vi.fn().mockReturnValue(undefined)
    await flushEditorContent('/vault/note.md', deps)
    expect(deps.admitContent).not.toHaveBeenCalled()
  })

  it('propagates a refused queue save', async () => {
    deps.savePendingForPath = vi.fn().mockResolvedValueOnce(false).mockRejectedValue(new Error('The file is read-only.'))
    await expect(flushEditorContent('/vault/note.md', deps)).rejects.toThrow('The file is read-only.')
    expect(deps.onSaved).not.toHaveBeenCalled()
  })
})
