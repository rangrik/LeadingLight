// Shared support for the extension UI tests: fixture packages, an in-memory registry that answers
// exactly like the frozen API and a request-time reservation. The hooks harness is
// ExtensionHarness.test-utils.tsx; tests mock the encoder with extensionEncoder.test-utils.ts.
// Nothing here is used by the app.
import { vi } from 'vitest'
import type { OpenReservation } from '../../hooks/useNoteCreation'
import type { CreateProposal, GuardedProposal, ProposalQueryReply, ProposalReceipt } from '../proposals/proposalContract'
import type { UndoOffer, UndoQueryReply, UndoReceipt, UndoRequest } from '../proposals/proposalUndoContract'
import { sha256Hex } from '../saveOutcome'
import type { BeginRunArgs, FolderHandleReply, RunAdmission } from './extensionApi'
import { createExtensionController } from './extensionSessionController'
import type { ExtensionTransport } from './extensionTransport'
import meetingDebrief from './fixtures/meeting-debrief.json?raw'
import quickNote from './fixtures/quick-note.json?raw'
import passageCommentary from './fixtures/passage-commentary.json?raw'
import folderPath from './fixtures/invalid/folder-path.json?raw'
import appendObservation from './fixtures/append-observation.json?raw'

export const VAULT = '/vaults/test'

const FIXTURES = {
  'meeting-debrief.json': meetingDebrief, 'quick-note.json': quickNote, 'passage-commentary.json': passageCommentary, 'invalid/folder-path.json': folderPath,
  'append-observation.json': appendObservation,
} as const
/** The shared fixture corpus, byte for byte. */
export const fixtureText = (name: keyof typeof FIXTURES): string => FIXTURES[name]

export interface FakeVersion { text: string; sha: string; version: string; readable?: boolean }
export interface FakePackage { id: string; name: string; versions: FakeVersion[]; active: string | null; previous: string | null }

export async function versionOf(text: string): Promise<FakeVersion> {
  return { text, sha: await sha256Hex(text), version: (JSON.parse(text) as { version: string }).version }
}

/** Newest version first, as native lists them. */
export async function packageOf(texts: string[], active: 'newest' | 'oldest' | null = null): Promise<FakePackage> {
  const versions = await Promise.all(texts.map(versionOf))
  const parsed = JSON.parse(texts[0]) as { id: string; name: string }
  const sha = active === 'newest' ? versions[0].sha : active === 'oldest' ? versions.at(-1)!.sha : null
  return { id: parsed.id, name: parsed.name, versions, active: sha, previous: null }
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

/** An in-memory registry with the frozen reply shapes, every call a spy. */
export function fakeRegistry(packages: FakePackage[], vaultPath = VAULT) {
  let sessions = 0
  let handles = 0
  const folders = new Map<string, string>()
  const committedFor = (proposal: CreateProposal): ProposalReceipt => ({
    status: 'committed', kind: 'create', operationId: proposal.operationId,
    path: [vaultPath, folders.get(proposal.folderHandle) ?? '', proposal.fileName].filter(Boolean).join('/'),
    beforeSha256: null, afterSha256: proposal.contentSha256, durable: true, undoReceipt: null,
  })
  const find = (packageId: string) => packages.find(item => item.id === packageId)
  const api = {
    importCandidate: vi.fn(async ({ packageText }: { packageText: string }) => {
      const version = await versionOf(packageText)
      const parsed = JSON.parse(packageText) as { id: string; name: string }
      const existing = find(parsed.id)
      if (existing) { if (!existing.versions.some(item => item.sha === version.sha)) existing.versions.unshift(version) }
      else packages.push({ id: parsed.id, name: parsed.name, versions: [version], active: null, previous: null })
      return { status: 'candidate' as const, packageSha256: version.sha, packageId: parsed.id, version: version.version, missingCapabilities: [] }
    }),
    list: vi.fn(async () => ({
      status: 'ok' as const,
      extensions: packages.map(item => ({
        packageId: item.id, name: item.name,
        versions: item.versions.map(version => ({ packageSha256: version.sha, version: version.version, readable: version.readable ?? true })),
        activeSha256: item.active, previousSha256: item.previous,
      })),
    })),
    read: vi.fn(async ({ packageSha256 }: { packageSha256: string }) => {
      const version = packages.flatMap(item => item.versions).find(item => item.sha === packageSha256)
      return version ? { status: 'ok' as const, packageText: version.text } : { status: 'unknown' as const }
    }),
    activate: vi.fn(async (args: { packageId: string; packageSha256: string; expectedActiveSha256: string | null }) => {
      const item = find(args.packageId)!
      if (item.active !== args.expectedActiveSha256) return { status: 'refused' as const, reason: 'changed' as const, missingCapabilities: [] }
      const previous = item.active
      item.previous = previous
      item.active = args.packageSha256
      return { status: 'active' as const, packageSha256: args.packageSha256, previousSha256: previous, revokedRuns: 0 }
    }),
    deactivate: vi.fn(async (args: { packageId: string; expectedActiveSha256: string }) => {
      const item = find(args.packageId)!
      if (item.active !== args.expectedActiveSha256) return { status: 'refused' as const, reason: 'changed' as const }
      item.previous = item.active
      item.active = null
      return { status: 'inactive' as const, revokedRuns: 0 }
    }),
    openSession: vi.fn<(args: { vaultPath: string }) => Promise<{ status: 'open'; sessionId: string }>>(async () => ({ status: 'open', sessionId: `session-${++sessions}` })),
    closeSession: vi.fn<(args: { sessionId: string }) => Promise<{ status: 'closed' } | null>>(async () => ({ status: 'closed' })),
    beginRun: vi.fn(async (args: BeginRunArgs): Promise<RunAdmission | null> => ({
      status: 'admitted', scope: { runId: `run-${args.invocationId}`, packageId: 'local.pkg', ...args },
    })),
    endRun: vi.fn<(args: { sessionId: string; invocationId: string }) => Promise<{ status: 'ended' }>>(async () => ({ status: 'ended' })),
    bindFolder: vi.fn(async ({ folder }: { runId: string; folder: string }): Promise<FolderHandleReply | null> => {
      const folderHandle = `folder-${++handles}`
      folders.set(folderHandle, folder)
      return { status: 'bound', folderHandle, displayPath: folder }
    }),
    bindDocument: vi.fn(async () => ({ status: 'refused' as const, reason: 'unsupported' as const })),
    submitProposal: vi.fn(async (proposal: GuardedProposal): Promise<ProposalReceipt | null> => committedFor(proposal as CreateProposal)),
    queryProposal: vi.fn<(args: { operationId: string }) => Promise<ProposalQueryReply | null>>(async () => null),
    undoProposal: vi.fn<(request: UndoRequest, offer: UndoOffer) => Promise<UndoReceipt | null>>(async () => null),
    queryUndo: vi.fn<(args: { operationId: string }, offer: UndoOffer) => Promise<UndoQueryReply | null>>(async () => null),
    releaseUndo: vi.fn<(args: { sessionId: string; undoReceipt: string }) => Promise<{ status: 'released' } | null>>(async () => ({ status: 'released' })),
    forget: vi.fn(),
  }
  /** Calls that touch sessions, runs, handles or writes; a preview must cause none of them. */
  const effects = () => [api.openSession, api.closeSession, api.beginRun, api.endRun, api.bindFolder, api.submitProposal, api.queryProposal, api.activate, api.deactivate]
    .reduce((count, spy) => count + spy.mock.calls.length, 0)
  const transport = api as unknown as ExtensionTransport
  return { api, folders, committedFor, effects, transport, controller: (options: { closeTimeoutMs?: number } = {}) => createExtensionController({ api: transport, ...options }) }
}

export function fakeReservation(shown = true) {
  const open = vi.fn<OpenReservation['open']>(async () => shown)
  const reservation: OpenReservation = { inSession: () => true, isActive: () => true, open }
  return { reservation, open }
}
