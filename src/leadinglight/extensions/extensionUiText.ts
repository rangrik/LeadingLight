// Sentences the host writes about a package, from the validator's review facts rather than from
// package prose. Package names, labels and titles are shown only as plain text beside these.
import { translate, type AppLocale, type TranslationKey, type TranslationValues } from '../../lib/i18n'
import type { ActivationRefusal } from './extensionApi'
import {
  CAPABILITIES,
  type Capability, type CommandReview, type ExtensionCommand, type FormAnswers, type InputProblemCode, type PackageReview,
} from './extensionContract'
import type { NotWrittenReason, PackageView } from './extensionSessionController'

export type T = (key: TranslationKey, values?: TranslationValues) => string
export const translator = (locale: AppLocale): T => (key, values) => translate(locale, key, values)

const CAPABILITY_KEYS: Record<Capability, TranslationKey> = {
  'selection.read': 'leadinglight.extensions.capability.selection.read',
  'association.resolve': 'leadinglight.extensions.capability.association.resolve',
  'document.create': 'leadinglight.extensions.capability.document.create',
  'document.append': 'leadinglight.extensions.capability.document.append',
  'document.open': 'leadinglight.extensions.capability.document.open',
}

const WRITE_KEYS: Record<CommandReview['write'], TranslationKey> = {
  createInChosenFolder: 'leadinglight.extensions.does.create',
  appendToChosenDocument: 'leadinglight.extensions.does.append',
  createOrAppendAssociated: 'leadinglight.extensions.does.associated',
}

function questionsSentence(t: T, count: number): string {
  if (count === 0) return t('leadinglight.extensions.does.questions.zero')
  return count === 1 ? t('leadinglight.extensions.does.questions.one') : t('leadinglight.extensions.does.questions.many', { count })
}

/** What one command does, in the order a run happens. */
export function commandSentences(t: T, review: CommandReview): string[] {
  return [
    ...(review.placement === 'selectionAction' ? [t('leadinglight.extensions.does.selection')] : []),
    questionsSentence(t, review.questions),
    t(WRITE_KEYS[review.write]),
    ...(review.opensResult ? [t('leadinglight.extensions.does.open')] : []),
  ]
}

/** "Needs: …" for capabilities this host does not perform, or null when it performs them all. */
export function missingSentence(t: T, locale: AppLocale, missing: readonly Capability[]): string | null {
  if (missing.length === 0) return null
  const phrases = CAPABILITIES.filter(capability => missing.includes(capability)).map(capability => t(CAPABILITY_KEYS[capability]))
  return t('leadinglight.extensions.needs', { list: new Intl.ListFormat(locale, { type: 'conjunction' }).format(phrases) })
}

const reviewLines = (t: T, review: PackageReview) =>
  review.commands.flatMap(command => commandSentences(t, command).map(sentence => `${command.title}: ${sentence}`))

/** Behaviour sentences that differ between the version on now and the one under review. */
export function changedSentences(t: T, before: PackageReview, after: PackageReview): string[] {
  const old = reviewLines(t, before)
  const next = reviewLines(t, after)
  return [
    ...next.filter(line => !old.includes(line)).map(sentence => t('leadinglight.extensions.added', { sentence })),
    ...old.filter(line => !next.includes(line)).map(sentence => t('leadinglight.extensions.removed', { sentence })),
  ]
}

export type Chip = 'on' | 'off' | 'notYet' | 'unavailable' | 'unreadable'

const CHIP_KEYS: Record<Chip, TranslationKey> = {
  on: 'leadinglight.extensions.chip.on',
  off: 'leadinglight.extensions.chip.off',
  notYet: 'leadinglight.extensions.chip.notYet',
  unavailable: 'leadinglight.extensions.chip.unavailable',
  unreadable: 'leadinglight.extensions.chip.unreadable',
}
export const chipText = (t: T, chip: Chip) => t(CHIP_KEYS[chip])

/** The status a row shows, as text: on, off, never turned on, or unusable here and why. */
export function chipFor(view: PackageView): Chip {
  if (view.activeSha256 !== null) {
    if (view.active?.status !== 'ready') return 'unreadable'
    return view.active.review.activation === 'available' ? 'on' : 'unavailable'
  }
  const load = view.candidate?.load
  if (!load || load.status !== 'ready') return 'unreadable'
  if (load.review.activation !== 'available') return 'unavailable'
  return view.bundled || view.previousSha256 !== null ? 'off' : 'notYet'
}

const CHANGE_KEYS: Record<ActivationRefusal | 'noReply', TranslationKey> = {
  changed: 'leadinglight.extensions.change.changed',
  unreadable: 'leadinglight.extensions.change.unreadable',
  invalid: 'leadinglight.extensions.change.invalid',
  missingCapabilities: 'leadinglight.extensions.change.missingCapabilities',
  reservedId: 'leadinglight.extensions.change.reservedId',
  unknownVersion: 'leadinglight.extensions.change.unknownVersion',
  vaultUnavailable: 'leadinglight.extensions.change.vaultUnavailable',
  noReply: 'leadinglight.extensions.change.noReply',
}
export const changeRefusalText = (t: T, reason: ActivationRefusal | 'noReply', name: string) => t(CHANGE_KEYS[reason], { name })

const NOT_WRITTEN_KEYS: Record<Exclude<NotWrittenReason, 'exists'>, TranslationKey> = {
  storage: 'leadinglight.extensions.notWritten.storage',
  invalidName: 'leadinglight.extensions.notWritten.invalidName',
  tooLarge: 'leadinglight.extensions.notWritten.tooLarge',
  link: 'leadinglight.extensions.notWritten.link',
  folderMissing: 'leadinglight.extensions.notWritten.folderMissing',
  busy: 'leadinglight.extensions.notWritten.busy',
  notStarted: 'leadinglight.extensions.notWritten.notStarted',
  unavailable: 'leadinglight.extensions.notWritten.unavailable',
  unsafeText: 'leadinglight.extensions.notWritten.unsafeText',
  internal: 'leadinglight.extensions.notWritten.internal',
  changed: 'leadinglight.extensions.notWritten.changed',
  unsafeTail: 'leadinglight.extensions.notWritten.unsafeTail',
  notAssociated: 'leadinglight.extensions.notWritten.notAssociated',
}
export const notWrittenText = (t: T, reason: Exclude<NotWrittenReason, 'exists'>) => t(NOT_WRITTEN_KEYS[reason])

export type FieldProblem = Extract<InputProblemCode, 'required' | 'tooLong' | 'notSingleLine' | 'invalidAnswer'> | 'unsafeText'
const PROBLEM_KEYS: Record<FieldProblem, TranslationKey> = {
  required: 'leadinglight.extensions.problem.required',
  tooLong: 'leadinglight.extensions.problem.tooLong',
  notSingleLine: 'leadinglight.extensions.problem.notSingleLine',
  invalidAnswer: 'leadinglight.extensions.problem.invalidAnswer',
  unsafeText: 'leadinglight.extensions.problem.unsafeText',
}
export const problemText = (t: T, problem: FieldProblem) => t(PROBLEM_KEYS[problem])
export const isFieldProblem = (code: string): code is FieldProblem => Object.hasOwn(PROBLEM_KEYS, code)

/** A diagnostic's own JSON Pointer, exactly as the validator reported it; '' is the whole package. */
export const diagnosticLocation = (t: T, path: string) => t('leadinglight.extensions.invalidAt', { path: path || t('leadinglight.extensions.wholePackage') })

/** Synthetic answers that fill every field, so a preview shows every block a run can produce. */
export function sampleAnswers(t: T, command: ExtensionCommand): FormAnswers {
  const form = command.steps.find(step => step.op === 'collectForm')
  if (form?.op !== 'collectForm') return {}
  return Object.fromEntries(form.fields.map(field => {
    switch (field.kind) {
      case 'boolean': return [field.id, true]
      case 'choice': return [field.id, field.options[0]?.id ?? null]
      case 'multilineText': return [field.id, t('leadinglight.extensions.sampleLines')]
      case 'text': return [field.id, t('leadinglight.extensions.sampleText')]
    }
  }))
}
