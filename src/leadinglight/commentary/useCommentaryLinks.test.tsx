// Typing never runs the note parser: an ordinary page is never parsed, however long or often it
// changes, and a commentary is read when first shown and then only after its text is still, keeping
// its last card meanwhile. Source edits update or remove the card. The real domain parser is spied on.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '../../types'
import { captureOf, composedFor, uuid } from './commentary.test-utils'
import { prepareCommentaryCreate } from './commentaryPreparation'
import type { CommentaryServices } from './CommentaryPorts'
import { commentaryServices, mayBeCommentary } from './CommentaryServices'
import { COMMENTARY_PARSE_IDLE_MS, useCommentaryLinks } from './useCommentaryLinks'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../../mock-tauri', () => ({ isTauri: () => false, mockInvoke: vi.fn() }))

const VAULT = '/vault'
const ORDINARY = `${VAULT}/Topics/ordinary.md`
const NOTE = `${VAULT}/Topics/commentary-on-source.md`
const entry = (path: string) => ({ path, fileKind: 'markdown' }) as VaultEntry
const ENTRIES = [entry(ORDINARY), entry(NOTE), entry(`${VAULT}/Topics/source.md`), entry(`${VAULT}/Topics/other.md`)]

function commentaryText(): string {
  const source = '# Source\n\nThe passage here.\n'
  const capture = captureOf(source, 'passage', { sourcePath: 'Topics/source.md', sourceTitle: 'Source' })
  const prepared = prepareCommentaryCreate({
    capture, document: composedFor(capture, { thought: 'Mine' }, 'create'), commentaryId: uuid(9), folder: 'Topics',
    title: 'Commentary on Source', fileName: 'commentary-on-source.md',
  })
  if (prepared.status !== 'ready') throw new Error(`preparation refused: ${prepared.reason}`)
  return prepared.write.content
}

function setup() {
  const readNote = vi.fn<CommentaryServices['readNote']>((path, content) => commentaryServices.readNote(path, content))
  const services: CommentaryServices = {
    ...commentaryServices,
    readNote,
    discover: vi.fn(async ({ sourcePath }) => ({ sourcePath, complete: true, linked: [], skipped: 0 })),
  }
  const hook = renderHook(({ pages }: { pages: { path: string; content: string }[] }) =>
    useCommentaryLinks({ vaultPath: VAULT, services, entries: ENTRIES, pages, epoch: 0 }), { initialProps: { pages: [] as { path: string; content: string }[] } })
  const show = (path: string, content: string) => act(() => { hook.rerender({ pages: [{ path, content }] }) })
  const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  return { readNote, hook, show, wait }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('the cheap gate', () => {
  it('looks only at front matter: a body that mentions the record key is not a commentary', () => {
    expect(mayBeCommentary('# Plain\n\nNo front matter.\n')).toBe(false)
    expect(mayBeCommentary('---\ntitle: x\n---\n# Doc\n\nThe key `_leadinglight_commentary` is described here.\n')).toBe(false)
    expect(mayBeCommentary(commentaryText())).toBe(true)
  })
})

describe('typing in an ordinary page', () => {
  it('never runs the commentary parser, however long the page or how often it changes', async () => {
    const { readNote, hook, show, wait } = setup()
    const long = `---\ntitle: Long\n---\n# Long page\n\n${'A sentence of ordinary writing. '.repeat(8000)}\n`
    for (let typed = 0; typed < 60; typed += 1) {
      await show(ORDINARY, `${long}${'x'.repeat(typed)}`)
      await wait(30)
    }
    await wait(COMMENTARY_PARSE_IDLE_MS * 3)
    await show(ORDINARY, `# No front matter\n\n${'word '.repeat(50000)}`)
    await wait(COMMENTARY_PARSE_IDLE_MS * 3)
    expect(readNote).not.toHaveBeenCalled()
    expect(hook.result.current.noteOf(ORDINARY)).toBeNull()
  })
})

describe('a commentary', () => {
  it('is read when first shown, not while typed in, and once more after the text is still', async () => {
    const { readNote, hook, show, wait } = setup()
    const text = commentaryText()
    await show(NOTE, text)
    expect(readNote).not.toHaveBeenCalled()
    await wait(0)
    expect(readNote).toHaveBeenCalledTimes(1)
    expect(hook.result.current.noteOf(NOTE)?.source).toMatchObject({ status: 'linked', sourcePath: 'Topics/source.md' })

    for (let typed = 1; typed <= 40; typed += 1) {
      await show(NOTE, `${text}${'more words '.repeat(typed)}`)
      await wait(COMMENTARY_PARSE_IDLE_MS / 4)
      // The card stays while the note is typed in.
      expect(hook.result.current.noteOf(NOTE)?.source).toMatchObject({ status: 'linked' })
    }
    expect(readNote).toHaveBeenCalledTimes(1)
    await wait(COMMENTARY_PARSE_IDLE_MS)
    expect(readNote).toHaveBeenCalledTimes(2)
  })

  it('follows Source edits after a pause, and loses its card at once when the record goes', async () => {
    const { hook, show, wait } = setup()
    const text = commentaryText()
    await show(NOTE, text)
    await wait(0)
    expect(hook.result.current.noteOf(NOTE)?.source).toMatchObject({ status: 'linked', sourcePath: 'Topics/source.md' })

    await show(NOTE, text.replace('[Source](./source.md)', '[Source](./other.md)'))
    await wait(COMMENTARY_PARSE_IDLE_MS)
    expect(hook.result.current.noteOf(NOTE)?.source).toMatchObject({ status: 'linked', sourcePath: 'Topics/other.md' })

    await show(NOTE, text.replace('[Source](./source.md)', 'See [Source](./source.md) and [Other](./other.md)'))
    await wait(COMMENTARY_PARSE_IDLE_MS)
    expect(hook.result.current.noteOf(NOTE)?.source.status).not.toBe('linked')

    const body = text.slice(text.indexOf('\n---\n') + 5)
    await show(NOTE, body)
    expect(hook.result.current.noteOf(NOTE)).toBeNull()
  })
})
