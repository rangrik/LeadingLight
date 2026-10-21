import { beforeEach, describe, expect, it } from 'vitest'
import { ASK_RESUME_LIMIT, askedAbout, readAskResume, rememberAskedAbout } from './askResume'
import { passageFrom } from './askPassage'

beforeEach(() => localStorage.clear())

describe('remembering which conversation asked about a page', () => {
  it('returns the latest conversation per page, per vault, and keeps only paths and ids', () => {
    rememberAskedAbout('/vault', ['/vault/plan.md', '/vault/notes.md'], 'conv-1')
    rememberAskedAbout('/vault', ['/vault/plan.md'], 'conv-2')
    rememberAskedAbout('/other', ['/other/plan.md'], 'conv-9')
    expect(askedAbout('/vault', '/vault/plan.md')).toBe('conv-2')
    expect(askedAbout('/vault', '/vault/notes.md')).toBe('conv-1')
    expect(askedAbout('/vault', '/vault/new.md')).toBeNull()
    expect(readAskResume('/vault')).toEqual([
      { path: '/vault/plan.md', conversationId: 'conv-2' }, { path: '/vault/notes.md', conversationId: 'conv-1' },
    ])
  })

  it('is bounded, and an unreadable store remembers nothing rather than failing', () => {
    for (let index = 0; index < ASK_RESUME_LIMIT + 5; index += 1) rememberAskedAbout('/vault', [`/vault/p${index}.md`], `c${index}`)
    expect(readAskResume('/vault')).toHaveLength(ASK_RESUME_LIMIT)
    expect(askedAbout('/vault', '/vault/p0.md')).toBeNull()
    localStorage.setItem('leadinglight.askResume:/vault', '{not json')
    expect(askedAbout('/vault', '/vault/p60.md')).toBeNull()
  })
})

describe('a passage taken from the active pane', () => {
  const title = (path: string) => (path.endsWith('.md') ? 'Plan' : null)
  const passage = (selection: { mode: 'rich'; text: string; before: string; after: string } | { mode: 'raw'; from: number; to: number }) =>
    ({ status: 'ok', passage: { path: '/vault/plan.md', documentSession: 1, markdown: '# Plan\n\n**Bold** words here.\n', selection } }) as const

  it('is the visible text of a rich selection and the exact Markdown of a raw one, named by its page', () => {
    expect(passageFrom(passage({ mode: 'rich', text: 'Bold words', before: '', after: '' }), title)).toEqual({ title: 'Plan', text: 'Bold words', key: '/vault/plan.md' })
    expect(passageFrom(passage({ mode: 'raw', from: 8, to: 24 }), title)).toEqual({ title: 'Plan', text: '**Bold** words h', key: '/vault/plan.md' })
  })

  it('says why nothing was taken', () => {
    expect(passageFrom({ status: 'empty' }, title)).toBe('noSelection')
    expect(passageFrom({ status: 'notReady' }, title)).toBe('noPage')
    expect(passageFrom(passage({ mode: 'rich', text: '  \n', before: '', after: '' }), title)).toBe('noSelection')
    expect(passageFrom(passage({ mode: 'rich', text: 'x', before: '', after: '' }), () => null)).toBe('noPage')
  })
})
