import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, type Page, type Route } from '@playwright/test'
import { MANIFEST_NAME, RESTORE_MARKER, WORKSPACE_FOLDER, type BackupManifest, type OperationState } from '../../src/leadinglight/backup/backupContract'
import { createFixtureVaultCopy, openFixtureVaultDesktopHarness } from '../helpers/fixtureVault'
import { seedVersion } from './pageHistoryStore'

export const LANTERN = 'harbor/lantern.md'
export const TIDE = 'drafts/tide-table.md'
export const PAGES = {
  [LANTERN]: '# Lantern\n\nThe harbor lantern faces the breakwater.\n',
  [TIDE]: '# Tide table\n\nLow water at the north jetty.\n',
}
export const PAYLOADS: Record<string, string | Buffer> = {
  ...PAGES,
  'assets/every-byte.bin': Buffer.from(Array.from({ length: 512 }, (_, i) => i % 256)),
  'notes/ünïcödé page.md': '\uFEFF# Ünïcödé\r\n\r\nBOM and CRLF stay exact.\r\n',
  'assets/empty.bin': Buffer.alloc(0),
  '.laputa/views/nested/board.json': '{"kind":"board","columns":["Now","Later"]}\n',
}
export const EXCLUDED = {
  '.git/HEAD': 'ref: refs/heads/main\n',
  '.laputa-cache.json': '{}\n',
  '.leadinglight-staging/half.md': 'unfinished\n',
  'notes/.DS_Store': 'finder\n',
  '.leadinglight/trash/0123456789abcdef0123456789abcdef/record.json': '{"originalPath":"gone.md"}\n',
  '.leadinglight/trash/0123456789abcdef0123456789abcdef/payload': '# Gone\n',
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const write = (root: string, relative: string, bytes: string | Buffer) => {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, bytes)
}

/** An independent inventory: no production path classifier or manifest validator. */
export function inventory(root: string): Record<string, { bytes: number; sha256: string }> {
  const files: Record<string, { bytes: number; sha256: string }> = {}
  const walk = (relative: string) => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(name)
      else {
        expect(entry.isFile(), `unexpected non-file in owned fixture: ${name}`).toBe(true)
        const bytes = fs.readFileSync(path.join(root, name))
        files[name] = { bytes: bytes.length, sha256: sha256(bytes) }
      }
    }
  }
  walk('')
  return files
}

export function verifyBackup(folder: string): BackupManifest {
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, MANIFEST_NAME), 'utf8')) as BackupManifest
  const files = inventory(path.join(folder, WORKSPACE_FOLDER))
  expect(manifest).toMatchObject({ format: 'leadinglight-backup', version: 1, status: 'complete', gapsTotal: 0, versionsSkipped: 0 })
  expect(manifest.files.map(file => file.path).sort()).toEqual(Object.keys(files).sort())
  expect(manifest.totalFiles).toBe(Object.keys(files).length)
  expect(manifest.totalBytes).toBe(Object.values(files).reduce((sum, file) => sum + file.bytes, 0))
  for (const file of manifest.files) expect(files[file.path], file.path).toEqual({ bytes: file.bytes, sha256: file.sha256 })
  for (const relative of Object.keys(PAYLOADS)) expect(files, `included: ${relative}`).toHaveProperty([relative])
  for (const relative of Object.keys(EXCLUDED)) expect(fs.existsSync(path.join(folder, WORKSPACE_FOLDER, relative)), `excluded: ${relative}`).toBe(false)
  return manifest
}

export function verifyRestored(folder: string, manifest: BackupManifest): void {
  const files = inventory(folder)
  expect(Object.keys(files).sort()).toEqual(manifest.files.map(file => file.path).sort())
  for (const file of manifest.files) expect(files[file.path], file.path).toEqual({ bytes: file.bytes, sha256: file.sha256 })
  expect(fs.existsSync(path.join(folder, RESTORE_MARKER))).toBe(false)
  expect(fs.existsSync(path.join(folder, MANIFEST_NAME))).toBe(false)
}

interface Body { operationId?: string; content?: string; name?: string; request?: { path?: string }; path?: string }
interface Reply { status?: string; state?: string; result?: { status?: string }; [key: string]: unknown }
export interface Call { command: string; body: Body; reply?: Reply; dropped?: boolean }
interface Gate { wait: Promise<void>; release: () => void }
function gate(): Gate {
  let release = () => {}
  const wait = new Promise<void>(resolve => { release = resolve })
  return { wait, release }
}
const starts = new Set(['start-workspace-backup', 'start-backup-inspection', 'start-backup-restore'])
const identity = (root: string) => {
  const stat = fs.lstatSync(root)
  return `${stat.dev}:${stat.ino}`
}

/** Real disk routes, plus explicitly injected picker/transport faults. No fake successful copy. */
export class WorkspaceBackupFixture {
  readonly page: Page
  readonly vault = fs.realpathSync(createFixtureVaultCopy())
  readonly output = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'leadinglight-backup-browser-')))
  readonly destination = path.join(this.output, 'backups')
  readonly restoreParent = path.join(this.output, 'restored')
  readonly earlier = seedVersion(this.vault, LANTERN, '\uFEFF# Lantern\r\n\r\nEarlier harbor words.\r\n', 5)
  readonly calls: Call[] = []
  pickerCalls = 0
  dropNextStart = false
  unknownStatus = false
  private readonly roots = new Map([this.vault, this.output].map(root => [root, identity(root)]))
  private readonly pending = new Set<Promise<void>>()
  private readonly operations = new Set<string>()
  private readonly picks: Array<Promise<string | null>> = []
  private readonly releases: Array<() => void> = []
  private saveGate: Gate | null = null
  private closing = false

  constructor(page: Page) {
    this.page = page
    for (const [relative, bytes] of Object.entries({ ...PAYLOADS, ...EXCLUDED })) write(this.vault, relative, bytes)
    fs.mkdirSync(this.destination)
    fs.mkdirSync(this.restoreParent)
  }

  file(relative: string): string { return path.join(this.vault, relative) }
  read(relative: string): string { return fs.readFileSync(this.file(relative), 'utf8') }
  callsOf(command: string): Call[] { return this.calls.filter(call => call.command === command) }

  pickNext(folder: string | null): void { this.picks.push(Promise.resolve(folder)) }
  holdPicker(): (folder: string | null) => void {
    let release: (folder: string | null) => void = () => {}
    this.picks.push(new Promise(resolve => { release = resolve }))
    this.releases.push(() => release(null))
    return release
  }

  holdSaves(): () => void {
    const held = gate()
    this.saveGate = held
    const release = () => { this.saveGate = null; held.release() }
    this.releases.push(release)
    return release
  }

  async open(): Promise<void> {
    await this.page.route('**/api/vault/**', async route => {
      if (this.closing) { await route.abort().catch(() => undefined); return }
      const work = this.route(route)
      this.pending.add(work)
      try { await work } finally { this.pending.delete(work) }
    })
    await openFixtureVaultDesktopHarness(this.page, this.vault, {
      isGitRepo: false,
      folders: ['drafts', 'harbor', 'notes'].map(name => ({ name, path: name, children: [] })),
    })
    await this.page.exposeFunction('__llBackupPickFolder', () => {
      this.pickerCalls += 1
      const next = this.picks.shift()
      if (!next) throw new Error('Unexpected folder picker: the test did not choose a folder')
      return next
    })
    // fixtureVault's default existence stub knows only the original vault. This journey opens
    // a newly restored directory, so answer from disk, bounded to this test's owned roots.
    await this.page.exposeFunction('__llBackupFolderExists', (value: unknown) => {
      if (typeof value !== 'string') return false
      const folder = path.resolve(value)
      if (![...this.roots.keys()].some(root => folder === root || folder.startsWith(`${root}${path.sep}`))) return false
      try { return fs.lstatSync(folder).isDirectory() } catch { return false }
    })
    await this.page.evaluate(() => {
      const internals = Reflect.get(window, '__TAURI_INTERNALS__') as { invoke: (command: string, args?: unknown) => unknown }
      const invoke = internals.invoke
      internals.invoke = (command, args) => {
        if (command === 'plugin:dialog|open') return Reflect.get(window, '__llBackupPickFolder')()
        if (command === 'check_vault_exists') {
          const folder = args && typeof args === 'object' ? Reflect.get(args, 'path') : undefined
          return Reflect.get(window, '__llBackupFolderExists')(folder)
        }
        return invoke(command, args)
      }
    })
  }

  private async route(route: Route): Promise<void> {
    const request = route.request()
    const command = new URL(request.url()).pathname.replace('/api/vault/', '')
    const call: Call = { command, body: request.postData() ? request.postDataJSON() as Body : {} }
    this.calls.push(call)
    if (command === 'save-page-content' && this.saveGate) await this.saveGate.wait
    if (command === 'get-backup-operation' && this.unknownStatus) {
      // Injected loss of registry knowledge. Cleanup asks the real server, bypassing this route.
      await route.fulfill({ json: { state: 'unknown' } })
      return
    }
    const response = await route.fetch()
    call.reply = await response.json() as Reply
    if (starts.has(command) && call.body.operationId && call.reply.status === 'started') this.operations.add(call.body.operationId)
    if (command === 'start-workspace-backup' && this.dropNextStart) {
      this.dropNextStart = false
      call.dropped = true
      await route.abort()
      return
    }
    await route.fulfill({ response })
  }

  /** Bypasses injected browser replies, but still uses the server that admitted the operation. */
  async settled(operationId: string, cancel = false): Promise<Extract<OperationState, { state: 'finished' }>> {
    if (cancel) await this.page.request.post('/api/vault/cancel-backup-operation', { data: { operationId } })
    const observed: { state: OperationState } = { state: { state: 'unknown' } }
    await expect.poll(async () => {
      const response = await this.page.request.post('/api/vault/get-backup-operation', { data: { operationId } })
      expect(response.ok()).toBe(true)
      observed.state = await response.json() as OperationState
      return observed.state.state
    }, { timeout: 15_000, message: `owned operation did not settle: ${operationId}` }).toBe('finished')
    if (observed.state.state !== 'finished') throw new Error(`No terminal answer for ${operationId}`)
    return observed.state
  }

  async dispose(): Promise<void> {
    this.closing = true
    for (const release of this.releases) release()
    let safeToRemove = false
    try {
      // A response to start is only admission, not completion. Join both requests and jobs.
      await Promise.all([...this.pending])
      for (const operationId of this.operations) await this.settled(operationId, true)
      safeToRemove = true
    } finally {
      await this.page.close({ runBeforeUnload: false })
      if (safeToRemove) {
        for (const [root, ownedIdentity] of this.roots) {
          expect(identity(root), `refusing to remove a replaced fixture: ${root}`).toBe(ownedIdentity)
          fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
      }
    }
  }
}
