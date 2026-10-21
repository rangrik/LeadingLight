import { describe, expect, it } from 'vitest'
import type { CapturedPassage, CommentaryPreparation, CommentaryRecord } from './commentaryContract'
import { readCommentaryNote, readCommentaryRecord, serializeCommentaryRecord, sourceBodyOf } from './commentaryFormat'
import { commentaryName, commentaryProposal, prepareCommentaryAppend, prepareCommentaryCreate } from './commentaryPreparation'
import { projectMarkdownBody } from './passageProjection'
import { BASELINE_SHA, captureOf, composedFor, uuid } from './commentary.test-utils'

const SOURCE = '---\ntags: [reading]\n---\n# Example\n\nThe quick fox jumps over the lazy dog.\n\nA second paragraph with **bold** words.\n'

function create(capture: CapturedPassage, answers = {}, overrides: Partial<Parameters<typeof prepareCommentaryCreate>[0]> = {}) {
  return prepareCommentaryCreate({
    capture, document: composedFor(capture, answers, 'create'), commentaryId: uuid(0xc0), folder: 'Topics',
    title: 'Commentary on Example', fileName: 'commentary-on-example.md', ...overrides,
  })
}

function contentOf(prepared: CommentaryPreparation): string {
  if (prepared.status !== 'ready') throw new Error(`refused: ${prepared.reason}`)
  return prepared.write.content
}

function append(content: string, capture: CapturedPassage, answers = {}, path = 'Topics/commentary-on-example.md') {
  return prepareCommentaryAppend({ capture, document: composedFor(capture, answers, 'append'), target: { path, content, contentSha256: BASELINE_SHA } })
}

describe('creating a commentary', () => {
  it('writes title, one Source line, one record and the entry', () => {
    const capture = captureOf(SOURCE, 'quick fox jumps')
    const prepared = create(capture, { thought: 'Speed matters.\nSo does order.', question: 'Why a fox?' })
    expect(prepared).toEqual({
      status: 'ready',
      write: {
        kind: 'create', path: 'Topics/commentary-on-example.md', folder: 'Topics', fileName: 'commentary-on-example.md',
        title: 'Commentary on Example',
        content: [
          '---',
          serializeCommentaryRecord({ version: 1, id: uuid(0xc0), captures: [{ id: capture.id, ...capture.selector }] }),
          '---',
          '# Commentary on Example',
          '',
          '[Source](./example.md)',
          '',
          '> quick fox jumps',
          '',
          'Speed matters.',
          'So does order.',
          '',
          '- Question: Why a fox?',
          '',
        ].join('\n'),
      },
      entry: '> quick fox jumps\n\nSpeed matters.\nSo does order.\n\n- Question: Why a fox?',
    })
  })

  it('saves the passage alone when nothing else is answered', () => {
    expect(create(captureOf(SOURCE, 'lazy dog'))).toMatchObject({ status: 'ready', entry: '> lazy dog' })
  })

  it('links back from any folder', () => {
    const prepared = create(captureOf(SOURCE, 'lazy dog'), {}, { folder: '' })
    expect(contentOf(prepared)).toContain('\n[Source](./Topics/example.md)\n')
    expect(readCommentaryNote('commentary-on-example.md', contentOf(prepared)).source).toMatchObject({ sourcePath: 'Topics/example.md' })
  })

  const refusals: Array<[string, (capture: CapturedPassage) => CommentaryPreparation, string]> = [
    ['a capture id that is not a UUID', capture => create({ ...capture, id: 'one' }), 'invalidCapture'],
    ['an escaping source path', capture => create({ ...capture, sourcePath: '../x.md' }), 'invalidCapture'],
    ['a malformed selector', capture => create({ ...capture, selector: { ...capture.selector, sourceBodySha256: 'x' } }), 'invalidCapture'],
    ['a document for another passage', capture => prepareCommentaryCreate({
      capture, document: composedFor({ ...capture, selector: { ...capture.selector, exact: 'other', start: null, end: null } }, {}, 'create'),
      commentaryId: uuid(1), folder: 'Topics', title: 'T', fileName: 't.md',
    }), 'invalidCapture'],
    ['a blank title', capture => create(capture, {}, { title: '  ' }), 'missingTitle'],
    ['a title with a line break', capture => create(capture, {}, { title: 'a\nb' }), 'unsafeText'],
    ['an unsafe file name', capture => create(capture, {}, { fileName: '../x.md' }), 'invalidCapture'],
    ['a commentary id that is not a UUID', capture => create(capture, {}, { commentaryId: 'x' }), 'invalidCapture'],
    ['the source itself', capture => create(capture, {}, { fileName: 'example.md' }), 'invalidCapture'],
  ]
  it.each(refusals)('refuses %s', (_name, run, reason) => {
    expect(run(captureOf(SOURCE, 'lazy dog'))).toMatchObject({ status: 'refused', reason })
  })

  it('refuses a passage over the quote limit', () => {
    const capture = captureOf(SOURCE, 'lazy dog')
    const exact = 'w'.repeat(64 * 1024 + 1)
    expect(prepareCommentaryCreate({
      capture: { ...capture, selector: { ...capture.selector, exact, start: null, end: null } },
      document: { title: 'T', blocks: [{ type: 'source', passage: 'p', quote: exact }], textBytes: exact.length + 1 },
      commentaryId: uuid(1), folder: 'Topics', title: 'T', fileName: 't.md',
    })).toMatchObject({ status: 'refused', reason: 'invalidCapture' })
  })
})

describe('hostile passages', () => {
  const literal: Array<[string, string]> = [
    ['an HTML fence that would run', '```html scripts=sandboxed\n<script>alert(1)</script>\n```'],
    ['a wikilink', 'See [[Weekly Review|the review]] now'],
    ['a remote image', '![x](https://evil.example/a.png) and <img src=https://evil.example/b.png>'],
    ['frontmatter delimiters', '---\ntitle: injected\n---'],
    ['a second Source line', '[Source](../../secret.md)'],
    ['math, highlight and callout syntax', '$x$ $$y$$ ==hi== > [!note] x'],
    ['a table', '| a | b |\n|---|---|\n| 1 | 2 |'],
    ['escapes and entities', '\\{x\\} \\\\ &amp; &#x40;'],
    ['HTML comments and tags', '<!-- hidden --> <div onclick=x>'],
    ['a heading and list', '# Not a title\n- not a list\n1. nor this'],
    ['Unicode, emoji and bidi controls', 'שלום ‮evil‬ 🧭 漢字'],
  ]
  it.each(literal)('keeps %s literal in the quote and exact in the record', (_name, passage) => {
    const source = `# Example\n\n${'x'}\n`
    const capture = captureOf(source, passage)
    const content = contentOf(create(capture, { thought: passage }))
    const note = readCommentaryNote('Topics/commentary-on-example.md', content)
    expect(note.source).toEqual({ status: 'linked', sourcePath: 'Topics/example.md', destination: './example.md' })
    expect(note.record.status === 'ready' && note.record.record.captures[0].exact).toBe(passage)
    expect(note.title).toBe('Commentary on Example')
    // The visible quote and thought show the passage's characters, line by line, and nothing becomes structure.
    const visible = projectMarkdownBody(sourceBodyOf(content)).text
    const lines = passage.split('\n').map(line => line.trim())
    expect(visible).toBe(['Commentary on Example', 'Source', ...lines, ...lines].join('\n'))
  })

  const refused: Array<[string, string, string]> = [
    ['a durable block placeholder', '@@TOLARIA_HTML_BLOCK:abc@@', 'reservedMarker'],
    ['a wikilink placeholder', '‹WIKILINK:Target›', 'reservedMarker'],
    ['a linked-code placeholder', '‹LINKED_CODE:x›', 'reservedMarker'],
    ['a control character', 'a\u0007b', 'controlCharacter'],
  ]
  it.each(refused)('refuses %s with the input kept', (_name, passage, detail) => {
    const capture = captureOf('# Example\n\nx\n', passage)
    expect(create(capture)).toEqual({ status: 'refused', reason: 'unsafeText', detail })
  })
})

describe('adding to a commentary', () => {
  const first = captureOf(SOURCE, 'quick fox jumps')
  const created = contentOf(create(first, { thought: 'First.' }))

  it('extends the one record and appends one entry, preserving every other byte', () => {
    const edited = created
      .replace('---\n_leadinglight', '---\ntitle: "Mine"\n_leadinglight')
      .replace('First.\n', 'First.\n\nMy later words.   \n\n\n')
    const second = captureOf(SOURCE, 'bold', { id: 2 })
    const prepared = append(edited, second, { question: 'And?' })
    if (prepared.status !== 'ready') throw new Error(prepared.reason)
    expect(prepared.write).toMatchObject({ kind: 'append', path: 'Topics/commentary-on-example.md', expectedSha256: BASELINE_SHA })
    const { state, location } = readCommentaryRecord(edited)
    if (state.status !== 'ready' || !location) throw new Error('fixture')
    const extended: CommentaryRecord = { ...state.record, captures: [...state.record.captures, { id: second.id, ...second.selector }] }
    expect(prepared.write.content).toBe(
      `${edited.slice(0, location.from)}${serializeCommentaryRecord(extended)}${edited.slice(location.to)}> bold\n\n- Question: And?\n`,
    )
    expect(prepared.entry).toBe('> bold\n\n- Question: And?')
    expect(prepared.write.content.match(/\[Source\]/gu)).toHaveLength(1)
    expect(prepared.write.content.match(/^# /gmu)).toHaveLength(1)
  })

  it('adds repeatedly, each time to the latest baseline', () => {
    let content = created
    for (let n = 2; n <= 5; n += 1) content = contentOf(append(content, captureOf(SOURCE, 'lazy dog', { id: n }), { thought: `Visit ${n}` }))
    const note = readCommentaryNote('Topics/commentary-on-example.md', content)
    expect(note.record.status === 'ready' && note.record.record.captures.map(capture => capture.id)).toEqual([1, 2, 3, 4, 5].map(uuid))
    expect(content.endsWith('> lazy dog\n\nVisit 5\n')).toBe(true)
  })

  it('keeps a CRLF note in CRLF', () => {
    const crlf = created.replaceAll('\n', '\r\n')
    const content = contentOf(append(crlf, captureOf(SOURCE, 'lazy dog', { id: 2 }), { thought: 'a\nb' }))
    expect(content.replaceAll('\r\n', '')).not.toContain('\n')
    expect(content.endsWith('First.\r\n\r\n> lazy dog\r\n\r\na\r\nb\r\n')).toBe(true)
  })

  const refusals: Array<[string, (content: string) => CommentaryPreparation, string]> = [
    ['an ordinary note', () => append('# Plain\n\n[Source](./example.md)\n', captureOf(SOURCE, 'bold', { id: 2 })), 'notCommentary'],
    ['another record version', content => append(content.replace('version: 1', 'version: 2'), captureOf(SOURCE, 'bold', { id: 2 })), 'unsupportedRecord'],
    ['a malformed record', content => append(content.replace('version: 1', 'version: 1\n  extra: x'), captureOf(SOURCE, 'bold', { id: 2 })), 'malformedRecord'],
    ['an edited Source line', content => append(content.replace('[Source](./example.md)', 'Source: example'), captureOf(SOURCE, 'bold', { id: 2 })), 'sourceUnreadable'],
    ['another source', content => append(content, captureOf(SOURCE, 'bold', { id: 2, sourcePath: 'Topics/other.md' })), 'otherSource'],
    ['a moved commentary whose link no longer reaches the source', content => append(content, captureOf(SOURCE, 'bold', { id: 2 }), {}, 'Elsewhere/c.md'), 'otherSource'],
    ['an unclosed fence at the end', content => append(`${content}\n\`\`\`\nunfinished\n`, captureOf(SOURCE, 'bold', { id: 2 })), 'unsafeTail'],
    ['an unclosed HTML comment at the end', content => append(`${content}\n<!-- draft\n`, captureOf(SOURCE, 'bold', { id: 2 })), 'unsafeTail'],
    ['the same capture twice', content => append(content, first), 'duplicateCapture'],
    ['a digest that is not SHA-256', content => prepareCommentaryAppend({
      capture: captureOf(SOURCE, 'bold', { id: 2 }), document: composedFor(captureOf(SOURCE, 'bold', { id: 2 }), {}, 'append'),
      target: { path: 'Topics/commentary-on-example.md', content, contentSha256: 'x' },
    }), 'invalidCapture'],
  ]
  it.each(refusals)('refuses %s', (_name, run, reason) => {
    expect(run(created)).toMatchObject({ status: 'refused', reason })
  })

  it('refuses past the capture limit and the page size limit', () => {
    const full: CommentaryRecord = {
      version: 1, id: uuid(0xc0),
      captures: Array.from({ length: 256 }, (_, index) => ({ id: uuid(index + 10), ...first.selector })),
    }
    const crowded = `---\n${serializeCommentaryRecord(full)}\n---\n# C\n\n[Source](./example.md)\n`
    expect(append(crowded, captureOf(SOURCE, 'bold', { id: 2 }))).toMatchObject({ status: 'refused', reason: 'tooManyCaptures' })
    const large = `${created}\n${'Long words. '.repeat(90_000)}\n`
    expect(append(large, captureOf(SOURCE, 'bold', { id: 2 }))).toMatchObject({ status: 'refused', reason: 'tooLarge' })
  })

  it('never names the source page as a write', () => {
    const prepared = append(created, captureOf(SOURCE, 'bold', { id: 2 }))
    expect(prepared.status === 'ready' && prepared.write.path).toBe('Topics/commentary-on-example.md')
  })
})

describe('commentary names', () => {
  const taken = (...names: string[]) => (name: string) => names.includes(name)

  it('uses the recipe title for the default note, never a taken name', () => {
    expect(commentaryName('Commentary on Example', taken(), false)).toEqual({ title: 'Commentary on Example', fileName: 'commentary-on-example.md' })
    expect(commentaryName('Commentary on Example', taken('commentary-on-example.md'), false)).toBeNull()
  })

  it('numbers a separate note from 2, skipping taken names', () => {
    expect(commentaryName('Commentary on Example', taken('commentary-on-example.md'), true)).toEqual({ title: 'Commentary on Example 2', fileName: 'commentary-on-example-2.md' })
    expect(commentaryName('Commentary on Example', taken('commentary-on-example-2.md', 'commentary-on-example-3.md'), true)).toMatchObject({ title: 'Commentary on Example 4' })
    expect(commentaryName('  ', taken(), true)).toBeNull()
  })
})

describe('guarded proposals', () => {
  const ids = { operationId: uuid(0x0b), runId: 'run-1', handle: 'handle-1', contentSha256: 'e'.repeat(64) }

  it('map a create onto the existing create proposal', () => {
    const prepared = create(captureOf(SOURCE, 'lazy dog'))
    if (prepared.status !== 'ready') throw new Error(prepared.reason)
    expect(commentaryProposal(prepared.write, ids)).toEqual({
      kind: 'create', operationId: uuid(0x0b), runId: 'run-1', folderHandle: 'handle-1', fileName: 'commentary-on-example.md',
      content: prepared.write.content, contentSha256: 'e'.repeat(64),
    })
  })

  it('map an append onto the existing append proposal with the reviewed baseline digest', () => {
    const created = contentOf(create(captureOf(SOURCE, 'lazy dog')))
    const prepared = append(created, captureOf(SOURCE, 'bold', { id: 2 }))
    if (prepared.status !== 'ready') throw new Error(prepared.reason)
    expect(commentaryProposal(prepared.write, ids)).toMatchObject({ kind: 'append', documentHandle: 'handle-1', expectedSha256: BASELINE_SHA })
    expect(commentaryProposal(prepared.write, { ...ids, contentSha256: BASELINE_SHA })).toBeNull()
    expect(commentaryProposal(prepared.write, { ...ids, handle: 'not a token' })).toBeNull()
  })
})
