import { useState } from 'react'
import type { OpenReservation } from '../../hooks/useNoteCreation'
import type { VaultEntry } from '../../types'
import { ExtensionSettings } from '../extensions/ExtensionSettings'
import { fakeReservation, VAULT } from '../extensions/extensions.test-utils'
import type { ExtensionController } from '../extensions/extensionSessionController'
import { useExtensionUi } from '../extensions/useExtensionUi'
import { useExtensions } from '../extensions/useExtensions'
import type { AdaptController } from './adaptController'
import { useAdapt } from './useAdapt'
import { useAdaptUi, type PageSnapshot } from './useAdaptUi'

interface Props {
  registry: ExtensionController
  controller: AdaptController
  vaultPath?: string
  reservation?: OpenReservation
  snapshotPage?: () => Promise<PageSnapshot>
}

/** The real E1 and Adapt hooks over injected controllers, wired as App wires them, with Settings → Extensions. */
export function AdaptHarness({ registry, controller, vaultPath = VAULT, reservation, snapshotPage }: Props) {
  const extensions = useExtensions({ vaultPath, ready: true, controller: registry })
  const [fallback] = useState(() => fakeReservation().reservation)
  const [entries, setEntries] = useState<VaultEntry[]>([])
  const extensionUi = useExtensionUi({
    locale: 'en', extensions, folders: [], entries, reserveOpen: () => reservation ?? fallback,
    addEntry: entry => setEntries(list => [...list, entry]), markInternalWrite: () => {}, onPersisted: () => {}, notify: () => {},
    canOpen: () => true, blocked: false,
  })
  const adapt = useAdapt({ vaultPath, ready: true, controller })
  const adaptUi = useAdaptUi({ locale: 'en', vaultPath, adapt, extensions, extensionUi, snapshotPage: snapshotPage ?? (async () => 'noPage') })
  return <>
    <button type="button" onClick={() => { adaptUi.open() }}>Open Adapt</button>
    <span data-testid="menu-status">{adaptUi.menuStatus}</span>
    <ExtensionSettings ui={extensionUi} adapt={{ ask: adaptUi.open, adjust: adaptUi.adjust }} />
    {extensionUi.dialogs}
    {adaptUi.dialog}
  </>
}
