import { describe, expect, it } from 'vitest'
import type { CommentaryDiscovery, LinkedCommentary } from './commentaryContract'
import { discoverLinkedCommentaries, planCommentaryDestination, type DiscoveryCandidate } from './commentaryDiscovery'
import { serializeCommentaryRecord } from './commentaryFormat'
import { SOURCE_SHA, uuid } from './commentary.test-utils'

const SOURCE = 'Topics/example.md'

const recordLines = (version = '1') => serializeCommentaryRecord({
  version: 1, id: uuid(0xd0),
  captures: [{ id: uuid(1), projection: 'leadinglight-text-v1', exact: 'q', prefix: '', suffix: '', sourceBodySha256: SOURCE_SHA, start: null, end: null }],
}).replace('version: 1', `version: ${version}`)

const commentary = (destination: string, title = 'Commentary on Example', version = '1') =>
  `---\n${recordLines(version)}\n---\n# ${title}\n\n[Source](${destination})\n\n> q\n`

function vault(files: Record<string, string | null>, times: Record<string, number> = {}) {
  const reads: string[] = []
  const candidates: DiscoveryCandidate[] = Object.keys(files).map(path => ({ path, modifiedAt: times[path] ?? null }))
  const read = async (path: string) => {
    reads.push(path)
    const content = files[path]
    if (content === undefined) throw new Error('no such note')
    return content
  }
  return { candidates, read, reads }
}

describe('discovering linked commentaries', () => {
  it('finds only notes whose own Source line reaches this source, most recent first', async () => {
    const { candidates, read } = vault({
      [SOURCE]: '# Example\n',
      'Topics/commentary-on-example.md': commentary('./example.md'),
      'Topics/commentary-on-example-2.md': commentary('./example.md', 'Commentary on Example 2'),
      'Elsewhere/moved.md': commentary('../Topics/example.md', 'Moved'),
      'Elsewhere/stale.md': commentary('./example.md', 'Stale link from a moved note'),
      'Topics/other.md': commentary('./other-source.md', 'Other'),
      'Topics/plain.md': '# Plain\n\n[Source](./example.md)\n',
      'Topics/same-title.md': '# Commentary on Example\n\nUnrelated.\n',
    }, { 'Topics/commentary-on-example.md': 10, 'Topics/commentary-on-example-2.md': 30, 'Elsewhere/moved.md': 20 })
    const discovery = await discoverLinkedCommentaries({ sourcePath: SOURCE, candidates, read })
    expect(discovery).toEqual({
      sourcePath: SOURCE, complete: true, skipped: 0,
      linked: [
        { path: 'Topics/commentary-on-example-2.md', title: 'Commentary on Example 2', modifiedAt: 30, appendable: true, record: 'ready', captures: 1 },
        { path: 'Elsewhere/moved.md', title: 'Moved', modifiedAt: 20, appendable: true, record: 'ready', captures: 1 },
        { path: 'Topics/commentary-on-example.md', title: 'Commentary on Example', modifiedAt: 10, appendable: true, record: 'ready', captures: 1 },
      ],
    })
  })

  it('lists unreadable records as linked but not appendable', async () => {
    const { candidates, read } = vault({
      'Topics/future.md': commentary('./example.md', 'Future', '9'),
      'Topics/broken.md': commentary('./example.md', 'Broken').replace('captures:', 'captures: oops'),
    })
    const discovery = await discoverLinkedCommentaries({ sourcePath: SOURCE, candidates, read })
    expect(discovery.linked.map(note => [note.path, note.record, note.appendable])).toEqual([
      ['Topics/broken.md', 'malformed', false],
      ['Topics/future.md', 'unsupported', false],
    ])
  })

  it('never reads the source itself and reads each note once', async () => {
    const { candidates, read, reads } = vault({ [SOURCE]: commentary('./example.md'), 'Topics/a.md': commentary('./example.md') })
    await discoverLinkedCommentaries({ sourcePath: SOURCE, candidates: [...candidates, ...candidates], read })
    expect(reads).toEqual(['Topics/a.md'])
  })

  it('is incomplete when a read fails or a limit is reached', async () => {
    const failing = vault({ 'Topics/a.md': commentary('./example.md'), 'Topics/b.md': null })
    const missing = { ...failing, candidates: [...failing.candidates, { path: 'Topics/gone.md', modifiedAt: null }] }
    expect(await discoverLinkedCommentaries({ sourcePath: SOURCE, ...missing })).toMatchObject({ complete: false, skipped: 2, linked: [{ path: 'Topics/a.md' }] })

    const many = vault(Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`Topics/n${index}.md`, commentary('./example.md')])))
    const limited = await discoverLinkedCommentaries({ sourcePath: SOURCE, ...many, limits: { notes: 2 } })
    expect(limited).toMatchObject({ complete: false, skipped: 3 })
    expect(limited.linked).toHaveLength(2)
    expect(many.reads).toHaveLength(2)

    const bytes = vault({ 'Topics/a.md': commentary('./example.md'), 'Topics/b.md': commentary('./example.md') })
    expect(await discoverLinkedCommentaries({ sourcePath: SOURCE, ...bytes, limits: { totalBytes: 10 } })).toMatchObject({ complete: false, skipped: 1 })
  })

  it('is incomplete when the host could not list every candidate', async () => {
    const files = vault({ 'Topics/a.md': commentary('./example.md') })
    expect(await discoverLinkedCommentaries({ sourcePath: SOURCE, ...files, candidatesComplete: false })).toMatchObject({
      complete: false, skipped: 0, linked: [{ path: 'Topics/a.md' }],
    })
  })

  it('stops once the visit is no longer current', async () => {
    let current = true
    const files = vault({ 'Topics/a.md': commentary('./example.md'), 'Topics/b.md': commentary('./example.md') })
    const read = async (path: string) => {
      current = false
      return files.read(path)
    }
    expect(await discoverLinkedCommentaries({ sourcePath: SOURCE, candidates: files.candidates, read, isCurrent: () => current })).toMatchObject({
      complete: false, skipped: 1, linked: [{ path: 'Topics/a.md' }],
    })
  })

  it('refuses an invalid source path without reading', async () => {
    const files = vault({ 'Topics/a.md': commentary('./example.md') })
    expect(await discoverLinkedCommentaries({ sourcePath: '../x.md', ...files })).toEqual({ sourcePath: '../x.md', complete: false, linked: [], skipped: 1 })
    expect(files.reads).toEqual([])
  })
})

describe('planning the destination', () => {
  const linked = (path: string, appendable = true): LinkedCommentary => ({
    path, title: path, modifiedAt: null, appendable, record: appendable ? 'ready' : 'malformed', captures: 1,
  })
  const discovery = (notes: LinkedCommentary[], complete = true): CommentaryDiscovery => ({ sourcePath: SOURCE, complete, linked: notes, skipped: complete ? 0 : 1 })

  it('creates when a complete search found nothing, and adds to the only linked note', () => {
    expect(planCommentaryDestination(discovery([]), { separate: false })).toEqual({ kind: 'create', separate: false })
    expect(planCommentaryDestination(discovery([linked('a.md')]), { separate: false })).toEqual({ kind: 'append', target: linked('a.md') })
  })

  it('asks for review whenever the answer is not single and complete', () => {
    expect(planCommentaryDestination(discovery([linked('a.md'), linked('b.md')]), { separate: false })).toEqual({
      kind: 'choose', options: [linked('a.md'), linked('b.md')], blocked: [], incomplete: false,
    })
    expect(planCommentaryDestination(discovery([linked('a.md'), linked('b.md', false)]), { separate: false })).toEqual({
      kind: 'choose', options: [linked('a.md')], blocked: [linked('b.md', false)], incomplete: false,
    })
    expect(planCommentaryDestination(discovery([], false), { separate: false })).toEqual({ kind: 'choose', options: [], blocked: [], incomplete: true })
    expect(planCommentaryDestination(discovery([linked('a.md')], false), { separate: false })).toMatchObject({ kind: 'choose', incomplete: true })
  })

  it('always creates a separate note when asked', () => {
    expect(planCommentaryDestination(discovery([linked('a.md')]), { separate: true })).toEqual({ kind: 'create', separate: true })
  })
})
