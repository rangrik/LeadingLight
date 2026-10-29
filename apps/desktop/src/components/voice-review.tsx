// Uses the shared COSS dialog and the editor's audio player.
import { MediaPlayer, type PageSelection, type VoiceReview } from "@leadinglight/editor/editor";
import { useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@leadinglight/ui/components/dialog";
import { Field, FieldDescription, FieldLabel } from "@leadinglight/ui/components/field";
import { Textarea } from "@leadinglight/ui/components/textarea";
import { TurnIntoPage } from "./turn-into-page";

export function VoiceReviewDialog({ review, sourceId, onClose }: { review: VoiceReview; sourceId: string; onClose: () => void }) {
  const [range, setRange] = useState({ from: 0, to: 0 });
  const [selection, setSelection] = useState<PageSelection | null>(null);
  const [error, setError] = useState("");
  const text = useRef<HTMLTextAreaElement>(null);
  const selected = review.text.slice(range.from, range.to);
  const close = () => { onClose(); requestAnimationFrame(review.restoreFocus); };
  if (selection) return <TurnIntoPage selection={selection} recording={{ pageId: sourceId, id: review.id }} onClose={onClose} />;
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogPopup finalFocus={false}>
      <DialogHeader>
        <DialogTitle>Review transcript</DialogTitle>
        <DialogDescription>Select a passage to keep as an idea or task. The original stays here.</DialogDescription>
      </DialogHeader>
      <DialogPanel className="grid gap-4">
        <MediaPlayer kind="audio" src={review.audio} />
        <Field>
          <FieldLabel>Original transcript</FieldLabel>
          <Textarea ref={text} readOnly value={review.text} className="min-h-40 max-h-72" onSelect={(event) => setRange({ from: event.currentTarget.selectionStart, to: event.currentTarget.selectionEnd })} />
          <FieldDescription>You can edit the transcript in the page. This is the original recording's text.</FieldDescription>
        </Field>
        <Button variant="outline" className="justify-self-start" size="sm" onClick={() => {
          text.current?.focus();
          text.current?.select();
          setRange({ from: 0, to: review.text.length });
        }}>Use whole transcript</Button>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Done</DialogClose>
        <Button disabled={!selected.trim()} onClick={() => {
          const next = review.select(range.from, range.to);
          if (next) setSelection(next);
          else setError("The source changed. Close this review and open it again.");
        }}>Create from selection</Button>
      </DialogFooter>
    </DialogPopup>
  </Dialog>;
}
