import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { E2_HOST_CAPABILITIES, type Capability } from '../extensions/extensionContract'
import { createExtensionController } from '../extensions/extensionSessionController'
import { fakeRegistry, fixtureText, packageOf, VAULT, type FakePackage } from '../extensions/extensions.test-utils'
import { candidate, deferred, fakeHost } from './adapt.test-utils'
import type { AdaptApi, AdaptProviderState } from './adaptContract'
import { createAdaptController } from './adaptController'
import { AdaptHarness } from './AdaptHarness.test-utils'
import type { PageSnapshot } from './useAdaptUi'

vi.mock('../extensions/extensionMarkdownText', async () => (await import('../extensions/extensionEncoder.test-utils')).encoderStandIn())
vi.mock('../../utils/macosDismissableEscapeSurface', () => ({
  registerMacosDismissableEscapeSurface: () => () => {},
  useMacosDismissableEscapeSurfaceRef: (ref: unknown) => ref ?? (() => {}),
}))

const QUICK = fixtureText('quick-note.json')
const QUICK_NEXT = QUICK.replace('"version": "1.0.0"', '"version": "1.1.0"')

function setup({ codex, packages = [], inSettings = false, hostCapabilities }: { codex?: AdaptProviderState; packages?: FakePackage[]; inSettings?: boolean; hostCapabilities?: readonly Capability[] } = {}) {
  const host = fakeHost(codex)
  const controller = createAdaptController({ api: host.api as unknown as AdaptApi, pollMs: 5, retryMs: 1, retries: 2 })
  const registry = fakeRegistry(packages)
  const extensions = hostCapabilities ? createExtensionController({ api: registry.transport, hostCapabilities }) : registry.controller()
  const snapshotPage = vi.fn(async (): Promise<PageSnapshot> => ({ title: 'Reading list', text: '# Reading list' }))
  const harness = (vaultPath?: string) => <AdaptHarness registry={extensions} controller={controller} snapshotPage={snapshotPage} vaultPath={vaultPath} inSettings={inSettings} />
  const view = render(harness())
  /** The window switches vault, as App does: both controllers leave the old visit. */
  const moveTo = (vaultPath: string) => view.rerender(harness(vaultPath))
  return { host, controller, registry, extensions, snapshotPage, moveTo }
}

/** Another window changes what is on, through the registry; this window reads it again. */
async function elsewhere(registry: ReturnType<typeof fakeRegistry>, extensions: ReturnType<ReturnType<typeof fakeRegistry>['controller']>, change: () => Promise<unknown>) {
  await act(async () => { await change(); await extensions.refresh() })
}

async function lastCard(count: number) {
  await waitFor(() => expect(within(dialog()).getAllByTestId('adapt-candidate')).toHaveLength(count))
  return within(dialog()).getAllByTestId('adapt-candidate').at(-1)!
}

/** Preview and turn on the latest candidate through the E1 preview; the Adapt dialog comes back. */
async function turnOnLatest(count: number) {
  fireEvent.click(within(await lastCard(count)).getByTestId('adapt-preview'))
  fireEvent.click(within(await screen.findByTestId('extension-preview-dialog')).getByTestId('extension-turn-on'))
  await screen.findByTestId('adapt-dialog')
}

async function openAdapt() {
  fireEvent.click(screen.getByRole('button', { name: 'Open Adapt' }))
  return screen.findByTestId('adapt-dialog')
}
const dialog = () => screen.getByTestId('adapt-dialog')

async function ask(text: string) {
  const request = await within(dialog()).findByTestId('adapt-request')
  fireEvent.change(request, { target: { value: text } })
  fireEvent.keyDown(request, { key: 'Enter', metaKey: true })
}

async function choose(trigger: HTMLElement, item: string) {
  act(() => { trigger.focus(); fireEvent.keyDown(trigger, { key: 'ArrowDown' }) })
  fireEvent.click(within(await screen.findByRole('menu')).getByText(item))
}

describe('the Adapt dialog', () => {
  it('reviews a candidate as this window\'s extension host does: a passage recipe can be turned on, a page-picker recipe cannot', async () => {
    const { host } = setup({ hostCapabilities: E2_HOST_CAPABILITIES })
    await openAdapt()
    await ask('Keep my thoughts on passages')
    await waitFor(() => expect(host.api.send).toHaveBeenCalledOnce())
    act(() => host.reply('conv-1', { kind: 'candidate', message: 'Here it is!', packageText: fixtureText('passage-commentary.json') }))
    const commentary = await lastCard(1)
    expect(commentary).toHaveAttribute('data-check', 'ready')
    expect(within(commentary).queryByTestId('adapt-candidate-needs')).not.toBeInTheDocument()
    fireEvent.click(within(commentary).getByTestId('adapt-preview'))
    expect(within(await screen.findByTestId('extension-preview-dialog')).getByTestId('extension-turn-on')).toBeEnabled()
  })

  it('keeps a recipe that adds to a page the person picks unavailable, saying what it needs', async () => {
    const { host, registry } = setup({ hostCapabilities: E2_HOST_CAPABILITIES })
    await openAdapt()
    await ask('Log what I notice on a page I pick')
    await waitFor(() => expect(host.api.send).toHaveBeenCalledOnce())
    act(() => host.reply('conv-1', { kind: 'candidate', message: 'Here it is!', packageText: fixtureText('append-observation.json') }))
    const card = await lastCard(1)
    expect(card).toHaveAttribute('data-check', 'unavailable')
    expect(within(card).getByTestId('adapt-candidate-needs')).toHaveTextContent('adding to an existing page')
    expect(within(card).queryByTestId('adapt-preview')).not.toBeInTheDocument()
    expect(registry.api.importCandidate).not.toHaveBeenCalled()
  })

  it('opens no visit until opened, sends only on Send, and turns a candidate on only through the E1 preview, then undoes it', async () => {
    const { host, registry } = setup()
    await screen.findAllByTestId('extension-adapt')
    expect(host.api.openVisit).not.toHaveBeenCalled()
    await openAdapt()
    await waitFor(() => expect(within(dialog()).getByTestId('adapt-request')).toHaveFocus())
    expect(within(dialog()).getByTestId('adapt-claude')).toHaveTextContent('Claude isn’t available in this version')
    await ask('A quick note for ideas')
    await waitFor(() => expect(host.api.send).toHaveBeenCalledOnce())
    await waitFor(() => expect(within(dialog()).getByTestId('adapt-status')).toHaveTextContent('Working…'))
    expect(screen.getByTestId('menu-status')).toHaveTextContent('working')

    act(() => host.reply('conv-1'))
    const card = await within(dialog()).findByTestId('adapt-candidate')
    expect(card).toHaveTextContent('Checked by LeadingLight')
    expect(card).toHaveTextContent('A new extension: Quick note')
    expect(within(dialog()).getByTestId('adapt-reply')).toHaveTextContent('Here is a quick note.')
    expect(registry.api.importCandidate).not.toHaveBeenCalled()

    fireEvent.click(within(card).getByTestId('adapt-preview'))
    const preview = await screen.findByTestId('extension-preview-dialog')
    expect(screen.queryByTestId('adapt-dialog')).not.toBeInTheDocument()
    expect(registry.api.activate).not.toHaveBeenCalled()
    fireEvent.click(within(preview).getByTestId('extension-turn-on'))
    await within(await screen.findByTestId('adapt-dialog')).findByText('Quick note is on.')
    const [{ packageSha256 }] = registry.api.activate.mock.calls.map(([args]) => args)
    expect(registry.api.activate).toHaveBeenCalledWith(expect.objectContaining({ packageId: 'local.quick-note', expectedActiveSha256: null }))

    fireEvent.click(within(dialog()).getByTestId('adapt-undo'))
    await within(dialog()).findByText('Quick note is off. Notes it created stay in your workspace.')
    expect(registry.api.deactivate).toHaveBeenCalledWith(expect.objectContaining({ packageId: 'local.quick-note', expectedActiveSha256: packageSha256 }))
    expect(host.api.send).toHaveBeenCalledOnce()
  })

  it('tries a turned-on candidate through the E1 form, which creates one note, and keeps another for later without turning it on', async () => {
    const { host, registry } = setup()
    await openAdapt()
    await ask('A quick note')
    await waitFor(() => expect(host.api.send).toHaveBeenCalledOnce())
    act(() => host.reply('conv-1'))
    fireEvent.click(within(await within(dialog()).findByTestId('adapt-candidate')).getByTestId('adapt-preview'))
    fireEvent.click(within(await screen.findByTestId('extension-preview-dialog')).getByTestId('extension-turn-on'))
    fireEvent.click(await within(await screen.findByTestId('adapt-dialog')).findByTestId('adapt-try'))
    const run = await screen.findByTestId('extension-run-dialog')
    expect(screen.queryByTestId('adapt-dialog')).not.toBeInTheDocument()
    fireEvent.change(within(run).getByLabelText('Topic', { exact: false }), { target: { value: 'Gardening' } })
    fireEvent.click(within(run).getByTestId('extension-run-create'))
    // This recipe does not open its note, so the form says it was created and waits for Done.
    fireEvent.click(await within(run).findByTestId('extension-run-done'))
    await waitFor(() => expect(screen.queryByTestId('extension-run-dialog')).not.toBeInTheDocument())
    expect(registry.api.submitProposal).toHaveBeenCalledOnce()
    await openAdapt()
    expect(within(dialog()).getByTestId('adapt-made')).toHaveTextContent('You made a note with it: gardening.md.')

    fireEvent.click(within(dialog()).getByTestId('adapt-new-request'))
    await ask('Another one')
    await waitFor(() => expect(host.api.send).toHaveBeenCalledTimes(2))
    act(() => host.reply('conv-2', { kind: 'candidate', message: 'Here.', packageText: QUICK.replaceAll('local.quick-note', 'local.other-note') }))
    fireEvent.click(within(await within(dialog()).findByTestId('adapt-candidate')).getByTestId('adapt-keep'))
    await within(dialog()).findByText('Kept in Settings → Extensions. Turn it on there when you’re ready.')
    expect(registry.api.activate).toHaveBeenCalledOnce()
  })

  it('never stores or offers to turn on a candidate that fails the E1 checks', async () => {
    const { host, registry } = setup()
    await openAdapt()
    await ask('Something broken')
    await waitFor(() => expect(host.api.send).toHaveBeenCalledOnce())
    act(() => host.reply('conv-1', { kind: 'candidate', message: 'Here it is!', packageText: fixtureText('invalid/folder-path.json') }))
    const card = await within(dialog()).findByTestId('adapt-candidate')
    expect(card).toHaveAttribute('data-check', 'invalid')
    expect(card).toHaveTextContent('The draft didn’t pass LeadingLight’s checks')
    expect(within(card).queryByTestId('adapt-preview')).not.toBeInTheDocument()
    expect(within(card).queryByTestId('adapt-keep')).not.toBeInTheDocument()
    fireEvent.click(within(card).getByTestId('adapt-change'))
    expect(within(dialog()).getByTestId('adapt-request')).toHaveFocus()
    expect(registry.api.importCandidate).not.toHaveBeenCalled()
    expect(registry.effects()).toBe(0)
  })

  it('sends exactly the chips shown: a removed one is not sent, and the page is read only on its own click', async () => {
    const { host, snapshotPage } = setup()
    await openAdapt()
    expect(snapshotPage).not.toHaveBeenCalled()
    await choose(within(dialog()).getByTestId('adapt-attach'), 'Pasted text…')
    fireEvent.change(within(dialog()).getByLabelText('Text to attach'), { target: { value: 'my private draft' } })
    fireEvent.click(within(dialog()).getByTestId('adapt-paste-add'))
    await choose(within(dialog()).getByTestId('adapt-attach'), 'Current page')
    await waitFor(() => expect(within(dialog()).getAllByTestId('adapt-chip')).toHaveLength(2))
    expect(snapshotPage).toHaveBeenCalledOnce()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Remove Pasted text' }))
    expect(within(dialog()).getByTestId('adapt-sends-what')).toHaveTextContent('Send includes this request, LeadingLight’s extension guide and the attachments above.')
    await ask('A reading reflection')
    await waitFor(() => expect(host.api.send).toHaveBeenCalledOnce())
    const [args] = host.api.send.mock.calls[0]
    expect(args.attachments).toEqual([{ kind: 'pageSnapshot', label: 'Reading list', text: '# Reading list' }])
    expect(JSON.stringify(args)).not.toContain('my private draft')
    expect(JSON.stringify(args)).not.toContain(VAULT)
  })

  it('binds Adjust to the version on, and leaves a version changed meanwhile alone through compare-and-set', async () => {
    const { host, registry } = setup({ packages: [await packageOf([QUICK], 'newest')] })
    const row = (await screen.findAllByTestId('extension-row')).find(item => item.dataset.packageId === 'local.quick-note')!
    fireEvent.click(within(row).getByTestId('extension-adjust'))
    await screen.findByTestId('adapt-dialog')
    expect(within(dialog()).getByTestId('adapt-chip')).toHaveTextContent('Quick note · 1.0.0')
    await ask('Ask for a mood too')
    await waitFor(() => expect(host.api.send).toHaveBeenCalledOnce())
    const base = registry.api.list.mock.results.length ? (await registry.api.list.mock.results.at(-1)!.value).extensions[0].activeSha256 : null
    expect(host.api.send.mock.calls[0][0].revision).toEqual({ packageId: 'local.quick-note', baseSha256: base, expectedActiveSha256: base })

    act(() => host.reply('conv-1', { kind: 'candidate', message: 'Added a mood.', packageText: QUICK_NEXT }))
    const card = await within(dialog()).findByTestId('adapt-candidate')
    expect(card).toHaveTextContent('Changes Quick note: version 1.0.0 → 1.1.0.')
    fireEvent.click(within(card).getByTestId('adapt-preview'))
    const preview = await screen.findByTestId('extension-preview-dialog')
    expect(within(preview).getByTestId('extension-preview-version')).toHaveTextContent('Replaces version 1.0.0 with version 1.1.0.')
    // Another window turns the base off while the preview is open.
    await registry.api.deactivate({ packageId: 'local.quick-note', expectedActiveSha256: base! })
    fireEvent.click(within(preview).getByTestId('extension-turn-on'))
    await within(await screen.findByTestId('adapt-dialog')).findByText('Quick note changed since you asked, so this version wasn’t turned on. Use Adjust… to ask again.')
    expect(registry.api.activate).toHaveBeenCalledWith(expect.objectContaining({ packageId: 'local.quick-note', expectedActiveSha256: base }))
    const listed = await registry.api.list()
    expect(listed.extensions[0].activeSha256).toBeNull()
  })

  it('goes on in the same chat: create, turn on, revise, turn on, revise, and refuses a version changed elsewhere meanwhile', async () => {
    const { host, registry, extensions } = setup()
    await openAdapt()
    await ask('A quick note')
    await waitFor(() => expect(host.api.send).toHaveBeenCalledTimes(1))
    act(() => host.reply('conv-1'))
    await turnOnLatest(1)
    const first = registry.api.activate.mock.calls[0][0].packageSha256
    // The version turned on is now the visible extension of the next request.
    expect(within(dialog()).getByTestId('adapt-chip')).toHaveTextContent('Quick note · 1.0.0')

    await ask('Add a mood')
    await waitFor(() => expect(host.api.send).toHaveBeenCalledTimes(2))
    expect(host.api.send.mock.calls[1][0]).toMatchObject({
      conversationId: 'conv-1', revision: { packageId: 'local.quick-note', baseSha256: first, expectedActiveSha256: first }, attachments: [{ kind: 'extension' }],
    })
    act(() => host.reply('conv-1', { kind: 'candidate', message: 'Added a mood.', packageText: QUICK_NEXT }))
    expect(await lastCard(2)).toHaveTextContent('Changes Quick note: version 1.0.0 → 1.1.0.')
    await turnOnLatest(2)
    const second = registry.api.activate.mock.calls[1][0]
    expect(second).toMatchObject({ packageId: 'local.quick-note', expectedActiveSha256: first })
    expect(within(dialog()).getByTestId('adapt-chip')).toHaveTextContent('Quick note · 1.1.0')

    await ask('Add a date')
    await waitFor(() => expect(host.api.send).toHaveBeenCalledTimes(3))
    expect(host.api.send.mock.calls[2][0].revision).toEqual({ packageId: 'local.quick-note', baseSha256: second.packageSha256, expectedActiveSha256: second.packageSha256 })
    // Before the reply, another window turns it off: what the request expected is no longer on.
    await elsewhere(registry, extensions, () => registry.api.deactivate({ packageId: 'local.quick-note', expectedActiveSha256: second.packageSha256 }))
    act(() => host.reply('conv-1', { kind: 'candidate', message: 'Added a date.', packageText: QUICK.replace('"version": "1.0.0"', '"version": "1.2.0"') }))
    const stale = await lastCard(3)
    expect(stale).toHaveAttribute('data-state', 'stale')
    expect(within(stale).queryByTestId('adapt-preview')).not.toBeInTheDocument()
    expect(registry.api.activate).toHaveBeenCalledTimes(2)
    // A refused version advances nothing: no chip is attached for it.
    expect(within(dialog()).queryByTestId('adapt-chip')).not.toBeInTheDocument()
  })

  it('turns nothing on from a preview left open across a vault switch, and keeps the new vault clean', async () => {
    const { host, registry, moveTo } = setup()
    await openAdapt()
    await ask('A quick note')
    await waitFor(() => expect(host.api.send).toHaveBeenCalledOnce())
    act(() => host.reply('conv-1'))
    fireEvent.click(within(await lastCard(1)).getByTestId('adapt-preview'))
    const preview = await screen.findByTestId('extension-preview-dialog')
    moveTo('/vaults/other')
    fireEvent.click(within(preview).getByTestId('extension-turn-on'))
    await waitFor(() => expect(screen.queryByTestId('extension-preview-dialog')).not.toBeInTheDocument())
    expect(registry.api.activate).not.toHaveBeenCalled()
    await openAdapt()
    await waitFor(() => expect(host.api.openVisit).toHaveBeenLastCalledWith({ vaultPath: '/vaults/other' }))
    expect(within(dialog()).queryByTestId('adapt-candidate')).not.toBeInTheDocument()
    expect(within(dialog()).queryByTestId('adapt-chip')).not.toBeInTheDocument()
  })

  it('lets an Undo that finishes after a vault switch write nothing into the new visit, and opens Try it only for the version turned on', async () => {
    const { host, registry, extensions, moveTo } = setup()
    await openAdapt()
    await ask('A quick note')
    await waitFor(() => expect(host.api.send).toHaveBeenCalledOnce())
    act(() => host.reply('conv-1'))
    await turnOnLatest(1)
    const adopted = registry.api.activate.mock.calls[0][0].packageSha256

    // Another window turns on a different version with the same command: Try it does not open it.
    const other = QUICK.replace('"version": "1.0.0"', '"version": "1.0.5"')
    await elsewhere(registry, extensions, async () => {
      const stored = await registry.api.importCandidate({ packageText: other })
      await registry.api.activate({ packageId: 'local.quick-note', packageSha256: stored.packageSha256, expectedActiveSha256: adopted })
    })
    fireEvent.click(within(dialog()).getByTestId('adapt-try'))
    await within(dialog()).findByText('Another version of Quick note is on now, so Try it didn’t open. New page → From extension… uses the version that is on.')
    expect(screen.queryByTestId('extension-run-dialog')).not.toBeInTheDocument()

    // It was a new extension, so Undo turns it off; that answer arrives after the switch.
    const original = registry.api.deactivate.getMockImplementation()!
    const gate = deferred<void>()
    registry.api.deactivate.mockImplementationOnce(async args => { await gate.promise; return original(args) })
    fireEvent.click(within(dialog()).getByTestId('adapt-undo'))
    await waitFor(() => expect(registry.api.deactivate).toHaveBeenCalledWith(expect.objectContaining({ expectedActiveSha256: adopted })))
    moveTo('/vaults/other')
    await openAdapt()
    await waitFor(() => expect(host.api.openVisit).toHaveBeenLastCalledWith({ vaultPath: '/vaults/other' }))
    expect(within(dialog()).queryByTestId('adapt-chip')).not.toBeInTheDocument()
    // The new vault has its own candidate, kept for later, before the old Undo answers.
    await ask('Another note')
    await waitFor(() => expect(host.api.send).toHaveBeenCalledTimes(2))
    act(() => host.reply('conv-2', { kind: 'candidate', message: 'Here.', packageText: QUICK.replaceAll('local.quick-note', 'local.other-note') }))
    fireEvent.click(within(await lastCard(1)).getByTestId('adapt-keep'))
    await within(dialog()).findByText('Kept in Settings → Extensions. Turn it on there when you’re ready.')
    await act(async () => { gate.resolve(); await Promise.resolve() })
    await waitFor(() => expect(registry.api.deactivate).toHaveBeenCalledOnce())
    expect(within(dialog()).getByTestId('adapt-adoption')).toHaveAttribute('data-status', 'kept')
    expect(within(dialog()).queryByText(/Quick note is off/)).not.toBeInTheDocument()
    expect(within(dialog()).queryByTestId('adapt-chip')).not.toBeInTheDocument()
  })

  it('opened from Settings: Escape goes back to Settings, Keep writing leaves Settings too and keeps the request running', async () => {
    const { host } = setup({ inSettings: true })
    const askButton = await screen.findByTestId('extension-adapt')
    askButton.focus()
    fireEvent.click(askButton)
    await within(await screen.findByTestId('adapt-dialog')).findByTestId('adapt-request')
    fireEvent.keyDown(within(dialog()).getByTestId('adapt-request'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('adapt-dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('settings-panel')).toBeInTheDocument()
    await waitFor(() => expect(askButton).toHaveFocus())

    fireEvent.click(askButton)
    await screen.findByTestId('adapt-dialog')
    await ask('A weekly review')
    await waitFor(() => expect(within(dialog()).getByTestId('adapt-status')).toHaveTextContent('Working…'))
    fireEvent.click(within(dialog()).getByTestId('adapt-keep-writing'))
    await waitFor(() => expect(screen.queryByTestId('adapt-dialog')).not.toBeInTheDocument())
    expect(screen.queryByTestId('settings-panel')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Page')).toHaveFocus())
    expect(screen.getByTestId('menu-status')).toHaveTextContent('working')
    expect(host.api.cancelTurn).not.toHaveBeenCalled()
    act(() => host.reply('conv-1', { kind: 'question', message: 'How many questions?', choices: ['Three'] }))
    await waitFor(() => expect(screen.getByTestId('menu-status')).toHaveTextContent('ready'))
    expect(host.api.send).toHaveBeenCalledOnce()
  })

  it('Keep writing puts focus in the page and keeps the draft, where the close button returns to what opened Adapt', async () => {
    setup()
    const opener = screen.getByRole('button', { name: 'Open Adapt' })
    opener.focus()
    await openAdapt()
    fireEvent.change(await within(dialog()).findByTestId('adapt-request'), { target: { value: 'Half typed' } })
    fireEvent.click(within(dialog()).getByTestId('adapt-keep-writing'))
    await waitFor(() => expect(screen.queryByTestId('adapt-dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByLabelText('Page')).toHaveFocus())
    // Radix restores focus on a later tick; it must not be taken back from the page.
    await new Promise(done => setTimeout(done, 20))
    expect(screen.getByLabelText('Page')).toHaveFocus()

    opener.focus()
    await openAdapt()
    expect(within(dialog()).getByTestId('adapt-request')).toHaveValue('Half typed')
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByTestId('adapt-dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('keeps what is typed through Escape, returns focus, and shows a question\'s choices without sending them', async () => {
    const { host } = setup()
    const opener = screen.getByRole('button', { name: 'Open Adapt' })
    opener.focus()
    await openAdapt()
    await ask('A weekly review')
    await waitFor(() => expect(host.api.send).toHaveBeenCalledOnce())
    act(() => host.reply('conv-1', { kind: 'question', message: 'How many questions?', choices: ['Three', 'Five'] }))
    const choice = await within(dialog()).findByRole('button', { name: 'Three' })
    fireEvent.click(choice)
    expect(within(dialog()).getByTestId('adapt-request')).toHaveValue('Three')
    expect(host.api.send).toHaveBeenCalledOnce()
    fireEvent.keyDown(within(dialog()).getByTestId('adapt-request'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('adapt-dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(opener).toHaveFocus())
    await openAdapt()
    expect(within(dialog()).getByTestId('adapt-request')).toHaveValue('Three')
    expect(within(dialog()).getByTestId('adapt-reply')).toHaveTextContent('How many questions?')
  })

  it('shows an unsaved conversation plainly and saves it again on this computer only', async () => {
    const { host } = setup()
    await openAdapt()
    await ask('Keep this')
    await waitFor(() => expect(host.api.send).toHaveBeenCalledOnce())
    act(() => { host.reply('conv-1', candidate); host.setStorage('conv-1', 'unsaved') })
    const line = await within(dialog()).findByTestId('adapt-storage')
    expect(line).toHaveTextContent('isn’t saved on this computer')
    expect(line).toHaveTextContent('Saves on this computer only. Nothing is sent.')
    fireEvent.click(within(line).getByTestId('adapt-save-again'))
    await waitFor(() => expect(within(dialog()).queryByTestId('adapt-storage')).not.toBeInTheDocument())
    expect(host.api.saveConversation).toHaveBeenCalledOnce()
    expect(host.api.send).toHaveBeenCalledOnce()
  })

  it('never shows an unproven sign-in cancel as cancelled, and shows what Codex reports after it', async () => {
    const { host } = setup({ codex: { status: 'signedOut', lastConnect: null } })
    await openAdapt()
    fireEvent.click(await within(dialog()).findByTestId('adapt-connect'))
    const cancel = await within(dialog()).findByRole('button', { name: 'Cancel sign-in' })
    host.api.cancelConnect.mockImplementationOnce(async () => {
      host.state.codex = { status: 'unavailable', reason: 'failed', installedVersion: null }
      return { status: 'unconfirmed' } as never
    })
    fireEvent.click(cancel)
    expect(await within(dialog()).findByTestId('adapt-notice')).toHaveTextContent('Sign-in is blocked, but we couldn’t confirm that it stopped completely. You can keep writing.')
    await waitFor(() => expect(within(dialog()).getByTestId('adapt-provider')).toHaveAttribute('data-status', 'unavailable'))
    expect(within(dialog()).queryByText('Sign-in was cancelled.')).not.toBeInTheDocument()
    expect(within(dialog()).queryByTestId('adapt-request')).not.toBeInTheDocument()
    expect(host.api.send).not.toHaveBeenCalled()
  })

  it('offers a separate sign-in when signed out and says nothing is sent until then', async () => {
    const { host } = setup({ codex: { status: 'signedOut', lastConnect: null } })
    await openAdapt()
    const provider = await within(dialog()).findByTestId('adapt-provider')
    expect(provider).toHaveTextContent('This sign-in is only for LeadingLight.')
    expect(within(dialog()).queryByTestId('adapt-request')).not.toBeInTheDocument()
    expect(host.api.connect).not.toHaveBeenCalled()
    fireEvent.click(within(provider).getByTestId('adapt-connect'))
    await waitFor(() => expect(host.api.connect).toHaveBeenCalledOnce())
    await within(dialog()).findByText('Waiting for your sign-in in the browser…')
    expect(host.api.send).not.toHaveBeenCalled()
  })
})
