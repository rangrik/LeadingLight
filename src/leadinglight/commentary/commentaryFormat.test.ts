import { describe, expect, it } from 'vitest'
import formatGuide from '../../../docs/leadinglight/commentary-format.md?raw'
import { splitFrontmatter } from '../../utils/wikilinks'
import type { CommentaryRecord } from './commentaryContract'
import {
  canAppendAfter, composeAppendedCommentary, decodeRecordText, encodeRecordText, readCommentaryNote, readCommentaryRecord,
  resolveSourceDestination, serializeCommentaryRecord, sourceBodyOf, sourceLinkDestination,
} from './commentaryFormat'
import { SOURCE_SHA, uuid } from './commentary.test-utils'

const record = (captures = 1, exact = 'The [[Weekly Review]] passage'): CommentaryRecord => ({
  version: 1,
  id: uuid(0xabcdef),
  captures: Array.from({ length: captures }, (_, index) => ({
    id: uuid(index + 1),
    projection: 'leadinglight-text-v1' as const,
    exact,
    prefix: index === 0 ? '' : 'before ',
    suffix: ' after|[[x]]',
    sourceBodySha256: SOURCE_SHA,
    start: index === 0 ? null : 10,
    end: index === 0 ? null : 10 + exact.length,
  })),
})

const note = (frontmatterLines: string, body = '# Commentary on Example\n\n[Source](./example.md)\n\n> quote\n') =>
  `---\n${frontmatterLines}\n---\n${body}`

/** The native legacy rename rewrite (`build_wikilink_pattern` + `replace_wikilinks_in_content`), applied to a whole file. */
function legacyWikilinkRename(content: string, targets: string[], replacement: string): string {
  const escaped = targets.map(target => target.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
  const pattern = new RegExp(`\\[\\[(?:${escaped.join('|')})(\\|[^\\]]*?)?\\]\\]`, 'gu')
  return content.replace(pattern, (_match, pipe: string | undefined) => `[[${replacement}${pipe ?? ''}]]`)
}

describe('record text encoding', () => {
  it('round-trips any well-formed text through canonical base64', () => {
    for (const text of ['', 'plain', '[[Weekly Review]] | # : - ', '\uFEFFbom', 'emoji 🧭 and CJK 漢字', 'line\r\nbreaks\n\ttab', '@@TOLARIA_X@@ ‹WIKILINK:a›']) {
      const encoded = encodeRecordText(text)
      expect(encoded).toMatch(/^[A-Za-z0-9+/]*={0,2}$/u)
      expect(decodeRecordText(encoded)).toBe(text)
    }
  })

  it('refuses non-canonical, padded-wrong, whitespace and invalid UTF-8 values', () => {
    expect(decodeRecordText('YQ')).toBeNull()
    expect(decodeRecordText('YR==')).toBeNull()
    expect(decodeRecordText('YQ==\n')).toBeNull()
    expect(decodeRecordText('Y Q==')).toBeNull()
    expect(decodeRecordText('/w==')).toBeNull()
    expect(decodeRecordText(42)).toBeNull()
  })
})

describe('record', () => {
  it('round-trips through its canonical serialization', () => {
    for (const value of [record(1), record(3)]) {
      const content = note(serializeCommentaryRecord(value))
      expect(readCommentaryRecord(content).state).toEqual({ status: 'ready', record: value })
    }
  })

  it('is immune to the legacy global wikilink rename, while the visible body still follows it', () => {
    const content = note(`title: Notes\n${serializeCommentaryRecord(record(2))}`, '# C\n\n[Source](./example.md)\n\nSee [[Weekly Review]].\n')
    const renamed = legacyWikilinkRename(content, ['Weekly Review', 'x'], 'note/weekly')
    expect(splitFrontmatter(renamed)[0]).toBe(splitFrontmatter(content)[0])
    expect(renamed).toContain('See [[note/weekly]].')
    expect(readCommentaryRecord(renamed).state).toEqual({ status: 'ready', record: record(2) })
  })

  it('reads a record among user keys, after quoting changes and with CRLF endings', () => {
    const lines = serializeCommentaryRecord(record(2)).replace('version: 1', 'version: "1"').replace(/exact: "([^"]*)"/u, "exact: '$1'")
    const content = note(`title: "Notes: a"\ntags:\n  - a\n${lines}\nrating: 5`)
    expect(readCommentaryRecord(content).state.status).toBe('ready')
    expect(readCommentaryRecord(content.replaceAll('\n', '\r\n')).state.status).toBe('ready')
  })

  it('stays readable when other frontmatter is not valid YAML', () => {
    expect(readCommentaryRecord(note(`title: Commentary: on: x\n${serializeCommentaryRecord(record())}`)).state.status).toBe('ready')
  })

  it('reports other versions as unsupported and leaves no record as none', () => {
    const lines = serializeCommentaryRecord(record()).replace('version: 1', 'version: 2')
    expect(readCommentaryRecord(note(lines)).state).toEqual({ status: 'unsupported', version: '2' })
    expect(readCommentaryRecord(note('title: x')).state).toEqual({ status: 'none' })
    expect(readCommentaryRecord('# no frontmatter\n').state).toEqual({ status: 'none' })
  })

  const malformed: Array<[string, (lines: string) => string]> = [
    ['an unknown key', lines => lines.replace('  version: 1', '  version: 1\n  extra: x')],
    ['an unknown capture key', lines => lines.replace('      projection:', '      sourcePath: a.md\n      projection:')],
    ['a missing id', lines => lines.replace(/ {2}id: .*\n/u, '')],
    ['an uppercase id', lines => lines.replace(uuid(0xabcdef), uuid(0xabcdef).toUpperCase())],
    ['an unknown projection', lines => lines.replace('leadinglight-text-v1', 'leadinglight-text-v9')],
    ['invalid base64', lines => lines.replace(/exact: "[^"]*"/u, 'exact: "not base64!"')],
    ['only one offset', lines => lines.replace(/ {6}end: .*\n/u, '')],
    ['a hint that disagrees with the text', lines => lines.replace(/end: (\d+)/u, 'end: 99999')],
    ['a negative offset', lines => lines.replace('start: 10', 'start: -1')],
    ['a short digest', lines => lines.replace(/sourceBodySha256: a+/u, 'sourceBodySha256: abc')],
    ['an alias', lines => `${lines.replace(uuid(0xabcdef), `&anchor ${uuid(0xabcdef)}`)}`],
    ['an explicit tag', lines => lines.replace('version: 1', 'version: !!str 1')],
    ['a flow value', () => '_leadinglight_commentary: {version: 1}'],
    ['a quoted key', lines => lines.replace('_leadinglight_commentary:', '"_leadinglight_commentary":')],
    ['a duplicate key', lines => `${lines}\n${lines}`],
    ['a colliding key', lines => `${lines}\n_LeadingLight Commentary: x`],
    ['a duplicate capture id', lines => lines.replace(uuid(2), uuid(1))],
    ['no captures', lines => lines.replace(/ {2}captures:[\s\S]*/u, '  captures: []')],
    ['a tab-indented line', lines => lines.replace('  version: 1', '\tversion: 1')],
  ]
  it.each(malformed)('is malformed with %s', (_name, edit) => {
    expect(readCommentaryRecord(note(edit(serializeCommentaryRecord(record(2))))).state).toEqual({ status: 'malformed' })
  })
})

describe('source line', () => {
  const read = (body: string, path = 'Notes/commentary.md') => readCommentaryNote(path, note(serializeCommentaryRecord(record()), body))

  it('is the first block after an optional H1', () => {
    expect(read('# Commentary on Example\n\n[Source](../Topics/example.md)\n\n> q\n')).toMatchObject({
      title: 'Commentary on Example',
      source: { status: 'linked', sourcePath: 'Topics/example.md', destination: '../Topics/example.md' },
    })
    expect(read('[Source](./example.md)\n').source).toEqual({ status: 'linked', sourcePath: 'Notes/example.md', destination: './example.md' })
    expect(read('Commentary\n===\n\n[Source](<./my page.md>)\n')).toMatchObject({ title: 'Commentary', source: { sourcePath: 'Notes/my page.md' } })
  })

  const cases: Array<[string, string, unknown]> = [
    ['missing', '# T\n\nJust words.\n', { status: 'missing' }],
    ['missing after another block', '# T\n\n> [Source](./a.md)\n', { status: 'missing' }],
    ['missing after an H2', '## T\n\n[Source](./a.md)\n', { status: 'missing' }],
    ['multiple links', '# T\n\n[Source](./a.md) [Source](./b.md)\n', { status: 'unreadable', reason: 'multiple' }],
    ['surrounding text', '# T\n\nFrom [Source](./a.md)\n', { status: 'unreadable', reason: 'malformed' }],
    ['another label', '# T\n\n[source](./a.md)\n', { status: 'unreadable', reason: 'malformed' }],
    ['a title', '# T\n\n[Source](./a.md "t")\n', { status: 'unreadable', reason: 'malformed' }],
    ['a reference link', '# T\n\n[Source][s]\n\n[s]: ./a.md\n', { status: 'unreadable', reason: 'malformed' }],
    ['an emphasized link', '# T\n\n*[Source](./a.md)*\n', { status: 'unreadable', reason: 'malformed' }],
    ['an external URL', '# T\n\n[Source](https://example.com/a.md)\n', { status: 'unreadable', reason: 'external' }],
    ['a protocol-relative URL', '# T\n\n[Source](//host/a.md)\n', { status: 'unreadable', reason: 'external' }],
    ['an escaping path', '# T\n\n[Source](../../a.md)\n', { status: 'unreadable', reason: 'outsideVault' }],
    ['a non-note', '# T\n\n[Source](./image.png)\n', { status: 'unreadable', reason: 'notNote' }],
    ['a fragment', '# T\n\n[Source](./a.md#part)\n', { status: 'unreadable', reason: 'malformed' }],
    ['a backslash escape', '# T\n\n[Source](./a\\_b.md)\n', { status: 'unreadable', reason: 'malformed' }],
    ['an entity', '# T\n\n[Source](./a&amp;b.md)\n', { status: 'unreadable', reason: 'malformed' }],
    ['inside a code block', '# T\n\n```\n[Source](./a.md)\n```\n', { status: 'missing' }],
  ]
  it.each(cases)('is %s', (_name, body, expected) => {
    expect(read(body).source).toEqual(expected)
  })

  it('reads a CRLF note', () => {
    const content = note(serializeCommentaryRecord(record()), '# T\n\n[Source](./a.md)\n').replaceAll('\n', '\r\n')
    expect(readCommentaryNote('n.md', content)).toMatchObject({ title: 'T', record: { status: 'ready' }, source: { sourcePath: 'a.md' } })
  })
})

describe('source destinations', () => {
  it('resolves relative, vault-rooted and percent-encoded paths from the commentary folder', () => {
    const resolve = (destination: string, from = 'A/B/c.md') => resolveSourceDestination(from, destination)
    expect(resolve('./x.md')).toMatchObject({ sourcePath: 'A/B/x.md' })
    expect(resolve('x.md')).toMatchObject({ sourcePath: 'A/B/x.md' })
    expect(resolve('../../x.md')).toMatchObject({ sourcePath: 'x.md' })
    expect(resolve('../C/./d/../x.md')).toMatchObject({ sourcePath: 'A/C/x.md' })
    expect(resolve('/Top/x.md')).toMatchObject({ sourcePath: 'Top/x.md' })
    expect(resolve('./my%20page%23%5B1%5D.md')).toMatchObject({ sourcePath: 'A/B/my page#[1].md' })
    expect(resolve('./%C3%A9t%C3%A9.md')).toMatchObject({ sourcePath: 'A/B/été.md' })
    expect(resolve('./100%.md')).toMatchObject({ sourcePath: 'A/B/100%.md' })
    expect(resolve('./a%2Fb.md')).toMatchObject({ sourcePath: 'A/B/a/b.md' })
    expect(resolve('./X.MD')).toMatchObject({ sourcePath: 'A/B/X.MD' })
    expect(resolve('../../../x.md')).toEqual({ status: 'unreadable', reason: 'outsideVault' })
    expect(resolve('./a%00.md')).toEqual({ status: 'unreadable', reason: 'malformed' })
    expect(resolve('C:/x.md')).toEqual({ status: 'unreadable', reason: 'external' })
    expect(resolve('./')).toEqual({ status: 'unreadable', reason: 'notNote' })
  })

  it('writes the relative spelling native relocation writes, and reads it back exactly', () => {
    const pairs: Array<[string, string, string]> = [
      ['Topics/c.md', 'Topics/example.md', './example.md'],
      ['c.md', 'Topics/example.md', './Topics/example.md'],
      ['Notes/Deep/c.md', 'Topics/example.md', '../../Topics/example.md'],
      ['Topics/c.md', 'Topics/My Page (draft) #1 & [x].md', './My%20Page%20%28draft%29%20%231%20%26%20%5Bx%5D.md'],
      ['Topics/c.md', 'Topics/été 漢字 🧭.md', './été%20漢字%20🧭.md'],
      ['Topics/c.md', 'Topics/a$b=c~d{e}.md', './a%24b%3Dc%7Ed%7Be%7D.md'],
      ['Topics/c.md', 'Topics/zero\u200Bwidth\u00A0space.md', './zero%E2%80%8Bwidth%C2%A0space.md'],
    ]
    for (const [commentary, source, expected] of pairs) {
      const destination = sourceLinkDestination(commentary, source)
      expect(destination).toBe(expected)
      expect(resolveSourceDestination(commentary, destination ?? '')).toEqual({ status: 'linked', sourcePath: source, destination })
    }
    expect(sourceLinkDestination('../c.md', 'a.md')).toBeNull()
    expect(sourceLinkDestination('c.md', 'a.txt')).toBeNull()
  })
})

describe('appending after a note', () => {
  const tails: Array<[string, string, boolean]> = [
    ['an ordinary paragraph', 'Words.', true],
    ['no final line break', 'Words', true],
    ['trailing blank lines', 'Words.\n\n\n', true],
    ['a closed fence', '```\ncode\n```\n', true],
    ['a list', '- a\n- b\n', true],
    ['a quote', '> a\n', true],
    ['a table', '| a |\n|---|\n| 1 |\n', true],
    ['an HTML block that ends at a blank line', '<div>\nx\n</div>\n', true],
    ['an unclosed backtick fence', '```js\nlet a\n', false],
    ['an unclosed tilde fence', '~~~\ntext\n', false],
    ['an unclosed fence inside a list', '- item\n\n  ```\n  code\n', true],
    ['an unclosed HTML comment', '<!--\nnote\n', false],
    ['an unclosed script block', '<script>\nlet a\n', false],
    ['an unclosed pre block', '<pre>\ntext\n', false],
  ]
  it.each(tails)('after %s: %s', (_name, tail, expected) => {
    expect(canAppendAfter(`# T\n\n[Source](./a.md)\n\n${tail}`)).toBe(expected)
  })

  it('changes only the record lines and the end of the body', () => {
    const userFrontmatter = 'title: "Mine"   \n# a comment\ntags: [a, b]\n'
    const body = '# Commentary on Example\n\n[Source](./example.md)\n\n> quote\n\nMy later words.  \n'
    const content = `---\n${userFrontmatter}${serializeCommentaryRecord(record())}\nafter: kept # trailing\n---\n${body}`
    const { state, location } = readCommentaryRecord(content)
    if (state.status !== 'ready' || !location) throw new Error('fixture')
    const extended: CommentaryRecord = { ...state.record, captures: [...state.record.captures, { ...record(2).captures[1] }] }
    const result = composeAppendedCommentary(content, location, extended, '> new')
    expect(result).toBe(`${content.slice(0, location.from)}${serializeCommentaryRecord(extended)}\n${content.slice(location.to)}\n> new\n`)
    expect(readCommentaryRecord(result ?? '').state).toEqual({ status: 'ready', record: extended })
  })

  it('keeps CRLF line endings for the record and the entry', () => {
    const content = note(serializeCommentaryRecord(record()), '# T\n\n[Source](./a.md)\n\n> q').replaceAll('\n', '\r\n')
    const { state, location } = readCommentaryRecord(content)
    if (state.status !== 'ready' || !location) throw new Error('fixture')
    const result = composeAppendedCommentary(content, location, { ...state.record, captures: [...state.record.captures, record(2).captures[1]] }, '> a\n>\n> b') ?? ''
    expect(result.replaceAll('\r\n', '')).not.toContain('\n')
    expect(result.endsWith('> q\r\n\r\n> a\r\n>\r\n> b\r\n')).toBe(true)
    expect(sourceBodyOf(result).startsWith('# T\r\n')).toBe(true)
  })
})

describe('the public format guide', () => {
  it('shows a ready commentary linked to its source', () => {
    const example = /```markdown\n([\s\S]*?)```/u.exec(formatGuide)?.[1] ?? ''
    const note = readCommentaryNote('Notes/commentary-on-example.md', example)
    expect(note).toMatchObject({ title: 'Commentary on Example', source: { status: 'linked', sourcePath: 'Topics/example.md' }, record: { status: 'ready' } })
    expect(note.record.status === 'ready' && note.record.record.captures[0]).toMatchObject({ exact: 'The [[Weekly Review]] passage', start: 120, end: 149 })
  })
})
