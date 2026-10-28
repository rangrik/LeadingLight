// COSS p-tabs-1 and p-table-1, with the app's existing page and property pickers.
import { Check, Folder, Inbox, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@leadinglight/ui/components/empty";
import { Table, TableBody, TableCaption, TableCell, TableRow } from "@leadinglight/ui/components/table";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@leadinglight/ui/components/tabs";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { RowIcon } from "~/components/page-icon";
import { PageChip, PagePicker, visit } from "~/components/property-value";
import { captured as capturedOf, captureOf, captureProject, discoverVoiceCaptures, setCaptureProject, setCaptureProperty, setReviewed } from "~/lib/capture-inbox";
import { pageLabel } from "~/lib/labels";
import type { ObjectSummary } from "~/lib/objects";
import { iconFor, pageOf, space } from "~/lib/space";

const labels = { idea: "Captured idea", web: "Saved webpage", voice: "Voice recording" };
const date = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const ids = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

// panel: in the bar, under its header, with the ticks as icons.
export function CaptureInbox({ panel = false }: { panel?: boolean }) {
  const { pages } = space.use();
  const [tab, setTab] = useState("pending");
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [undone, setUndone] = useState<{ id: string; title: string; reviewed: boolean } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState("");
  const alive = useRef(true);
  const load = () => {
    setLoading(true);
    setError("");
    void discoverVoiceCaptures().catch(() => { if (alive.current) setError("Some older recordings could not be loaded."); }).finally(() => { if (alive.current) setLoading(false); });
  };
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, []);
  const shown = capturedOf(pages).filter((page) => !!captureOf(page)!.reviewedAt === (tab === "reviewed"))
    .sort((a, b) => captureOf(b)!.capturedAt - captureOf(a)!.capturedAt);
  const undo = async () => {
    if (!undone || undoing) return;
    setUndoing(true);
    try { await setReviewed(undone.id, !undone.reviewed); setUndone(null); setUndoError(""); }
    catch { setUndoError("That review change could not be undone. Try again."); }
    finally { setUndoing(false); }
  };
  return (
    <div className={panel ? "px-4 pb-6" : "w-full max-w-[1000px] px-6 pt-10 pb-24 @sm:px-12"}>
      {!panel && <>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Captures</h1>
        <p className="mt-2 mb-6 text-sm text-muted-foreground">A place for what you save. Organise it when you are ready.</p>
      </>}
      {undone && <div className={panel ? "mb-3 flex items-center gap-2 text-sm" : "mb-3 flex flex-wrap items-center gap-2 text-sm"} role="status">
        <span className={panel ? "min-w-0 flex-1 truncate" : "min-w-0 truncate"}>{undone.reviewed ? "Marked reviewed" : "Returned to inbox"}: {undone.title}</span>
        <Button size="xs" variant="ghost" disabled={undoing} onClick={() => void undo()}>Undo</Button>
      </div>}
      {undoError && <p className="mb-3 text-sm text-destructive" role="alert">{undoError}</p>}
      {error && <div className="mb-3 flex flex-wrap items-center gap-2 text-sm" role="alert">
        <span>{error}</span><Button size="xs" variant="outline" disabled={loading} onClick={load}>Retry loading</Button>
      </div>}
      <Tabs value={tab} onValueChange={(value) => { setTab(String(value)); setLimit(50); }}>
        <TabsList aria-label="Capture status">
          <TabsTab value="pending">To review</TabsTab>
          <TabsTab value="reviewed">Reviewed</TabsTab>
        </TabsList>
        {["pending", "reviewed"].map((value) => <TabsPanel key={value} value={value}>
          {value === tab && (shown.length ? <>
            <Table className="table-fixed">
              <TableCaption className="sr-only">{tab === "reviewed" ? "Reviewed captures" : "Captures to review"}</TableCaption>
              <TableBody>{shown.slice(0, limit).map((page) => <CaptureRow key={page.id} page={page} panel={panel} reviewed={tab === "reviewed"}
                onReviewed={(reviewed) => { setUndoError(""); setUndone({ id: page.id, title: pageLabel(page.title), reviewed }); }} />)}</TableBody>
            </Table>
            {shown.length > limit && <Button className="mt-4" variant="outline" onClick={() => setLimit(limit + 50)}>Show more</Button>}
          </> : loading ? <p className="py-10 text-sm text-muted-foreground" role="status">Looking for saved recordings…</p> : error ? <p className="py-10 text-sm text-muted-foreground">Try loading again to check for older recordings.</p> : <Empty className="py-12">
            <EmptyHeader><EmptyMedia variant="icon"><Inbox /></EmptyMedia>
              <EmptyTitle>{tab === "reviewed" ? "No reviewed captures yet" : "Nothing waiting here"}</EmptyTitle>
              <EmptyDescription>{tab === "reviewed" ? "Mark a capture reviewed when you are ready. Its page stays where it is." : "Ideas, webpages, and recordings from Quick capture appear here. Nothing needs doing right now."}</EmptyDescription>
            </EmptyHeader>
          </Empty>)}
        </TabsPanel>)}
      </Tabs>
    </div>
  );
}

function CaptureRow({ page, panel, reviewed, onReviewed }: { page: ObjectSummary; panel: boolean; reviewed: boolean; onReviewed: (value: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const capture = captureOf(page)!;
  const project = captureProject(page);
  const picked = pageOf(ids(page.properties[project.id])[0]);
  const tags = ids(page.properties.tags);
  const change = async (action: () => Promise<void>, success?: () => void) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try { await action(); success?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save the change. Try again."); }
    finally { saving.current = false; setBusy(false); }
  };
  const review = reviewed ? "Return to inbox" : "Mark reviewed";
  const tick = () => void change(() => setReviewed(page.id, !reviewed), () => onReviewed(!reviewed));
  return (
    <TableRow data-capture-id={page.id}>
      <TableCell className={panel ? "whitespace-normal px-0 py-3" : "whitespace-normal px-0 py-4"}>
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-[1_1_12rem]">
            <Button className="h-auto w-full min-w-0 justify-start px-0 py-1 text-left" variant="ghost" onClick={(event) => visit(page.id, event)}>
              <RowIcon icon={iconFor(page)} /><span className="min-w-0 flex-1 truncate">{pageLabel(page.title)}</span>
            </Button>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{labels[capture.kind]} · {date.format(capture.capturedAt)}</p>
          </div>
          {panel ? <Tooltip>
            {/* 2 px down: centred on the 32 px title button beside it. */}
            <TooltipTrigger render={<Button aria-label={review} className="mt-0.5" disabled={busy} onClick={tick} size="icon-sm" variant="ghost" />}>{reviewed ? <RotateCcw /> : <Check />}</TooltipTrigger>
            <TooltipPopup>{review}</TooltipPopup>
          </Tooltip> : <Button size="sm" variant="ghost" disabled={busy} onClick={tick}>
            {reviewed ? <RotateCcw /> : <Check />}{review}
          </Button>}
        </div>
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2" inert={busy}>
          <PagePicker label="Project" typeId="project" exclude={[]} onPick={(id) => void change(() => setCaptureProject(page, id))}
            onClear={picked ? () => void change(() => setCaptureProject(page, null)) : undefined}
            trigger={<Button aria-label="Project" className="max-w-full justify-start font-normal" size="sm" variant="outline">
              {picked ? <RowIcon icon={iconFor(picked)} /> : <Folder />}<span className="min-w-0 truncate">{picked ? pageLabel(picked.title) : "No project"}</span>
            </Button>} />
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {tags.filter((id) => pageOf(id)).map((id) => <PageChip key={id} id={id} onRemove={() => void change(() => setCaptureProperty(page.id, "tags", tags.filter((tag) => tag !== id)))} />)}
            <PagePicker label="Add tag" typeId="tag" exclude={tags} onPick={(id) => void change(() => setCaptureProperty(page.id, "tags", [...tags, id]))}
              trigger={<Button aria-label="Add tag" size="sm" variant="ghost">Add tag</Button>} />
          </div>
        </div>
        {error && <p role="alert" className="mt-2 text-sm leading-5 text-destructive">{error}</p>}
      </TableCell>
    </TableRow>
  );
}
