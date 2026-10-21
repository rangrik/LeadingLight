import { describe, expect, it } from 'vitest'
import { Schema, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { EditorState as CodeMirrorState, EditorSelection } from '@codemirror/state'
import { rawSelectedText, readRawSelection, registerRawSelectionReader, rawSelectionReaderFor } from './rawPassageAdapter'
import { observedPassage, readRichSelection } from './richPassageAdapter'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    image: { group: 'block', atom: true },
    text: { group: 'inline' },
    hardBreak: { group: 'inline', inline: true },
    wikilink: { group: 'inline', inline: true, atom: true, attrs: { target: { default: '' } } },
    mathInline: { group: 'inline', inline: true, atom: true, attrs: { latex: { default: '' } } },
  },
})
const p = (...content: ProseMirrorNode[]) => schema.node('paragraph', null, content)
const text = (value: string) => schema.text(value)

/** Positions of the first `needle` in the document's text nodes, as a selection would cover it. */
function rangeOf(doc: ProseMirrorNode, needle: string, occurrence = 0): { from: number; to: number; empty: boolean } {
  let seen = 0
  let found: { from: number; to: number; empty: boolean } | null = null
  doc.descendants((node, pos) => {
    if (found || !node.isText) return
    let index = node.text!.indexOf(needle)
    while (index !== -1 && !found) {
      if (seen++ === occurrence) found = { from: pos + index, to: pos + index + needle.length, empty: false }
      index = node.text!.indexOf(needle, index + 1)
    }
  })
  if (!found) throw new Error(`${needle} not in document`)
  return found
}

describe('rich capture', () => {
  it('reads the selected visible text exactly, with context on both sides', () => {
    const doc = schema.node('doc', null, [p(text('First  line here.')), p(text('Second line.'))])
    const read = readRichSelection(doc, rangeOf(doc, 'line here'))
    expect(read).toEqual({ mode: 'rich', text: 'line here', before: 'First  ', after: '.\nSecond line.' })
    expect(observedPassage(read!)).toEqual({ before: 'First  ', exact: 'line here', after: '.\nSecond line.' })
  })

  it('joins blocks with a line and shows atoms by their projected text', () => {
    const doc = schema.node('doc', null, [
      p(text('See '), schema.node('wikilink', { target: 'notes/topic|Topic' }), text(' and '), schema.node('wikilink', { target: 'plain' })),
      schema.node('image'),
      p(text('x'), schema.node('hardBreak'), text('y '), schema.node('mathInline', { latex: 'a^2' })),
    ])
    const read = readRichSelection(doc, { from: 1, to: doc.content.size - 1, empty: false })
    expect(read?.text).toBe('See Topic and plain\n￼\nx\n\ny $a^2$')
  })

  it('captures nothing for a collapsed or whitespace-only selection', () => {
    const doc = schema.node('doc', null, [p(text('a   b'))])
    expect(readRichSelection(doc, { from: 2, to: 2, empty: true })).toBeNull()
    expect(readRichSelection(doc, { from: 2, to: 5, empty: false })).toBeNull()
  })
})

const cmState = (doc: string, from: number, to: number) => CodeMirrorState.create({ doc, selection: EditorSelection.single(from, to) })

describe('raw capture', () => {
  it('keeps CodeMirror positions as they are, with the page text and its own line endings', () => {
    const page = 'a\r\nb\rc\nd'
    const read = readRawSelection(cmState('a\nb\nc\nd', 2, 5), page)
    expect(read).toEqual({ markdown: page, selection: { mode: 'raw', from: 2, to: 5 } })
    expect(read !== 'empty' && read !== 'unsynced' && rawSelectedText(read.markdown, read.selection)).toBe('b\nc')
  })

  it('refuses a collapsed selection and an editor that disagrees with its page text', () => {
    expect(readRawSelection(cmState('abc', 1, 1), 'abc')).toBe('empty')
    expect(readRawSelection(cmState('abc', 0, 2), 'abd')).toBe('unsynced')
  })

  it('finds a mounted raw editor by its buffer ref only while it is registered', () => {
    const buffer = { current: null }
    const reader = () => 'empty' as const
    const unregister = registerRawSelectionReader(buffer, reader)
    expect(rawSelectionReaderFor(buffer)).toBe(reader)
    unregister()
    expect(rawSelectionReaderFor(buffer)).toBeNull()
  })
})
