import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@leadinglight/ui/components/alert-dialog";
import { Button } from "@leadinglight/ui/components/button";
import { pageLabel } from "~/lib/labels";
import type { ObjectSummary } from "~/lib/objects";

export function DeletePageDialog({
  page,
  onCancel,
  onConfirm,
}: {
  page: ObjectSummary | null;
  onCancel: () => void;
  onConfirm: (id: string) => void;
}) {
  return (
    <AlertDialog onOpenChange={(open) => !open && onCancel()} open={page !== null}>
      <AlertDialogPopup className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{page ? pageLabel(page.title) : ""}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The page and everything in it will be removed.
            {page?.properties.role === "thoughts" && " Its notes leave their page too."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button onClick={() => page && onConfirm(page.id)} variant="destructive">
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
