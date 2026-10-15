import { CircleNotch, FolderOpen, HardDrive, Plus } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { OnboardingShell } from '@/components/OnboardingShell'
import leadinglightIcon from '@/assets/leadinglight-icon.png'
import { createTranslator, type AppLocale } from '@/lib/i18n'
import { LEADINGLIGHT_NAME } from './brand'

interface LocalWelcomeProps {
  mode: 'welcome' | 'vault-missing'
  missingPath?: string
  locale?: AppLocale
  onCreateEmptyVault: () => void | Promise<void>
  onOpenFolder: () => void | Promise<void>
  creatingAction: 'template' | 'empty' | null
  error: string | null
}

type LocalAction = 'create' | 'open'

export function LocalWelcome({
  mode,
  missingPath,
  locale = 'en',
  onCreateEmptyVault,
  onOpenFolder,
  creatingAction,
  error,
}: LocalWelcomeProps) {
  const t = createTranslator(locale)
  const primaryButtonRef = useRef<HTMLButtonElement>(null)
  const inFlight = useRef(false)
  const lastAction = useRef<LocalAction>('create')
  const [activeAction, setActiveAction] = useState<LocalAction | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const busy = activeAction !== null || creatingAction !== null
  const creating = activeAction === 'create' || creatingAction !== null
  const displayError = busy ? null : (localError || error)

  useEffect(() => {
    // WKWebView can ignore autoFocus on the initial desktop screen.
    primaryButtonRef.current?.focus()
  }, [])

  async function runAction(action: LocalAction) {
    if (inFlight.current || creatingAction !== null) return
    inFlight.current = true
    lastAction.current = action
    setActiveAction(action)
    setLocalError(null)
    try {
      await (action === 'create' ? onCreateEmptyVault() : onOpenFolder())
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : typeof failure === 'string' ? failure : ''
      setLocalError(message || t('leadinglight.welcome.unexpectedError'))
    } finally {
      inFlight.current = false
      setActiveAction(null)
    }
  }

  return (
    <OnboardingShell
      className="overflow-y-auto bg-sidebar"
      contentClassName="my-auto w-full max-w-[460px] rounded-2xl border border-border bg-background p-7 shadow-sm sm:p-10"
      testId="welcome-screen"
    >
      <header className="mb-8">
        <img src={leadinglightIcon} alt="" className="mb-5 size-16" />
        <h1 className="m-0 text-[32px] font-semibold tracking-[-0.035em] text-foreground">
          {LEADINGLIGHT_NAME}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t('leadinglight.welcome.subtitle')}
        </p>
      </header>

      {mode === 'vault-missing' && (
        <section className="mb-6 rounded-lg border border-border bg-muted/40 p-4" aria-labelledby="local-welcome-missing-title">
          <h2 id="local-welcome-missing-title" className="text-sm font-medium text-foreground">
            {t('leadinglight.welcome.missingTitle')}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t('leadinglight.welcome.missingDescription')}
          </p>
          {missingPath && (
            <dl className="mt-3 text-xs">
              <dt className="mb-1 text-muted-foreground">{t('leadinglight.welcome.missingPath')}</dt>
              <dd className="m-0 break-all font-mono text-foreground">{missingPath}</dd>
            </dl>
          )}
        </section>
      )}

      <div className="space-y-4" aria-busy={busy}>
        <div>
          <Button
            ref={primaryButtonRef}
            type="button"
            size="lg"
            className="h-11 w-full justify-start gap-3 px-4"
            onClick={() => void runAction('create')}
            disabled={busy}
            data-testid="welcome-create-new"
          >
            {busy && creating ? <CircleNotch className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
            {busy && creating ? t('leadinglight.welcome.creating') : t('leadinglight.welcome.create')}
          </Button>
          <p className="mt-2 px-1 text-xs leading-relaxed text-muted-foreground">
            {t('leadinglight.welcome.createDescription')}
          </p>
        </div>
        <div>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-11 w-full justify-start gap-3 px-4 shadow-none"
            onClick={() => void runAction('open')}
            disabled={busy}
            data-testid="welcome-open-folder"
          >
            {activeAction === 'open' ? <CircleNotch className="animate-spin" aria-hidden="true" /> : <FolderOpen aria-hidden="true" />}
            {activeAction === 'open' ? t('leadinglight.welcome.opening') : t('leadinglight.welcome.open')}
          </Button>
          <p className="mt-2 px-1 text-xs leading-relaxed text-muted-foreground">
            {t('leadinglight.welcome.openDescription')}
          </p>
        </div>
      </div>

      {busy && (
        <p role="status" className="mt-5 text-xs leading-relaxed text-muted-foreground" data-testid="welcome-status">
          {creating ? t('leadinglight.welcome.createStatus') : t('leadinglight.welcome.openStatus')}
        </p>
      )}

      {displayError && (
        <div className="mt-5 rounded-lg border border-destructive/25 bg-destructive/5 p-4">
          <div role="alert" aria-live="assertive" data-testid="welcome-error">
            <p className="text-sm font-medium text-foreground">{t('leadinglight.welcome.errorTitle')}</p>
            <p className="mt-1 break-words text-xs leading-relaxed text-destructive">{displayError}</p>
          </div>
          <Button type="button" variant="outline" size="sm" className="mt-3 shadow-none" onClick={() => void runAction(lastAction.current)}>
            {t('leadinglight.welcome.retry')}
          </Button>
        </div>
      )}

      <p className="mt-8 flex items-center gap-2 border-t border-border pt-5 text-xs text-muted-foreground">
        <HardDrive size={15} aria-hidden="true" />
        {t('leadinglight.welcome.locality')}
      </p>
    </OnboardingShell>
  )
}
