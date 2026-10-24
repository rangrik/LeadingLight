import { MessageSquareQuote, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@leadinglight/ui/components/dialog";
import { Field, FieldError, FieldLabel } from "@leadinglight/ui/components/field";
import { Textarea } from "@leadinglight/ui/components/textarea";
import { toastManager } from "@leadinglight/ui/components/toast";
import { visit } from "~/components/property-value";
import { batchOf, deliver, draftOf, drafts, pick, recipientFor, send, setComment } from "~/lib/feedback";
import { formatAgo } from "~/lib/format";
import { pageLabel } from "~/lib/labels";
import { liveContent } from "~/lib/live";
import { type ObjectSummary, objects } from "~/lib/objects";
import { pageOf, space } from "~/lib/space";

// Sending chosen sidenotes as one batch (features/feedback.feature): the button in a page's header
// while notes are chosen, the dialog that shows who gets what, and the batch in its task's stream.

const title = (id: string) => pageLabel(pageOf(id)?.title ?? "");
// "Claude", for the agent page "Claude: Write the summary".
const who = (id: string) => title(id).split(": ")[0];

// The chosen notes' words, as the Thoughts pages hold them now.
function useChosen(task: string) {
  const all = drafts.use();
  const picks = (all[task] ?? draftOf(task)).picks;
  const [shown, setShown] = useState<{ page: string; note: string; quote: string; text: string }[]>([]);
  const key = picks.map((p) => p.note).join(" ");
  useEffect(() => {
    let live = true;
    void Promise.all(
      picks.map(async (x) => {
        const thoughts = pageOf(x.page)?.properties.thoughts;
        const doc = typeof thoughts === "string" ? (liveContent(thoughts) ?? (await objects.get(thoughts))?.content) : null;
        const t = (doc?.content ?? []).find((n) => n.type === "thought" && n.attrs?.id === x.note);
        const text = (t?.content ?? []).map((b) => (b.content ?? []).map((c) => c.text ?? "").join("")).join("\n");
        return { ...x, quote: String(t?.attrs?.quote ?? ""), text };
      }),
    ).then((list) => live && setShown(list));
    return () => void (live = false);
  }, [key]);
  return shown;
}

function SendDialog({ task, agent, open, onOpenChange }: { task: string; agent: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const all = drafts.use();
  const draft = all[task] ?? draftOf(task);
  const chosen = useChosen(task);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = () => {
    setBusy(true);
    setError(null);
    send(task)
      .then((id) => {
        onOpenChange(false);
        const b = batchOf(pageOf(id));
        toastManager.add(b?.state === "sent" ? { type: "success", title: `Sent to ${who(agent)}`, timeout: 2500 } : { type: "error", title: `Not sent: ${b?.error ?? "it didn't go"}` });
      }, (e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send feedback to {who(agent)}</DialogTitle>
          <DialogDescription>
            On “{title(task)}”. Only these notes go, each with the words it is about; your other notes stay yours. It answers them in one new report.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <ol className="flex flex-col gap-3 text-sm">
            {chosen.map((c, i) => (
              <li className="flex items-start gap-2" key={c.note}>
                <span className="w-4 shrink-0 font-semibold tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-muted-foreground">“{c.quote}” in {title(c.page)}</span>
                  <span className="block whitespace-pre-wrap">{c.text || <span className="text-muted-foreground">(no words yet)</span>}</span>
                </span>
                <Button aria-label={`Leave out note ${i + 1}`} onClick={() => pick(task, c.page, c.note, false)} size="icon-xs" variant="ghost">
                  <X className="size-4" />
                </Button>
              </li>
            ))}
          </ol>
          <Field invalid={!!error}>
            <FieldLabel>Overall comment</FieldLabel>
            <Textarea onChange={(e) => setComment(task, e.currentTarget.value)} placeholder="Optional" rows={2} value={draft.comment} />
            {error && <FieldError match>{error}</FieldError>}
          </Field>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button disabled={busy || !draft.picks.length} onClick={go}>
            {busy ? "Sending…" : `Send ${draft.picks.length} ${draft.picks.length === 1 ? "note" : "notes"}`}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

// In a page's header while notes on its task are chosen.
export function FeedbackButton({ pageId, className }: { pageId: string; className?: string }) {
  space.use();
  const all = drafts.use();
  const [open, setOpen] = useState(false);
  const to = recipientFor(pageId);
  const n = to ? (all[to.task]?.picks.length ?? 0) : 0;
  if (!to || (!n && !open)) return null;
  return (
    <>
      <Button className={className} onClick={() => setOpen(true)} size="xs" variant="outline">
        <MessageSquareQuote className="size-4" />
        Send feedback · {n}
      </Button>
      <SendDialog agent={to.agent} onOpenChange={setOpen} open={open} task={to.task} />
    </>
  );
}

const STATE = { sending: "Sending…", sent: "Sent", failed: "Not sent" };

// A batch sent from this task, in its stream: the person's own words, so no agent signs it.
export function FeedbackGroup({ feedback }: { feedback: ObjectSummary }) {
  const b = batchOf(feedback)!;
  return (
    <article aria-label={`Feedback: ${b.points.length} points`} className="mt-12 border-t pt-6 text-sm first:mt-0" data-feedback={feedback.id}>
      <div className="flex items-center gap-2">
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-muted-foreground">
          <span className="font-medium text-foreground">You sent feedback</span>
          <span>
            · {b.points.length} {b.points.length === 1 ? "point" : "points"} to {who(b.agent)} · {formatAgo(b.sentAt ?? b.at)} ·
          </span>
          <span className={b.state === "failed" ? "text-destructive-foreground" : undefined} data-batch-state={b.state}>
            {STATE[b.state]}
            {b.state === "failed" && b.error ? `: ${b.error}` : ""}
          </span>
        </p>
        {b.state === "failed" && (
          <Button onClick={() => void deliver(feedback.id)} size="xs" variant="outline">
            Try again
          </Button>
        )}
        <Button className="ms-auto text-muted-foreground" onClick={(e) => visit(feedback.id, e)} size="xs" variant="ghost">
          Open
        </Button>
      </div>
      <ol className="mt-3 flex flex-col gap-2">
        {b.points.map((x) => (
          <li className="flex gap-2" key={x.id}>
            <span className="w-4 shrink-0 font-semibold tabular-nums">{x.id.slice(1)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-muted-foreground">“{x.quote}”</span>
              <span className="block whitespace-pre-wrap">{x.text}</span>
            </span>
          </li>
        ))}
      </ol>
      {b.comment && <p className="mt-2 whitespace-pre-wrap">{b.comment}</p>}
    </article>
  );
}
