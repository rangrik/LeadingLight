import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogClose, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup, AlertDialogTitle } from "@/components/ui/alert-dialog";

interface ConfirmProps {
  title: string;
  description: ReactNode;
  confirm: string;
  onConfirm(): void | Promise<void>;
  destructive?: boolean;
}

// ConfirmDialog asks before doing something that cannot be undone. It is
// controlled, so a menu item or a button can open it.
export function ConfirmDialog({ open, onOpenChange, title, description, confirm, onConfirm, destructive }: ConfirmProps & { open: boolean; onOpenChange(open: boolean): void }) {
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
          <Button
            variant={destructive ? "destructive" : "default"}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

// ConfirmButton is a settings-row button that confirms first.
export function ConfirmButton({ label, disabled, ...props }: ConfirmProps & { label: ReactNode; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" variant="outline" className="min-w-24" disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} {...props} />
    </>
  );
}
