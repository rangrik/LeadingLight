import { describe, expect, it } from 'vitest'
import { WEB_CAPTURE_LIMITS } from './webCaptureContract'
import { blocksHtml, canonicalArticle, sanitizeArticle, type ArticleBlock, type ArticleInline } from './articleSanitize'

const PAGE = 'https://pages.example.org/docs/page'

function canonical(html: string) {
  const doc = new DOMParser().parseFromString(`<div id="article">${html}</div>`, 'text/html')
  return canonicalArticle(sanitizeArticle(doc.getElementById('article')!), PAGE)
}

function text(inline: readonly ArticleInline[]): string {
  return inline.map(item => (item.kind === 'text' ? item.text : item.kind === 'break' ? '\n' : text(item.children))).join('')
}

function shape(blocks: readonly ArticleBlock[]): unknown[] {
  return blocks.map((block) => {
    switch (block.kind) {
      case 'list': return [block.ordered ? 'ol' : 'ul', block.items.map(item => [text(item.inline).trim(), shape(item.children)])]
      case 'table': return ['table', block.rows.map(row => row.map(cell => text(cell).trim()))]
      case 'code': return ['code', block.language, block.text]
      case 'divider': return ['hr']
      case 'heading': return [`h${block.level}`, text(block.inline).trim()]
      default: return [block.kind, text(block.inline).trim()]
    }
  })
}

describe('sanitizing', () => {
  it('keeps no attribute the editor parser could read as its own, and only http(s) addresses', () => {
    const doc = new DOMParser().parseFromString(`<div id="a">
      <p data-content-type="htmlBlock" data-text-color="red" style="color:red" class="x" id="y" onclick="z">p</p>
      <a href="javascript:x" title="t">j</a><a href="https://e.org/" target="_blank" rel="opener" ping="https://e.org/p">h</a>
      <pre class="language-js" data-language="html"><code class="language-html">c</code></pre>
      <img src="data:image/png;base64,AA" alt="d"><svg><a href="https://e.org/s">s</a></svg><form><button>b</button></form></div>`, 'text/html')
    const body = sanitizeArticle(doc.getElementById('a')!)
    const attributes = Array.from(body.querySelectorAll('*')).flatMap(element => Array.from(element.attributes, attribute => `${element.tagName}.${attribute.name}=${attribute.value}`))
    expect(attributes).toEqual(['A.title=t', 'A.href=https://e.org/', 'PRE.class=language-js', 'IMG.alt=d'])
    expect(body.querySelector('a:not([href])')?.textContent).toBe('j')
    expect(body.ownerDocument).not.toBe(document)
    expect(body.textContent).not.toContain('b\n')
  })
})

describe('the block model', () => {
  it('reads containers as paragraphs and blocks in order, collapsing HTML whitespace', () => {
    const { blocks } = canonical(`<div>
        First   line
        of text <span>and <b>more</b></span>
      </div><section><p>Para&nbsp;&nbsp;with nbsp</p><div>Second</div></section>`)
    expect(shape(blocks)).toEqual([['paragraph', 'First line of text and more'], ['paragraph', 'Para\u00a0\u00a0with nbsp'], ['paragraph', 'Second']])
  })

  it('turns a quote holding paragraphs, lists and code into quoted lines, with code after them', () => {
    const { blocks } = canonical('<blockquote><p>a</p><blockquote><p>inner</p></blockquote><ol><li>one</li><li>two<ul><li>deep</li></ul></li></ol><pre>code</pre><p>z</p></blockquote>')
    expect(shape(blocks)).toEqual([
      ['quote', 'a'], ['quote', 'inner'], ['quote', '1. one'], ['quote', '2. two'], ['quote', '• deep'], ['code', null, 'code'], ['quote', 'z'],
    ])
  })

  it('nests lists up to the limit and keeps deeper items as paragraphs in the deepest item', () => {
    const depth = WEB_CAPTURE_LIMITS.listDepth + 2
    const html = Array.from({ length: depth }, (_, index) => `<ul><li>level ${index + 1}`).join('') + '</li></ul>'.repeat(depth)
    let level: unknown[] = shape(canonical(html).blocks)
    for (let index = 1; index < WEB_CAPTURE_LIMITS.listDepth; index += 1) {
      const [, items] = level[0] as [string, Array<[string, unknown[]]>]
      expect(items[0][0]).toBe(`level ${index}`)
      level = items[0][1]
    }
    expect(level).toEqual([['ul', [[`level ${WEB_CAPTURE_LIMITS.listDepth}`, [['paragraph', `level ${depth - 1}`], ['paragraph', `level ${depth}`]]]]]])
  })

  it('attaches a list placed directly in a list to the item before it, and keeps stray content as items', () => {
    expect(shape(canonical('<ul><li>a</li><ul><li>b</li></ul>loose text<p>para</p></ul>').blocks)).toEqual([
      ['ul', [['a', [['ul', [['b', []]]]]], ['loose text', []], ['para', []]]],
    ])
  })

  it('keeps simple tables, writes ragged or spanning tables as rows, and walks layout tables in order', () => {
    const { blocks, counts } = canonical(`
      <table><caption>Cap</caption><tr><th>h1</th><th>h2</th></tr><tr><td><p>c1</p></td><td>x <p>c2</p></td></tr></table>
      <table><tr><td colspan="2">wide</td></tr><tr><td>a</td><td>b</td></tr></table>
      <table><tr><td>one</td></tr><tr><td>two</td><td>three</td></tr></table>
      <table><tr><td><p>Left column</p><ul><li>item</li></ul></td><td><h2>Right</h2></td></tr></table>`)
    expect(shape(blocks)).toEqual([
      ['paragraph', 'Cap'], ['table', [['h1', 'h2'], ['c1', 'x  c2']]],
      ['paragraph', 'wide'], ['paragraph', 'a | b'],
      ['paragraph', 'one'], ['paragraph', 'two | three'],
      ['paragraph', 'Left column'], ['ul', [['item', []]]], ['h2', 'Right'],
    ])
    expect(counts.degradedTables).toBe(3)
  })

  it('writes media as text links to http(s) addresses only, never inside another link, and drops player fallbacks', () => {
    // Readability has already made every media address absolute; anything else is gone by now.
    const { blocks, counts } = canonical(`<figure><picture><source srcset="https://e.org/a.webp"><img src="https://e.org/a.png" alt="Alt"></picture><figcaption>Caption</figcaption></figure>
      <p>Icon <img src="data:image/png;base64,AA" alt="dot"> and <img src="https://e.org/x.png"> and <img src="/relative.png" alt="kept text"> and <a href="https://e.org/l"><img src="https://e.org/in-link.png" alt="linked"></a></p>
      <video src="https://e.org/v.mp4"><p>Fallback text</p></video><audio><source src="https://e.org/s.mp3"></audio>`)
    expect(shape(blocks)).toEqual([
      ['paragraph', 'Image: Alt'], ['paragraph', 'Caption'],
      ['paragraph', 'Icon  Image: dot  and  Image  and  Image: kept text  and  Image: linked'],
      ['paragraph', 'Video'], ['paragraph', 'Audio'],
    ])
    expect(blocksHtml(blocks)).toContain('<a href="https://e.org/a.png">Image: Alt</a>')
    expect(blocksHtml(blocks)).toContain('<a href="https://e.org/l"> Image: linked </a>')
    expect(blocksHtml(blocks)).not.toMatch(/<img|src=|srcset|Fallback/u)
    expect(counts.mediaLinks).toBe(4)
    expect(blocksHtml(blocks)).not.toContain('relative.png')
  })

  it('keeps a link around blocks on each of them, and never nests links', () => {
    // The HTML parser never nests links, but DOM changes before sanitizing can.
    const doc = new DOMParser().parseFromString('<div id="article"><a href="https://e.org/card"><h3>Card title</h3><p>Card <span>text</span></p></a></div>', 'text/html')
    const inner = doc.createElement('a')
    inner.setAttribute('href', 'https://e.org/inner')
    doc.querySelector('span')!.append(inner)
    inner.append(doc.createTextNode(' inner'))
    const html = blocksHtml(canonicalArticle(sanitizeArticle(doc.getElementById('article')!), PAGE).blocks)
    expect(html).toBe('<h3><a href="https://e.org/card">Card title</a></h3><p><a href="https://e.org/card">Card text inner</a></p>')
  })

  it('never hands the editor parser a code label that its app blocks would take as their own', () => {
    const { blocks } = canonical(['html', 'HTM', 'xhtml', 'mermaid', 'tldraw', 'plaintext'].map(hint => `<pre class="language-${hint.toLowerCase()}">graph TD; A--&gt;B</pre>`).join('')
      + '<pre>&lt;div&gt;x&lt;/div&gt;</pre><pre>flowchart LR</pre>')
    const html = blocksHtml(blocks)
    expect(html.match(/class="[^"]*"/gu)).toEqual(['class="language-xml"', 'class="language-xml"', 'class="language-xml"', 'class="language-txt"', 'class="language-txt"', 'class="language-txt"', 'class="language-xml"', 'class="language-txt"'])
  })

  it('escapes all text in the parser input and removes invisible control characters', () => {
    const { blocks, counts } = canonical('<p>&lt;script&gt;alert(1)&lt;/script&gt; a\u0007b\u0085c\u000bd "q" &amp;</p><p><q>quoted</q></p>')
    expect(blocksHtml(blocks)).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt; abcd &quot;q&quot; &amp;</p><p>“quoted”</p>')
    expect(counts.removedControlCharacters).toBe(3)
  })
})
