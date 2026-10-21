// Core association, derived from the notes' own Source links: which shown page is a commentary
// and where its source is, and which shown page has linked commentaries. Nothing here depends on the
// recipe being on. Discovery is the bounded local search, rerun only when the listing's set of pages
// changes or a commentary was written here, never on every keystroke.
//
// Typing never runs the note parser. An ordinary page fails a cheap front-matter check and is never
// parsed. A commentary is parsed when first shown, then again only once its text has been still for
// a moment; until then its last card stays, so a Source edit updates or removes the card after a pause.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { VaultEntry } from '../../types'
import { joinVaultPath, normalizeNotePathForIdentity, notePathFilename } from '../../utils/notePathIdentity'
import type { CommentaryNote } from './commentaryContract'
import type { LinkedNote } from './CommentaryNotices'
import { relativeTo, type CommentaryServices } from './CommentaryPorts'

export interface CommentaryLinksOptions {
  vaultPath: string
  services: CommentaryServices
  entries: readonly VaultEntry[]
  /** Pages shown in panes now, with the text their editors hold. */
  pages: readonly { readonly path: string; readonly content: string }[]
  /** Moves on after a commentary is written or undone here. */
  epoch: number
}

/** Changes when a page is added, removed or renamed; not when one is only edited. */
export function listingSignature(entries: readonly VaultEntry[]): string {
  let sum = 0
  let mix = 0
  for (const entry of entries) {
    let hash = 0x811c9dc5
    for (let index = 0; index < entry.path.length; index++) hash = Math.imul(hash ^ entry.path.charCodeAt(index), 0x01000193)
    sum = (sum + (hash >>> 0)) >>> 0
    mix = (mix ^ Math.imul(hash, 0x9e3779b1)) >>> 0
  }
  return `${entries.length}:${sum}:${mix}`
}

/** How long a commentary's text must be still before it is read again. */
export const COMMENTARY_PARSE_IDLE_MS = 400

const isMarkdown = (entry: VaultEntry | undefined) => !entry?.fileKind || entry.fileKind === 'markdown'
const labelOf = (path: string) => notePathFilename(path).replace(/\.md$/i, '')

export function useCommentaryLinks({ vaultPath, services, entries, pages, epoch }: CommentaryLinksOptions) {
  const byPath = useMemo(() => new Map(entries.map(entry => [normalizeNotePathForIdentity(entry.path), entry])), [entries])
  const signature = useMemo(() => listingSignature(entries), [entries])
  const [found, setFound] = useState<ReadonlyMap<string, { key: string; linked: readonly LinkedNote[] }>>(new Map())

  // The last reading of each shown commentary, by the exact text it was read from.
  const [parsed, setParsed] = useState<ReadonlyMap<string, { readonly content: string; readonly note: CommentaryNote | null }>>(new Map())
  const parsedRef = useRef(parsed)
  useEffect(() => { parsedRef.current = parsed }, [parsed])
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    const shownIdentities = new Set(pages.map(page => normalizeNotePathForIdentity(page.path)))
    for (const page of pages) {
      const identity = normalizeNotePathForIdentity(page.path)
      const relative = relativeTo(vaultPath, page.path)
      if (!relative || !isMarkdown(byPath.get(identity)) || !services.mayBeCommentary(page.content)) continue
      const known = parsedRef.current.get(identity)
      if (known?.content === page.content) continue
      const { content } = page
      // First shown: read at once (off the render). Otherwise wait for the text to be still.
      timers.push(setTimeout(() => {
        let note: CommentaryNote | null = null
        try {
          note = services.readNote(relative, content)
        } catch {
          note = null
        }
        setParsed(current => {
          // Readings of pages no longer shown are dropped as a new one arrives.
          const next = new Map([...current].filter(([key]) => shownIdentities.has(key)))
          return next.set(identity, { content, note })
        })
      }, known ? COMMENTARY_PARSE_IDLE_MS : 0))
    }
    return () => { for (const timer of timers) clearTimeout(timer) }
  }, [byPath, pages, services, vaultPath])

  /** The shown page's last reading, or null for an ordinary page; it never parses during render. */
  const noteOf = (path: string): CommentaryNote | null => {
    const identity = normalizeNotePathForIdentity(path)
    const page = pages.find(item => normalizeNotePathForIdentity(item.path) === identity)
    // A page whose record is gone loses its card with the very edit that removed it.
    if (!page || !services.mayBeCommentary(page.content)) return null
    return parsed.get(identity)?.note ?? null
  }

  const shown = pages.map(page => page.path).join('\n')
  // The newest search asked for each page; an older answer arriving late is not shown.
  const requested = useRef(new Map<string, string>())
  useEffect(() => {
    for (const path of shown ? shown.split('\n') : []) {
      const identity = normalizeNotePathForIdentity(path)
      const relative = relativeTo(vaultPath, path)
      const key = `${vaultPath}\n${identity}\n${signature}\n${epoch}`
      if (!relative || !isMarkdown(byPath.get(identity)) || requested.current.get(identity) === key) continue
      requested.current.set(identity, key)
      void services.discover({ vaultPath, sourcePath: relative, entries }).then(discovery => {
        if (requested.current.get(identity) !== key) return
        const linked = discovery.linked.map(item => ({ path: joinVaultPath(vaultPath, item.path), title: item.title?.trim() || labelOf(item.path) }))
        setFound(current => new Map(current).set(identity, { key, linked }))
      }, () => {})
    }
  }, [byPath, entries, epoch, services, shown, signature, vaultPath])

  return {
    /** The shown page read as a note, or null when it is not one this host can read. */
    noteOf,
    /** Notes whose Source link names this shown page, most recently edited first. */
    linkedTo: (path: string): readonly LinkedNote[] => {
      const identity = normalizeNotePathForIdentity(path)
      // The last answer stays shown while a newer search runs, so the button does not flicker.
      return found.get(identity)?.linked ?? []
    },
    /** The listed page at a vault-relative path, if any. */
    entryAt: (relative: string): VaultEntry | null => byPath.get(normalizeNotePathForIdentity(joinVaultPath(vaultPath, relative))) ?? null,
  }
}
