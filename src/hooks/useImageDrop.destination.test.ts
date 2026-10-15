import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { useImageDrop } from './useImageDrop'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => `asset://localhost${path}` }))
vi.mock('../mock-tauri', () => ({ isTauri: () => true }))
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }) }))

type Target = { vaultPath: string; documentPath: string }
let copy: { finish: (savedPath: string) => void; fail: (error: Error) => void }

function setup(documentSessionRef?: { current: number }) {
  const container = document.createElement('div')
  document.body.append(container)
  const onImageUrl = vi.fn()
  const onImageImportError = vi.fn()
  const hook = renderHook((target: Target) => useImageDrop({
    containerRef: { current: container }, documentSessionRef, onImageUrl, onImageImportError, ...target,
  }), { initialProps: { vaultPath: '/vault', documentPath: '/vault/untitled-note-1.md' } })
  return { container, onImageUrl, onImageImportError, ...hook }
}
type Hook = ReturnType<typeof setup>

async function dropWhile(hook: Hook, interrupt: () => void, outcome: 'finish' | 'fail' = 'finish') {
  const file = Object.assign(new File(['png'], 'photo.png', { type: 'image/png' }), { arrayBuffer: async () => new ArrayBuffer(3) })
  const drop = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(drop, 'dataTransfer', { value: { files: [file] } })
  hook.container.dispatchEvent(drop)
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce())
  interrupt()
  await act(async () => {
    if (outcome === 'finish') copy.finish('/vault/attachments/photo.png')
    else copy.fail(new Error('disk full'))
  })
}

beforeEach(() => {
  document.body.replaceChildren()
  vi.mocked(invoke).mockReset()
  vi.mocked(invoke).mockImplementation(() => new Promise((finish, fail) => { copy = { finish, fail } }))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('dropped image destination', () => {
  it('inserts a local attachment into the page it was dropped on', async () => {
    const hook = setup()
    const other = setup()
    await dropWhile(hook, () => {})
    expect(invoke).toHaveBeenCalledWith('save_image', expect.objectContaining({ vaultPath: '/vault', filename: 'photo.png' }))
    expect(hook.onImageUrl).toHaveBeenCalledExactlyOnceWith('asset://localhost/vault/attachments/photo.png')
    expect(other.onImageUrl).not.toHaveBeenCalled()
  })

  it('reports a failed copy for the page it was dropped on', async () => {
    const hook = setup()
    await dropWhile(hook, () => {}, 'fail')
    expect(hook.onImageUrl).not.toHaveBeenCalled()
    expect(hook.onImageImportError).toHaveBeenCalledExactlyOnceWith({ kind: 'copy-failed', fileName: 'photo.png' })
  })

  const interruptions: [string, (hook: Hook) => void][] = [
    ['the note changes', hook => hook.rerender({ vaultPath: '/vault', documentPath: '/vault/b.md' })],
    ['the note changes and comes back', hook => {
      hook.rerender({ vaultPath: '/vault', documentPath: '/vault/b.md' })
      hook.rerender({ vaultPath: '/vault', documentPath: '/vault/untitled-note-1.md' })
    }],
    ['the vault changes', hook => hook.rerender({ vaultPath: '/other', documentPath: '/vault/untitled-note-1.md' })],
    ['the editor unmounts', hook => hook.unmount()],
  ]
  it.each(interruptions.flatMap(([name, interrupt]) => (['finish', 'fail'] as const).map(outcome => [name, outcome, interrupt] as const)))(
    'neither inserts nor reports after %s (copy %s)', async (_name, outcome, interrupt) => {
      const hook = setup()
      await dropWhile(hook, () => interrupt(hook), outcome)
      expect(hook.onImageUrl).not.toHaveBeenCalled()
      expect(hook.onImageImportError).not.toHaveBeenCalled()
    })

  // The editor's document session survives an untitled rename and changes when the document is replaced.
  it.each([
    ['the same document is renamed', true, (hook: Hook) => hook.rerender({ vaultPath: '/vault', documentPath: '/vault/trip.md' })],
    ['the document is replaced and comes back', false, (_hook: Hook, session: { current: number }) => { session.current += 2 }],
    ['the vault changes', false, (hook: Hook) => hook.rerender({ vaultPath: '/other', documentPath: '/vault/untitled-note-1.md' })],
  ])('with a document session, inserts after %s: %s', async (_name, inserted, interrupt) => {
    const session = { current: 0 }
    const hook = setup(session)
    await dropWhile(hook, () => interrupt(hook, session))
    expect(hook.onImageUrl).toHaveBeenCalledTimes(inserted ? 1 : 0)
  })
})
