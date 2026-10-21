import { describe, expect, it } from 'vitest'
import {
  legacyWikilinkPattern,
  mayNameTarget,
  rebaseInPlace,
  rebaseOutgoing,
  replaceLegacyWikilinks,
  retargetIncoming,
  retargetLinkedPage,
} from './markdownRelocation'

// Each case mirrors src-tauri/src/leadinglight_relocation_links.rs so the browser bridge and
// draft rebases produce the native bytes.
const outgoing = (content: string) => rebaseOutgoing(content, '/vault', '/vault/drafts/page.md', '/vault/filed/page.md')
const incoming = (content: string) => retargetIncoming(content, '/vault', '/vault/reference.md', '/vault/drafts/page.md', '/vault/filed/page.md')

describe('native parity: exact Markdown destinations', () => {
  it('rebases only destinations', () => {
    const source = '# Keep spacing  \r\n\r\n![Nearby](./image.png "caption")\r\n[Reference](./reference.md)\r\n'
    expect(outgoing(source)).toBe('# Keep spacing  \r\n\r\n![Nearby](../drafts/image.png "caption")\r\n[Reference](../drafts/reference.md)\r\n')
  })

  it('preserves portable images and remote targets', () => {
    const source = '![a](attachments/a.png) ![b](./attachments/b.png) ![c](/attachments/c.png)\n![d](/tmp/d.png) ![e](https://example.invalid/e.png)\n[remote](mailto:a@example.invalid) [anchor](#Here) [query](?view=1) [absolute](/assets/file.pdf)'
    expect(outgoing(source)).toBe(source)
  })

  it('preserves code, front matter and HTML comments', () => {
    const source = "---\nstarting_text: '[Template](./template.md)'\n---\n`[inline](./code.md)`\n\n```md\n![fenced](./code.png)\n```\n\n    [indented](./code.md)\n\n<!-- [comment](./comment.md) -->\n\n[real](./reference.md)\n"
    expect(outgoing(source)).toBe(source.replace('[real](./reference.md)', '[real](../drafts/reference.md)'))
  })

  it('retains angles, escapes, Unicode and suffixes', () => {
    const source = "[One](<./naïve%20name.md?mode=1#Résumé> 'Title')\n[Two](./a\\(b\\).md#x)\n![Three](<./图片%20one.png>)"
    expect(outgoing(source)).toBe("[One](<../drafts/naïve%20name.md?mode=1#Résumé> 'Title')\n[Two](../drafts/a\\(b\\).md#x)\n![Three](<../drafts/图片%20one.png>)")
  })

  it('updates used reference definitions once, with Unicode label folding', () => {
    const source = '[First][Doc] [doc][] [doc]\n![Picture][photo]\n\n[doc]: <./reference.md>\n  "Keep title"\n[photo]: ./image.png \'Caption\'\n[unused]: https://example.invalid/unused.md\n'
    expect(outgoing(source)).toBe('[First][Doc] [doc][] [doc]\n![Picture][photo]\n\n[doc]: <../drafts/reference.md>\n  "Keep title"\n[photo]: ../drafts/image.png \'Caption\'\n[unused]: https://example.invalid/unused.md\n')
    const folded = '[One][STRASSE]\n\n[Straße]: ./reference.md\n'
    expect(outgoing(folded)).toBe(folded.replace('./reference.md', '../drafts/reference.md'))
  })

  it('refuses a shared definition with conflicting meanings and accepts the same meaning', () => {
    for (const source of ['![Image][shared] [Link][shared]\n\n[shared]: attachments/a.png\n', '[Link][shared] ![Image][shared]\n\n[shared]: attachments/a.png\n']) {
      expect(() => outgoing(source)).toThrow(/shared Markdown reference/)
    }
    const same = '![Image][same] [Link][same]\n\n[same]: ./image.png\n'
    expect(outgoing(same)).toBe(same.replace('./image.png', '../drafts/image.png'))
  })

  it('retargets self and incoming exact note paths', () => {
    const source = '[Self](./page.md#title) [Root](/drafts/page.md?x=1) [Other](./other.md)\n[[drafts/page|This page]] [[Page title]]'
    expect(outgoing(source)).toBe('[Self](./page.md#title) [Root](/filed/page.md?x=1) [Other](../drafts/other.md)\n[[filed/page|This page]] [[Page title]]')
    const reference = '[Moving](drafts/page.md#Title) [Root](/drafts/page.md) [Other](drafts/page-two.md) [[drafts/page]]'
    expect(incoming(reference)).toBe('[Moving](./filed/page.md#Title) [Root](/filed/page.md) [Other](drafts/page-two.md) [[drafts/page]]')
  })

  it('retargets encoded note paths without decoding the suffix', () => {
    expect(incoming('[Moving](drafts%2Fpage.md?next=%2Fstay#Part%20one)')).toBe('[Moving](./filed/page.md?next=%2Fstay#Part%20one)')
  })

  it('keeps image-reserved percent encoding', () => {
    expect(outgoing('![x](./image%2Fname%20one.png)')).toBe('![x](../drafts/image%2Fname%20one.png)')
    expect(outgoing('![x](./image.png?size=1#fragment)')).toBe('![x](../drafts/image.png?size=1#fragment)')
  })

  it('keeps wiki image labels and attachment identity', () => {
    const source = '![[ ./image.png | 300 ]] ![[photo.png]] ![[attachments/a.png]] ![[nested/b.png|B]] [[drafts/page|Alias]]'
    expect(outgoing(source)).toBe('![[ ../drafts/image.png | 300 ]] ![[photo.png]] ![[attachments/a.png]] ![[../drafts/nested/b.png|B]] [[filed/page|Alias]]')
  })

  it('does not make a local image portable accidentally', () => {
    expect(rebaseOutgoing('![x](../attachments/image.png)', '/vault', '/vault/nested/drafts/page.md', '/vault/nested/page.md')).toBe('![x](././attachments/image.png)')
  })

  it('encodes new directory characters', () => {
    expect(retargetIncoming('[Move](drafts/page.md)', '/vault', '/vault/reference.md', '/vault/drafts/page.md', '/vault/My #1 (notes)/page.md'))
      .toBe('[Move](./My%20%231%20%28notes%29/page.md)')
  })

  it('refuses ambiguous escaping and entities but keeps remote entities', () => {
    expect(() => outgoing('![x](./a\\(b\\).png)')).toThrow(/escaping/)
    expect(() => outgoing('[x](./a&amp;b.md)')).toThrow(/character entities/)
    expect(outgoing('[remote](https://example.invalid?a=1&amp;b=2)')).toBe('[remote](https://example.invalid?a=1&amp;b=2)')
  })

  it('refuses unclosed front matter and paths outside the vault', () => {
    expect(() => outgoing("---\nstarting_text: '[x](./x.md)'\n")).toThrow(/unclosed YAML/)
    expect(() => rebaseOutgoing('[x](./x.md)', '/vault', '/other/page.md', '/vault/filed/page.md')).toThrow()
  })

  it('keeps every byte for no-op and unrelated pages', () => {
    const content = '[x](./unrelated.md)\n![image](./a.png)\n'
    expect(incoming(content)).toBe(content)
    expect(rebaseOutgoing(content, '/vault', '/vault/page.md', '/vault/page.md')).toBe(content)
  })

  it('refuses unused local definitions and HTML attributes but not code examples', () => {
    for (const source of ['[unused]: ./neighbor.md\n', '[unused]: attachments/photo.png\n']) {
      expect(() => outgoing(source)).toThrow(/unused local Markdown reference/)
      expect(() => incoming(source)).toThrow(/unused local Markdown reference/)
    }
    for (const source of ["<a href='./neighbor.md'>Neighbor</a>", "<img SRC = './photo.png'>", '<video poster="./poster.png"></video>']) {
      expect(() => outgoing(source)).toThrow(/HTML link or image/)
      expect(() => incoming(source)).toThrow(/HTML link or image/)
    }
    const code = "`<img src='./example.png'>`\n\n```html\n<a href='./neighbor.md'>Example</a>\n```\n"
    expect(outgoing(code)).toBe(code)
  })

  it('treats a footnote definition as no link reference', () => {
    const source = 'Words[^1] [Ref](./reference.md)\n\n[^1]: ./note.md\n'
    expect(outgoing(source)).toBe(source.replace('./reference.md', '../drafts/reference.md'))
  })

  it('handles links in tables and images nested in links', () => {
    expect(outgoing('| a |\n|---|\n| [x](./t.md) |\n')).toBe('| a |\n|---|\n| [x](../drafts/t.md) |\n')
    expect(outgoing('[![icon](./icon.png)](./target.md)')).toBe('[![icon](../drafts/icon.png)](../drafts/target.md)')
  })
})

describe('refused pages and legacy wikilinks', () => {
  const target = '/vault/notes/weekly-review.md'

  it('names a target only through filename spellings', () => {
    for (const content of [
      "<a href='weekly-review.md'>Review</a>",
      "<a href='../notes/Weekly-Review.MD'>Review</a>",
      "<a href='weekly%2Dreview.md'>Review</a>",
      "<img src='weekly&#45;review.md'>",
      "<img src='weekly&#x2d;review.md'>",
      "<a href='x'>x</a>\n\n[Review](./weekly\\-review.md)",
      "<a href='weekly&hyphen;review.md'>an unknown named reference is not proof</a>",
    ]) expect(mayNameTarget(content, target), content).toBe(true)
    for (const content of [
      "<a href='https://example.invalid/'>Remote</a>",
      "<img src='attachments/photo.png'> [[Weekly Review]] [[notes/weekly-review]]",
      '---\ntitle: unclosed front matter\nweekly review without its filename',
      "Tom & Jerry, R&D and 5% of weekly-review notes <a href='x'>",
    ]) expect(mayNameTarget(content, target), content).toBe(false)
  })

  it('replaces legacy wikilinks exactly like native', () => {
    const pattern = legacyWikilinkPattern(['Weekly Review', 'note/weekly-review', 'weekly-review'])
    expect(replaceLegacyWikilinks('See [[Weekly Review|my review]], [[weekly-review]] and [[Weekly Reviews]].', pattern, 'note/sprint'))
      .toBe('See [[note/sprint|my review]], [[note/sprint]] and [[Weekly Reviews]].')
  })

  it('keeps an unparseable page’s Markdown, updates its wikilinks and reports possible links', () => {
    const retarget = { vault: '/vault', oldPath: '/vault/Topics/plan.md', newPath: '/vault/Topics/goals.md', oldTargets: ['Plan', 'Topics/plan', 'plan'], newTarget: 'Topics/goals' }
    expect(retargetLinkedPage("<img src='https://example.invalid/a.png'>\n\n[[plan]]\n", '/vault/Notes/a.md', retarget))
      .toEqual({ content: "<img src='https://example.invalid/a.png'>\n\n[[Topics/goals]]\n", unverified: false })
    expect(retargetLinkedPage("<a href='../Topics/plan.md'>Plan</a>\n", '/vault/Notes/b.md', retarget))
      .toEqual({ content: "<a href='../Topics/plan.md'>Plan</a>\n", unverified: true })
    expect(retargetLinkedPage('[Source](../Topics/plan.md)\n', '/vault/Notes/c.md', retarget))
      .toEqual({ content: '[Source](../Topics/goals.md)\n', unverified: false })
  })

  it('rebases a same-folder rename’s self-links only', () => {
    expect(rebaseInPlace('[Top](./draft.md#draft) [Neighbor](./plan.md)\n', '/vault', '/vault/Topics/draft.md', '/vault/Topics/plan-2.md'))
      .toEqual({ content: '[Top](./plan-2.md#draft) [Neighbor](./plan.md)\n', unverified: false })
    expect(rebaseInPlace("# Goals\n\n<a href='./goals.md'>Top</a>\n", '/vault', '/vault/Topics/goals.md', '/vault/Topics/aims.md').unverified).toBe(true)
  })
})
