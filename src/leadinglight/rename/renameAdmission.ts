import { normalizeNotePathForCollision } from '../../utils/notePathIdentity'

/**
 * One managed rename's claim on its source and every page it may rewrite.
 *
 * Taken synchronously before any per-source registration (a manual rename's barrier, an
 * automatic rename's in-flight promise), so no linked page change can wait on a rename that
 * is itself waiting for that change. Released after every linked change has settled.
 */
export interface RenameTicket {
  readonly source: string
  readonly participants: readonly string[]
  /** Whether this ticket already claims every path. */
  covers: (paths: readonly string[]) => boolean
  /** Claims more pages when no other rename holds them; false changes nothing. */
  extend: (paths: readonly string[]) => boolean
  release: () => void
  /**
   * Settles when released. A caller that holds nothing may wait for the rename of its own source
   * to finish and then ask again; waiting while holding a page or a ticket could form a cycle.
   */
  readonly released: Promise<void>
}

export interface RenameAdmission {
  /** Null when another managed rename holds any participant: nothing was dispatched. */
  admit: (source: string, linked: readonly string[]) => RenameTicket | null
  /** The ticket a caller already took for this source, if it is still held. */
  held: (source: string) => RenameTicket | null
}

const identity = normalizeNotePathForCollision

export function createRenameAdmission(): RenameAdmission {
  const claimed = new Map<string, RenameTicket>()
  const bySource = new Map<string, RenameTicket>()

  const free = (keys: readonly string[], owner: RenameTicket | null) => keys.every(key => {
    const holder = claimed.get(key)
    return holder === undefined || holder === owner
  })

  const admit = (source: string, linked: readonly string[]): RenameTicket | null => {
    const keys = [...new Set([source, ...linked].map(identity))]
    if (!free(keys, null)) return null
    const participants = [source, ...linked]
    let open = true
    let settle: () => void = () => {}
    const released = new Promise<void>(resolve => { settle = resolve })
    const ticket: RenameTicket = {
      source,
      released,
      get participants() { return participants },
      covers: paths => paths.every(path => claimed.get(identity(path)) === ticket),
      extend: paths => {
        const more = new Map(paths.map(path => [identity(path), path]))
        if (!open || !free([...more.keys()], ticket)) return false
        for (const [key, path] of more) {
          if (claimed.get(key) === ticket) continue
          claimed.set(key, ticket)
          participants.push(path)
        }
        return true
      },
      release: () => {
        if (!open) return
        open = false
        for (const [key, holder] of [...claimed]) if (holder === ticket) claimed.delete(key)
        if (bySource.get(identity(source)) === ticket) bySource.delete(identity(source))
        settle()
      },
    }
    for (const key of keys) claimed.set(key, ticket)
    bySource.set(identity(source), ticket)
    return ticket
  }

  return { admit, held: source => bySource.get(identity(source)) ?? null }
}

/** The window's one admission: manual, title and automatic renames all take it first. */
export const managedRenameAdmission: RenameAdmission = createRenameAdmission()
