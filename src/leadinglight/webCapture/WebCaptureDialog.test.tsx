import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocumentProposal, ExtensionPackage, FormAnswers } from '../extensions/extensionContract'
import { runExtensionCommand } from '../extensions/extensionRecipe'
import { parseExtensionPackage } from '../extensions/extensionSchema'
import websitePackage from '../extensions/fixtures/website-capture.json?raw'
import type { ProposalReceipt } from '../proposals/proposalContract'
import { CAPTURED_AT, fixture, flat, open, textOf } from './webCapture.test-utils'
import { composeWebCaptureNote, webCaptureContentFor } from './webCaptureComposition'
import type { WebCaptureFetched } from './webCaptureContract'
import { findSavedCopies, savedSourceEntries } from './webCaptureDuplicates'
import { WebCaptureDialog, type WebCaptureSave, type WebCaptureSaveOutcome } from './WebCaptureDialog'
import { createWebCaptureFlow, type WebCaptureFlow } from './webCaptureFlow'
import type { WebCaptureLabels } from './webCaptureLabels'
import type { WebCaptureFetchOutcome, WebCaptureTransport } from './webCaptureTransport'

/**
 * The website dialog with a host made of the frozen domain itself: the bundled-style website recipe,
 * `runExtensionCommand` for the one review → proposal → open, and `webCaptureContentFor` as the
 * commit's bytes. The native fetch is a fake transport answering synthetic fixtures only.
 */

const extension = (() => {
  const parsed = parseExtensionPackage(websitePackage)
  if (parsed.status !== 'valid') throw new Error('website fixture invalid')
  return parsed.extension
})()
const command = extension.commands[0]
const FINAL = 'https://harbour.example.org/2026/10/lighthouse-log'

// Every visible string is a marked label, so no copy can be hiding in the component.
const mark = (key: string) => `«${key}»`
const LABELS: WebCaptureLabels = new Proxy({} as WebCaptureLabels, {
  get: (_target, key: string) => {
    if (key === 'failure') return new Proxy({}, { get: (_t, kind: string) => mark(`failure.${kind}`) })
    const functions = ['willFetch', 'fetching', 'pageReady', 'wasAddress', 'willCreate', 'exists', 'uncertain', 'uncertainWhere',
      'created', 'createdNotOpened', 'createdElsewhere', 'revoked', 'notWritten']
    if (key === 'savedBefore') return (copy: { title: string }) => mark(`savedBefore:${copy.title}`)
    if (functions.includes(key)) return (...values: unknown[]) => mark(`${key}:${values.join('|')}`)
    return mark(key)
  },
})

function fetched(attemptId: string, url: string, html = fixture('article'), finalUrl = FINAL): WebCaptureFetched {
  return { status: 'fetched', attemptId, requestedUrl: url, finalUrl, fetchedAt: CAPTURED_AT, contentType: 'text/html', encoding: 'UTF-8', encodingSource: 'header', html, hadReplacements: false }
}

function fakeTransport(answer: (attemptId: string, url: string) => Promise<WebCaptureFetchOutcome> | WebCaptureFetchOutcome) {
  const transport: WebCaptureTransport = {
    fetch: vi.fn(async (attemptId: string, url: string) => answer(attemptId, url)),
    cancel: vi.fn(async (attemptId: string) => ({ status: 'cancelled' as const, attemptId })),
  }
  return transport
}

function newFlow(transport: WebCaptureTransport): WebCaptureFlow {
  let attempt = 0
  return createWebCaptureFlow({ transport, newAttemptId: () => `0000000${attempt++}-0000-4000-8000-000000000000`, now: () => new Date(Date.UTC(2026, 9, 20, 15)) })
}

interface HostOptions {
  readonly receipt?: (proposal: DocumentProposal) => ProposalReceipt | 'uncertain'
  readonly savedSources?: readonly { path: string; title: string; source: string }[]
  readonly taken?: ReadonlySet<string>
  readonly revocation?: { listeners: Set<() => void>; reason: 'workspace' | 'package' | null }
}

/** A host whose save runs the domain's own single-proposal path. */
function createHost(options: HostOptions = {}) {
  const commits: { proposal: DocumentProposal; content: string | null }[] = []
  const saves: WebCaptureSave[] = []
  const calls = { onClose: vi.fn(), onOpenSaved: vi.fn(), onOpenInBrowser: vi.fn(), onRemember: vi.fn(), onNotice: vi.fn(), checkAgain: vi.fn() }
  const revocation = options.revocation ?? { listeners: new Set<() => void>(), reason: null }

  async function save(request: WebCaptureSave, answers: FormAnswers, ext: ExtensionPackage): Promise<WebCaptureSaveOutcome> {
    saves.push(request)
    const displayPath = [request.folder, request.fileName].filter(Boolean).join('/')
    const outcome = await runExtensionCommand(
      { extension: ext, commandId: command.id, runId: 'run-1', operationId: 'op-1', capture: null, hostCapabilities: ['document.create', 'document.open', 'web.capture'] },
      {
        liveness: () => 'live',
        review: async () => ({ action: 'submit', answers, destination: { kind: 'newInFolder', folderHandle: 'folder-1' }, webPage: request.webPage }),
        commit: async (proposal) => {
          const content = webCaptureContentFor(proposal.document, { page: request.webPage.page, fileName: request.fileName, prepared: request.prepared })
          commits.push({ proposal, content: content.status === 'ready' ? content.content : null })
          if (content.status !== 'ready') return { status: 'refused', operationId: proposal.operationId, reason: 'unsupported' }
          const receipt = options.receipt?.(proposal)
          if (receipt === 'uncertain') return { status: 'uncertain', operationId: proposal.operationId }
          return receipt ?? { status: 'committed', kind: 'create', operationId: proposal.operationId, path: `/vault/${displayPath}`, afterSha256: 'a'.repeat(64), durable: true, beforeSha256: null, undoReceipt: null }
        },
        open: async () => true,
      },
    )
    if (outcome.status === 'committed') return { status: 'opened', page: { displayPath }, durable: outcome.receipt.durable }
    if (outcome.status === 'uncertain') return { status: 'uncertain', attempt: { expected: { displayPath } }, detail: 'noReply' }
    if (outcome.status === 'notWritten') return { status: 'notWritten', reason: outcome.receipt.status === 'conflict' ? outcome.receipt.reason : 'internal' }
    return { status: 'notWritten', reason: 'internal' }
  }

  function Host({ flow }: { flow: WebCaptureFlow }) {
    const [why, setWhy] = useState('')
    const answers: FormAnswers = { why: why === '' ? null : why }
    const entries = savedSourceEntries((options.savedSources ?? []).map(entry => ({ path: entry.path, title: entry.title, properties: { source: entry.source } })))
    return <WebCaptureDialog labels={LABELS} locale="en" commandTitle={command.title} flow={flow}
      folders={[{ path: '', label: 'Workspace' }, { path: 'Reading', label: 'Reading' }]} initialFolder="Reading"
      form={<div className="ll-ext-field"><label htmlFor="why">{command.steps[1].op === 'collectForm' ? command.steps[1].fields[0].label : ''}</label>
        <textarea id="why" data-testid="why" value={why} onChange={event => setWhy(event.target.value)} /></div>}
      formDirty={why !== ''} checkForm={() => true}
      composeNote={webPage => composeWebCaptureNote(command, answers, webPage)}
      findSavedCopies={urls => findSavedCopies(urls, entries, { listingComplete: true })}
      pageExists={path => options.taken?.has(path) ?? false}
      save={request => save(request, answers, extension)}
      checkAgain={calls.checkAgain}
      revocation={{ subscribe: listener => { revocation.listeners.add(listener); return () => revocation.listeners.delete(listener) }, reason: () => revocation.reason }}
      onOpenSaved={calls.onOpenSaved} onOpenInBrowser={calls.onOpenInBrowser} onRemember={calls.onRemember} onNotice={calls.onNotice} onClose={calls.onClose} />
  }
  return { Host, commits, saves, calls, revocation }
}

function typeAddress(text: string) {
  fireEvent.change(screen.getByTestId('web-capture-address'), { target: { value: text } })
}

async function fetchReady(transport = fakeTransport((id, url) => fetched(id, url)), options: HostOptions = {}) {
  const host = createHost(options)
  const flow = newFlow(transport)
  render(<host.Host flow={flow} />)
  typeAddress('harbour.example.org/a')
  fireEvent.keyDown(screen.getByTestId('web-capture-address'), { key: 'Enter' })
  await waitFor(() => expect(screen.getByTestId('web-capture-dialog').dataset.stage).toBe('page'), { timeout: 8000 })
  return { host, flow, transport }
}

async function previewReady() {
  await waitFor(() => expect(within(screen.getByTestId('web-capture-preview')).queryByTestId('template-preview')).not.toBeNull(), { timeout: 8000 })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('stage A: the address', () => {
  it('only an explicit Fetch contacts the network; typing and pasting never do', async () => {
    const transport = fakeTransport((id, url) => fetched(id, url))
    const host = createHost()
    render(<host.Host flow={newFlow(transport)} />)
    const field = screen.getByTestId('web-capture-address')
    expect(document.activeElement).toBe(field)
    fireEvent.paste(field)
    typeAddress('harbour.example.org/a')
    fireEvent.blur(field)
    expect(transport.fetch).not.toHaveBeenCalled()
    expect(screen.getByTestId('web-capture-will-fetch').textContent).toBe(mark('willFetch:https://harbour.example.org/a'))
    expect(screen.getByTestId('web-capture-save')).toBeDisabled()
    fireEvent.click(screen.getByTestId('web-capture-fetch'))
    expect(transport.fetch).toHaveBeenCalledTimes(1)
    expect(transport.fetch).toHaveBeenCalledWith(expect.any(String), 'https://harbour.example.org/a')
    await waitFor(() => expect(screen.getByTestId('web-capture-dialog').dataset.stage).toBe('page'), { timeout: 8000 })
  })

  it('Escape while fetching stops that attempt and keeps the dialog and the address', async () => {
    let answer!: (value: WebCaptureFetchOutcome) => void
    const transport = fakeTransport(() => new Promise(resolve => { answer = resolve }))
    const host = createHost()
    render(<host.Host flow={newFlow(transport)} />)
    typeAddress('harbour.example.org/a')
    fireEvent.click(screen.getByTestId('web-capture-fetch'))
    expect(screen.getByTestId('web-capture-status').textContent).toBe(mark('fetching:harbour.example.org'))
    fireEvent.keyDown(screen.getByTestId('web-capture-dialog'), { key: 'Escape' })
    expect(transport.cancel).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('web-capture-status').textContent).toBe(mark('stopped'))
    await act(async () => { answer(fetched('00000000-0000-4000-8000-000000000000', 'https://harbour.example.org/a')) })
    expect(screen.getByTestId('web-capture-dialog').dataset.stage).toBe('address')
    expect((screen.getByTestId('web-capture-address') as HTMLInputElement).value).toBe('harbour.example.org/a')
    expect(host.calls.onClose).not.toHaveBeenCalled()
  })

  it('a page saved before is offered instead of fetching, and Fetch anyway fetches', async () => {
    const transport = fakeTransport((id, url) => fetched(id, url))
    const host = createHost({ savedSources: [{ path: '/vault/Reading/lighthouse.md', title: 'Lighthouse', source: 'https://harbour.example.org/a' }] })
    render(<host.Host flow={newFlow(transport)} />)
    typeAddress('harbour.example.org/a')
    fireEvent.click(screen.getByTestId('web-capture-fetch'))
    expect(transport.fetch).not.toHaveBeenCalled()
    expect(screen.getByTestId('web-capture-saved-before').textContent).toContain(mark('savedBefore:Lighthouse'))
    expect(screen.getByTestId('web-capture-fetch').textContent).toBe(mark('fetchAnyway'))
    fireEvent.click(screen.getByTestId('web-capture-open-saved'))
    expect(host.calls.onOpenSaved).toHaveBeenCalledWith('/vault/Reading/lighthouse.md')
    expect(host.calls.onClose).toHaveBeenCalledWith(false, 'cancel')
  })

  it('a failure keeps the address, explains it, and offers a link-only note and the browser where useful', async () => {
    const transport = fakeTransport(id => ({ status: 'failed', attemptId: id, reason: 'accessDenied' }))
    const host = createHost()
    const flow = newFlow(transport)
    render(<host.Host flow={flow} />)
    typeAddress('pages.example.org/members')
    fireEvent.click(screen.getByTestId('web-capture-fetch'))
    await waitFor(() => expect(screen.getByTestId('web-capture-failure').dataset.failure).toBe('accessDenied'))
    expect(screen.getByTestId('web-capture-failure').textContent).toContain(mark('failure.accessDenied'))
    fireEvent.click(screen.getByText(mark('openInBrowser')))
    expect(host.calls.onOpenInBrowser).toHaveBeenCalledWith('https://pages.example.org/members')
    fireEvent.click(screen.getByTestId('web-capture-link-only'))
    await waitFor(() => expect(screen.getByTestId('web-capture-dialog').dataset.stage).toBe('page'))
    expect((screen.getByTestId('web-capture-title') as HTMLInputElement).value).toBe('pages.example.org')
    await previewReady()
    expect(screen.getByTestId('template-preview-formatted').textContent).toContain(mark('linkOnlyNotice'))
  })
})

describe('stage B: the page', () => {
  it('shows the page title, the recipe question, the folder, and a passive preview of the exact note', async () => {
    const { host } = await fetchReady()
    expect((screen.getByTestId('web-capture-title') as HTMLInputElement).value).toBe('Keeping a Lighthouse Log')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('web-capture-title')))
    expect(screen.getByTestId('web-capture-destination').textContent).toBe(mark('willCreate:Reading/keeping-a-lighthouse-log.md'))
    expect(screen.getByText(mark('imagesAsLinks'))).toBeTruthy()
    fireEvent.change(screen.getByTestId('why'), { target: { value: 'For the chapter on [rest] and ==sleep==.' } })
    fireEvent.change(screen.getByTestId('web-capture-title'), { target: { value: 'Lighthouse logs' } })
    await waitFor(() => expect(screen.getByTestId('template-preview-formatted').textContent).toContain('For the chapter on [rest] and ==sleep==.'), { timeout: 8000 })
    const preview = screen.getByTestId('web-capture-preview')
    expect(preview.querySelectorAll('a[href], img, script, iframe').length).toBe(0)
    expect(host.commits).toEqual([])
  })

  it('saves once through the recipe run: the proposal carries the verified bytes, which open as the article then My notes', async () => {
    const { host } = await fetchReady()
    fireEvent.change(screen.getByTestId('why'), { target: { value: 'Wanted this for [rest].' } })
    await waitFor(() => expect(screen.getByTestId('template-preview-formatted').textContent).toContain('Wanted this for [rest].'), { timeout: 8000 })
    fireEvent.click(screen.getByTestId('web-capture-save'))
    await waitFor(() => expect(host.calls.onClose).toHaveBeenCalledWith(true, 'done'), { timeout: 8000 })
    expect(host.commits).toHaveLength(1)
    const [{ proposal, content }] = host.commits
    expect(proposal.document.blocks[0]).toEqual({ type: 'webArticle', page: host.saves[0].webPage.page })
    expect(content).toBe(host.saves[0].prepared.content)
    expect(host.saves[0]).toMatchObject({ folder: 'Reading', fileName: 'keeping-a-lighthouse-log.md', webPage: { kind: 'article', pageUrl: FINAL, siteName: 'Harbour Notes', byline: 'Ada Example' } })
    const blocks = flat(await open(content!))
    expect(textOf(blocks[0].content)).toBe('Keeping a Lighthouse Log')
    expect(blocks.slice(-2).map(block => textOf(block.content))).toEqual(['My notes', 'Wanted this for [rest].'])
    expect(host.calls.onRemember).toHaveBeenCalledWith('Reading')
  })

  it('an uncertain write is checked again for the same operation, never saved again', async () => {
    const { host } = await fetchReady(undefined, { receipt: () => 'uncertain' })
    host.calls.checkAgain.mockResolvedValue({ status: 'created', page: { displayPath: 'Reading/keeping-a-lighthouse-log.md' }, durable: true, opened: 'notShown' })
    fireEvent.click(screen.getByTestId('web-capture-save'))
    await waitFor(() => expect(screen.getByTestId('web-capture-check')).toBeTruthy(), { timeout: 8000 })
    expect(screen.getByTestId('web-capture-save-status').textContent).toContain(mark('uncertain:noReply'))
    fireEvent.click(screen.getByTestId('web-capture-check'))
    await waitFor(() => expect(screen.getByTestId('web-capture-done')).toBeTruthy())
    expect(host.commits).toHaveLength(1)
    expect(host.calls.checkAgain).toHaveBeenCalledTimes(1)
  })

  it('a page saved before at its final address saves another copy under the next free name', async () => {
    const { host } = await fetchReady(undefined, {
      savedSources: [{ path: '/vault/Reading/keeping-a-lighthouse-log.md', title: 'Keeping a Lighthouse Log', source: FINAL }],
      taken: new Set(['Reading/keeping-a-lighthouse-log.md']),
    })
    expect(screen.getByTestId('web-capture-save').textContent).toBe(mark('saveAnotherCopy'))
    expect(screen.getByTestId('web-capture-destination').textContent).toBe(mark('willCreate:Reading/keeping-a-lighthouse-log-2.md'))
    fireEvent.click(screen.getByTestId('web-capture-save'))
    await waitFor(() => expect(host.saves).toHaveLength(1), { timeout: 8000 })
    expect(host.saves[0].fileName).toBe('keeping-a-lighthouse-log-2.md')
  })

  it('a name taken by another note is refused before any save, asking for another title', async () => {
    const { host } = await fetchReady(undefined, { taken: new Set(['Reading/keeping-a-lighthouse-log.md']) })
    expect(screen.getByTestId('web-capture-destination').textContent).toBe(mark('exists:keeping-a-lighthouse-log.md|Reading'))
    fireEvent.click(screen.getByTestId('web-capture-save'))
    expect(host.saves).toEqual([])
  })

  it('a title that cannot be written literally blocks Save', async () => {
    const { host } = await fetchReady()
    fireEvent.change(screen.getByTestId('web-capture-title'), { target: { value: 'Bad @@TOLARIA_HTML_BLOCK:1@@' } })
    expect(screen.getByText(mark('titleProblem'))).toBeTruthy()
    fireEvent.click(screen.getByTestId('web-capture-save'))
    expect(host.saves).toEqual([])
  })

  it('editing the address returns to stage A and the page handle stops resolving', async () => {
    const { flow } = await fetchReady()
    const state = flow.state()
    if (state.step !== 'ready') throw new Error('not ready')
    expect((screen.getByTestId('web-capture-address') as HTMLInputElement).value).toBe(FINAL)
    typeAddress(`${FINAL}?edited`)
    expect(screen.getByTestId('web-capture-dialog').dataset.stage).toBe('address')
    expect(flow.store.resolve(state.token)).toBeNull()
    expect(screen.queryByTestId('web-capture-title')).toBeNull()
    expect(screen.getByTestId('web-capture-save')).toBeDisabled()
  })

  it('revocation stops everything and only Close remains', async () => {
    const revocation = { listeners: new Set<() => void>(), reason: null as 'workspace' | 'package' | null }
    const { flow, host } = await fetchReady(undefined, { revocation })
    await act(async () => { revocation.reason = 'package'; for (const listener of revocation.listeners) listener() })
    expect(flow.state()).toEqual({ step: 'revoked' })
    expect(screen.getByTestId('web-capture-save-status').textContent).toBe(mark('revoked:package'))
    fireEvent.click(screen.getByTestId('web-capture-close'))
    expect(host.calls.onClose).toHaveBeenCalledWith(false, 'cancel')
    expect(host.commits).toEqual([])
  })

  it('asks before discarding typed words, and shows only labels the host supplied', async () => {
    const { host } = await fetchReady()
    fireEvent.change(screen.getByTestId('why'), { target: { value: 'a thought' } })
    fireEvent.keyDown(screen.getByTestId('web-capture-dialog'), { key: 'Escape' })
    expect(screen.getByTestId('web-capture-discard').textContent).toContain(mark('discardQuestion'))
    const chrome = [screen.getByRole('dialog').querySelector('[data-slot="dialog-footer"]'), screen.getByTestId('web-capture-discard')]
    const nodes = chrome.flatMap(part => Array.from(part?.querySelectorAll('button, p') ?? []))
    expect(nodes.length).toBeGreaterThan(4)
    for (const node of nodes) expect(node.textContent).toMatch(/^(«[^»]+»)+$/u)
    fireEvent.click(screen.getByText(mark('discard')))
    expect(host.calls.onClose).toHaveBeenCalledWith(false, 'cancel')
  })
})
