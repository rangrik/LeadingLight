import { useRef, useState } from 'react'
import { SettingsPanel } from '../../components/SettingsPanel'
import type { OpenReservation } from '../../hooks/useNoteCreation'
import type { Settings, VaultEntry } from '../../types'
import { ExtensionSettings } from '../extensions/ExtensionSettings'
import { fakeReservation, VAULT } from '../extensions/extensions.test-utils'
import type { ExtensionController } from '../extensions/extensionSessionController'
import { useExtensionUi } from '../extensions/useExtensionUi'
import { useExtensions } from '../extensions/useExtensions'
import type { AdaptController } from './adaptController'
import { useAdapt } from './useAdapt'
import { useAdaptUi, type PageSnapshot } from './useAdaptUi'

const SETTINGS = {
  auto_pull_interval_minutes: null, git_enabled: null, git_path: null, git_provider: null, git_wsl_distro: null,
  autogit_enabled: null, autogit_use_ai_commit_messages: null, autogit_idle_threshold_seconds: null, autogit_inactive_threshold_seconds: null,
  auto_advance_inbox_after_organize: null, telemetry_consent: null, crash_reporting_enabled: null, analytics_enabled: null, anonymous_id: null,
  release_channel: null, automatic_update_checks_enabled: null, theme_mode: null, ui_language: null, date_display_format: null,
  default_ai_agent: null, hide_gitignored_files: null, all_notes_show_pdfs: null, all_notes_show_images: null, all_notes_show_unsupported: null,
} as Settings

interface Props {
  registry: ExtensionController
  controller: AdaptController
  vaultPath?: string
  reservation?: OpenReservation
  snapshotPage?: () => Promise<PageSnapshot>
  /** Settings → Extensions inside the real Settings panel, open from the start, as the person opened it. */
  inSettings?: boolean
}

/**
 * The real E1 and Adapt hooks over injected controllers, wired as App wires them, with Settings →
 * Extensions and a stand-in page editor. Keep writing closes Settings and then focuses the page on a
 * later tick, as App's editor focus request does.
 */
export function AdaptHarness({ registry, controller, vaultPath = VAULT, reservation, snapshotPage, inSettings = false }: Props) {
  const extensions = useExtensions({ vaultPath, ready: true, controller: registry })
  const [fallback] = useState(() => fakeReservation().reservation)
  const [entries, setEntries] = useState<VaultEntry[]>([])
  const [settingsOpen, setSettingsOpen] = useState(inSettings)
  const editor = useRef<HTMLTextAreaElement | null>(null)
  const extensionUi = useExtensionUi({
    locale: 'en', extensions, folders: [], entries, reserveOpen: () => reservation ?? fallback,
    addEntry: entry => setEntries(list => [...list, entry]), markInternalWrite: () => {}, onPersisted: () => {}, notify: () => {},
    canOpen: () => true, blocked: false,
  })
  const adapt = useAdapt({ vaultPath, ready: true, controller })
  const adaptUi = useAdaptUi({
    locale: 'en', vaultPath, adapt, extensions, extensionUi, snapshotPage: snapshotPage ?? (async () => 'noPage'),
    onKeepWriting: () => {
      setSettingsOpen(false)
      setTimeout(() => editor.current?.focus(), 0)
    },
  })
  const settings = <ExtensionSettings ui={extensionUi} adapt={{ ask: adaptUi.open, adjust: adaptUi.adjust }} />
  return <>
    <textarea ref={editor} aria-label="Page" />
    <button type="button" onClick={() => { adaptUi.open() }}>Open Adapt</button>
    <span data-testid="menu-status">{adaptUi.menuStatus}</span>
    {inSettings ? <SettingsPanel open={settingsOpen} settings={SETTINGS} onSave={() => {}} onClose={() => setSettingsOpen(false)} extensions={settings} /> : settings}
    {extensionUi.dialogs}
    {adaptUi.dialog}
  </>
}
