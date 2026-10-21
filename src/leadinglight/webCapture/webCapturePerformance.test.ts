import { describe, expect, it } from 'vitest'
import { WEB_CAPTURE_LIMITS } from './webCaptureContract'
import { convertWebCapture } from './webCapturePipeline'
import { canonicalSave, page } from './webCapture.test-utils'

/**
 * Synthetic large pages, measured in jsdom only; webview timings are not measured here.
 * Each must finish as a note or an honest refusal within the stated budget; the stage timings are
 * printed for the conversion report.
 */

const TIMEOUT = 180_000
const encoder = new TextEncoder()

function report(name: string, html: string, result: Awaited<ReturnType<typeof convertWebCapture>>, wallMs: number) {
  const summary = result.status === 'converted'
    ? { status: result.status, noteBytes: result.note.contentBytes, ...result.timings, adjustments: result.adjustments }
    : { status: result.status, reason: result.reason }
  process.stdout.write(`WEB_CAPTURE_TIMING ${JSON.stringify({ name, pageBytes: encoder.encode(html).length, wallMs: Math.round(wallMs), ...summary })}\n`)
}

function chrome(scriptBytes: number, navLinks: number): string {
  const script = `<script>window.__DATA__ = ${JSON.stringify({ blob: 'x'.repeat(scriptBytes) })}</script>`
  const style = `<style>${'.c{color:red;background:url(https://evil.example/bg.png)}\n'.repeat(4000)}</style>`
  const nav = `<nav><ul>${Array.from({ length: navLinks }, (_, index) => `<li><a href="/n/${index}">Navigation entry ${index}</a></li>`).join('')}</ul></nav>`
  return `${style}${script}${nav}`
}

function section(index: number): string {
  const sentence = `Section ${index} explains how the keeper records the weather, the lamp and the ships with care and patience. `
  return `<h2>Section ${index}</h2>
    <p>${sentence.repeat(6)}<strong>Bold note ${index}</strong> and <a href="/s/${index}">a link</a>.</p>
    <ul><li>First point of ${index}</li><li>Second point with <code>code_${index}</code></li></ul>
    <pre><code class="language-js">const entry${index} = { lamp: 'lit', weather: 'clear' }</code></pre>
    <table><tr><th>Hour</th><th>Note</th></tr><tr><td>${index}:00</td><td>Clear | calm [${index}]</td></tr></table>
    <p>${sentence.repeat(4)}Prices like $${index} and $${index + 1} are text, as is [[not a link]] and ==not a highlight==.</p>`
}

function articlePage(sections: number, scriptBytes: number, navLinks: number): string {
  return `<!doctype html><html><head><title>Large keeper's manual</title><meta property="og:site_name" content="Harbour Notes"></head>
    <body><header>${chrome(scriptBytes, navLinks)}</header><main><article><h1>Large keeper's manual</h1>
    ${Array.from({ length: sections }, (_, index) => section(index)).join('')}</article></main><footer>Footer text</footer></body></html>`
}

async function timed(name: string, html: string) {
  const start = performance.now()
  const result = await convertWebCapture(page(html))
  const wallMs = performance.now() - start
  report(name, html, result, wallMs)
  return { result, wallMs }
}

describe('large synthetic pages', () => {
  it('converts a ~5 MiB page with a large article within the budget, exactly', async () => {
    const html = articlePage(260, 4_250_000, 2_000)
    expect(encoder.encode(html).length).toBeGreaterThan(4 * 1024 * 1024)
    expect(encoder.encode(html).length).toBeLessThanOrEqual(WEB_CAPTURE_LIMITS.htmlBytes)
    const { result, wallMs } = await timed('large-article', html)
    expect(result.status).toBe('converted')
    if (result.status !== 'converted') return
    expect(result.note.contentBytes).toBeGreaterThan(256 * 1024)
    expect(result.timings.totalMs).toBeLessThan(WEB_CAPTURE_LIMITS.timeBudgetMs)
    expect(wallMs).toBeLessThan(WEB_CAPTURE_LIMITS.timeBudgetMs + 2000)
    expect(await canonicalSave(result.note.content)).toBe(result.note.content)
  }, TIMEOUT)

  it('finishes a page at the element limit as a note or an honest refusal within the budget', async () => {
    const html = articlePage(40, 0, 24_200)
    const elements = new DOMParser().parseFromString(html, 'text/html').getElementsByTagName('*').length
    expect(elements).toBeGreaterThan(WEB_CAPTURE_LIMITS.elements - 1500)
    expect(elements).toBeLessThanOrEqual(WEB_CAPTURE_LIMITS.elements)
    const { result, wallMs } = await timed('element-limit', html)
    expect(['converted', 'refused']).toContain(result.status)
    if (result.status === 'refused') expect(result.reason).toBe('tooComplex')
    expect(wallMs).toBeLessThan(WEB_CAPTURE_LIMITS.timeBudgetMs + 2000)
  }, TIMEOUT)

  it('refuses an article over the note limit as tooLarge without converting it', async () => {
    const html = articlePage(1100, 0, 10)
    const { result, wallMs } = await timed('over-note-limit', html)
    expect(result).toMatchObject({ status: 'refused', reason: 'tooLarge' })
    expect(wallMs).toBeLessThan(WEB_CAPTURE_LIMITS.timeBudgetMs)
  }, TIMEOUT)
})
