import { useId, useState } from 'react'
import { X } from '@phosphor-icons/react'
import { Button } from '../../components/ui/button'
import type { T } from '../extensions/extensionUiText'
import type { AdaptAttachment } from './adaptAttachments'
import { sizeText } from './adaptText'

/** What a closed preview shows: the first lines, and never more than a screenful of one long line. */
const PREVIEW_LINES = 8
const PREVIEW_CHARS = 1200

function opening(text: string): { shown: string; cut: boolean } {
  const lines = text.split('\n')
  const head = lines.slice(0, PREVIEW_LINES).join('\n')
  const shown = head.length > PREVIEW_CHARS ? head.slice(0, PREVIEW_CHARS) : head
  return { shown, cut: shown.length < text.length }
}

/**
 * The attachments of the draft, each a chip that opens a quiet passive block showing exactly the
 * text Send will carry, as plain text, and a remove button. One block is open at a time. With a
 * single chip in a fresh request it starts open, so what is attached is in sight before Send.
 */
export function AdaptChips({ t, attachments, openSingle, onRemove }: {
  t: T
  attachments: readonly AdaptAttachment[]
  /** A fresh request: a single chip starts open. */
  openSingle: boolean
  onRemove: (id: string) => void
}) {
  const baseId = useId()
  const [open, setOpen] = useState<string | null>(() => (openSingle && attachments.length === 1 ? attachments[0].id : null))
  const [whole, setWhole] = useState(false)
  const shown = attachments.find(item => item.id === open) ?? null
  const toggle = (id: string) => { setOpen(current => (current === id ? null : id)); setWhole(false) }
  const previewId = `${baseId}-preview`
  return <>
    <ul className="ll-adapt-chips" aria-label={t('leadinglight.adapt.attachments')} data-testid="adapt-chips">
      {attachments.map(item => {
        const label = t('leadinglight.adapt.chip', { label: item.label, size: sizeText(item.bytes) })
        return <li key={item.id} className="ll-adapt-chip" data-testid="adapt-chip" data-kind={item.kind}>
          <button type="button" className="ll-adapt-chip-toggle" data-testid="adapt-chip-toggle" aria-expanded={open === item.id}
            aria-controls={open === item.id ? previewId : undefined} onClick={() => toggle(item.id)}>{label}</button>
          <button type="button" className="ll-adapt-chip-remove" aria-label={t('leadinglight.adapt.removeAttachment', { label: item.label })}
            onClick={() => { if (open === item.id) setOpen(null); onRemove(item.id) }}><X aria-hidden="true" /></button>
        </li>
      })}
    </ul>
    {shown && <ChipText t={t} id={previewId} item={shown} whole={whole} onWhole={setWhole} />}
  </>
}

function ChipText({ t, id, item, whole, onWhole }: { t: T; id: string; item: AdaptAttachment; whole: boolean; onWhole: (value: boolean) => void }) {
  const { shown, cut } = opening(item.text)
  return <div id={id} role="region" aria-label={item.label} className="ll-adapt-chip-preview" data-testid="adapt-chip-preview">
    {/* Exactly what Send carries, as React text: never parsed, never markup. */}
    <pre className="ll-adapt-chip-text" data-testid="adapt-chip-text">{whole || !cut ? item.text : shown}</pre>
    {cut && <Button variant="ghost" size="sm" data-testid="adapt-chip-whole" aria-expanded={whole} onClick={() => onWhole(!whole)}>
      {t(whole ? 'leadinglight.commentary.showLess' : 'leadinglight.commentary.showAll')}
    </Button>}
  </div>
}
