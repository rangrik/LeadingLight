import { stringify } from 'yaml'
import type { VaultEntry } from '../../types'
import { buildNewEntry, buildNoteBody, generateUntitledFilename, resolveTypeInstanceDefaults, type OpenReservation } from '../../hooks/useNoteCreation'
import { joinVaultPath, normalizeNotePathForIdentity, notePathsMatch } from '../../utils/notePathIdentity'
import { slugifyNoteStem } from '../../utils/noteSlug'
import { deriveDisplayTitleState } from '../../utils/noteTitle'
import { requestEditorFocus } from '../../hooks/useEditorFocus'
import type { TemplateController, TemplateCreateResult, TemplateDraft, TemplateFailure, TemplatePreview, TemplateReadResult, TemplateSaveResult, TemplateScope, TemplateSnapshot, TemplateSource } from './templateContract'

export interface TemplateWriteRequest {
  source: TemplateSource
  expected: TemplateSnapshot
  text: string
  revision: number
  /** Reconcile a previous unknown write inside the page lane without replaying a confirmed value. */
  reconcile?: boolean
  current(): boolean
}

export interface TemplateDomainDeps {
  session: object
  vaultPath: string
  ready: boolean
  entries: VaultEntry[]
  reserveOpen(): OpenReservation
  markNavigation(): { current(): boolean }
  readEntry(source: TemplateSource): Promise<VaultEntry | null>
  readContent(path: string, vaultPath: string): Promise<string>
  createFile(path: string, content: string, vaultPath: string): Promise<void>
  flushSource?(path: string): Promise<void>
  writeExisting(request: TemplateWriteRequest): Promise<TemplateSaveResult>
  addEntry(entry: VaultEntry): void
  markWrite?(path: string): void
  onPersisted?(path: string): void
  refresh?(): Promise<unknown>
}

export class TemplateOperationError extends Error {
  readonly reason: TemplateFailure
  constructor(reason: TemplateFailure) { super(reason); this.reason = reason }
}

function relativeSource(source: TemplateSource): string | null {
  const root = normalizeNotePathForIdentity(source.vaultPath)
  const path = normalizeNotePathForIdentity(source.path)
  if (!root || !path.startsWith(`${root}/`)) return null
  const relative = path.slice(root.length + 1)
  return relative.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.')) ? null : relative
}

const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0

function orderedRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => compareText(left, right)))
}

function resolvedSnapshot(source: TemplateSource, values: Pick<TemplateSnapshot, 'title' | 'template' | 'defaults' | 'destinationDirectory'>): TemplateSnapshot {
  // Native properties/relationships are HashMaps; iteration order is not a document change.
  const defaults = [...values.defaults].sort((left, right) => compareText(left.kind, right.kind) || compareText(left.key, right.key))
  const resolved = { title: values.title, template: values.template, defaults, destinationDirectory: values.destinationDirectory }
  return { source: { ...source }, ...resolved, revision: JSON.stringify(resolved) }
}

/** Acknowledged writes use the same canonical snapshot as the following fresh read. */
export function withTemplateText(snapshot: TemplateSnapshot, text: string): TemplateSnapshot {
  return resolvedSnapshot(snapshot.source, { ...snapshot, template: text })
}

/** Uses only the exact entry returned by the native parser; no name-based lookup in the listing. */
export function snapshotFromEntry(source: TemplateSource, entry: VaultEntry | null): TemplateSnapshot | null {
  const relative = relativeSource(source)
  if (!relative || !entry || !notePathsMatch(entry.path, source.path) || !/\.md$/i.test(relative)
    || (entry.fileKind && entry.fileKind !== 'markdown') || entry.isA !== 'Type' || entry.archived
    || Reflect.get(entry, 'trashed') === true || !entry.title.trim()) return null
  // Order before the inherited collector's case-insensitive de-duplication as well.
  const orderedEntry = { ...entry, properties: orderedRecord(entry.properties ?? {}), relationships: orderedRecord(entry.relationships ?? {}) }
  const defaults = resolveTypeInstanceDefaults({ entries: [orderedEntry], typeName: entry.title })
  const values = { title: entry.title, template: entry.template, defaults,
    destinationDirectory: relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : '' }
  return resolvedSnapshot(source, values)
}

export async function readTemplateSnapshot(source: TemplateSource, read: TemplateDomainDeps['readEntry']): Promise<TemplateSnapshot> {
  if (!relativeSource(source)) throw new TemplateOperationError('invalidSource')
  let entry: VaultEntry | null
  try { entry = await read(source) } catch { throw new TemplateOperationError('readFailed') }
  if (!entry) throw new TemplateOperationError('missing')
  const snapshot = snapshotFromEntry(source, entry)
  if (!snapshot) throw new TemplateOperationError('invalidSource')
  return snapshot
}

function documentContent(metadata: Record<string, unknown>, body = ''): string {
  return `---\n${stringify(metadata, { lineWidth: 0 })}---\n${body}`
}

export function previewFromSnapshot(snapshot: TemplateSnapshot): TemplatePreview | null {
  if (!snapshot.template?.trim()) return null
  const metadata = Object.fromEntries([['type', snapshot.title], ...snapshot.defaults.map(({ key, value }) => [key, value])])
  return { snapshot, content: documentContent(metadata, buildNoteBody({ template: snapshot.template, initialEmptyHeading: true })) }
}

function failure(error: unknown): TemplateFailure {
  return error instanceof TemplateOperationError ? error.reason : 'readFailed'
}

function sameSource(a: TemplateSource, b: TemplateSource): boolean {
  return notePathsMatch(a.vaultPath, b.vaultPath) && notePathsMatch(a.path, b.path)
}

type NewAttempt = { path: string; content: string; snapshot: TemplateSnapshot; draft: TemplateDraft }
type SaveAttempt = { kind: 'new'; value: NewAttempt } | { kind: 'existing'; value: TemplateWriteRequest }
type PageAttempt = { path: string; preview: TemplatePreview }
interface ScopeState {
  deps: TemplateDomainDeps
  target: OpenReservation
  current(): boolean
  busy: boolean
  generation: number
  saveAttempt?: SaveAttempt
  pageAttempt?: PageAttempt
  lastSave?: Extract<TemplateSaveResult, { status: 'saved' }>
  created?: TemplateCreateResult
}

const saveFailure = (reason: TemplateFailure, revision: number): Extract<TemplateSaveResult, { status: 'failed' }> => ({ status: 'failed', reason, revision, write: 'notStarted' })
const createFailure = (reason: TemplateFailure): Extract<TemplateCreateResult, { status: 'failed' }> => ({ status: 'failed', reason, write: 'notStarted' })
const uncertain = (path: string, reason: TemplateFailure = 'unconfirmed') => ({ status: 'failed' as const, reason, write: 'unconfirmed' as const, attemptedPath: path })

async function refresh(state: ScopeState): Promise<boolean> {
  if (!state.current()) return true
  try { await state.deps.refresh?.(); return false } catch { return true }
}

async function saved(state: ScopeState, snapshot: TemplateSnapshot, draft: Pick<TemplateDraft, 'text' | 'revision'>): Promise<TemplateSaveResult> {
  const result = { status: 'saved' as const, source: snapshot.source, snapshot, text: draft.text, revision: draft.revision, refreshPending: await refresh(state) }
  state.lastSave = result
  state.saveAttempt = undefined
  return result
}

async function savedNew(state: ScopeState, attempt: NewAttempt): Promise<TemplateSaveResult> {
  let publicationFailed = false
  if (state.current()) {
    try {
      const slug = attempt.path.split('/').at(-1)!.replace(/\.md$/i, '')
      state.deps.addEntry({ ...buildNewEntry({ path: attempt.path, slug, title: attempt.snapshot.title, type: 'Type', status: null }), template: attempt.draft.text })
      state.deps.onPersisted?.(attempt.path)
    } catch { publicationFailed = true }
  }
  const receipt = await saved(state, attempt.snapshot, attempt.draft)
  if (receipt.status === 'saved') receipt.refreshPending ||= publicationFailed
  return receipt
}

async function settledSnapshot(state: ScopeState, source: TemplateSource): Promise<TemplateSnapshot> {
  if (!state.current() || !notePathsMatch(source.vaultPath, state.deps.vaultPath)) throw new TemplateOperationError('stale')
  try { await state.deps.flushSource?.(source.path) } catch { throw new TemplateOperationError('saveHeld') }
  if (!state.current()) throw new TemplateOperationError('stale')
  const snapshot = await readTemplateSnapshot(source, state.deps.readEntry)
  if (!state.current()) throw new TemplateOperationError('stale')
  return snapshot
}

async function publishPage(state: ScopeState, attempt: PageAttempt): Promise<TemplateCreateResult> {
  state.pageAttempt = undefined
  const result: TemplateCreateResult = { status: 'created', path: attempt.path }
  // Confirmation survives refresh/open failures and a stale attachment destination.
  state.created = result
  if (!state.current()) return result
  const slug = attempt.path.split('/').at(-1)!.replace(/\.md$/i, '')
  const defaults = attempt.preview.snapshot.defaults
  let entry: VaultEntry = { ...buildNewEntry({ path: attempt.path, slug, title: '', type: attempt.preview.snapshot.title, status: null }),
    ...deriveDisplayTitleState({ content: attempt.preview.content, filename: `${slug}.md` }),
    properties: Object.fromEntries(defaults.filter(item => item.kind === 'property').map(({ key, value }) => [key, value])),
    relationships: Object.fromEntries(defaults.filter(item => item.kind === 'relationship').map(({ key, value }) => [key, Array.isArray(value) ? value : [String(value)]])) }
  try {
    const fresh = await state.deps.readEntry({ vaultPath: state.deps.vaultPath, path: attempt.path })
    if (fresh && notePathsMatch(fresh.path, attempt.path)) entry = { ...entry, ...fresh }
  } catch { /* Known bytes still provide a usable page when the listing cannot refresh. */ }
  if (!state.current()) return result
  try {
    state.deps.onPersisted?.(attempt.path)
    state.deps.addEntry(entry)
    if (state.current() && await state.target.open(entry, attempt.preview.content)) {
      state.created = { status: 'opened', path: attempt.path }
      if (state.target.inSession() && state.target.isActive()) requestEditorFocus({ path: attempt.path, cursorAtEnd: true })
    }
  } catch { /* The file exists; attachment failure is not a failed create. */ }
  return state.created
}

async function writeNewFile(state: ScopeState, path: string, content: string): Promise<'confirmed' | 'collision' | 'unconfirmed'> {
  state.deps.markWrite?.(path)
  try { await state.deps.createFile(path, content, state.deps.vaultPath); return 'confirmed' }
  catch (error) { return /already exists|EEXIST/i.test(String(error)) ? 'collision' : 'unconfirmed' }
}

async function checkAttempt(state: ScopeState, path: string, content: string): Promise<'present' | 'missing' | 'different' | 'unreadable'> {
  try { return await state.deps.readContent(path, state.deps.vaultPath) === content ? 'present' : 'different' }
  catch (error) { return /ENOENT|No such file|not found/i.test(String(error)) ? 'missing' : 'unreadable' }
}

async function createPage(state: ScopeState, preview: TemplatePreview, pendingSlugs: Set<string>): Promise<TemplateCreateResult> {
  if (state.created) return state.created
  let attempt = state.pageAttempt
  if (attempt) {
    const checked = await checkAttempt(state, attempt.path, attempt.preview.content)
    if (checked === 'present') return publishPage(state, attempt)
    if (checked !== 'missing') return uncertain(attempt.path, checked === 'different' ? 'collision' : 'unconfirmed')
  } else {
    const snapshot = await settledSnapshot(state, preview.snapshot.source)
    const fresh = previewFromSnapshot(snapshot)
    if (!fresh) return createFailure('empty')
    if (snapshot.revision !== preview.snapshot.revision || fresh.content !== preview.content) return { status: 'previewChanged', preview: fresh }
    const slug = generateUntitledFilename(state.deps.entries, snapshot.title, pendingSlugs)
    const path = joinVaultPath(state.deps.vaultPath, [snapshot.destinationDirectory, `${slug}.md`].filter(Boolean).join('/'))
    attempt = { path, preview: fresh }
  }
  if (!state.current()) return state.pageAttempt ? uncertain(attempt.path, 'stale') : createFailure('stale')
  const outcome = await writeNewFile(state, attempt.path, attempt.preview.content)
  if (outcome === 'confirmed') return publishPage(state, attempt)
  if (outcome === 'collision' && !state.pageAttempt) return { ...createFailure('collision'), attemptedPath: attempt.path }
  state.pageAttempt = attempt
  return uncertain(attempt.path, outcome === 'collision' ? 'collision' : 'unconfirmed')
}

function newTemplate(state: ScopeState, draft: Extract<TemplateDraft, { kind: 'new' }>): NewAttempt {
  const name = draft.name.trim()
  if (!name || !draft.text.trim()) throw new TemplateOperationError('empty')
  if (/[\r\n\0]/.test(name)) throw new TemplateOperationError('invalidSource')
  const slug = slugifyNoteStem(name)
  if (!slug || slug === '.' || slug === '..') throw new TemplateOperationError('invalidSource')
  const source = { vaultPath: state.deps.vaultPath, path: joinVaultPath(state.deps.vaultPath, `${slug}.md`) }
  const entry = { ...buildNewEntry({ path: source.path, slug, title: name, type: 'Type', status: null }), template: draft.text }
  const snapshot = snapshotFromEntry(source, entry)!
  return { path: source.path, content: documentContent({ type: 'Type', title: name, template: draft.text }), snapshot, draft }
}

async function saveNew(state: ScopeState, attempt: NewAttempt, retry: boolean): Promise<TemplateSaveResult> {
  if (retry) {
    const checked = await checkAttempt(state, attempt.path, attempt.content)
    if (checked === 'present') return savedNew(state, attempt)
    if (checked !== 'missing') return { ...uncertain(attempt.path, checked === 'different' ? 'collision' : 'unconfirmed'), revision: attempt.draft.revision }
  }
  if (!state.current()) return retry ? { ...uncertain(attempt.path, 'stale'), revision: attempt.draft.revision } : saveFailure('stale', attempt.draft.revision)
  const outcome = await writeNewFile(state, attempt.path, attempt.content)
  if (outcome === 'confirmed') return savedNew(state, attempt)
  if (outcome === 'collision' && !retry) return { ...saveFailure('collision', attempt.draft.revision), attemptedPath: attempt.path }
  state.saveAttempt = { kind: 'new', value: attempt }
  return { ...uncertain(attempt.path, outcome === 'collision' ? 'collision' : 'unconfirmed'), revision: attempt.draft.revision }
}

async function saveExisting(state: ScopeState, request: TemplateWriteRequest, retry: boolean): Promise<TemplateSaveResult> {
  let result = await state.deps.writeExisting({ ...request, reconcile: retry })
  if (retry && result.status === 'failed') result = { ...uncertain(request.source.path, result.reason), revision: request.revision }
  if (result.status === 'failed' && result.write === 'unconfirmed') state.saveAttempt = { kind: 'existing', value: request }
  else state.saveAttempt = undefined
  if (result.status === 'saved') state.lastSave = result
  return result
}

async function saveDraft(state: ScopeState, draft: TemplateDraft): Promise<TemplateSaveResult> {
  const retained = state.saveAttempt
  if (retained) {
    try { return retained.kind === 'new' ? await saveNew(state, retained.value, true) : await saveExisting(state, retained.value, true) }
    catch {
      const path = retained.kind === 'new' ? retained.value.path : retained.value.source.path
      const revision = retained.kind === 'new' ? retained.value.draft.revision : retained.value.revision
      return { ...uncertain(path), revision }
    }
  }
  // Only a retained unknown belongs to the earlier New form. A later New form is always exclusive.
  // The UI converts acknowledged drafts (including newer unsaved text) to their existing source.
  if (draft.kind === 'new') return saveNew(state, newTemplate(state, draft), false)
  const { source, expected } = draft
  if (state.lastSave && sameSource(state.lastSave.source, source)
    && state.lastSave.revision === draft.revision && state.lastSave.text === draft.text) return state.lastSave
  if (!sameSource(source, expected.source) || !notePathsMatch(source.vaultPath, state.deps.vaultPath) || !relativeSource(source)) return saveFailure('invalidSource', draft.revision)
  return saveExisting(state, { source, expected, text: draft.text, revision: draft.revision, current: state.current }, false)
}

/** Feature admission/receipts only; existing-page writes still belong to the application's save queue. */
export function createTemplateController(getDeps: () => TemplateDomainDeps): TemplateController {
  const scopes = new WeakMap<TemplateScope, ScopeState>()
  const active = new Set<Promise<unknown>>()
  const pendingSlugs = new Set<string>()
  let holds = 0
  let next = 0
  const track = <T,>(work: Promise<T>): Promise<T> => {
    active.add(work)
    void work.finally(() => active.delete(work)).catch(() => {})
    return work
  }
  const admission = (scope: TemplateScope) => {
    const state = scopes.get(scope)
    return { state, reason: holds || state?.busy ? 'busy' as const : !state?.current() ? 'stale' as const : null }
  }
  const mutate = <T,>(scope: TemplateScope, refused: (reason: TemplateFailure) => T, work: (state: ScopeState) => Promise<T>) => {
    const { state, reason } = admission(scope)
    if (reason || !state) return Promise.resolve(refused(reason ?? 'stale'))
    state.busy = true
    state.generation += 1
    return track(work(state).catch(error => refused(failure(error))).finally(() => { state.busy = false }))
  }
  return {
    begin() {
      const deps = getDeps()
      if (holds || !deps.ready || !deps.vaultPath) return null
      const target = deps.reserveOpen()
      const navigation = deps.markNavigation()
      let cancelled = false
      const scope: TemplateScope = { id: String(++next), vaultPath: deps.vaultPath, cancel: () => { cancelled = true } }
      scopes.set(scope, { deps, target, busy: false, generation: 0,
        current: () => !cancelled && getDeps().session === deps.session && target.inSession() && navigation.current() })
      return scope
    },
    prepare(scope, source) {
      const { state, reason } = admission(scope)
      if (reason || !state) return Promise.resolve({ status: 'failed', reason: reason ?? 'stale' })
      if (state.saveAttempt || state.pageAttempt) return Promise.resolve({ status: 'failed', reason: 'unconfirmed' })
      const generation = ++state.generation
      return track((async (): Promise<TemplateReadResult> => {
        try {
          const snapshot = await settledSnapshot(state, source)
          if (generation !== state.generation) return { status: 'failed', reason: 'stale' }
          return { status: 'ready', snapshot, preview: previewFromSnapshot(snapshot) }
        } catch (error) { return { status: 'failed', reason: failure(error) } }
      })())
    },
    save: (scope, draft) => mutate<TemplateSaveResult>(scope, reason => saveFailure(reason, draft.revision), state => saveDraft(state, { ...draft })),
    create: (scope, preview) => mutate<TemplateCreateResult>(scope, createFailure, state => createPage(state, preview, pendingSlugs)),
    holdAdmission() { holds += 1; let released = false; return () => { if (!released) { released = true; holds -= 1 } } },
    async whenIdle() { while (active.size) await Promise.allSettled([...active]) },
  }
}
