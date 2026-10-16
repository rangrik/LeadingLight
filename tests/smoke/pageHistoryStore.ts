import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

// The shared format-1 history layout on disk, for bounded synthetic versions a test cannot make by saving.

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const versionsOf = (vault: string) => path.join(vault, '.leadinglight', 'history', 'versions')
const locationOf = (vault: string, recordedPath: string) => path.join(versionsOf(vault), sha256(recordedPath).slice(0, 32))
let tags = 0

export interface SeededVersion { id: string; dir: string; payload: string; bytes: Buffer }

/** One listable version of a vault-relative page, laid out exactly as the native writer does. */
export function seedVersion(vault: string, recordedPath: string, content: string | Buffer, minutesAgo: number): SeededVersion {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')
  const location = locationOf(vault, recordedPath)
  const capturedAt = Date.now() - minutesAgo * 60_000
  const hash = sha256(bytes)
  const name = `${String(capturedAt).padStart(13, '0')}-${hash.slice(0, 16)}-${(++tags).toString(16).padStart(6, '0')}`
  const dir = path.join(location, name)
  fs.mkdirSync(dir, { recursive: true })
  const record = path.join(location, 'location.json')
  if (!fs.existsSync(record)) fs.writeFileSync(record, JSON.stringify({ recordedPath }))
  fs.writeFileSync(path.join(dir, 'payload'), bytes)
  fs.writeFileSync(path.join(dir, 'version.json'),
    JSON.stringify({ format: 1, capturedAt, reason: 'checkpoint', recordedPath, length: bytes.length, sha256: hash }))
  return { id: `${path.basename(location)}/${name}`, dir, payload: path.join(dir, 'payload'), bytes }
}

/** Same length, other bytes: the version is still listed but no longer matches its recorded hash. */
export function corruptPayload(version: SeededVersion, from: string, to: string): Buffer {
  const tampered = Buffer.from(fs.readFileSync(version.payload, 'utf8').replace(from, to), 'utf8')
  if (tampered.length !== version.bytes.length || tampered.equals(version.bytes)) throw new Error('corruption must keep the length and change the bytes')
  fs.writeFileSync(version.payload, tampered)
  return tampered
}

/** Version folders kept for one page's recorded path. */
export function keptVersions(vault: string, recordedPath: string): string[] {
  const location = locationOf(vault, recordedPath)
  return fs.existsSync(location) ? fs.readdirSync(location).filter(name => name !== 'location.json') : []
}

// A folder the store cannot account for stops every capture until it is gone.
const blocker = (vault: string) => path.join(versionsOf(vault), 'not-a-location')
export const blockStore = (vault: string) => fs.mkdirSync(blocker(vault), { recursive: true })
export const unblockStore = (vault: string) => fs.rmSync(blocker(vault), { recursive: true })
