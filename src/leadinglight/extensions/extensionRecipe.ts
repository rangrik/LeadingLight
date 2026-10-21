// The recipe interpreter and the trusted run driver (contract: extensionContract.ts).
// Composition is pure: the same command and input always give the same typed document, with
// literal text kept literal for the host's Markdown encoder. The driver orders one review, one
// commit and one open, and receives every effect from the host; packages never see them.
import { isOpaqueToken, type CommittedReceipt, type ProposalReceipt } from '../proposals/proposalContract'
import {
  EXTENSION_LIMITS,
  type AnswerValue, type Capability, type ChosenDestination, type CommandReview, type ComposedDocument,
  type DestinationPolicy, type DocumentBlock, type DocumentPreview, type DocumentProposal, type DocumentWrite,
  type ExtensionCommand, type ExtensionPackage, type FormAnswers, type FormField, type InputProblem, type InputProblemCode,
  type PackageReview, type PassageCapture, type RecipeStep, type ReviewDecision, type RunEffects, type RunInput,
  type RunNavigation, type RunOutcome, type RunRefusal, type RunStart, type StepOperation, type TextPart, type WebPageCapture,
  type WriteImpact,
} from './extensionContract'
import { commandCapabilities, isValidatedPackage, utf8Bytes } from './extensionSchema'
import { readWebPageCapture } from './extensionWebPage'

const LIMITS = EXTENSION_LIMITS

function stepOf<O extends StepOperation>(command: ExtensionCommand, op: O): Extract<RecipeStep, { op: O }> | null {
  return (command.steps.find(step => step.op === op) as Extract<RecipeStep, { op: O }> | undefined) ?? null
}

const missingFrom = (needs: readonly Capability[], host: readonly Capability[]) => needs.filter(capability => !host.includes(capability))

// --- Review ---------------------------------------------------------------------------------------

const WRITE_IMPACT: Record<DestinationPolicy, WriteImpact> = {
  newInChosenFolder: 'createInChosenFolder',
  chosenExistingDocument: 'appendToChosenDocument',
  associatedWithSource: 'createOrAppendAssociated',
}

function reviewCommand(command: ExtensionCommand, host: readonly Capability[]): CommandReview {
  const requires = commandCapabilities(command)
  return {
    id: command.id,
    title: command.title,
    placement: stepOf(command, 'capturePassage') ? 'selectionAction' : 'palette',
    network: stepOf(command, 'captureWebPage') ? 'explicitWebPage' : 'none',
    write: WRITE_IMPACT[stepOf(command, 'resolveDestination')?.policy ?? 'newInChosenFolder'],
    opensResult: stepOf(command, 'openCommittedResult') !== null,
    questions: stepOf(command, 'collectForm')?.fields.length ?? 0,
    requires,
    missing: missingFrom(requires, host),
  }
}

/** What turning the package on would do on this host. Pure; safe for candidates and previews. */
export function reviewPackage(extension: ExtensionPackage, host: readonly Capability[]): PackageReview {
  const missing = missingFrom(extension.capabilities, host)
  return {
    id: extension.id,
    version: extension.version,
    name: extension.name,
    description: extension.description,
    capabilities: extension.capabilities,
    missing,
    activation: missing.length === 0 ? 'available' : 'blocked',
    commands: extension.commands.map(command => reviewCommand(command, host)),
  }
}

// --- Inputs ---------------------------------------------------------------------------------------

/** A value a reference can expand to; `text` is null for a yes/no answer. */
interface Resolved { readonly text: string | null; readonly filled: boolean }
type Values = Map<string, Resolved>
/** Ids cannot contain '/', so this key is unambiguous and never an object property. */
const valueKey = (step: string, field: string) => `${step}/${field}`
const EMPTY: Resolved = { text: null, filled: false }

function hasLineBreak(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0)
    if (code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029) return true
  }
  return false
}

function isCapture(capture: PassageCapture | null): capture is PassageCapture {
  if (typeof capture !== 'object' || capture === null) return false
  const { passage, quote, sourceTitle } = capture
  return isOpaqueToken(passage)
    && typeof quote === 'string' && quote.trim() !== '' && utf8Bytes(quote) <= LIMITS.quoteBytes
    && typeof sourceTitle === 'string' && sourceTitle.trim() !== '' && !hasLineBreak(sourceTitle)
    && utf8Bytes(sourceTitle) <= LIMITS.sourceTitleBytes
}

/** The capture a command may use: required with a capturePassage step, refused without one. */
function captureOf(command: ExtensionCommand, capture: PassageCapture | null, problems: InputProblem[], values: Values): PassageCapture | null {
  const step = stepOf(command, 'capturePassage')
  if (step === null || !isCapture(capture)) {
    if (step !== null || capture !== null) problems.push({ code: 'invalidCapture', field: null })
    return null
  }
  values.set(valueKey(step.id, 'sourceTitle'), { text: capture.sourceTitle, filled: true })
  return capture
}

/**
 * The page a command may use: required with a captureWebPage step, refused without one. Only a value
 * the strict reader accepts counts, so no other capture can stand in for a page.
 */
function webPageOf(command: ExtensionCommand, value: WebPageCapture | null, problems: InputProblem[], values: Values): WebPageCapture | null {
  const step = stepOf(command, 'captureWebPage')
  const page = value === null ? null : readWebPageCapture(value)
  if (step === null || page === null) {
    if (step !== null || value !== null) problems.push({ code: 'invalidCapture', field: null })
    return null
  }
  values.set(valueKey(step.id, 'pageTitle'), { text: page.pageTitle, filled: true })
  values.set(valueKey(step.id, 'pageUrl'), { text: page.pageUrl, filled: true })
  values.set(valueKey(step.id, 'siteName'), { text: page.siteName, filled: true })
  values.set(valueKey(step.id, 'byline'), page.byline === null ? EMPTY : { text: page.byline, filled: true })
  return page
}

function answerOf(field: FormField, value: AnswerValue | undefined): { value: Resolved; problem: InputProblemCode | null } {
  const unanswered = { value: EMPTY, problem: field.kind !== 'boolean' && field.required ? 'required' as const : null }
  if (value === null || value === undefined || value === '') return unanswered
  if (field.kind === 'boolean') return typeof value === 'boolean' ? { value: { text: null, filled: value }, problem: null } : { value: EMPTY, problem: 'invalidAnswer' }
  if (typeof value !== 'string') return { value: EMPTY, problem: 'invalidAnswer' }
  if (field.kind === 'choice') {
    const option = field.options.find(item => item.id === value)
    return option ? { value: { text: option.label, filled: true }, problem: null } : { value: EMPTY, problem: 'invalidAnswer' }
  }
  if (utf8Bytes(value) > (field.kind === 'text' ? LIMITS.textAnswerBytes : LIMITS.multilineAnswerBytes)) return { value: EMPTY, problem: 'tooLong' }
  if (field.kind === 'text' && hasLineBreak(value)) return { value: EMPTY, problem: 'notSingleLine' }
  return value.trim() === '' ? unanswered : { value: { text: value, filled: true }, problem: null }
}

function answersOf(command: ExtensionCommand, answers: FormAnswers, problems: InputProblem[], values: Values) {
  const form = stepOf(command, 'collectForm')
  const fields = form?.fields ?? []
  const known = new Set(fields.map(field => field.id))
  for (const name of Object.keys(answers)) if (!known.has(name)) problems.push({ code: 'unknownAnswer', field: name })
  for (const field of fields) {
    const { value, problem } = answerOf(field, Object.hasOwn(answers, field.id) ? answers[field.id] : undefined)
    if (problem) problems.push({ code: problem, field: field.id })
    if (form) values.set(valueKey(form.id, field.id), value)
  }
}

const ALLOWED_DESTINATIONS: Record<DestinationPolicy, readonly ChosenDestination['kind'][]> = {
  newInChosenFolder: ['newInFolder'],
  chosenExistingDocument: ['existingDocument'],
  associatedWithSource: ['newInFolder', 'existingDocument'],
}

function writeOf(command: ExtensionCommand, destination: ChosenDestination | null, problems: InputProblem[]): DocumentWrite | null {
  if (typeof destination !== 'object' || destination === null) {
    problems.push({ code: 'missingDestination', field: null })
    return null
  }
  const policy = stepOf(command, 'resolveDestination')?.policy
  const write: DocumentWrite | null = destination.kind === 'newInFolder' && isOpaqueToken(destination.folderHandle)
    ? { mode: 'create', folderHandle: destination.folderHandle }
    : destination.kind === 'existingDocument' && isOpaqueToken(destination.documentHandle)
      ? { mode: 'append', documentHandle: destination.documentHandle }
      : null
  if (write && policy && ALLOWED_DESTINATIONS[policy].includes(destination.kind)) return write
  problems.push({ code: 'wrongDestination', field: null })
  return null
}

// --- Composition ----------------------------------------------------------------------------------

/** The fixed empty-value rule: a part referring to an unfilled value removes its block or item. */
function expand(parts: readonly TextPart[], values: Values): string | null {
  let text = ''
  for (const part of parts) {
    if (typeof part === 'string') {
      text += part
      continue
    }
    const value = values.get(valueKey(part.step, part.field))
    if (!value?.filled || value.text === null) return null
    text += value.text
  }
  return text
}

/** Titles use only always-filled values; while an answer is still missing, its part is blank. */
const titleText = (parts: readonly TextPart[], values: Values) =>
  parts.map(part => (typeof part === 'string' ? part : values.get(valueKey(part.step, part.field))?.text ?? '')).join('')

function blockOf(template: Extract<RecipeStep, { op: 'composeDocument' }>['blocks'][number], values: Values): DocumentBlock | null {
  if (template.ifFilled && !values.get(valueKey(template.ifFilled.step, template.ifFilled.field))?.filled) return null
  if (template.type === 'list') {
    const items = template.items.map(item => expand(item, values)).filter((item): item is string => item !== null)
    return items.length > 0 ? { type: 'list', style: template.style, items } : null
  }
  const text = expand(template.text, values)
  if (text === null) return null
  return template.type === 'heading' ? { type: 'heading', level: template.level, text } : { type: template.type, text }
}

/** The page block has no text of its own here: its body is the host's, bounded by the converter. */
function textsOf(block: DocumentBlock): readonly string[] {
  if (block.type === 'list') return block.items
  if (block.type === 'webArticle') return []
  return [block.type === 'source' ? block.quote : block.text]
}

/** Null once the expanded text passes the document limit; composing stops there. */
function compose(
  command: ExtensionCommand, values: Values, host: { capture: PassageCapture | null; webPage: WebPageCapture | null }, write: DocumentWrite | null,
): ComposedDocument | null {
  const { capture, webPage } = host
  const step = stepOf(command, 'composeDocument')
  if (!step) return null
  const title = write?.mode === 'append' || step.title === null ? null : titleText(step.title, values)
  let textBytes = title === null ? 0 : utf8Bytes(title)
  const blocks: DocumentBlock[] = []
  const place = (block: DocumentBlock | null) => {
    if (block === null) return true
    for (const text of textsOf(block)) textBytes += utf8Bytes(text)
    blocks.push(block)
    return textBytes <= LIMITS.documentTextBytes
  }
  if (textBytes > LIMITS.documentTextBytes) return null
  if (capture && !place({ type: 'source', passage: capture.passage, quote: capture.quote })) return null
  if (webPage && !place({ type: 'webArticle', page: webPage.page })) return null
  for (const template of step.blocks) if (!place(blockOf(template, values))) return null
  return { title, blocks, textBytes }
}

/** The document a submit would write now, and every reason it cannot be submitted yet. */
export function previewDocument(command: ExtensionCommand, input: RunInput): DocumentPreview {
  const problems: InputProblem[] = []
  const values: Values = new Map()
  const capture = captureOf(command, input.capture, problems, values)
  const webPage = webPageOf(command, input.webPage ?? null, problems, values)
  answersOf(command, input.answers ?? {}, problems, values)
  const write = writeOf(command, input.destination, problems)
  const document = compose(command, values, { capture, webPage }, write)
  if (document === null) problems.push({ code: 'outputTooLarge', field: null })
  return { document, write, problems }
}

export type PreparedProposal =
  | { readonly status: 'ready'; readonly proposal: DocumentProposal }
  | { readonly status: 'invalid'; readonly problems: readonly InputProblem[] }

export function prepareProposal(command: ExtensionCommand, ids: { runId: string; operationId: string }, input: RunInput): PreparedProposal {
  const { document, write, problems } = previewDocument(command, input)
  if (problems.length > 0 || document === null || write === null) return { status: 'invalid', problems }
  return { status: 'ready', proposal: { operationId: ids.operationId, runId: ids.runId, write, document } }
}

// --- Driver ---------------------------------------------------------------------------------------

function refused(reason: RunRefusal, detail: { missing?: readonly Capability[]; problems?: readonly InputProblem[]; answers?: FormAnswers } = {}): RunOutcome {
  return { status: 'refused', reason, missing: detail.missing ?? [], problems: detail.problems ?? [], answers: detail.answers ?? null }
}

const RECEIPTS: readonly ProposalReceipt['status'][] = ['committed', 'conflict', 'refused', 'uncertain']

/** The host parses native replies (parseProposalReceipt); this only refuses to trust a mismatch. */
const answersProposal = (receipt: ProposalReceipt, proposal: DocumentProposal) =>
  typeof receipt === 'object' && receipt !== null && receipt.operationId === proposal.operationId && RECEIPTS.includes(receipt.status)
  && (receipt.status !== 'committed' || receipt.kind === proposal.write.mode)

/** A rejected, malformed or foreign reply cannot show that nothing was written. */
async function commitOnce(effects: RunEffects, proposal: DocumentProposal): Promise<ProposalReceipt> {
  const unknown: ProposalReceipt = { status: 'uncertain', operationId: proposal.operationId }
  try {
    const receipt = await effects.commit(proposal)
    return answersProposal(receipt, proposal) ? receipt : unknown
  } catch {
    return unknown
  }
}

async function openOnce(effects: RunEffects, receipt: CommittedReceipt): Promise<RunNavigation> {
  try {
    return (await effects.open(receipt)) === true ? 'opened' : 'failed'
  } catch {
    return 'failed'
  }
}

async function reviewOnce(effects: RunEffects, request: Parameters<RunEffects['review']>[0]): Promise<ReviewDecision> {
  try {
    return await effects.review(request)
  } catch {
    return { action: 'cancel' }
  }
}

const ended = (effects: RunEffects): 'cancelled' | 'stale' | null => {
  const state = effects.liveness()
  return state === 'live' ? null : state === 'cancelled' ? 'cancelled' : 'stale'
}

/**
 * Runs one admitted command: review, then at most one commit, then open. A run that ended while
 * an effect was pending applies nothing late: no write after review, no navigation after commit.
 */
export async function runExtensionCommand(start: RunStart, effects: RunEffects): Promise<RunOutcome> {
  const { extension, runId, operationId, capture } = start
  if (!isValidatedPackage(extension)) return refused('notValidated')
  const command = extension.commands.find(item => item.id === start.commandId)
  if (!command) return refused('unknownCommand')
  const missing = missingFrom(commandCapabilities(command), start.hostCapabilities)
  if (missing.length > 0) return refused('missingCapabilities', { missing })
  const captureProblems: InputProblem[] = []
  captureOf(command, capture, captureProblems, new Map())
  if (captureProblems.length > 0) return refused('invalidCapture', { problems: captureProblems })

  const before = ended(effects)
  if (before) return { status: before, answers: null }
  const decision = await reviewOnce(effects, { runId, command, capture })
  const afterReview = ended(effects)
  if (afterReview) return { status: afterReview, answers: decision.action === 'submit' ? decision.answers : null }
  if (decision.action === 'cancel') return { status: 'cancelled', answers: null }
  const { answers } = decision

  // A fetched page arrives with the decision: it is fetched inside the review, never before it.
  const prepared = prepareProposal(command, { runId, operationId }, { capture, answers, destination: decision.destination, webPage: decision.webPage ?? null })
  if (prepared.status === 'invalid') return refused('invalidInput', { problems: prepared.problems, answers })
  const receipt = await commitOnce(effects, prepared.proposal)
  if (receipt.status === 'uncertain') return { status: 'uncertain', operationId, answers }
  if (receipt.status !== 'committed') return { status: 'notWritten', receipt, answers }

  if (!stepOf(command, 'openCommittedResult')) return { status: 'committed', receipt, navigation: 'notRequested' }
  if (ended(effects)) return { status: 'committed', receipt, navigation: 'skipped' }
  return { status: 'committed', receipt, navigation: await openOnce(effects, receipt) }
}
