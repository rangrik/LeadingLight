// What a model's terminal candidate may become. The E1 validator is the authority on the package
// itself; these rules add only identity: a new request makes a new extension, a revision keeps its
// ordinary extension's id with a higher version, and a bundled extension is changed by making a
// new ordinary one. Nothing here imports, activates or writes anything.
import {
  E1_HOST_CAPABILITIES, RESERVED_PACKAGE_ID_PREFIX,
  type Capability, type ExtensionDiagnostic, type ExtensionPackage, type PackageReview,
} from '../extensions/extensionContract'
import { reviewPackage } from '../extensions/extensionRecipe'
import { parseExtensionPackage } from '../extensions/extensionSchema'
import type { RegistrySnapshot } from '../extensions/extensionSessionController'
import type { RevisionBase } from './adaptAttachments'
import type { AdaptEntry } from './adaptContract'

/**
 * `reservedId`: only bundled packages use the reserved prefix. `existingId`: a new extension would
 * silently add a version to one already stored. `differentId`: a revision must keep its
 * extension's id. `notNewer`: a revision must have a higher version than the one it revises.
 */
export type IdentityProblem = 'reservedId' | 'existingId' | 'differentId' | 'notNewer'

export type CandidateCheck =
  /** Valid, fully supported here, and identity rules met: ready for the E1 preview. */
  | { readonly status: 'ready'; readonly extension: ExtensionPackage; readonly review: PackageReview }
  /** Valid, but needs capabilities this version lacks: may be kept for later, never turned on. */
  | { readonly status: 'unavailable'; readonly extension: ExtensionPackage; readonly review: PackageReview; readonly missing: readonly Capability[] }
  | { readonly status: 'invalid'; readonly diagnostics: readonly ExtensionDiagnostic[]; readonly truncated: boolean }
  | { readonly status: 'identity'; readonly problem: IdentityProblem; readonly extension: ExtensionPackage }

/** Whole-number MAJOR.MINOR.PATCH, as the package format requires. */
export function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index]
  return 0
}

function identityProblem(extension: ExtensionPackage, base: RevisionBase | null, storedIds: ReadonlySet<string>): IdentityProblem | null {
  if (extension.id.startsWith(RESERVED_PACKAGE_ID_PREFIX)) return 'reservedId'
  if (base && !base.bundled) {
    if (extension.id !== base.packageId) return 'differentId'
    return compareVersions(extension.version, base.version) > 0 ? null : 'notNewer'
  }
  // A new extension, or a bundled one made into a new ordinary extension.
  return storedIds.has(extension.id) ? 'existingId' : null
}

/**
 * Checks the exact package text from a terminal candidate. `storedIds` are the package ids the
 * registry lists now; `base` is the attached extension the request revises, if any.
 */
export function checkCandidate(packageText: string, base: RevisionBase | null, storedIds: ReadonlySet<string>,
  host: readonly Capability[] = E1_HOST_CAPABILITIES): CandidateCheck {
  const parsed = parseExtensionPackage(packageText)
  if (parsed.status === 'invalid') return { status: 'invalid', diagnostics: parsed.diagnostics, truncated: parsed.truncated }
  const { extension } = parsed
  const problem = identityProblem(extension, base, storedIds)
  if (problem) return { status: 'identity', problem, extension }
  const review = reviewPackage(extension, host)
  if (review.activation !== 'available') return { status: 'unavailable', extension, review, missing: review.missing }
  return { status: 'ready', extension, review }
}

/** The activation a candidate's Turn on expects: the version active when the revision began. */
export const expectedActiveFor = (base: RevisionBase | null): string | null => (base && !base.bundled ? base.activeSha256 : null)

/** What a candidate becomes beside what exists: a new extension, a new version, or a copy of a bundled one. */
export type CandidateChange =
  | { readonly kind: 'new' }
  | { readonly kind: 'revision'; readonly name: string; readonly from: string }
  | { readonly kind: 'copy'; readonly of: string }

export type CandidateState =
  /** The registry is not read yet, so identity cannot be checked. */
  | { readonly status: 'waiting' }
  | { readonly status: 'checked'; readonly check: CandidateCheck; readonly change: CandidateChange; readonly expected: string | null }
  /** The version the request revised is no longer stored. */
  | { readonly status: 'baseMissing' }
  /** What is on now differs from what was on when the request was sent; it would replace that unseen. */
  | { readonly status: 'stale'; readonly name: string }
  /** This version of this extension is already stored (kept or turned on earlier). */
  | { readonly status: 'stored'; readonly name: string }

/**
 * A reply's candidate as the registry sees it now. The base is the exact version the request
 * named (its revision), looked up again here, so nothing about it is taken from the model. What
 * was on then is the request's own record (`expectedActiveSha256`, null for nothing on); it is
 * compared with what is on now and is the activation's expectation, never rebuilt from today.
 */
export function candidateFor(packageText: string, request: Extract<AdaptEntry, { kind: 'request' }> | null, registry: RegistrySnapshot): CandidateState {
  if (registry.status !== 'ready') return { status: 'waiting' }
  const { packages } = registry
  const revision = request?.revision ?? null
  let base: RevisionBase | null = null
  let now: string | null = null
  if (revision) {
    const view = packages.find(item => item.packageId === revision.packageId)
    const version = view?.versions.find(item => item.packageSha256 === revision.baseSha256)
    if (!view || !version) return { status: 'baseMissing' }
    now = view.activeSha256
    base = {
      packageId: view.packageId, name: view.name, version: version.version, sha256: version.packageSha256,
      activeSha256: revision.expectedActiveSha256, bundled: view.bundled,
    }
  }
  const check = checkCandidate(packageText, base, new Set(packages.map(item => item.packageId)))
  if (check.status !== 'invalid') {
    const { extension } = check
    if (packages.some(item => item.packageId === extension.id && item.versions.some(stored => stored.version === extension.version))) {
      return { status: 'stored', name: extension.name }
    }
  }
  if (base && now !== base.activeSha256) return { status: 'stale', name: base.name }
  // An extension attached without a revision is a bundled one: its change is a new extension.
  const copied = revision ? null : request?.attachments.find(item => item.kind === 'extension')?.label ?? null
  const change: CandidateChange = base ? { kind: 'revision', name: base.name, from: base.version } : copied ? { kind: 'copy', of: copied } : { kind: 'new' }
  return { status: 'checked', check, change, expected: expectedActiveFor(base) }
}
