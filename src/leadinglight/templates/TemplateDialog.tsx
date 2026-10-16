import { useMemo, useState } from 'react'
import { FileText, MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { Button } from '../../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import { ScrollArea } from '../../components/ui/scroll-area'
import { translate, type AppLocale } from '../../lib/i18n'
import type { VaultEntry } from '../../types'
import { isActiveTypeDefinition } from '../../utils/typeDefinitions'
import { vaultPathForEntry } from '../../utils/workspaces'
import { TemplateEditor } from './TemplateEditor'
import { TemplatePreview } from './TemplatePreview'
import type { TemplateSnapshot, TemplateSource } from './templateContract'
import { templateRelativePath } from './templateUiText'
import { templateDraftDirty, type TemplateUi, type TemplateUiState } from './useTemplateUi'
import './templates.css'

interface Props { ui: TemplateUi; entries: VaultEntry[]; locale: AppLocale; blocked?: boolean }

/** One optional local flow; none of its previews may replace a current page. */
export function TemplateDialog({ ui, entries, locale, blocked = false }: Props) {
  const state = ui.state
  const editor = state?.editor
  return (
    <Dialog open={state !== null} onOpenChange={open => { if (!open) ui.requestClose() }}>
      <DialogContent className="ll-template-dialog" data-testid="template-dialog" showCloseButton={!state?.busy && !blocked}
        onCloseAutoFocus={ui.onCloseAutoFocus}
        onEscapeKeyDown={event => { event.preventDefault(); ui.requestClose() }}
        onInteractOutside={event => { event.preventDefault(); ui.requestClose() }}>
        <DialogHeader>
          <DialogTitle className="ll-template-title"><FileText aria-hidden="true" />{translate(locale,
            editor ? editor.kind === 'new' ? 'leadinglight.templates.newTitle' : 'leadinglight.templates.editTitle' : 'leadinglight.templates.title')}</DialogTitle>
          <DialogDescription>{translate(locale, editor ? editor.kind === 'new' ? 'leadinglight.templates.newDescription' : 'leadinglight.templates.editDescription' : 'leadinglight.templates.description')}</DialogDescription>
        </DialogHeader>
        {state && <div className="ll-template-content">
          {state.discard && <DiscardNotice ui={ui} state={state} locale={locale} />}
          {state.attemptedPath && <p className="ll-template-notice" role="status" data-testid="template-attempted-path" data-path={state.attemptedPath}>
            {translate(locale, 'leadinglight.templates.attempted', { path: templateRelativePath(state.scope.vaultPath, state.attemptedPath) })}
          </p>}
          {state.conflict && <div className="ll-template-notice">
            <p>{translate(locale, 'leadinglight.templates.sourceChanged')}</p>
            <p>{translate(locale, 'leadinglight.templates.conflictHint')}</p>
            <pre className="ll-template-conflict-source">{state.conflict.template ?? ''}</pre>
            <Button variant="outline" size="sm" disabled={blocked} onClick={ui.acceptConflict}>{translate(locale, 'leadinglight.templates.useCurrent')}</Button>
          </div>}
          {editor ? <TemplateEditor kind={editor.kind} name={editor.name} text={editor.text} nameLocked={editor.nameLocked}
            sourcePath={editor.expected ? templateRelativePath(state.scope.vaultPath, editor.expected.source.path) : null}
            dirty={templateDraftDirty(editor)} saving={state.busy === 'save'} blocked={blocked}
            canSave={!state.conflict && templateDraftDirty(editor) && (editor.kind === 'existing' || (!!editor.name.trim() && !!editor.text.trim()))}
            status={editor.status} locale={locale} onNameChange={value => ui.type('name', value)} onTextChange={value => ui.type('text', value)}
            onSave={() => { void ui.save() }} onBack={ui.back} />
            : <TemplateChooser key={state.scope.id} ui={ui} state={state} entries={entries} locale={locale} blocked={blocked} />}
        </div>}
      </DialogContent>
    </Dialog>
  )
}

function DiscardNotice({ ui, state, locale }: { ui: TemplateUi; state: TemplateUiState; locale: AppLocale }) {
  const uncertain = state.unconfirmedCreate || state.editor?.unconfirmed
  return <div className="ll-template-notice" role="alertdialog" aria-label={translate(locale, 'leadinglight.templates.discardQuestion')}>
    <p>{translate(locale, uncertain ? 'leadinglight.templates.abandonHint' : 'leadinglight.templates.discardQuestion')}</p>
    {!uncertain && <p className="ll-template-quiet">{translate(locale, 'leadinglight.templates.discardHint')}</p>}
    <div className="ll-template-discard-actions">
      <Button variant="outline" onClick={ui.keepEditing}>{translate(locale, 'leadinglight.templates.keepEditing')}</Button>
      <Button variant="secondary" onClick={ui.discard}>{translate(locale, uncertain ? 'leadinglight.templates.abandon' : 'leadinglight.templates.discard')}</Button>
    </div>
  </div>
}

function TemplateMetadata({ snapshot, locale }: { snapshot: TemplateSnapshot; locale: AppLocale }) {
  return <dl className="ll-template-metadata">
    <dt>{translate(locale, 'leadinglight.templates.type')}</dt><dd>{snapshot.title}</dd>
    <dt>{translate(locale, 'leadinglight.templates.destination')}</dt><dd>{snapshot.destinationDirectory || translate(locale, 'leadinglight.templates.rootFolder')}</dd>
    <dt>{translate(locale, 'leadinglight.templates.defaults')}</dt><dd className="ll-template-defaults">
      {snapshot.defaults.length ? snapshot.defaults.map(item => <span key={item.key}>{item.key}: {Array.isArray(item.value) ? item.value.join(', ') : String(item.value)}</span>)
        : translate(locale, 'leadinglight.templates.noDefaults')}
    </dd>
  </dl>
}

function TemplateChooser({ ui, state, entries, locale, blocked }: Props & { state: TemplateUiState }) {
  const [query, setQuery] = useState('')
  const rows = useMemo(() => {
    const known = new Map<string, { source: TemplateSource; title: string }>()
    for (const entry of entries) {
      if (isActiveTypeDefinition(entry) && vaultPathForEntry(entry, state.scope.vaultPath) === state.scope.vaultPath) {
        known.set(entry.path, { source: { vaultPath: state.scope.vaultPath, path: entry.path }, title: entry.title })
      }
    }
    for (const snapshot of state.savedSources) known.set(snapshot.source.path, { source: snapshot.source, title: snapshot.title })
    return [...known.values()].sort((a, b) => a.title.localeCompare(b.title) || a.source.path.localeCompare(b.source.path))
  }, [entries, state.scope.vaultPath, state.savedSources])
  const matching = rows.filter(row => `${row.title}\n${templateRelativePath(state.scope.vaultPath, row.source.path)}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const locked = blocked || !!state.busy || state.unconfirmedCreate || !!state.resultPath
  return <div className="ll-template-chooser">
    <div className="ll-template-body">
      <div className="ll-template-sidebar">
        <div className="ll-template-search"><MagnifyingGlass aria-hidden="true" /><Input value={query} disabled={locked}
          aria-label={translate(locale, 'leadinglight.templates.search')} placeholder={translate(locale, 'leadinglight.templates.search')} onChange={event => setQuery(event.target.value)} /></div>
        <ScrollArea className="ll-template-list-scroll">
          <ul className="ll-template-list" aria-label={translate(locale, 'leadinglight.templates.list')}>
            {matching.map(row => <li key={row.source.path}><Button variant="ghost" className="ll-template-row" disabled={locked}
              data-testid="template-row" data-template-path={row.source.path} aria-current={state.selected?.path === row.source.path ? 'true' : undefined}
              onClick={() => { void ui.select(row.source) }}><span className="ll-template-row-text"><span className="ll-template-row-name">{row.title}</span>{' '}
                <span className="ll-template-row-path">{templateRelativePath(state.scope.vaultPath, row.source.path)}</span></span></Button></li>)}
          </ul>
          {!matching.length && <p className="ll-template-quiet">{translate(locale, rows.length ? 'leadinglight.templates.noMatches' : 'leadinglight.templates.empty')}</p>}
        </ScrollArea>
        <Button variant="outline" size="sm" disabled={locked} onClick={ui.newTemplate}><Plus aria-hidden="true" />{translate(locale, 'leadinglight.templates.new')}</Button>
      </div>
      <section className="ll-template-main" aria-label={translate(locale, 'leadinglight.templates.preview')}>
        {state.reading ? <p className="ll-template-quiet" role="status">{translate(locale, 'leadinglight.templates.loading')}</p>
          : state.snapshot ? <>
            <TemplateMetadata snapshot={state.snapshot} locale={locale} />
            {state.preview ? <TemplatePreview content={state.preview.content} locale={locale} />
              : <p className="ll-template-quiet">{translate(locale, 'leadinglight.templates.emptySource')}</p>}
          </> : <p className="ll-template-quiet">{translate(locale, 'leadinglight.templates.choose')}</p>}
      </section>
    </div>
    {state.message && <p className="ll-template-status" role="status">{state.message}</p>}
    {state.resultPath && <p className="ll-template-status" role="status" data-testid="template-result" data-path={state.resultPath}>
      {translate(locale, 'leadinglight.templates.created', { path: templateRelativePath(state.scope.vaultPath, state.resultPath) })}</p>}
    <div className="ll-template-footer">
      <Button variant="ghost" className="ll-template-footer-start" disabled={locked || state.reading || !state.snapshot} onClick={ui.edit}>{translate(locale, 'leadinglight.templates.edit')}</Button>
      <Button variant="outline" disabled={blocked || !!state.busy} onClick={ui.requestClose}>{translate(locale, state.resultPath ? 'leadinglight.templates.done' : 'leadinglight.templates.cancel')}</Button>
      {!state.resultPath && <Button disabled={blocked || !!state.busy || state.reading || !state.preview} data-testid="template-create" onClick={() => { void ui.create() }}>
        {translate(locale, state.busy === 'create' ? 'leadinglight.templates.creating' : state.unconfirmedCreate ? 'leadinglight.templates.checkAgain' : 'leadinglight.templates.create')}</Button>}
    </div>
  </div>
}
