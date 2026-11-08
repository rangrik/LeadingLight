import { LayoutDashboard, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Card, CardAction, CardDescription, CardHeader, CardPanel, CardTitle } from "@leadinglight/ui/components/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from "@leadinglight/ui/components/empty";
import { Table, TableBody } from "@leadinglight/ui/components/table";
import { toastManager } from "@leadinglight/ui/components/toast";
import { cn } from "@leadinglight/ui/lib/utils";
import { CaptureRow } from "~/components/capture-inbox";
import { useFeed } from "~/components/feed";
import { RowIcon } from "~/components/page-icon";
import { PagePane } from "~/components/page-view";
import { askFor, type Row, rowOf, workAction, workOn } from "~/components/work-table";
import { agentOfTask, isTask } from "~/lib/assign";
import { showBar } from "~/lib/bar";
import { byUrgency } from "~/lib/breakdown";
import { captureOf, setReviewed, toReview } from "~/lib/capture-inbox";
import { DAILY, dailyTitle, dayPage, today } from "~/lib/daily";
import { formatAgo } from "~/lib/format";
import { pageLabel } from "~/lib/labels";
import { whenLive } from "~/lib/live";
import { parentOf } from "~/lib/linked";
import type { ObjectSummary } from "~/lib/objects";
import { holder, openFrom, openPage, panes } from "~/lib/panes";
import { iconFor, listed, pageOf, space, typeOf } from "~/lib/space";
import { PAGE_TYPE } from "~/lib/store";
import { stoppedAt } from "~/lib/tail";
import { newPage } from "~/lib/templates";
import { relationsOf, workOf } from "~/lib/work";
import { heard, sessions, STATE_LABEL } from "~/lib/work-watch";

// The Desk (features/desk.feature): where things stand, apart from the daily note. A card with
// nothing to show is left out.

const PROJECT = "project";
// A title's line is as tall as the button beside it, so the two share a centre.
const TITLE = "leading-6";
const projectOf = (p: ObjectSummary) => relationsOf(p).map(pageOf).find((q) => q?.typeId === PROJECT);

export function Desk() {
  const { pages } = space.use();
  const live = sessions.use();
  const known = heard.use();
  const asks = useFeed().filter((i) => i.kind === "question" || i.kind === "approval");
  if (!pages.some((p) => listed(p) || p.typeId === DAILY)) return <EmptyDesk />;
  // Projects whose agents are at work, the one wanting you most first.
  const moving = pages
    .filter((p) => p.typeId === PROJECT)
    .map((project) => ({ project, rows: workOn(project.id, pages).map((t) => rowOf(t, live)).filter((r) => r.state !== "done").sort(byUrgency) }))
    .filter((m) => m.rows.length)
    .sort((a, b) => byUrgency(a.rows[0], b.rows[0]));
  return (
    <div className="@container/desk p-6">
      <div className="mx-auto grid max-w-5xl grid-cols-1 items-start gap-4 @4xl/desk:grid-cols-2">
        <Continue skip={new Set(moving.map((m) => m.project.id))} />
        {moving.map(({ project, rows }) => (
          <ProjectCard asks={asks} key={project.id} known={known} project={project} rows={rows} />
        ))}
        <TodayCard />
        <Captures />
      </div>
    </div>
  );
}

function EmptyDesk() {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LayoutDashboard />
        </EmptyMedia>
        <EmptyDescription>Your desk fills as you write, capture ideas and hand work to agents.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={() => void newPage(PAGE_TYPE).then((p) => openPage(p.id))}>
          <Plus />
          New page
        </Button>
      </EmptyContent>
    </Empty>
  );
}

// The three pages last edited, and where you stopped on them when tail knows.
function Continue({ skip }: { skip: Set<string> }) {
  const { pages } = space.use();
  const filing = new Set(toReview(pages).map((p) => p.id));
  const recent = pages
    .filter((p) => listed(p) && !typeOf(p.typeId).made && !parentOf(p) && !isTask(p) && !skip.has(p.id) && !filing.has(p.id))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 3);
  const key = recent.map((p) => `${p.id}:${p.updatedAt}`).join();
  const [stops, setStops] = useState<Record<string, string>>({});
  useEffect(() => {
    let stale = false;
    void Promise.all(recent.map(async (p) => [p.id, (await stoppedAt(p.id)) ?? ""] as const)).then((found) => !stale && setStops(Object.fromEntries(found)));
    return () => void (stale = true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!recent.length) return null;
  return (
    <Card aria-label="Continue" render={<section />}>
      <CardHeader>
        <CardTitle className={TITLE}>Continue</CardTitle>
      </CardHeader>
      <CardPanel>
        <ul className="flex flex-col gap-3 text-sm">
          {recent.map((p) => {
            const project = projectOf(p);
            return (
              <li key={p.id}>
                <div className="flex h-6 min-w-0 items-center gap-2">
                  <RowIcon icon={iconFor(p)} />
                  <button className="min-w-0 flex-1 basis-0 truncate text-left font-medium underline-offset-2 hover:underline" onClick={(e) => openFrom(p.id, e)} type="button">
                    {pageLabel(p.title)}
                  </button>
                  <span className="shrink-0 text-muted-foreground">{[project && pageLabel(project.title), formatAgo(p.updatedAt)].filter(Boolean).join(" · ")}</span>
                </div>
                {stops[p.id] && <p className="ms-6 truncate text-muted-foreground">You stopped at “{stops[p.id]}”</p>}
              </li>
            );
          })}
        </ul>
      </CardPanel>
    </Card>
  );
}

// A project in motion: each task at work, the one press it wants, its state and what its agent is doing.
// Until the runtime has answered every agent would read as stopped, so its rows keep their room unseen.
function ProjectCard({ project, rows, asks, known }: { project: ObjectSummary; rows: Row[]; asks: Parameters<typeof askFor>[0]; known: boolean }) {
  return (
    <Card aria-label={pageLabel(project.title)} render={<section />}>
      <CardHeader>
        <CardTitle className={cn(TITLE, "flex min-w-0 items-center gap-2")}>
          <RowIcon icon={iconFor(project)} />
          <span className="truncate">{pageLabel(project.title)}</span>
        </CardTitle>
        <CardAction>
          <Button onClick={(e) => openFrom(project.id, e)} size="xs" variant="ghost">
            Open
          </Button>
        </CardAction>
      </CardHeader>
      <CardPanel>
        <ul className={cn("flex flex-col gap-3 text-sm", !known && "invisible")}>
          {rows.map((row) => {
            const agent = agentOfTask(row.task);
            const who = agent ? pageLabel(agent.title).split(": ")[0] : "";
            const doing = row.state === "working" ? workOf(agent)?.activity : undefined;
            const action = workAction(row, askFor(asks, row));
            return (
              <li data-task={row.task.id} key={row.task.id}>
                <div className="flex h-6 min-w-0 items-center gap-1">
                  {who && <span className="shrink-0">{who}:</span>}
                  <button className="min-w-0 flex-1 basis-0 truncate text-left font-medium underline-offset-2 hover:underline" onClick={(e) => openFrom(row.task.id, e)} type="button">
                    {pageLabel(row.task.title)}
                  </button>
                  {action && <span className="ms-2 shrink-0">{action}</span>}
                </div>
                <p className="truncate text-muted-foreground">{[row.state === "new" ? "Not started" : STATE_LABEL[row.state], doing].filter(Boolean).join(" · ")}</p>
              </li>
            );
          })}
        </ul>
      </CardPanel>
    </Card>
  );
}

// Today's note, written in here unless it is open in a pane: a page is open in one place at most.
function TodayCard() {
  const [id, setId] = useState("");
  panes.use();
  const there = !!id && !!holder(id);
  useEffect(() => void dayPage(today()).then(setId), []);
  return (
    <Card aria-label="Today" render={<section />}>
      <CardHeader>
        <CardTitle className={TITLE}>Today</CardTitle>
        <CardDescription>{dailyTitle(today())}</CardDescription>
        <CardAction>
          <Button disabled={!id} onClick={(e) => openFrom(id, e)} size="xs" variant="ghost">
            Open
          </Button>
        </CardAction>
      </CardHeader>
      <CardPanel>
        {there ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <span className="min-w-0 flex-1">Today's note is already open.</span>
            <Button onClick={() => (openPage(id), whenLive(id, (p) => p.focus()))} size="xs" variant="outline">
              Go to it
            </Button>
          </div>
        ) : (
          id && <PagePane bare id={id} />
        )}
      </CardPanel>
    </Card>
  );
}

const SHOWN = 5;

// Captures not yet reviewed, each with its project and its tick, as the Captures panel has them.
function Captures() {
  const { pages } = space.use();
  const [undone, setUndone] = useState<{ id: string; title: string } | null>(null);
  const list = toReview(pages).sort((a, b) => captureOf(b)!.capturedAt - captureOf(a)!.capturedAt);
  if (!list.length && !undone) return null;
  const undo = (id: string) =>
    void setReviewed(id, false).then(
      () => setUndone(null),
      () => toastManager.add({ type: "error", title: "That couldn't be undone. Try again." }),
    );
  return (
    <Card aria-label="Captures to file" render={<section />}>
      <CardHeader>
        <CardTitle className={TITLE}>Captures to file</CardTitle>
        {list.length > SHOWN && (
          <CardAction>
            <Button onClick={() => showBar("captures")} size="xs" variant="ghost">
              See all {list.length}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardPanel>
        {undone && (
          <div className="mb-2 flex items-center gap-2 text-sm" role="status">
            <span className="min-w-0 flex-1 truncate">Marked reviewed: {undone.title}</span>
            <Button onClick={() => undo(undone.id)} size="xs" variant="ghost">
              Undo
            </Button>
          </div>
        )}
        <Table className="table-fixed">
          <TableBody>
            {list.slice(0, SHOWN).map((p) => (
              <CaptureRow key={p.id} onReviewed={() => setUndone({ id: p.id, title: pageLabel(p.title) })} page={p} panel reviewed={false} />
            ))}
          </TableBody>
        </Table>
      </CardPanel>
    </Card>
  );
}
