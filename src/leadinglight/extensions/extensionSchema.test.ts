import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EXTENSION_LIMITS, type ExtensionPackage } from './extensionContract'
import { isValidatedPackage, parseExtensionPackage } from './extensionSchema'

const fixture = (name: string) => readFileSync(`${process.cwd()}/src/leadinglight/extensions/fixtures/${name}`, 'utf8')
const cases = JSON.parse(fixture('cases.json')) as { valid: string[]; invalid: { file: string; code: string; path: string }[] }

function valid(text: string): ExtensionPackage {
  const result = parseExtensionPackage(text)
  if (result.status === 'invalid') throw new Error(JSON.stringify(result.diagnostics))
  return result.extension
}
const problems = (text: string) => {
  const result = parseExtensionPackage(text)
  return result.status === 'invalid' ? result.diagnostics.map(({ code, path }) => ({ code, path })) : []
}
const messages = (text: string) => {
  const result = parseExtensionPackage(text)
  return result.status === 'invalid' ? result.diagnostics.map(item => item.message) : []
}

type Node = Record<string, unknown>
const getAt = (root: unknown, pointer: string): unknown =>
  pointer.split('/').slice(1).reduce<unknown>((node, key) => (node as Node)[key], root)
function setAt(root: unknown, pointer: string, next: unknown) {
  const keys = pointer.split('/').slice(1)
  const last = keys.pop() as string
  const parent = getAt(root, keys.length ? `/${keys.join('/')}` : '') as Node
  if (next === undefined) delete parent[last]
  else parent[last] = next
}
/** The fixture with some values replaced; `undefined` removes a key. */
function edited(name: string, changes: Record<string, unknown>): string {
  const json: unknown = JSON.parse(fixture(name))
  for (const [pointer, next] of Object.entries(changes)) setAt(json, pointer, next)
  return JSON.stringify(json, null, 2)
}
function objectPointers(value: unknown, pointer = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => objectPointers(item, `${pointer}/${index}`))
  if (typeof value !== 'object' || value === null) return []
  return [pointer, ...Object.entries(value).flatMap(([key, item]) => objectPointers(item, `${pointer}/${key}`))]
}
const isDeeplyFrozen = (value: unknown): boolean =>
  typeof value !== 'object' || value === null || (Object.isFrozen(value) && Object.values(value).every(isDeeplyFrozen))

const ref = (step: string, field: string) => ({ step, field })
const meetingLevel = '/commands/0/steps/2/blocks/1/level'

describe('extension package validation', () => {
  it('accepts the shared valid fixtures as frozen packages with optional keys filled in', () => {
    for (const name of cases.valid) {
      const extension = valid(fixture(name))
      expect(isValidatedPackage(extension)).toBe(true)
      expect(isDeeplyFrozen(extension)).toBe(true)
    }
    const meeting = valid(fixture('meeting-debrief.json'))
    const [form, , compose] = meeting.commands[0].steps
    expect(form.op === 'collectForm' && form.fields.slice(0, 2)).toEqual([
      { kind: 'text', id: 'meeting', label: 'Meeting', required: true },
      { kind: 'text', id: 'attendees', label: 'Who was there', required: false },
    ])
    expect(compose.op === 'composeDocument' && compose.blocks[0]).toMatchObject({ type: 'list', ifFilled: null })
    const commentary = valid(fixture('passage-commentary.json'))
    expect(commentary.capabilities).toEqual(['selection.read', 'association.resolve', 'document.create', 'document.append', 'document.open'])
    expect(isValidatedPackage(structuredClone(meeting))).toBe(false)
  })

  it('rejects each shared invalid fixture with exactly one diagnostic at the offending path', () => {
    expect(cases.invalid.map(({ file }) => ({ file, problems: problems(fixture(file)) })))
      .toEqual(cases.invalid.map(({ file, code, path }) => ({ file, problems: [{ code, path }] })))
    for (const { file } of cases.invalid) expect(messages(fixture(file))[0]).toMatch(/\w.*\.$/)
  })

  it('rejects an unknown field at every nesting level and names the allowed ones', () => {
    for (const name of ['meeting-debrief.json', 'passage-commentary.json', 'append-observation.json']) {
      for (const pointer of objectPointers(JSON.parse(fixture(name)))) {
        expect(problems(edited(name, { [`${pointer}/extra`]: true }))).toEqual([{ code: 'unknownField', path: `${pointer}/extra` }])
      }
    }
    expect(messages(fixture('invalid/folder-path.json'))[0]).toContain('id, op, policy')
  })

  it('reads numbers only as plain safe integers and checks their range', () => {
    const text = fixture('meeting-debrief.json')
    expect(text).toContain('"level": 2,')
    const withLevel = (level: string) => text.replace('"level": 2,', `"level": ${level},`)
    const loose = ['2.5', '2.0', '2E0', '-0', '1e400', '9007199254740993']
    expect(loose.map(level => ({ level, problems: problems(withLevel(level)) })))
      .toEqual(loose.map(level => ({ level, problems: [{ code: 'invalidNumber', path: meetingLevel }] })))
    expect(problems(withLevel('"2"'))).toEqual([{ code: 'wrongType', path: meetingLevel }])
    expect(problems(withLevel('5'))).toEqual([{ code: 'unsupportedValue', path: meetingLevel }])
    expect(problems(withLevel('3'))).toEqual([])
  })

  it('rejects text that is not JSON, including JSON5 and YAML conveniences', () => {
    const text = fixture('quick-note.json')
    for (const variant of [
      text.replace('"Quick note",', "'Quick note',"),
      text.replace('"capabilities": ["document.create"]', '"capabilities": ["document.create",]'),
      `// comment\n${text}`,
      text.replace('"version": "1.0.0"', 'version: 1.0.0'),
      `${text}\n${text}`,
    ]) expect(problems(variant)).toEqual([{ code: 'invalidJson', path: '' }])
  })

  it('bounds package bytes and nesting at their limits', () => {
    const text = fixture('meeting-debrief.json')
    const padded = (bytes: number) => text + ' '.repeat(bytes - new TextEncoder().encode(text).length)
    expect(problems(padded(EXTENSION_LIMITS.packageBytes))).toEqual([])
    expect(problems(padded(EXTENSION_LIMITS.packageBytes + 1))).toEqual([{ code: 'tooLarge', path: '' }])
    const nested = (depth: number) => edited('quick-note.json', { '/description': 0 }).replace('"description": 0', `"description": ${'['.repeat(depth)}${']'.repeat(depth)}`)
    expect(problems(nested(EXTENSION_LIMITS.jsonDepth - 1))).toEqual([{ code: 'wrongType', path: '/description' }])
    expect(problems(nested(EXTENSION_LIMITS.jsonDepth))).toEqual([{ code: 'tooDeep', path: '' }])
    expect(problems(nested(50_000))).toEqual([{ code: 'tooDeep', path: '' }])
  })

  it('bounds nesting across the original text, including a duplicate member JSON.parse discards', () => {
    const text = fixture('quick-note.json')
    const hiddenFirst = (depth: number) => text.replace('"description":', `"description": ${'['.repeat(depth)}${']'.repeat(depth)}, "description":`)
    const objects = (depth: number) => text.replace('"description":', `"description": ${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}, "description":`)
    const outcome = (input: string) => {
      try {
        return problems(input)
      } catch (error) {
        return `threw ${error instanceof Error ? error.name : 'value'}`
      }
    }
    expect(outcome(hiddenFirst(EXTENSION_LIMITS.jsonDepth - 1))).toEqual([{ code: 'duplicateKey', path: '/description' }])
    const tooDeep = [{ code: 'tooDeep', path: '' }]
    expect([hiddenFirst(EXTENSION_LIMITS.jsonDepth), hiddenFirst(60_000), objects(20_000)].map(outcome)).toEqual([tooDeep, tooDeep, tooDeep])
  })

  it('refuses malformed text gracefully, counting only brackets outside strings', () => {
    const backslash = String.fromCharCode(0x5c)
    for (const broken of [
      '['.repeat(100_000),
      `{"a": "${backslash}`,
      `{"a": "${backslash}"${'['.repeat(30)}`,
      `${']'.repeat(50)}${'['.repeat(5)}`,
      '',
    ]) {
      expect(() => parseExtensionPackage(broken)).not.toThrow()
      expect(parseExtensionPackage(broken).status).toBe('invalid')
    }
    const bracketsInText = edited('quick-note.json', { '/commands/0/steps/2/blocks/0/text/0': `${'[{'.repeat(20)} ${backslash}" ${'}]'.repeat(20)}` })
    expect(problems(bracketsInText)).toEqual([])
  })

  it('bounds commands, form fields and literal text at their limits', () => {
    const base = JSON.parse(fixture('quick-note.json')) as { commands: Node[] }
    const commands = (count: number) => JSON.stringify({ ...base, commands: Array.from({ length: count }, (_, index) => ({ ...base.commands[0], id: `quick${index}` })) })
    expect(problems(commands(EXTENSION_LIMITS.commands))).toEqual([])
    expect(problems(commands(EXTENSION_LIMITS.commands + 1))).toEqual([{ code: 'tooMany', path: '/commands' }])

    const field = (index: number) => ({ id: `extra${index}`, kind: 'boolean', label: `Extra ${index}` })
    const fields = (count: number) => edited('quick-note.json', {
      '/commands/0/steps/0/fields': [{ id: 'topic', kind: 'text', label: 'Topic', required: true }, ...Array.from({ length: count - 1 }, (_, index) => field(index))],
    })
    expect(problems(fields(EXTENSION_LIMITS.formFields))).toEqual([])
    expect(problems(fields(EXTENSION_LIMITS.formFields + 1))).toEqual([{ code: 'tooMany', path: '/commands/0/steps/0/fields' }])

    const literal = '/commands/0/steps/2/blocks/0/text/0'
    expect(problems(edited('quick-note.json', { [literal]: 'é'.repeat(EXTENSION_LIMITS.literalBytes / 2) }))).toEqual([])
    expect(problems(edited('quick-note.json', { [literal]: `${'é'.repeat(EXTENSION_LIMITS.literalBytes / 2)}x` })))
      .toEqual([{ code: 'tooLong', path: literal }])
  })

  it('keeps line breaks, control and bidirectional characters and lone surrogates out of package text', () => {
    const label = '/commands/0/steps/0/fields/0/label'
    for (const code of [0x0a, 0x1b, 0x7f, 0x2028, 0x202e, 0xd800]) {
      expect(problems(edited('quick-note.json', { [label]: `Topic${String.fromCharCode(code)}` }))).toEqual([{ code: 'invalidValue', path: label }])
    }
    expect(problems(edited('quick-note.json', { [label]: '   ' }))).toEqual([{ code: 'invalidValue', path: label }])
  })

  it('never lets a key change an object prototype and treats prototype names as plain ids', () => {
    expect(problems(fixture('invalid/proto-key.json'))).toEqual([{ code: 'unknownField', path: '/commands/0/steps/2/blocks/0/__proto__' }])
    expect(({} as Node).polluted).toBeUndefined()
    const named = valid(edited('quick-note.json', {
      '/commands/0/steps/0/fields/0/id': 'constructor',
      '/commands/0/steps/2/title/0': ref('answers', 'constructor'),
    }))
    expect(named.commands[0].steps[0]).toMatchObject({ fields: [{ id: 'constructor' }] })
  })

  it('requires the declared capabilities to equal what the steps use', () => {
    expect(problems(edited('quick-note.json', { '/capabilities': ['document.create', 'document.append'] })))
      .toEqual([{ code: 'unusedCapability', path: '/capabilities/1' }])
    expect(problems(edited('quick-note.json', { '/capabilities': ['document.create', 'document.create'] })))
      .toEqual([{ code: 'duplicateId', path: '/capabilities/1' }])
    expect(messages(fixture('invalid/undeclared-capability.json'))[0]).toContain('document.open')
  })

  it('checks the linear pipeline: order, one write, required steps and title rules', () => {
    const [form, destination, compose, create, open] = (JSON.parse(fixture('meeting-debrief.json')) as { commands: { steps: Node[] }[] }).commands[0].steps
    expect(problems(edited('meeting-debrief.json', { '/commands/0/steps': [form, destination, compose, open, create] })))
      .toEqual([{ code: 'stepOrder', path: '/commands/0/steps/4/op' }])
    expect(problems(edited('meeting-debrief.json', { '/commands/0/steps': [form, destination, compose, open] })))
      .toEqual([{ code: 'missingStep', path: '/commands/0/steps' }])
    expect(problems(edited('meeting-debrief.json', { '/commands/0/steps/2/title': undefined })))
      .toEqual([{ code: 'missingField', path: '/commands/0/steps/2/title' }])
    expect(problems(edited('append-observation.json', { '/commands/0/steps/2/title': ['Observation'] })))
      .toEqual([{ code: 'notAllowed', path: '/commands/0/steps/2/title' }])
    expect(problems(edited('meeting-debrief.json', { '/commands/0/steps/1/id': 'answers' })))
      .toEqual([{ code: 'duplicateId', path: '/commands/0/steps/1/id' }])
  })

  it('types every reference by where it is used', () => {
    const decisions = ref('answers', 'decisions')
    expect(problems(edited('meeting-debrief.json', { '/commands/0/steps/2/blocks/1/text/0': decisions })))
      .toEqual([{ code: 'incompatibleReference', path: '/commands/0/steps/2/blocks/1/text/0' }])
    expect(problems(edited('meeting-debrief.json', { '/commands/0/steps/2/blocks/0/items/0/1': decisions })))
      .toEqual([{ code: 'incompatibleReference', path: '/commands/0/steps/2/blocks/0/items/0/1' }])
    expect(problems(edited('meeting-debrief.json', { '/commands/0/steps/2/blocks/1/ifFilled': ref('answers', 'revisit') }))).toEqual([])
    expect(problems(edited('meeting-debrief.json', { '/commands/0/steps/2/blocks/1/text/0': ref('destination', 'folder') })))
      .toEqual([{ code: 'unboundReference', path: '/commands/0/steps/2/blocks/1/text/0/field' }])
    expect(messages(fixture('invalid/unbound-field.json'))[0]).toContain('topic')
  })
})
