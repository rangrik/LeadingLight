import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, type Page, type Route } from '@playwright/test'
import { stringify } from 'yaml'
import { openFixtureVaultDesktopHarness } from '../helpers/fixtureVault'

export const HARBOR_TEMPLATE = 'harbor/meeting.md'
export const GARDEN_TEMPLATE = 'garden/meeting.md'
export const HARBOR_TEXT = '# Meeting\n\n## Harbor agenda\n\n- [ ] Check the lantern\n\n![Ledger](../assets/ledger.png)\n\n[Local reference](../harbor-note.md)\n'
export const GARDEN_TEXT = '# Meeting\n\n## Garden agenda\n\n- [ ] Water the pear tree\n'
export const NOTES = {
  'harbor-note.md': '# Harbor note\n\nThe harbor lantern is ready.\n',
  'garden-note.md': '# Garden note\n\nThe pear tree is in bloom.\n',
}

export function typeFile(name: string, text: string, extra: Record<string, unknown> = {}): string {
  return `---\n${stringify({ type: 'Type', title: name, template: text, ...extra })}---\n\n# ${name}\n`
}

interface ApiCall { command: string; body: Record<string, unknown>; status?: number }
interface Gate { wait: Promise<void>; release: () => void }
const identity = (root: string) => { const stat = fs.lstatSync(root); return `${stat.dev}:${stat.ino}` }

/** Owned synthetic files and real disk API responses, with explicit transport/collision faults. */
export class LocalTemplatesFixture {
  readonly page: Page
  readonly vault = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'leadinglight-template-browser-')))
  readonly calls: ApiCall[] = []
  readonly remoteRequests: string[] = []
  private readonly ownedIdentity = identity(this.vault)
  private readonly pending = new Set<Promise<void>>()
  private readonly gates = new Map<string, Gate>()
  private closing = false
  dropNextCreate = false
  collideNextCreate = false
  failNextEntry = false
  collisionPath: string | null = null

  constructor(page: Page, templates = true) {
    this.page = page
    for (const [relative, content] of Object.entries(NOTES)) this.write(relative, content)
    if (templates) {
      this.write(HARBOR_TEMPLATE, typeFile('Meeting', HARBOR_TEXT, { Priority: [2], _favorite: true, aliases: ['source-only'] }))
      this.write(GARDEN_TEMPLATE, typeFile('Meeting', GARDEN_TEXT))
      this.write('empty.md', '---\ntype: Type\ntitle: Empty starting point\ntemplate: []\n---\n# Empty starting point\n\n## Must not become a template\n')
    }
  }

  file(relative: string): string {
    const file = path.resolve(this.vault, relative)
    if (!file.startsWith(`${this.vault}${path.sep}`)) throw new Error('Fixture path escapes its owned root')
    return file
  }
  write(relative: string, text: string): void {
    const file = this.file(relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
  }
  read(relative: string): string { return fs.readFileSync(this.file(relative), 'utf8') }
  readAbsolute(file: string): string { return this.read(path.relative(this.vault, file)) }
  markdownFiles(): string[] {
    return fs.readdirSync(this.vault, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .map(entry => path.relative(this.vault, path.join(entry.parentPath, entry.name)))
      .filter(relative => !relative.startsWith('.leadinglight/')).sort()
  }

  hold(command: string): () => void {
    if (this.gates.has(command)) throw new Error(`Already holding ${command}`)
    let release = () => {}
    const wait = new Promise<void>(resolve => { release = resolve })
    this.gates.set(command, { wait, release })
    return () => { this.gates.delete(command); release() }
  }

  async open(): Promise<void> {
    this.page.on('request', request => {
      const url = new URL(request.url())
      if (url.protocol.startsWith('http') && !['localhost', '127.0.0.1'].includes(url.hostname)) this.remoteRequests.push(url.href)
    })
    await this.page.route('**/api/vault/**', async route => {
      if (this.closing) { await route.abort().catch(() => undefined); return }
      const work = this.route(route)
      this.pending.add(work)
      try { await work } finally { this.pending.delete(work) }
    })
    await openFixtureVaultDesktopHarness(this.page, this.vault, {
      isGitRepo: false, expectedReadyTitle: 'Harbor note',
      folders: ['harbor', 'garden'].map(name => ({ name, path: name, children: [] })),
    })
    // Listing visibility precedes split restoration. Await its persisted receipt so
    // setup does not open a modal while the initial workspace is still settling.
    await this.page.waitForFunction(vault => localStorage.getItem(`leadinglight.workspace:${vault}`) !== null, this.vault)
    // The inherited harness emulates create with check-then-overwriting-save. Route these
    // operations through the production disk bridge so no-clobber and exact-read tests are real.
    await this.page.evaluate(async () => {
      const modulePath = '/src/mock-tauri/vault-api.ts'
      const { tryVaultApi } = await import(/* @vite-ignore */ modulePath)
      const handlers = window.__mockHandlers
      if (!handlers) throw new Error('Desktop fixture bridge missing')
      // Its getter reapplies inherited handlers on every access. Keep the initialized
      // fixture state but remove that reset before installing the production routes.
      Object.defineProperty(window, '__mockHandlers', { configurable: true, writable: true, value: handlers })
      for (const command of ['create_note_content', 'reload_vault_entry', 'get_note_content']) {
        Reflect.set(handlers, command, async (args?: Record<string, unknown>) => {
          const result = await tryVaultApi(command, args)
          if (result === undefined) throw new Error(`Disk bridge declined ${command}`)
          return result
        })
      }
    })
  }

  private async route(route: Route): Promise<void> {
    const request = route.request()
    const url = new URL(request.url())
    const command = url.pathname.replace('/api/vault/', '')
    const body = request.postData() ? request.postDataJSON() as Record<string, unknown> : Object.fromEntries(url.searchParams)
    const call: ApiCall = { command, body }
    this.calls.push(call)
    const gate = this.gates.get(command)
    if (gate) await gate.wait
    if (command === 'entry' && this.failNextEntry) {
      this.failNextEntry = false
      await route.fulfill({ status: 503, json: { error: 'Synthetic exact-source read failure' } })
      return
    }
    if (command === 'create' && this.collideNextCreate) {
      this.collideNextCreate = false
      if (typeof body.path !== 'string') throw new Error('Create path missing')
      this.collisionPath = body.path
      this.write(path.relative(this.vault, body.path), '# Existing occupant\n\nKeep this exact text.\n')
    }
    const response = await route.fetch({ maxRetries: 0 })
    call.status = response.status()
    if (command === 'create' && this.dropNextCreate && response.ok()) {
      this.dropNextCreate = false
      await route.abort()
      return
    }
    await route.fulfill({ response })
  }

  async dispose(): Promise<void> {
    this.closing = true
    for (const gate of this.gates.values()) gate.release()
    this.gates.clear()
    await Promise.allSettled([...this.pending])
    await this.page.close({ runBeforeUnload: false })
    expect(identity(this.vault), 'Refusing to remove a replaced fixture root').toBe(this.ownedIdentity)
    fs.rmSync(this.vault, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}
