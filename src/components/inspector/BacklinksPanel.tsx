import type { Ref } from 'react'
import type { VaultEntry } from '../../types'
import { ArrowUpRight } from '@phosphor-icons/react'
import { Button } from '../ui/button'
import { entryStatusTitle } from './shared'
import { StatusSuffix } from './LinkButton'
import { NoteTitleIcon } from '../NoteTitleIcon'

export interface BacklinkItem {
  entry: VaultEntry
  context: string | null
}

function BacklinkEntry({ entry, context, onOpen }: {
  entry: VaultEntry
  context: string | null
  onOpen: () => void
}) {
  const isDimmed = entry.archived
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="h-auto w-full flex-col items-start justify-start gap-0.5 whitespace-normal px-1.5 py-0.5 text-left font-normal [&_svg:not([class*='size-'])]:size-3.5"
      onClick={onOpen}
      title={entryStatusTitle(entry)}
    >
      <span
        className="flex items-center gap-1 text-xs text-primary"
        style={isDimmed ? { color: 'var(--muted-foreground)' } : undefined}
      >
        <NoteTitleIcon icon={entry.icon} size={14} />
        {entry.title}
        <StatusSuffix isArchived={entry.archived} />
      </span>
      {context && (
        <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
          {context}
        </span>
      )}
    </Button>
  )
}

export function BacklinksPanel({ backlinks, onOpenEntry, emptyLabel, ref }: {
  backlinks: BacklinkItem[]
  onOpenEntry: (entry: VaultEntry) => void
  emptyLabel?: string
  ref?: Ref<HTMLDivElement>
}) {
  if (backlinks.length === 0 && !emptyLabel) return null

  return (
    <div ref={ref}>
      <h4 className="font-mono-overline mb-2 flex items-center gap-1 text-muted-foreground">
        <ArrowUpRight size={12} className="shrink-0" />
        Backlinks{' '}
        <span className="tabular-nums">({backlinks.length})</span>
      </h4>
      {backlinks.length === 0 ? (
        <p className="text-[11px] leading-snug text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="flex flex-col gap-0.5" data-testid="backlinks-list">
          {backlinks.map(({ entry, context }) => (
            <BacklinkEntry
              key={entry.path}
              entry={entry}
              context={context}
              onOpen={() => onOpenEntry(entry)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
