import { createContext } from 'react'
import type { CommandAction } from '../../hooks/commands/types'
import { translate, type AppLocale } from '../../lib/i18n'

export interface BackupActions { backUp: () => void; restore: () => void }

/** Lets the workspace menu offer backup and restore without new status bar props. */
export const BackupActionsContext = createContext<BackupActions | null>(null)

export function buildBackupCommands(locale: AppLocale, actions: BackupActions): CommandAction[] {
  return [
    {
      id: 'back-up-workspace', label: translate(locale, 'leadinglight.backup.menu'), group: 'Settings', enabled: true,
      keywords: ['backup', 'back up', 'copy', 'export', 'archive', 'workspace'], execute: actions.backUp,
    },
    {
      id: 'restore-backup', label: translate(locale, 'leadinglight.restore.menu'), group: 'Settings', enabled: true,
      keywords: ['restore', 'backup', 'recover', 'import', 'workspace'], execute: actions.restore,
    },
  ]
}
