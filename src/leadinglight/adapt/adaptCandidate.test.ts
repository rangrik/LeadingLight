import { describe, expect, it } from 'vitest'
import { parseExtensionPackage } from '../extensions/extensionSchema'
import meetingText from '../extensions/fixtures/meeting-debrief.json?raw'
import quickText from '../extensions/fixtures/quick-note.json?raw'
import commentaryText from '../extensions/fixtures/passage-commentary.json?raw'
import folderPathText from '../extensions/fixtures/invalid/folder-path.json?raw'
import {
  attachCurrentPage, attachExtension, attachPastedText, detach, revisionBaseOf, wireAttachments, wireRevision, type AdaptAttachment,
} from './adaptAttachments'
import type { PackageView, RegistrySnapshot } from '../extensions/extensionSessionController'
import { candidateFor, checkCandidate, compareVersions, e1Review, expectedActiveFor } from './adaptCandidate'
import { E2_HOST_CAPABILITIES } from '../extensions/extensionContract'
import { hostReview } from '../extensions/extensionSessionController'
import observationText from '../extensions/fixtures/append-observation.json?raw'
import { ADAPT_LIMITS, type AdaptAttachmentSummary, type AdaptEntry, type AdaptRevisionBase } from './adaptContract'

const SHA = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const AT = '2026-10-20T12:00:00Z'
const parse = (text: string) => {
  const parsed = parseExtensionPackage(text)
  if (parsed.status !== 'valid') throw new Error('fixture invalid')
  return parsed.extension
}
const withVersion = (text: string, version: string) => text.replace(/"version": "[^"]+"/, `"version": "${version}"`)
const withId = (text: string, id: string) => text.replace(/"id": "local\.[^"]+"/, `"id": "${id}"`)
const ok = (result: ReturnType<typeof attachPastedText>) => {
  if (result.status !== 'ok') throw new Error(result.reason)
  return result.attachments
}

describe('explicit attachments', () => {
  it('holds pasted text and the current page as labelled snapshots, never paths', () => {
    let list: readonly AdaptAttachment[] = []
    list = ok(attachPastedText(list, 'What surprised me today', 'Pasted text'))
    list = ok(attachCurrentPage(list, { title: 'Reading list', text: '# Reading list\n\n- Dune' }))
    expect(list.map(item => [item.kind, item.label, item.bytes])).toEqual([
      ['pastedText', 'Pasted text', 23], ['pageSnapshot', 'Reading list', 22],
    ])
    expect(wireAttachments(list)).toEqual([
      { kind: 'pastedText', label: 'Pasted text', text: 'What surprised me today' },
      { kind: 'pageSnapshot', label: 'Reading list', text: '# Reading list\n\n- Dune' },
    ])
  })

  it('keeps one current page and one extension, replacing an earlier one the person sees change', () => {
    let list = ok(attachCurrentPage([], { title: 'First', text: 'one' }))
    list = ok(attachCurrentPage(list, { title: 'Second', text: 'two' }))
    list = ok(attachExtension(list, parse(quickText), { sha256: SHA, activeSha256: SHA }))
    list = ok(attachExtension(list, parse(meetingText), { sha256: OTHER, activeSha256: null }))
    expect(list.map(item => item.label)).toEqual(['Second', 'Meeting debrief · 1.0.0'])
  })

  it('shortens a long title to one plain label line', () => {
    const [page] = ok(attachCurrentPage([], { title: `A\ttitle\n${'x'.repeat(200)}`, text: 'body' }))
    expect([...page.label]).toHaveLength(ADAPT_LIMITS.labelChars)
    expect(page.label.startsWith('A title x')).toBe(true)
  })

  it('refuses empty, broken, oversized and too many attachments without changing the list', () => {
    expect(attachPastedText([], '   ', 'Pasted')).toEqual({ status: 'refused', reason: 'empty' })
    expect(attachPastedText([], `half ${String.fromCharCode(0xd800)} pair`, 'Pasted')).toEqual({ status: 'refused', reason: 'unsafeText' })
    expect(attachPastedText([], 'x'.repeat(ADAPT_LIMITS.attachmentBytes + 1), 'Pasted')).toEqual({ status: 'refused', reason: 'tooLarge' })
    let list: readonly AdaptAttachment[] = []
    for (let index = 0; index < 4; index += 1) list = ok(attachPastedText(list, 'y'.repeat(ADAPT_LIMITS.attachmentBytes), `Part ${index}`))
    expect(attachPastedText(list, 'one more byte', 'Last')).toEqual({ status: 'refused', reason: 'totalTooLarge' })
    let many: readonly AdaptAttachment[] = []
    for (let index = 0; index < ADAPT_LIMITS.attachments; index += 1) many = ok(attachPastedText(many, 'z', `Part ${index}`))
    expect(attachPastedText(many, 'z', 'Too many')).toEqual({ status: 'refused', reason: 'tooMany' })
  })

  it('binds a revision to the attached version and drops it when the chip is removed', () => {
    const list = ok(attachExtension([], parse(quickText), { sha256: SHA, activeSha256: SHA }))
    expect(revisionBaseOf(list)).toEqual({ packageId: 'local.quick-note', name: 'Quick note', version: '1.0.0', sha256: SHA, activeSha256: SHA, bundled: false })
    expect(wireRevision(revisionBaseOf(list))).toEqual({ packageId: 'local.quick-note', baseSha256: SHA, expectedActiveSha256: SHA })
    const off = ok(attachExtension([], parse(quickText), { sha256: SHA, activeSha256: null }))
    expect(wireRevision(revisionBaseOf(off))).toEqual({ packageId: 'local.quick-note', baseSha256: SHA, expectedActiveSha256: null })
    expect(revisionBaseOf(detach(list, list[0].id))).toBeNull()
  })

  it('names no revision base for a bundled extension, whose change becomes a new extension', () => {
    const bundled = parse(meetingText.replace('"local.meeting-debrief"', '"leadinglight.meeting-debrief"'))
    const base = revisionBaseOf(ok(attachExtension([], bundled, { sha256: SHA, activeSha256: SHA })))
    expect(base).toMatchObject({ bundled: true })
    expect(wireRevision(base)).toBeNull()
  })
})

describe('terminal candidates', () => {
  const quickBase = { packageId: 'local.quick-note', name: 'Quick note', version: '1.0.0', sha256: SHA, activeSha256: SHA, bundled: false }
  const none = new Set<string>()

  it('readies a valid new extension with the E1 review the preview will show', () => {
    expect(checkCandidate(quickText, null, none)).toMatchObject({ status: 'ready', extension: { id: 'local.quick-note' }, review: { activation: 'available' } })
  })

  it('keeps invalid output as diagnostics, never as an extension', () => {
    expect(checkCandidate(folderPathText, null, none)).toMatchObject({ status: 'invalid', diagnostics: [{ code: 'unknownField' }] })
    expect(checkCandidate('Sure! Here is your extension: {', null, none)).toMatchObject({ status: 'invalid', diagnostics: [{ code: 'invalidJson' }] })
  })

  it('explains a valid package that needs what this version cannot do', () => {
    expect(checkCandidate(commentaryText, null, none)).toMatchObject({ status: 'unavailable', missing: ['selection.read', 'association.resolve', 'document.append'] })
  })

  it('follows the extension host it is given: passage commentary is ready where the host performs it', () => {
    const e2 = (extension: Parameters<typeof hostReview>[0]) => hostReview(extension, E2_HOST_CAPABILITIES)
    expect(checkCandidate(commentaryText, null, none, e2)).toMatchObject({ status: 'ready', review: { activation: 'available', missing: [] } })
    // Adding to a page the person picks needs a page chooser this host does not have: still unavailable.
    expect(checkCandidate(observationText, null, none, e2)).toMatchObject({ status: 'unavailable', missing: ['document.append'] })
    // Identity and schema rules do not loosen with the host.
    expect(checkCandidate(withId(commentaryText, 'leadinglight.commentary'), null, none, e2)).toMatchObject({ status: 'identity', problem: 'reservedId' })
    expect(checkCandidate(folderPathText, null, none, e2)).toMatchObject({ status: 'invalid' })
  })

  it('never lets a new request take a reserved or an existing id', () => {
    expect(checkCandidate(withId(quickText, 'leadinglight.quick'), null, none)).toMatchObject({ status: 'identity', problem: 'reservedId' })
    expect(checkCandidate(quickText, null, new Set(['local.quick-note']))).toMatchObject({ status: 'identity', problem: 'existingId' })
  })

  it('accepts a revision only for the same extension with a higher version', () => {
    const stored = new Set(['local.quick-note'])
    expect(checkCandidate(withVersion(quickText, '1.1.0'), quickBase, stored)).toMatchObject({ status: 'ready' })
    expect(checkCandidate(quickText, quickBase, stored)).toMatchObject({ status: 'identity', problem: 'notNewer' })
    expect(checkCandidate(withVersion(quickText, '0.9.0'), quickBase, stored)).toMatchObject({ status: 'identity', problem: 'notNewer' })
    expect(checkCandidate(withId(withVersion(quickText, '2.0.0'), 'local.other-note'), quickBase, stored)).toMatchObject({ status: 'identity', problem: 'differentId' })
  })

  it('makes a change to a bundled extension a new ordinary extension', () => {
    const bundledBase = { packageId: 'leadinglight.meeting-debrief', name: 'Meeting debrief', version: '1.0.0', sha256: SHA, activeSha256: SHA, bundled: true }
    const stored = new Set(['leadinglight.meeting-debrief'])
    expect(checkCandidate(meetingText.replace('"local.meeting-debrief"', '"leadinglight.meeting-debrief"').replace('"1.0.0"', '"2.0.0"'), bundledBase, stored))
      .toMatchObject({ status: 'identity', problem: 'reservedId' })
    expect(checkCandidate(withId(meetingText, 'local.my-debrief'), bundledBase, stored)).toMatchObject({ status: 'ready', extension: { id: 'local.my-debrief' } })
    expect(expectedActiveFor(bundledBase)).toBeNull()
    expect(expectedActiveFor(quickBase)).toBe(SHA)
  })

  describe('beside the registry as it is now', () => {
    const view = (activeSha256: string | null, versions = [{ version: '1.0.0', packageSha256: SHA }]): PackageView => ({
      packageId: 'local.quick-note', name: 'Quick note', bundled: false, activeSha256, previousSha256: null, active: null, candidate: null, rollback: null,
      versions: versions.map(item => ({ ...item, readable: true })),
    })
    const registry = (...packages: PackageView[]): RegistrySnapshot => ({ status: 'ready', vaultPath: '/vault', packages })
    const request = (revision: AdaptRevisionBase | null, attachments: AdaptAttachmentSummary[] = []): Extract<AdaptEntry, { kind: 'request' }> => ({
      kind: 'request', turnId: 'turn', at: AT, provider: 'codex', text: 'Ask', attachments, includedTurnIds: [], revision, guide: 'guide-1',
    })
    const next = withVersion(quickText, '1.1.0')

    const wasOn = { packageId: 'local.quick-note', baseSha256: SHA, expectedActiveSha256: SHA }
    const wasOff = { ...wasOn, expectedActiveSha256: null }
    const two = [{ version: '1.0.0', packageSha256: SHA }, { version: '1.0.5', packageSha256: OTHER }]

    it('revises the stored base against what the request recorded as on, on or off', () => {
      expect(candidateFor(next, request(wasOn), registry(view(SHA)), e1Review))
        .toMatchObject({ status: 'checked', check: { status: 'ready' }, change: { kind: 'revision', name: 'Quick note', from: '1.0.0' }, expected: SHA })
      expect(candidateFor(next, request(wasOff), registry(view(null)), e1Review)).toMatchObject({ status: 'checked', expected: null })
    })

    it('is stale when what is on changed after the request: turned off, turned on, or another version', () => {
      expect(candidateFor(next, request(wasOn), registry(view(null)), e1Review)).toEqual({ status: 'stale', name: 'Quick note' })
      expect(candidateFor(next, request(wasOff), registry(view(SHA)), e1Review)).toEqual({ status: 'stale', name: 'Quick note' })
      expect(candidateFor(next, request(wasOn), registry(view(OTHER, two)), e1Review)).toEqual({ status: 'stale', name: 'Quick note' })
    })

    it('refuses a revision whose base is no longer stored', () => {
      expect(candidateFor(next, request(wasOn), registry(), e1Review)).toEqual({ status: 'baseMissing' })
    })

    it('does not offer a version that is already stored, and waits for the registry', () => {
      expect(candidateFor(quickText, request(null), registry(view(null)), e1Review)).toEqual({ status: 'stored', name: 'Quick note' })
      expect(candidateFor(quickText, request(null), { status: 'loading', vaultPath: '/vault' }, e1Review)).toEqual({ status: 'waiting' })
    })

    it('calls a change to an attached bundled extension a new extension based on it', () => {
      const attached = [{ kind: 'extension' as const, label: 'Meeting debrief · 1.0.0', bytes: 10, sha256: SHA }]
      expect(candidateFor(quickText, request(null, attached), registry(), e1Review))
        .toMatchObject({ status: 'checked', change: { kind: 'copy', of: 'Meeting debrief · 1.0.0' }, expected: null })
    })
  })

  it('compares versions as numbers', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0)
    expect(compareVersions('0.0.9', '0.1.0')).toBeLessThan(0)
  })
})
