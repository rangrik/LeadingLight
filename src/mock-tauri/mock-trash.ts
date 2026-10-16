/**
 * Browser mock of the native local Trash commands: never erases, never overwrites on restore,
 * restores into the original folder (with a `-2` style name when taken), and reports every item.
 */
import type { VaultEntry } from '../types'
import { MOCK_CONTENT } from './mock-content'
import { MOCK_ENTRIES } from './mock-entries'

interface MockTrashRecord {
  id: string
  originalPath: string
  title: string
  filename: string
  deletedAt: number
  content: string
  entry: VaultEntry | null
}

const trashByVault = new Map<string, MockTrashRecord[]>()
let nextId = 1

const root = (vaultPath: string) => vaultPath.replace(/\/+$/u, '')
const absolute = (vaultPath: string, path: string) => (path.startsWith('/') ? path : `${root(vaultPath)}/${path}`)
const relative = (vaultPath: string, path: string) => path.slice(root(vaultPath).length + 1)
const records = (vaultPath: string) => trashByVault.get(root(vaultPath)) ?? []
const newId = () => (nextId++).toString(16).padStart(32, '0')

function moveFailure(vaultPath: string, path: string): { code: string, message: string } | null {
  const target = absolute(vaultPath, path)
  if (!target.startsWith(`${root(vaultPath)}/`) || target.split('/').some(part => part === '..' || part === '.')) {
    return { code: 'outsideVault', message: 'Outside the vault' }
  }
  if (relative(vaultPath, target).split('/').some(part => part.startsWith('.'))) return { code: 'internalLocation', message: 'Internal location' }
  if (typeof Reflect.get(MOCK_CONTENT, target) !== 'string') return { code: 'notFound', message: 'File does not exist' }
  return null
}

function freePath(path: string): string {
  if (typeof Reflect.get(MOCK_CONTENT, path) !== 'string') return path
  const slash = path.lastIndexOf('/')
  const name = path.slice(slash + 1)
  const dot = name.lastIndexOf('.')
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  for (let index = 2; ; index += 1) {
    const candidate = `${path.slice(0, slash + 1)}${stem}-${index}${ext}`
    if (typeof Reflect.get(MOCK_CONTENT, candidate) !== 'string') return candidate
  }
}

export const mockTrashHandlers = {
  move_to_local_trash: (args: { vaultPath: string, paths: string[] }) => {
    const moved: { path: string, id: string, originalPath: string }[] = []
    const failed: { path: string, code: string, message: string }[] = []
    for (const path of [...new Set(args.paths)]) {
      const failure = moveFailure(args.vaultPath, path)
      if (failure) { failed.push({ path, ...failure }); continue }
      const target = absolute(args.vaultPath, path)
      const index = MOCK_ENTRIES.findIndex(entry => entry.path === target)
      const entry = index >= 0 ? MOCK_ENTRIES.splice(index, 1)[0] : null
      const id = newId()
      const originalPath = relative(args.vaultPath, target)
      const filename = originalPath.split('/').pop() ?? originalPath
      trashByVault.set(root(args.vaultPath), [...records(args.vaultPath), {
        id, originalPath, filename, title: entry?.title ?? filename.replace(/\.md$/u, ''), deletedAt: Date.now(),
        content: String(Reflect.get(MOCK_CONTENT, target)), entry,
      }])
      Reflect.deleteProperty(MOCK_CONTENT, target)
      moved.push({ path, id, originalPath })
    }
    return { moved, failed }
  },
  list_local_trash: (args: { vaultPath: string }) => [...records(args.vaultPath)]
    .sort((left, right) => right.deletedAt - left.deletedAt)
    .map(record => ({
      id: record.id, state: 'ready', title: record.title, filename: record.filename, originalPath: record.originalPath,
      deletedAt: record.deletedAt, fileKind: record.filename.endsWith('.md') ? 'markdown' : 'text', sizeBytes: record.content.length,
      restoredPath: null,
    })),
  restore_from_local_trash: (args: { vaultPath: string, ids: string[] }) => {
    const restored: unknown[] = []
    const failed: { id: string, code: string, message: string }[] = []
    for (const id of [...new Set(args.ids)]) {
      if (!/^[0-9a-f]{32}$/u.test(id)) { failed.push({ id, code: 'invalidId', message: 'Invalid id' }); continue }
      const record = records(args.vaultPath).find(item => item.id === id)
      if (!record) { failed.push({ id, code: 'notFound', message: 'No item with that id in Trash' }); continue }
      const path = freePath(absolute(args.vaultPath, record.originalPath))
      Reflect.set(MOCK_CONTENT, path, record.content)
      const entry = record.entry ? { ...record.entry, path, filename: path.split('/').pop() ?? record.filename } : null
      if (entry) MOCK_ENTRIES.push(entry)
      trashByVault.set(root(args.vaultPath), records(args.vaultPath).filter(item => item.id !== id))
      restored.push({ id, path, relativePath: relative(args.vaultPath, path), renamed: path !== absolute(args.vaultPath, record.originalPath), relocated: false, cleanupPending: false, entry })
    }
    return { restored, failed }
  },
}
