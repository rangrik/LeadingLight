import { readFileSync } from 'node:fs'
import { BlockNoteEditor } from '@blocknote/core'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { resolveBlocksForTarget } from '../../hooks/editorBlockResolution'
import { tryParseFastMarkdownBlocks } from '../../hooks/editorFastMarkdownBlocks'
import {
  installRichEditorMarkdownSerializer, preProcessRichEditorMarkdown, serializeRichEditorBlocksToMarkdown, type RichEditorMarkdownSerializer,
} from '../../utils/richEditorMarkdown'
import { extractH1TitleFromContent } from '../../utils/noteTitle'
import { extractOutgoingLinks } from '../../utils/wikilinks'
import { TemplatePreview } from '../templates/TemplatePreview'
import type { ComposedDocument, DocumentBlock, FormAnswers } from './extensionContract'
import { buildExtensionMarkdown } from './extensionMarkdown'
import { previewDocument } from './extensionRecipe'
import { parseExtensionPackage } from './extensionSchema'

/**
 * The host builder through the real encoder and the real readers of a page: the rich editor's
 * parse (and its >= 16 KiB fast parser), a canonical save and reopen, and the passive preview.
 * Default BlockNote schema; extensionMarkdown.schema.test.ts repeats the core cases with the app's
 * own schema. Needs the accepted encoder and its parser-lane dependency, so it runs in the
 * integrated checkout. Assertions are the literal text; a lost or altered character is a failure.
 */

interface InlineNode { type: string; text?: string; href?: string; styles?: Record<string, unknown>; content?: unknown }
interface BlockNode { type: string; content?: unknown; props?: Record<string, unknown>; children?: BlockNode[] }
interface Summary { type: string; text: string; marks: string[] }

const NOTE_PATH = '/vault/Meetings/generated.md'
const FILLER = `\n\n${'Filler words that make this note large. '.repeat(500)}`
const meeting = (() => {
  const parsed = parseExtensionPackage(readFileSync(`${process.cwd()}/src/leadinglight/extensions/fixtures/meeting-debrief.json`, 'utf8'))
  if (parsed.status !== 'valid') throw new Error('fixture invalid')
  return parsed.extension.commands[0]
})()

const items = (content: unknown): InlineNode[] => (Array.isArray(content) ? content as InlineNode[] : [])
const textOf = (content: unknown): string => items(content).map(item => (item.type === 'text' ? item.text ?? '' : textOf(item.content))).join('')
const marksOf = (content: unknown): string[] => items(content).flatMap(item => item.type === 'text'
  ? Object.entries(item.styles ?? {}).filter(([, on]) => on).map(([style]) => `style:${style}`)
  : [item.href ? `${item.type}:${item.href}` : item.type, ...marksOf(item.content)])
const summarize = (blocks: BlockNode[]): Summary[] => blocks.flatMap(block => [
  { type: block.type, text: textOf(block.content), marks: marksOf(block.content) }, ...summarize(block.children ?? []),
])

async function open(markdown: string, editor = BlockNoteEditor.create()): Promise<BlockNode[]> {
  const { blocks } = await resolveBlocksForTarget({ editor, cache: new Map(), content: markdown, targetPath: NOTE_PATH })
  return blocks as BlockNode[]
}

async function openLarge(markdown: string): Promise<BlockNode[]> {
  const content = `${markdown.replace(/\n+$/u, '')}${FILLER}`
  expect(tryParseFastMarkdownBlocks(preProcessRichEditorMarkdown(content)).metrics.fallbackReason).toBeNull()
  return (await open(content)).slice(0, -1)
}

async function canonicalSave(markdown: string): Promise<string> {
  const editor = BlockNoteEditor.create()
  installRichEditorMarkdownSerializer(editor)
  const blocks = await open(markdown, editor)
  return serializeRichEditorBlocksToMarkdown({ editor: editor as unknown as RichEditorMarkdownSerializer, blocks })
}

function preview(markdown: string) {
  const view = render(createElement(TemplatePreview, { content: markdown, locale: 'en' }))
  const formatted = view.getByTestId('template-preview-formatted')
  const result = {
    text: formatted.textContent ?? '',
    live: [...formatted.querySelectorAll('a[href], img, script, iframe, object, embed, input, form, style')].map(element => element.tagName.toLowerCase()),
  }
  view.unmount()
  return result
}

function compose(answers: FormAnswers) {
  const { document, problems } = previewDocument(meeting, { capture: null, answers, destination: { kind: 'newInFolder', folderHandle: 'h' } })
  expect(problems).toEqual([])
  const built = buildExtensionMarkdown(document!, meeting.title)
  if (built.status !== 'built') throw new Error(`refused: ${built.reason}`)
  return built.markdown
}

function build(title: string, blocks: DocumentBlock[]) {
  const built = buildExtensionMarkdown({ title, blocks, textBytes: 0 } satisfies ComposedDocument, 'Fallback')
  if (built.status !== 'built') throw new Error(`refused: ${built.reason}`)
  return built.markdown.content
}

const HOSTILE_TITLE = '<img src=x onerror=alert(1)> [[Private]] **bold** #tag `code` $x$'
// Bare http(s) and email text still autolinks under the encoder's pinned limitation, so none here.
const HOSTILE_LINE = '[click](javascript:alert(1)) ![pixel](//evil.example/p.png) <mailto:x> [^1]'
const HOSTILE_LINES = [
  '```html scripts=sandboxed height="400"', '<script>parent.document.title = "pwned"</script>', '```',
  '---', 'title: injected', '---', '> quoted', '- item', '1. ordered', '$$', 'x^2', '$$', '| a | b |', '| --- | --- |',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>', '&lt;b&gt; &#60;script&#62; AT&T',
].join('\n')
const ANSWERS: FormAnswers = {
  meeting: HOSTILE_TITLE, attendees: HOSTILE_LINE, decisions: HOSTILE_LINES, followUps: 'Follow *up* with _care_ ~soon~', mood: 'mixed', revisit: true,
}

function expectMeeting(summary: Summary[]) {
  expect(summary.map(block => block.type)).toEqual(expect.arrayContaining(['heading', 'bulletListItem', 'paragraph']))
  expect(summary.filter(block => block.type === 'heading').map(block => block.text)).toEqual([`Debrief: ${HOSTILE_TITLE}`, 'Decisions', 'Follow-ups'])
  expect(summary.filter(block => block.type === 'bulletListItem').map(block => block.text)).toEqual([`Attendees: ${HOSTILE_LINE}`, 'Mood: Mixed'])
  expect(summary.filter(block => block.type === 'paragraph').map(block => block.text).join('\n'))
    .toBe(`${HOSTILE_LINES}\nFollow *up* with _care_ ~soon~\nRevisit this next week.`)
  expect(summary.flatMap(block => block.marks)).toEqual([])
  expect(summary.some(block => ['htmlBlock', 'codeBlock', 'image', 'table', 'quote', 'numberedListItem', 'mathBlock'].includes(block.type))).toBe(false)
}

describe('a Meeting debrief with hostile answers, through the real readers', () => {
  it('opens as the typed structure with every answer literal', async () => {
    const markdown = compose(ANSWERS)
    const blocks = await open(markdown.content)
    expectMeeting(summarize(blocks))
    expect(blocks.filter(block => block.type === 'heading').map(block => block.props?.level)).toEqual([1, 2, 2])
    expect(extractOutgoingLinks(markdown.content)).toEqual([])
  })

  it('opens the same way past 16 KiB through the fast parser', async () => {
    expectMeeting(summarize(await openLarge(compose(ANSWERS).content)))
  })

  it('survives a canonical save and reopen twice, character for character', async () => {
    const first = await canonicalSave(compose(ANSWERS).content)
    expectMeeting(summarize(await open(first)))
    const second = await canonicalSave(first)
    expectMeeting(summarize(await open(second)))
  })

  it('shows the same text in the passive preview with nothing live', () => {
    const { text, live } = preview(compose(ANSWERS).content)
    expect(live).toEqual([])
    for (const answer of [HOSTILE_TITLE, HOSTILE_LINE, 'Follow *up* with _care_ ~soon~']) expect(text).toContain(answer)
    for (const line of HOSTILE_LINES.split('\n')) expect(text).toContain(line)
  })
})

describe('quotes, callout and highlight look-alikes (parser repair pending)', () => {
  const lookalikes = ['[!warning] Not a callout', '==not highlighted== and a=b==c', 'brace \\{not a block\\}', 'heading text ends with #']

  it('keeps a quote that starts like a callout as a plain quote', async () => {
    const markdown = build('Quotes', [{ type: 'quote', text: lookalikes.join('\n') }])
    for (const blocks of [await open(markdown), await openLarge(markdown)]) {
      const summary = summarize(blocks).slice(1)
      expect(summary.every(block => block.type === 'quote')).toBe(true)
      expect(summary.map(block => block.text).join('\n')).toBe(lookalikes.join('\n'))
      expect(summary.flatMap(block => block.marks)).toEqual([])
    }
  })

  it('keeps highlight, braces and a trailing # literal in headings and list items', async () => {
    const markdown = build('Heading ends with #', [
      { type: 'heading', level: 2, text: '==mark== and \\{x\\} #' },
      { type: 'list', style: 'bullet', items: ['==mark==', 'a \\{b\\}'] },
    ])
    for (const blocks of [await open(markdown), await openLarge(markdown)]) {
      expect(summarize(blocks)).toEqual([
        { type: 'heading', text: 'Heading ends with #', marks: [] },
        { type: 'heading', text: '==mark== and \\{x\\} #', marks: [] },
        { type: 'bulletListItem', text: '==mark==', marks: [] },
        { type: 'bulletListItem', text: 'a \\{b\\}', marks: [] },
      ])
    }
  })
})

describe('the page title as the app lists it (title-parity lane pending)', () => {
  it('lists punctuation in a title as written, without escapes', () => {
    for (const title of ['Q3 *plans* [draft]', 'Notes_on_v2 `beta` ~maybe~', 'Cost <$5> & more']) {
      expect(extractH1TitleFromContent(build(title, []))).toBe(title)
    }
  })
})
