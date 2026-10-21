import { afterEach, describe, expect, it, vi } from 'vitest'
import { convert, fixture, flat, inlineOf, marksOf, open, textOf } from './webCapture.test-utils'

/**
 * A hostile page converted under observation of the app's own document and every network API this
 * environment has. jsdom never loads subresources itself, so this proves only that the conversion
 * code asks for nothing and writes nothing into the live document; that a real webview's inert
 * documents load nothing needs the browser check recorded in docs/leadinglight/web-capture-conversion.md.
 */

const URL_ATTRIBUTES = new Set(['src', 'srcset', 'href', 'poster', 'data', 'action', 'formaction', 'background', 'ping', 'style'])

afterEach(() => {
  vi.restoreAllMocks()
})

function observeLiveDocument() {
  const mutations: MutationRecord[] = []
  const observer = new MutationObserver(records => mutations.push(...records))
  observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
  const created: Element[] = []
  const createElement = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string, options?: ElementCreationOptions) => {
    const element = createElement(tag, options)
    created.push(element)
    return element
  }) as typeof document.createElement)
  const liveAttributes: string[] = []
  const setAttribute = Element.prototype.setAttribute
  vi.spyOn(Element.prototype, 'setAttribute').mockImplementation(function (this: Element, name: string, value: string) {
    if (this.ownerDocument === document && (URL_ATTRIBUTES.has(name.toLowerCase()) || name.toLowerCase().startsWith('on'))) liveAttributes.push(name)
    return setAttribute.call(this, name, value)
  })
  return {
    created,
    liveAttributes,
    mutations: () => {
      mutations.push(...observer.takeRecords())
      observer.disconnect()
      return mutations
    },
  }
}

function spyNetwork() {
  const ImageBefore = window.Image
  let images = 0
  window.Image = class extends ImageBefore {
    constructor(width?: number, height?: number) {
      super(width, height)
      images += 1
    }
  } as typeof Image
  const calls = {
    fetch: vi.mocked(globalThis.fetch),
    xhr: vi.spyOn(XMLHttpRequest.prototype, 'open'),
    worker: vi.fn(),
    images: () => images,
  }
  const WorkerBefore = globalThis.Worker
  globalThis.Worker = calls.worker as unknown as typeof Worker
  return {
    calls,
    restore: () => {
      window.Image = ImageBefore
      globalThis.Worker = WorkerBefore
    },
  }
}

describe('a hostile page', () => {
  it('is converted without any request and without touching the app document', async () => {
    const before = document.documentElement.outerHTML
    const live = observeLiveDocument()
    const network = spyNetwork()
    let content = ''
    try {
      content = (await convert(fixture('hostile'))).note.content
    } finally {
      network.restore()
    }
    expect(network.calls.fetch).not.toHaveBeenCalled()
    expect(network.calls.xhr).not.toHaveBeenCalled()
    expect(network.calls.worker).not.toHaveBeenCalled()
    expect(network.calls.images()).toBe(0)
    expect(live.mutations()).toEqual([])
    expect(document.documentElement.outerHTML).toBe(before)
    expect(live.liveAttributes).toEqual([])
    // Only bare helpers are created in the app document, and none is attached: DOMPurify's
    // <template> (whose content document it parses in) and the editor's own list and mount wrappers.
    expect(live.created.filter(element => element.isConnected)).toEqual([])
    expect(live.created.flatMap(element => Array.from(element.attributes, attribute => attribute.name))
      .filter(name => URL_ATTRIBUTES.has(name) || name.startsWith('on'))).toEqual([])
    expect([...new Set(live.created.map(element => element.tagName))].filter(tag => !['DIV', 'LI', 'TEMPLATE'].includes(tag))).toEqual([])
    expect(content.length).toBeGreaterThan(0)
  })

  it('keeps only text, http(s) text links and the fetched page as the base', async () => {
    const { note } = await convert(fixture('hostile'))
    expect(note.content).not.toMatch(/<[a-z]|onerror|onload|onclick|onmouseover|javascript:|data:|srcdoc|srcset|@import/iu)
    for (const leaked of ['planted-base', 'style.css', 'preload', 'prefetch', 'favicon', 'import.css', 'bg.png', 'body.png', 'head.js', 'inline', 'onload', 'refresh',
      'frame', 'object.swf', 'embed.swf', 'svg-image', 'foreign', 'input.png', 'button', 'form', 'poster', 'track', 'template', 'noscript', 'table.png', 'cell.png', 'ping', 'beacon', 'picture.webp', 'img-2x']) {
      expect(note.content).not.toContain(`evil.example/${leaked}`)
    }
    for (const junk of ['hidden value', 'Send now', 'Option text', 'alert(']) expect(note.content).not.toContain(junk)
    const blocks = flat(await open(note.content))
    expect(blocks.map(block => block.type).filter(type => !['heading', 'paragraph', 'table'].includes(type))).toEqual([])
    const linkTargets = blocks.flatMap(block => marksOf(inlineOf(block))).filter(mark => mark.startsWith('link:'))
    expect(linkTargets).toEqual([
      'link:https://pages.example.org/2026/10/relative/page',
      'link:https://evil.example/img.png',
      'link:https://evil.example/picture.png',
      'link:https://evil.example/video.mp4',
      'link:https://evil.example/audio.mp3',
      'link:https://example.org/flags',
    ])
    expect(blocks.map(block => textOf(block.content))).toContain('Image: Flag chart Image: Flag picture Video Audio')
  })
})
