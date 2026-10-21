// A Save always sends the words shown. The recipe's fields are held from Save through the note's
// preparation and the send until the Save is answered; a refused Save releases them, and a host
// form that does not hold itself can never have newer words dropped by a Save already preparing.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { E2_HOST_CAPABILITIES, type FormAnswers } from '../extensions/extensionContract'
import { createExtensionController, type OpenTarget } from '../extensions/extensionSessionController'
import { deferred, fakeRegistry, packageOf } from '../extensions/extensions.test-utils'
import { translator } from '../extensions/extensionUiText'
import websitePackage from '../extensions/fixtures/website-capture.json?raw'
import type { CreateProposal, ProposalReceipt } from '../proposals/proposalContract'
import { CAPTURED_AT, fixture } from './webCapture.test-utils'
import { composeWebCaptureNote } from './webCaptureComposition'
import { WebCaptureDialog, type WebCaptureSaveOutcome } from './WebCaptureDialog'
import { createWebCaptureFlow } from './webCaptureFlow'
import { webCaptureLabels } from './webCaptureLocale'
import { WebCaptureRunDialog } from './WebCaptureRunDialog'
import type { WebCaptureFetchOutcome, WebCaptureTransport } from './webCaptureTransport'

vi.mock('../../utils/macosDismissableEscapeSurface', () => ({
  registerMacosDismissableEscapeSurface: () => () => {},
  useMacosDismissableEscapeSurfaceRef: (ref: unknown) => ref ?? (() => {}),
}))

/** Holds every whole-note preparation (the preview's and Save's own) until released; can refuse. */
const gate = vi.hoisted(() => ({ held: null as Promise<void> | null, release: () => {}, refuse: false }))
vi.mock('./webCaptureNote', async importOriginal => {
  const actual = await importOriginal<typeof import('./webCaptureNote')>()
  return {
    ...actual,
    prepareWebCaptureNote: async (...args: Parameters<typeof actual.prepareWebCaptureNote>) => {
      if (gate.held) await gate.held
      return gate.refuse ? { status: 'refused' as const, reason: 'tooLarge' as const } : actual.prepareWebCaptureNote(...args)
    },
  }
})
function hold() {
  gate.held = new Promise(resolve => { gate.release = () => { gate.held = null; resolve() } })
}

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.scrollIntoView ??= () => {}
})
afterEach(() => { gate.release(); gate.held = null; gate.refuse = false; vi.restoreAllMocks() })

const VAULT = '/vault'
const KEY = 'local.website-capture/save-page'
const FINAL = 'https://fixtures.leadinglight.invalid/2026/lighthouse-log'
const t = translator('en')
const LABELS = webCaptureLabels(t, () => t('leadinglight.extensions.rootFolder'))
const FOLDERS = [{ path: '', label: t('leadinglight.extensions.rootFolder') }]

const transport = (): WebCaptureTransport => ({
  fetch: vi.fn(async (attemptId: string, url: string): Promise<WebCaptureFetchOutcome> => ({
    status: 'fetched', attemptId, requestedUrl: url, finalUrl: FINAL, fetchedAt: CAPTURED_AT, contentType: 'text/html', encoding: 'UTF-8',
    encodingSource: 'header', html: fixture('article'), hadReplacements: false,
  })),
  cancel: vi.fn(async (attemptId: string) => ({ status: 'cancelled' as const, attemptId })),
})
const newFlow = () => {
  let attempt = 0
  return createWebCaptureFlow({ transport: transport(), newAttemptId: () => `0000000${attempt++}-0000-4000-8000-000000000000`, now: () => new Date(Date.UTC(2026, 9, 20, 15)) })
}

async function mount() {
  const registry = fakeRegistry([await packageOf([websitePackage], 'newest')], VAULT)
  const controller = createExtensionController({ api: registry.transport, hostCapabilities: [...E2_HOST_CAPABILITIES, 'web.capture'] })
  controller.enter(VAULT)
  await controller.refresh()
  const target: OpenTarget = { beforeWrite: vi.fn(), committed: vi.fn(), open: vi.fn(async () => true) }
  const onClose = vi.fn()
  render(<WebCaptureRunDialog locale="en" labels={LABELS} controller={controller} opening={controller.openRun(KEY)!} target={target} flow={newFlow()}
    folders={FOLDERS} initialFolder="" findSavedCopies={() => ({ status: 'complete', matches: [] })} pageExists={() => false}
    onOutcome={vi.fn()} onOpenSaved={vi.fn()} onOpenInBrowser={vi.fn()} onRemember={vi.fn()} onNotice={vi.fn()} onClose={onClose} />)
  return { registry, onClose }
}

async function fetchPage() {
  fireEvent.change(screen.getByTestId('web-capture-address'), { target: { value: 'fixtures.leadinglight.invalid/lighthouse' } })
  fireEvent.click(screen.getByTestId('web-capture-fetch'))
  await waitFor(() => expect(screen.getByTestId('web-capture-dialog').dataset.stage).toBe('page'), { timeout: 8000 })
}
const why = () => screen.getByLabelText('Why I saved this') as HTMLTextAreaElement
const step = () => screen.getByTestId('web-capture-dialog').dataset.step
const sentContents = (registry: Awaited<ReturnType<typeof mount>>['registry']) =>
  registry.api.submitProposal.mock.calls.map(([proposal]) => (proposal as CreateProposal).content)
async function previewShows(text: string) {
  await waitFor(() => expect(within(screen.getByTestId('web-capture-preview')).getByTestId('template-preview').textContent).toContain(text), { timeout: 8000 })
}

describe('Save holds the recipe form', () => {
  it('from the click through a deferred preparation and the send, so the words sent are the words shown', async () => {
    const { registry, onClose } = await mount()
    await fetchPage()
    hold()
    fireEvent.change(why(), { target: { value: 'First words' } })
    // Saved before the note for these words was prepared: Save prepares it itself, held.
    fireEvent.click(screen.getByTestId('web-capture-save'))
    expect(step()).toBe('saving')
    expect(why()).toHaveAttribute('readonly')
    fireEvent.change(why(), { target: { value: 'First words, and later ones' } })
    expect(why().value).toBe('First words')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    // The send itself is slow too: the form stays held until it is answered.
    const reply = deferred<ProposalReceipt | null>()
    registry.api.submitProposal.mockImplementationOnce(async proposal => { await reply.promise; return registry.committedFor(proposal as CreateProposal) })
    await act(async () => { gate.release() })
    await waitFor(() => expect(registry.api.submitProposal).toHaveBeenCalledTimes(1), { timeout: 8000 })
    fireEvent.change(why(), { target: { value: 'Words typed while sending' } })
    expect(why().value).toBe('First words')
    expect(why()).toHaveAttribute('readonly')
    await act(async () => { reply.resolve(null) })
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true), { timeout: 8000 })

    const [content] = sentContents(registry)
    expect(content).toContain('\n## My notes\n\nFirst words\n')
    expect(content).not.toContain('later ones')
    expect(content).not.toContain('while sending')
  })

  it('releases the form when preparation refuses, and the next Save sends the newer words once', async () => {
    const { registry } = await mount()
    await fetchPage()
    hold()
    gate.refuse = true
    fireEvent.change(why(), { target: { value: 'First' } })
    fireEvent.click(screen.getByTestId('web-capture-save'))
    expect(why()).toHaveAttribute('readonly')
    await act(async () => { gate.release() })
    await waitFor(() => expect(step()).toBe('editing'))
    expect(screen.getByTestId('web-capture-dialog').textContent).toContain(t('leadinglight.extensions.notWritten.tooLarge'))
    expect(why()).not.toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(registry.api.beginRun).not.toHaveBeenCalled()

    gate.refuse = false
    fireEvent.change(why(), { target: { value: 'Second, kept' } })
    expect(why().value).toBe('Second, kept')
    await previewShows('Second, kept')
    await act(async () => { fireEvent.click(screen.getByTestId('web-capture-save')) })
    await waitFor(() => expect(registry.api.submitProposal).toHaveBeenCalledTimes(1), { timeout: 8000 })
    expect(sentContents(registry)[0]).toContain('\n## My notes\n\nSecond, kept\n')
  })

  it('releases the form when the run proves nothing was written, and the retry sends the newer words', async () => {
    const { registry } = await mount()
    await fetchPage()
    registry.api.bindFolder.mockImplementationOnce(async () => ({ status: 'refused', reason: 'missing' }))
    fireEvent.change(why(), { target: { value: 'First' } })
    await previewShows('First')
    await act(async () => { fireEvent.click(screen.getByTestId('web-capture-save')) })
    await waitFor(() => expect(step()).toBe('editing'), { timeout: 8000 })
    expect(screen.getByTestId('web-capture-dialog').textContent).toContain(t('leadinglight.extensions.notWritten.folderMissing'))
    expect(registry.api.submitProposal).not.toHaveBeenCalled()
    expect(why()).not.toHaveAttribute('readonly')

    fireEvent.change(why(), { target: { value: 'First, then more' } })
    await previewShows('First, then more')
    await act(async () => { fireEvent.click(screen.getByTestId('web-capture-save')) })
    await waitFor(() => expect(registry.api.submitProposal).toHaveBeenCalledTimes(1), { timeout: 8000 })
    expect(sentContents(registry)[0]).toContain('\n## My notes\n\nFirst, then more\n')
  })
})

describe('a host form that does not hold itself', () => {
  const command = (() => {
    const parsed = JSON.parse(websitePackage) as { commands: Parameters<typeof composeWebCaptureNote>[0][] }
    return parsed.commands[0]
  })()

  function Host({ save }: { save: (packageParts: readonly string[]) => Promise<WebCaptureSaveOutcome> }) {
    const [text, setText] = useState('')
    const answers: FormAnswers = { why: text === '' ? null : text }
    return <WebCaptureDialog labels={LABELS} locale="en" commandTitle={command.title} flow={flow}
      folders={FOLDERS} initialFolder=""
      form={<textarea aria-label="why" value={text} onChange={event => setText(event.target.value)} />}
      formDirty={text !== ''} checkForm={() => true}
      composeNote={webPage => composeWebCaptureNote(command, answers, webPage)}
      findSavedCopies={() => ({ status: 'complete', matches: [] })} pageExists={() => false}
      save={request => save(request.packageParts)} checkAgain={vi.fn()}
      revocation={{ subscribe: () => () => {}, reason: () => null }}
      onOpenSaved={vi.fn()} onOpenInBrowser={vi.fn()} onRemember={vi.fn()} onNotice={vi.fn()} onClose={vi.fn()} />
  }
  let flow = newFlow()

  it('never has newer words dropped: the prepared Save sends nothing and they stay to save', async () => {
    flow = newFlow()
    const save = vi.fn<(packageParts: readonly string[]) => Promise<WebCaptureSaveOutcome>>(async () => ({ status: 'idle' }))
    render(<Host save={save} />)
    await fetchPage()
    const field = screen.getByLabelText('why') as HTMLTextAreaElement
    hold()
    fireEvent.change(field, { target: { value: 'First' } })
    fireEvent.click(screen.getByTestId('web-capture-save'))
    expect(step()).toBe('saving')
    fireEvent.change(field, { target: { value: 'First and newer' } })
    await act(async () => { gate.release() })
    await waitFor(() => expect(step()).toBe('editing'), { timeout: 8000 })
    expect(save).not.toHaveBeenCalled()
    expect(field.value).toBe('First and newer')

    await previewShows('First and newer')
    await act(async () => { fireEvent.click(screen.getByTestId('web-capture-save')) })
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 8000 })
    expect(save.mock.calls[0][0]).toContain('First and newer')
  })
})
