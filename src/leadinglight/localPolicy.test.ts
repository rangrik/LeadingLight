import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyLocalOnlySettings, MULTI_WORKSPACE_ENABLED, SEPARATE_WINDOWS_ENABLED } from './localPolicy'
import { areAiFeaturesEnabled } from '../lib/aiFeatures'
import { areGitFeaturesEnabled } from '../lib/gitSettings'
import { areAutomaticUpdateChecksEnabled } from '../lib/automaticUpdateChecks'
import { initPostHog, initSentry, trackEvent } from '../lib/telemetry'
import { useAiActivity } from '../hooks/useAiActivity'
import { useMcpBridge } from '../hooks/useMcpBridge'
import { useSettings } from '../hooks/useSettings'
import { useUpdater } from '../hooks/useUpdater'
import type { Settings } from '../types'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  sentryInit: vi.fn(),
  posthogInit: vi.fn(),
  socket: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@sentry/react', () => ({ init: mocks.sentryInit }))
vi.mock('posthog-js', () => ({ default: { init: mocks.posthogInit } }))
vi.mock('../mock-tauri', () => ({ isTauri: () => true }))

const optedIn: Settings = {
  auto_pull_interval_minutes: 5,
  telemetry_consent: true,
  crash_reporting_enabled: true,
  analytics_enabled: true,
  anonymous_id: 'synthetic-id',
  release_channel: 'stable',
  git_enabled: true,
  autogit_enabled: true,
  autogit_use_ai_commit_messages: true,
  ai_features_enabled: true,
  multi_workspace_enabled: true,
  automatic_update_checks_enabled: true,
  theme_mode: 'dark',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.invoke.mockImplementation((command: string) => Promise.resolve(command === 'get_settings' ? optedIn : null))
  vi.stubGlobal('WebSocket', mocks.socket)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('LeadingLight local-only boundary', () => {
  it('defers multiple writable workspaces and separate windows independently of remote features', () => {
    expect(MULTI_WORKSPACE_ENABLED).toBe(false)
    expect(SEPARATE_WINDOWS_ENABLED).toBe(false)
    expect(applyLocalOnlySettings(optedIn).multi_workspace_enabled).toBe(false)
  })
  it('keeps remote feature gates closed even for saved opt-ins', () => {
    expect(areAiFeaturesEnabled(optedIn)).toBe(false)
    expect(areGitFeaturesEnabled(optedIn)).toBe(false)
    expect(areAutomaticUpdateChecksEnabled(optedIn)).toBe(false)
    expect(applyLocalOnlySettings(optedIn)).toMatchObject({
      git_enabled: false,
      autogit_enabled: false,
      ai_features_enabled: false,
      automatic_update_checks_enabled: false,
      crash_reporting_enabled: false,
      analytics_enabled: false,
      anonymous_id: null,
      theme_mode: 'dark',
    })
  })

  it('never initializes telemetry even with embedded credentials', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.ingest.sentry.io/1')
    vi.stubEnv('VITE_POSTHOG_KEY', 'synthetic-key')
    initSentry('synthetic-id')
    await initPostHog('synthetic-id')
    trackEvent('synthetic_event')
    expect(mocks.sentryInit).not.toHaveBeenCalled()
    expect(mocks.posthogInit).not.toHaveBeenCalled()
  })

  it('does not connect activity or MCP sockets', async () => {
    renderHook(() => useAiActivity())
    const { result } = renderHook(() => useMcpBridge())
    await expect(result.current.readNote('/synthetic/note.md')).rejects.toThrow('local-only')
    expect(mocks.socket).not.toHaveBeenCalled()
  })

  it('blocks automatic and explicit update checks before native invocation', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useUpdater('stable', true))
    await act(async () => { vi.advanceTimersByTime(10_000) })
    await expect(result.current.actions.checkForUpdates()).resolves.toMatchObject({ kind: 'error' })
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('enforces the policy when loading and saving preferences', async () => {
    const { result } = renderHook(() => useSettings())
    expect(result.current.settings.analytics_enabled).toBe(false)
    await waitFor(() => { expect(result.current.loaded).toBe(true) })
    expect(result.current.settings.ai_features_enabled).toBe(false)
    await act(async () => { await result.current.saveSettings(optedIn) })
    expect(mocks.invoke).toHaveBeenCalledWith('save_settings', {
      settings: expect.objectContaining({
        git_enabled: false,
        autogit_enabled: false,
        analytics_enabled: false,
        crash_reporting_enabled: false,
        ai_features_enabled: false,
        automatic_update_checks_enabled: false,
        theme_mode: 'dark',
      }),
    })
  })
})
