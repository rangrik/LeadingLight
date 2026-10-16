import { FileText, FileX } from '@phosphor-icons/react'
import { Button } from '../../components/ui/button'
import { ScrollArea } from '../../components/ui/scroll-area'
import { translate, type AppLocale, type TranslationKey, type TranslationValues } from '../../lib/i18n'
import type { SavedLocation } from './pageHistoryApi'
import { absoluteIn, formatWhen, vaultRelative } from './pageHistoryText'
import type { Listing } from './usePageHistory'

/** Every place a page was saved, newest first; choosing one shows the versions kept there. */
export function SavedLocationsView({ listing, vaultPath, current, locale, onBrowse, onMore, onRetry }: {
  listing: Listing<SavedLocation>
  vaultPath: string
  current: string
  locale: AppLocale
  onBrowse: (path: string) => void
  onMore: () => void
  onRetry: () => void
}) {
  const t = (key: TranslationKey, values?: TranslationValues) => translate(locale, key, values)
  if (listing.status === 'loading') return <p className="ll-history-quiet" role="status">{t('leadinglight.history.locations.loading')}</p>
  if (listing.status === 'failed' || listing.status === 'refused') {
    return (
      <div className="ll-history-quiet" role="alert">
        <p>{t(listing.status === 'refused' ? 'leadinglight.history.outsideVault' : 'leadinglight.history.locations.failed')}</p>
        {listing.status === 'failed' && <Button variant="outline" size="sm" onClick={onRetry}>{t('leadinglight.history.retry')}</Button>}
      </div>
    )
  }
  if (listing.items.length === 0) return <p className="ll-history-quiet">{t('leadinglight.history.locations.empty')}</p>
  return (
    <ScrollArea className="ll-history-list-scroll">
      <ul className="ll-history-list" aria-label={t('leadinglight.history.tab.locations')}>
        {listing.items.map(location => {
          const path = absoluteIn(vaultPath, location.path)
          const Icon = location.exists ? FileText : FileX
          const meta = [
            t('leadinglight.history.locations.count', { count: location.count }),
            t('leadinglight.history.locations.newest', { date: formatWhen(locale, location.newestAt) }),
            !location.exists && t('leadinglight.history.locations.gone'),
          ].filter(Boolean).join(' · ')
          return (
            <li key={location.path}>
              <Button variant="ghost" className="ll-history-row" data-testid="page-history-location" data-location-path={path}
                aria-current={path === current ? 'true' : undefined} onClick={() => onBrowse(path)}>
                <Icon className="ll-history-row-icon" aria-hidden="true" />
                <span className="ll-history-row-text">
                  <span className="ll-history-row-title">{vaultRelative(vaultPath, path)}</span>
                  <span className="ll-history-row-meta">{meta}</span>
                </span>
              </Button>
            </li>
          )
        })}
      </ul>
      {listing.next && (
        <Button variant="ghost" size="sm" className="ll-history-more" data-testid="page-history-locations-more"
          disabled={listing.more === 'loading'} onClick={onMore}>
          {t(listing.more === 'failed' ? 'leadinglight.history.moreFailed' : 'leadinglight.history.locations.more')}
        </Button>
      )}
    </ScrollArea>
  )
}
