/**
 * One managed rename with every linked open page claimed in its own save lane.
 *
 * Each linked page is one admitted page change (the existing `DocumentMutation` boundary):
 * its lane is flushed and claimed, then it waits while the single rename is dispatched with
 * every claimed page named as open. Each page then settles as `committed` (the receipt's exact
 * bytes), `unchanged` (known) or `unproven` (Amendment B/B1): an unproven page is never given a
 * pretended commit, and its lane decides how to hold it before the claim is let go. A rejected or
 * unreadable reply proves nothing about the worker, so it is unknown and no page is reread. The
 * source itself is never changed through this seam.
 */
import type { MutateExistingDocument } from '../../hooks/useAppSave'
import type { DocumentMutation, MutationAdmission, MutationSettled } from '../../hooks/useEditorSave'
import { notePathsMatch } from '../../utils/notePathIdentity'
import type { RenameTicket } from './renameAdmission'
import { receiptPage, type RenameReceipt } from './renameReceipt'
import { knownRenameRefusal } from './renameRefusal'
import type { DraftRebase } from './renameSettlement'

/** Native refuses more; the renderer refuses first so nothing is dispatched. */
export const MAX_LINKED_PAGES = 128

/** What a dispatched rename answered: a receipt, a known "nothing to rename", or no proof. */
export type ParsedRenameReply = RenameReceipt | 'unchanged' | null

/** How one claimed linked page settles; the `R` of its page change. */
export type LinkedPageResult =
  | { kind: 'committed'; before: string; content: string }
  | { kind: 'unchanged' }
  | { kind: 'unproven'; current: string | null }

/**
 * A linked page's change with the Amendment B discriminator. Declared here so this module does not
 * depend on when the save queue's optional member lands; the queue reads `unproven` when it has it.
 */
export interface LinkedPageMutation extends Omit<DocumentMutation<LinkedPageResult>, 'flushBuffers'> {
  unproven: (result: LinkedPageResult) => { current: string | null } | null
}

export interface LinkedRenameRequest {
  ticket: RenameTicket
  sourcePath: string
  linkedPaths: readonly string[]
  mutate?: MutateExistingDocument
  /** The text the app holds for a page when its lane is claimed. */
  baselineOf: (path: string) => string | undefined
  dispatch: (openPaths: string[]) => Promise<unknown>
  parse: (reply: unknown, openPaths: string[]) => ParsedRenameReply
  /** How a linked page's newer draft takes the receipt; `baseline` as claimed. */
  rebaseFor: (receipt: RenameReceipt, page: { path: string; before: string; after: string; baseline: string | undefined }) => DraftRebase
  /**
   * A page's saved bytes, read while its lane is still claimed. Used only after a valid receipt
   * (a completed operation) for the pages it lists as unrefreshed.
   */
  readPage?: (path: string) => Promise<string | undefined>
}

export type LinkedRenameOutcome =
  | { status: 'renamed'; receipt: RenameReceipt; heldPaths: string[]; unprovenPaths: string[] }
  | { status: 'unchanged' }
  | { status: 'refused'; reason: 'busy' | 'notSaved' | 'native'; error?: unknown }
  /** Not proven either way: the source stays held and every claimed page is unproven. */
  | { status: 'unknown'; error?: unknown; heldPaths: string[]; unprovenPaths: string[] }

interface ClaimedPage {
  path: string
  lane: string
  baseline: string | undefined
  rebase: DraftRebase | null
  result: LinkedPageResult
}

const UNCHANGED: LinkedPageResult = { kind: 'unchanged' }
const unique = (paths: readonly string[]) => paths.filter((path, index) => paths.findIndex(other => notePathsMatch(other, path)) === index)

/**
 * Runs inside the caller's source hold, with a ticket taken before that hold. Refuses before
 * dispatch when any linked page cannot be claimed; never waits for a competing rename.
 */
export async function renameWithLinkedPages(request: LinkedRenameRequest): Promise<LinkedRenameOutcome> {
  const linked = unique(request.linkedPaths).filter(path => !notePathsMatch(path, request.sourcePath))
  if (linked.length > MAX_LINKED_PAGES || !request.ticket.covers([request.sourcePath, ...linked])) {
    return { status: 'refused', reason: 'busy' }
  }
  if (linked.length > 0 && !request.mutate) return { status: 'refused', reason: 'busy' }
  let openGate: () => void = () => {}
  const gate = new Promise<void>(resolve => { openGate = resolve })
  const claims: { page: ClaimedPage; ready: Promise<void>; done: Promise<MutationSettled<LinkedPageResult>> }[] = []
  // Every page's result is decided, with its lane still claimed, before the gate opens once.
  let gateOpen = false
  const settle = async (decide: (page: ClaimedPage) => Promise<LinkedPageResult> | LinkedPageResult) => {
    if (gateOpen) return
    gateOpen = true
    const results = await Promise.all(claims.map(claim => decide(claim.page)))
    claims.forEach((claim, index) => { claim.page.result = results[index] })
    openGate()
    return Promise.allSettled(claims.map(claim => claim.done))
  }
  const abort = async (outcome: LinkedRenameOutcome) => {
    await settle(() => UNCHANGED)
    return outcome
  }
  // After a completed operation only: an unrefreshed page continues from bytes equal to its claimed
  // baseline (a current baseline, not proof it was untouched); other bytes are handed over as current.
  const reconcileUnrefreshed = async (page: ClaimedPage): Promise<LinkedPageResult> => {
    const current = request.readPage
      ? await request.readPage(page.lane).then(text => (typeof text === 'string' ? text : null), () => null)
      : null
    if (current !== null && page.baseline !== undefined && current === page.baseline) return UNCHANGED
    page.rebase = () => null
    return { kind: 'unproven', current }
  }
  const unknownPage = (page: ClaimedPage): LinkedPageResult => {
    page.rebase = () => null
    return { kind: 'unproven', current: null }
  }

  for (const path of linked) {
    let markReady: () => void = () => {}
    const ready = new Promise<void>(resolve => { markReady = resolve })
    const page: ClaimedPage = { path, lane: path, baseline: undefined, rebase: null, result: UNCHANGED }
    const mutation: LinkedPageMutation = {
      publish: async lane => {
        page.lane = lane
        page.baseline = request.baselineOf(lane)
        markReady()
        await gate
        return page.result
      },
      committedContent: result => (result.kind === 'committed' ? result.content : null),
      unproven: result => (result.kind === 'unproven' ? { current: result.current } : null),
      // Before a reply the draft is still right for the page on disk; an unproven page takes nothing.
      rebase: draft => (page.rebase ? page.rebase(draft) : draft),
    }
    const mutate = request.mutate
    if (!mutate) return abort({ status: 'refused', reason: 'busy' })
    let admitted: MutationAdmission<LinkedPageResult>
    try {
      admitted = mutate<LinkedPageResult>(path, mutation)
    } catch {
      return abort({ status: 'refused', reason: 'busy' })
    }
    if (!admitted.admitted) return abort({ status: 'refused', reason: 'busy' })
    claims.push({ page, ready, done: admitted.done })
  }

  // Every lane is claimed, or one settled before its claim (its text could not be saved): then
  // nothing is sent and every waiting lane is let go at once, without waiting for slower ones.
  if (claims.length > 0) {
    const allClaimed = Promise.all(claims.map(claim => claim.ready)).then(() => true)
    // A claimed page's change settles only after the gate opens, so this fires only for a failure.
    const settledEarly = Promise.race(claims.map(claim => claim.done.then(() => false, () => false)))
    if (!await Promise.race([allClaimed, settledEarly])) return abort({ status: 'refused', reason: 'notSaved' })
  }

  const openPaths = claims.map(claim => claim.page.lane)
  let reply: unknown = null
  let rejected = false
  let error: unknown
  try {
    reply = await request.dispatch(openPaths)
  } catch (failure) {
    rejected = true
    error = failure
  }
  let parsed: ParsedRenameReply = null
  if (!rejected) {
    try { parsed = request.parse(reply, openPaths) } catch { parsed = null }
  }
  if (parsed === 'unchanged') return abort({ status: 'unchanged' })

  const outcomeOf = (settled: PromiseSettledResult<MutationSettled<LinkedPageResult>>[] | undefined) => {
    const lanes = claims.map(claim => claim.page)
    const held = (settled ?? []).flatMap((result, index) => result.status === 'fulfilled' && result.value.kind === 'returned'
      && lanes[index].result.kind === 'committed' && result.value.integration === 'unmergedDraft' ? [lanes[index].lane] : [])
    return { heldPaths: held, unprovenPaths: lanes.filter(page => page.result.kind === 'unproven').map(page => page.lane) }
  }

  if (parsed !== null) {
    const receipt = parsed
    const settled = await settle(page => {
      const listed = receiptPage(receipt, page.lane)
      if (listed) {
        page.rebase = request.rebaseFor(receipt, { path: page.lane, before: listed.before_content, after: listed.content, baseline: page.baseline })
        return { kind: 'committed', before: listed.before_content, content: listed.content }
      }
      // Native could not refresh this page safely: reconcile it against its current bytes.
      if (receipt.unrefreshed_open_paths.some(path => notePathsMatch(path, page.lane))) return reconcileUnrefreshed(page)
      return UNCHANGED
    })
    return { status: 'renamed', receipt, ...outcomeOf(settled) }
  }

  // Only an explicit backend refusal, emitted inside the completed worker before the source was
  // published, is known (linked pages are rewritten only after that). Anything else is unknown:
  // the worker may still commit, so no page is reread and none is released as unchanged.
  const refusal = rejected ? knownRenameRefusal(error) : null
  if (refusal !== null) return abort({ status: 'refused', reason: 'native', error: refusal })
  const settled = await settle(unknownPage)
  return { status: 'unknown', error, ...outcomeOf(settled) }
}
