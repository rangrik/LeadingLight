import { readFileSync } from 'node:fs'
import recipesGuide from '../../../docs/leadinglight/web-capture-recipes.md?raw'
import { describe, expect, it } from 'vitest'
import {
  CAPABILITIES, E1_HOST_CAPABILITIES, E2_HOST_CAPABILITIES, STEP_OPERATIONS, WEB_PAGE_FIELDS, type ExtensionPackage,
} from './extensionContract'
import { commandCapabilities, isValidatedPackage, parseExtensionPackage } from './extensionSchema'

const fixture = (name: string) => readFileSync(`${process.cwd()}/src/leadinglight/extensions/fixtures/${name}`, 'utf8')
type Cases = { valid: string[]; invalid: { file: string; code: string; path: string }[] }
const webCases = JSON.parse(fixture('web-capture-cases.json')) as Cases
const sharedCases = JSON.parse(fixture('cases.json')) as Cases

function valid(text: string): ExtensionPackage {
  const result = parseExtensionPackage(text)
  if (result.status === 'invalid') throw new Error(JSON.stringify(result.diagnostics))
  return result.extension
}
const problems = (text: string) => {
  const result = parseExtensionPackage(text)
  return result.status === 'invalid' ? result.diagnostics.map(({ code, path }) => ({ code, path })) : []
}
const diagnostics = (text: string) => {
  const result = parseExtensionPackage(text)
  return result.status === 'invalid' ? result.diagnostics : []
}

type Node = Record<string, unknown>
type Json = { capabilities: string[]; commands: { steps: Node[] }[] }
const website = () => JSON.parse(fixture('website-capture.json')) as Json
const text = (json: unknown) => JSON.stringify(json, null, 2)
function edited(edit: (json: Json) => void): string {
  const json = website()
  edit(json)
  return text(json)
}
function objectPointers(value: unknown, pointer = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => objectPointers(item, `${pointer}/${index}`))
  if (typeof value !== 'object' || value === null) return []
  return [pointer, ...Object.entries(value).flatMap(([key, item]) => objectPointers(item, `${pointer}/${key}`))]
}
function addAt(json: unknown, pointer: string, key: string) {
  const target = pointer.split('/').slice(1).reduce<unknown>((node, part) => (node as Node)[part], json) as Node
  target[key] = true
}
const ref = (step: string, field: string) => ({ step, field })
const isDeeplyFrozen = (value: unknown): boolean =>
  typeof value !== 'object' || value === null || (Object.isFrozen(value) && Object.values(value).every(isDeeplyFrozen))

describe('website recipes: the captureWebPage step', () => {
  it('accepts the website fixture as a frozen package that derives web.capture', () => {
    const extension = valid(fixture('website-capture.json'))
    expect(isValidatedPackage(extension)).toBe(true)
    expect(isDeeplyFrozen(extension)).toBe(true)
    expect(extension.capabilities).toEqual(['document.create', 'document.open', 'web.capture'])
    expect(extension.commands[0].steps[0]).toEqual({ op: 'captureWebPage', id: 'page' })
    expect(commandCapabilities(extension.commands[0])).toEqual(['document.create', 'document.open', 'web.capture'])
  })

  it('rejects each website conformance case with exactly one diagnostic at the offending path', () => {
    expect(webCases.invalid.map(({ file }) => ({ file, problems: problems(fixture(file)) })))
      .toEqual(webCases.invalid.map(({ file, code, path }) => ({ file, problems: [{ code, path }] })))
    for (const { file } of webCases.invalid) expect(diagnostics(fixture(file))[0].message).toMatch(/\w.*\.$/)
  })

  it('takes no address, header, method, credential or option from a package, at any depth', () => {
    for (const key of ['url', 'headers', 'method', 'credentials', 'cookies', 'script', 'options', 'automatic']) {
      expect(problems(edited(json => { json.commands[0].steps[0][key] = 'x' }))).toEqual([{ code: 'unknownField', path: `/commands/0/steps/0/${key}` }])
    }
    for (const pointer of objectPointers(website())) {
      const json = website()
      addAt(json, pointer, 'extra')
      expect(problems(text(json))).toEqual([{ code: 'unknownField', path: `${pointer}/extra` }])
    }
    expect(diagnostics(fixture('invalid/web-url-in-step.json'))[0].message).toContain('its fields are id, op')
  })

  it('saves a page only as a new note: no append, association or second capture', () => {
    expect(problems(fixture('invalid/web-append.json'))).toEqual([{ code: 'notAllowed', path: '/commands/0/steps/2/policy' }])
    expect(problems(fixture('invalid/web-associated.json'))).toEqual([{ code: 'notAllowed', path: '/commands/0/steps/2/policy' }])
    const [page, notes, where, note, save] = website().commands[0].steps
    const passage = { id: 'passage', op: 'capturePassage' }
    const twoCaptures = (steps: Node[]) => edited(json => {
      json.capabilities = ['selection.read', 'document.create', 'web.capture']
      json.commands[0].steps = steps
    })
    expect(problems(twoCaptures([passage, page, where, { ...note, blocks: [{ type: 'paragraph', text: ['Saved.'] }] }, save]))).toEqual([{ code: 'notAllowed', path: '/commands/0/steps/1/op' }])
    expect(problems(twoCaptures([page, passage, where, { ...note, blocks: [{ type: 'paragraph', text: ['Saved.'] }] }, save]))).toEqual([{ code: 'stepOrder', path: '/commands/0/steps/1/op' }])
    expect(problems(edited(json => { json.commands[0].steps = [notes, where, note, save] }))).toEqual([{ code: 'unboundReference', path: '/commands/0/steps/2/title/0/step' }])
  })

  it('offers the page values to references by where they may be used', () => {
    const title = (field: string) => edited(json => { json.commands[0].steps[3].title = ['Read: ', ref('page', field)] })
    for (const field of ['pageTitle', 'pageUrl', 'siteName']) expect(problems(title(field))).toEqual([])
    expect(problems(title('byline'))).toEqual([{ code: 'incompatibleReference', path: '/commands/0/steps/3/title/1' }])
    expect(diagnostics(title('byline'))[0].message).toContain('not always known')
    const blocks = edited(json => {
      json.commands[0].steps[3].blocks = [
        { type: 'heading', level: 3, text: ['By ', ref('page', 'byline')], ifFilled: ref('page', 'byline') },
        { type: 'paragraph', text: [ref('page', 'siteName'), ' · ', ref('page', 'pageUrl')] },
        { type: 'quote', text: [ref('page', 'pageTitle')] },
        { type: 'list', style: 'bullet', items: [['Site: ', ref('page', 'siteName')], ['By: ', ref('page', 'byline')]] },
      ]
    })
    expect(problems(blocks)).toEqual([])
    for (const field of ['article', 'body', 'html', 'markdown', 'url', 'source', 'provenance', 'fetchedAt']) {
      expect(problems(edited(json => { json.commands[0].steps[3].blocks = [{ type: 'paragraph', text: [ref('page', field)] }] })))
        .toEqual([{ code: 'unboundReference', path: '/commands/0/steps/3/blocks/0/text/0/field' }])
    }
    expect(diagnostics(fixture('invalid/web-page-body-reference.json'))[0].message).toContain(WEB_PAGE_FIELDS.join(', '))
  })

  it('never lets a package write, move or omit the host page block', () => {
    expect(problems(fixture('invalid/web-forged-article.json'))).toEqual([{ code: 'unsupportedValue', path: '/commands/0/steps/3/blocks/0/type' }])
    expect(diagnostics(fixture('invalid/web-forged-article.json'))[0].message).toContain('web page block')
    expect(problems(edited(json => { json.commands[0].steps[3].blocks = [{ type: 'source', passage: 'p', quote: 'q' }] })))
      .toEqual([{ code: 'unsupportedValue', path: '/commands/0/steps/3/blocks/0/type' }])
  })

  it('requires the declared capabilities to equal what the steps use', () => {
    expect(problems(fixture('invalid/web-undeclared-capability.json'))).toEqual([{ code: 'undeclaredCapability', path: '/capabilities' }])
    expect(problems(fixture('invalid/web-unused-capability.json'))).toEqual([{ code: 'unusedCapability', path: '/capabilities/2' }])
    const quick = JSON.parse(fixture('quick-note.json')) as Json
    quick.capabilities.push('web.capture')
    expect(problems(text(quick))).toEqual([{ code: 'unusedCapability', path: `/capabilities/${quick.capabilities.length - 1}` }])
    expect(valid(edited(json => { json.capabilities = ['web.capture', 'document.open', 'document.create'] })).capabilities)
      .toEqual(['document.create', 'document.open', 'web.capture'])
  })
})

describe('website vocabulary leaves E1 and E2 exactly as they were', () => {
  it('appends web.capture and inserts captureWebPage beside the other capture step', () => {
    expect(CAPABILITIES).toEqual(['selection.read', 'association.resolve', 'document.create', 'document.append', 'document.open', 'web.capture'])
    expect(STEP_OPERATIONS).toEqual(['capturePassage', 'captureWebPage', 'collectForm', 'resolveDestination', 'composeDocument', 'proposeDocument', 'openCommittedResult'])
  })

  it('keeps the host lists explicit snapshots that never advertise web.capture', () => {
    expect(E1_HOST_CAPABILITIES).toEqual(['document.create', 'document.open'])
    expect(E2_HOST_CAPABILITIES).toEqual(['selection.read', 'association.resolve', 'document.create', 'document.append', 'document.open'])
    expect(E2_HOST_CAPABILITIES).not.toBe(CAPABILITIES)
    for (const host of [E1_HOST_CAPABILITIES, E2_HOST_CAPABILITIES]) expect(host).not.toContain('web.capture')
  })

  it('validates every shared fixture with the same capabilities, codes and paths', () => {
    expect(sharedCases.valid.map(name => valid(fixture(name)).capabilities)).toEqual([
      ['document.create', 'document.open'],
      ['selection.read', 'association.resolve', 'document.create', 'document.append', 'document.open'],
      ['document.append'],
      ['document.create'],
    ])
    expect(sharedCases.invalid.map(({ file }) => problems(fixture(file)))).toEqual(sharedCases.invalid.map(({ code, path }) => [{ code, path }]))
  })

  it('keeps the existing messages that name the vocabulary word for word', () => {
    expect(diagnostics(fixture('invalid/second-write.json'))[0].message).toBe(
      'Steps run in the order capturePassage, collectForm, resolveDestination, composeDocument, proposeDocument, openCommittedResult, each at most once; this proposeDocument is out of place.',
    )
    expect(diagnostics(fixture('invalid/forged-source-block.json'))[0].message).toBe(
      'A block type source is not supported; use one of heading, paragraph, quote, list. The host adds the source block itself.',
    )
    expect(diagnostics(fixture('invalid/optional-in-title.json'))[0].message).toContain('make "')
  })
})

describe('the public website recipe guide', () => {
  it('shows the step and the compose step exactly as the website fixture has them', () => {
    const examples = [...recipesGuide.matchAll(/```json\n([\s\S]*?)```/gu)].map(match => JSON.parse(match[1]) as Node)
    const steps = website().commands[0].steps
    expect(examples).toEqual([steps[0], steps[3]])
  })
})
