import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { SetStateAction } from 'react'
import { invoke, type InvokeArgs } from '@tauri-apps/api/core'
import { useEditorSave, type MutationSettled } from '../../hooks/useEditorSave'
import type { VaultEntry } from '../../types'
import { notePathsMatch } from '../../utils/notePathIdentity'
import { renameWithLinkedPages, type LinkedPageMutation, type LinkedPageResult, type LinkedRenameOutcome } from './linkedRename'
import { RENAME_REFUSED_PREFIX } from './renameRefusal'
import { runAutomaticRename } from './managedRename'
import { legacyWikilinkTargets, rebaseInPlace, retargetLinkedPage, vaultRelativeStem } from './markdownRelocation'
import { createRenameAdmission, type RenameAdmission } from './renameAdmission'
import { parseRenameReceipt, type RenameReceipt } from './renameReceipt'
import { linkedRebase } from './renameSettlement'

// The real save queue and its page lanes; only the native transport is scripted.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../../mock-tauri', () => ({ isTauri: () => true, mockInvoke: vi.fn(), updateMockContent: vi.fn() }))

const VAULT = '/vault'
const disk = new Map<string, string>()
const refusedSaves = new Set<string>()
let tabs: { entry: VaultEntry; content: string }[] = []

interface Gate { promise: Promise<void>; open: () => void }
function gate(): Gate {
  let open: () => void = () => {}
  return { promise: new Promise<void>(resolve => { open = resolve }), open }
}

/** Lets a test give "native" a different but equivalent spelling than the TypeScript port. */
let nativeSpelling: ((after: string) => string) | null = null

/** Like the desktop: the renamed page moves, linked pages are rewritten, open pages reported. */
function nativeRename(source: string, newPath: string, openPaths: readonly string[]): RenameReceipt {
  const before = disk.get(source) ?? ''
  const content = rebaseInPlace(before, VAULT, source, newPath).content
  disk.delete(source)
  disk.set(newPath, content)
  const retarget = { vault: VAULT, oldPath: source, newPath, oldTargets: legacyWikilinkTargets('', vaultRelativeStem(source, VAULT)), newTarget: vaultRelativeStem(newPath, VAULT) }
  const receipt: RenameReceipt = {
    new_path: newPath, updated_files: 0, failed_updates: 0, source_before_content: before, source_content: content,
    updated_open_pages: [], unrefreshed_open_paths: [],
  }
  for (const [path, text] of [...disk]) {
    if (path === newPath) continue
    const ported = retargetLinkedPage(text, path, retarget).content
    const after = ported !== text && nativeSpelling ? nativeSpelling(ported) : ported
    if (after === text) continue
    disk.set(path, after)
    receipt.updated_files += 1
    if (openPaths.some(open => notePathsMatch(open, path))) receipt.updated_open_pages.push({ path, before_content: text, content: after })
  }
  return receipt
}

/** The automatic rename's own path map, as `useAppSave` keeps it. */
const inFlight = new Map<string, Promise<string>>()
const renamed = new Map<string, string>()
let abortWaits: () => void = () => {}
let aborted: Promise<void> = new Promise(() => {})
function latest(path: string): string {
  let current = path
  for (let next = renamed.get(current); next && next !== current; next = renamed.get(current)) current = next
  return current
}
/** `waitForSettledPath`: a save or page change of a page waits for that page's own rename. */
async function waitForSettled(path: string): Promise<string> {
  const current = latest(path)
  const running = inFlight.get(current)
  if (!running) return current
  const stop = aborted.then(() => { throw new Error('test released a stuck wait') })
  stop.catch(() => {})
  await Promise.race([running, stop])
  return latest(current)
}

function installNative() {
  vi.mocked(invoke).mockImplementation(async (cmd: string, raw?: InvokeArgs) => {
    if (cmd === 'save_page_content') {
      const { request, content } = raw as unknown as { request: { path: string }; content: string }
      if (refusedSaves.has(request.path)) return { status: 'refused', reason: 'stageFailed' }
      disk.set(request.path, content)
      return { status: 'committed', written: true, durable: true, history: null }
    }
    return null
  })
}

function page(path: string, content: string) {
  disk.set(path, content)
  tabs.push({ entry: { path, title: path.split('/').pop(), filename: path.split('/').pop() } as VaultEntry, content })
}

function renderQueue() {
  return renderHook(() => useEditorSave({
    updateVaultContent: vi.fn(),
    setTabs: (update: SetStateAction<typeof tabs>) => { tabs = typeof update === 'function' ? update(tabs) : update },
    setToastMessage: vi.fn(),
    resolvePath: latest,
    resolvePathBeforeSave: waitForSettled,
    persistenceScope: VAULT,
  })).result
}

const tabText = (path: string) => tabs.find(tab => notePathsMatch(tab.entry.path, path))?.content

interface AutoRename {
  /** False when admission refused it: no per-source state was registered, nothing dispatched. */
  started: boolean
  dispatched: () => boolean
  release: Gate
  done: Promise<LinkedRenameOutcome | null>
}

/**
 * The automatic rename executor in the order the UI seam must keep: admission ticket first,
 * then the per-source in-flight promise, then the linked page claims.
 */
function autoRename(queue: ReturnType<typeof renderQueue>, admission: RenameAdmission, source: string, newPath: string): AutoRename {
  const linked = tabs.map(tab => tab.entry.path).filter(path => !notePathsMatch(path, source))
  const release = gate()
  let dispatched = false
  const ticket = admission.admit(source, linked)
  if (!ticket) return { started: false, dispatched: () => false, release, done: Promise.resolve(null) }
  let outcome: LinkedRenameOutcome | null = null
  const running = (async () => {
    try {
      outcome = await renameWithLinkedPages({
        ticket,
        sourcePath: source,
        linkedPaths: linked,
        mutate: (path, mutation) => queue.current.mutateDocument(path, mutation),
        baselineOf: tabText,
        dispatch: async openPaths => {
          dispatched = true
          await release.promise
          return nativeRename(source, newPath, openPaths)
        },
        parse: (reply, openPaths) => parseRenameReceipt(reply, { sourcePath: source, openPaths, destination: { siblingOf: source } }),
        rebaseFor: (receipt, linkedPage) => linkedRebase(receipt, linkedPage, { vaultPath: VAULT, oldPath: source, oldTitle: '' }),
      })
      if (outcome.status === 'renamed') renamed.set(source, outcome.receipt.new_path)
      return outcome.status === 'renamed' ? outcome.receipt.new_path : source
    } finally {
      inFlight.delete(source)
      ticket.release()
    }
  })()
  inFlight.set(source, running)
  return { started: true, dispatched: () => dispatched, release, done: running.then(() => outcome) }
}

/** The production automatic rename runner over the real lanes; the test only scripts native. */
function automatic(queue: ReturnType<typeof renderQueue>, admission: RenameAdmission, source: string, newPath: string) {
  const release = gate()
  let dispatched = false
  const done = runAutomaticRename(source, {
    admission,
    inFlight,
    vaultPath: VAULT,
    linkedPaths: () => tabs.map(tab => tab.entry.path).filter(path => !notePathsMatch(path, source)),
    oldTitle: () => '',
    dispatch: async (_path, openPaths) => {
      dispatched = true
      await release.promise
      return nativeRename(source, newPath, openPaths)
    },
    holdAutosave: paths => queue.current.holdAutosave(paths),
    releaseAutosave: (paths, action) => queue.current.releaseAutosave(paths, action),
    services: {
      mutateExistingDocument: (path, mutation) => queue.current.mutateDocument(path, mutation),
      tabsRef: { get current() { return tabs } },
      setTabs: update => { tabs = update(tabs) },
    },
    route: (oldPath, nextPath) => {
      renamed.set(oldPath, nextPath)
      tabs = tabs.map(tab => tab.entry.path === oldPath ? { ...tab, entry: { ...tab.entry, path: nextPath } } : tab)
    },
  })
  return { registered: inFlight.has(source), dispatched: () => dispatched, release, done }
}

/** Lets every queued promise chain advance. */
const settle = () => act(async () => { for (let round = 0; round < 20; round += 1) await Promise.resolve() })

beforeEach(() => {
  aborted = new Promise(resolve => { abortWaits = resolve })
  nativeSpelling = null
  disk.clear()
  refusedSaves.clear()
  inFlight.clear()
  renamed.clear()
  tabs = []
  installNative()
})
afterEach(() => { vi.clearAllMocks() })

describe('managed rename admission across intersecting automatic renames', () => {
  it('without one admission before in-flight registration, two open pages renaming each other never dispatch', async () => {
    page('/vault/a.md', '# A\n\n[B](./b.md)\n')
    page('/vault/b.md', '# B\n\n[A](./a.md)\n')
    const queue = renderQueue()
    // Control: an admission that admits everything reproduces the old order.
    const permissive: RenameAdmission = { admit: (source, linked) => createRenameAdmission().admit(source, linked), held: () => null }
    const first = autoRename(queue, permissive, '/vault/a.md', '/vault/alpha.md')
    const second = autoRename(queue, permissive, '/vault/b.md', '/vault/beta.md')
    await settle()
    // Each linked change waits for the other page's rename, which waits for that change.
    expect([first.started, second.started]).toEqual([true, true])
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect([first.dispatched(), second.dispatched()]).toEqual([false, false])
    expect(inFlight.size).toBe(2)
    // Only releasing the waits from outside ends it: both then refuse, nothing was sent.
    const outcomes = await act(async () => { abortWaits(); return Promise.all([first.done, second.done]) })
    expect(outcomes.map(outcome => outcome?.status)).toEqual(['refused', 'refused'])
    expect(disk.has('/vault/a.md') && disk.has('/vault/b.md')).toBe(true)
  })

  it('with the shared admission the second rename refuses before registering and the first finishes', async () => {
    page('/vault/a.md', '# A\n\n[B](./b.md)\n')
    page('/vault/b.md', '# B\n\n[A](./a.md)\n')
    const queue = renderQueue()
    const admission = createRenameAdmission()
    const first = automatic(queue, admission, '/vault/a.md', '/vault/alpha.md')
    const second = automatic(queue, admission, '/vault/b.md', '/vault/beta.md')
    // Refused synchronously: no in-flight promise, no hold, nothing dispatched.
    expect([first.registered, second.registered]).toEqual([true, false])
    expect(await act(async () => second.done)).toBe(false)
    await settle()
    expect(first.dispatched()).toBe(true)
    first.release.open()
    expect(await act(async () => first.done)).toBe(true)
    expect(disk.get('/vault/alpha.md')).toBe('# A\n\n[B](./b.md)\n')
    expect(disk.get('/vault/b.md')).toBe('# B\n\n[A](./alpha.md)\n')
    expect(tabText('/vault/b.md')).toBe('# B\n\n[A](./alpha.md)\n')
    expect(second.dispatched()).toBe(false)

    // A later scheduler pass is a fresh action; it now runs with the first page at its new name.
    const retry = automatic(queue, admission, '/vault/b.md', '/vault/beta.md')
    expect(retry.registered).toBe(true)
    retry.release.open()
    expect(await act(async () => retry.done)).toBe(true)
    expect(disk.get('/vault/alpha.md')).toBe('# A\n\n[B](./beta.md)\n')
    expect(inFlight.size).toBe(0)
  })

  it('a source draft typed during its own automatic rename stays held, never saved on the old base', async () => {
    page('/vault/untitled-note-1.md', '# Harbor\n\n[Self](./untitled-note-1.md)\n')
    const queue = renderQueue()
    const rename = automatic(queue, createRenameAdmission(), '/vault/untitled-note-1.md', '/vault/harbor.md')
    await settle()
    act(() => { queue.current.handleContentChange('/vault/untitled-note-1.md', '# Harbor\n\n[Self](./untitled-note-1.md)\n\nMore.\n') })
    // Held: the old-base draft is not written while the rename runs.
    await act(async () => { await queue.current.savePendingForPath('/vault/untitled-note-1.md') })
    expect(disk.get('/vault/untitled-note-1.md')).toBe('# Harbor\n\n[Self](./untitled-note-1.md)\n')
    rename.release.open()
    expect(await act(async () => rename.done)).toBe(true)
    expect(disk.get('/vault/harbor.md')).toBe('# Harbor\n\n[Self](./harbor.md)\n')
  })

  it('a ticket for one source refuses a manual rename of any page it may rewrite', async () => {
    const admission = createRenameAdmission()
    const ticket = admission.admit('/vault/a.md', ['/vault/b.md'])
    expect(admission.admit('/vault/b.md', [])).toBeNull()
    expect(admission.admit('/vault/c.md', ['/vault/A.md'])).toBeNull()
    expect(admission.held('/vault/a.md')).toBe(ticket)
    let finished = false
    void ticket?.released.then(() => { finished = true })
    ticket?.release()
    expect(admission.admit('/vault/b.md', ['/vault/a.md'])).not.toBeNull()
    await Promise.resolve()
    expect(finished).toBe(true)
  })
})

describe('linked open pages through their own save lanes', () => {
  it('words typed into a linked commentary during the rename keep both the words and the new link', async () => {
    page('/vault/Topics/plan.md', '# Plan\n')
    page('/vault/Notes/c.md', '# C\n\n[Source](../Topics/plan.md)\n\nThoughts.\n')
    const queue = renderQueue()
    const rename = autoRename(queue, createRenameAdmission(), '/vault/Topics/plan.md', '/vault/Topics/goals.md')
    await settle()
    expect(rename.dispatched()).toBe(true)
    // The lane is claimed: this text waits instead of saving over the rewrite.
    act(() => { queue.current.handleContentChange('/vault/Notes/c.md', '# C\n\n[Source](../Topics/plan.md)\n\nThoughts. More words.\n') })
    rename.release.open()
    const outcome = await act(async () => rename.done)
    expect(outcome).toEqual(expect.objectContaining({ status: 'renamed', heldPaths: [] }))
    await act(async () => { await queue.current.savePendingForPath('/vault/Notes/c.md') })
    const expected = '# C\n\n[Source](../Topics/goals.md)\n\nThoughts. More words.\n'
    expect(tabText('/vault/Notes/c.md')).toBe(expected)
    expect(disk.get('/vault/Notes/c.md')).toBe(expected)
  })

  it('when native spells the change differently, untouched lines still take its exact bytes', async () => {
    page('/vault/Topics/plan.md', '# Plan\n')
    page('/vault/Notes/c.md', '# C\n\n[Source](../Topics/plan.md)\n\nThoughts.\n')
    nativeSpelling = after => after.replace('(../Topics/goals.md)', '(<../Topics/goals.md>)')
    const queue = renderQueue()
    const rename = autoRename(queue, createRenameAdmission(), '/vault/Topics/plan.md', '/vault/Topics/goals.md')
    await settle()
    act(() => { queue.current.handleContentChange('/vault/Notes/c.md', '# C\n\n[Source](../Topics/plan.md)\n\nThoughts. More words.\n') })
    rename.release.open()
    expect(await act(async () => rename.done)).toEqual(expect.objectContaining({ status: 'renamed', heldPaths: [] }))
    await act(async () => { await queue.current.savePendingForPath('/vault/Notes/c.md') })
    expect(disk.get('/vault/Notes/c.md')).toBe('# C\n\n[Source](<../Topics/goals.md>)\n\nThoughts. More words.\n')
  })

  it('a draft that changed the same line differently stays held and is never saved over the receipt', async () => {
    page('/vault/Topics/plan.md', '# Plan\n')
    page('/vault/Notes/c.md', '# C\n\n[Source](../Topics/plan.md)\n')
    nativeSpelling = after => after.replace('(../Topics/goals.md)', '(<../Topics/goals.md>)')
    const queue = renderQueue()
    const rename = autoRename(queue, createRenameAdmission(), '/vault/Topics/plan.md', '/vault/Topics/goals.md')
    await settle()
    act(() => { queue.current.handleContentChange('/vault/Notes/c.md', '# C\n\n[Source](../Topics/plan.md) edited\n') })
    rename.release.open()
    const outcome = await act(async () => rename.done)
    expect(outcome).toEqual(expect.objectContaining({ status: 'renamed', heldPaths: ['/vault/Notes/c.md'] }))
    const explicit = await act(async () => queue.current.savePendingForPath('/vault/Notes/c.md').then(() => 'saved', (error: Error) => error.name))
    expect(explicit).toBe('UnmergedDraftError')
    // The receipt's bytes stay on disk; the newer words are kept in the page, unsaved.
    expect(disk.get('/vault/Notes/c.md')).toBe('# C\n\n[Source](<../Topics/goals.md>)\n')
    expect(tabText('/vault/Notes/c.md')).toBe('# C\n\n[Source](../Topics/plan.md) edited\n')
  })

  it('one linked page that cannot be saved first stops the rename before dispatch and releases the others', async () => {
    page('/vault/Topics/plan.md', '# Plan\n')
    page('/vault/Notes/c.md', '[Source](../Topics/plan.md)\n')
    page('/vault/Notes/d.md', '[Source](../Topics/plan.md)\n')
    const queue = renderQueue()
    refusedSaves.add('/vault/Notes/c.md')
    act(() => { queue.current.handleContentChange('/vault/Notes/c.md', '[Source](../Topics/plan.md) unsaved\n') })
    const rename = autoRename(queue, createRenameAdmission(), '/vault/Topics/plan.md', '/vault/Topics/goals.md')
    const outcome = await act(async () => rename.done)
    expect(outcome?.status).toBe('refused')
    expect(rename.dispatched()).toBe(false)
    expect(disk.has('/vault/Topics/plan.md')).toBe(true)
    // The other claimed lane was let go: its next words save normally.
    act(() => { queue.current.handleContentChange('/vault/Notes/d.md', '[Source](../Topics/plan.md) later\n') })
    await act(async () => { await queue.current.savePendingForPath('/vault/Notes/d.md') })
    expect(disk.get('/vault/Notes/d.md')).toBe('[Source](../Topics/plan.md) later\n')
  })
})

describe('Amendment B1: what each claimed lane is told after the reply', () => {
  const SOURCE = '/vault/Topics/plan.md'
  const C = '/vault/Notes/c.md'
  const D = '/vault/Notes/d.md'
  const E = '/vault/Notes/e.md'
  const LINK = '[Source](../Topics/plan.md)\n'

  /** The coordinator over real lanes, recording what each lane's change was given to settle. */
  function coordinate(queue: ReturnType<typeof renderQueue>, dispatch: (openPaths: string[]) => Promise<unknown>, readPage = vi.fn(async (path: string) => disk.get(path))) {
    const lanes = new Map<string, { mutation: LinkedPageMutation; done: Promise<MutationSettled<LinkedPageResult>> }>()
    const linked = tabs.map(tab => tab.entry.path).filter(path => path !== SOURCE)
    const ticket = createRenameAdmission().admit(SOURCE, linked)!
    const outcome = renameWithLinkedPages({
      ticket,
      sourcePath: SOURCE,
      linkedPaths: linked,
      mutate: (path, mutation) => {
        const admission = queue.current.mutateDocument(path, mutation)
        if (admission.admitted) lanes.set(path, { mutation: mutation as unknown as LinkedPageMutation, done: admission.done as Promise<MutationSettled<LinkedPageResult>> })
        return admission
      },
      baselineOf: tabText,
      dispatch,
      parse: (reply, openPaths) => parseRenameReceipt(reply, { sourcePath: SOURCE, openPaths, destination: { siblingOf: SOURCE } }),
      rebaseFor: (receipt, page) => linkedRebase(receipt, page, { vaultPath: VAULT, oldPath: SOURCE, oldTitle: '' }),
      readPage,
    })
    const told = async (path: string) => {
      const lane = lanes.get(path)!
      const settled = await lane.done
      if (settled.kind !== 'returned') throw new Error(`lane ${path} did not return`)
      return { result: settled.result, unproven: lane.mutation.unproven(settled.result), committed: lane.mutation.committedContent(settled.result) }
    }
    return { outcome, told, readPage }
  }

  it('a rejected transport before a deferred native commit: unknown, every lane unproven without a snapshot, nothing reread', async () => {
    page(SOURCE, '# Plan\n')
    page(C, LINK)
    page(D, LINK)
    const queue = renderQueue()
    let commitLater: () => void = () => {}
    const committed = new Promise<void>(resolve => { commitLater = resolve })
    const { outcome, told, readPage } = coordinate(queue, async openPaths => {
      // The worker keeps running after the reply is lost; it commits only later.
      void committed.then(() => nativeRename(SOURCE, '/vault/Topics/goals.md', openPaths))
      throw new Error('IPC reply lost')
    })
    const result = await act(async () => outcome)
    expect(result).toMatchObject({ status: 'unknown', heldPaths: [], unprovenPaths: [C, D] })
    for (const path of [C, D]) {
      expect(await told(path)).toEqual({ result: { kind: 'unproven', current: null }, unproven: { current: null }, committed: null })
    }
    // Rereads would still show the before-images here; none was taken as proof.
    expect(readPage).not.toHaveBeenCalled()
    await act(async () => { commitLater(); await Promise.resolve() })
    expect(disk.get(C)).toBe('[Source](../Topics/goals.md)\n')
  })

  it('a valid receipt reconciles only its explicitly unrefreshed pages, from their current bytes', async () => {
    page(SOURCE, '# Plan\n')
    page(C, LINK)
    page(D, LINK)
    page(E, LINK)
    const queue = renderQueue()
    const readPage = vi.fn(async (path: string) => {
      if (path === E) throw new Error('unreadable')
      return disk.get(path)
    })
    const { outcome, told } = coordinate(queue, async openPaths => {
      expect(openPaths).toEqual([C, D, E])
      disk.delete(SOURCE)
      disk.set('/vault/Topics/goals.md', '# Plan\n')
      // C's rewrite failed and left it as it was; D was edited outside the app meanwhile.
      disk.set(D, 'External words\n' + LINK)
      return {
        new_path: '/vault/Topics/goals.md', updated_files: 0, failed_updates: 3, source_before_content: '# Plan\n',
        source_content: '# Plan\n', updated_open_pages: [], unrefreshed_open_paths: [C, D, E],
      }
    }, readPage)
    const result = await act(async () => outcome)
    expect(result).toMatchObject({ status: 'renamed', heldPaths: [], unprovenPaths: [D, E] })
    // Same bytes as claimed: continue from them (a current baseline, not proof of anything else).
    expect((await told(C)).result).toEqual({ kind: 'unchanged' })
    expect(await told(D)).toEqual({ result: { kind: 'unproven', current: 'External words\n' + LINK }, unproven: { current: 'External words\n' + LINK }, committed: null })
    expect((await told(E)).unproven).toEqual({ current: null })
  })

  it('an explicit backend refusal releases every claimed lane unchanged without rereads', async () => {
    page(SOURCE, '# Plan\n')
    page(C, LINK)
    const queue = renderQueue()
    const { outcome, told, readPage } = coordinate(queue, async () => {
      throw `${RENAME_REFUSED_PREFIX}A note with that name already exists`
    })
    expect(await act(async () => outcome)).toEqual({ status: 'refused', reason: 'native', error: 'A note with that name already exists' })
    expect(await told(C)).toEqual({ result: { kind: 'unchanged' }, unproven: null, committed: null })
    expect(readPage).not.toHaveBeenCalled()
  })
})
