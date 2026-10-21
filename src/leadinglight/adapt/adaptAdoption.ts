// What became of one reply's candidate in this window, through E1 only: stored by E1 import, shown
// in the E1 preview, turned on by its single Turn on (compare-and-set), tried through the E1 form, and
// undone by turning the version before back on, or off. Notes made with it are never touched.
import type { ChangeOutcome, ImportOutcome } from '../extensions/extensionSessionController'
import { changeRefusalText, type T } from '../extensions/extensionUiText'
import type { PreviewEnding } from '../extensions/useExtensionUi'

export type Adoption =
  /** E1 is storing it, or a version change is on its way. */
  | { readonly status: 'working' }
  | { readonly status: 'kept'; readonly available: boolean }
  | { readonly status: 'notTurnedOn' }
  | { readonly status: 'refused'; readonly text: string }
  | {
    readonly status: 'on'
    /** The E1 visit it was turned on in; Undo and Try it act only in that same visit. */
    readonly scope: number
    readonly packageId: string
    readonly name: string
    readonly sha256: string
    /** The version on before; Undo turns it back on, or turns this one off when there was none. */
    readonly previous: string | null
    readonly tryKey: string | null
    /** Where Try it put a note, for the person to look. */
    readonly made: string | null
    readonly undoing: boolean
    readonly problem: string | null
  }
  | { readonly status: 'undone'; readonly text: string }

export type Stored = Extract<ImportOutcome, { status: 'candidate' }>

/** Why E1 did not store the exact package text, in E1's terms. */
export function storeRefusal(t: T, outcome: Exclude<ImportOutcome, Stored>): string {
  if (outcome.status === 'invalid') return t('leadinglight.adapt.invalid')
  if (outcome.status === 'refused' && outcome.reason === 'reservedId') return t('leadinglight.adapt.identity.reservedId')
  return t('leadinglight.adapt.storeRefused')
}

const refusalText = (t: T, outcome: Exclude<ChangeOutcome, { status: 'done' }>, name: string, changed: string) =>
  outcome.status === 'refused' && outcome.reason === 'changed' ? changed : changeRefusalText(t, outcome.status === 'noReply' ? 'noReply' : outcome.reason, name)

/**
 * How the E1 preview ended. Turned on is the only way to `on`. A version that moved since the
 * request began is refused by E1's compare-and-set, and says so.
 */
export function afterPreview(t: T, ending: PreviewEnding, stored: Stored, expected: string | null, scope: number): Adoption {
  const { name, id } = stored.extension
  if (ending.turnedOn) {
    return { status: 'on', scope, packageId: id, name, sha256: stored.packageSha256, previous: expected, tryKey: ending.tryKey, made: null, undoing: false, problem: null }
  }
  if (ending.moved || !ending.outcome || ending.outcome.status === 'done') return { status: 'notTurnedOn' }
  return { status: 'refused', text: refusalText(t, ending.outcome, name, t('leadinglight.adapt.stale', { name })) }
}

/** After Undo: off, or back to the version before; refused when something else changed it first. */
export function afterUndo(t: T, on: Extract<Adoption, { status: 'on' }>, outcome: ChangeOutcome, previousVersion: string): Adoption {
  if (outcome.status === 'done') {
    return { status: 'undone', text: on.previous === null ? t('leadinglight.adapt.undoneOff', { name: on.name }) : t('leadinglight.adapt.undoneBack', { name: on.name, version: previousVersion }) }
  }
  return { ...on, undoing: false, problem: refusalText(t, outcome, on.name, t('leadinglight.adapt.undoRefused', { name: on.name })) }
}
