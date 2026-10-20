import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProposalReceipt } from '../proposals/proposalContract'
import { deferred, fakeRegistry, fixtureText, packageOf, VAULT } from './extensions.test-utils'
import type { ExtensionController, OpenTarget } from './extensionSessionController'
import { ExtensionsUnsettledError, holdWithExtensions, useExtensions } from './useExtensions'

vi.mock('./extensionMarkdownText', async () => (await import('./extensionEncoder.test-utils')).encoderStandIn())

const KEY = 'local.meeting-debrief/new-debrief'
const ANSWERS = { meeting: 'Weekly sync', decisions: 'Ship it' }
const target = (): OpenTarget => ({ beforeWrite: () => {}, committed: () => {}, open: async () => true })

async function mount(options: { vaultPath?: string; onUnsettled?: () => void } = {}) {
  const registry = fakeRegistry([await packageOf([fixtureText('meeting-debrief.json')], 'newest')])
  const controller = registry.controller()
  const hook = renderHook(({ vaultPath }) => useExtensions({ vaultPath, ready: true, controller, onUnsettled: options.onUnsettled }),
    { initialProps: { vaultPath: options.vaultPath ?? VAULT } })
  await waitFor(() => expect(hook.result.current.runnable.map(item => item.key)).toEqual([KEY]))
  return { registry, controller, hook }
}

const run = (controller: ExtensionController, answers = ANSWERS) => controller.create(controller.openRun(KEY)!, { answers, folder: '', target: target() })

describe('the extension boundary as backup, switch and close use it', () => {
  it('stops admissions with the backup hold and joins an admitted write before the held work proceeds', async () => {
    const { registry, controller, hook } = await mount()
    const reply = deferred<ProposalReceipt | null>()
    registry.api.submitProposal.mockImplementationOnce(() => reply.promise)
    const writing = run(controller)
    await waitFor(() => expect(registry.api.submitProposal).toHaveBeenCalled())
    const close = deferred<{ status: 'closed' } | null>()
    registry.api.closeSession.mockImplementationOnce(() => close.promise)

    const hold = vi.fn(() => () => {})
    let release = () => {}
    act(() => { release = holdWithExtensions(hook.result.current.boundary, hold) })
    expect(hold).toHaveBeenCalledOnce()
    // Synchronously: nothing new can start while the backup holds the workspace.
    expect(controller.openRun(KEY)).toBeNull()

    let settled = false
    const settling = hook.result.current.boundary.settle().then(() => { settled = true })
    reply.resolve(registry.committedFor(registry.api.submitProposal.mock.calls[0][0] as never))
    expect(await writing).toMatchObject({ status: 'created', opened: 'notShown' })
    await Promise.resolve()
    expect(settled).toBe(false)
    // Native answers the close only after joining the admitted write; only then may the backup read.
    close.resolve({ status: 'closed' })
    await settling
    expect(settled).toBe(true)

    act(() => release())
    await waitFor(() => expect(hook.result.current.runnable.map(item => item.key)).toEqual([KEY]))
    await run(controller, { ...ANSWERS, meeting: 'After the backup' })
    expect(registry.api.openSession.mock.calls.map(([args]) => args.vaultPath)).toEqual([VAULT, VAULT])
    expect(registry.api.beginRun.mock.calls[1][0].sessionId).toBe('session-2')
  })

  it('refuses the held work honestly on an unconfirmed close, and stays blocked after release', async () => {
    const onUnsettled = vi.fn()
    const { registry, controller, hook } = await mount({ onUnsettled })
    await run(controller)
    registry.api.closeSession.mockResolvedValueOnce(null)
    let release = () => {}
    act(() => { release = holdWithExtensions(hook.result.current.boundary, () => () => {}) })
    await expect(hook.result.current.boundary.settle()).rejects.toBeInstanceOf(ExtensionsUnsettledError)
    expect(onUnsettled).toHaveBeenCalledOnce()
    act(() => release())
    await waitFor(() => expect(hook.result.current.snapshot.status).toBe('unsettled'))
    expect(hook.result.current.runnable).toEqual([])
    expect(controller.resume()).toBe(false)
    expect(controller.openRun(KEY)).toBeNull()
    // The retry asks native about the same session; confirmed, the vault resumes as a new visit.
    await act(async () => { await controller.retryUnsettled() })
    await waitFor(() => expect(hook.result.current.runnable.map(item => item.key)).toEqual([KEY]))
    expect(registry.api.closeSession.mock.calls.map(([args]) => args.sessionId)).toEqual(['session-1', 'session-1'])
  })

  it('leaves extensions running when the hold itself refuses', async () => {
    const { controller, hook } = await mount()
    const refused = new Error('draft holds words')
    expect(() => holdWithExtensions(hook.result.current.boundary, () => { throw refused })).toThrow(refused)
    expect(controller.openRun(KEY)).not.toBeNull()
  })

  it('releases once, however often release is called', async () => {
    const { hook } = await mount()
    const reopen = vi.fn()
    const release = holdWithExtensions(hook.result.current.boundary, () => reopen)
    release()
    release()
    expect(reopen).toHaveBeenCalledOnce()
  })
})

describe('visits follow the shown vault', () => {
  it('gives A, then B, then A again separate sessions, never one reused by path', async () => {
    const { registry, controller, hook } = await mount({ vaultPath: '/vaults/a' })
    await run(controller)
    hook.rerender({ vaultPath: '/vaults/b' })
    await waitFor(() => expect(hook.result.current.snapshot).toMatchObject({ status: 'ready', vaultPath: '/vaults/b' }))
    await run(controller)
    hook.rerender({ vaultPath: '/vaults/a' })
    await waitFor(() => expect(hook.result.current.snapshot).toMatchObject({ status: 'ready', vaultPath: '/vaults/a' }))
    await run(controller)
    expect(registry.api.openSession.mock.calls.map(([args]) => args.vaultPath)).toEqual(['/vaults/a', '/vaults/b', '/vaults/a'])
    expect(registry.api.closeSession.mock.calls.map(([args]) => args.sessionId)).toEqual(['session-1', 'session-2'])
  })

  it('closes the session when the window unmounts', async () => {
    const { registry, controller, hook } = await mount()
    await run(controller)
    hook.unmount()
    await waitFor(() => expect(registry.api.closeSession).toHaveBeenCalledWith({ sessionId: 'session-1' }))
  })

  it('opens nothing for a window that is not ready', async () => {
    const registry = fakeRegistry([])
    const controller = registry.controller()
    renderHook(() => useExtensions({ vaultPath: VAULT, ready: false, controller }))
    expect(controller.visit()).toBeNull()
    expect(registry.api.list).not.toHaveBeenCalled()
  })
})
