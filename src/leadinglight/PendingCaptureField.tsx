import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useInspectorFocusBoundary } from '../hooks/editorFocusOwnership'
import { translate, type AppLocale, type TranslationKey } from '../lib/i18n'
import type { CapturePhase, CaptureView, PendingCaptureController } from './pendingCapture'
import './pendingCapture.css'

const STATUS: Record<CapturePhase, TranslationKey> = {
  opening: 'leadinglight.capture.opening',
  failed: 'leadinglight.capture.failed',
  kept: 'leadinglight.capture.kept',
  partial: 'leadinglight.capture.partial',
}

const SIDES = ['top', 'left', 'width', 'height', 'right', 'bottom'] as const
type Anchor = Partial<Record<(typeof SIDES)[number], string>>
const px = (value: number) => `${value}px`

// While opening it covers its pane's body; afterwards it is a small card that leaves the pages usable.
function anchorFor(pane: number, cover: boolean): Anchor {
  const section = document.querySelector<HTMLElement>(`[data-pane-id="${pane}"]`)
  const area = cover && section ? section : document.querySelector<HTMLElement>('.app__editor')
  const rect = area?.getBoundingClientRect()
  if (!rect || rect.width === 0 || rect.height === 0) return {}
  if (cover && section) {
    const top = section.querySelector('.ll-pane-header')?.getBoundingClientRect().bottom ?? rect.top
    return { top: px(top), left: px(rect.left), width: px(rect.width), height: px(rect.bottom - top), right: 'auto', bottom: 'auto' }
  }
  return { right: px(window.innerWidth - rect.right + 16), bottom: px(window.innerHeight - rect.bottom + 16) }
}

// Placed on every render (pane moves and resizes re-render App) and on window resize.
function useAnchor(rootRef: RefObject<HTMLDivElement | null>, pane: number, cover: boolean): void {
  const place = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    const anchor = anchorFor(pane, cover)
    for (const side of SIDES) root.style[side] = anchor[side] ?? ''
  }, [rootRef, pane, cover])
  useLayoutEffect(() => { place() })
  useEffect(() => {
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [place])
}

function CaptureSurface({ controller, view, locale }: { controller: PendingCaptureController, view: CaptureView, locale: AppLocale }) {
  const t = (key: TranslationKey) => translate(locale, key)
  const rootRef = useRef<HTMLDivElement>(null)
  const [confirming, setConfirming] = useState(false)
  // Focus in the field keeps background editor focus requests from taking the keyboard.
  useInspectorFocusBoundary(rootRef)
  const cover = view.phase === 'opening'
  useAnchor(rootRef, view.pane, cover)
  const attachField = useCallback((field: HTMLTextAreaElement | null) => controller.attachField(field), [controller])
  const discard = () => (controller.isEmpty() ? controller.discard() : setConfirming(true))
  return (
    <div ref={rootRef} className="ll-capture" data-pending-capture="true" data-cover={cover}>
      <Textarea ref={attachField} className="ll-capture-field" aria-label={t('leadinglight.capture.label')}
        onChange={event => controller.input(event.currentTarget.value)}
        onCompositionStart={() => controller.compositionStart()} onCompositionEnd={() => controller.compositionEnd()} />
      <p role="status" className="ll-capture-status">{t(STATUS[view.phase])}</p>
      {view.finishFirst && <p role="status" className="ll-capture-status">{t('leadinglight.capture.finishFirst')}</p>}
      {!cover && <div className="ll-capture-actions">
        {view.phase === 'failed' && <Button size="sm" onClick={() => controller.retry()}>{t('leadinglight.capture.retry')}</Button>}
        {view.openable && <Button size="sm" onClick={() => controller.openPage()}>{t('leadinglight.capture.openPage')}</Button>}
        <Button size="sm" variant="ghost" onClick={() => { void controller.copy().catch(() => {}) }}>{t('leadinglight.capture.copy')}</Button>
        <Button size="sm" variant="ghost" onClick={discard}>{t('leadinglight.capture.discard')}</Button>
      </div>}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent showCloseButton={false} data-pending-capture="true">
          <DialogHeader>
            <DialogTitle>{t('leadinglight.capture.discardTitle')}</DialogTitle>
            <DialogDescription>{t('leadinglight.capture.discardBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>{t('leadinglight.capture.keep')}</Button>
            <Button variant="destructive" onClick={() => controller.discard()}>{t('leadinglight.capture.discard')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** The window's one pending draft field, outside every inert or remounting pane. */
export function PendingCaptureField({ controller, locale }: { controller: PendingCaptureController, locale: AppLocale }) {
  const view = useSyncExternalStore(controller.subscribe, controller.getView)
  // Any navigation of its pane shows up as a render here; the draft then stops waiting for that page.
  useLayoutEffect(() => { controller.checkOwnership() })
  return view ? <CaptureSurface key={view.token} controller={controller} view={view} locale={locale} /> : null
}
