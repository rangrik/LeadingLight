import { useState, type ReactNode } from 'react'
import type { OpenReservation } from '../../hooks/useNoteCreation'
import type { VaultEntry } from '../../types'
import { fakeReservation, VAULT } from './extensions.test-utils'
import type { ExtensionController } from './extensionSessionController'
import { useExtensionUi, type ExtensionUi } from './useExtensionUi'
import { useExtensions } from './useExtensions'

interface HarnessProps {
  controller: ExtensionController
  vaultPath?: string
  reservation?: OpenReservation
  blocked?: boolean
  folders?: { name: string; path: string; children: [] }[]
  notify?: (message: string) => void
  /** Pages the listing already shows; a created page is added as the app's listing adds it. */
  entries?: VaultEntry[]
  children: (ui: ExtensionUi) => ReactNode
}

/** The real extension hooks over an injected controller, with their dialogs; children add surfaces. */
export function ExtensionHarness({ controller, vaultPath = VAULT, reservation, blocked = false, folders = [], notify, entries: initial = [], children }: HarnessProps) {
  const extensions = useExtensions({ vaultPath, ready: true, controller })
  const [fallback] = useState(() => fakeReservation().reservation)
  const [entries, setEntries] = useState(initial)
  const ui = useExtensionUi({
    locale: 'en', extensions, folders, entries, reserveOpen: () => reservation ?? fallback,
    addEntry: entry => setEntries(list => [...list, entry]), markInternalWrite: () => {}, onPersisted: () => {}, notify: notify ?? (() => {}),
    canOpen: () => true, blocked,
  })
  return <>{children(ui)}{ui.dialogs}</>
}
