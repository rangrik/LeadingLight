import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CommandAction } from '../../hooks/commands/types'
import type { AppLocale } from '../../lib/i18n'
import type { ExtensionVisit, PackageView } from '../extensions/extensionSessionController'
import { translator } from '../extensions/extensionUiText'
import type { Extensions } from '../extensions/useExtensions'
import type { ExtensionUi } from '../extensions/useExtensionUi'
import { afterPreview, afterUndo, storeRefusal, type Adoption } from './adaptAdoption'
import { pagesOf, revisionBaseOf } from './adaptAttachments'
import type { AdaptController } from './adaptController'
import { AdaptDialog, type CandidateActions } from './AdaptDialog'
import type { PageSnapshot, PassageSnapshot } from './adaptPage'
import { noticeText } from './adaptText'
import type { AskLabels } from './askLabels'
import { askedAbout, rememberAskedAbout } from './askResume'
import type { Adapt } from './useAdapt'

export type { PageSnapshot, PassageSnapshot } from './adaptPage'
export type { AskLabels } from './askLabels'

/** The one stable status beside the Adapt entry: nothing, a turn running, or a reply not seen yet. */
export type AdaptMenuStatus = 'idle' | 'working' | 'ready'

export interface AdaptUiOptions {
  locale: AppLocale
  vaultPath: string
  adapt: Adapt
  extensions: Extensions
  extensionUi: ExtensionUi
  snapshotPage: () => Promise<PageSnapshot>
  /** Keep writing: the host dismisses whatever Adapt was opened from (Settings) and puts focus in the page. */
  onKeepWriting?: () => void
  /** The host's Ask words (its locale). Copy, Selected passage and Another page… need them. */
  ask?: AskLabels
  /** Captures the active pane's selection on the person's click (the E2 capture endpoint). */
  snapshotPassage?: () => PassageSnapshot | Promise<PassageSnapshot>
  /** Lets the person choose a page, then settles and snapshots it; null when they chose none. */
  snapshotAnotherPage?: () => Promise<PageSnapshot | null>
  /** Puts exact text on the clipboard; the app's own clipboard path when absent. */
  copyText?: (text: string) => Promise<void>
  /** A short status for the window, when Ask is not opened (nothing was selected). */
  notify?: (text: string) => void
}

/**
 * The open visit's token once the visit that is opening now answers; null when it does not open.
 * Anything taken on a click before that is attached only to that visit.
 */
function whenVisitOpen(controller: AdaptController): Promise<string | null> {
  const { visit } = controller.snapshot()
  if (visit === 'open') return Promise.resolve(controller.visitToken())
  if (visit !== 'opening') return Promise.resolve(null)
  return new Promise(resolve => {
    const stop = controller.subscribe(() => {
      const now = controller.snapshot().visit
      if (now === 'opening') return
      stop()
      resolve(now === 'open' ? controller.visitToken() : null)
    })
  })
}

/**
 * Where an adoption action started: the Adapt visit and the E1 visit, as objects of that moment.
 * Every step after an await, and every callback, acts only while both are still the current ones;
 * otherwise it does nothing and writes nothing (another vault, or the same vault visited again).
 */
interface Origin { readonly visit: string; readonly extensions: ExtensionVisit }

/**
 * The Adapt dialog and its handoff to E1. A candidate is stored by E1 import, shown in the E1
 * preview while this dialog steps aside (one dialog at a time), turned on only by that preview's
 * Turn on, tried through the E1 form, and undone by E1 activation. What became of each candidate is
 * kept for this Adapt visit only. A version turned on here becomes the visible extension chip of the
 * next request, so the conversation can go on changing exactly that version.
 */
export function useAdaptUi(options: AdaptUiOptions) {
  const { locale, adapt, extensions, extensionUi } = options
  const { controller, snapshot } = adapt
  const t = useMemo(() => translator(locale), [locale])
  const latest = useRef(options)
  useLayoutEffect(() => { latest.current = options })
  const [open, setOpen] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  // Another page… shows the page finder; this dialog steps aside meanwhile, as for the E1 preview.
  const [picking, setPicking] = useState(false)
  // Another vault: its visit ended with it, so the dialog closes; opening it again starts the new one.
  const [openFor, setOpenFor] = useState(options.vaultPath)
  if (openFor !== options.vaultPath) {
    setOpenFor(options.vaultPath)
    setOpen(false)
  }
  const [kept, setKept] = useState<{ visit: string | null; byTurn: Readonly<Record<string, Adoption>> }>({ visit: null, byTurn: {} })
  const adoptions = useMemo(() => (kept.visit !== null && kept.visit === snapshot.visitId ? kept.byTurn : {}), [kept, snapshot.visitId])
  const visible = open && !previewing && !picking
  const openRef = useRef(false)
  const opener = useRef<HTMLElement | null>(null)
  const returnFocus = useRef(true)
  useLayoutEffect(() => { openRef.current = open })
  useEffect(() => { controller.setLooking(visible) }, [controller, visible])
  // A Send about a page or passage makes this window return to that conversation for that page.
  // Paths and ids only, kept locally per vault; nothing of it is ever sent.
  useEffect(() => controller.onAdmitted((conversationId, attachments) => {
    rememberAskedAbout(latest.current.vaultPath, pagesOf(attachments), conversationId)
  }), [controller])

  const originNow = useCallback((): Origin | null => {
    const visit = controller.visitToken()
    const visitOfExtensions = extensions.controller.visit()
    return visit && visitOfExtensions?.isOpen() ? { visit, extensions: visitOfExtensions } : null
  }, [controller, extensions.controller])
  const stillCurrent = useCallback((origin: Origin) =>
    controller.visitToken() === origin.visit && extensions.controller.visit() === origin.extensions && origin.extensions.isOpen(), [controller, extensions.controller])

  /** Records what became of a reply's candidate, only for the visit the action started in. */
  const adopt = useCallback((origin: Origin, turnId: string, next: Adoption | null | ((current: Adoption | undefined) => Adoption | null)) => {
    if (!stillCurrent(origin)) return
    setKept(state => {
      const byTurn = state.visit === origin.visit ? { ...state.byTurn } : {}
      const value = typeof next === 'function' ? next(byTurn[turnId]) : next
      if (value) byTurn[turnId] = value
      else delete byTurn[turnId]
      return { visit: origin.visit, byTurn }
    })
  }, [stillCurrent])

  const show = useCallback(() => {
    if (!adapt.ensureVisit()) return false
    if (!openRef.current) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    returnFocus.current = true
    setOpen(true)
    void controller.listConversations()
    return true
  }, [adapt, controller])

  /** Adjust on a Settings row: a fresh request with that extension attached. */
  const adjust = useCallback((view: PackageView) => {
    if (show()) controller.adjust(view)
  }, [controller, show])

  const close = useCallback(() => setOpen(false), [])
  /**
   * Keep writing closes Adapt and goes back to the page: focus is the host's to place, not returned
   * to what opened Adapt. A Send in flight, its turn and the draft are left exactly as they are.
   */
  const keepWriting = useCallback(() => {
    returnFocus.current = false
    setOpen(false)
    latest.current.onKeepWriting?.()
  }, [])
  const onCloseAutoFocus = useCallback((event: Event) => {
    event.preventDefault()
    // Stepping aside for the E1 preview, or for Try it's form, leaves focus to them.
    if (openRef.current || !returnFocus.current) return
    if (opener.current?.isConnected) opener.current.focus()
  }, [])

  const attachPage = useCallback(async () => {
    const visit = controller.visitToken()
    const page = await latest.current.snapshotPage()
    // A page read for one visit is never attached in another.
    if (visit && controller.visitToken() === visit) controller.attachPage(page)
  }, [controller])
  const attachPassage = useCallback(async () => {
    const { snapshotPassage, ask } = latest.current
    if (!snapshotPassage || !ask) return
    const visit = controller.visitToken()
    const passage = await snapshotPassage()
    if (visit && controller.visitToken() === visit) controller.attachPassage(passage, ask.passageFrom)
  }, [controller])
  const attachAnotherPage = useCallback(async () => {
    const { snapshotAnotherPage } = latest.current
    if (!snapshotAnotherPage) return
    const visit = controller.visitToken()
    setPicking(true)
    let page: PageSnapshot | null = null
    try {
      page = await snapshotAnotherPage()
    } finally {
      setPicking(false)
    }
    // Choosing no page attaches nothing and says nothing.
    if (page !== null && visit && controller.visitToken() === visit) controller.attachPage(page)
  }, [controller])

  /**
   * Ask about the page in front, or the passage selected in it, by the command's own click: the
   * passage is captured at once, the page once its words are saved. Ask then returns to the
   * conversation that last asked about that page (as stored: nothing is read again), else to a fresh
   * request that keeps what is typed, and attaches the one chip. Nothing is sent.
   */
  const openAbout = useCallback(async (kind: 'page' | 'passage') => {
    const o = latest.current
    const vault = o.vaultPath
    let taking: Promise<PageSnapshot | PassageSnapshot>
    if (kind === 'passage') {
      if (!o.snapshotPassage || !o.ask) return
      const passage = await o.snapshotPassage()
      if (typeof passage === 'string') {
        o.notify?.(passage === 'noSelection' ? t('leadinglight.ask.selectFirst') : noticeText(t, { kind: 'attachRefused', reason: passage }, o.ask))
        return
      }
      taking = Promise.resolve(passage)
    } else {
      taking = o.snapshotPage()
    }
    if (!show()) return
    const [taken, visit] = await Promise.all([taking, whenVisitOpen(controller)])
    if (!visit || latest.current.vaultPath !== vault || controller.visitToken() !== visit) return
    const path = typeof taken === 'string' ? null : taken.key ?? null
    const remembered = path ? askedAbout(vault, path) : null
    if (remembered && controller.snapshot().conversationId !== remembered) await controller.show(remembered)
    else if (!remembered) controller.startFresh()
    if (controller.visitToken() !== visit) return
    if (kind === 'passage' && typeof taken !== 'string') controller.attachPassage(taken, latest.current.ask?.passageFrom ?? (title => title))
    else controller.attachPage(taken as PageSnapshot)
  }, [controller, show, t])

  /** Palette entries that open Ask about the page in front or its selected passage, on that click. */
  const paletteCommands = useMemo<CommandAction[]>(() => [
    { id: 'ask-about-page', label: t('leadinglight.ask.aboutPage'), group: 'Note', enabled: true,
      keywords: ['ask', 'page', 'codex', 'question', 'explain', 'summarize'], execute: () => { void openAbout('page') } },
    ...(options.snapshotPassage && options.ask ? [{ id: 'ask-about-passage', label: t('leadinglight.ask.aboutPassage'), group: 'Note' as const, enabled: true,
      keywords: ['ask', 'passage', 'selection', 'codex', 'explain'], execute: () => { void openAbout('passage') } }] : []),
  ], [openAbout, options.ask, options.snapshotPassage, t])

  const store = useCallback(async (turnId: string, packageText: string) => {
    const origin = originNow()
    if (!origin) return null
    adopt(origin, turnId, { status: 'working' })
    const outcome = await extensions.controller.importText(packageText)
    // The visit moved on (another vault, another account): nothing more happens for this reply.
    if (!stillCurrent(origin)) return null
    if (outcome.status !== 'candidate') { adopt(origin, turnId, { status: 'refused', text: storeRefusal(t, outcome) }); return null }
    return { outcome, origin }
  }, [adopt, extensions.controller, originNow, stillCurrent, t])

  const candidates = useMemo<CandidateActions>(() => ({
    async preview(turnId, packageText, expected) {
      const stored = await store(turnId, packageText)
      if (!stored) return
      const { outcome, origin } = stored
      setPreviewing(true)
      const shown = extensionUi.reviewCandidate(outcome, expected, ending => {
        setPreviewing(false)
        if (!stillCurrent(origin)) return
        adopt(origin, turnId, afterPreview(t, ending, outcome, expected, origin.extensions.id))
        // Turned on here: the next request changes exactly this version, and the person sees it attached.
        if (ending.turnedOn) controller.attachPackage(outcome.extension, { sha256: outcome.packageSha256, activeSha256: outcome.packageSha256 })
      }, () => stillCurrent(origin))
      if (!shown) { setPreviewing(false); adopt(origin, turnId, { status: 'notTurnedOn' }) }
    },
    async keep(turnId, packageText, available) {
      const stored = await store(turnId, packageText)
      if (stored) adopt(stored.origin, turnId, { status: 'kept', available })
    },
    tryIt(turnId) {
      const on = adoptions[turnId]
      const origin = originNow()
      if (on?.status !== 'on' || !on.tryKey || !origin || origin.extensions.id !== on.scope) return
      // Exactly the version turned on here; if another version is on now, its form is not opened.
      const started = extensionUi.openRun(on.tryKey, page => adopt(origin, turnId, current => current?.status === 'on' ? { ...current, made: page.displayPath } : current ?? null), on.sha256)
      if (started === 'opened') { returnFocus.current = false; setOpen(false) }
      if (started === 'changed') adopt(origin, turnId, { ...on, problem: t('leadinglight.adapt.tryChanged', { name: on.name }) })
    },
    async undo(turnId) {
      const on = adoptions[turnId]
      const origin = originNow()
      if (on?.status !== 'on' || on.undoing || !origin || origin.extensions.id !== on.scope) return
      adopt(origin, turnId, { ...on, undoing: true })
      const outcome = on.previous === null
        ? await extensions.controller.deactivate(on.packageId, on.sha256)
        : await extensions.controller.activate(on.packageId, on.previous, on.sha256)
      if (!stillCurrent(origin)) return
      const registry = extensions.controller.snapshot()
      const view = registry.status === 'ready' ? registry.packages.find(item => item.packageId === on.packageId) : undefined
      adopt(origin, turnId, afterUndo(t, on, outcome, view?.versions.find(item => item.packageSha256 === on.previous)?.version ?? ''))
      // The chip this window attached for that version follows the undo, so the next request starts from what is on now.
      if (outcome.status === 'done' && view && revisionBaseOf(controller.snapshot().draft.attachments)?.sha256 === on.sha256) controller.attachFromView(view)
    },
  }), [adopt, adoptions, controller, extensionUi, extensions.controller, originNow, stillCurrent, store, t])

  const menuStatus: AdaptMenuStatus = snapshot.attempt || snapshot.conversation?.turn ? 'working' : snapshot.unseenReply ? 'ready' : 'idle'

  return {
    open: show, adjust, close, menuStatus, openAbout, paletteCommands,
    /** True while the dialog is open, or stepped aside for the E1 preview it opened. */
    isOpen: useCallback(() => openRef.current, []),
    dialog: visible ? (
      <AdaptDialog locale={locale} snapshot={snapshot} controller={controller} registry={extensions.snapshot} review={extensions.controller.reviewOf} adoptions={adoptions}
        candidates={candidates} onAttachPage={() => { void attachPage() }} onClose={close} onKeepWriting={keepWriting} onCloseAutoFocus={onCloseAutoFocus}
        ask={options.ask ?? null} copyText={options.copyText}
        onAttachPassage={options.snapshotPassage ? () => { void attachPassage() } : undefined}
        onAttachAnotherPage={options.snapshotAnotherPage ? () => { void attachAnotherPage() } : undefined} />
    ) : null,
  }
}

export type AdaptUi = ReturnType<typeof useAdaptUi>
