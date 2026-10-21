/**
 * The shared managed rename flow for filename, title and automatic renames:
 * admission ticket -> linked lanes claimed -> one dispatch with open pages -> canonical routing
 * -> source settlement under the caller's source hold -> linked integration.
 *
 * The caller owns the source hold (manual barrier or automatic in-flight registration) and
 * should take the admission ticket before it; a missing ticket is taken here, fail-fast.
 * Amendment B1: a rejected or unreadable reply is a refusal only when the backend marked it as one;
 * otherwise it is unknown: the source draft is held, linked pages settle unproven, nothing is reread.
 */
import type { MutateExistingDocument } from '../../hooks/useAppSave'
import type { VaultEntry } from '../../types'
import { normalizeNotePathForIdentity, notePathsMatch } from '../../utils/notePathIdentity'
import { renameWithLinkedPages, type LinkedRenameOutcome } from './linkedRename'
import { managedRenameAdmission, type RenameAdmission } from './renameAdmission'
import { parseRenameReceipt, type RenameDestination, type RenameReceipt } from './renameReceipt'
import { linkedRebase, sourceRebase, type DraftRebase } from './renameSettlement'

/**
 * Save-queue seam: a held page's pending text takes `rebase`, or stays pending and unmerged
 * so autosave skips it. Editor buffers are flushed into the queue first.
 */
export type RebaseHeldDraft = (path: string, rebase: DraftRebase) => 'none' | 'rebased' | 'unmergedDraft'

interface Tab { entry: VaultEntry; content: string }

export interface ManagedRenameServices {
  admission?: RenameAdmission
  /** Linked open pages are claimed through this seam; without it they are only refreshed by exact match. */
  mutateExistingDocument?: MutateExistingDocument
  rebaseHeldDraft?: RebaseHeldDraft
  tabsRef: { readonly current: readonly Tab[] }
  setTabs: (update: (tabs: Tab[]) => Tab[]) => void
  /** Pages besides the source whose text the app holds; every open tab by default. */
  linkedPaths?: (sourcePath: string) => readonly string[]
  /**
   * Synchronously pushes the actual rich/raw editor buffers registered under `path` into the save
   * queue. Called for the old identity before routing, then for the new one (Amendment B §3).
   */
  flushEditorBuffers?: (path: string) => void
  /**
   * The source of an `unknown` rename: kept from saving, typed or clean, and from any further page
   * change or rename, until the app can establish what happened (the save queue's unresolved state).
   */
  holdUnproven?: (path: string) => unknown
}

export interface ManagedRenameRequest {
  sourcePath: string
  vaultPath: string
  /** The title native treats as old: the title hint, else the page's own title. */
  oldTitle: string
  destination: RenameDestination
  dispatch: (openPaths: string[]) => Promise<unknown>
  /** Automatic renames answer null when the page is not renamed. */
  allowUnchanged?: boolean
  /** The saved text the source's newer drafts are based on, when the caller already read it. */
  sourceBaseline?: string
  /**
   * Reads the source's saved text right before dispatch. Under the source hold this is what native
   * reads, so it is the ancestor of any held draft. The source tab's text is the last fallback.
   */
  readSource?: () => Promise<string | undefined>
  /** A page's saved bytes; proves an unproven linked page untouched or re-establishes it exactly. */
  readPage?: (path: string) => Promise<string | undefined>
  /** Canonical path routing for the committed new path; runs before any later await. */
  route: (oldPath: string, newPath: string) => void
}

export type ManagedRenameResult =
  | {
    status: 'renamed'
    receipt: RenameReceipt
    /** The source text the tab holds after settlement. */
    sourceText: string
    /** Text typed during the rename that could not take the change: kept, not saved. */
    sourceHeld: boolean
    heldPaths: string[]
    /** Open pages that could not be protected or refreshed (callers without the save seam). */
    stalePaths: string[]
    /** Linked pages whose disk state the reply did not prove (already counted in `failed_updates`). */
    unprovenPaths: string[]
  }
  | { status: 'unchanged' }
  | Extract<LinkedRenameOutcome, { status: 'refused' | 'unknown' }>

const inVault = (path: string, vaultPath: string) => normalizeNotePathForIdentity(path).startsWith(`${normalizeNotePathForIdentity(vaultPath)}/`)

function tabText(tabs: readonly Tab[], path: string): string | undefined {
  return tabs.find(tab => notePathsMatch(tab.entry.path, path))?.content
}

export async function runManagedRename(request: ManagedRenameRequest, services: ManagedRenameServices): Promise<ManagedRenameResult> {
  const { sourcePath, vaultPath } = request
  const admission = services.admission ?? managedRenameAdmission
  const candidates = services.linkedPaths?.(sourcePath) ?? services.tabsRef.current.map(tab => tab.entry.path)
  const linked = candidates.filter((path, index) => inVault(path, vaultPath) && !notePathsMatch(path, sourcePath)
    && candidates.findIndex(other => notePathsMatch(other, path)) === index)
  let ticket = admission.held(sourcePath)
  const owned = ticket === null
  ticket ??= admission.admit(sourcePath, linked)
  if (!ticket || !ticket.extend(linked)) {
    if (owned) ticket?.release()
    return { status: 'refused', reason: 'busy' }
  }
  try {
    const readSource = request.readSource ?? (request.readPage ? () => request.readPage!(sourcePath) : undefined)
    const readText = async () => (readSource
      ? readSource().then(text => (typeof text === 'string' ? text : undefined), () => undefined)
      : undefined)
    const read = request.sourceBaseline === undefined ? await readText() : undefined
    const baseline = request.sourceBaseline ?? read ?? tabText(services.tabsRef.current, sourcePath)
    const protect = services.mutateExistingDocument !== undefined
    const outcome = await renameWithLinkedPages({
      ticket,
      sourcePath,
      linkedPaths: protect ? linked : [],
      mutate: services.mutateExistingDocument,
      baselineOf: path => tabText(services.tabsRef.current, path),
      dispatch: openPaths => request.dispatch(protect ? openPaths : linked),
      parse: (reply, openPaths) => reply === null && request.allowUnchanged
        ? 'unchanged'
        : parseRenameReceipt(reply, { sourcePath, openPaths: protect ? openPaths : linked, destination: request.destination }),
      rebaseFor: (receipt, page) => linkedRebase(receipt, page, { vaultPath, oldPath: sourcePath, oldTitle: request.oldTitle }),
      readPage: request.readPage,
    })
    if (outcome.status === 'refused' || outcome.status === 'unchanged') return outcome
    if (outcome.status === 'unknown') {
      // No proof either way. The source is marked first, before the caller's hold or this ticket is
      // released, so nothing below (an editor buffer that cannot be read included) leaves it writable.
      services.holdUnproven?.(sourcePath)
      try {
        // The editor is still registered under this identity; its words join the held queue.
        services.flushEditorBuffers?.(sourcePath)
      } catch (error) {
        console.warn('[rename] The page\'s editor could not be read after an unconfirmed rename; it stays held:', error)
      }
      // Words typed meanwhile are kept, never saved as if the change were known.
      services.rebaseHeldDraft?.(sourcePath, () => null)
      return outcome
    }
    // Synchronous from here: the editor is still registered under the old identity until routing
    // re-renders it, so its pending buffer joins the held queue first (Amendment B §3).
    services.flushEditorBuffers?.(sourcePath)
    const { receipt } = outcome
    if (!notePathsMatch(receipt.new_path, sourcePath)) {
      request.route(sourcePath, receipt.new_path)
      services.flushEditorBuffers?.(receipt.new_path)
    }
    const source = settleSource(receipt, sourcePath, sourceRebase(receipt, { vaultPath, oldPath: sourcePath }, baseline), services)
    const stalePaths = protect ? [] : refreshUnprotected(receipt, linked, services)
    return {
      status: 'renamed', receipt, sourceText: source.text, sourceHeld: source.held,
      heldPaths: outcome.heldPaths, stalePaths, unprovenPaths: outcome.unprovenPaths,
    }
  } finally {
    if (owned) ticket.release()
  }
}

function setTabText(services: ManagedRenameServices, paths: readonly string[], content: string, only?: (current: string) => boolean) {
  services.setTabs(tabs => tabs.map(tab => paths.some(path => notePathsMatch(tab.entry.path, path)) && (!only || only(tab.content))
    ? { ...tab, content }
    : tab))
}

/** Runs before the caller releases its source hold, so no old-base draft is ever autosaved. */
function settleSource(receipt: RenameReceipt, oldPath: string, rebase: DraftRebase, services: ManagedRenameServices): { text: string; held: boolean } {
  const paths = [receipt.new_path, oldPath]
  if (services.rebaseHeldDraft) {
    const seen: { text: string | null } = { text: null }
    const state = services.rebaseHeldDraft(receipt.new_path, draft => {
      const rebased = rebase(draft)
      seen.text = rebased ?? draft
      return rebased
    })
    if (state === 'none') {
      setTabText(services, paths, receipt.source_content)
      return { text: receipt.source_content, held: false }
    }
    return { text: seen.text ?? receipt.source_content, held: state === 'unmergedDraft' }
  }
  // A caller without the save seam: only the exact before-image is replaced.
  const shown = tabText(services.tabsRef.current, oldPath) ?? tabText(services.tabsRef.current, receipt.new_path)
  if (shown === undefined || shown === receipt.source_before_content) {
    setTabText(services, paths, receipt.source_content, current => current === receipt.source_before_content)
    return { text: receipt.source_content, held: false }
  }
  return { text: shown, held: false }
}

/** Without lane claims a linked tab is refreshed only from its exact before-image. */
function refreshUnprotected(receipt: RenameReceipt, linked: readonly string[], services: ManagedRenameServices): string[] {
  const stale = new Set(receipt.unrefreshed_open_paths)
  for (const page of receipt.updated_open_pages) {
    const shown = tabText(services.tabsRef.current, page.path)
    if (shown !== undefined && shown !== page.before_content) stale.add(page.path)
    setTabText(services, [page.path], page.content, current => current === page.before_content)
  }
  return [...stale].filter(path => linked.some(item => notePathsMatch(item, path)))
}

export interface AutomaticRenameSeams {
  admission?: RenameAdmission
  /** The untitled rename's own path map; its promise is what a save of this page waits for. */
  inFlight: Map<string, Promise<string>>
  vaultPath: string
  /** Pages besides the source whose text the app holds. */
  linkedPaths: (sourcePath: string) => readonly string[]
  /** The page's own title as native reads it (H1, then front matter, then filename). */
  oldTitle: (sourcePath: string) => string
  /** The source's saved text, read right before dispatch (see `ManagedRenameRequest.readSource`). */
  readSource?: (sourcePath: string) => Promise<string | undefined>
  /** Any page's saved bytes (see `ManagedRenameRequest.readPage`). */
  readPage?: (path: string) => Promise<string | undefined>
  dispatch: (sourcePath: string, openPaths: string[]) => Promise<unknown>
  holdAutosave: (paths: readonly string[]) => void
  releaseAutosave: (paths: readonly string[], action: 'resume') => void
  services: Pick<ManagedRenameServices, 'mutateExistingDocument' | 'rebaseHeldDraft' | 'tabsRef' | 'setTabs' | 'flushEditorBuffers' | 'holdUnproven'>
  route: (oldPath: string, newPath: string) => void
  /** Entry refresh after the source settled; no other page is reloaded. */
  afterRename?: (oldPath: string, result: Extract<ManagedRenameResult, { status: 'renamed' }>) => Promise<void>
}

/**
 * The one-shot untitled rename in the frozen order: admission ticket (fail-fast, nothing
 * dispatched), then the source hold and its in-flight promise, then the managed rename with
 * source settlement, then release. Resolves whether the page now has a new path.
 */
export async function runAutomaticRename(sourcePath: string, seams: AutomaticRenameSeams): Promise<boolean> {
  const existing = seams.inFlight.get(sourcePath)
  if (existing) return (await existing) !== sourcePath
  const admission = seams.admission ?? managedRenameAdmission
  const linked = seams.linkedPaths(sourcePath)
  // Before this page's own registration, so two intersecting renames never wait on each other.
  const ticket = admission.admit(sourcePath, linked)
  if (!ticket) return false
  seams.holdAutosave([sourcePath])
  const running = (async () => {
    try {
      const result = await runManagedRename({
        sourcePath,
        vaultPath: seams.vaultPath,
        oldTitle: seams.oldTitle(sourcePath),
        destination: { siblingOf: sourcePath },
        allowUnchanged: true,
        readSource: seams.readSource ? () => seams.readSource!(sourcePath) : undefined,
        readPage: seams.readPage,
        dispatch: openPaths => seams.dispatch(sourcePath, openPaths),
        route: seams.route,
      }, { ...seams.services, admission, linkedPaths: () => linked })
      if (result.status !== 'renamed' || notePathsMatch(result.receipt.new_path, sourcePath)) return sourcePath
      await seams.afterRename?.(sourcePath, result)
      return result.receipt.new_path
    } catch (error) {
      console.warn('[rename] The automatic rename could not settle:', error)
      return sourcePath
    } finally {
      seams.inFlight.delete(sourcePath)
    }
  })()
  seams.inFlight.set(sourcePath, running)
  try {
    return (await running) !== sourcePath
  } finally {
    seams.releaseAutosave([sourcePath], 'resume')
    ticket.release()
  }
}
