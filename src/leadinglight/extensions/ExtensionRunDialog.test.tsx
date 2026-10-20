import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildNewEntry, type OpenReservation } from '../../hooks/useNoteCreation'
import type { VaultEntry } from '../../types'
import type { CreateProposal } from '../proposals/proposalContract'
import { ExtensionHarness } from './ExtensionHarness.test-utils'
import { deferred, fakeRegistry, fakeReservation, fixtureText, packageOf, VAULT } from './extensions.test-utils'
import type { ExtensionController } from './extensionSessionController'

vi.mock('./extensionMarkdownText', async () => (await import('./extensionEncoder.test-utils')).encoderStandIn())
vi.mock('../../utils/macosDismissableEscapeSurface', () => ({
  registerMacosDismissableEscapeSurface: () => () => {},
  useMacosDismissableEscapeSurfaceRef: (ref: unknown) => ref ?? (() => {}),
}))

beforeAll(() => {
  // Radix Select needs these in jsdom.
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})
beforeEach(() => localStorage.clear())

const MEETING = fixtureText('meeting-debrief.json')
const KEY = 'local.meeting-debrief/new-debrief'
/** A custom package from data alone: two commands, other questions, another layout. */
const DAILY = JSON.stringify({
  schema: 'leadinglight.extension/1', id: 'local.daily-debrief', version: '1.0.0', name: 'Daily debrief',
  description: 'Two quick reflections at the end of the day.', capabilities: ['document.create'],
  commands: [
    { id: 'evening', title: 'Evening reflection', steps: [
      { id: 'form', op: 'collectForm', fields: [{ id: 'win', kind: 'text', label: 'One win', required: true }] },
      { id: 'where', op: 'resolveDestination', policy: 'newInChosenFolder' },
      { id: 'note', op: 'composeDocument', title: ['Evening: ', { step: 'form', field: 'win' }],
        blocks: [{ type: 'quote', text: [{ step: 'form', field: 'win' }] }, { type: 'list', style: 'numbered', items: [['Rest'], ['Plan tomorrow']] }] },
      { id: 'save', op: 'proposeDocument' },
    ] },
    { id: 'morning', title: 'Morning intention', steps: [
      { id: 'form', op: 'collectForm', fields: [{ id: 'focus', kind: 'text', label: 'Focus', required: true }] },
      { id: 'where', op: 'resolveDestination', policy: 'newInChosenFolder' },
      { id: 'note', op: 'composeDocument', title: ['Morning: ', { step: 'form', field: 'focus' }], blocks: [{ type: 'heading', level: 3, text: ['Intention'] }] },
      { id: 'save', op: 'proposeDocument' },
    ] },
  ],
}, null, 2)

async function mount(options: { extra?: string[]; reservation?: OpenReservation; remembered?: string } = {}) {
  const packages = [await packageOf([MEETING], 'newest'), ...await Promise.all((options.extra ?? []).map(text => packageOf([text], 'newest')))]
  const registry = fakeRegistry(packages)
  const controller = registry.controller()
  if (options.remembered) localStorage.setItem(`leadinglight.extensionFolders:${VAULT}`, JSON.stringify({ [KEY]: options.remembered }))
  const notify = vi.fn()
  render(<ExtensionHarness controller={controller} reservation={options.reservation} notify={notify}
    folders={[{ name: 'Meetings', path: 'Meetings', children: [] }]}>
    {ui => <button type="button" disabled={!ui.hasRunnable} onClick={ui.openFromExtension}>From extension…</button>}
  </ExtensionHarness>)
  const opener = screen.getByRole('button', { name: 'From extension…' })
  await waitFor(() => expect(opener).toBeEnabled())
  return { registry, controller, opener, notify }
}

async function openRun(opener: HTMLElement) {
  opener.focus()
  fireEvent.click(opener)
  return screen.findByTestId('extension-run-dialog')
}

const type = (dialog: HTMLElement, label: string, value: string) =>
  fireEvent.change(within(dialog).getByLabelText(label, { exact: false }), { target: { value } })
const create = (dialog: HTMLElement) => act(async () => { fireEvent.click(within(dialog).getByTestId('extension-run-create')) })

describe('From extension…', () => {
  it('opens the only runnable command directly, focuses its first field and shows the exact destination', async () => {
    const { opener } = await mount({ remembered: 'Meetings' })
    const dialog = await openRun(opener)
    expect(within(dialog).getByRole('heading', { name: 'New meeting debrief' })).toBeInTheDocument()
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByLabelText('Meeting', { exact: false })))
    type(dialog, 'Meeting', 'Weekly sync')
    expect(within(dialog).getByTestId('extension-destination')).toHaveTextContent('Will create Meetings/debrief-weekly-sync.md')
    expect(within(dialog).getByText('Debrief: Weekly sync', { selector: 'h1' })).toBeInTheDocument()
  })

  it('offers a chooser when several commands can run, including two from one custom package', async () => {
    const { opener } = await mount({ extra: [DAILY] })
    fireEvent.click(opener)
    const chooser = await screen.findByTestId('extension-chooser')
    expect(within(chooser).getAllByTestId('extension-choice').map(row => row.dataset.key)).toEqual([
      KEY, 'local.daily-debrief/evening', 'local.daily-debrief/morning',
    ])
    fireEvent.click(within(chooser).getAllByTestId('extension-choice')[1])
    const dialog = await screen.findByTestId('extension-run-dialog')
    expect(within(dialog).getByRole('heading', { name: 'Evening reflection' })).toBeInTheDocument()
  })

  it('creates a materially different note from the custom package’s own data', async () => {
    const { opener, registry } = await mount({ extra: [DAILY] })
    fireEvent.click(opener)
    fireEvent.click(within(await screen.findByTestId('extension-chooser')).getAllByTestId('extension-choice')[1])
    const dialog = await screen.findByTestId('extension-run-dialog')
    type(dialog, 'One win', 'Shipped the fix')
    await create(dialog)
    await waitFor(() => expect(registry.api.submitProposal).toHaveBeenCalledOnce())
    const proposal = registry.api.submitProposal.mock.calls[0][0] as CreateProposal
    expect(proposal.fileName).toBe('evening-shipped-the-fix.md')
    expect(proposal.content).toBe('# Evening: Shipped the fix\n\n> Shipped the fix\n\n1. Rest\n2. Plan tomorrow\n')
  })
})

describe('the run form', () => {
  it('keeps answers on a required-field error, says which field and asks native nothing', async () => {
    const { opener, registry } = await mount()
    const dialog = await openRun(opener)
    type(dialog, 'Who was there', 'Ana and Ben')
    await create(dialog)
    const meeting = within(dialog).getByLabelText('Meeting', { exact: false })
    expect(meeting).toHaveAttribute('aria-invalid', 'true')
    expect(document.getElementById(meeting.getAttribute('aria-describedby')!)).toHaveTextContent('Answer this before creating.')
    expect(within(dialog).getByTestId('extension-run-status')).toHaveTextContent('Some answers need attention.')
    await waitFor(() => expect(document.activeElement).toBe(meeting))
    expect(within(dialog).getByLabelText('Who was there', { exact: false })).toHaveValue('Ana and Ben')
    expect(within(dialog).getByTestId('extension-run-create')).toBeEnabled()
    expect(registry.api.openSession).not.toHaveBeenCalled()
  })

  it('writes the chosen option and a yes answer, submitted with ⌘Enter', async () => {
    const { opener, registry } = await mount()
    const dialog = await openRun(opener)
    type(dialog, 'Meeting', 'Planning')
    type(dialog, 'Decisions', 'Go')
    fireEvent.click(within(dialog).getByRole('switch'))
    fireEvent.keyDown(within(dialog).getByLabelText('How did it go?'), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('option', { name: 'Went well' }))
    expect(within(dialog).getByText('Revisit this next week.')).toBeInTheDocument()
    await act(async () => { fireEvent.keyDown(within(dialog).getByLabelText('Decisions', { exact: false }), { key: 'Enter', metaKey: true }) })
    await waitFor(() => expect(screen.queryByTestId('extension-run-dialog')).not.toBeInTheDocument())
    const proposal = registry.api.submitProposal.mock.calls[0][0] as CreateProposal
    expect(proposal.content).toContain('- Mood: Went well')
    expect(proposal.content).toContain('Revisit this next week.')
    expect(registry.api.beginRun).toHaveBeenCalledOnce()
  })

  it('on a name collision keeps answers, names the file and folder, and retries only on Create', async () => {
    const { opener, registry } = await mount()
    registry.api.submitProposal.mockImplementationOnce(async proposal => ({ status: 'conflict', operationId: proposal.operationId, reason: 'exists' }))
    const dialog = await openRun(opener)
    type(dialog, 'Meeting', 'Weekly sync')
    type(dialog, 'Decisions', 'Ship it')
    await create(dialog)
    const destination = within(dialog).getByTestId('extension-destination')
    await waitFor(() => expect(destination).toHaveAttribute('role', 'alert'))
    expect(destination).toHaveTextContent('A note named “debrief-weekly-sync.md” already exists in Workspace folder.')
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByLabelText('Meeting', { exact: false })))
    expect(within(dialog).getByLabelText('Decisions', { exact: false })).toHaveValue('Ship it')
    expect(registry.api.beginRun).toHaveBeenCalledOnce()
    type(dialog, 'Meeting', 'Weekly sync 2')
    await create(dialog)
    await waitFor(() => expect(screen.queryByTestId('extension-run-dialog')).not.toBeInTheDocument())
    const [first, second] = registry.api.submitProposal.mock.calls.map(([proposal]) => proposal as CreateProposal)
    expect(second.operationId).not.toBe(first.operationId)
    expect(second.fileName).toBe('debrief-weekly-sync-2.md')
  })

  it('after a lost reply offers only Check again for the same operation, and never a second write', async () => {
    const { opener, registry } = await mount()
    registry.api.submitProposal.mockResolvedValueOnce(null)
    const dialog = await openRun(opener)
    type(dialog, 'Meeting', 'Weekly sync')
    type(dialog, 'Decisions', 'Ship it')
    await create(dialog)
    expect(await within(dialog).findByTestId('extension-run-check')).toHaveTextContent('Check again')
    expect(within(dialog).queryByTestId('extension-run-create')).not.toBeInTheDocument()
    expect(within(dialog).getByTestId('extension-run-status')).toHaveTextContent('We couldn’t confirm the note was created.')
    expect(within(dialog).getByTestId('extension-run-status')).toHaveTextContent('If it was created, it is debrief-weekly-sync.md.')
    const proposal = registry.api.submitProposal.mock.calls[0][0] as CreateProposal
    registry.api.queryProposal.mockResolvedValueOnce({ status: 'running', operationId: proposal.operationId })
    await act(async () => { fireEvent.keyDown(within(dialog).getByLabelText('Meeting', { exact: false }), { key: 'Enter', metaKey: true }) })
    await waitFor(() => expect(within(dialog).getByTestId('extension-run-status')).toHaveAttribute('data-detail', 'running'))
    registry.api.queryProposal.mockResolvedValueOnce(registry.committedFor(proposal))
    await act(async () => { fireEvent.click(within(dialog).getByTestId('extension-run-check')) })
    await waitFor(() => expect(screen.queryByTestId('extension-run-dialog')).not.toBeInTheDocument())
    expect(registry.api.submitProposal).toHaveBeenCalledOnce()
    expect(registry.api.beginRun).toHaveBeenCalledOnce()
    expect(registry.api.queryProposal.mock.calls.map(([args]) => args.operationId)).toEqual([proposal.operationId, proposal.operationId])
  })

  it('shows a revoked form with its answers to copy once the extension is turned off', async () => {
    const { opener, controller, registry } = await mount()
    const dialog = await openRun(opener)
    type(dialog, 'Meeting', 'Weekly sync')
    await act(async () => { await disable(controller) })
    await waitFor(() => expect(within(dialog).getByTestId('extension-run-status'))
      .toHaveTextContent('This extension was turned off or changed, so this form can’t be submitted. Your answers stay here to copy.'))
    expect(within(dialog).getByLabelText('Meeting', { exact: false })).toHaveValue('Weekly sync')
    expect(within(dialog).queryByTestId('extension-run-create')).not.toBeInTheDocument()
    expect(within(dialog).getByTestId('extension-run-close')).toBeInTheDocument()
    expect(registry.api.beginRun).not.toHaveBeenCalled()
  })

  it('places nothing when the extension is turned off while its page is still being placed', async () => {
    const gate = deferred<void>()
    const { reservation, open } = fakeReservation()
    open.mockImplementation(async (_entry, _content, stillWanted) => { await gate.promise; return stillWanted?.() ?? true })
    const { opener, controller } = await mount({ reservation })
    const dialog = await openRun(opener)
    type(dialog, 'Meeting', 'Weekly sync')
    type(dialog, 'Decisions', 'Ship it')
    await create(dialog)
    await waitFor(() => expect(open).toHaveBeenCalledOnce())
    expect(open.mock.calls[0][2]).toBeTypeOf('function')
    await act(async () => { await disable(controller) })
    await act(async () => { gate.resolve() })
    await waitFor(() => expect(within(dialog).getByTestId('extension-run-status'))
      .toHaveTextContent('Created debrief-weekly-sync.md, but it couldn’t be opened here. Find it in All Notes.'))
  })

  it('asks before discarding typed answers on Escape, and closes at once when there are none', async () => {
    const { opener } = await mount()
    const dialog = await openRun(opener)
    type(dialog, 'Meeting', 'Weekly sync')
    fireEvent.keyDown(within(dialog).getByLabelText('Meeting', { exact: false }), { key: 'Escape' })
    const notice = within(dialog).getByTestId('extension-discard')
    expect(notice).toHaveTextContent('Discard your answers?')
    fireEvent.click(within(notice).getByRole('button', { name: 'Keep editing' }))
    expect(within(dialog).getByLabelText('Meeting', { exact: false })).toHaveValue('Weekly sync')
    type(dialog, 'Meeting', '')
    fireEvent.keyDown(within(dialog).getByLabelText('Meeting', { exact: false }), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('extension-run-dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(document.activeElement).toBe(opener))
  })

  it('keeps the destination in the form and puts the preview behind Show preview when compact', async () => {
    const { opener } = await mount()
    const dialog = await openRun(opener)
    const toggle = within(dialog).getByRole('button', { name: 'Show preview' })
    const preview = document.getElementById(toggle.getAttribute('aria-controls')!)!
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(preview).toHaveAttribute('data-open', 'false')
    fireEvent.click(toggle)
    expect(within(dialog).getByRole('button', { name: 'Hide preview' })).toHaveAttribute('aria-expanded', 'true')
    expect(preview).toHaveAttribute('data-open', 'true')
    expect(within(dialog).getByTestId('extension-destination').closest('.ll-ext-run-form')).not.toBeNull()
  })
})

describe('the destination line after a write', () => {
  const FILE = 'qa-capture-2026-10-20.md'

  async function mountQuick(entries: VaultEntry[] = []) {
    const registry = fakeRegistry([await packageOf([fixtureText('quick-note.json')], 'newest')])
    render(<ExtensionHarness controller={registry.controller()} entries={entries}>
      {ui => <button type="button" disabled={!ui.hasRunnable} onClick={ui.openFromExtension}>From extension…</button>}
    </ExtensionHarness>)
    const opener = screen.getByRole('button', { name: 'From extension…' })
    await waitFor(() => expect(opener).toBeEnabled())
    return { registry, opener }
  }

  it('says only Created once a save-only note enters the listing, and warns about it on the next draft', async () => {
    const { registry, opener } = await mountQuick()
    let dialog = await openRun(opener)
    type(dialog, 'Topic', 'QA capture 2026-10-20')
    expect(within(dialog).getByTestId('extension-destination')).toHaveTextContent(`Will create ${FILE}`)
    await create(dialog)
    await waitFor(() => expect(within(dialog).getByTestId('extension-run-status')).toHaveTextContent(`Created ${FILE}.`))
    // The saved note is now listed, so pageExists is true for this path; it is not a failed write.
    expect(dialog).not.toHaveTextContent('already exists')
    expect(dialog).not.toHaveTextContent('Change the name')
    expect(within(dialog).queryByTestId('extension-destination')).not.toBeInTheDocument()
    expect(registry.api.submitProposal).toHaveBeenCalledOnce()
    fireEvent.click(within(dialog).getByTestId('extension-run-done'))
    await waitFor(() => expect(screen.queryByTestId('extension-run-dialog')).not.toBeInTheDocument())

    // A new draft for the same name is told, before Create, that the note now exists.
    dialog = await openRun(opener)
    type(dialog, 'Topic', 'QA capture 2026-10-20')
    expect(within(dialog).getByTestId('extension-destination')).toHaveTextContent(`A note named “${FILE}” already exists in Workspace folder.`)
  })

  it('keeps an unresolved write’s own status, without a name-change hint, when the page is already listed', async () => {
    const listed = buildNewEntry({ path: `${VAULT}/${FILE}`, slug: FILE.replace(/\.md$/, ''), title: 'QA capture 2026-10-20', type: 'Note', status: null })
    const { registry, opener } = await mountQuick([listed])
    registry.api.submitProposal.mockResolvedValueOnce(null)
    const dialog = await openRun(opener)
    type(dialog, 'Topic', 'QA capture 2026-10-20')
    expect(within(dialog).getByTestId('extension-destination')).toHaveTextContent('already exists')
    await create(dialog)
    await waitFor(() => expect(within(dialog).getByTestId('extension-run-check')).toBeInTheDocument())
    expect(within(dialog).getByTestId('extension-run-status')).toHaveTextContent(`If it was created, it is ${FILE}.`)
    expect(dialog).not.toHaveTextContent('already exists')
    expect(within(dialog).queryByTestId('extension-run-create')).not.toBeInTheDocument()
    expect(registry.api.submitProposal).toHaveBeenCalledOnce()
  })
})

async function disable(controller: ExtensionController) {
  const snapshot = controller.snapshot()
  if (snapshot.status !== 'ready') throw new Error(snapshot.status)
  const view = snapshot.packages.find(item => item.packageId === 'local.meeting-debrief')!
  await controller.deactivate(view.packageId, view.activeSha256!)
}
