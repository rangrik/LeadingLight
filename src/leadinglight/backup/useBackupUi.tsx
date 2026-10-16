import { useCallback, useMemo, useState } from 'react'
import type { AppLocale } from '../../lib/i18n'
import type { BackupActions } from './backupActions'
import { BackupDialog, type WorkspaceGuard } from './BackupDialog'
import { RestoreDialog } from './RestoreDialog'

/** One dialog, owning at most one backup or restore; asking again while one is open changes nothing. */
export function useBackupUi({ locale, vaultPath, guard, openWorkspace }: {
  locale: AppLocale
  vaultPath: string
  guard: WorkspaceGuard
  openWorkspace: (path: string, label: string) => Promise<void>
}) {
  const [open, setOpen] = useState<'backup' | 'restore' | null>(null)
  const backUp = useCallback(() => setOpen(current => current ?? 'backup'), [])
  const restore = useCallback(() => setOpen(current => current ?? 'restore'), [])
  const close = useCallback(() => setOpen(null), [])
  const actions = useMemo<BackupActions>(() => ({ backUp, restore }), [backUp, restore])
  const dialog = open === 'backup' ? <BackupDialog locale={locale} vaultPath={vaultPath} guard={guard} onClose={close} />
    : open === 'restore' ? <RestoreDialog locale={locale} openWorkspace={openWorkspace} onClose={close} />
      : null
  return { actions, dialog }
}
