import { Send } from "lucide-react";
import { useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { toastManager } from "@leadinglight/ui/components/toast";
import { visit } from "~/components/property-value";
import { batchOf, deliver, drafts, recipientFor, send } from "~/lib/feedback";
import { formatAgo } from "~/lib/format";
import { pageLabel } from "~/lib/labels";
import type { ObjectSummary } from "~/lib/objects";
import { pageOf, space } from "~/lib/space";

// Sending ticked sidenotes as one batch (features/feedback.feature): one press on the task's card,
// or in a report's header, and the batch in its task's stream.

const title = (id: string) => pageLabel(pageOf(id)?.title ?? "");
// "Claude", for the agent page "Claude: Write the summary".
const who = (id: string) => title(id).split(": ")[0];

// "Send 3 notes" while notes on the task are ticked: on its card, and in a report's header (the
// task's own header leaves it to the card).
export function FeedbackButton({ pageId, card, className }: { pageId: string; card?: boolean; className?: string }) {
  space.use();
  const all = drafts.use();
  const [busy, setBusy] = useState(false);
  const to = recipientFor(pageId);
  const n = to ? (all[to.task]?.picks.length ?? 0) : 0;
  if (!to || (!card && to.task === pageId) || (!n && !busy)) return null;
  const go = () => {
    setBusy(true);
    send(to.task)
      .then((id) => {
        const b = batchOf(pageOf(id));
        toastManager.add(b?.state === "sent" ? { type: "success", title: `Sent to ${who(to.agent)}`, timeout: 2500 } : { type: "error", title: `Not sent: ${b?.error ?? "it didn't go"}` });
      }, (e: Error) => toastManager.add({ type: "error", title: `Not sent: ${e.message}` }))
      .finally(() => setBusy(false));
  };
  return (
    <Button className={className} disabled={busy} onClick={go} size="xs" variant="outline">
      <Send className="size-4" />
      {busy ? "Sending…" : `Send ${n} ${n === 1 ? "note" : "notes"}`}
    </Button>
  );
}

const STATE = { sending: "Sending…", sent: "Sent", failed: "Not sent" };

// A batch sent from this task, in its stream: the person's own words, so no agent signs it.
export function FeedbackGroup({ feedback }: { feedback: ObjectSummary }) {
  const b = batchOf(feedback)!;
  return (
    <article aria-label={`Feedback: ${b.points.length} ${b.points.length === 1 ? "point" : "points"}`} className="mt-12 border-t pt-6 text-sm first:mt-0" data-feedback={feedback.id}>
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
