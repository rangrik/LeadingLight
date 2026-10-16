import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { SetStateAction } from 'react'
import { AUTO_SAVE_DEBOUNCE_MS, UnmergedDraftError, useEditorSave, type DocumentMutation } from './useEditorSave'
import { favoriteMutation, patchFavoriteKeys, type FavoriteResult, type FavoriteState, type NativeFavoriteResult } from '../leadinglight/favoriteTransaction'
import type { VaultEntry } from '../types'

const native = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  saves: [] as string[],
  calls: 0,
  failSave: false,
  uncertain: false,
  release: null as null | (() => void),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
  updateMockContent: vi.fn(),
  // A stand-in for the native transaction: it reads disk when called and publishes when released.
  mockInvoke: (cmd: string, args: { path: string; request?: { path: string }; content?: string; favorite?: boolean; favoriteIndex?: number | null }) => {
    if (cmd === 'save_page_content') {
      if (native.failSave) return Promise.resolve({ status: 'refused', reason: 'stageFailed' })
      native.disk.set(args.request?.path ?? '', args.content ?? '')
      native.saves.push(args.content ?? '')
      return Promise.resolve({ status: 'committed', written: true, durable: true, history: null })
    }
    if (cmd === 'get_note_content') return new Promise(resolve => { native.release = () => resolve(native.disk.get(args.path)) })
    native.calls++
    const before = native.disk.get(args.path) ?? ''
    const state = (args.favorite ? { favorite: true, favoriteIndex: args.favoriteIndex } : { favorite: false, favoriteIndex: null }) as FavoriteState
    const after = patchFavoriteKeys(before, state) ?? before
    return new Promise<NativeFavoriteResult>(resolve => {
      native.release = () => {
        if (native.uncertain) return resolve({ status: 'uncertain', originalAt: null, stagedAt: null })
        native.disk.set(args.path, after)
        resolve({ status: 'committed', content: after, written: after !== before, durable: true })
      }
    })
  },
}))

const page = '/vault/plan.md'
const ON: FavoriteState = { favorite: true, favoriteIndex: 1 }
const OFF: FavoriteState = { favorite: false, favoriteIndex: null }
const KEYS = '_favorite: true\n_favorite_index: 1\n'

function setup(initial: string, persistenceScope = '/vault') {
  native.disk.set(page, initial)
  let tabs = [{ entry: { path: page } as VaultEntry, content: initial }]
  const setToastMessage = vi.fn()
  const setTabs = (update: SetStateAction<typeof tabs>) => { tabs = typeof update === 'function' ? update(tabs) : update }
  const hook = renderHook(
    ({ scope }) => useEditorSave({ updateVaultContent: vi.fn(), setTabs, setToastMessage, persistenceScope: scope }),
    { initialProps: { scope: persistenceScope } },
  )
  return { save: hook.result, rerender: hook.rerender, unmount: hook.unmount, tab: () => tabs[0].content, setToastMessage }
}
type Harness = ReturnType<typeof setup>

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const idle = () => act(async () => { await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS + 10) })
const publish = async () => { await act(async () => { native.release?.() }); await settle() }

function admit(save: Harness['save'], mutation: DocumentMutation<FavoriteResult>) {
  const admission = save.current.mutateDocument(page, mutation)
  if (!admission.admitted) throw new Error(`refused: ${admission.reason}`)
  return admission.done
}

beforeEach(() => {
  vi.useFakeTimers()
  native.disk.clear()
  native.saves = []
  native.calls = 0
  native.failSave = false
  native.uncertain = false
  native.release = null
})
afterEach(() => { vi.useRealTimers() })

describe('a Favorite change inside the page save queue', () => {
  it('keeps newer rich and raw edits and adds only the two keys, with one native call (T4)', async () => {
    const { save } = setup('---\ntitle: Plan\n---\nold body')
    let buffered: string | null = null
    const flushBuffers = (path: string) => {
      if (buffered !== null) save.current.handleContentChange(path, buffered)
      buffered = null
    }
    const done = admit(save, { ...favoriteMutation(ON), flushBuffers })
    await settle()
    act(() => {
      save.current.handleContentChange(page, '---\ntitle: Plan\n---\nnew body')
      save.current.handleContentChange(page, '---\ntitle: Plan\nstatus: done\n---\nnew body')
    })
    buffered = '---\ntitle: Plan\nstatus: done\n---\nnewest body'
    await idle()
    expect(native.saves).toEqual([])

    await publish()
    await idle()

    expect(await done).toMatchObject({ kind: 'returned', integration: 'rebased', current: true })
    expect(native.saves.at(-1)).toBe(`---\ntitle: Plan\nstatus: done\n${KEYS}---\nnewest body`)
    expect(native.calls).toBe(1)
  })

  it.each([
    ['adding', `---\ntitle: Plan\n${KEYS}---\nold body`, ON, `---\ntitle: Plan\nstatus: x\n${KEYS}---\nnew body`],
    ['removing', '---\ntitle: Plan\n---\nold body', OFF, '---\ntitle: Plan\nstatus: x\n---\nnew body'],
  ])('rebases newer text when disk is already in the state (%s, T10)', async (_case, initial, state, expected) => {
    const { save } = setup(initial)
    const done = admit(save, favoriteMutation(state))
    await settle()
    const stale = state.favorite ? '---\ntitle: Plan\nstatus: x\n---\nnew body' : `---\ntitle: Plan\nstatus: x\n${KEYS}---\nnew body`
    act(() => { save.current.handleContentChange(page, stale) })

    await publish()
    await idle()

    expect(await done).toMatchObject({ kind: 'returned', result: { written: false }, integration: 'rebased' })
    expect(native.disk.get(page)).toBe(expected)
  })

  it.each([['unclosed', '---\ntitle: Plan\nbody'], ['closed but invalid', '---\ntitle: "unfinished\n---\nbody']])(
    'refuses at admission when the latest text already has a broken block (%s)',
    async (_case, draft) => {
      const { save } = setup('---\ntitle: Plan\n---\nbody')
      act(() => { save.current.handleContentChange(page, draft) })

      expect(save.current.mutateDocument(page, favoriteMutation(ON))).toEqual({ admitted: false, reason: 'invalidFrontmatter' })
      await idle()
      expect(native.calls).toBe(0)
    },
  )

  it.each([
    ['a real write, closed but invalid', '---\ntitle: Plan\n---\nbody', '---\ntitle: [unfinished\n---\nmarker-7f3 body'],
    ['no write, unclosed', `---\ntitle: Plan\n${KEYS}---\nbody`, '---\ntitle: Plan\nmarker-7f3 body'],
  ])(
    'keeps a draft broken during publication unsaved until it is repaired (%s, T11)',
    async (_case, initial, draft) => {
      const { save, tab, setToastMessage } = setup(initial)
      const done = admit(save, favoriteMutation(ON))
      await settle()
      act(() => { save.current.handleContentChange(page, draft) })

      await publish()
      expect(await done).toMatchObject({ kind: 'returned', integration: 'unmergedDraft', latest: draft })
      const committed = `---\ntitle: Plan\n${KEYS}---\nbody`
      expect(native.disk.get(page)).toBe(committed)
      expect(tab()).toBe(draft)

      await idle()
      await expect(save.current.savePendingForPath(page)).rejects.toBeInstanceOf(UnmergedDraftError)
      await expect(save.current.savePending()).rejects.toBeInstanceOf(UnmergedDraftError)
      await expect(save.current.drainHeld(page)).rejects.toBeInstanceOf(UnmergedDraftError)
      await act(async () => { expect(await save.current.handleSave()).toBe(false) })
      expect(setToastMessage).toHaveBeenLastCalledWith("Can't save yet. Fix the page's properties first. Your edits are kept.")
      expect(save.current.mutateDocument(page, favoriteMutation(ON))).toEqual({ admitted: false, reason: 'invalidFrontmatter' })
      expect(native.disk.get(page)).toBe(committed)

      act(() => { save.current.handleContentChange(page, '---\ntitle: Plan\nstatus: x\n---\nmarker-7f3 body') })
      await idle()

      expect(native.disk.get(page)).toBe(`---\ntitle: Plan\nstatus: x\n${KEYS}---\nmarker-7f3 body`)
      await expect(save.current.savePendingForPath(page)).resolves.toBe(false)
    },
  )

  it.each([
    ['a return to the same vault (T5)', (h: Harness) => { h.rerender({ scope: '/other' }); h.rerender({ scope: '/vault' }) }],
    ['unmount (L1)', (h: Harness) => h.unmount()],
  ])('treats %s as a new session', async (_case, close) => {
    const h = setup('---\ntitle: Plan\n---\nbody')
    const done = admit(h.save, favoriteMutation(ON))
    await settle()
    close(h)

    await publish()

    expect(await done).toMatchObject({ kind: 'returned', current: false })
    expect(h.tab()).toBe('---\ntitle: Plan\n---\nbody')
  })

  it('reads an uncertain page inside the lane: the next change waits, and a switch during the read makes it stale (L1)', async () => {
    native.uncertain = true
    const { save, rerender } = setup('body')
    const done = admit(save, favoriteMutation(ON))
    await settle()
    await publish() // The native call ends; the read of the page is still pending.

    expect(save.current.mutateDocument(page, favoriteMutation(OFF))).toEqual({ admitted: false, reason: 'busy' })
    rerender({ scope: '/other' })
    rerender({ scope: '/vault' })
    await publish()

    expect(await done).toMatchObject({ kind: 'returned', current: false, result: { status: 'uncertain', onDisk: OFF } })
    expect(save.current.mutateDocument(page, favoriteMutation(OFF)).admitted).toBe(true)
  })

  it('makes close and switch wait for a change on a page with no pending text (T3)', async () => {
    const { save } = setup('body')
    const done = admit(save, favoriteMutation(ON))
    const release = save.current.holdMutationAdmission()
    expect(save.current.mutateDocument('/vault/other.md', favoriteMutation(ON))).toEqual({ admitted: false, reason: 'closing' })
    let idleNow = false
    void save.current.whenMutationsIdle().then(() => { idleNow = true })
    await settle()
    expect(idleNow).toBe(false)

    await publish()
    await done
    await settle()

    expect(idleNow).toBe(true)
    release()
    expect(save.current.mutateDocument(page, favoriteMutation(ON)).admitted).toBe(true)
  })

  it('refuses a page Trash holds, and gives an earlier change\'s text to the Trash drain (T1)', async () => {
    const { save } = setup('---\ntitle: Plan\n---\nbody')
    act(() => { save.current.holdAutosave([page]) })
    expect(save.current.mutateDocument(page, favoriteMutation(ON))).toEqual({ admitted: false, reason: 'trash' })
    act(() => { save.current.releaseAutosave([page], 'release') })

    const done = admit(save, favoriteMutation(ON))
    await settle()
    act(() => {
      save.current.holdAutosave([page])
      save.current.handleContentChange(page, '---\ntitle: Plan\n---\ntyped before the move')
    })
    await publish()
    await done
    await idle()
    expect(native.saves).toEqual([])

    await act(async () => { await save.current.drainHeld(page) })
    expect(native.saves).toEqual([`---\ntitle: Plan\n${KEYS}---\ntyped before the move`])
  })

  it('reports an unknown outcome when the native call fails, and a commit even if the last buffer read throws', async () => {
    const { save } = setup('body')
    const unknown = admit(save, { ...favoriteMutation(ON), publish: () => Promise.reject(new Error('IPC lost')) })
    expect(await unknown).toMatchObject({ kind: 'unknown', current: true })

    let reads = 0
    const flushBuffers = () => { if (++reads > 1) throw new Error('editor gone') }
    const done = admit(save, { ...favoriteMutation(ON), flushBuffers })
    await settle()
    await publish()
    expect(await done).toMatchObject({ kind: 'returned', result: { status: 'committed' } })
  })

  it('does not publish when the newer text before it cannot be saved', async () => {
    const { save } = setup('body')
    act(() => { save.current.handleContentChange(page, 'typed') })
    native.failSave = true

    const done = admit(save, favoriteMutation(ON))

    expect(await done).toMatchObject({ kind: 'notRun' })
    expect(native.calls).toBe(0)
  })
})
