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
import { batchOf } from "~/lib/feedback";
import { createStore } from "~/lib/state";
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

const OpenButton = ({ id }: { id: string }) => (
  <Button className="ms-auto text-muted-foreground" onClick={(e) => visit(id, e)} size="xs" variant="ghost">
    Open
  </Button>
);

type OnNotes = (id: string, on: boolean) => void;

function ReportBody({ report, onNotes }: { report: ObjectSummary; onNotes: OnNotes }) {
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
    <div className="pt-2">
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
      />
    </div>
  );
}

// The blocks of a report that changed since its agent's last one, marked a moment (work-panel.tsx).
const marked = createStore<{ report: string; blocks: number[]; at: number; scope: Element } | null>(null);
export const showChanges = (from: HTMLElement, report: string, blocks: number[]) => {
  const scope = from.closest(".ll-page");
  if (scope) marked.set({ report, blocks, at: Date.now(), scope });
};

// A 2 px bar beside each block, faded after two seconds; drawn beside the editor, never in it.
function ChangeBars({ blocks, at }: { blocks: number[]; at: number }) {
  const origin = useRef<HTMLDivElement>(null);
  const [bars, setBars] = useState<React.CSSProperties[]>([]);
  const [fade, setFade] = useState(false);
  useEffect(() => {
    let frame = 0;
    let tries = 0;
    const timers: number[] = [];
    // The report may still be opening: its blocks are looked for each frame, for a second or two.
    const place = () => {
      const o = origin.current;
      const els = blocks.map((i) => o?.parentElement?.querySelector(".ll-editor")?.children[i]);
      if (!o || !els.every(Boolean)) return void (tries++ < 120 && (frame = requestAnimationFrame(place)));
      const r0 = o.getBoundingClientRect();
      setFade(false);
      setBars(els.map((el) => { const r = el!.getBoundingClientRect(); return { top: r.top - r0.top, height: r.height, left: r.left - r0.left - 12 }; }));
      els[0]!.scrollIntoView({ block: "center", behavior: "smooth" });
      timers.push(window.setTimeout(() => setFade(true), 2000), window.setTimeout(() => setBars([]), 2200));
    };
    place();
    return () => (cancelAnimationFrame(frame), timers.forEach(clearTimeout));
  }, [blocks, at]);
  return (
    <div aria-hidden className="pointer-events-none relative h-0" data-testid="change-bars" ref={origin}>
      {bars.map((style, i) => (
        <span className={cn("absolute w-0.5 rounded-full bg-info transition-opacity duration-200 ease-out", fade && "opacity-0")} data-change-bar key={i} style={style} />
      ))}
    </div>
  );
}

function ReportGroup({ report, folded, onNotes }: { report: ObjectSummary; folded: boolean; onNotes: OnNotes }) {
  // Opened for this visit only; a reload folds it again.
  const [open, setOpen] = useState(!folded);
  const box = useRef<HTMLElement>(null);
  const mark = marked.use();
  const [mine, setMine] = useState<{ blocks: number[]; at: number } | null>(null);
  useEffect(() => {
    // Asked from this page just now, so a later visit doesn't mark it again.
    if (mark?.report !== report.id || !box.current || !mark.scope.contains(box.current) || Date.now() - mark.at > 1500) return;
    setOpen(true);
    setMine(mark);
    const t = window.setTimeout(() => setMine(null), 2400);
    return () => window.clearTimeout(t);
  }, [mark, report.id]);
  const title = pageLabel(report.title);
  if (!open)
    return (
      <article aria-label={`Report: ${title}`} className="mt-12 flex items-center gap-2 border-t py-2 first:mt-0 [[data-folded]+&]:mt-0" data-folded data-report={report.id} ref={box}>
        {/* The title takes the room left, so every folded row keeps one line. */}
        <button aria-expanded={false} className="-ms-1 flex min-w-0 flex-1 basis-0 items-center gap-1 rounded-md px-1 font-medium text-sm hover:bg-accent" onClick={() => setOpen(true)} type="button">
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{title}</span>
        </button>
        {/* An agent named after a long task gives up its words before the title does. */}
        <ReportByline className="max-w-1/2 shrink-0 flex-nowrap whitespace-nowrap" report={report} />
        <OpenButton id={report.id} />
      </article>
    );
  return (
    // The first sits below the page's own room for drops; each after it, a section's gap below.
    <article aria-label={`Report: ${title}`} className="mt-12 scroll-mt-4 border-t pt-6 first:mt-0" data-report={report.id} ref={box}>
      {mine && <ChangeBars at={mine.at} blocks={mine.blocks} />}
      <div className="flex items-center gap-2">
        <ReportByline report={report} />
        <OpenButton id={report.id} />
      </div>
      <h2 className="mt-3 font-heading font-semibold text-2xl leading-tight tracking-tight">{title}</h2>
      <ReportBody onNotes={onNotes} report={report} />
      <ReportSources report={report} />
    </article>
  );
}

// The page's stream after its own words: agents' reports and the feedback sent on them, in the
// order made; on a task, newest first.
export function Reports({ pageId, onNotes }: { pageId: string; onNotes: (on: boolean) => void }) {
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
    <section aria-label="Reports" hidden={!list.length} ref={stream}>
      {list.map((r) => (reportOf(r) ? <ReportGroup folded={task && r !== newest} key={r.id} onNotes={note} report={r} /> : <FeedbackGroup feedback={r} key={r.id} />))}
    </section>
  );
}
