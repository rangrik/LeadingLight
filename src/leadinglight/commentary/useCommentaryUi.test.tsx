// The commentary host as App wires it: capture from a pane endpoint, the source settled first,
// the dialog, the note opened beside, and the Undo notice going through the note's own lane.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { MutateExistingDocument, RunPageExclusive } from '../../hooks/useAppSave'
import type { VaultEntry } from '../../types'
import { CAPABILITIES } from '../extensions/extensionContract'
import { createExtensionController } from '../extensions/extensionSessionController'
import { fakeRegistry, fixtureText, packageOf } from '../extensions/extensions.test-utils'
import type { AppendProposal, ProposalReceipt } from '../proposals/proposalContract'
import type { Extensions } from '../extensions/useExtensions'
import { sha256Hex } from '../saveOutcome'
import type { BesideReservation } from '../useSplitWorkspace'
import type { CapturedPassage, CommentaryPreparation } from './commentaryContract'
import type { EditorPassageRead } from './commentaryContext'
import type { CommentaryServices } from './CommentaryPorts'
import { useCommentaryUi, type CommentaryUiOptions } from './useCommentaryUi'

vi.mock('../extensions/extensionMarkdownText', async () => (await import('../extensions/extensionEncoder.test-utils')).encoderStandIn())
vi.mock('../../utils/macosDismissableEscapeSurface', () => ({
  registerMacosDismissableEscapeSurface: () => () => {},
  useMacosDismissableEscapeSurfaceRef: (ref: unknown) => ref ?? (() => {}),
}))
vi.mock('../../hooks/useEditorFocus', () => ({ requestEditorFocus: vi.fn() }))

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.scrollIntoView ??= () => {}
})

const VAULT = '/vault'
const SOURCE = `${VAULT}/Topics/source.md`
const NOTE = `${VAULT}/Topics/commentary-on-source-page.md`
const SOURCE_TEXT = '# Source page\n\nThe passage.\n'
const BASELINE = '---\n_leadinglight_commentary: {}\n---\n# Commentary on Source page\n\n[Source](./source.md)\n\n> Earlier\n'
const ENTRY = '> The passage\n'
const CAPTURED: CapturedPassage = {
  id: 'c1', sourcePath: 'Topics/source.md', sourceTitle: 'Source page',
  selector: { projection: 'leadinglight-text-v1', exact: 'The passage', prefix: '', suffix: '', sourceBodySha256: 'a'.repeat(64), start: 0, end: 11 },
}
const entry = (path: string, title = 'Source page'): VaultEntry => ({ path, filename: path.split('/').pop()!, title, isA: null, aliases: [], belongsTo: [],
  relatedTo: [], status: null, archived: false, modifiedAt: 1, createdAt: 1, fileSize: 1, snippet: '', wordCount: 0, relationships: {}, icon: null,
  color: null, order: null, sidebarLabel: null, template: null, sort: null, view: null, visible: null, organized: false, favorite: false,
  favoriteIndex: null, listPropertiesDisplay: [], outgoingLinks: [], properties: {}, hasH1: true })

function services(linked: boolean): CommentaryServices {
  return {
    buildCapture: vi.fn(async ({ token }) => ({ status: 'ready' as const, captured: CAPTURED, capture: { passage: token, quote: 'The passage', sourceTitle: 'Source page' } })),
    mayBeCommentary: content => content.startsWith('---') && content.includes('_leadinglight_commentary'),
    readNote: (path, content) => ({ path, title: null, record: { status: content.includes('_leadinglight_commentary') ? 'ready' : 'none', record: { version: 1, id: 'x', captures: [] } } as never,
      source: { status: 'linked', sourcePath: 'Topics/source.md', destination: './source.md' } }),
    discover: vi.fn(async () => ({ sourcePath: 'Topics/source.md', complete: true, skipped: 0,
      linked: linked ? [{ path: 'Topics/commentary-on-source-page.md', title: 'Commentary on Source page', modifiedAt: 2, appendable: true, record: 'ready' as const, captures: 1 }] : [] })),
    plan: discovery => (discovery.linked[0] ? { kind: 'append', target: discovery.linked[0] } : { kind: 'create', separate: false }),
    name: (title, _folder, separate) => ({ title: separate ? `${title} 2` : title, fileName: 'commentary-on-source-page.md' }),
    isTaken: () => false,
    prepareCreate: ({ name, folder }): CommentaryPreparation => ({ status: 'ready', entry: ENTRY,
      write: { kind: 'create', path: `${folder}/${name.fileName}`, folder, fileName: name.fileName, title: name.title, content: `# ${name.title}\n\n${ENTRY}` } }),
    prepareAppend: ({ baseline, baselineSha256, path }): CommentaryPreparation => ({ status: 'ready', entry: ENTRY,
      write: { kind: 'append', path, expectedSha256: baselineSha256, content: `${baseline}\n${ENTRY}` } }),
    canAppendAfter: () => true,
  }
}

/** The page lane: runs publish at once and gives open tabs the bytes it takes. */
function lane(tabs: { entry: VaultEntry; content: string }[]) {
  const mutate: MutateExistingDocument = (path, mutation) => ({
    admitted: true, path,
    done: (async () => {
      const result = await mutation.publish(path)
      const content = mutation.committedContent(result)
      const tab = tabs.find(item => item.entry.path === path)
      if (tab && content !== null) tab.content = content
      return { kind: 'returned', path, result, current: true, integration: 'none', latest: content }
    })(),
  })
  return vi.fn<RunPageExclusive>(async (_path, work) => work(mutate))
}

async function mount(options: { read?: EditorPassageRead; settle?: () => Promise<unknown>; linked?: boolean; disk?: Record<string, string> } = {}) {
  const registry = fakeRegistry([await packageOf([fixtureText('passage-commentary.json')], 'newest')], VAULT)
  const controller = createExtensionController({ api: registry.transport, hostCapabilities: CAPABILITIES })
  controller.enter(VAULT)
  await controller.refresh()
  const tabs = [{ entry: entry(SOURCE), content: SOURCE_TEXT }]
  const beside: BesideReservation = {
    pane: 1, inSession: () => true, effect: () => ({ kind: 'beside' }),
    open: vi.fn(async (opened: VaultEntry, content: string) => { if (!tabs.some(tab => tab.entry.path === opened.path)) tabs.push({ entry: opened, content }); return true }),
  }
  const notify = vi.fn()
  const onTrashed = vi.fn()
  const runPageExclusive = lane(tabs)
  const props = (): CommentaryUiOptions => ({
    locale: 'en', vaultPath: VAULT, services: svc, entries: [entry(SOURCE), entry(NOTE, 'Commentary on Source page')], tabs: [...tabs],
    extensions: { controller, snapshot: controller.snapshot(), runnable: [], boundary: { begin: () => () => {}, settle: async () => {} } } as Extensions,
    workspace: {
      paths: [SOURCE, tabs.some(tab => tab.entry.path === NOTE) ? NOTE : null], activePane: 0, split: tabs.length > 1, orientation: 'horizontal',
      reserveBeside: () => beside, currentTabs: () => tabs, focusPane: vi.fn(), placeNote: vi.fn(async () => true),
    },
    settle: options.settle ?? (async () => {}), runPageExclusive, read: async path => options.disk?.[path] ?? tabs.find(tab => tab.entry.path === path)?.content ?? null,
    addEntry: vi.fn(), markInternalWrite: vi.fn(), onPersisted: vi.fn(), notify, onTrashed,
    canOpen: () => true, blocked: false, narrow: () => false, openFinder: vi.fn(),
  })
  const svc = services(options.linked ?? false)
  let ui: ReturnType<typeof useCommentaryUi> | null = null
  function Harness() {
    ui = useCommentaryUi(props())
    ui.captureRefs[0].current = () => options.read ?? { status: 'ok', passage: { path: SOURCE, documentSession: 1, markdown: SOURCE_TEXT, selection: { mode: 'rich', text: 'The passage', before: '', after: '' } } }
    return <>{ui.dialogs}{ui.renderNotice(NOTE)}</>
  }
  const view = render(<Harness />)
  const rerender = () => view.rerender(<Harness />)
  return { registry, controller, notify, onTrashed, beside, tabs, svc, rerender, comment: () => act(async () => { ui!.paneAction(0)?.comment() }) }
}

describe('starting a comment', () => {
  it('asks for a selection first and opens nothing for an empty one', async () => {
    const host = await mount({ read: { status: 'empty' } })
    await host.comment()
    expect(host.notify).toHaveBeenCalledWith('Select a passage first, then choose Comment on passage.')
    expect(screen.queryByTestId('commentary-dialog')).toBeNull()
  })

  it('refuses while the source page cannot be saved, and captures nothing', async () => {
    const host = await mount({ settle: async () => { throw new Error('held') } })
    await host.comment()
    expect(host.notify).toHaveBeenCalledWith('Save this page first. Its latest words couldn’t be saved.')
    expect(host.svc.buildCapture).not.toHaveBeenCalled()
    expect(screen.queryByTestId('commentary-dialog')).toBeNull()
  })
})

describe('the whole run', () => {
  it('creates the note beside the source and shows its notice', async () => {
    const host = await mount()
    await host.comment()
    expect(await screen.findByTestId('commentary-dialog')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('commentary-submit')).toHaveTextContent('Create'))
    fireEvent.click(screen.getByTestId('commentary-submit'))
    await waitFor(() => expect(screen.queryByTestId('commentary-dialog')).toBeNull())
    expect(host.beside.open).toHaveBeenCalled()
    host.rerender()
    expect(screen.getByTestId('commentary-notice')).toHaveTextContent('Created beside Source page.')
  })

  it('adds to the linked note through its lane, and Undo restores the exact earlier text', async () => {
    const host = await mount({ linked: true, disk: { [NOTE]: BASELINE } })
    host.tabs.push({ entry: entry(NOTE, 'Commentary on Source page'), content: BASELINE })
    const baselineSha = await sha256Hex(BASELINE)
    host.registry.api.bindDocument.mockImplementation(async () => ({ status: 'bound', documentHandle: 'doc-1', displayPath: 'Topics/commentary-on-source-page.md', contentSha256: baselineSha }) as never)
    host.registry.api.submitProposal.mockImplementation(async proposal => ({
      status: 'committed', kind: 'append', operationId: proposal.operationId, path: NOTE, beforeSha256: baselineSha,
      afterSha256: (proposal as AppendProposal).contentSha256, durable: true, undoReceipt: 'undo-1',
    } as ProposalReceipt))
    host.rerender()
    await host.comment()
    await waitFor(() => expect(screen.getByTestId('commentary-submit')).toHaveTextContent('Add'))
    fireEvent.click(screen.getByTestId('commentary-submit'))
    await waitFor(() => expect(screen.queryByTestId('commentary-dialog')).toBeNull())
    expect(host.tabs.find(tab => tab.entry.path === NOTE)?.content).toBe(`${BASELINE}\n${ENTRY}`)
    host.rerender()
    expect(screen.getByTestId('commentary-notice')).toHaveTextContent('Added to this note.')

    host.registry.api.undoProposal.mockImplementation(async request => ({
      status: 'undone', operationId: request.operationId, kind: 'append', path: NOTE, restoredSha256: baselineSha, durable: true,
    }))
    fireEvent.click(screen.getByTestId('commentary-undo'))
    await waitFor(() => expect(host.notify).toHaveBeenCalledWith('The passage was taken out of this note.'))
    expect(host.tabs.find(tab => tab.entry.path === NOTE)?.content).toBe(BASELINE)
    expect(host.registry.api.undoProposal.mock.calls[0][0]).toMatchObject({ undoReceipt: 'undo-1', kind: 'append', beforeSha256: baselineSha })
    expect(host.onTrashed).not.toHaveBeenCalled()
  })
})
