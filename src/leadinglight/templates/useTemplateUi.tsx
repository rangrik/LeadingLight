import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { translate, type AppLocale } from '../../lib/i18n'
import { CaptureHeldError } from '../pendingCapture'
import type { TemplateController, TemplateDraft, TemplatePreview, TemplateScope, TemplateSnapshot, TemplateSource } from './templateContract'
import { templateFailureText } from './templateUiText'

export interface TemplateEditorDraft {
  kind: 'new' | 'existing'
  name: string
  text: string
  baseline: string
  revision: number
  expected: TemplateSnapshot | null
  unconfirmed: boolean
  nameLocked: boolean
  status: string | null
}

export interface TemplateUiState {
  scope: TemplateScope
  controller: TemplateController
  returnFocus: HTMLElement | null
  selected: TemplateSource | null
  snapshot: TemplateSnapshot | null
  preview: TemplatePreview | null
  reading: boolean
  busy: 'save' | 'create' | null
  editor: TemplateEditorDraft | null
  message: string | null
  attemptedPath: string | null
  resultPath: string | null
  unconfirmedCreate: boolean
  savedSources: TemplateSnapshot[]
  discard: 'close' | 'back' | null
  conflict: TemplateSnapshot | null
}

export interface TemplateBoundary {
  begin: () => () => void
  whenIdle: () => Promise<void>
  assertClear: () => void
  saveActive: () => boolean
  isOpen: () => boolean
}

export const templateDraftDirty = (editor: TemplateEditorDraft | null) => !!editor &&
  (editor.unconfirmed || editor.text !== editor.baseline || (editor.kind === 'new' && editor.name !== ''))

/** One opening owns its draft, pane reservation and exact source for the lifetime of the flow. */
export function useTemplateUi({ controller, vaultPath, locale, blocked, canOpen, onHeld }: {
  controller: TemplateController
  vaultPath: string
  locale: AppLocale
  blocked: () => boolean
  canOpen?: () => boolean
  onHeld: (message: string) => void
}) {
  const [state, setState] = useState<TemplateUiState | null>(null)
  const current = useRef(state)
  const latest = useRef({ controller, vaultPath, locale, blocked, canOpen, onHeld })
  useLayoutEffect(() => { latest.current = { controller, vaultPath, locale, blocked, canOpen, onHeld } })
  const holds = useRef(0)
  const reads = useRef(0)
  const revisions = useRef(0)
  // Includes cancelled preview reads until their source flush/read has really settled.
  const activeWork = useRef(0)
  const focusHandled = useRef(false)
  const returnedFocus = useRef<HTMLElement | null>(null)
  const update = useCallback((next: TemplateUiState | null) => { current.current = next; setState(next) }, [])
  const change = useCallback((fn: (value: TemplateUiState) => TemplateUiState) => { if (current.current) update(fn(current.current)) }, [update])
  const live = (opening: TemplateUiState) => current.current?.scope === opening.scope
  const paused = () => holds.current > 0 || latest.current.blocked()
  const text = (key: Parameters<typeof translate>[1]) => translate(latest.current.locale, key)
  const close = useCallback(() => {
    current.current?.scope.cancel()
    reads.current += 1
    update(null)
  }, [update])
  useEffect(() => () => { current.current?.scope.cancel() }, [])
  useLayoutEffect(() => {
    const opening = current.current
    if (opening && opening.scope.vaultPath !== vaultPath) {
      opening.scope.cancel()
      reads.current += 1
      change(value => ({ ...value, reading: false, message: templateFailureText(locale, 'stale') }))
    }
  }, [vaultPath, locale, change])

  const open = () => {
    if (paused() || current.current || latest.current.canOpen?.() === false) return
    const scope = latest.current.controller.begin()
    if (!scope) return
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    returnedFocus.current = returnFocus
    focusHandled.current = false
    update({ scope, controller: latest.current.controller, returnFocus, selected: null, snapshot: null, preview: null,
      reading: false, busy: null, editor: null, message: null, attemptedPath: null, resultPath: null, unconfirmedCreate: false, savedSources: [], discard: null, conflict: null })
  }

  const select = async (source: TemplateSource) => {
    const opening = current.current
    if (!opening || paused() || opening.busy || opening.editor || opening.unconfirmedCreate || opening.resultPath) return
    const request = ++reads.current
    activeWork.current += 1
    change(value => ({ ...value, selected: source, snapshot: null, preview: null, reading: true, message: null }))
    try {
      const result = await opening.controller.prepare(opening.scope, source)
      if (!live(opening) || reads.current !== request) return
      change(value => result.status === 'ready' ? { ...value, reading: false, snapshot: result.snapshot, preview: result.preview }
        : { ...value, reading: false, message: templateFailureText(latest.current.locale, result.reason) })
    } catch {
      if (live(opening) && reads.current === request) change(value => ({ ...value, reading: false, message: templateFailureText(latest.current.locale, 'readFailed') }))
    } finally {
      activeWork.current -= 1
    }
  }

  const newTemplate = () => {
    const opening = current.current
    if (!opening || paused() || opening.busy || opening.unconfirmedCreate || opening.resultPath) return
    reads.current += 1
    change(value => ({ ...value, reading: false, message: null, conflict: null, editor: { kind: 'new', name: '', text: '', baseline: '',
      revision: ++revisions.current, expected: null, unconfirmed: false, nameLocked: false, status: null } }))
  }
  const edit = () => {
    const opening = current.current
    if (!opening?.snapshot || paused() || opening.busy || opening.reading || opening.unconfirmedCreate || opening.resultPath) return
    const snapshot = opening.snapshot
    change(value => ({ ...value, message: null, conflict: null, editor: { kind: 'existing', name: snapshot.title,
      text: snapshot.template ?? '', baseline: snapshot.template ?? '', revision: ++revisions.current,
      expected: snapshot, unconfirmed: false, nameLocked: true, status: null } }))
  }
  const type = (field: 'name' | 'text', value: string) => {
    if (paused()) return
    change(opening => {
      if (!opening.editor || (field === 'name' && opening.editor.nameLocked)) return opening
      return { ...opening, discard: null, editor: { ...opening.editor, [field]: value, revision: ++revisions.current, status: null } }
    })
  }
  const save = async () => {
    const opening = current.current
    const editor = opening?.editor
    if (!opening || !editor || opening.busy || paused() || opening.conflict) return
    if (editor.kind === 'new' && (!editor.name.trim() || !editor.text.trim())) return
    if (!templateDraftDirty(editor)) return
    const draft: TemplateDraft = editor.expected ? { kind: 'existing', source: editor.expected.source, expected: editor.expected,
      text: editor.text, revision: editor.revision } : { kind: 'new', name: editor.name, text: editor.text, revision: editor.revision }
    change(value => ({ ...value, busy: 'save', discard: null, editor: value.editor && { ...value.editor, nameLocked: true } }))
    activeWork.current += 1
    try {
      const result = await opening.controller.save(opening.scope, draft)
      if (!live(opening)) return
      const returnToChooser = editor.kind === 'new' && result.status === 'saved' && current.current?.editor?.revision === result.revision
      change(value => {
        const now = value.editor
        if (!now) return { ...value, busy: null }
        if (result.status === 'saved') {
          const newer = now.revision !== result.revision
          return { ...value, busy: null, selected: result.source, snapshot: result.snapshot, attemptedPath: null, conflict: null,
            savedSources: [...value.savedSources.filter(item => item.source.path !== result.source.path), result.snapshot],
            editor: returnToChooser ? null : { ...now, kind: 'existing', name: result.snapshot.title, expected: result.snapshot, baseline: result.text, unconfirmed: false,
              status: text(newer ? 'leadinglight.templates.savedNewer' : result.refreshPending ? 'leadinglight.templates.savedRefresh' : 'leadinglight.templates.saved') } }
        }
        if (result.status === 'sourceChanged') return { ...value, busy: null, conflict: result.snapshot,
          editor: { ...now, status: text('leadinglight.templates.sourceChanged') } }
        return { ...value, busy: null, attemptedPath: result.write === 'unconfirmed' ? result.attemptedPath ?? value.attemptedPath : value.attemptedPath,
          editor: { ...now, unconfirmed: result.write === 'unconfirmed' || now.unconfirmed,
            nameLocked: now.kind === 'existing' || result.write === 'unconfirmed' || now.unconfirmed,
            status: templateFailureText(latest.current.locale, result.reason) } }
      })
      if (returnToChooser && result.status === 'saved') await select(result.source)
    } catch {
      if (live(opening)) change(value => ({ ...value, busy: null, editor: value.editor && { ...value.editor,
        unconfirmed: true, status: templateFailureText(latest.current.locale, 'unconfirmed') } }))
    } finally {
      activeWork.current -= 1
    }
  }
  const back = () => {
    const opening = current.current
    if (!opening || paused() || opening.busy) return
    if (templateDraftDirty(opening.editor)) { change(value => ({ ...value, discard: 'back' })); return }
    const source = opening.editor?.expected?.source ?? opening.selected
    change(value => ({ ...value, editor: null, conflict: null, discard: null, attemptedPath: null }))
    if (source) void select(source)
  }
  const requestClose = () => {
    const opening = current.current
    if (!opening || paused() || opening.busy) return
    if (templateDraftDirty(opening.editor) || opening.unconfirmedCreate) change(value => ({ ...value, discard: 'close' }))
    else close()
  }
  const discard = () => {
    const opening = current.current
    if (!opening?.discard || paused() || opening.busy) return
    if (opening.discard === 'close' || opening.editor?.unconfirmed) { close(); return }
    const source = opening.editor?.expected?.source ?? opening.selected
    change(value => ({ ...value, editor: null, conflict: null, discard: null, attemptedPath: null }))
    if (source) void select(source)
  }
  const acceptConflict = () => change(value => !value.conflict || !value.editor || paused() ? value : ({ ...value, conflict: null,
    editor: { ...value.editor, expected: value.conflict, baseline: value.conflict.template ?? '', status: null } }))

  const create = async () => {
    const opening = current.current
    if (!opening?.preview || opening.editor || opening.busy || opening.reading || opening.resultPath || paused()) return
    change(value => ({ ...value, busy: 'create', message: null }))
    activeWork.current += 1
    try {
      const result = await opening.controller.create(opening.scope, opening.preview)
      if (!live(opening)) return
      if (result.status === 'opened') { focusHandled.current = true; close(); return }
      change(value => {
        if (result.status === 'created') return { ...value, busy: null, resultPath: result.path, attemptedPath: null, unconfirmedCreate: false }
        if (result.status === 'previewChanged') return { ...value, busy: null, preview: result.preview, snapshot: result.preview.snapshot,
          message: text('leadinglight.templates.changed'), attemptedPath: null, unconfirmedCreate: false }
        if (result.status === 'failed') return { ...value, busy: null, attemptedPath: result.write === 'unconfirmed' ? result.attemptedPath ?? value.attemptedPath : value.attemptedPath,
          unconfirmedCreate: result.write === 'unconfirmed' || value.unconfirmedCreate, message: templateFailureText(latest.current.locale, result.reason) }
        return { ...value, busy: null }
      })
    } catch {
      if (live(opening)) change(value => ({ ...value, busy: null, unconfirmedCreate: true, message: templateFailureText(latest.current.locale, 'unconfirmed') }))
    } finally {
      activeWork.current -= 1
    }
  }

  const refusesBoundary = () => activeWork.current > 0 || (!!current.current && (templateDraftDirty(current.current.editor) || !!current.current.busy || current.current.reading || current.current.unconfirmedCreate))
  const boundary: TemplateBoundary = {
    begin: () => {
      const releaseDomain = latest.current.controller.holdAdmission()
      if (refusesBoundary()) {
        releaseDomain()
        latest.current.onHeld(text('leadinglight.templates.held'))
        throw new CaptureHeldError()
      }
      holds.current += 1
      close()
      let released = false
      return () => { if (!released) { released = true; holds.current -= 1; releaseDomain() } }
    },
    whenIdle: () => latest.current.controller.whenIdle(),
    assertClear: () => { if (refusesBoundary()) throw new CaptureHeldError() },
    saveActive: () => { if (!current.current) return false; void save(); return true },
    isOpen: () => current.current !== null,
  }
  const onCloseAutoFocus = (event: Event) => {
    if (focusHandled.current) event.preventDefault()
    else if (returnedFocus.current?.isConnected) { event.preventDefault(); returnedFocus.current.focus() }
  }
  return { state, open, select, newTemplate, edit, type, save, back, requestClose, discard, acceptConflict, create, boundary,
    keepEditing: () => change(value => ({ ...value, discard: null })), onCloseAutoFocus }
}

export type TemplateUi = ReturnType<typeof useTemplateUi>
