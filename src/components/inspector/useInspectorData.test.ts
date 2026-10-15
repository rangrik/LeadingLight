import { describe, expect, it } from 'vitest'
import type { VaultEntry } from '../../types'
import { makeEntry } from '../../test-utils/noteListTestUtils'
import { resolveEntry } from '../../utils/wikilink'
import { getInspectorLinkSummary } from './useInspectorData'

const page = (path: string, overrides: Parameters<typeof makeEntry>[0] = {}) => makeEntry({
  path: `/vault/${path}.md`,
  filename: `${path.split('/').pop()}.md`,
  title: path.split('/').pop(),
  ...overrides,
})

const sourcePaths = (items: { entry: { path: string } }[]) => items.map((item) => item.entry.path)

describe('getInspectorLinkSummary', () => {
  it('gives backlinks only to the page a link actually opens', () => {
    const aTopic = page('a/topic', { title: 'Topic Page', aliases: ['Subject'] })
    const bTopic = page('b/topic', { title: 'Topic Page' })
    const qualified = page('notes/qualified', { outgoingLinks: ['a/topic'] })
    const titleCase = page('notes/title-case', { outgoingLinks: ['topic page'] })
    const alias = page('notes/alias', { outgoingLinks: ['subject'] })
    const heading = page('notes/heading', { outgoingLinks: ['b/topic#Intro'] })
    const self = page('notes/self', { outgoingLinks: ['self'] })
    const entries = [aTopic, bTopic, qualified, titleCase, alias, heading, self]

    expect(sourcePaths(getInspectorLinkSummary(bTopic, entries).backlinks)).toEqual([])
    expect(sourcePaths(getInspectorLinkSummary(aTopic, entries).backlinks)).toEqual([
      qualified.path, titleCase.path, alias.path,
    ])
    expect(getInspectorLinkSummary(self, entries).backlinks).toEqual([])
    // Heading links do not open a page today; update together with editor heading navigation.
    expect(resolveEntry(entries, 'b/topic#Intro', heading)).toBeUndefined()
  })

  it('finds every source the shared resolver would open, for many link spellings', () => {
    const team = { alias: 'team', path: '/team' } as VaultEntry['workspace']
    const targets = [
      page('docs/adr/0031-foo', { title: 'ADR Foo' }),
      page('people/alice-smith', { title: 'Alice Smith', aliases: ['Ally'] }),
      page('archive/alice-smith', { title: 'Old Alice' }),
      makeEntry({ path: '/vault/files/report.pdf', filename: 'report.pdf', title: 'report.pdf' }),
      makeEntry({ path: '/team/projects/alpha.md', filename: 'alpha.md', title: 'Alpha', workspace: team }),
      makeEntry({ path: '/vault/caps/TOPIC.MD', filename: 'TOPIC.MD', title: 'TOPIC.MD' }),
    ]
    const links = [
      'docs/adr/0031-foo', 'adr/0031-foo.md', 'ADR FOO', 'alice-smith', 'alice smith', 'ALLY', 'Old Alice|label',
      'old-alice', 'archive/alice-smith', '/people/alice-smith', 'files/report.pdf', 'report.pdf',
      'team/projects/alpha', 'alpha', 'alice-smith#Intro', 'caps/topic',
    ]
    const sources = links.map((link, index) => page(`src/${index}`, { title: `Source ${index}`, outgoingLinks: [link] }))
    const entries = [...targets, ...sources]

    for (const target of targets) {
      const expected = sources
        .filter((source) => resolveEntry(entries, source.outgoingLinks[0], source)?.path === target.path)
        .map((source) => source.path)
      expect(expected.length).toBeGreaterThan(0)
      expect(sourcePaths(getInspectorLinkSummary(target, entries).backlinks)).toEqual(expected)
    }
  })

  it('lists a page once, under properties, when it links by property and body', () => {
    const target = page('work/grow-newsletter', { title: 'Grow Newsletter', aliases: ['Newsletter'] })
    const both = page('essay/on-writing', {
      relationships: { 'Belongs to': ['[[work/grow-newsletter]]', '[[Newsletter]]'], Type: ['[[grow-newsletter]]'] },
      outgoingLinks: ['grow-newsletter'],
    })
    const typeOnly = page('type/responsibility', { relationships: { Type: ['[[grow-newsletter]]'] } })

    const summary = getInspectorLinkSummary(target, [target, both, typeOnly])

    expect(summary.referencedBy).toEqual([{ entry: both, viaKey: 'Belongs to' }])
    expect(summary.backlinks).toEqual([])
  })

  it('reuses one result per entries array so panes share the work', () => {
    const target = page('target')
    const entries = [target, page('source', { outgoingLinks: ['target'] })]

    expect(getInspectorLinkSummary(target, entries)).toBe(getInspectorLinkSummary({ ...target }, entries))
    expect(getInspectorLinkSummary(target, [...entries])).not.toBe(getInspectorLinkSummary(target, entries))
  })
})
