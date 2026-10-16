import type { VaultEntry } from '../../types'
import type { RetargetOption } from './RetargetNoteDialog'
import { RetargetNoteDialog } from './RetargetNoteDialog'
import { translate, type AppLocale } from '../../lib/i18n'

interface NoteRetargetingDialogsProps {
  locale?: AppLocale
  folderBusy?: boolean
  dialogState: { kind: 'type' | 'folder'; notePath: string } | null
  dialogEntry: VaultEntry | null
  typeOptions: RetargetOption[]
  folderOptions: RetargetOption[]
  onClose: () => void
  onSelectType: (type: string) => boolean | Promise<boolean>
  onSelectFolder: (folderPath: string) => boolean | Promise<boolean>
}

function typeDialogDescription(entry: VaultEntry | null): string {
  return entry
    ? `Set a new type for "${entry.title}".`
    : 'Select a type for the active note.'
}

export function NoteRetargetingDialogs({
  locale = 'en',
  folderBusy,
  dialogState,
  dialogEntry,
  typeOptions,
  folderOptions,
  onClose,
  onSelectType,
  onSelectFolder,
}: NoteRetargetingDialogsProps) {
  return (
    <>
      <RetargetNoteDialog
        open={dialogState?.kind === 'type'}
        title="Change Note Type"
        description={typeDialogDescription(dialogEntry)}
        searchPlaceholder="Search types"
        emptyMessage="No other note types available."
        options={typeOptions}
        onClose={onClose}
        onSelect={onSelectType}
        testIdPrefix="retarget-note-type"
      />
      <RetargetNoteDialog
        open={dialogState?.kind === 'folder'}
        busy={folderBusy}
        workingLabel={translate(locale, 'leadinglight.relocation.working')}
        currentLabel={translate(locale, 'leadinglight.relocation.current')}
        title={translate(locale, 'leadinglight.relocation.title')}
        description={translate(locale, 'leadinglight.relocation.description', { title: dialogEntry?.title ?? '' })}
        searchPlaceholder={translate(locale, 'leadinglight.relocation.search')}
        emptyMessage={translate(locale, 'leadinglight.relocation.empty')}
        options={folderOptions}
        onClose={onClose}
        onSelect={onSelectFolder}
        testIdPrefix="retarget-note-folder"
      />
    </>
  )
}
