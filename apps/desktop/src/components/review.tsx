import type { EditorDoc } from "@leadinglight/editor/editor";
import { Check, ChevronRight, GitCompareArrows } from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Kbd } from "@leadinglight/ui/components/kbd";
import { Toggle } from "@leadinglight/ui/components/toggle";
import { cn } from "@leadinglight/ui/lib/utils";
import { FeedbackButton } from "~/components/feedback";
import { accept, acceptedOf } from "~/lib/assign";
import { drafts, recipientFor } from "~/lib/feedback";
import { formatAgo } from "~/lib/format";
import { pageLabel } from "~/lib/labels";
import { docText } from "~/lib/objects";
import { showIn } from "~/lib/panes";
import { pageOf, space } from "~/lib/space";
import { reportOf, reportsOn, subtasksOf } from "~/lib/work";

// Review mode (features/review-mode.feature): one report read and answered on its task, in place.
// Only notes are stored; which report is under review lives in the open page, so a reload ends it.

// The diff renderer loads the first time Changes is turned on, never with the app.
const loadChanges = () => import("~/components/report-changes");
const ReportChanges = lazy(loadChanges);

// Reports on a task with an agent can be reviewed: there is someone to send notes to.
export const reviewable = (report: string) => !!recipientFor(report);

// A review asked for from the report's own page, picked up when its task opens in that pane.
const pending = new Map<string, string>();
export const pendingReview = (task: string) => pending.get(task) ?? null;
export const clearPending = (task: string) => void pending.delete(task);
export function reviewIn(pane: string, report: string) {
  const task = reportOf(pageOf(report))?.to;
  if (!task) return;
  pending.set(task, report);
  showIn(pane, task);
}

// The same agent's report before this one on the same task.
export function previousOf(report: string, pages = space.get().pages) {
  const meta = reportOf(pageOf(report));
  if (!meta) return;
  const own = reportsOn(meta.to, pages).filter((r) => reportOf(r)?.by === meta.by);
  const at = own.findIndex((r) => r.id === report);
  return at > 0 ? own[at - 1] : undefined;
}

// The task folded to one line: its title and the brief's first words; the chevron shows the brief.
export function ReviewHead({ task, content, open, onOpen, report, changes, onChanges }: { task: string; content: EditorDoc | null; open: boolean; onOpen: (open: boolean) => void; report: string; changes: boolean; onChanges: (on: boolean) => void }) {
  const { pages } = space.use();
  const before = previousOf(report, pages);
  const brief = docText(content).split("\n").find((l) => l.trim()) ?? "";
  useEffect(() => void (before && loadChanges().then((m) => m.warm(), console.error)), [before]);
  return (
    <div className="ll-review-head sticky top-0 z-10 flex h-11 items-center gap-2 border-b bg-background">
      <Button aria-expanded={open} className="-ms-2 min-w-0 flex-1 basis-0 justify-start" onClick={() => onOpen(!open)} size="sm" variant="ghost">
        <ChevronRight className={cn("text-muted-foreground transition-transform duration-150 ease-out", open && "rotate-90")} />
        {/* The brief gives way first; the title only once the brief is gone. */}
        <span className="min-w-0 truncate font-medium">{pageLabel(pageOf(task)?.title ?? "")}</span>
        <span className="min-w-0 flex-1 basis-0 truncate text-start font-normal text-muted-foreground">{brief}</span>
      </Button>
      {before && (
        <Toggle aria-label={`Changes since “${pageLabel(before.title)}”`} onPressedChange={onChanges} pressed={changes} size="sm" variant="outline">
          <GitCompareArrows />
          Changes
        </Toggle>
      )}
    </div>
  );
}

// At the pane's foot while reviewing: what is ticked, Send, Accept and Done.
export function ReviewBar({ task, report, onDone }: { task: string; report: string; onDone: () => void }) {
  const { pages } = space.use();
  const n = drafts.use()[task]?.picks.length ?? 0;
  const page = pageOf(task);
  const accepted = acceptedOf(page);
  const open = subtasksOf(task, pages).some((s) => s.properties.done !== true);
  return (
    <div aria-label="Review" className="sticky bottom-0 z-10 mt-auto flex h-11 shrink-0 items-center gap-2 border-t bg-background px-4 text-sm" role="toolbar">
      <span className="min-w-0 flex-1 truncate text-muted-foreground" data-testid="review-count">
        {n ? `${n} ${n === 1 ? "note" : "notes"} ticked` : "No notes ticked"}
      </span>
      <FeedbackButton card pageId={task} />
      {page?.properties.done === true ? (
        <span className="text-muted-foreground">{accepted ? `Accepted ${formatAgo(accepted.at)}` : "Done"}</span>
      ) : open ? (
        // A plan is accepted once its subtasks are done (DECISIONS 22).
        <span className="text-muted-foreground">Subtasks still open</span>
      ) : (
        <Button onClick={() => void accept(task, report)} size="xs" variant="outline">
          <Check className="size-3.5" />
          Accept
        </Button>
      )}
      <Button onClick={onDone} size="xs" variant="ghost">
        Done
        <Kbd>Esc</Kbd>
      </Button>
    </div>
  );
}

// On a report's own page, in its header: review it on its task, in this pane.
export function ReviewButton({ pane, page, className }: { pane: string; page: string; className?: string }) {
  space.use();
  if (!reportOf(pageOf(page)) || !reviewable(page)) return null;
  return (
    <Button className={className} onClick={() => reviewIn(pane, page)} size="xs" variant="outline">
      Review
    </Button>
  );
}

export function Changes({ before, after }: { before: string; after: string }) {
  return (
    <Suspense fallback={null}>
      <ReportChanges after={after} before={before} />
    </Suspense>
  );
}
