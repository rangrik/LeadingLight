import { describe, expect, it } from 'vitest'
import titleSourceContract from '../shared/titleSourceContract.json'
import { NAMED_CHARACTER_REFERENCES, titleTextFromMarkdown } from './noteTitleInline'

const NAMED_REFERENCE_FIXTURE = 'literal: every supported named character reference'
const REPEATS = 40_000
const growingBacktickRuns = Array.from({ length: 600 }, (_, index) => '`'.repeat(index + 1)).join('a')

describe('titleTextFromMarkdown', () => {
  // Native parsing keeps its own table; both are pinned to this one shared fixture.
  it('supports exactly the named references in the shared fixture', () => {
    const fixture = titleSourceContract.fixtures.find(item => item.name === NAMED_REFERENCE_FIXTURE)
    const names = [...(fixture?.content ?? '').matchAll(/&([A-Za-z]+);/g)].map(match => match[1])
    expect(names.sort()).toEqual([...NAMED_CHARACTER_REFERENCES.keys()].sort())
  })

  it('removes one padding space from each side of a code span', () => {
    expect(titleTextFromMarkdown('` a `|`  b  `|` `')).toBe('a| b | ')
  })

  it('leaves surrounding whitespace for the caller to trim', () => {
    expect(titleTextFromMarkdown('  \\*a\\*  ')).toBe('  *a*  ')
  })

  it.each([
    ['a raw pipe after a decoded one names the alias', '[[a&#124;b|c]]', 'c'],
    ['a decoded pipe after a raw one stays alias text', '[[a|b&#124;c]]', 'b|c'],
    ['an escaped pipe after a code-span pipe names the alias', '[[a`|`b\\|c]]', 'c'],
    ['a decoded pipe alone with an empty side stays text', '[[&#124;b]]', '|b'],
  ])('splits a wikilink alias only at a raw or escaped pipe: %s', (_name, markdown, expected) => {
    expect(titleTextFromMarkdown(markdown)).toBe(expected)
  })

  it.each([
    ['URL whose trailing underscore was escaped', 'https://example.com/a_b\\_', 'https://example.com/a_b_'],
    ['URL inside parentheses', '(https://example.com/_x\\_)', '(https://example.com/_x_)'],
    ['uppercase scheme', 'HTTPS://EXAMPLE.COM/_X_/', 'HTTPS://EXAMPLE.COM/_X_/'],
    ['email after a word boundary', 'mail:_a_b@example.com', 'mail:_a_b@example.com'],
    ['at sign without a later dot is not an email', '_a@b_', 'a@b'],
    ['www without a boundary is not an address', 'awww.x/_y_', 'awww.x/y'],
  ])('keeps automatic-link underscores literal: %s', (_name, markdown, expected) => {
    expect(titleTextFromMarkdown(markdown)).toBe(expected)
  })

  it.each([
    ['unclosed brackets', '['.repeat(REPEATS * 5), '['.repeat(REPEATS * 5)],
    ['wikilink openers with one late close', `${'[['.repeat(REPEATS)}]]`, '[['.repeat(REPEATS - 1)],
    ['link openers without destinations', '[a]('.repeat(REPEATS), '[a]('.repeat(REPEATS)],
    ['unmatched backtick runs of growing length', growingBacktickRuns, growingBacktickRuns],
    ['ampersands before a long name', `${'&'.repeat(REPEATS)}${'a'.repeat(REPEATS)};`, `${'&'.repeat(REPEATS)}${'a'.repeat(REPEATS)};`],
    ['padded strikethrough pairs', '~~ '.repeat(REPEATS), '~~ '.repeat(REPEATS)],
    ['one underscore run', '_'.repeat(REPEATS * 5), ''],
    ['encoded brackets', '\\[x\\] '.repeat(REPEATS), '[x] '.repeat(REPEATS)],
    ['one long URL word', `https://example.com/${'_a'.repeat(REPEATS)}`, `https://example.com/${'_a'.repeat(REPEATS)}`],
    ['one long email local part', `${'_'.repeat(REPEATS)}@example.com`, `${'_'.repeat(REPEATS)}@example.com`],
    ['repeated address prefixes without a link', 'wwwhttp:@'.repeat(REPEATS), 'wwwhttp:@'.repeat(REPEATS)],
  ])('stays linear on long input: %s', (_name, markdown, expected) => {
    expect(titleTextFromMarkdown(markdown)).toBe(expected)
  })
})
