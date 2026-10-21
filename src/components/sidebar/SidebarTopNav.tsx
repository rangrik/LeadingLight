import { Archive, CalendarDot, FileText, MagnifyingGlass, Plus, Trash, Tray } from '@phosphor-icons/react'
import type { SidebarSelection } from '../../types'
import { isSelectionActive, NavItem } from '../SidebarParts'
import { translate, type AppLocale } from '../../lib/i18n'
import { Button } from '../ui/button'

interface SidebarTopNavProps {
  selection: SidebarSelection
  onSelect: (selection: SidebarSelection) => void
  onSearch?: () => void
  onCreatePage?: () => void
  onCreateFromTemplate?: () => void
  /** Shown only while an extension command can run; one entry, never one per extension. */
  onCreateFromExtension?: () => void
  /** Adapt's entry; its label is Adapt's one status: a turn running, or a reply not seen yet. */
  onAdapt?: () => void
  adaptStatus?: 'idle' | 'working' | 'ready'
  onOpenToday?: () => void
  /** False until the vault listing and restored layout are ready. */
  canOpenToday?: boolean
  onOpenTrash?: () => void
  showInbox: boolean
  inboxCount: number
  activeCount: number
  archivedCount: number
  locale?: AppLocale
  loading?: boolean
}

export function SidebarTopNav(options: SidebarTopNavProps) {
  const { selection, onSelect, onSearch, onCreatePage, onCreateFromTemplate, onCreateFromExtension, onAdapt, adaptStatus = 'idle', onOpenToday, canOpenToday = true, onOpenTrash, showInbox, inboxCount, activeCount, archivedCount, locale = 'en', loading = false } = options
  const adaptLabel = adaptStatus === 'working' ? 'leadinglight.adapt.menuWorking' : adaptStatus === 'ready' ? 'leadinglight.adapt.menuReady' : 'leadinglight.adapt.menu'
  return (
    <div className="border-b border-border" data-testid="sidebar-top-nav" style={{ padding: '4px 6px' }}>
      {/* Called without the click event, which would otherwise read as a type. */}
      {onCreatePage && <NavItem icon={Plus} label={translate(locale, 'leadinglight.split.create')} onClick={() => onCreatePage()} disabled={loading} />}
      {onCreateFromTemplate && <Button variant="ghost" size="sm" className="h-7 w-full justify-start pl-8 text-xs font-normal text-muted-foreground"
        disabled={loading} onClick={() => onCreateFromTemplate()}>{translate(locale, 'leadinglight.templates.shortAction')}</Button>}
      {onCreateFromExtension && <Button variant="ghost" size="sm" className="h-7 w-full justify-start pl-8 text-xs font-normal text-muted-foreground"
        disabled={loading} onClick={() => onCreateFromExtension()}>{translate(locale, 'leadinglight.extensions.shortAction')}</Button>}
      {onAdapt && <Button variant="ghost" size="sm" className="h-7 w-full justify-start pl-8 text-xs font-normal text-muted-foreground"
        data-testid="sidebar-adapt" data-status={adaptStatus} disabled={loading} onClick={() => onAdapt()}>{translate(locale, adaptLabel)}</Button>}
      {onSearch &&<NavItem icon={MagnifyingGlass} label={translate(locale, 'leadinglight.find.action')} onClick={onSearch} />}
      {onOpenToday && <NavItem icon={CalendarDot} label={translate(locale, 'leadinglight.today.action')} onClick={onOpenToday} disabled={loading || !canOpenToday} />}
      {showInbox && (
        <NavItem
          icon={Tray}
          label={translate(locale, 'sidebar.nav.inbox')}
          count={inboxCount}
          countLoading={loading}
          isActive={isSelectionActive(selection, {
            kind: 'filter',
            filter: 'inbox',
          })}
          badgeClassName="text-muted-foreground"
          badgeStyle={{ background: 'var(--muted)' }}
          activeBadgeClassName="bg-primary text-primary-foreground"
          onClick={() => onSelect({ kind: 'filter', filter: 'inbox' })}
        />
      )}
      <NavItem
        icon={FileText}
        label={translate(locale, 'sidebar.nav.allNotes')}
        count={activeCount}
        countLoading={loading}
        isActive={isSelectionActive(selection, {
          kind: 'filter',
          filter: 'all',
        })}
        badgeClassName="text-muted-foreground"
        badgeStyle={{ background: 'var(--muted)' }}
        activeBadgeClassName="bg-primary text-primary-foreground"
        onClick={() => onSelect({ kind: 'filter', filter: 'all' })}
      />
      <NavItem
        icon={Archive}
        label={translate(locale, 'sidebar.nav.archive')}
        count={archivedCount}
        countLoading={loading}
        isActive={isSelectionActive(selection, {
          kind: 'filter',
          filter: 'archived',
        })}
        badgeClassName="text-muted-foreground"
        badgeStyle={{ background: 'var(--muted)' }}
        activeBadgeClassName="bg-primary text-primary-foreground"
        onClick={() => onSelect({ kind: 'filter', filter: 'archived' })}
      />
      {onOpenTrash && <NavItem icon={Trash} label={translate(locale, 'leadinglight.trash.action')} onClick={onOpenTrash} />}
    </div>
  )
}
