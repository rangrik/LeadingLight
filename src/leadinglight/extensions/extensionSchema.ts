// Strict reading of extension package text (format: extensionContract.ts).
// Nesting is bounded on the text itself first, so no later reader meets a deep tree.
// JSON.parse decides syntax and values. JSON.parse keeps the last of two equal keys, including
// keys that are only equal after escapes are decoded, and rounds numbers silently; so the yaml
// parser (YAML 1.2 reads JSON) re-reads the same text only to find duplicate keys and see each
// number exactly as written. Every object is then read against an
// explicit list of keys, only through own properties, into new frozen objects. Nothing in the
// text is evaluated.
import { isMap, isScalar, isSeq, parseDocument } from 'yaml'
import {
  BLOCK_TYPES, CAPABILITIES, DESTINATION_POLICIES, EXTENSION_LIMITS, EXTENSION_SCHEMA, FIELD_KINDS, HEADING_LEVELS,
  LIST_STYLES, PASSAGE_FIELDS, STEP_OPERATIONS,
  type BlockTemplate, type BlockType, type Capability, type ChoiceOption, type DestinationPolicy, type DiagnosticCode,
  type ExtensionCommand, type ExtensionDiagnostic, type ExtensionPackage, type FieldKind, type FieldRef, type FormField,
  type PackageValidation, type RecipeStep, type StepOperation, type TextPart,
} from './extensionContract.ts'

const LIMITS = EXTENSION_LIMITS
type Fields = Record<string, unknown>

// --- Diagnostics ----------------------------------------------------------------------------------

interface Report { readonly list: ExtensionDiagnostic[]; count: number }

function add(report: Report, code: DiagnosticCode, path: string, message: string) {
  report.count += 1
  if (report.list.length < LIMITS.diagnostics) report.list.push({ code, path, message })
}
const pointer = (path: string, key: string | number) => `${path}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`
/** Package-supplied names are clipped in messages; paths stay exact. */
const shown = (value: unknown) => {
  const text = String(value)
  return text.length > 40 ? `${text.slice(0, 40)}…` : text
}

// --- Text -----------------------------------------------------------------------------------------

/** UTF-8 length; a lone surrogate counts as the replacement character it would be written as. */
export function utf8Bytes(text: string): number {
  let bytes = 0
  for (const char of text) {
    const code = char.codePointAt(0) as number
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}

/** Controls, line and paragraph separators, direction overrides and isolates, lone surrogates. */
const isForbidden = (code: number) =>
  code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029
  || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) || (code >= 0xd800 && code <= 0xdfff)

function isPlainLine(text: string): boolean {
  for (const char of text) if (isForbidden(char.codePointAt(0) as number)) return false
  return true
}

// --- Reading the text -----------------------------------------------------------------------------

const QUOTE = 0x22
const BACKSLASH = 0x5c

/**
 * Bracket nesting of the text itself, so members JSON.parse later discards are counted too.
 * Brackets inside strings are ignored; malformed text is only counted, never parsed.
 */
function nestsDeeperThan(text: string, limit: number): boolean {
  let depth = 0
  let inString = false
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (inString) {
      if (code === BACKSLASH) index++
      else if (code === QUOTE) inString = false
    } else if (code === QUOTE) inString = true
    else if (code === 0x7b || code === 0x5b) {
      depth++
      if (depth > limit) return true
    } else if (code === 0x7d || code === 0x5d) depth--
  }
  return false
}

function readJson(report: Report, text: string): unknown {
  const size = utf8Bytes(text)
  if (size > LIMITS.packageBytes) {
    add(report, 'tooLarge', '', `The package is ${size} bytes; the limit is ${LIMITS.packageBytes}.`)
    return undefined
  }
  if (nestsDeeperThan(text, LIMITS.jsonDepth)) {
    add(report, 'tooDeep', '', `Objects and arrays nest more than ${LIMITS.jsonDepth} levels deep.`)
    return undefined
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    add(report, 'invalidJson', '', `The package is not valid JSON (${shown(error instanceof Error ? error.message : error)}).`)
    return undefined
  }
  checkTokens(report, text)
  return value
}

/** Whole numbers only, as written: no fraction, exponent, plus sign or minus zero. */
const PLAIN_INTEGER = /^(?:0|-?[1-9][0-9]*)$/

function checkTokens(report: Report, text: string) {
  try {
    const doc = parseDocument(text, { uniqueKeys: false })
    if (doc.errors.length > 0) add(report, 'invalidJson', '', 'The package could not be read as plain JSON.')
    else visitTokens(report, doc.contents, '')
  } catch {
    add(report, 'invalidJson', '', 'The package could not be read as plain JSON.')
  }
}

function visitTokens(report: Report, node: unknown, path: string) {
  if (isMap(node)) {
    const seen = new Set<string>()
    for (const pair of node.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : ''
      const at = pointer(path, key)
      if (seen.has(key)) add(report, 'duplicateKey', at, `"${shown(key)}" appears more than once in one object; keep only one.`)
      seen.add(key)
      visitTokens(report, pair.value, at)
    }
  } else if (isSeq(node)) {
    node.items.forEach((item, index) => visitTokens(report, item, pointer(path, index)))
  } else if (isScalar(node) && typeof node.value === 'number') {
    const token = node.source ?? ''
    if (!PLAIN_INTEGER.test(token) || !Number.isSafeInteger(node.value)) {
      add(report, 'invalidNumber', path, `Write ${shown(token)} as a plain whole number without a fraction or exponent, within ±${Number.MAX_SAFE_INTEGER}.`)
    }
  }
}

// --- Shape ----------------------------------------------------------------------------------------

interface Spec { readonly required: readonly string[]; readonly optional: readonly string[] }
const spec = (required: string[], optional: string[] = []): Spec => ({ required, optional })

const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value)
const own = (fields: Fields, key: string): unknown => (Object.hasOwn(fields, key) ? fields[key] : undefined)
const notNull = <T>(value: T | null): value is T => value !== null

function checkKeys(report: Report, fields: Fields, path: string, what: string, allowed: Spec) {
  const names = [...allowed.required, ...allowed.optional]
  for (const key of Object.keys(fields)) {
    if (!names.includes(key)) add(report, 'unknownField', pointer(path, key), `${what} has no field "${shown(key)}"; its fields are ${names.join(', ')}.`)
  }
  for (const key of allowed.required) {
    if (!Object.hasOwn(fields, key)) add(report, 'missingField', pointer(path, key), `${what} needs "${key}".`)
  }
}

function objectAt(report: Report, value: unknown, path: string, what: string, allowed: Spec): Fields {
  if (!isFields(value)) {
    add(report, 'wrongType', path, `${what} must be a JSON object.`)
    return {}
  }
  checkKeys(report, value, path, what, allowed)
  return value
}

/** `value` is undefined only for a key already reported missing. */
function list(report: Report, value: unknown, path: string, what: string, max: number, min = 1): unknown[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    add(report, 'wrongType', path, `${what} must be a JSON array.`)
    return []
  }
  if (value.length < min) add(report, 'invalidValue', path, `${what} needs at least ${min}.`)
  else if (value.length > max) add(report, 'tooMany', path, `${what} has ${value.length}; the limit is ${max}.`)
  else return value
  return []
}

function oneOf<T extends string | number>(
  report: Report, value: unknown, path: string, options: readonly T[], code: DiagnosticCode, what: string, hint = '',
): T | null {
  if (value === undefined) return null
  if (typeof value !== typeof options[0]) {
    add(report, 'wrongType', path, `${what} must be a ${typeof options[0]}.`)
    return null
  }
  if ((options as readonly unknown[]).includes(value)) return value as T
  add(report, code, path, `${what} ${shown(value)} is not supported; use one of ${options.join(', ')}.${hint}`)
  return null
}

function stringAt(report: Report, value: unknown, path: string, what: string): string | null {
  if (value === undefined) return null
  if (typeof value === 'string') return value
  add(report, 'wrongType', path, `${what} must be a string.`)
  return null
}

const ID = new RegExp(`^[a-z][A-Za-z0-9-]{0,${LIMITS.idChars - 1}}$`)
const PACKAGE_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/
const VERSION = /^(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})$/

function idAt(report: Report, value: unknown, path: string, what: string): string {
  const text = stringAt(report, value, path, what)
  if (text !== null && !ID.test(text)) {
    add(report, 'invalidValue', path, `${what} must start with a lowercase letter and use only letters, digits and hyphens, at most ${LIMITS.idChars}.`)
  }
  return text ?? ''
}

function matching(report: Report, value: unknown, path: string, what: string, pattern: RegExp, rule: string, maxChars: number): string {
  const text = stringAt(report, value, path, what)
  if (text !== null && (text.length > maxChars || !pattern.test(text))) add(report, 'invalidValue', path, `${what} ${rule}`)
  return text ?? ''
}

/** One line of plain text. Labels need visible characters; a literal part may be only spaces. */
function textAt(report: Report, value: unknown, path: string, what: string, maxBytes: number, visible = true): string {
  const text = stringAt(report, value, path, what)
  if (text === null) return ''
  if (visible ? text.trim() === '' : text === '') add(report, 'invalidValue', path, `${what} must not be empty.`)
  else if (!isPlainLine(text)) add(report, 'invalidValue', path, `${what} must be one line of plain text, without control or direction characters.`)
  else if (utf8Bytes(text) > maxBytes) add(report, 'tooLong', path, `${what} is longer than ${maxBytes} bytes.`)
  return text
}

/** Reports a second use of an id; null items were already reported. */
function uniqueIds(report: Report, items: readonly ({ id: string } | null)[], path: string, what: string) {
  const seen = new Set<string>()
  items.forEach((item, index) => {
    if (item === null) return
    if (seen.has(item.id)) add(report, 'duplicateId', pointer(pointer(path, index), 'id'), `${what} "${shown(item.id)}" is used more than once.`)
    seen.add(item.id)
  })
}

/** Reads the discriminating key of a tagged object; null when it is absent or unknown. */
function variantOf<T extends string>(
  report: Report, value: unknown, path: string, key: string, options: readonly T[], code: DiagnosticCode, what: string, hint = '',
): { fields: Fields; tag: T } | null {
  if (!isFields(value)) {
    add(report, 'wrongType', path, `${what} must be a JSON object.`)
    return null
  }
  if (!Object.hasOwn(value, key)) {
    add(report, 'missingField', pointer(path, key), `${what} needs "${key}".`)
    return null
  }
  const tag = oneOf(report, own(value, key), pointer(path, key), options, code, `${what} ${key}`, hint)
  return tag === null ? null : { fields: value, tag }
}

// --- Package parts --------------------------------------------------------------------------------

function refAt(report: Report, value: unknown, path: string): FieldRef {
  const fields = objectAt(report, value, path, 'A reference', spec(['step', 'field']))
  return { step: idAt(report, own(fields, 'step'), pointer(path, 'step'), 'A step id'), field: idAt(report, own(fields, 'field'), pointer(path, 'field'), 'A field id') }
}

function textParts(report: Report, value: unknown, path: string): TextPart[] {
  return list(report, value, path, 'Text', LIMITS.textParts).map((part, index) => {
    const at = pointer(path, index)
    if (typeof part === 'string') return textAt(report, part, at, 'Literal text', LIMITS.literalBytes, false)
    if (isFields(part)) return refAt(report, part, at)
    add(report, 'wrongType', at, 'A text part is either literal text or a {"step", "field"} reference.')
    return ''
  })
}

const FIELD_SPECS: Record<FieldKind, Spec> = {
  text: spec(['id', 'kind', 'label'], ['required']),
  multilineText: spec(['id', 'kind', 'label'], ['required']),
  choice: spec(['id', 'kind', 'label', 'options'], ['required']),
  boolean: spec(['id', 'kind', 'label']),
}

function optionsAt(report: Report, value: unknown, path: string): ChoiceOption[] {
  const options = list(report, value, path, 'Options', LIMITS.choiceOptions, 2).map((item, index) => {
    const at = pointer(path, index)
    const fields = objectAt(report, item, at, 'An option', spec(['id', 'label']))
    return { id: idAt(report, own(fields, 'id'), pointer(at, 'id'), 'An option id'), label: textAt(report, own(fields, 'label'), pointer(at, 'label'), 'An option label', LIMITS.labelBytes) }
  })
  uniqueIds(report, options, path, 'Option id')
  return options
}

function fieldAt(report: Report, value: unknown, path: string): FormField | null {
  const variant = variantOf(report, value, path, 'kind', FIELD_KINDS, 'unsupportedValue', 'A field')
  if (!variant) return null
  const { fields, tag: kind } = variant
  checkKeys(report, fields, path, `A ${kind} field`, FIELD_SPECS[kind])
  const id = idAt(report, own(fields, 'id'), pointer(path, 'id'), 'A field id')
  const label = textAt(report, own(fields, 'label'), pointer(path, 'label'), 'A field label', LIMITS.labelBytes)
  if (kind === 'boolean') return { kind, id, label }
  const flag = own(fields, 'required')
  if (flag !== undefined && typeof flag !== 'boolean') add(report, 'wrongType', pointer(path, 'required'), '"required" must be true or false.')
  const required = flag === true
  if (kind === 'choice') return { kind, id, label, required, options: optionsAt(report, own(fields, 'options'), pointer(path, 'options')) }
  return { kind, id, label, required }
}

const BLOCK_SPECS: Record<BlockType, Spec> = {
  heading: spec(['type', 'level', 'text'], ['ifFilled']),
  paragraph: spec(['type', 'text'], ['ifFilled']),
  quote: spec(['type', 'text'], ['ifFilled']),
  list: spec(['type', 'style', 'items'], ['ifFilled']),
}

function blockAt(report: Report, value: unknown, path: string): BlockTemplate | null {
  const hint = ' The host adds the source block itself.'
  const variant = variantOf(report, value, path, 'type', BLOCK_TYPES, 'unsupportedValue', 'A block', hint)
  if (!variant) return null
  const { fields, tag: type } = variant
  checkKeys(report, fields, path, `A ${type} block`, BLOCK_SPECS[type])
  const condition = own(fields, 'ifFilled')
  const ifFilled = condition === undefined ? null : refAt(report, condition, pointer(path, 'ifFilled'))
  const at = (key: string) => pointer(path, key)
  if (type === 'heading') {
    const level = oneOf(report, own(fields, 'level'), at('level'), HEADING_LEVELS, 'unsupportedValue', 'A heading level') ?? 2
    return { type, level, text: textParts(report, own(fields, 'text'), at('text')), ifFilled }
  }
  if (type === 'list') {
    const style = oneOf(report, own(fields, 'style'), at('style'), LIST_STYLES, 'unsupportedValue', 'A list style') ?? 'bullet'
    const items = list(report, own(fields, 'items'), at('items'), 'List items', LIMITS.listItems).map((item, index) => textParts(report, item, pointer(at('items'), index)))
    return { type, style, items, ifFilled }
  }
  return { type, text: textParts(report, own(fields, 'text'), at('text')), ifFilled }
}

const STEP_SPECS: Record<StepOperation, Spec> = {
  capturePassage: spec(['id', 'op']),
  collectForm: spec(['id', 'op', 'fields']),
  resolveDestination: spec(['id', 'op', 'policy']),
  composeDocument: spec(['id', 'op', 'blocks'], ['title']),
  proposeDocument: spec(['id', 'op']),
  openCommittedResult: spec(['id', 'op']),
}

function stepAt(report: Report, value: unknown, path: string): RecipeStep | null {
  const hint = ' Recipes cannot run app commands, scripts, loops or network requests.'
  const variant = variantOf(report, value, path, 'op', STEP_OPERATIONS, 'unknownOperation', 'A step', hint)
  if (!variant) return null
  const { fields, tag: op } = variant
  checkKeys(report, fields, path, `A ${op} step`, STEP_SPECS[op])
  const id = idAt(report, own(fields, 'id'), pointer(path, 'id'), 'A step id')
  const at = (key: string) => pointer(path, key)
  switch (op) {
    case 'collectForm': {
      const items = list(report, own(fields, 'fields'), at('fields'), 'Fields', LIMITS.formFields).map((item, index) => fieldAt(report, item, pointer(at('fields'), index)))
      uniqueIds(report, items, at('fields'), 'Field id')
      return { op, id, fields: items.filter(notNull) }
    }
    case 'resolveDestination':
      return { op, id, policy: oneOf(report, own(fields, 'policy'), at('policy'), DESTINATION_POLICIES, 'unsupportedValue', 'A destination policy') ?? 'newInChosenFolder' }
    case 'composeDocument': {
      const title = own(fields, 'title') === undefined ? null : textParts(report, own(fields, 'title'), at('title'))
      const blocks = list(report, own(fields, 'blocks'), at('blocks'), 'Blocks', LIMITS.blocks).map((item, index) => blockAt(report, item, pointer(at('blocks'), index)))
      return { op, id, title, blocks: blocks.filter(notNull) }
    }
    default:
      return { op, id }
  }
}

// --- Meaning --------------------------------------------------------------------------------------

/** How a referenced value may be used: one line of text, several lines, or only as a condition. */
interface Output { readonly shape: 'line' | 'lines' | 'flag'; readonly always: boolean }
interface Producer { readonly index: number; readonly op: StepOperation; readonly outputs: ReadonlyMap<string, Output> }
type Use = 'title' | 'line' | 'lines' | 'condition'

const outputOf = (field: FormField): Output => field.kind === 'boolean'
  ? { shape: 'flag', always: false }
  : { shape: field.kind === 'multilineText' ? 'lines' : 'line', always: field.required }

function producersOf(command: ExtensionCommand): Map<string, Producer> {
  const producers = new Map<string, Producer>()
  command.steps.forEach((step, index) => {
    const outputs = new Map<string, Output>()
    if (step.op === 'capturePassage') for (const name of PASSAGE_FIELDS) outputs.set(name, { shape: 'line', always: true })
    if (step.op === 'collectForm') for (const field of step.fields) outputs.set(field.id, outputOf(field))
    producers.set(step.id, { index, op: step.op, outputs })
  })
  return producers
}

function checkRef(report: Report, producers: Map<string, Producer>, composeIndex: number, ref: FieldRef, path: string, use: Use) {
  const producer = producers.get(ref.step)
  if (!producer) return add(report, 'unboundReference', pointer(path, 'step'), `There is no step "${shown(ref.step)}" in this command.`)
  if (producer.index >= composeIndex) {
    return add(report, 'forwardReference', pointer(path, 'step'), `Step "${shown(ref.step)}" is not before this one; refer only to earlier steps.`)
  }
  const output = producer.outputs.get(ref.field)
  if (!output) {
    const names = [...producer.outputs.keys()]
    const known = names.length > 0 ? `its fields are ${names.join(', ')}` : `a ${producer.op} step produces no values`
    return add(report, 'unboundReference', pointer(path, 'field'), `Step "${shown(ref.step)}" has no field "${shown(ref.field)}"; ${known}.`)
  }
  if (use === 'condition') return
  if (output.shape === 'flag') return add(report, 'incompatibleReference', path, `"${ref.field}" is a yes/no answer; use it only in ifFilled.`)
  if (output.shape === 'lines' && use !== 'lines') {
    return add(report, 'incompatibleReference', path, `"${ref.field}" can hold several lines; use it in a paragraph or quote, not a title, heading or list item.`)
  }
  if (use === 'title' && !output.always) {
    add(report, 'incompatibleReference', path, `The title may use only answers that are always filled; make "${ref.field}" required or leave it out of the title.`)
  }
}

function checkReferences(report: Report, command: ExtensionCommand, path: string) {
  const composeIndex = command.steps.findIndex(step => step.op === 'composeDocument')
  const compose = command.steps[composeIndex]
  if (compose?.op !== 'composeDocument') return
  const producers = producersOf(command)
  const at = pointer(pointer(path, 'steps'), composeIndex)
  const parts = (text: readonly TextPart[], textPath: string, use: Use) => text.forEach((part, index) => {
    if (typeof part !== 'string') checkRef(report, producers, composeIndex, part, pointer(textPath, index), use)
  })
  if (compose.title) parts(compose.title, pointer(at, 'title'), 'title')
  compose.blocks.forEach((block, index) => {
    const blockPath = pointer(pointer(at, 'blocks'), index)
    if (block.ifFilled) checkRef(report, producers, composeIndex, block.ifFilled, pointer(blockPath, 'ifFilled'), 'condition')
    if (block.type === 'list') block.items.forEach((item, itemIndex) => parts(item, pointer(pointer(blockPath, 'items'), itemIndex), 'line'))
    else parts(block.text, pointer(blockPath, 'text'), block.type === 'heading' ? 'line' : 'lines')
  })
}

const REQUIRED_STEPS: readonly StepOperation[] = ['resolveDestination', 'composeDocument', 'proposeDocument']

function checkPipeline(report: Report, command: ExtensionCommand, path: string) {
  const stepsPath = pointer(path, 'steps')
  let last = -1
  command.steps.forEach((step, index) => {
    const rank = STEP_OPERATIONS.indexOf(step.op)
    if (rank <= last) {
      add(report, 'stepOrder', pointer(pointer(stepsPath, index), 'op'), `Steps run in the order ${STEP_OPERATIONS.join(', ')}, each at most once; this ${step.op} is out of place.`)
    }
    last = Math.max(last, rank)
  })
  for (const op of REQUIRED_STEPS) {
    if (!command.steps.some(step => step.op === op)) add(report, 'missingStep', stepsPath, `Command "${command.id}" needs a ${op} step.`)
  }
}

function checkDestination(report: Report, command: ExtensionCommand, path: string) {
  const at = (index: number) => pointer(pointer(path, 'steps'), index)
  const destinationIndex = command.steps.findIndex(step => step.op === 'resolveDestination')
  const composeIndex = command.steps.findIndex(step => step.op === 'composeDocument')
  const destination = command.steps[destinationIndex]
  const compose = command.steps[composeIndex]
  if (destination?.op !== 'resolveDestination' || compose?.op !== 'composeDocument') return
  const captures = command.steps.some(step => step.op === 'capturePassage')
  const policyPath = pointer(at(destinationIndex), 'policy')
  if (destination.policy === 'associatedWithSource' && !captures) add(report, 'missingStep', policyPath, 'associatedWithSource needs a capturePassage step first.')
  // A capture is association evidence; format 1 defines no meaning for it in other notes.
  if (destination.policy !== 'associatedWithSource' && captures) {
    add(report, 'notAllowed', policyPath, 'A captured passage can only go to the note associated with its source; use associatedWithSource.')
  }
  const creates = destination.policy !== 'chosenExistingDocument'
  if (creates && compose.title === null) add(report, 'missingField', pointer(at(composeIndex), 'title'), 'A recipe that can create a note needs a title.')
  if (!creates && compose.title !== null) add(report, 'notAllowed', pointer(at(composeIndex), 'title'), 'Adding to an existing page uses no title; remove it.')
}

/** Each check runs only when the ones before it found nothing, so one mistake gives one diagnostic. */
function checkCommand(report: Report, command: ExtensionCommand, path: string) {
  for (const check of [checkPipeline, checkDestination, checkReferences]) {
    const before = report.count
    check(report, command, path)
    if (report.count > before) return
  }
}

const WRITES: Record<DestinationPolicy, readonly Capability[]> = {
  newInChosenFolder: ['document.create'],
  chosenExistingDocument: ['document.append'],
  associatedWithSource: ['document.create', 'document.append'],
}

/** What a valid command's steps use, in CAPABILITIES order. */
export function commandCapabilities(command: ExtensionCommand): Capability[] {
  const needs = new Set<Capability>()
  const destination = command.steps.find(step => step.op === 'resolveDestination')
  for (const step of command.steps) {
    if (step.op === 'capturePassage') needs.add('selection.read')
    if (step.op === 'resolveDestination' && step.policy === 'associatedWithSource') needs.add('association.resolve')
    if (step.op === 'proposeDocument' && destination?.op === 'resolveDestination') for (const write of WRITES[destination.policy]) needs.add(write)
    if (step.op === 'openCommittedResult') needs.add('document.open')
  }
  return CAPABILITIES.filter(capability => needs.has(capability))
}

function checkCapabilities(report: Report, declared: readonly Capability[], commands: readonly ExtensionCommand[]) {
  const used = new Set(commands.flatMap(commandCapabilities))
  const undeclared = CAPABILITIES.filter(capability => used.has(capability) && !declared.includes(capability))
  if (undeclared.length > 0) add(report, 'undeclaredCapability', '/capabilities', `The commands use ${undeclared.join(', ')}; add it to capabilities.`)
  declared.forEach((capability, index) => {
    if (!used.has(capability)) add(report, 'unusedCapability', pointer('/capabilities', index), `No command uses ${capability}; remove it from capabilities.`)
  })
}

// --- Package --------------------------------------------------------------------------------------

const PACKAGE_SPEC = spec(['schema', 'id', 'version', 'name', 'description', 'capabilities', 'commands'])

function capabilitiesAt(report: Report, value: unknown): Capability[] {
  const declared = list(report, value, '/capabilities', 'Capabilities', CAPABILITIES.length)
    .map((item, index) => oneOf(report, item, pointer('/capabilities', index), CAPABILITIES, 'unknownCapability', 'A capability'))
  declared.forEach((capability, index) => {
    if (capability !== null && declared.indexOf(capability) < index) add(report, 'duplicateId', pointer('/capabilities', index), `${capability} is listed more than once.`)
  })
  return declared.filter(notNull)
}

function commandAt(report: Report, value: unknown, path: string): ExtensionCommand {
  const before = report.count
  const fields = objectAt(report, value, path, 'A command', spec(['id', 'title', 'steps']))
  const id = idAt(report, own(fields, 'id'), pointer(path, 'id'), 'A command id')
  const title = textAt(report, own(fields, 'title'), pointer(path, 'title'), 'A command title', LIMITS.labelBytes)
  const stepsPath = pointer(path, 'steps')
  const steps = list(report, own(fields, 'steps'), stepsPath, 'Steps', LIMITS.steps).map((item, index) => stepAt(report, item, pointer(stepsPath, index)))
  uniqueIds(report, steps, stepsPath, 'Step id')
  const command = { id, title, steps: steps.filter(notNull) }
  if (report.count === before) checkCommand(report, command, path)
  return command
}

function packageAt(report: Report, value: unknown): ExtensionPackage | null {
  if (!isFields(value)) {
    add(report, 'wrongType', '', 'The package must be a JSON object.')
    return null
  }
  const schema = own(value, 'schema')
  if (schema !== EXTENSION_SCHEMA) {
    if (schema === undefined) add(report, 'missingField', '/schema', `The package needs "schema": "${EXTENSION_SCHEMA}".`)
    else add(report, 'unsupportedSchema', '/schema', `This version of LeadingLight reads only "${EXTENSION_SCHEMA}" packages.`)
    return null
  }
  checkKeys(report, value, '', 'The package', PACKAGE_SPEC)
  const id = matching(report, own(value, 'id'), '/id', 'The package id', PACKAGE_ID,
    `must be two or more dot-separated parts of lowercase letters, digits and hyphens, such as "local.meeting-debrief", at most ${LIMITS.packageIdChars} characters.`, LIMITS.packageIdChars)
  const version = matching(report, own(value, 'version'), '/version', 'The version', VERSION, 'must have the form 1.0.0.', 20)
  const name = textAt(report, own(value, 'name'), '/name', 'The name', LIMITS.labelBytes)
  const description = textAt(report, own(value, 'description'), '/description', 'The description', LIMITS.descriptionBytes)
  const capabilities = capabilitiesAt(report, own(value, 'capabilities'))
  const commands = list(report, own(value, 'commands'), '/commands', 'Commands', LIMITS.commands).map((item, index) => commandAt(report, item, pointer('/commands', index)))
  uniqueIds(report, commands, '/commands', 'Command id')
  if (report.count > 0) return null
  checkCapabilities(report, capabilities, commands)
  return { schema: EXTENSION_SCHEMA, id, version, name, description, capabilities: CAPABILITIES.filter(item => capabilities.includes(item)), commands }
}

// --- Entry ----------------------------------------------------------------------------------------

const validated = new WeakSet<object>()

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

/** True only for a package this module produced; copies and hand-made objects are refused. */
export function isValidatedPackage(value: unknown): value is ExtensionPackage {
  return typeof value === 'object' && value !== null && validated.has(value)
}

/**
 * Validates package text. Stops after the first stage that finds a problem: reading the text,
 * then shape, then meaning. Diagnostics are capped; `truncated` says more were found.
 */
export function parseExtensionPackage(text: string): PackageValidation {
  const report: Report = { list: [], count: 0 }
  if (typeof text !== 'string') add(report, 'wrongType', '', 'The package must be text.')
  const value = report.count === 0 ? readJson(report, text) : undefined
  const extension = report.count === 0 ? packageAt(report, value) : null
  if (extension && report.count === 0) {
    validated.add(deepFreeze(extension))
    return { status: 'valid', extension }
  }
  return { status: 'invalid', diagnostics: report.list, truncated: report.count > report.list.length }
}
