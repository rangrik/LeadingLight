import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { FormField } from '../extensions/extensionContract'
import { CommentaryDialog, type CommentaryChoice, type CommentaryDestinations, type CommentaryRunView, type CommentarySubmit } from './CommentaryDialog'

vi.mock('../extensions/extensionMarkdownText', async () => (await import('../extensions/extensionEncoder.test-utils')).encoderStandIn())
vi.mock('../../utils/macosDismissableEscapeSurface', () => ({
  registerMacosDismissableEscapeSurface: () => () => {},
  useMacosDismissableEscapeSurfaceRef: (ref: unknown) => ref ?? (() => {}),
}))

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})

const FIELDS: FormField[] = [
  { kind: 'multilineText', id: 'thought', label: 'Your thoughts', required: false },
  { kind: 'text', id: 'question', label: 'A question to come back to', required: false },
]
const QUOTE = 'Line one <b>not bold</b> [[link]]\nLine two'

function fakeRun(options: { destinations?: CommentaryDestinations; submit?: (choice: CommentaryChoice) => Promise<CommentarySubmit> } = {}) {
  let destinations: CommentaryDestinations = options.destinations ?? { status: 'ready', options: [], incomplete: false, initial: { kind: 'create', separate: false } }
  const listeners = new Set<() => void>()
  const run: CommentaryRunView & { setDestinations: (next: CommentaryDestinations) => void } = {
    commandTitle: 'Comment on passage',
    quote: QUOTE,
    fields: FIELDS,
    destinations: () => destinations,
    createName: (_answers, separate) => ({ title: separate ? 'Commentary on Source 2' : 'Commentary on Source', taken: false }),
    paneEffect: choice => (choice.kind === 'append' ? { kind: 'shown' } : { kind: 'replaces', page: 'Other page' }),
    preview: () => ({ markdown: '> Line one\n\nMy thought\n', problems: [] }),
    submit: vi.fn(async (_answers, choice) => options.submit?.(choice) ?? { status: 'shown' as const }),
    checkAgain: vi.fn(async () => ({ status: 'shown' as const })),
    revoked: () => null,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    close: vi.fn(),
    setDestinations(next) { destinations = next; for (const listener of listeners) listener() },
  }
  return run
}

function mount(run: CommentaryRunView) {
  const onClose = vi.fn()
  render(<CommentaryDialog locale="en" run={run} onClose={onClose} />)
  return { onClose }
}

describe('the commentary dialog', () => {
  it('shows the exact passage as plain text, focuses Your thoughts and names the destination and pane effect', () => {
    mount(fakeRun())
    expect(screen.getByTestId('commentary-passage').textContent).toBe(QUOTE)
    expect(screen.getByTestId('commentary-passage').querySelector('b, a')).toBeNull()
    expect(screen.getByLabelText('Your thoughts')).toHaveFocus()
    expect(screen.getByText('Will create Commentary on Source beside this page.')).toBeInTheDocument()
    expect(screen.getByTestId('commentary-pane-effect')).toHaveTextContent('Opens beside this page, in place of Other page (saved first).')
    expect(screen.getByTestId('commentary-submit')).toHaveTextContent('Create')
  })

  it('waits for the local search before offering Add, then names the one linked note', () => {
    const run = fakeRun({ destinations: { status: 'loading' } })
    mount(run)
    expect(screen.getByTestId('commentary-destination')).toHaveTextContent('Checking for notes linked to this page…')
    expect(screen.getByTestId('commentary-submit')).toBeDisabled()
    act(() => run.setDestinations({ status: 'ready', options: [{ path: '/v/c.md', title: 'Commentary on Source' }], incomplete: false, initial: { kind: 'append', path: '/v/c.md' } }))
    expect(screen.getByText('Will add to Commentary on Source.')).toBeInTheDocument()
    expect(screen.getByTestId('commentary-pane-effect')).toHaveTextContent('Already open beside this page.')
    expect(screen.getByTestId('commentary-submit')).toHaveTextContent('Add')
  })

  it('lists several linked notes for explicit review, with a separate note last', async () => {
    mount(fakeRun({ destinations: { status: 'ready', incomplete: false, initial: { kind: 'append', path: '/v/b.md' },
      options: [{ path: '/v/b.md', title: 'Commentary B' }, { path: '/v/a.md', title: 'Commentary A' }] } }))
    expect(screen.getByLabelText('Add to')).toHaveTextContent('Commentary B')
    fireEvent.click(screen.getByLabelText('Add to'))
    const items = await screen.findAllByRole('option')
    expect(items.map(item => item.textContent)).toEqual(['Commentary B', 'Commentary A', 'New separate note'])
  })

  it('submits the answers and the chosen destination with Command-Enter, and closes once the note is shown', async () => {
    const run = fakeRun()
    const { onClose } = mount(run)
    fireEvent.change(screen.getByLabelText('Your thoughts'), { target: { value: 'My thought' } })
    fireEvent.keyDown(screen.getByLabelText('Your thoughts'), { key: 'Enter', metaKey: true })
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true))
    expect(run.submit).toHaveBeenCalledWith({ thought: 'My thought', question: '' }, { kind: 'create', separate: false }, expect.any(Function))
  })

  it('asks before discarding typed thoughts, and keeps them on Keep editing', () => {
    const run = fakeRun()
    const { onClose } = mount(run)
    fireEvent.change(screen.getByLabelText('Your thoughts'), { target: { value: 'Words' } })
    fireEvent.keyDown(screen.getByTestId('commentary-dialog'), { key: 'Escape' })
    expect(screen.getByTestId('commentary-discard')).toHaveTextContent('Discard your thoughts?')
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByLabelText('Your thoughts')).toHaveValue('Words')
    fireEvent.keyDown(screen.getByTestId('commentary-dialog'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(run.close).toHaveBeenCalledWith('cancelled')
    expect(onClose).toHaveBeenCalledWith(false)
  })

  it('offers a separate note when the name is taken by an unlinked note, keeping the thoughts', async () => {
    const run = fakeRun({ submit: async choice => (choice.kind === 'create' && !choice.separate
      ? { status: 'notWritten', reason: 'exists', title: 'Commentary on Source' } : { status: 'shown' }) })
    mount(run)
    fireEvent.change(screen.getByLabelText('Your thoughts'), { target: { value: 'Kept' } })
    fireEvent.click(screen.getByTestId('commentary-submit'))
    expect(await screen.findByTestId('commentary-status')).toHaveTextContent('already exists beside this page but isn’t linked to it. Nothing was written.')
    fireEvent.click(screen.getByTestId('commentary-use-separate'))
    expect(screen.getByText('Will create a new note, Commentary on Source 2, beside this page.')).toBeInTheDocument()
    expect(screen.getByLabelText('Your thoughts')).toHaveValue('Kept')
  })

  it('turns an unknown reply into Check again, never into a second Add', async () => {
    const run = fakeRun({ submit: async () => ({ status: 'uncertain', detail: 'noReply' }) })
    const { onClose } = mount(run)
    fireEvent.click(screen.getByTestId('commentary-submit'))
    expect(await screen.findByTestId('commentary-check')).toHaveTextContent('Check again')
    expect(screen.queryByTestId('commentary-submit')).toBeNull()
    fireEvent.click(screen.getByTestId('commentary-check'))
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true))
    expect(run.submit).toHaveBeenCalledTimes(1)
    expect(run.checkAgain).toHaveBeenCalledTimes(1)
  })

  it('reports a committed note it could not open, with Done only', async () => {
    const run = fakeRun({ submit: async () => ({ status: 'notShown', kind: 'append', title: 'Commentary on Source' }) })
    mount(run)
    fireEvent.click(screen.getByTestId('commentary-submit'))
    expect(await screen.findByTestId('commentary-status')).toHaveTextContent('Added to Commentary on Source, but it couldn’t be opened here. Find it in All Notes.')
    fireEvent.click(screen.getByTestId('commentary-done'))
    expect(run.close).toHaveBeenCalledWith('done')
  })
})
