import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsPanel } from '../../components/SettingsPanel'
import type { Settings } from '../../types'
import { ExtensionSettings } from './ExtensionSettings'
import { ExtensionHarness } from './ExtensionHarness.test-utils'
import { fakeRegistry, fixtureText, packageOf } from './extensions.test-utils'

vi.mock('./extensionMarkdownText', async () => (await import('./extensionEncoder.test-utils')).encoderStandIn())
vi.mock('../../utils/macosDismissableEscapeSurface', () => ({
  registerMacosDismissableEscapeSurface: () => () => {},
  useMacosDismissableEscapeSurfaceRef: (ref: unknown) => ref ?? (() => {}),
}))

const SETTINGS = {
  auto_pull_interval_minutes: null, git_enabled: null, git_path: null, git_provider: null, git_wsl_distro: null,
  autogit_enabled: null, autogit_use_ai_commit_messages: null, autogit_idle_threshold_seconds: null, autogit_inactive_threshold_seconds: null,
  auto_advance_inbox_after_organize: null, telemetry_consent: null, crash_reporting_enabled: null, analytics_enabled: null, anonymous_id: null,
  release_channel: null, automatic_update_checks_enabled: null, theme_mode: null, ui_language: null, date_display_format: null,
  default_ai_agent: null, hide_gitignored_files: null, all_notes_show_pdfs: null, all_notes_show_images: null, all_notes_show_unsupported: null,
} as Settings

const MEETING = fixtureText('meeting-debrief.json')
const MEETING_V2 = MEETING.replace('"version": "1.0.0"', '"version": "2.0.0"')
  .replace('{ "id": "revisit", "kind": "boolean", "label": "Revisit next week" }', '{ "id": "revisit", "kind": "boolean", "label": "Revisit next week" },\n            { "id": "owner", "kind": "text", "label": "Owner" }')

async function renderSettings(registry: ReturnType<typeof fakeRegistry>) {
  const onCloseSettings = vi.fn()
  const controller = registry.controller()
  render(<ExtensionHarness controller={controller}>
    {ui => <SettingsPanel open settings={SETTINGS} onSave={vi.fn()} onClose={onCloseSettings} extensions={<ExtensionSettings ui={ui} />} />}
  </ExtensionHarness>)
  await screen.findAllByTestId('extension-row')
  return { onCloseSettings, controller }
}

const row = (packageId: string) => screen.getAllByTestId('extension-row').find(item => item.dataset.packageId === packageId)!
const tabbables = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('button, input, textarea, [tabindex]')]
  .filter(element => element.tabIndex >= 0 && !element.hasAttribute('disabled'))

describe('Settings → Extensions', () => {
  it('lists the bundled debrief off, with the backup limitation and a paste row, after Workflow', async () => {
    const registry = fakeRegistry([await packageOf([MEETING])])
    await renderSettings(registry)
    expect(within(row('local.meeting-debrief')).getByTestId('extension-chip')).toHaveTextContent('Not on yet')
    expect(screen.getByTestId('extension-backup-limitation')).toHaveTextContent('Workspace backups don’t include them yet')
    expect(screen.getByTestId('extension-paste')).toHaveTextContent('Paste extension…')
    const sections = [...document.querySelectorAll('[id^="settings-section-"]')].map(section => section.id)
    expect(sections.indexOf('settings-section-extensions')).toBe(sections.indexOf('settings-section-workflow') + 1)
    expect(screen.getByRole('button', { name: 'Extensions' })).toBeInTheDocument()
  })

  it('keeps Tab and Shift+Tab inside the preview, closes only it on Escape and returns focus', async () => {
    const registry = fakeRegistry([await packageOf([MEETING])])
    const { onCloseSettings } = await renderSettings(registry)
    const previewButton = within(row('local.meeting-debrief')).getByTestId('extension-preview')
    previewButton.focus()
    fireEvent.click(previewButton)
    const dialog = await screen.findByTestId('extension-preview-dialog')
    const inside = tabbables(dialog)
    expect(inside.length).toBeGreaterThan(1)
    // Inside the dialog, the Settings capture trap must leave Tab to the browser: without the portal
    // marker it cancels the default move and focus cannot advance past this element.
    const middle = inside[1]
    middle.focus()
    expect(fireEvent.keyDown(middle, { key: 'Tab' })).toBe(true)
    expect(document.activeElement).toBe(middle)
    expect(fireEvent.keyDown(middle, { key: 'Tab', shiftKey: true })).toBe(true)
    // At the edges the dialog's own focus scope wraps.
    inside.at(-1)!.focus()
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(document.activeElement).toBe(inside[0])
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(inside.at(-1))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('extension-preview-dialog')).not.toBeInTheDocument())
    expect(onCloseSettings).not.toHaveBeenCalled()
    expect(screen.getByTestId('settings-panel')).toBeInTheDocument()
    await waitFor(() => expect(document.activeElement).toBe(previewButton))
  })

  it('previews from the package alone: no session, run, write, query or activation', async () => {
    const registry = fakeRegistry([await packageOf([MEETING])])
    await renderSettings(registry)
    fireEvent.click(within(row('local.meeting-debrief')).getByTestId('extension-preview'))
    const dialog = await screen.findByTestId('extension-preview-dialog')
    expect(within(dialog).getByText('Asks you 6 questions.')).toBeInTheDocument()
    expect(within(dialog).getByText('Creates one new note in a folder you choose.')).toBeInTheDocument()
    expect(within(dialog).getByTestId('extension-preview-sample')).toHaveTextContent('Debrief: Sample answer')
    expect(within(dialog).getByText('This preview writes nothing.')).toBeInTheDocument()
    expect(registry.effects()).toBe(0)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(screen.queryByTestId('extension-preview-dialog')).not.toBeInTheDocument())
    expect(registry.effects()).toBe(0)
  })

  it('turns on only through the preview, once, and then offers Try it', async () => {
    const registry = fakeRegistry([await packageOf([MEETING])])
    await renderSettings(registry)
    fireEvent.click(within(row('local.meeting-debrief')).getByTestId('extension-switch'))
    const dialog = await screen.findByTestId('extension-preview-dialog')
    expect(registry.api.activate).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByTestId('extension-turn-on'))
    await waitFor(() => expect(within(row('local.meeting-debrief')).getByTestId('extension-chip')).toHaveTextContent('On'))
    expect(registry.api.activate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ packageId: 'local.meeting-debrief', expectedActiveSha256: null }))
    expect(screen.getByTestId('extension-notice')).toHaveTextContent('Meeting debrief is on. Find it under New page → From extension…')
    expect(screen.getByTestId('extension-try')).toBeInTheDocument()
    expect(registry.api.openSession).not.toHaveBeenCalled()
  })

  it('shows a valid package needing missing capabilities as unavailable, with Turn on disabled', async () => {
    const registry = fakeRegistry([await packageOf([fixtureText('passage-commentary.json')])])
    await renderSettings(registry)
    const commentary = row('local.passage-commentary')
    expect(within(commentary).getByTestId('extension-chip')).toHaveTextContent('Unavailable in this version')
    expect(within(commentary).getByTestId('extension-switch')).toBeDisabled()
    fireEvent.click(within(commentary).getByTestId('extension-preview'))
    const dialog = await screen.findByTestId('extension-preview-dialog')
    expect(within(dialog).getByTestId('extension-preview-needs')).toHaveTextContent('Needs: selecting text in a page, finding the note linked to a page, and adding to an existing page')
    expect(within(dialog).getByTestId('extension-turn-on')).toBeDisabled()
  })

  it('refuses invalid pasted text with its exact location and adds nothing', async () => {
    const registry = fakeRegistry([await packageOf([MEETING])])
    await renderSettings(registry)
    fireEvent.click(screen.getByTestId('extension-paste'))
    const dialog = await screen.findByTestId('extension-import-dialog')
    fireEvent.change(within(dialog).getByLabelText('Paste the extension text'), { target: { value: fixtureText('invalid/folder-path.json') } })
    fireEvent.click(within(dialog).getByTestId('extension-import-check'))
    const result = await within(dialog).findByTestId('extension-import-result')
    expect(result).toHaveTextContent('This extension can’t be added:')
    expect(result).toHaveTextContent('Where: /commands/0/steps/1/folder')
    fireEvent.click(within(result).getByRole('button', { name: 'Details' }))
    expect(within(result).getByTestId('extension-import-details')).toHaveTextContent('unknownField')
    expect(registry.api.importCandidate).not.toHaveBeenCalled()
  })

  it('imports a valid package as a candidate preview that never turns on by itself', async () => {
    const registry = fakeRegistry([await packageOf([MEETING])])
    await renderSettings(registry)
    fireEvent.click(screen.getByTestId('extension-paste'))
    const importDialog = await screen.findByTestId('extension-import-dialog')
    fireEvent.change(within(importDialog).getByLabelText('Paste the extension text'), { target: { value: fixtureText('quick-note.json') } })
    fireEvent.click(within(importDialog).getByTestId('extension-import-check'))
    const preview = await screen.findByTestId('extension-preview-dialog')
    expect(within(preview).getByTestId('extension-preview-version')).toHaveTextContent('Version 1.0.0')
    fireEvent.click(within(preview).getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(within(row('local.quick-note')).getByTestId('extension-chip')).toHaveTextContent('Not on yet'))
    expect(registry.api.activate).not.toHaveBeenCalled()
  })

  it('replaces a version only through review, and goes back to it as behaviour only', async () => {
    const pkg = await packageOf([MEETING_V2, MEETING], 'oldest')
    const registry = fakeRegistry([pkg])
    await renderSettings(registry)
    const review = within(row('local.meeting-debrief')).getByTestId('extension-preview')
    expect(review).toHaveTextContent('Review version 2.0.0')
    fireEvent.click(review)
    const preview = await screen.findByTestId('extension-preview-dialog')
    expect(within(preview).getByTestId('extension-preview-version')).toHaveTextContent('Replaces version 1.0.0 with version 2.0.0.')
    expect(within(preview).getByTestId('extension-preview-changes')).toHaveTextContent('Now: New meeting debrief: Asks you 7 questions.')
    fireEvent.click(within(preview).getByTestId('extension-turn-on'))
    await waitFor(() => expect(within(row('local.meeting-debrief')).getByTestId('extension-rollback')).toHaveTextContent('Go back to version 1.0.0'))
    expect(registry.api.activate).toHaveBeenLastCalledWith(expect.objectContaining({ packageSha256: pkg.versions[0].sha, expectedActiveSha256: pkg.versions[1].sha }))

    fireEvent.click(within(row('local.meeting-debrief')).getByTestId('extension-rollback'))
    const confirm = await screen.findByTestId('extension-rollback-dialog')
    expect(confirm).toHaveTextContent('Notes it created stay as they are; use Page history to change a note.')
    await act(async () => { fireEvent.click(within(confirm).getByTestId('extension-rollback-confirm')) })
    await waitFor(() => expect(screen.getByTestId('extension-notice')).toHaveTextContent('Meeting debrief is back to version 1.0.0. Notes it created are unchanged.'))
    expect(registry.api.activate).toHaveBeenLastCalledWith(expect.objectContaining({ packageSha256: pkg.versions[1].sha, expectedActiveSha256: pkg.versions[0].sha }))
    expect(registry.api.submitProposal).not.toHaveBeenCalled()
  })

  it('turns off without asking, and back on the same reviewed version without a preview', async () => {
    const registry = fakeRegistry([await packageOf([MEETING], 'newest')])
    await renderSettings(registry)
    fireEvent.click(within(row('local.meeting-debrief')).getByTestId('extension-switch'))
    await waitFor(() => expect(screen.getByTestId('extension-notice')).toHaveTextContent('Meeting debrief is off. Notes it created stay in your workspace.'))
    fireEvent.click(within(row('local.meeting-debrief')).getByTestId('extension-switch'))
    await waitFor(() => expect(within(row('local.meeting-debrief')).getByTestId('extension-chip')).toHaveTextContent('On'))
    expect(screen.queryByTestId('extension-preview-dialog')).not.toBeInTheDocument()
  })
})
