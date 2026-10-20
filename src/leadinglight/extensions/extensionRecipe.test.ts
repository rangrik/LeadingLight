import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { CommittedReceipt } from '../proposals/proposalContract'
import {
  E1_HOST_CAPABILITIES, EXTENSION_LIMITS,
  type ChosenDestination, type DocumentProposal, type ExtensionPackage, type FormAnswers, type PassageCapture,
  type ReviewDecision, type RunEffects, type RunLiveness,
} from './extensionContract'
import { previewDocument, reviewPackage, runExtensionCommand } from './extensionRecipe'
import { parseExtensionPackage } from './extensionSchema'

const fixture = (name: string) => readFileSync(`${process.cwd()}/src/leadinglight/extensions/fixtures/${name}`, 'utf8')
function load(text: string): ExtensionPackage {
  const result = parseExtensionPackage(text)
  if (result.status === 'invalid') throw new Error(JSON.stringify(result.diagnostics))
  return result.extension
}
const meeting = load(fixture('meeting-debrief.json'))
const commentary = load(fixture('passage-commentary.json'))
const observation = load(fixture('append-observation.json'))

const folder: ChosenDestination = { kind: 'newInFolder', folderHandle: 'folder-1' }
const page: ChosenDestination = { kind: 'existingDocument', documentHandle: 'document-1' }
const capture: PassageCapture = { passage: 'passage-1', quote: 'The quick brown fox.', sourceTitle: 'Reading notes' }
const debrief: FormAnswers = {
  meeting: 'Roadmap sync', attendees: 'Ana, Ben', decisions: 'Ship v1.\nDefer search.', followUps: '', mood: 'mixed', revisit: true,
}
const bytes = (text: string) => new TextEncoder().encode(text).length
const problemsOf = (preview: { problems: readonly { code: string; field: string | null }[] }) => preview.problems.map(({ code, field }) => ({ code, field }))

/** A package edited as JSON, so a test can vary data without touching the interpreter. */
function variant(name: string, edit: (json: { capabilities: string[]; commands: { steps: Record<string, unknown>[] }[] }) => void) {
  const json = JSON.parse(fixture(name))
  edit(json)
  return load(JSON.stringify(json))
}

describe('recipes: behaviour comes from package data', () => {
  it('composes the meeting debrief as structured plain blocks and leaves out unanswered parts', () => {
    const command = meeting.commands[0]
    const preview = previewDocument(command, { capture: null, answers: debrief, destination: folder })
    expect(preview.problems).toEqual([])
    expect(preview.write).toEqual({ mode: 'create', folderHandle: 'folder-1' })
    expect(preview.document?.title).toBe('Debrief: Roadmap sync')
    expect(preview.document?.blocks).toEqual([
      { type: 'list', style: 'bullet', items: ['Attendees: Ana, Ben', 'Mood: Mixed'] },
      { type: 'heading', level: 2, text: 'Decisions' },
      { type: 'paragraph', text: 'Ship v1.\nDefer search.' },
      { type: 'paragraph', text: 'Revisit this next week.' },
    ])
    const texts = ['Debrief: Roadmap sync', 'Attendees: Ana, Ben', 'Mood: Mixed', 'Decisions', 'Ship v1.\nDefer search.', 'Revisit this next week.']
    expect(preview.document?.textBytes).toBe(texts.reduce((sum, text) => sum + bytes(text), 0))

    const other = previewDocument(command, {
      capture: null, destination: folder,
      answers: { meeting: 'Retro', attendees: '  ', decisions: 'Keep demos.', followUps: 'Book room', mood: null, revisit: false },
    })
    expect(other.document?.blocks).toEqual([
      { type: 'heading', level: 2, text: 'Decisions' },
      { type: 'paragraph', text: 'Keep demos.' },
      { type: 'heading', level: 2, text: 'Follow-ups' },
      { type: 'paragraph', text: 'Book room' },
    ])
  })

  it('appends an observation with a different package and the same interpreter, without a title', () => {
    const preview = previewDocument(observation.commands[0], { capture: null, answers: { what: 'A wren at the feeder', sort: 'fact' }, destination: page })
    expect(preview).toEqual({
      problems: [],
      write: { mode: 'append', documentHandle: 'document-1' },
      document: { title: null, blocks: [{ type: 'heading', level: 3, text: 'Fact: A wren at the feeder' }], textBytes: bytes('Fact: A wren at the feeder') },
    })
  })

  it('reviews host-derived impact and blocks activation of valid packages this host cannot perform', () => {
    expect(reviewPackage(meeting, E1_HOST_CAPABILITIES)).toMatchObject({
      activation: 'available', missing: [],
      commands: [{ id: 'new-debrief', placement: 'palette', write: 'createInChosenFolder', opensResult: true, questions: 6, missing: [] }],
    })
    expect(reviewPackage(commentary, E1_HOST_CAPABILITIES)).toMatchObject({
      activation: 'blocked', missing: ['selection.read', 'association.resolve', 'document.append'],
      commands: [{ placement: 'selectionAction', write: 'createOrAppendAssociated', opensResult: true, questions: 2 }],
    })
    expect(reviewPackage(observation, E1_HOST_CAPABILITIES)).toMatchObject({
      activation: 'blocked', missing: ['document.append'], commands: [{ write: 'appendToChosenDocument', opensResult: false }],
    })
    const everything = ['selection.read', 'association.resolve', 'document.create', 'document.append', 'document.open'] as const
    expect(reviewPackage(commentary, everything).activation).toBe('available')
  })

  it('places the host source block first and lets no package omit, move or supply it', () => {
    const command = commentary.commands[0]
    const created = previewDocument(command, { capture, answers: { thought: 'Echoes chapter two.' }, destination: folder })
    expect(created.problems).toEqual([])
    expect(created.document).toMatchObject({
      title: 'Commentary on Reading notes',
      blocks: [{ type: 'source', passage: 'passage-1', quote: 'The quick brown fox.' }, { type: 'paragraph', text: 'Echoes chapter two.' }],
    })
    const appended = previewDocument(command, { capture, answers: {}, destination: page })
    expect(appended.document).toMatchObject({ title: null, blocks: [{ type: 'source', passage: 'passage-1' }] })
    expect(problemsOf(previewDocument(command, { capture: null, answers: {}, destination: folder }))).toEqual([{ code: 'invalidCapture', field: null }])

    const stray = previewDocument(meeting.commands[0], { capture, answers: debrief, destination: folder })
    expect(problemsOf(stray)).toEqual([{ code: 'invalidCapture', field: null }])
    expect(stray.document?.blocks.some(block => block.type === 'source')).toBe(false)
  })

  it('keeps HTML, script-enabled fences and Markdown syntax as literal text', () => {
    const hostile = [
      '<script>alert(1)</script>',
      '```html scripts=sandboxed\n<img src=x onerror=alert(1)>\n```',
      '[Source](../Private/journal.md) [[Private]] ![x](https://example.com/p.png)',
      '---\ntitle: injected\n---',
    ].join('\n')
    const preview = previewDocument(meeting.commands[0], { capture: null, answers: { ...debrief, decisions: hostile }, destination: folder })
    expect(preview.problems).toEqual([])
    expect(preview.document?.blocks).toContainEqual({ type: 'paragraph', text: hostile })
    expect(preview.document?.blocks.map(block => block.type)).toEqual(['list', 'heading', 'paragraph', 'paragraph'])

    const literal = variant('quick-note.json', json => { json.commands[0].steps[2].blocks = [{ type: 'quote', text: ['<b onclick="x()">', '```js'] }] })
    expect(previewDocument(literal.commands[0], { capture: null, answers: { topic: 'T' }, destination: folder }).document?.blocks)
      .toEqual([{ type: 'quote', text: '<b onclick="x()">```js' }])
  })

  it('applies the document limit after references expand', () => {
    const repeated = (count: number) => variant('quick-note.json', json => {
      const form = json.commands[0].steps[0] as { fields: unknown[] }
      form.fields.push({ id: 'body', kind: 'multilineText', label: 'Body' })
      json.commands[0].steps[2].blocks = Array.from({ length: count }, () => ({ type: 'paragraph', text: [{ step: 'answers', field: 'body' }] }))
    }).commands[0]
    const body = 'a'.repeat(EXTENSION_LIMITS.multilineAnswerBytes - 1)
    const title = (length: number) => 't'.repeat(length)
    const fill = EXTENSION_LIMITS.documentTextBytes - 4 * body.length
    const atLimit = previewDocument(repeated(4), { capture: null, answers: { topic: title(fill), body }, destination: folder })
    expect(atLimit.problems).toEqual([])
    expect(atLimit.document?.textBytes).toBe(EXTENSION_LIMITS.documentTextBytes)
    const over = previewDocument(repeated(4), { capture: null, answers: { topic: title(fill + 1), body }, destination: folder })
    expect(over).toEqual({ problems: [{ code: 'outputTooLarge', field: null }], write: { mode: 'create', folderHandle: 'folder-1' }, document: null })
  })

  it('checks answers against the form without reading inherited properties', () => {
    const command = meeting.commands[0]
    const check = (answers: Record<string, unknown>) =>
      problemsOf(previewDocument(command, { capture: null, answers: { ...debrief, ...answers } as FormAnswers, destination: folder }))
    expect(check({ meeting: '' })).toEqual([{ code: 'required', field: 'meeting' }])
    expect(check({ meeting: 'Line one\nline two' })).toEqual([{ code: 'notSingleLine', field: 'meeting' }])
    expect(check({ meeting: 'x'.repeat(EXTENSION_LIMITS.textAnswerBytes + 1) })).toEqual([{ code: 'tooLong', field: 'meeting' }])
    expect(check({ mood: 'ecstatic' })).toEqual([{ code: 'invalidAnswer', field: 'mood' }])
    expect(check({ revisit: 'yes' })).toEqual([{ code: 'invalidAnswer', field: 'revisit' }])
    expect(check({ agenda: 'x' })).toEqual([{ code: 'unknownAnswer', field: 'agenda' }])
    expect(problemsOf(previewDocument(command, { capture: null, answers: debrief, destination: page }))).toEqual([{ code: 'wrongDestination', field: null }])
    expect(problemsOf(previewDocument(command, { capture: null, answers: debrief, destination: null }))).toEqual([{ code: 'missingDestination', field: null }])

    const named = variant('quick-note.json', json => {
      json.commands[0].steps[0] = { id: 'answers', op: 'collectForm', fields: [{ id: 'constructor', kind: 'text', label: 'Topic', required: true }] }
      json.commands[0].steps[2].title = [{ step: 'answers', field: 'constructor' }]
    })
    expect(problemsOf(previewDocument(named.commands[0], { capture: null, answers: {}, destination: folder }))).toEqual([{ code: 'required', field: 'constructor' }])
  })
})

// --- Runs --------------------------------------------------------------------------------------

const committedFor = (proposal: DocumentProposal): CommittedReceipt => ({
  status: 'committed', kind: 'create', operationId: proposal.operationId, path: '/vault/Meetings/Debrief.md',
  beforeSha256: null, afterSha256: 'a'.repeat(64), durable: true, undoReceipt: null,
})

/** The synthetic preview adapter a UI can build: in-memory answers, no native effects. */
function synthetic(decision: ReviewDecision) {
  let state: RunLiveness = 'live'
  const effects = {
    liveness: vi.fn<RunEffects['liveness']>(() => state),
    review: vi.fn<RunEffects['review']>(async () => decision),
    commit: vi.fn<RunEffects['commit']>(async proposal => committedFor(proposal)),
    open: vi.fn<RunEffects['open']>(async () => true),
  }
  return { effects, end: (next: RunLiveness) => { state = next } }
}
const start = (extension: ExtensionPackage, more: Partial<Parameters<typeof runExtensionCommand>[0]> = {}) => ({
  extension, commandId: extension.commands[0].id, runId: 'run-1', operationId: 'operation-1', capture: null,
  hostCapabilities: E1_HOST_CAPABILITIES, ...more,
})
const submit: ReviewDecision = { action: 'submit', answers: debrief, destination: folder }

describe('runs: the trusted driver around one reviewed write', () => {
  it('runs form, chosen folder, exclusive create and open with plain-data proposals', async () => {
    const { effects } = synthetic(submit)
    const outcome = await runExtensionCommand(start(meeting), effects)
    expect(outcome).toMatchObject({ status: 'committed', navigation: 'opened', receipt: { operationId: 'operation-1' } })
    expect(effects.review).toHaveBeenCalledWith({ runId: 'run-1', command: meeting.commands[0], capture: null })
    const proposal = effects.commit.mock.calls[0][0]
    expect(proposal).toEqual({
      operationId: 'operation-1', runId: 'run-1', write: { mode: 'create', folderHandle: 'folder-1' },
      document: previewDocument(meeting.commands[0], { capture: null, answers: debrief, destination: folder }).document,
    })
    expect(JSON.parse(JSON.stringify(proposal))).toEqual(proposal)
    expect(effects.open).toHaveBeenCalledWith(committedFor(proposal))
  })

  it('ends a run revoked while the dialog was open as stale, keeps the answers and writes nothing', async () => {
    const run = synthetic(submit)
    run.effects.review.mockImplementation(async () => { run.end('revoked'); return submit })
    expect(await runExtensionCommand(start(meeting), run.effects)).toEqual({ status: 'stale', answers: debrief })
    expect(run.effects.commit).not.toHaveBeenCalled()

    const cancelled = synthetic(submit)
    cancelled.effects.review.mockImplementation(async () => { cancelled.end('cancelled'); return submit })
    expect(await runExtensionCommand(start(meeting), cancelled.effects)).toEqual({ status: 'cancelled', answers: debrief })
    expect(cancelled.effects.commit).not.toHaveBeenCalled()
  })

  it('keeps a write that committed while the run was cancelled, but does not open it late', async () => {
    const run = synthetic(submit)
    run.effects.commit.mockImplementation(async proposal => { run.end('cancelled'); return committedFor(proposal) })
    expect(await runExtensionCommand(start(meeting), run.effects)).toMatchObject({ status: 'committed', navigation: 'skipped' })
    expect(run.effects.open).not.toHaveBeenCalled()
  })

  it('reports a lost or foreign commit reply as uncertain and never submits twice', async () => {
    const lost = synthetic(submit)
    lost.effects.commit.mockImplementation(async () => { throw new Error('no reply') })
    expect(await runExtensionCommand(start(meeting), lost.effects)).toEqual({ status: 'uncertain', operationId: 'operation-1', answers: debrief })
    expect(lost.effects.commit).toHaveBeenCalledTimes(1)
    expect(lost.effects.open).not.toHaveBeenCalled()

    const foreign = synthetic(submit)
    foreign.effects.commit.mockImplementation(async proposal => ({ ...committedFor(proposal), operationId: 'operation-2' }))
    expect(await runExtensionCommand(start(meeting), foreign.effects)).toMatchObject({ status: 'uncertain', operationId: 'operation-1' })

    const otherKind = synthetic(submit)
    otherKind.effects.commit.mockImplementation(async proposal => ({ ...committedFor(proposal), kind: 'append', beforeSha256: 'b'.repeat(64), undoReceipt: 'undo-1' }))
    expect(await runExtensionCommand(start(meeting), otherKind.effects)).toMatchObject({ status: 'uncertain', operationId: 'operation-1' })
    expect(otherKind.effects.open).not.toHaveBeenCalled()
  })

  it('keeps the answers when native proves nothing was written', async () => {
    for (const receipt of [
      { status: 'conflict', operationId: 'operation-1', reason: 'exists' },
      { status: 'refused', operationId: 'operation-1', reason: 'storageUnavailable' },
    ] as const) {
      const run = synthetic(submit)
      run.effects.commit.mockImplementation(async () => receipt)
      expect(await runExtensionCommand(start(meeting), run.effects)).toEqual({ status: 'notWritten', receipt, answers: debrief })
      expect(run.effects.open).not.toHaveBeenCalled()
    }
  })

  it('refuses before any effect when the host lacks a capability, the command is unknown or the package was not validated', async () => {
    const run = synthetic(submit)
    expect(await runExtensionCommand(start(commentary, { capture }), run.effects)).toMatchObject({
      status: 'refused', reason: 'missingCapabilities', missing: ['selection.read', 'association.resolve', 'document.append'],
    })
    expect(await runExtensionCommand(start(meeting, { commandId: 'other' }), run.effects)).toMatchObject({ status: 'refused', reason: 'unknownCommand' })
    expect(await runExtensionCommand(start(structuredClone(meeting)), run.effects)).toMatchObject({ status: 'refused', reason: 'notValidated' })
    expect(await runExtensionCommand(start(meeting, { capture }), run.effects)).toMatchObject({ status: 'refused', reason: 'invalidCapture' })
    expect(run.effects.review).not.toHaveBeenCalled()
  })

  it('refuses a submitted destination the recipe does not allow, without writing', async () => {
    const run = synthetic({ action: 'submit', answers: debrief, destination: page })
    expect(await runExtensionCommand(start(meeting), run.effects)).toEqual({
      status: 'refused', reason: 'invalidInput', missing: [], problems: [{ code: 'wrongDestination', field: null }], answers: debrief,
    })
    expect(run.effects.commit).not.toHaveBeenCalled()
  })
})
