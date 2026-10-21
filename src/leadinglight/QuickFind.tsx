import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { FileText, MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { NoteTitleIcon } from '../components/NoteTitleIcon'
import { requestEditorFocus, type FocusEventDetail } from '../hooks/useEditorFocus'
import { useNoteSearch } from '../hooks/useNoteSearch'
import { translate, type AppLocale, type TranslationKey, type TranslationValues } from '../lib/i18n'
import type { VaultEntry } from '../types'
import { detectIntentionalMouseMovement, type MouseMovementSnapshot } from '../utils/mouseMovement'
import { hasNoteIconValue } from '../utils/noteIcon'
import type { PageCreationOutcome } from '../hooks/useNoteCreation'
import { normalizeNotePathForIdentity } from '../utils/notePathIdentity'
import { relativePathStem } from '../utils/wikilink'
import { vaultPathForEntry } from '../utils/workspaces'
import { cueFor, duplicateCues, isFindable, pageLabel } from './pageLabel'
import { useQuickFindBodySearch, type BodyMatch } from './useQuickFindBodySearch'

const RECENT_ROWS = 10
const TITLE_ROWS = 10
const TEXT_ROWS = 8

export interface QuickFindProps {
  open: boolean
  vaultPath: string
  entries: VaultEntry[]
  /** True only once this vault's own listing has loaded. */
  ready: boolean
  recentPaths: readonly string[]
  /** Resolves true only once the page is visibly open. */
  onOpen: (entry: VaultEntry) => Promise<boolean>
  onCreate: (title: string) => Promise<PageCreationOutcome>
  onClose: () => void
  locale?: AppLocale
  /**
   * Choosing a page for another feature (Ask's Another page…) instead of opening one: the chosen
   * page goes to `onPick` and the finder closes; nothing is opened or created, and no editor takes
   * focus. `title` names the dialog for assistive technology.
   */
  pick?: { title: string; onPick: (entry: VaultEntry) => void }
}

type PageRow = { kind: 'page', key: string, entry: VaultEntry, snippet?: string }
type Row = PageRow | { kind: 'create', key: 'create' }
interface Section { label: TranslationKey, rows: PageRow[] }

const identity = (path: string) => normalizeNotePathForIdentity(path)

// "harbor/lantern.md" or "./Harbor/Lantern" → "harbor/lantern". Plain words are not path queries.
function pathQueryStem(query: string): string | null {
  const trimmed = query.trim()
  if (!trimmed.includes('/') && !/\.md$/i.test(trimmed)) return null
  const stem = trimmed.replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/{2,}/g, '/').replace(/\.md$/i, '')
  return stem ? stem.toLocaleLowerCase() : null
}

/** Pages whose vault-relative path is the query, or ends with it at a folder boundary. */
function pathMatches(entries: VaultEntry[], query: string, vaultPath: string): VaultEntry[] {
  const wanted = pathQueryStem(query)
  if (!wanted) return []
  return entries.filter(entry => {
    const stem = relativePathStem(entry.path, vaultPathForEntry(entry, vaultPath)).toLocaleLowerCase()
    return stem === wanted || stem.endsWith(`/${wanted}`)
  })
}
const pageRow = (entry: VaultEntry, snippet?: string): PageRow => ({ kind: 'page', key: identity(entry.path), entry, snippet })
const hasTitle = (entry: VaultEntry, title: string) => entry.title.trim().toLocaleLowerCase() === title.toLocaleLowerCase()

function uniqueRows(entries: (VaultEntry | undefined)[], limit: number): PageRow[] {
  const rows = new Map<string, PageRow>()
  for (const entry of entries) if (entry && rows.size < limit) rows.set(identity(entry.path), pageRow(entry))
  return [...rows.values()]
}

function idleSections(byPath: Map<string, VaultEntry>, recentPaths: readonly string[], edited: VaultEntry[]): Section[] {
  // True visit order, the open page included.
  const recent = uniqueRows(recentPaths.map(path => byPath.get(identity(path))), RECENT_ROWS)
  if (recent.length > 0) return [{ label: 'leadinglight.find.recent', rows: recent }]
  // Nothing opened yet in this vault: say honestly that these are edits, not visits.
  const fallback = uniqueRows(edited, RECENT_ROWS)
  return fallback.length > 0 ? [{ label: 'leadinglight.find.recentlyEdited', rows: fallback }] : []
}

function querySections(byPath: Map<string, VaultEntry>, titleMatches: VaultEntry[], textMatches: BodyMatch[]): Section[] {
  const titles = uniqueRows(titleMatches, TITLE_ROWS)
  const seen = new Set(titles.map(row => row.key))
  const text: PageRow[] = []
  for (const match of textMatches) {
    const entry = match.snippet ? byPath.get(identity(match.path)) : undefined
    if (!entry || seen.has(identity(entry.path)) || text.length === TEXT_ROWS) continue
    seen.add(identity(entry.path))
    text.push(pageRow(entry, match.snippet))
  }
  return [{ label: 'leadinglight.find.titles' as const, rows: titles }, { label: 'leadinglight.find.text' as const, rows: text }]
    .filter(section => section.rows.length > 0)
}

export function QuickFind({ open, onClose, locale = 'en', vaultPath, ...props }: QuickFindProps) {
  // Set when the dialog closes because a page opened; Escape or clicking away leaves it empty.
  const focusTargetRef = useRef<FocusEventDetail | null>(null)
  // Opened by shortcut or sidebar, not a dialog trigger, so Radix has nothing to return focus to.
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const shownRef = useRef(false)
  return (
    <Dialog open={open} onOpenChange={next => { if (!next) onClose() }}>
      <DialogContent showCloseButton={false} aria-describedby={undefined} data-testid="quick-find"
        className="top-[12vh] translate-y-0 gap-0 overflow-hidden border-[var(--border-dialog)] bg-popover p-0 sm:max-w-[560px]"
        onOpenAutoFocus={() => {
          focusTargetRef.current = null
          returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
          shownRef.current = true
        }}
        onCloseAutoFocus={event => {
          // StrictMode replays mount in development while the dialog stays open.
          if (open) return
          shownRef.current = false
          event.preventDefault()
          const target = focusTargetRef.current
          focusTargetRef.current = null
          // An opened page's editor gets focus, never the editor or button used before.
          if (target) requestEditorFocus(target)
          else if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true })
        }}
        onEscapeKeyDown={event => { if (event.isComposing) event.preventDefault() }}>
        <DialogTitle className="sr-only">{props.pick?.title ?? translate(locale, 'leadinglight.find.title')}</DialogTitle>
        {/* A vault change starts a fresh search; work begun in the old vault no longer reports here. */}
        <QuickFindBody key={vaultPath} vaultPath={vaultPath} {...props} locale={locale} dialogShownRef={shownRef}
          onDone={target => { focusTargetRef.current = target; onClose() }} />
      </DialogContent>
    </Dialog>
  )
}

type BodyProps = Omit<QuickFindProps, 'open' | 'onClose' | 'locale'> & {
  locale: AppLocale
  /** `null`: closed after a pick, so focus returns where it was and no editor takes it. */
  onDone: (focus: FocusEventDetail | null) => void
  dialogShownRef: RefObject<boolean>
}

function QuickFindBody({ vaultPath, entries, ready, recentPaths, onOpen, onCreate, onDone, dialogShownRef, locale, pick }: BodyProps) {
  const t = (key: TranslationKey, values?: TranslationValues) => translate(locale, key, values)
  const baseId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [chosenKey, setChosenKey] = useState<string | null>(null)
  const [busy, setBusy] = useState<Row['kind'] | null>(null)
  const [notice, setNotice] = useState<{ role: 'status' | 'alert', text: string } | null>(null)
  // The open or create in flight; cleared on close so a late result cannot act on a newer dialog.
  const operationRef = useRef<object | null>(null)
  const mouseRef = useRef<MouseMovementSnapshot | null>(null)
  useEffect(() => () => { operationRef.current = null }, [])
  // On first open Radix focuses the field; after a vault change the new field must take focus itself.
  useEffect(() => { if (dialogShownRef.current) inputRef.current?.focus() }, [dialogShownRef])

  const title = query.trim()
  const creating = busy === 'create'
  // Stable inputs keep title ranking from rerunning over the whole vault on every hover.
  // A page being created is listed before its file is written; until then it shows only as "Creating".
  const findable = useMemo(
    () => entries.filter(entry => isFindable(entry) && !(creating && hasTitle(entry, title))),
    [entries, creating, title],
  )
  const byPath = useMemo(() => new Map(findable.map(entry => [identity(entry.path), entry])), [findable])
  const cues = useMemo(() => duplicateCues(findable, vaultPath, locale), [findable, vaultPath, locale])
  const exactPaths = useMemo(() => pathMatches(findable, query, vaultPath), [findable, query, vaultPath])
  const { results } = useNoteSearch(findable, query, RECENT_ROWS + 2)
  // Choosing a page for Ask reads only the page chosen: titles and paths here, never other pages' text.
  const body = useQuickFindBodySearch(vaultPath, query, ready && !pick)
  const sections = !ready ? [] : title
    ? querySections(byPath, [...exactPaths, ...results.map(result => result.entry)], body.matches)
    : idleSections(byPath, recentPaths, results.map(result => result.entry))
  const canCreate = !pick && ready && !!title && exactPaths.length === 0 && !findable.some(entry => hasTitle(entry, title))
  const rowLabel = (entry: VaultEntry) => {
    const cue = cueFor(cues, entry)
    return <>{pageLabel(entry, locale)}{cue && <span className="ml-1.5 text-xs text-muted-foreground">{cue}</span>}</>
  }
  const createRow = canCreate ? { kind: 'create', key: 'create' } as const : null
  const rows: Row[] = [...sections.flatMap(section => section.rows), ...(createRow ? [createRow] : [])]
  // A row the user picked stays picked while page-text matches arrive above it.
  const selectedIndex = Math.max(0, rows.findIndex(row => row.key === chosenKey))
  const selected = rows.at(selectedIndex)
  const optionId = (row: Row) => `${baseId}-option-${rows.findIndex(item => item.key === row.key)}`
  const selectedId = selected ? optionId(selected) : undefined

  useEffect(() => {
    if (selectedId) document.getElementById(selectedId)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId, chosenKey])

  const activate = async (row: Row | undefined) => {
    if (!row || operationRef.current) return
    if (pick) {
      if (row.kind === 'page') { pick.onPick(row.entry); onDone(null) }
      return
    }
    const operation = {}
    operationRef.current = operation
    setBusy(row.kind)
    setNotice(null)
    let outcome: PageCreationOutcome = 'failed'
    try {
      outcome = row.kind === 'create' ? await onCreate(title) : (await onOpen(row.entry)) === true ? 'opened' : 'failed'
    } catch { /* A thrown attempt is a failed one. */ }
    if (operationRef.current !== operation) return
    operationRef.current = null
    if (outcome === 'opened') {
      onDone(row.kind === 'create' ? {} : { path: row.entry.path })
      return
    }
    setBusy(null)
    // Created but not shown is not a failure: the file exists and appears in the list.
    if (outcome === 'created') setNotice({ role: 'status', text: t('leadinglight.find.created', { title }) })
    else setNotice({ role: 'alert', text: row.kind === 'create' ? t('leadinglight.find.createFailed') : t('leadinglight.find.openFailed', { title: pageLabel(row.entry, locale) }) })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter during IME composition confirms the text; it must not open or create.
    if (event.nativeEvent.isComposing || event.keyCode === 229 || busy) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = rows.at(Math.min(Math.max(selectedIndex + (event.key === 'ArrowDown' ? 1 : -1), 0), rows.length - 1))
      if (next) setChosenKey(next.key)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      void activate(selected)
    }
  }
  const hover = (row: Row, event: MouseEvent) => {
    const movement = detectIntentionalMouseMovement(event.nativeEvent, mouseRef.current)
    mouseRef.current = movement.snapshot
    if (movement.moved) setChosenKey(row.key)
  }
  const option = (row: Row, label: ReactNode, icon: ReactNode, snippet?: string) => (
    <Button key={row.key} id={optionId(row)} role="option" aria-selected={row.key === selected?.key} tabIndex={-1} variant="ghost"
      disabled={row.kind === 'create' && busy === 'create'}
      className={cn('h-auto w-full flex-col items-stretch gap-0.5 px-2.5 py-1.5 text-left font-normal', row.key === selected?.key && 'bg-accent text-accent-foreground')}
      onMouseDown={event => event.preventDefault()} onMouseMove={event => hover(row, event)} onClick={() => { void activate(row) }}>
      <span className="flex min-w-0 items-center gap-2">{icon}<span className="truncate">{label}</span></span>
      {snippet && <span className="line-clamp-2 whitespace-normal pl-6 text-xs text-muted-foreground">{snippet}</span>}
    </Button>
  )
  const pageIcon = (entry: VaultEntry) => hasNoteIconValue(entry.icon)
    ? <NoteTitleIcon icon={entry.icon} size={16} />
    : <FileText size={16} className="text-muted-foreground" aria-hidden />
  const quiet = (children: ReactNode, role?: 'status' | 'alert') =>
    <div role={role} className="flex items-center gap-2 px-2.5 py-2 text-sm text-muted-foreground">{children}</div>
  const textNotice = !title ? null
    : body.status === 'searching' ? quiet(t('leadinglight.find.searching'), 'status')
      : body.status === 'failed' ? quiet(<>{t('leadinglight.find.searchFailed')}
        <Button variant="ghost" size="xs" onClick={() => { body.retry(); inputRef.current?.focus() }}>{t('leadinglight.find.retry')}</Button></>, 'alert')
        : sections.length === 0 ? quiet(t('leadinglight.find.noMatches', { query: title })) : null

  return <>
    <div className="flex items-center gap-2 border-b border-border px-3">
      <MagnifyingGlass size={16} className="shrink-0 text-muted-foreground" aria-hidden />
      <Input ref={inputRef} role="combobox" aria-expanded aria-controls={`${baseId}-list`} aria-autocomplete="list"
        aria-activedescendant={selectedId} aria-label={t('leadinglight.find.title')}
        placeholder={t('leadinglight.find.placeholder')} value={query} autoComplete="off" spellCheck={false}
        readOnly={busy !== null} aria-busy={busy !== null}
        className="h-12 rounded-none border-0 bg-transparent px-0 text-[15px] shadow-none focus-visible:ring-0 dark:bg-transparent"
        onChange={event => {
          // While a choice is committing, its outcome belongs to the text the user chose it for.
          if (busy) return
          setQuery(event.target.value)
          setChosenKey(null)
          setNotice(null)
        }} onKeyDown={onKeyDown} />
    </div>
    <div className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5">
      {!ready ? quiet(t('leadinglight.find.loading'), 'status') : (
        <div id={`${baseId}-list`} role="listbox" aria-label={t('leadinglight.find.title')} aria-busy={busy !== null}>
          {sections.map(section => (
            <div key={section.label} role="group" aria-labelledby={`${baseId}-${section.label}`}>
              <div id={`${baseId}-${section.label}`} className="px-2.5 pb-1 pt-2 text-xs font-medium text-muted-foreground">{t(section.label)}</div>
              {section.rows.map(row => option(row, rowLabel(row.entry), pageIcon(row.entry), row.snippet))}
            </div>
          ))}
          {textNotice}
          {createRow && option(createRow,
            t(busy === 'create' ? 'leadinglight.find.creating' : 'leadinglight.find.create', { title }), <Plus size={16} aria-hidden />)}
        </div>
      )}
      {ready && !title && sections.length === 0 && quiet(t('leadinglight.find.empty'))}
      {notice && <p role={notice.role} className={cn('px-2.5 py-2 text-sm', notice.role === 'alert' ? 'text-destructive' : 'text-muted-foreground')}>{notice.text}</p>}
    </div>
  </>
}
