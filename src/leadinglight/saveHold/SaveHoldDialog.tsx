import { Button } from '../../components/ui/button'
import { DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { translate, type AppLocale } from '../../lib/i18n'

/** Confirms the one destructive recovery choice, naming the page whose unsaved changes go. */
export function SaveHoldDialog({ title, locale, onConfirm }: {
  title: string
  locale: AppLocale
  onConfirm: () => void
}) {
  return (
    <DialogContent data-testid="save-hold-dialog">
      <DialogHeader>
        <DialogTitle>{translate(locale, 'saveHold.dialog.title')}</DialogTitle>
        <DialogDescription>{translate(locale, 'saveHold.dialog.description', { title })}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose asChild><Button variant="outline">{translate(locale, 'saveHold.dialog.cancel')}</Button></DialogClose>
        <Button variant="destructive" onClick={onConfirm}>{translate(locale, 'saveHold.dialog.confirm')}</Button>
      </DialogFooter>
    </DialogContent>
  )
}
