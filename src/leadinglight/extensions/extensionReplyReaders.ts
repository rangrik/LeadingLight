// Strict readers for the registry replies extensionApi.ts does not read itself (sessions,
// admission, end and close are read there; proposals in proposalContract.ts). Each reply must have
// exactly the documented keys and bounded values; anything else is no reply, never an outcome.
import { PROPOSAL_LIMITS, isOpaqueToken } from '../proposals/proposalContract'
import {
  ACTIVATION_REFUSALS, HANDLE_REFUSALS,
  type ActivateArgs, type ActivationRefusal, type ActivationReply, type DeactivationReply, type DocumentHandleReply,
  type ExtensionListReply, type FolderHandleReply, type HandleRefusal, type ImportCandidateReply, type InstalledExtension,
  type ReadExtensionReply, type StoredVersion,
} from './extensionApi'
import {
  CAPABILITIES, DIAGNOSTIC_CODES, EXTENSION_LIMITS,
  type Capability, type DiagnosticCode, type ExtensionDiagnostic,
} from './extensionContract'
import { utf8Bytes } from './extensionSchema'

/** Bounds on what the UI accepts; a larger reply is malformed rather than truncated. */
export const READER_LIMITS = {
  extensions: 256,
  versionsPerExtension: 64,
  diagnosticPathChars: 2048,
  diagnosticMessageChars: 2000,
  revokedRuns: 1_000_000,
} as const

type Fields = Record<string, unknown>
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value)
const has = (value: Fields, key: string): unknown => (Object.hasOwn(value, key) ? value[key] : undefined)
const hasKeys = (value: Fields, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const isOneOf = <T extends string>(options: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (options as readonly string[]).includes(value)

const SHA256 = /^[0-9a-f]{64}$/
export const isSha256 = (value: unknown): value is string => typeof value === 'string' && SHA256.test(value)
const isShaOrNull = (value: unknown): value is string | null => value === null || isSha256(value)
const isCount = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max

const PACKAGE_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/
const VERSION = /^(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})$/
const isPackageId = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= EXTENSION_LIMITS.packageIdChars && PACKAGE_ID.test(value)
const isVersion = (value: unknown): value is string => typeof value === 'string' && value.length <= 20 && VERSION.test(value)

/** Controls, line breaks, direction overrides and lone surrogates; the same set package text refuses. */
function isPlainLine(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) as number
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029
      || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) || (code >= 0xd800 && code <= 0xdfff)) return false
  }
  return true
}
const isLabel = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '' && utf8Bytes(value) <= EXTENSION_LIMITS.labelBytes && isPlainLine(value)

/** Distinct known capabilities, in any order; the UI shows them in CAPABILITIES order. */
function capabilities(value: unknown): Capability[] | null {
  if (!Array.isArray(value) || value.length > CAPABILITIES.length) return null
  if (!value.every(item => isOneOf(CAPABILITIES, item)) || new Set(value).size !== value.length) return null
  return CAPABILITIES.filter(capability => value.includes(capability))
}

function diagnostic(value: unknown): ExtensionDiagnostic | null {
  if (!isFields(value) || !hasKeys(value, ['code', 'path', 'message'])) return null
  const { code, path, message } = value
  if (!isOneOf<DiagnosticCode>(DIAGNOSTIC_CODES, code)) return null
  if (typeof path !== 'string' || path.length > READER_LIMITS.diagnosticPathChars || (path !== '' && !path.startsWith('/'))) return null
  if (typeof message !== 'string' || message.trim() === '' || message.length > READER_LIMITS.diagnosticMessageChars) return null
  return { code, path, message }
}

export function parseImportCandidateReply(value: unknown): ImportCandidateReply | null {
  if (!isFields(value)) return null
  switch (has(value, 'status')) {
    case 'candidate': {
      if (!hasKeys(value, ['status', 'packageSha256', 'packageId', 'version', 'missingCapabilities'])) return null
      const { packageSha256, packageId, version } = value
      const missing = capabilities(has(value, 'missingCapabilities'))
      if (!isSha256(packageSha256) || !isPackageId(packageId) || !isVersion(version) || !missing) return null
      return { status: 'candidate', packageSha256, packageId, version, missingCapabilities: missing }
    }
    case 'invalid': {
      const list = has(value, 'diagnostics')
      if (!hasKeys(value, ['status', 'diagnostics']) || !Array.isArray(list)) return null
      if (list.length === 0 || list.length > EXTENSION_LIMITS.diagnostics) return null
      const diagnostics = list.map(diagnostic)
      return diagnostics.every(item => item !== null) ? { status: 'invalid', diagnostics: diagnostics as ExtensionDiagnostic[] } : null
    }
    case 'refused': {
      const reason = has(value, 'reason')
      return hasKeys(value, ['status', 'reason']) && (reason === 'reservedId' || reason === 'storageUnavailable') ? { status: 'refused', reason } : null
    }
    default:
      return null
  }
}

function storedVersion(value: unknown): StoredVersion | null {
  if (!isFields(value) || !hasKeys(value, ['packageSha256', 'version', 'readable'])) return null
  const { packageSha256, version, readable } = value
  return isSha256(packageSha256) && isVersion(version) && typeof readable === 'boolean' ? { packageSha256, version, readable } : null
}

function installed(value: unknown): InstalledExtension | null {
  if (!isFields(value) || !hasKeys(value, ['packageId', 'name', 'versions', 'activeSha256', 'previousSha256'])) return null
  const { packageId, name, versions: list, activeSha256, previousSha256 } = value
  if (!isPackageId(packageId) || !isLabel(name) || !Array.isArray(list)) return null
  if (list.length === 0 || list.length > READER_LIMITS.versionsPerExtension) return null
  const versions = list.map(storedVersion)
  if (!versions.every(item => item !== null)) return null
  const hashes = new Set(versions.map(item => item!.packageSha256))
  if (hashes.size !== versions.length || !isShaOrNull(activeSha256) || !isShaOrNull(previousSha256)) return null
  // Both point at stored versions; a pointer to bytes the list does not hold is no answer.
  if ((activeSha256 !== null && !hashes.has(activeSha256)) || (previousSha256 !== null && !hashes.has(previousSha256))) return null
  return { packageId, name, versions: versions as StoredVersion[], activeSha256, previousSha256 }
}

export function parseExtensionListReply(value: unknown): ExtensionListReply | null {
  if (!isFields(value)) return null
  if (has(value, 'status') === 'refused') {
    return hasKeys(value, ['status', 'reason']) && has(value, 'reason') === 'vaultUnavailable' ? { status: 'refused', reason: 'vaultUnavailable' } : null
  }
  const list = has(value, 'extensions')
  if (has(value, 'status') !== 'ok' || !hasKeys(value, ['status', 'extensions']) || !Array.isArray(list)) return null
  if (list.length > READER_LIMITS.extensions) return null
  const extensions = list.map(installed)
  if (!extensions.every(item => item !== null)) return null
  if (new Set(extensions.map(item => item!.packageId)).size !== extensions.length) return null
  return { status: 'ok', extensions: extensions as InstalledExtension[] }
}

export function parseReadExtensionReply(value: unknown): ReadExtensionReply | null {
  if (!isFields(value)) return null
  const status = has(value, 'status')
  if (status === 'unreadable' || status === 'unknown') return hasKeys(value, ['status']) ? { status } : null
  const text = has(value, 'packageText')
  if (status !== 'ok' || !hasKeys(value, ['status', 'packageText']) || typeof text !== 'string') return null
  return utf8Bytes(text) <= EXTENSION_LIMITS.packageBytes ? { status: 'ok', packageText: text } : null
}

/** An activation must name the version that was asked for. */
export function parseActivationReply(value: unknown, args: Pick<ActivateArgs, 'packageSha256'>): ActivationReply | null {
  if (!isFields(value)) return null
  if (has(value, 'status') === 'refused') {
    const reason = has(value, 'reason')
    const missing = capabilities(has(value, 'missingCapabilities'))
    return hasKeys(value, ['status', 'reason', 'missingCapabilities']) && isOneOf<ActivationRefusal>(ACTIVATION_REFUSALS, reason) && missing
      ? { status: 'refused', reason, missingCapabilities: missing }
      : null
  }
  if (has(value, 'status') !== 'active' || !hasKeys(value, ['status', 'packageSha256', 'previousSha256', 'revokedRuns'])) return null
  const { packageSha256, previousSha256, revokedRuns } = value
  if (packageSha256 !== args.packageSha256 || !isSha256(packageSha256) || !isShaOrNull(previousSha256)) return null
  return isCount(revokedRuns, READER_LIMITS.revokedRuns) ? { status: 'active', packageSha256, previousSha256, revokedRuns } : null
}

export function parseDeactivationReply(value: unknown): DeactivationReply | null {
  if (!isFields(value)) return null
  if (has(value, 'status') === 'refused') {
    const reason = has(value, 'reason')
    return hasKeys(value, ['status', 'reason']) && (reason === 'changed' || reason === 'vaultUnavailable') ? { status: 'refused', reason } : null
  }
  const revokedRuns = has(value, 'revokedRuns')
  return has(value, 'status') === 'inactive' && hasKeys(value, ['status', 'revokedRuns']) && isCount(revokedRuns, READER_LIMITS.revokedRuns)
    ? { status: 'inactive', revokedRuns }
    : null
}

const isDisplayPath = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= PROPOSAL_LIMITS.pathChars && isPlainLine(value)

function handleRefusal(value: Fields): { status: 'refused'; reason: HandleRefusal } | null {
  const reason = has(value, 'reason')
  return hasKeys(value, ['status', 'reason']) && isOneOf<HandleRefusal>(HANDLE_REFUSALS, reason) ? { status: 'refused', reason } : null
}

export function parseFolderHandleReply(value: unknown): FolderHandleReply | null {
  if (!isFields(value)) return null
  if (has(value, 'status') === 'refused') return handleRefusal(value)
  if (has(value, 'status') !== 'bound' || !hasKeys(value, ['status', 'folderHandle', 'displayPath'])) return null
  const { folderHandle, displayPath } = value
  return isOpaqueToken(folderHandle) && isDisplayPath(displayPath) ? { status: 'bound', folderHandle, displayPath } : null
}

export function parseDocumentHandleReply(value: unknown): DocumentHandleReply | null {
  if (!isFields(value)) return null
  if (has(value, 'status') === 'refused') return handleRefusal(value)
  if (has(value, 'status') !== 'bound' || !hasKeys(value, ['status', 'documentHandle', 'displayPath', 'contentSha256'])) return null
  const { documentHandle, displayPath, contentSha256 } = value
  return isOpaqueToken(documentHandle) && isDisplayPath(displayPath) && isSha256(contentSha256)
    ? { status: 'bound', documentHandle, displayPath, contentSha256 }
    : null
}
