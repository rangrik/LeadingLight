// The domain binding against the real commentary domain: capture from rich and raw selections of
// the saved page (CRLF included), the stale refusal, naming, and create/append preparation.
import { describe, expect, it, vi } from 'vitest'
import { sha256Hex } from '../saveOutcome'
import type { VaultEntry } from '../../types'
import { readCommentaryNote, sourceBodyOf } from './commentaryFormat'
import { composedFor } from './commentary.test-utils'
import { commentaryServices } from './CommentaryServices'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../../mock-tauri', () => ({ isTauri: () => false, mockInvoke: vi.fn() }))

const SOURCE = '# Source page\r\n\r\nThe first passage.\r\n\r\nA second passage here.\r\n'
const TOKEN = 'passage-1'
const capture = (passage: Parameters<typeof commentaryServices.buildCapture>[0]['passage'], settled = passage.markdown) =>
  commentaryServices.buildCapture({ passage, settled, sourcePath: 'Topics/source.md', sourceTitle: 'Source page', token: TOKEN })

describe('capture', () => {
  it('maps a raw CodeMirror selection on a CRLF page to the exact passage, anchored, with the body digest', async () => {
    const editor = SOURCE.replace(/\r\n/g, '\n')
    const from = editor.indexOf('second passage')
    const built = await capture({ path: '/v/Topics/source.md', documentSession: 1, markdown: SOURCE, selection: { mode: 'raw', from, to: from + 'second passage'.length } })
    expect(built.status).toBe('ready')
    if (built.status !== 'ready') return
    expect(built.captured.selector).toMatchObject({ exact: 'second passage', sourceBodySha256: await sha256Hex(sourceBodyOf(SOURCE)) })
    expect(built.captured.selector.start).not.toBeNull()
    expect(built.capture).toEqual({ passage: TOKEN, quote: 'second passage', sourceTitle: 'Source page' })
  })

  it('anchors a rich selection by its visible context, and keeps an unplaceable one as exact text only', async () => {
    const anchored = await capture({ path: '/v/Topics/source.md', documentSession: 1, markdown: SOURCE,
      selection: { mode: 'rich', text: 'first passage', before: 'Source page\nThe ', after: '.\nA second passage here.' } })
    expect(anchored.status === 'ready' && anchored.captured.selector.start).not.toBeNull()
    const unplaced = await capture({ path: '/v/Topics/source.md', documentSession: 1, markdown: SOURCE,
      selection: { mode: 'rich', text: 'Not in this page', before: '', after: '' } })
    expect(unplaced.status === 'ready' && unplaced.captured.selector).toMatchObject({ exact: 'Not in this page', start: null, end: null })
  })

  it('refuses a capture whose page saved as other text than the editor held', async () => {
    const passage = { path: '/v/Topics/source.md', documentSession: 1, markdown: SOURCE, selection: { mode: 'raw' as const, from: 0, to: 4 } }
    expect(await capture(passage, `${SOURCE}typed`)).toEqual({ status: 'refused', reason: 'stale' })
  })
})

describe('naming and preparation', () => {
  const entry = (path: string) => ({ path }) as VaultEntry
  const listing = { vaultPath: '/v', entries: [entry('/v/Topics/commentary-on-source-page.md')] }

  it('says the default name even when an unlinked note has it, and numbers a separate note past taken names', () => {
    expect(commentaryServices.name('Commentary on Source page', 'Topics', false, listing)).toEqual({ title: 'Commentary on Source page', fileName: 'commentary-on-source-page.md' })
    expect(commentaryServices.isTaken('Topics', 'commentary-on-source-page.md', listing)).toBe(true)
    expect(commentaryServices.name('Commentary on Source page', 'Topics', true, listing)).toEqual({ title: 'Commentary on Source page 2', fileName: 'commentary-on-source-page-2.md' })
  })

  it('prepares a new note linked to its source, then one whole postimage that adds a second entry', async () => {
    const first = await capture({ path: '/v/Topics/source.md', documentSession: 1, markdown: SOURCE,
      selection: { mode: 'rich', text: 'first passage', before: 'Source page\nThe ', after: '.' } })
    if (first.status !== 'ready') throw new Error('capture refused')
    const created = commentaryServices.prepareCreate({ captured: first.captured, document: composedFor(first.captured, { thought: 'Mine' }, 'create'),
      commentaryId: crypto.randomUUID(), folder: 'Topics', name: { title: 'Commentary on Source page', fileName: 'commentary-on-source-page.md' } })
    expect(created.status).toBe('ready')
    if (created.status !== 'ready') return
    const note = readCommentaryNote('Topics/commentary-on-source-page.md', created.write.content)
    expect(note.source).toMatchObject({ status: 'linked', sourcePath: 'Topics/source.md' })
    expect(created.write.content).toContain('\n# Commentary on Source page\n\n[Source](./source.md)\n\n> first passage\n\nMine\n')

    const second = await capture({ path: '/v/Topics/source.md', documentSession: 1, markdown: SOURCE,
      selection: { mode: 'rich', text: 'second passage', before: 'A ', after: ' here.' } })
    if (second.status !== 'ready') throw new Error('capture refused')
    const baseline = created.write.content
    const appended = commentaryServices.prepareAppend({ captured: second.captured, document: composedFor(second.captured, { question: 'Why?' }, 'append'),
      path: 'Topics/commentary-on-source-page.md', baseline, baselineSha256: await sha256Hex(baseline) })
    expect(appended.status).toBe('ready')
    if (appended.status !== 'ready') return
    expect(appended.write.content.endsWith('> second passage\n\n- Question: Why?\n')).toBe(true)
    expect(commentaryServices.canAppendAfter(baseline)).toBe(true)
    expect(commentaryServices.canAppendAfter(`${baseline}\n\`\`\`js\nopen\n`)).toBe(false)
  })
})
