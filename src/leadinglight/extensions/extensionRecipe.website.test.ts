import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { CommittedReceipt } from '../proposals/proposalContract'
import {
  CAPABILITIES, E1_HOST_CAPABILITIES, E2_HOST_CAPABILITIES,
  type Capability, type ChosenDestination, type DocumentProposal, type ExtensionPackage, type PassageCapture,
  type ReviewDecision, type RunEffects, type WebPageCapture,
} from './extensionContract'
import { buildExtensionMarkdown, packageBlocksMarkdown } from './extensionMarkdown'
import { previewDocument, reviewPackage, runExtensionCommand } from './extensionRecipe'
import { parseExtensionPackage } from './extensionSchema'
import { webArticleComposition } from './extensionWebPage'

const fixture = (name: string) => readFileSync(`${process.cwd()}/src/leadinglight/extensions/fixtures/${name}`, 'utf8')
function load(text: string): ExtensionPackage {
  const result = parseExtensionPackage(text)
  if (result.status === 'invalid') throw new Error(JSON.stringify(result.diagnostics))
  return result.extension
}
const website = load(fixture('website-capture.json'))
const meeting = load(fixture('meeting-debrief.json'))
const commentary = load(fixture('passage-commentary.json'))
const command = website.commands[0]

/** A host that has qualified website capture on top of everything else; no shipped list is this. */
const WEB_HOST: readonly Capability[] = [...E2_HOST_CAPABILITIES, 'web.capture']
const folder: ChosenDestination = { kind: 'newInFolder', folderHandle: 'folder-1' }
const existing: ChosenDestination = { kind: 'existingDocument', documentHandle: 'document-1' }
const article: WebPageCapture = {
  page: 'web-page-1', kind: 'article', pageTitle: 'Why we sleep', pageUrl: 'https://example.org/2026/10/article',
  siteName: 'Example Site', byline: 'Ada Example',
}
const passage: PassageCapture = { passage: 'passage-1', quote: 'The quick brown fox.', sourceTitle: 'Reading notes' }
const problemsOf = (preview: { problems: readonly { code: string; field: string | null }[] }) => preview.problems.map(({ code, field }) => ({ code, field }))
const bytes = (text: string) => new TextEncoder().encode(text).length

/** The website fixture with its compose step replaced, to vary only the layout around the page. */
function withBlocks(blocks: unknown[], title: unknown[] = [{ step: 'page', field: 'pageTitle' }]): ExtensionPackage {
  const json = JSON.parse(fixture('website-capture.json')) as { commands: { steps: Record<string, unknown>[] }[] }
  json.commands[0].steps[3] = { ...json.commands[0].steps[3], title, blocks }
  return load(JSON.stringify(json))
}

describe('website recipes: no network from the recipe layer', () => {
  it('validates, reviews, previews and runs without any request', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const open = vi.fn()
    vi.stubGlobal('XMLHttpRequest', vi.fn(() => ({ open, send: open })))
    try {
      const extension = load(fixture('website-capture.json'))
      reviewPackage(extension, E2_HOST_CAPABILITIES)
      previewDocument(extension.commands[0], { capture: null, answers: { why: 'x' }, destination: folder, webPage: article })
      await runExtensionCommand(start(), host({ action: 'submit', answers: {}, destination: folder, webPage: article }))
      expect(fetch).not.toHaveBeenCalled()
      expect(open).not.toHaveBeenCalled()
    } finally {
      fetch.mockRestore()
      vi.unstubAllGlobals()
    }
  })
})

describe('website recipes: review', () => {
  it('reports the network effect and the create-only write from the steps, not from package text', () => {
    expect(reviewPackage(website, WEB_HOST)).toMatchObject({
      activation: 'available', missing: [],
      commands: [{ id: 'save-page', placement: 'palette', network: 'explicitWebPage', write: 'createInChosenFolder', opensResult: true, questions: 1, missing: [] }],
    })
    for (const other of [meeting, commentary]) {
      expect(reviewPackage(other, CAPABILITIES).commands.map(review => review.network)).toEqual(['none'])
    }
  })

  it('blocks activation honestly on every host that has not qualified website capture', () => {
    expect(reviewPackage(website, E1_HOST_CAPABILITIES)).toMatchObject({
      activation: 'blocked', missing: ['web.capture'], commands: [{ network: 'explicitWebPage', missing: ['web.capture'] }],
    })
    expect(reviewPackage(website, E2_HOST_CAPABILITIES)).toMatchObject({ activation: 'blocked', missing: ['web.capture'] })
    expect(reviewPackage(website, ['web.capture'])).toMatchObject({ activation: 'blocked', missing: ['document.create', 'document.open'] })
  })

  it('never gives existing packages a capability they did not have', () => {
    for (const extension of [meeting, commentary]) {
      expect(reviewPackage(extension, WEB_HOST).capabilities).not.toContain('web.capture')
      expect(reviewPackage(extension, E2_HOST_CAPABILITIES).activation).toBe('available')
    }
  })
})

describe('website recipes: composition around the host page', () => {
  it('places the host page block first, then the package blocks, and fills the title from the page', () => {
    const preview = previewDocument(command, { capture: null, answers: { why: 'For the chapter on rest.' }, destination: folder, webPage: article })
    expect(preview).toEqual({
      problems: [],
      write: { mode: 'create', folderHandle: 'folder-1' },
      document: {
        title: 'Why we sleep',
        blocks: [
          { type: 'webArticle', page: 'web-page-1' },
          { type: 'heading', level: 2, text: 'My notes' },
          { type: 'paragraph', text: 'For the chapter on rest.' },
        ],
        textBytes: bytes('Why we sleep') + bytes('My notes') + bytes('For the chapter on rest.'),
      },
    })
    expect(previewDocument(command, { capture: null, answers: {}, destination: folder, webPage: article }).document?.blocks)
      .toEqual([{ type: 'webArticle', page: 'web-page-1' }])
  })

  it('composes a link-only page with exactly the same recipe semantics', () => {
    const linkOnly = { ...article, page: 'web-page-2', kind: 'linkOnly' as const }
    const full = previewDocument(command, { capture: null, answers: { why: 'Later.' }, destination: folder, webPage: article })
    const link = previewDocument(command, { capture: null, answers: { why: 'Later.' }, destination: folder, webPage: linkOnly })
    expect(link.problems).toEqual([])
    expect(link.document).toEqual({ ...full.document, blocks: [{ type: 'webArticle', page: 'web-page-2' }, ...(full.document?.blocks.slice(1) ?? [])] })
  })

  it('uses the page values where the recipe places them and leaves out a missing byline', () => {
    const layout = withBlocks([
      { type: 'paragraph', text: ['By ', { step: 'page', field: 'byline' }], ifFilled: { step: 'page', field: 'byline' } },
      { type: 'list', style: 'bullet', items: [['Site: ', { step: 'page', field: 'siteName' }], ['Address: ', { step: 'page', field: 'pageUrl' }]] },
    ], ['Read: ', { step: 'page', field: 'pageTitle' }, ' (', { step: 'page', field: 'siteName' }, ')'])
    const withByline = previewDocument(layout.commands[0], { capture: null, answers: {}, destination: folder, webPage: article })
    expect(withByline.document).toMatchObject({
      title: 'Read: Why we sleep (Example Site)',
      blocks: [
        { type: 'webArticle', page: 'web-page-1' },
        { type: 'paragraph', text: 'By Ada Example' },
        { type: 'list', style: 'bullet', items: ['Site: Example Site', 'Address: https://example.org/2026/10/article'] },
      ],
    })
    const without = previewDocument(layout.commands[0], { capture: null, answers: {}, destination: folder, webPage: { ...article, byline: null } })
    expect(without.document?.blocks.map(block => block.type)).toEqual(['webArticle', 'list'])
  })

  it('keeps the title the person edited as the page title, and nothing else changes', () => {
    const edited = previewDocument(command, { capture: null, answers: {}, destination: folder, webPage: { ...article, pageTitle: 'My own title' } })
    expect(edited.document).toMatchObject({ title: 'My own title', blocks: [{ type: 'webArticle', page: 'web-page-1' }] })
  })

  it('needs a page, and refuses a missing, malformed or substituted one', () => {
    const preview = (input: Partial<Parameters<typeof previewDocument>[1]>) =>
      problemsOf(previewDocument(command, { capture: null, answers: {}, destination: folder, ...input }))
    const invalid = [{ code: 'invalidCapture', field: null }]
    expect(preview({})).toEqual(invalid)
    expect(preview({ webPage: null })).toEqual(invalid)
    expect(preview({ capture: passage, webPage: article })).toEqual(invalid)
    expect(preview({ capture: passage })).toEqual([...invalid, ...invalid])
    for (const forged of [
      { ...article, extra: true },
      { ...article, page: 'not a token' },
      { ...article, kind: 'html' },
      { ...article, pageTitle: '   ' },
      { ...article, pageTitle: 'Two\nlines' },
      { ...article, pageTitle: 'x'.repeat(1001) },
      { ...article, siteName: '' },
      { ...article, byline: '' },
      { ...article, byline: 42 },
      { ...article, pageUrl: 'javascript:alert(1)' },
      { ...article, pageUrl: 'file:///Users/me/notes.md' },
      { ...article, pageUrl: '/relative/path' },
      { ...article, pageUrl: 'https://user:secret@example.org/' },
      { ...article, pageUrl: 'https://example.org/#part' },
      { ...article, pageUrl: 'https://example.org/a b' },
      { ...article, pageUrl: `https://example.org/${'a'.repeat(2048)}` },
      { page: 'web-page-1', kind: 'article', pageTitle: 'T', pageUrl: 'https://example.org/', siteName: 'S' },
      passage,
    ]) expect(preview({ webPage: forged as unknown as WebPageCapture })).toEqual(invalid)
  })

  it('creates only: an existing document is never a destination for a page', () => {
    expect(problemsOf(previewDocument(command, { capture: null, answers: {}, destination: existing, webPage: article })))
      .toEqual([{ code: 'wrongDestination', field: null }])
  })

  it('gives a page to no other command, and keeps passage commands as they were', () => {
    const debrief = { meeting: 'Sync', attendees: '', decisions: 'Ship.', followUps: '', mood: 'mixed', revisit: false }
    const stray = previewDocument(meeting.commands[0], { capture: null, answers: debrief, destination: folder, webPage: article })
    expect(problemsOf(stray)).toEqual([{ code: 'invalidCapture', field: null }])
    expect(stray.document?.blocks.some(block => block.type === 'webArticle')).toBe(false)
    const quoted = previewDocument(commentary.commands[0], { capture: passage, answers: {}, destination: folder, webPage: article })
    expect(problemsOf(quoted)).toEqual([{ code: 'invalidCapture', field: null }])
    expect(quoted.document?.blocks.map(block => block.type)).toEqual(['source'])
  })

  it('leaves the page block to the host: the generic builder refuses it, and the package blocks split off for the host', () => {
    const { document } = previewDocument(command, { capture: null, answers: { why: 'Rest.' }, destination: folder, webPage: article })
    if (!document) throw new Error('no document')
    expect(buildExtensionMarkdown(document, command.title)).toEqual({ status: 'refused', reason: 'source', failure: null })
    const parts = webArticleComposition(document)
    expect(parts).toEqual({ page: 'web-page-1', title: 'Why we sleep', blocks: document.blocks.slice(1) })
    expect(packageBlocksMarkdown(parts?.blocks ?? [])).toEqual(['## My notes', 'Rest.'])
  })
})

// --- Runs --------------------------------------------------------------------------------------

const committedFor = (proposal: DocumentProposal): CommittedReceipt => ({
  status: 'committed', kind: 'create', operationId: proposal.operationId, path: '/vault/Reading/why-we-sleep.md',
  beforeSha256: null, afterSha256: 'a'.repeat(64), durable: true, undoReceipt: null,
})

function host(decision: ReviewDecision) {
  return {
    liveness: vi.fn<RunEffects['liveness']>(() => 'live'),
    review: vi.fn<RunEffects['review']>(async () => decision),
    commit: vi.fn<RunEffects['commit']>(async proposal => committedFor(proposal)),
    open: vi.fn<RunEffects['open']>(async () => true),
  }
}
const start = (more: Partial<Parameters<typeof runExtensionCommand>[0]> = {}) => ({
  extension: website, commandId: 'save-page', runId: 'run-1', operationId: 'operation-1', capture: null, hostCapabilities: WEB_HOST, ...more,
})

describe('website recipes: one reviewed create per run', () => {
  it('takes the page from the review decision and proposes exactly one create', async () => {
    const effects = host({ action: 'submit', answers: { why: 'Rest.' }, destination: folder, webPage: article })
    const outcome = await runExtensionCommand(start(), effects)
    expect(outcome).toMatchObject({ status: 'committed', navigation: 'opened' })
    expect(effects.review).toHaveBeenCalledWith({ runId: 'run-1', command, capture: null })
    expect(effects.commit).toHaveBeenCalledTimes(1)
    const proposal = effects.commit.mock.calls[0][0]
    expect(proposal).toEqual({
      operationId: 'operation-1', runId: 'run-1', write: { mode: 'create', folderHandle: 'folder-1' },
      document: previewDocument(command, { capture: null, answers: { why: 'Rest.' }, destination: folder, webPage: article }).document,
    })
    expect(JSON.parse(JSON.stringify(proposal))).toEqual(proposal)
  })

  it('writes nothing without a page, with a forged one, or to an existing document', async () => {
    for (const decision of [
      { action: 'submit', answers: {}, destination: folder },
      { action: 'submit', answers: {}, destination: folder, webPage: { ...article, pageUrl: 'ftp://example.org/' } },
      { action: 'submit', answers: {}, destination: existing, webPage: article },
    ] as ReviewDecision[]) {
      const effects = host(decision)
      expect(await runExtensionCommand(start(), effects)).toMatchObject({ status: 'refused', reason: 'invalidInput' })
      expect(effects.commit).not.toHaveBeenCalled()
    }
  })

  it('refuses before review on a host without web.capture, or with a passage capture at start', async () => {
    for (const hostCapabilities of [E1_HOST_CAPABILITIES, E2_HOST_CAPABILITIES]) {
      const effects = host({ action: 'submit', answers: {}, destination: folder, webPage: article })
      expect(await runExtensionCommand(start({ hostCapabilities }), effects)).toMatchObject({ status: 'refused', reason: 'missingCapabilities', missing: ['web.capture'] })
      expect(effects.review).not.toHaveBeenCalled()
    }
    const effects = host({ action: 'submit', answers: {}, destination: folder, webPage: article })
    expect(await runExtensionCommand(start({ capture: passage }), effects)).toMatchObject({ status: 'refused', reason: 'invalidCapture' })
    expect(effects.review).not.toHaveBeenCalled()
  })

  it('ignores a page in the decision of any other command', async () => {
    const debrief = { meeting: 'Sync', attendees: '', decisions: 'Ship.', followUps: '', mood: 'mixed', revisit: false }
    const effects = host({ action: 'submit', answers: debrief, destination: folder, webPage: article })
    expect(await runExtensionCommand({ ...start(), extension: meeting, commandId: 'new-debrief' }, effects))
      .toMatchObject({ status: 'refused', reason: 'invalidInput', problems: [{ code: 'invalidCapture', field: null }] })
    expect(effects.commit).not.toHaveBeenCalled()
  })
})
