// One passage run after its capture: discovery of the source's linked notes, the dialog's
// destination lines and preview, and Add or Create. Add runs inside the commentary page's own save
// lane, so unsaved words in that note are saved first and the reviewed baseline is read after them;
// the controller then sends one whole-page proposal guarded by that baseline. Nothing is retried
// and nothing is rebased: a proven no-write lets the person press Add again for a fresh review.
import type { RunPageExclusive } from '../../hooks/useAppSave'
import type { VaultEntry } from '../../types'
import { joinVaultPath, notePathFilename, notePathsMatch } from '../../utils/notePathIdentity'
import type { FormAnswers, FormField } from '../extensions/extensionContract'
import type {
  CreatedPage, CreateOutcome, ExtensionController, OpenTarget, PreparedPage, RunOpening,
} from '../extensions/extensionSessionController'
import type { UndoOffer } from '../proposals/proposalUndoContract'
import { sha256Hex } from '../saveOutcome'
import type { BesideReservation } from '../useSplitWorkspace'
import type { CapturedPassage, CommentaryPreparation, DestinationPlan } from './commentaryContract'
import type { CommentaryChoice, CommentaryDestinations, CommentaryOption, CommentaryRunView, CommentarySubmit, PaneEffect, SubmitPhase } from './CommentaryDialog'
import { PREPARATION_REASONS, folderOf, relativeTo, type CommentaryServices, type NoteName } from './CommentaryPorts'

/** A committed write, for the commentary's Undo notice. */
export interface CommittedCommentary {
  readonly path: string
  readonly kind: 'create' | 'append'
  readonly sourceTitle: string
  readonly offer: UndoOffer | null
  /** The bytes the write left; Undo is offered only while the note holds exactly these. */
  readonly postimage: string
  /** An append's reviewed baseline, which Undo restores; null for a create. */
  readonly preimage: string | null
  readonly durable: boolean
}

export interface CommentaryRunDeps {
  readonly controller: ExtensionController
  readonly opening: RunOpening
  readonly services: CommentaryServices
  readonly captured: CapturedPassage
  readonly vaultPath: string
  readonly beside: BesideReservation
  /** The listing and open pages as they are now. */
  entries(): readonly VaultEntry[]
  tabs(): readonly { readonly entry: VaultEntry; readonly content: string }[]
  /** The page's bytes on disk, or null. */
  read(path: string): Promise<string | null>
  readonly runPageExclusive: RunPageExclusive
  /** Watcher and listing hooks for a written page. */
  readonly target: OpenTarget
  /** Side by side would leave a pane too narrow: open stacked. */
  narrow(): boolean
  /** A page's label, for "in place of …". */
  labelOf(path: string): string
  /** A listing entry for a page this run created. */
  entryFor(page: CreatedPage): VaultEntry
  /** Caret after the new entry, ready to keep writing. */
  focus(path: string): void
  onCommitted(result: CommittedCommentary): void
  /** Same-source creations run one at a time. */
  serialize<T>(key: string, work: () => Promise<T>): Promise<T>
}

const PREVIEW_ID = '00000000-0000-4000-8000-000000000000'
const PREVIEW_FILE = 'preview.md'

const prepared = (preparation: CommentaryPreparation, expect: (write: Extract<CommentaryPreparation, { status: 'ready' }>['write']) => boolean): PreparedPage => {
  if (preparation.status === 'refused') return { status: 'refused', reason: PREPARATION_REASONS[preparation.reason] }
  return expect(preparation.write) ? { status: 'ready', content: preparation.write.content } : { status: 'refused', reason: 'internal' }
}

function initialChoice(plan: DestinationPlan, vaultPath: string): CommentaryChoice {
  switch (plan.kind) {
    case 'create': return { kind: 'create', separate: plan.separate }
    case 'append': return { kind: 'append', path: joinVaultPath(vaultPath, plan.target.path) }
    case 'choose': return plan.options[0] ? { kind: 'append', path: joinVaultPath(vaultPath, plan.options[0].path) } : { kind: 'create', separate: false }
  }
}

export interface CommentaryRun extends CommentaryRunView {
  /** Starts the bounded local search for linked notes. */
  discover(): Promise<void>
}

export function createCommentaryRun(deps: CommentaryRunDeps): CommentaryRun {
  const { controller, opening, services, captured, vaultPath, beside } = deps
  const folder = folderOf(captured.sourcePath)
  const form = opening.runnable.command.steps.find(step => step.op === 'collectForm')
  const fields: readonly FormField[] = form?.op === 'collectForm' ? form.fields : []
  const listeners = new Set<() => void>()
  let destinations: CommentaryDestinations = { status: 'loading' }
  let closed = false
  /** The kind and title of the write a Check again is about, and an append's baseline. */
  let pending: { kind: 'create' | 'append'; title: string; preimage: string | null } | null = null

  const emit = () => { for (const listener of listeners) listener() }
  const listing = () => ({ vaultPath, entries: deps.entries() })
  const titleOf = (path: string) => {
    const option = destinations.status === 'ready' ? destinations.options.find(item => notePathsMatch(item.path, path)) : undefined
    return option?.title ?? notePathFilename(path).replace(/\.md$/i, '')
  }
  const still = () => !closed && controller.revokedReason(opening) === null

  function nameFor(answers: FormAnswers, separate: boolean): NoteName | null {
    const title = controller.compose(opening, answers, 'create').document?.title?.trim()
    return title ? services.name(title, folder, separate, listing()) : null
  }

  async function show(page: CreatedPage): Promise<boolean> {
    if (!opening.runnable.review.opensResult) return false
    const entry = deps.entries().find(item => notePathsMatch(item.path, page.path)) ?? deps.entryFor(page)
    const shown = await beside.open(entry, page.content, still, { stacked: deps.narrow() }).catch(() => false)
    if (shown) deps.focus(page.path)
    return shown
  }

  async function finish(outcome: CreateOutcome, kind: 'create' | 'append', title: string, preimage: string | null): Promise<CommentarySubmit> {
    switch (outcome.status) {
      case 'committed': {
        pending = null
        const { page, receipt } = outcome
        deps.onCommitted({
          path: page.path, kind, sourceTitle: captured.sourceTitle, offer: outcome.undo, postimage: page.content, preimage, durable: receipt.durable,
        })
        return await show(page) ? { status: 'shown' } : { status: 'notShown', kind, title: page.title || title }
      }
      case 'notWritten':
        pending = null
        return { status: 'notWritten', reason: outcome.reason, title }
      case 'uncertain':
        pending = { kind, title, preimage }
        return { status: 'uncertain', detail: outcome.detail }
      case 'revoked':
        return { status: 'revoked', reason: outcome.reason }
      case 'invalid':
        return { status: 'invalid', problems: outcome.problems }
      case 'opened':
      case 'created':
        // A capture opening never answers these; the write exists, so nothing is sent again.
        return { status: 'notShown', kind, title }
      case 'idle':
        return { status: 'notWritten', reason: 'internal', title }
      case 'busy':
      case 'cancelled':
        return { status: 'busy' }
    }
  }

  function create(answers: FormAnswers, separate: boolean, phase: (phase: SubmitPhase) => void): Promise<CommentarySubmit> {
    const name = nameFor(answers, separate)
    if (!name) return Promise.resolve({ status: 'notWritten', reason: 'invalidName', title: '' })
    return deps.serialize(captured.sourcePath, async () => {
      const commentaryId = crypto.randomUUID()
      phase('creating')
      const outcome = await controller.submit(opening, {
        answers, destination: { kind: 'create', folder, fileName: name.fileName }, target: deps.target,
        prepare: document => prepared(services.prepareCreate({ captured, document, commentaryId, folder, name }),
          write => write.kind === 'create' && write.fileName === name.fileName),
      })
      return finish(outcome, 'create', name.title, null)
    })
  }

  async function append(answers: FormAnswers, path: string, phase: (phase: SubmitPhase) => void): Promise<CommentarySubmit> {
    const title = titleOf(path)
    const relative = relativeTo(vaultPath, path)
    if (!relative) return { status: 'notWritten', reason: 'notAssociated', title }
    phase('saving')
    let published = false
    // Written inside the lane; read once it has finished.
    const lane: { baseline: string | null; ended: { result: CommentarySubmit } | { outcome: CreateOutcome } } = {
      baseline: null, ended: { result: { status: 'busy' } },
    }
    await deps.runPageExclusive(path, async mutate => {
      const admission = mutate(path, {
        async publish(lanePath): Promise<CreateOutcome> {
          published = true
          // A rename while the note saved moves the page; it is reviewed again from its new place.
          if (!notePathsMatch(lanePath, path)) return { status: 'notWritten', reason: 'changed' }
          const disk = await deps.read(path)
          const open = deps.tabs().find(tab => notePathsMatch(tab.entry.path, path))
          // The baseline is the saved note itself; an editor holding other text means it changed.
          if (disk === null || (open && open.content !== disk)) return { status: 'notWritten', reason: 'changed' }
          lane.baseline = disk
          const baselineSha256 = await sha256Hex(disk)
          phase('adding')
          return controller.submit(opening, {
            answers, destination: { kind: 'append', path, baseline: disk }, target: deps.target,
            prepare: document => prepared(services.prepareAppend({ captured, document, path: relative, baseline: disk, baselineSha256 }),
              write => write.kind === 'append' && write.expectedSha256 === baselineSha256),
          })
        },
        committedContent: outcome => (outcome.status === 'committed' ? outcome.page.content : null),
        // Words typed after the write never take it automatically; they wait as an unmerged draft.
        rebase: text => (published ? null : text),
      })
      if (!admission.admitted) return false
      const settled = await admission.done
      lane.ended = settled.kind === 'returned' ? { outcome: settled.result }
        : settled.kind === 'notRun' ? { result: { status: 'notWritten', reason: 'settleFailed', title } }
        : { result: { status: 'uncertain', detail: 'noReply' } }
      return true
    })
    // Shown only once the page lane holds the new bytes.
    const { ended } = lane
    return 'outcome' in ended ? finish(ended.outcome, 'append', title, lane.baseline) : ended.result
  }

  /** A write found committed by Check again: its page lane takes the bytes before it is shown. */
  async function settleRecovered(outcome: CreateOutcome): Promise<void> {
    if (outcome.status !== 'committed' || outcome.receipt.kind !== 'append') return
    const { path, content } = outcome.page
    let published = false
    await deps.runPageExclusive(path, async mutate => {
      const admission = mutate(path, {
        publish: async () => { published = true; return content },
        committedContent: bytes => bytes,
        rebase: text => (published ? null : text),
      })
      if (admission.admitted) await admission.done
      return admission.admitted
    })
  }

  const run: CommentaryRun = {
    commandTitle: opening.runnable.command.title,
    quote: captured.selector.exact,
    fields,
    destinations: () => destinations,
    createName(answers, separate) {
      const name = nameFor(answers, separate)
      return name ? { title: name.title, taken: !separate && services.isTaken(folder, name.fileName, listing()) } : null
    },
    paneEffect(choice): PaneEffect {
      const effect = beside.effect(choice.kind === 'append' ? choice.path : null)
      return effect.kind === 'replaces' ? { kind: 'replaces', page: deps.labelOf(effect.path) } : effect
    },
    preview(answers, choice) {
      const { problems } = controller.compose(opening, answers, choice.kind)
      // The entry is the same whichever note it goes to; a create's document carries a title to name it.
      const document = controller.compose(opening, answers, 'create').document
      const title = document?.title?.trim()
      if (!document || !title) return { markdown: null, problems }
      const preparation = services.prepareCreate({ captured, document, commentaryId: PREVIEW_ID, folder, name: { title, fileName: PREVIEW_FILE } })
      return { markdown: preparation.status === 'ready' ? preparation.entry : null, problems }
    },
    submit(answers, choice, phase) {
      if (!still()) return Promise.resolve({ status: 'revoked', reason: controller.revokedReason(opening) ?? 'workspace' })
      return choice.kind === 'create' ? create(answers, choice.separate, phase) : append(answers, choice.path, phase)
    },
    async checkAgain() {
      const about = pending ?? { kind: 'create' as const, title: '', preimage: null }
      const outcome = await controller.recheck(opening)
      await settleRecovered(outcome)
      return finish(outcome, about.kind, about.title, about.preimage)
    },
    revoked: () => controller.revokedReason(opening),
    subscribe(listener) {
      listeners.add(listener)
      const unsubscribe = controller.subscribe(listener)
      return () => { listeners.delete(listener); unsubscribe() }
    },
    close(how) {
      closed = true
      if (how === 'abandoned') controller.abandon(opening)
      else if (how === 'cancelled') controller.cancel(opening)
      emit()
    },
    async discover() {
      let options: CommentaryOption[] = []
      let incomplete = true
      let plan: DestinationPlan = { kind: 'create', separate: false }
      try {
        const found = await services.discover({ vaultPath, sourcePath: captured.sourcePath, entries: deps.entries(), isCurrent: () => !closed })
        options = found.linked.filter(item => item.appendable).map(item => {
          const path = joinVaultPath(vaultPath, item.path)
          return { path, title: item.title?.trim() || notePathFilename(item.path).replace(/\.md$/i, '') }
        })
        incomplete = !found.complete
        plan = services.plan(found, false)
      } catch (error) {
        console.warn('[commentary] Linked notes could not be listed:', error)
      }
      if (closed) return
      destinations = { status: 'ready', options, incomplete, initial: initialChoice(plan, vaultPath) }
      emit()
    },
  }
  return run
}
