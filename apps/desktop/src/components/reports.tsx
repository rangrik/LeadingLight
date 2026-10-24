import { BlockEditor, type EditorDoc } from "@leadinglight/editor/editor";
import { useEffect, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { linkHost } from "~/components/link-views";
import { RowIcon } from "~/components/page-icon";
import { visit } from "~/components/property-value";
import { assets } from "~/lib/assets";
import { openHref } from "~/lib/essay";
import { showTarget } from "~/lib/feed";
import { formatAgo } from "~/lib/format";
import { pageLabel } from "~/lib/labels";
import { type ObjectSummary, objects } from "~/lib/objects";
import { iconFor, pageOf, space } from "~/lib/space";
import { FeedbackGroup } from "~/components/feedback";
import { batchOf } from "~/lib/feedback";
import { reportOf } from "~/lib/work";

// What agents published beside a page (features/reports.feature): after the page's own words, oldest
// first, each signed and dated and read as it was written. A report never changes.

const titleOf = (id: string) => pageLabel(pageOf(id)?.title ?? "");

// Who wrote it and when; on the report's own page, what it is about.
export function ReportByline({ report, about }: { report: ObjectSummary; about?: boolean }) {
  const meta = reportOf(report);
  const by = meta && pageOf(meta.by);
  if (!meta) return null;
  const go = (id: string) => (e: React.MouseEvent) => visit(id, e);
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-muted-foreground text-sm" data-testid="report-byline">
      {by && (
        <button className="-ms-1 flex items-center gap-1.5 rounded-md px-1 font-medium text-foreground hover:bg-accent" onClick={go(by.id)} type="button">
          <RowIcon icon={iconFor(by)} />
          {pageLabel(by.title)}
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

function ReportGroup({ report }: { report: ObjectSummary }) {
  // Its words never change, so they are read once.
  const [doc, setDoc] = useState<EditorDoc | null>();
  useEffect(() => {
    let live = true;
    objects.get(report.id).then((o) => live && setDoc(o?.content ?? null), console.error);
    return () => void (live = false);
  }, [report.id]);
  const title = pageLabel(report.title);
  return (
    // The first sits below the page's own room for drops; each after it, a section's gap below.
    <article aria-label={`Report: ${title}`} className="mt-12 border-t pt-6 first:mt-0" data-report={report.id}>
      <div className="flex items-center gap-2">
        <ReportByline report={report} />
        <Button className="ms-auto text-muted-foreground" onClick={(e) => visit(report.id, e)} size="xs" variant="ghost">
          Open
        </Button>
      </div>
      <h2 className="mt-3 font-heading font-semibold text-2xl leading-tight tracking-tight">{title}</h2>
      {doc !== undefined && (
        <div className="pt-2">
          <BlockEditor assets={assets} content={doc} label={`Report: ${title}`} links={linkHost} openLink={openHref} readOnly />
        </div>
      )}
      <ReportSources report={report} />
    </article>
  );
}

// The page's stream after its own words: agents' reports and the feedback sent on them, in order.
export function Reports({ pageId }: { pageId: string }) {
  const { pages } = space.use();
  const list = pages.filter((p) => p.properties.parent === pageId && (reportOf(p) || batchOf(p))).sort((a, b) => a.createdAt - b.createdAt);
  if (!list.length) return null;
  return (
    <section aria-label="Reports">
      {list.map((r) => (reportOf(r) ? <ReportGroup key={r.id} report={r} /> : <FeedbackGroup feedback={r} key={r.id} />))}
    </section>
  );
}
