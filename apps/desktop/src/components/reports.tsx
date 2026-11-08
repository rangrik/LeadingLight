import { BlockEditor, type BlockEditorHandle, type EditorDoc } from "@leadinglight/editor/editor";
import { ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { cn } from "@leadinglight/ui/lib/utils";
import { linkHost } from "~/components/link-views";
import { RowIcon } from "~/components/page-icon";
import { visit } from "~/components/property-value";
import { useStreamAnchored } from "~/lib/anchor";
import { isTask } from "~/lib/assign";
import { assets } from "~/lib/assets";
import { openHref } from "~/lib/essay";
import { showTarget } from "~/lib/feed";
import { formatAgo } from "~/lib/format";
import { pageLabel } from "~/lib/labels";
import { isLive, liveContent } from "~/lib/live";
import { useNotesFor } from "~/lib/notes-for";
import { type ObjectSummary, objects } from "~/lib/objects";
import { iconFor, pageOf, savePage, space } from "~/lib/space";
import { FeedbackGroup } from "~/components/feedback";
import { Changes, previousOf, reviewable } from "~/components/review";
import { batchOf } from "~/lib/feedback";
import { reportOf } from "~/lib/work";

// What agents published beside a page (features/reports.feature): after the page's own words, each
// signed and dated and read as it was written. On a task the newest comes first and older ones fold.
// A report never changes, but takes sidenotes here as on its own page.

const titleOf = (id: string) => pageLabel(pageOf(id)?.title ?? "");

// Who wrote it and when; on the report's own page, what it is about.
export function ReportByline({ report, about, className }: { report: ObjectSummary; about?: boolean; className?: string }) {
  const meta = reportOf(report);
  const by = meta && pageOf(meta.by);
  if (!meta) return null;
  const go = (id: string) => (e: React.MouseEvent) => visit(id, e);
  return (
    <p className={cn("flex min-w-0 flex-wrap items-center gap-x-1.5 text-muted-foreground text-sm", className)} data-testid="report-byline">
      {by && (
        <button className="-ms-1 flex min-w-0 items-center gap-1.5 rounded-md px-1 font-medium text-foreground hover:bg-accent" onClick={go(by.id)} type="button">
          <RowIcon icon={iconFor(by)} />
          <span className="truncate">{pageLabel(by.title)}</span>
        </button>
      )}
      <span>· {formatAgo(meta.at)}</span>
      {meta.batch && pageOf(meta.batch) && (
        <span>
          ·{" "}
          <button className="underline-offset-2 hover:underline" onClick={go(meta.batch)} type="button">
            answers your feedback
          </button>
        </span>
      )}
      {/* Honest about what it left out (features/response.feature). */}
      {meta.answers?.some((a) => a.missing) && (
        <span className="text-destructive-foreground">
          · {meta.answers.filter((a) => !a.missing).length} of {meta.answers.length} points answered
        </span>
      )}
      {meta.corrects && pageOf(meta.corrects) && (
        <span>
          · corrects{" "}
          <button className="underline-offset-2 hover:underline" onClick={go(meta.corrects)} type="button">
            {titleOf(meta.corrects)}
          </button>
        </span>
      )}
      {about && pageOf(meta.to) && (
        <span>
          · about{" "}
          <button className="underline-offset-2 hover:underline" onClick={go(meta.to)} type="button">
            {titleOf(meta.to)}
          </button>
        </span>
      )}
    </p>
  );
}

// What a report rests on, each opening where its words are.
export function ReportSources({ report }: { report: ObjectSummary }) {
  const sources = reportOf(report)?.sources ?? [];
  if (!sources.length) return null;
  return (
    <p className="mt-3 text-muted-foreground text-sm" data-testid="report-sources">
      Rests on{" "}
      {sources.map((s, i) => (
        <span key={i}>
          {i > 0 && " · "}
          <button className="underline-offset-2 hover:text-foreground hover:underline" onClick={() => showTarget(s)} type="button">
            {s.quote ? `“${s.quote.length > 60 ? `${s.quote.slice(0, 60)}…` : s.quote}” in ${titleOf(s.page)}` : titleOf(s.page)}
          </button>
        </span>
      ))}
    </p>
  );
}

// Review and Open, at the end of a report's byline row.
const Actions = ({ id, onReview }: { id: string; onReview?: (id: string) => void }) => (
  <span className="ms-auto flex shrink-0 gap-1">
    {onReview && reviewable(id) && (
      <Button className="text-muted-foreground" onClick={() => onReview(id)} size="xs" variant="ghost">
        Review
      </Button>
    )}
    <Button className="text-muted-foreground" onClick={(e) => visit(id, e)} size="xs" variant="ghost">
      Open
    </Button>
  </span>
);

type OnNotes = (id: string, on: boolean) => void;
// Review mode: the report's words, or what changed since `changes`, the report before it.
type Reviewing = { changes?: string };
const VERDICTS = ["Keep", "Change", "Ask"];

function ReportBody({ report, onNotes, review }: { report: ObjectSummary; onNotes: OnNotes; review?: Reviewing }) {
  const editor = useRef<BlockEditorHandle>(null);
  const { notes, onNoteSteps } = useNotesFor(report, editor);
  // Read as it opens, with notes its own page hasn't saved yet.
  const [doc, setDoc] = useState<EditorDoc | null>();
  useEffect(() => {
    let live = true;
    const open = liveContent(report.id);
    (open ? Promise.resolve(open) : objects.get(report.id).then((o) => o?.content ?? null)).then((d) => live && setDoc(d), console.error);
    return () => void (live = false);
  }, [report.id]);
  const layout = useCallback((l: { notes: boolean }) => onNotes(report.id, l.notes), [onNotes, report.id]);
  useEffect(() => () => onNotes(report.id, false), [onNotes, report.id]);
  const title = pageLabel(report.title);
  if (doc === undefined) return null;
  return (
    <>
      {review?.changes && <Changes after={report.id} before={review.changes} />}
      {/* Kept while the changes show, so its notes and place come back as they were. */}
      <div className="pt-2" hidden={!!review?.changes}>
        <BlockEditor
          annotate
          assets={assets}
          content={doc}
          label={`Report: ${title}`}
          links={linkHost}
          notes={notes}
          onLayoutChange={layout}
          // Its own page, when open, saves the note; else this is the only editor of it.
          onNoteSteps={(steps) => {
            onNoteSteps?.(steps);
            if (!isLive(report.id) && editor.current) void savePage(report.id, { content: editor.current.getJSON() }).catch(() => {});
          }}
          openLink={openHref}
          ref={editor}
          verdicts={review ? VERDICTS : undefined}
        />
      </div>
    </>
  );
}

function ReportGroup({ report, folded, onNotes, onReview, review }: { report: ObjectSummary; folded: boolean; onNotes: OnNotes; onReview?: (id: string) => void; review?: Reviewing }) {
  // Opened for this visit only; a reload folds it again.
  const [open, setOpen] = useState(!folded);
  const title = pageLabel(report.title);
  if (review)
    return (
      // The column is the report's now: its title reads as the page's.
      <article aria-label={`Report: ${title}`} className="pt-6" data-report={report.id} data-reviewing>
        <ReportByline report={report} />
        <h1 className="mt-2 font-bold font-heading text-[2.25rem] leading-[1.2] tracking-tight">{title}</h1>
        <ReportBody onNotes={onNotes} report={report} review={review} />
        <ReportSources report={report} />
      </article>
    );
  if (!open)
    return (
      <article aria-label={`Report: ${title}`} className="mt-12 flex items-center gap-2 border-t py-2 first:mt-0 [[data-folded]+&]:mt-0" data-folded data-report={report.id}>
        {/* The title takes the room left, so every folded row keeps one line. */}
        <button aria-expanded={false} className="-ms-1 flex min-w-0 flex-1 basis-0 items-center gap-1 rounded-md px-1 font-medium text-sm hover:bg-accent" onClick={() => setOpen(true)} type="button">
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{title}</span>
        </button>
        {/* An agent named after a long task gives up its words before the title does. */}
        <ReportByline className="max-w-1/2 shrink-0 flex-nowrap whitespace-nowrap" report={report} />
        <Actions id={report.id} onReview={onReview} />
      </article>
    );
  return (
    // The first sits below the page's own room for drops; each after it, a section's gap below.
    <article aria-label={`Report: ${title}`} className="mt-12 scroll-mt-4 border-t pt-6 first:mt-0" data-report={report.id}>
      <div className="flex items-center gap-2">
        <ReportByline report={report} />
        <Actions id={report.id} onReview={onReview} />
      </div>
      <h2 className="mt-3 font-heading font-semibold text-2xl leading-tight tracking-tight">{title}</h2>
      <ReportBody onNotes={onNotes} report={report} />
      <ReportSources report={report} />
    </article>
  );
}

// The page's stream after its own words: agents' reports and the feedback sent on them, in the
// order made; on a task, newest first. In review mode, only the report under review.
export function Reports({ pageId, onNotes, onReview, review }: { pageId: string; onNotes: (on: boolean) => void; onReview?: (id: string) => void; review?: { report: string; changes: boolean } }) {
  const { pages } = space.use();
  const task = isTask(pages.find((p) => p.id === pageId));
  const list = pages.filter((p) => p.properties.parent === pageId && (reportOf(p) || batchOf(p))).sort((a, b) => (task ? b.createdAt - a.createdAt : a.createdAt - b.createdAt));
  const newest = task ? list.find((p) => reportOf(p)) : undefined;
  // Which reports show notes, so the page keeps its margin for them.
  const [noted, setNoted] = useState<string[]>([]);
  const note = useCallback((id: string, on: boolean) => setNoted((n) => (n.includes(id) === on ? n : on ? [...n, id] : n.filter((x) => x !== id))), []);
  const any = noted.length > 0;
  useEffect(() => onNotes(any), [onNotes, any]);
  // Newest first puts what lands above what is being read.
  const stream = useRef<HTMLElement>(null);
  useStreamAnchored(stream);
  return (
    <section aria-label="Reports" className="ll-reports" hidden={!list.length} ref={stream}>
      {/* Reviewing, the rest stay mounted but hidden (styles.css), so Done finds the stream as it was. */}
      {list.map((r) =>
        reportOf(r) ? (
          <ReportGroup
            folded={task && r !== newest}
            key={r.id}
            onNotes={note}
            onReview={onReview}
            report={r}
            review={review?.report === r.id ? { changes: review.changes ? previousOf(r.id, pages)?.id : undefined } : undefined}
          />
        ) : (
          <FeedbackGroup feedback={r} key={r.id} />
        ),
      )}
    </section>
  );
}
