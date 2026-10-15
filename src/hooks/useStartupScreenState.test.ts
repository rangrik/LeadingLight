import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useStartupScreenState } from './useStartupScreenState'

function startupOptions() {
  return {
    aiAgentsPromptVisible: false,
    isNoteWindow: false,
    onboardingState: { status: 'ready', vaultPath: '/tmp/synthetic-workspace' },
    runtimeMissingVaultPath: null as string | null,
    selectedVaultPath: '/tmp/synthetic-workspace' as string | null,
    settingsLoaded: true,
    showMcpSetupDialog: false,
    telemetryConsent: false as boolean | null,
    vaultIsLoading: false,
    vaultSwitcher: {
      allVaults: [{ path: '/tmp/synthetic-workspace' }],
      loaded: true,
      vaultPath: '/tmp/synthetic-workspace',
    },
  }
}

describe('useStartupScreenState local policy', () => {
  it('does not block a ready workspace for telemetry or AI onboarding preferences', () => {
    const { result } = renderHook(() => useStartupScreenState({
      ...startupOptions(),
      aiAgentsPromptVisible: true,
      telemetryConsent: null,
    }))

    expect(result.current.shouldShowStartupScreen).toBe(false)
  })

  it('keeps fresh default workspaces in local onboarding until a folder is chosen', () => {
    const { result } = renderHook(() => useStartupScreenState({
      ...startupOptions(),
      selectedVaultPath: null,
    }))

    expect(result.current.shouldResumeFreshStartOnboarding).toBe(true)
    expect(result.current.shouldShowStartupScreen).toBe(true)
  })

  it('shows recovery when the selected workspace disappears at runtime', () => {
    const { result } = renderHook(() => useStartupScreenState({
      ...startupOptions(),
      runtimeMissingVaultPath: '/tmp/synthetic-workspace',
    }))

    expect(result.current.shouldShowStartupScreen).toBe(true)
  })

  it('keeps startup overlays out of a standalone note window', () => {
    const { result } = renderHook(() => useStartupScreenState({
      ...startupOptions(),
      isNoteWindow: true,
      onboardingState: { status: 'welcome' },
    }))

    expect(result.current.shouldShowStartupScreen).toBe(false)
  })
})
