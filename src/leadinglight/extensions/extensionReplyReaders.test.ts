import { describe, expect, it } from 'vitest'
import {
  READER_LIMITS, parseActivationReply, parseDeactivationReply, parseDocumentHandleReply, parseExtensionListReply,
  parseFolderHandleReply, parseImportCandidateReply, parseReadExtensionReply,
} from './extensionReplyReaders'

const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const version = (packageSha256: string, label = '1.0.0', readable = true) => ({ packageSha256, version: label, readable })
const installed = (overrides: Record<string, unknown> = {}) => ({
  packageId: 'local.meeting-debrief', name: 'Meeting debrief', versions: [version(SHA_B, '2.0.0'), version(SHA_A)],
  activeSha256: SHA_A, previousSha256: null, ...overrides,
})

describe('import candidate replies', () => {
  it('reads each documented answer exactly', () => {
    expect(parseImportCandidateReply({ status: 'candidate', packageSha256: SHA_A, packageId: 'local.x', version: '1.2.3', missingCapabilities: ['selection.read'] }))
      .toEqual({ status: 'candidate', packageSha256: SHA_A, packageId: 'local.x', version: '1.2.3', missingCapabilities: ['selection.read'] })
    expect(parseImportCandidateReply({ status: 'invalid', diagnostics: [{ code: 'unknownField', path: '/commands/0/x', message: 'Remove x.' }] }))
      .toEqual({ status: 'invalid', diagnostics: [{ code: 'unknownField', path: '/commands/0/x', message: 'Remove x.' }] })
    expect(parseImportCandidateReply({ status: 'refused', reason: 'reservedId' })).toEqual({ status: 'refused', reason: 'reservedId' })
  })

  it('orders capabilities as the contract lists them and refuses repeats or unknown ones', () => {
    const reply = (missingCapabilities: unknown) => parseImportCandidateReply({ status: 'candidate', packageSha256: SHA_A, packageId: 'local.x', version: '1.0.0', missingCapabilities })
    expect(reply(['document.append', 'selection.read'])).toMatchObject({ missingCapabilities: ['selection.read', 'document.append'] })
    expect(reply(['selection.read', 'selection.read'])).toBeNull()
    expect(reply(['network.fetch'])).toBeNull()
    expect(reply('selection.read')).toBeNull()
  })

  it('treats extra, missing or malformed fields as no reply', () => {
    for (const value of [
      null, 'candidate', [], { status: 'candidate' },
      { status: 'candidate', packageSha256: SHA_A, packageId: 'local.x', version: '1.0.0', missingCapabilities: [], extra: true },
      { status: 'candidate', packageSha256: 'A'.repeat(64), packageId: 'local.x', version: '1.0.0', missingCapabilities: [] },
      { status: 'candidate', packageSha256: SHA_A, packageId: 'NoDots', version: '1.0.0', missingCapabilities: [] },
      { status: 'candidate', packageSha256: SHA_A, packageId: 'local.x', version: '1.0', missingCapabilities: [] },
      { status: 'invalid', diagnostics: [] },
      { status: 'invalid', diagnostics: [{ code: 'madeUp', path: '', message: 'x' }] },
      { status: 'invalid', diagnostics: [{ code: 'tooLarge', path: 'no-slash', message: 'x' }] },
      { status: 'invalid', diagnostics: [{ code: 'tooLarge', path: '', message: 'x', line: 12 }] },
      { status: 'invalid', diagnostics: Array.from({ length: 33 }, () => ({ code: 'tooLarge', path: '', message: 'x' })) },
      { status: 'refused', reason: 'quota' },
      { status: 'refused', reason: 'reservedId', detail: '' },
    ]) expect(parseImportCandidateReply(value)).toBeNull()
  })
})

describe('extension list replies', () => {
  it('reads installed packages and their stored versions', () => {
    expect(parseExtensionListReply({ status: 'ok', extensions: [installed()] })).toEqual({ status: 'ok', extensions: [installed()] })
    expect(parseExtensionListReply({ status: 'ok', extensions: [] })).toEqual({ status: 'ok', extensions: [] })
    expect(parseExtensionListReply({ status: 'refused', reason: 'vaultUnavailable' })).toEqual({ status: 'refused', reason: 'vaultUnavailable' })
  })

  it('refuses pointers to versions the list does not hold, repeats and unsafe names', () => {
    const list = (...extensions: unknown[]) => parseExtensionListReply({ status: 'ok', extensions })
    expect(list(installed({ activeSha256: 'c'.repeat(64) }))).toBeNull()
    expect(list(installed({ previousSha256: 'c'.repeat(64) }))).toBeNull()
    expect(list(installed({ versions: [version(SHA_A), version(SHA_A, '1.0.1')] }))).toBeNull()
    expect(list(installed({ versions: [] }))).toBeNull()
    expect(list(installed(), installed())).toBeNull()
    expect(list(installed({ name: '' }))).toBeNull()
    expect(list(installed({ name: `Line${String.fromCharCode(10)}break` }))).toBeNull()
    expect(list(installed({ name: `Over${String.fromCharCode(0x202e)}ride` }))).toBeNull()
    expect(list(installed({ versions: [{ ...version(SHA_A), readable: 'yes' }] }))).toBeNull()
    expect(list(installed({ owner: 'other' }))).toBeNull()
    expect(list(installed({ versions: Array.from({ length: READER_LIMITS.versionsPerExtension + 1 }, (_, index) => version(index.toString(16).padStart(64, '0'))), activeSha256: null }))).toBeNull()
    expect(parseExtensionListReply({ status: 'ok', extensions: [], more: true })).toBeNull()
    expect(parseExtensionListReply({ status: 'refused', reason: 'vaultUnavailable', path: '/x' })).toBeNull()
  })
})

describe('package reads', () => {
  it('reads the stored text or an explicit unreadable answer', () => {
    expect(parseReadExtensionReply({ status: 'ok', packageText: '{}' })).toEqual({ status: 'ok', packageText: '{}' })
    expect(parseReadExtensionReply({ status: 'unknown' })).toEqual({ status: 'unknown' })
    expect(parseReadExtensionReply({ status: 'unreadable' })).toEqual({ status: 'unreadable' })
  })

  it('refuses oversize text and stray fields', () => {
    expect(parseReadExtensionReply({ status: 'ok', packageText: 'x'.repeat(128 * 1024 + 1) })).toBeNull()
    expect(parseReadExtensionReply({ status: 'ok', packageText: 4 })).toBeNull()
    expect(parseReadExtensionReply({ status: 'unknown', packageText: '' })).toBeNull()
  })
})

describe('activation replies', () => {
  const args = { packageSha256: SHA_B }

  it('accepts only an answer for the version asked for', () => {
    expect(parseActivationReply({ status: 'active', packageSha256: SHA_B, previousSha256: SHA_A, revokedRuns: 1 }, args))
      .toEqual({ status: 'active', packageSha256: SHA_B, previousSha256: SHA_A, revokedRuns: 1 })
    expect(parseActivationReply({ status: 'active', packageSha256: SHA_A, previousSha256: null, revokedRuns: 0 }, args)).toBeNull()
  })

  it('reads every documented refusal and nothing else', () => {
    expect(parseActivationReply({ status: 'refused', reason: 'changed', missingCapabilities: [] }, args)).toEqual({ status: 'refused', reason: 'changed', missingCapabilities: [] })
    expect(parseActivationReply({ status: 'refused', reason: 'missingCapabilities', missingCapabilities: ['document.append'] }, args))
      .toEqual({ status: 'refused', reason: 'missingCapabilities', missingCapabilities: ['document.append'] })
    expect(parseActivationReply({ status: 'refused', reason: 'permission', missingCapabilities: [] }, args)).toBeNull()
    expect(parseActivationReply({ status: 'refused', reason: 'changed' }, args)).toBeNull()
    expect(parseActivationReply({ status: 'active', packageSha256: SHA_B, previousSha256: null, revokedRuns: -1 }, args)).toBeNull()
    expect(parseActivationReply({ status: 'active', packageSha256: SHA_B, previousSha256: null, revokedRuns: 1.5 }, args)).toBeNull()
  })

  it('reads deactivation exactly', () => {
    expect(parseDeactivationReply({ status: 'inactive', revokedRuns: 0 })).toEqual({ status: 'inactive', revokedRuns: 0 })
    expect(parseDeactivationReply({ status: 'refused', reason: 'changed' })).toEqual({ status: 'refused', reason: 'changed' })
    expect(parseDeactivationReply({ status: 'inactive' })).toBeNull()
    expect(parseDeactivationReply({ status: 'refused', reason: 'missingCapabilities' })).toBeNull()
  })
})

describe('handle replies', () => {
  it('reads folder handles and refusals', () => {
    expect(parseFolderHandleReply({ status: 'bound', folderHandle: 'fh:1', displayPath: 'Meetings' })).toEqual({ status: 'bound', folderHandle: 'fh:1', displayPath: 'Meetings' })
    expect(parseFolderHandleReply({ status: 'bound', folderHandle: 'fh:1', displayPath: '' })).toEqual({ status: 'bound', folderHandle: 'fh:1', displayPath: '' })
    expect(parseFolderHandleReply({ status: 'refused', reason: 'link' })).toEqual({ status: 'refused', reason: 'link' })
  })

  it('refuses handles that are not opaque tokens or paths with line breaks', () => {
    expect(parseFolderHandleReply({ status: 'bound', folderHandle: '../x', displayPath: 'x' })).toBeNull()
    expect(parseFolderHandleReply({ status: 'bound', folderHandle: 'fh', displayPath: `a${String.fromCharCode(10)}b` })).toBeNull()
    expect(parseFolderHandleReply({ status: 'refused', reason: 'denied' })).toBeNull()
    expect(parseDocumentHandleReply({ status: 'bound', documentHandle: 'dh', displayPath: 'a.md', contentSha256: SHA_A }))
      .toEqual({ status: 'bound', documentHandle: 'dh', displayPath: 'a.md', contentSha256: SHA_A })
    expect(parseDocumentHandleReply({ status: 'bound', documentHandle: 'dh', displayPath: 'a.md' })).toBeNull()
    expect(parseDocumentHandleReply({ status: 'refused', reason: 'unsupported' })).toEqual({ status: 'refused', reason: 'unsupported' })
  })
})
