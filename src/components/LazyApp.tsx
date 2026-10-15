import { lazy } from 'react'
import { markStartupPhase } from '../lib/startupPerformance'

export const LazyApp = lazy(async () => {
  markStartupPhase('app_module_requested')
  const appModule = await import('../App.tsx')
  markStartupPhase('app_module_loaded')
  return appModule
})
