import { flushSync } from 'react-dom'
import { onReadyPagesChange, readyPageFor, type HandOver } from '../hooks/useEditorFocus'
import { resumeEditorFocus, suspendEditorFocus } from '../hooks/editorFocusOwnership'
import type { ContentReceipt, ReceiptStatus } from '../hooks/useEditorSave'
import { writeClipboardText } from '../utils/clipboardText'

export type CaptureKind = 'newPage' | 'today'
export type CapturePhase = 'opening' | 'failed' | 'kept' | 'partial'

/** Taken at the command; false once that pane is navigated or closed, or the vault changes. */
export interface NavigationMark {
  pane: number
  current: () => boolean
}

/** What the running operation reports; ignored once a newer attempt or another draft took over. */
export interface CaptureOutcome {
  failed: () => void
  created: (path: string) => void
  shown: (path: string) => void
}

export interface CaptureView {
  token: number
  phase: CapturePhase
  pane: number
  openable: boolean
  finishFirst: boolean
}

/** A page a draft went into: its save-queue session, page and admission, never the words. */
export type DeliveredTarget = Pick<ContentReceipt, 'path' | 'session' | 'seq'>

interface CaptureDeps {
  markNavigation: () => NavigationMark
  openPage: (path: string) => Promise<boolean>
}

interface Capture {
  token: number
  kind: CaptureKind
  attempt: number
  mark: NavigationMark
  /** Still bound to its pane and allowed to hand over by itself. */
  auto: boolean
  outcome: 'pending' | 'failed' | 'created' | 'shown'
  path: string | null
  partial: boolean
  text: string
  composing: boolean
  reconciling: boolean
  finishFirst: boolean
  restart: () => void
}

/** Thrown when quit or a vault switch cannot go ahead over a draft; the draft stays on screen. */
export class CaptureHeldError extends Error {}

/** One draft field per window that holds early keys while a page opens, then hands them over once. */
export class PendingCaptureController {
  private capture: Capture | null = null
  private view: CaptureView | null = null
  private tokens = 0
  private field: HTMLTextAreaElement | null = null
  private handingOff = false
  private reconcileTimer: ReturnType<typeof setTimeout> | null = null
  private stopWatching: (() => void) | null = null
  private holds = 0
  private delivered: DeliveredTarget[] = []
  private readonly listeners = new Set<() => void>()
  private deps: CaptureDeps = {
    markNavigation: () => ({ pane: 0, current: () => false }),
    openPage: async () => false,
  }

  configure(deps: CaptureDeps): void { this.deps = deps }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getView = (): CaptureView | null => this.view

  attachField = (field: HTMLTextAreaElement | null): void => { this.field = field }

  isEmpty(): boolean {
    return !this.holdsWords()
  }

  /** Words, an open composition, or a copy that may already be in a page: nothing may close over them. */
  holdsWords(): boolean {
    const c = this.capture
    return !!c && (c.composing || c.reconciling || c.partial || this.text(c) !== '')
  }

  /** False while a quit or vault switch is closing pages; then no new draft may start. */
  accepting(): boolean { return this.holds === 0 }

  /** True when an existing draft handled the command: joined, or kept with a request to finish it first. */
  claim(kind: CaptureKind): boolean {
    const c = this.capture
    if (!c) return false
    if (c.kind === kind && !c.partial && (c.outcome === 'pending' || c.outcome === 'shown') && c.mark.current()) {
      c.auto = true
      c.finishFirst = false
      this.emit()
      this.focusField()
      this.pump()
      return true
    }
    if (this.isEmpty()) {
      this.retire()
      return false
    }
    c.finishFirst = true
    this.emit()
    this.focusField()
    return true
  }

  /** Shows and focuses the field before the first await; `restart` runs the operation again for Try again. */
  admit(kind: CaptureKind, restart: () => void): CaptureOutcome {
    if (this.capture) this.retire()
    const capture: Capture = {
      token: ++this.tokens, kind, attempt: 0, mark: this.deps.markNavigation(), auto: true, outcome: 'pending',
      path: null, partial: false, text: '', composing: false, reconciling: false, finishFirst: false, restart,
    }
    this.capture = capture
    const outcome = this.bind(capture)
    flushSync(() => this.emit())
    this.focusField()
    this.watch()
    return outcome
  }

  /** A new attempt for the same draft, marked after the operation's own navigation. */
  rebind(): CaptureOutcome {
    const c = this.capture
    if (!c) return { failed: () => {}, created: () => {}, shown: () => {} }
    const outcome = this.bind(c)
    this.emit()
    this.focusField()
    return outcome
  }

  retry(): void {
    const c = this.capture
    if (c?.outcome === 'failed' && !c.partial) c.restart()
  }

  openPage(): void {
    const c = this.capture
    if (!c?.path || c.partial || c.auto) return
    const path = c.path
    const opening = this.deps.openPage(path)
    const outcome = this.rebind()
    opening.then(shown => (shown ? outcome.shown(path) : outcome.created(path)), () => outcome.created(path))
  }

  copy(): Promise<void> {
    const c = this.capture
    return c ? writeClipboardText(this.text(c)) : Promise.resolve()
  }

  discard(): void { this.retire() }

  input(value: string): void {
    const c = this.capture
    if (!c) return
    c.text = value
    if (c.reconciling) this.reconcileAfterComposition()
  }

  compositionStart(): void {
    if (this.capture) this.capture.composing = true
  }

  // Both orders of the final input and compositionend are covered by waiting one more task.
  compositionEnd(): void {
    const c = this.capture
    if (!c) return
    c.composing = false
    this.reconcileAfterComposition()
  }

  /** The person went elsewhere: no automatic hand-over, and the words stay. */
  leave(): void {
    const c = this.capture
    if (!c || !c.auto || this.handingOff) return
    if (this.isEmpty()) {
      this.retire()
      return
    }
    c.auto = false
    this.emit()
  }

  checkOwnership(): void {
    if (this.capture?.auto && !this.capture.mark.current()) this.leave()
  }

  /** Tries the hand-over again after a committed change; it only ever moves a draft that is not in a page. */
  pump(): void {
    queueMicrotask(() => this.tryHandoff())
  }

  /** An empty draft has nothing to keep; Save, quit and switch may drop it. */
  cancelEmpty(): void {
    if (this.capture && this.isEmpty()) this.retire()
  }

  /** Quit and vault switch: refuse while a draft holds words, drop an empty one, and admit none until released. */
  beginBoundary(): () => void {
    if (this.holdsWords()) throw new CaptureHeldError()
    this.cancelEmpty()
    this.holds += 1
    let open = true
    return () => {
      if (!open) return
      open = false
      this.holds -= 1
    }
  }

  /** Just before a quit or switch completes: no draft may have appeared since it began. */
  assertClear(): void {
    if (this.capture) throw new CaptureHeldError()
  }

  deliveredTargets(): readonly DeliveredTarget[] { return [...this.delivered] }

  /**
   * After the ordinary drain: each page a draft went into is written, or moved to Trash, by its save-queue
   * session, or the boundary refuses. Only that proof removes a page from the list.
   */
  async settleDelivered(queue: { status: (target: DeliveredTarget) => ReceiptStatus, save: (path: string) => Promise<unknown> }): Promise<boolean> {
    for (const target of [...this.delivered]) {
      if (queue.status(target) === 'pending') await queue.save(target.path).catch(() => false)
      if (queue.status(target) !== 'settled') return false
      this.delivered = this.delivered.filter(item => item !== target)
    }
    return true
  }

  private bind(c: Capture): CaptureOutcome {
    c.attempt += 1
    c.mark = this.deps.markNavigation()
    c.auto = true
    c.outcome = 'pending'
    c.path = null
    c.finishFirst = false
    const { token, attempt } = c
    const live = () => (this.capture?.token === token && this.capture.attempt === attempt ? this.capture : null)
    return {
      failed: () => this.report(live(), 'failed', null),
      created: path => this.report(live(), 'created', path),
      shown: path => this.report(live(), 'shown', path),
    }
  }

  private report(c: Capture | null, outcome: Capture['outcome'], path: string | null): void {
    if (!c) return
    c.outcome = outcome
    c.path = path
    if (outcome !== 'shown') c.auto = false
    this.emit()
    if (outcome === 'shown') this.tryHandoff()
  }

  // The same request, its own pane, a ready page there and settled text; then keyboard, one insert, the receipt.
  private tryHandoff(): void {
    const c = this.capture
    if (!c || !c.auto || c.outcome !== 'shown' || !c.path || c.composing || c.reconciling) return
    if (!c.mark.current()) {
      this.leave()
      return
    }
    const page = readyPageFor(c.path)
    if (!page || page.pane() !== String(c.mark.pane)) return
    this.handingOff = true
    let result: HandOver
    try {
      result = page.accept(this.text(c))
    } catch (error) {
      console.warn('[capture] The draft could not be added to its page:', error)
      result = { kind: 'uncertain' }
    } finally {
      this.handingOff = false
    }
    if (result.kind === 'notReady') {
      this.keepKeyboard()
      return
    }
    if (result.kind === 'delivered' && result.receipt) {
      const { path, session, seq } = result.receipt
      this.delivered.push({ path, session, seq })
    }
    if (result.kind === 'delivered' && result.focused) {
      this.retire()
      return
    }
    // The page may already hold the words but did not keep the keyboard: a visible copy, never replayed.
    c.partial = true
    c.auto = false
    this.emit()
    this.keepKeyboard()
  }

  private keepKeyboard(): void {
    this.focusField()
    if (this.field && document.activeElement === this.field) suspendEditorFocus(this.field)
  }

  private reconcileAfterComposition(): void {
    const c = this.capture
    if (!c) return
    c.reconciling = true
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer)
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = null
      if (this.capture !== c) return
      c.reconciling = false
      c.text = this.text(c)
      this.tryHandoff()
    }, 0)
  }

  private text(c: Capture): string {
    return this.field?.value ?? c.text
  }

  private focusField(): void {
    this.field?.focus({ preventScroll: true })
  }

  private watch(): void {
    if (this.stopWatching) return
    const handleFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-pending-capture="true"]')) return
      this.leave()
    }
    document.addEventListener('focusin', handleFocusIn, true)
    const stopReady = onReadyPagesChange(() => this.pump())
    this.stopWatching = () => {
      document.removeEventListener('focusin', handleFocusIn, true)
      stopReady()
    }
  }

  private retire(): void {
    if (!this.capture) return
    this.capture = null
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer)
    this.reconcileTimer = null
    this.stopWatching?.()
    this.stopWatching = null
    resumeEditorFocus()
    this.emit()
  }

  private emit(): void {
    const c = this.capture
    this.view = c && {
      token: c.token,
      phase: c.partial ? 'partial' : c.outcome === 'failed' ? 'failed' : c.auto ? 'opening' : 'kept',
      pane: c.mark.pane,
      openable: !c.auto && !c.partial && !!c.path && (c.outcome === 'created' || c.outcome === 'shown'),
      finishFirst: c.finishFirst,
    }
    for (const listener of [...this.listeners]) listener()
  }
}
