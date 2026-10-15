import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsPanel } from '../components/SettingsPanel'
import { REMOTE_FEATURES_ENABLED } from './localPolicy'
import type { Settings } from '../types'

describe('LeadingLight local settings', () => {
  it('keeps remote controls unavailable even when stored preferences opt in', () => {
    const onSave = vi.fn()
    const settings: Settings = {
      auto_pull_interval_minutes: 5,
      git_enabled: true,
      ai_features_enabled: true,
      autogit_enabled: true,
      automatic_update_checks_enabled: true,
      telemetry_consent: true,
      crash_reporting_enabled: true,
      analytics_enabled: true,
      anonymous_id: null,
      release_channel: null,
    }
    expect(REMOTE_FEATURES_ENABLED).toBe(false)
    render(<SettingsPanel open settings={settings} onSave={onSave} onClose={() => {}} />)
    expect(screen.queryByTestId('settings-ai-features-enabled')).not.toBeInTheDocument()
    expect(screen.queryByTestId('settings-release-channel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('settings-crash-reporting')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Enable AutoGit' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('settings-save'))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      git_enabled: false,
      ai_features_enabled: false,
      automatic_update_checks_enabled: false,
    }))
  })
})
