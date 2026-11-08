import { Check, ChevronRight, Play } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Checkbox } from "@leadinglight/ui/components/checkbox";
import { Table, TableBody, TableCaption, TableCell, TableRow } from "@leadinglight/ui/components/table";
import { toastManager } from "@leadinglight/ui/components/toast";
import { cn } from "@leadinglight/ui/lib/utils";
import { useProject } from "~/components/assign";
import { useFeed } from "~/components/feed";
import { RowIcon } from "~/components/page-icon";
import { visit } from "~/components/property-value";
import { useAnchored } from "~/lib/anchor";
import { accept, afterOf, agentOfTask, carryOn, isTask, readySubtasks, startReady } from "~/lib/assign";
import { byUrgency, type RowState } from "~/lib/breakdown";
import { showBar } from "~/lib/bar";
import { feedFocus } from "~/lib/feed";
import { formatAgo } from "~/lib/format";
import { pageLabel } from "~/lib/labels";
import { whenLive } from "~/lib/live";
import type { ObjectSummary } from "~/lib/objects";
import { iconFor, pageOf, propOf, space } from "~/lib/space";
import { reportOf, reportsOn, subtasksOf, workOf } from "~/lib/work";
import { sessions, STATE_LABEL, stateOf, watchWork } from "~/lib/work-watch";

// The Work table (features/work-table.feature): one row per task with its agent, state, steps,
// latest report and the one press it wants. On a task's card its rows are the subtasks; on a
// project page, the project's tasks at work. Below 720 px the agent and report go under the title.

const name = (id: string) => pageLabel(pageOf(id)?.title ?? "");
const done = (p: ObjectSummary) => p.properties.done === true;
const fail = (e: Error) => toastManager.add({ type: "error", title: "That didn't go", description: e.message });
// Every cell starts with a 24 px line, so text and buttons share one baseline whatever wraps.
const cell = "h-8 py-1 align-top leading-5";
const line = "flex h-6 min-w-0 items-center";

// Opens the task with the report under its words in view, unfolded.
function openReport(task: string, report: string, e: React.MouseEvent) {
  visit(task, e);
  whenLive(task, () =>
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-pane-page="${CSS.escape(task)}"] [data-report="${CSS.escape(report)}"]`);
      el?.querySelector<HTMLButtonElement>("button[aria-expanded=false]")?.click();
      requestAnimationFrame(() => el?.scrollIntoView({ block: "start", behavior: "smooth" }));
    }),
  );
}

type Row = { task: ObjectSummary; state: RowState; at: number };

function WorkRow({ row, parent, ready, ask }: { row: Row; parent?: string; ready: boolean; ask?: { id: string; reason: string } }) {
  const { task, state } = row;
  const agent = agentOfTask(task);
  const subs = subtasksOf(task.id);
  const checklist = workOf(agent)?.checklist ?? [];
  const steps = subs.length ? `${subs.filter(done).length} of ${subs.length}` : checklist.length ? `${checklist.filter((s) => s.done).length} of ${checklist.length}` : "";
  const latest = reportsOn(task.id).at(-1);
  const own = agent && reportsOn(task.id).filter((r) => reportOf(r)?.by === agent.id).at(-1);
  const waits = afterOf(task).filter((id) => !done(pageOf(id)!));
  const later = state === "new" && waits.length ? `after ${waits.map(name).join(", ")}` : "";
  const who = agent ? pageLabel(agent.title).split(": ")[0] : "";
  const label = state === "new" ? "Not started" : STATE_LABEL[state];
  const act = (fn: () => Promise<unknown>) => () => void fn().catch(fail);
  // The question's own words: the row names its agent already.
  const asked = ask?.reason.replace(/^.*? (?:asks|says): /, "");
  const report = asked ? (
    <span className="truncate">{asked}</span>
  ) : (
    latest && (
      <button className="flex min-w-0 items-baseline gap-1 hover:text-foreground" onClick={(e) => openReport(task.id, latest.id, e)} type="button">
        <span className="truncate">{pageLabel(latest.title)}</span>
        <span className="shrink-0">· {formatAgo(latest.createdAt)}</span>
      </button>
    )
  );
  // One look for every action, so their right edges line up.
  const action =
    state === "input" ? (
      <Button onClick={() => (ask && feedFocus.set(ask.id), showBar("inbox", "needs"))} size="xs" variant="outline">
        Answer
      </Button>
    ) : state === "review" && subs.every(done) ? (
      <Button onClick={act(() => accept(task.id, own?.id))} size="xs" variant="outline">
        <Check className="size-3.5" />
        Accept
      </Button>
    ) : (state === "idle" || state === "stopped") && agent ? (
      <Button onClick={act(() => carryOn(agent.id))} size="xs" variant="outline">
        <Play className="size-3.5" />
        Continue
      </Button>
    ) : state === "new" && parent && ready ? (
      <Button onClick={act(() => startReady(parent, task.id))} size="xs" variant="outline">
        Start
      </Button>
    ) : null;
  const meta = [who, label, steps, report, later].filter(Boolean);
  const wide = "hidden @min-[720px]/work:table-cell";
  return (
    <TableRow data-task={task.id}>
      <TableCell className={cn(cell, "w-full max-w-0 px-0 @min-[720px]/work:pe-2.5")}>
        <div className={cn(line, "gap-2")}>
          {state === "done" ? <Checkbox aria-label="Done" checked readOnly /> : <RowIcon icon={iconFor(task)} />}
          <button
            className={cn("min-w-0 flex-1 basis-0 truncate text-left font-medium underline-offset-2", state === "done" ? "text-muted-foreground line-through" : "hover:underline")}
            onClick={(e) => visit(task.id, e)}
            type="button"
          >
            {pageLabel(task.title)}
          </button>
          {action && <span className="shrink-0 @min-[720px]/work:hidden">{action}</span>}
        </div>
        {/* Narrow: what the columns say, under the title; each part whole or cut, its dot with it. */}
        <div className="ms-6 whitespace-normal text-muted-foreground @min-[720px]/work:hidden">
          {meta.map((m, i) => (
            <Fragment key={i}>
              <span className="inline-flex max-w-full gap-1 align-top">
                {typeof m === "string" ? <span className="truncate">{m}</span> : m}
                {i < meta.length - 1 && <span>·</span>}
              </span>{" "}
            </Fragment>
          ))}
        </div>
      </TableCell>
      <TableCell className={cn(cell, wide, "text-muted-foreground")}>{who && <span className={line}>{who}</span>}</TableCell>
      <TableCell className={cn(cell, wide, "text-muted-foreground")} data-state={state}>
        <span className={line}>{label}</span>
      </TableCell>
      <TableCell className={cn(cell, wide, "text-muted-foreground tabular-nums")}>{steps && <span className={line}>{steps}</span>}</TableCell>
      <TableCell className={cn(cell, wide, "text-muted-foreground")}>
        <span className={cn(line, "max-w-56")}>{report}</span>
      </TableCell>
      <TableCell className={cn(cell, wide, "pe-0 text-right")}>
        <span className={cn(line, "justify-end")}>
          {action}
          {later && <span className="max-w-48 truncate text-muted-foreground">{later}</span>}
        </span>
      </TableCell>
    </TableRow>
  );
}

export function WorkTable({ tasks, parent, label, className }: { tasks: ObjectSummary[]; parent?: string; label: string; className?: string }) {
  const live = sessions.use();
  const asks = useFeed().filter((i) => i.kind === "question" || i.kind === "approval");
  const [open, setOpen] = useState(false);
  const project = useProject(parent ?? "");
  useEffect(() => watchWork(), []);
  const ready = parent && project ? readySubtasks(parent).map((s) => s.id) : [];
  const rows: Row[] = tasks
    .map((task) => {
      const agent = agentOfTask(task);
      const started = agent || subtasksOf(task.id).some((s) => agentOfTask(s));
      const state = done(task) ? "done" : started ? stateOf(task, agent, live) : "new";
      // Not started reads in the order it was made; the rest by their last change.
      const at = state === "new" ? task.createdAt : Math.max(task.updatedAt, agent?.updatedAt ?? 0, reportsOn(task.id).at(-1)?.createdAt ?? 0);
      return { task, at, state } as Row;
    })
    .sort(byUrgency);
  const finished = rows.filter((r) => r.state === "done");
  const askOf = (r: Row) => (r.state === "input" ? asks.find((i) => i.task === r.task.id || subtasksOf(r.task.id).some((s) => s.id === i.task)) : undefined);
  const show = (r: Row) => <WorkRow ask={askOf(r)} key={r.task.id} parent={parent} ready={ready.includes(r.task.id)} row={r} />;
  return (
    <div className={cn("@container/work", className)}>
      <Table>
        <TableCaption className="sr-only">{label}</TableCaption>
        <TableBody>
          {rows.filter((r) => r.state !== "done").map(show)}
          {finished.length > 0 && (
            <TableRow>
              <TableCell className={cn(cell, "ps-0")} colSpan={6}>
                <button aria-expanded={open} className={cn(line, "-ms-1 gap-1 text-muted-foreground hover:text-foreground")} onClick={() => setOpen(!open)} type="button">
                  <ChevronRight className={cn("size-4 transition-transform duration-150", open && "rotate-90")} />
                  {finished.length} done
                </button>
              </TableCell>
            </TableRow>
          )}
          {open && finished.map(show)}
        </TableBody>
      </Table>
    </div>
  );
}

// "Start the ready ones": every subtask whose After tasks are done, each with an agent of its own.
export function StartReady({ parent }: { parent: string }) {
  space.use();
  const project = useProject(parent);
  const [busy, setBusy] = useState(false);
  if (!project || !readySubtasks(parent).length) return null;
  return (
    <div>
      <Button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          startReady(parent)
            .catch(fail)
            .finally(() => setBusy(false));
        }}
        size="xs"
        variant="outline"
      >
        Start the ready ones
      </Button>
    </div>
  );
}

// A project's tasks at work, under its properties: those with an agent or started subtasks.
export function ProjectWork({ pageId }: { pageId: string }) {
  const { pages } = space.use();
  const box = useRef<HTMLDivElement>(null);
  useAnchored(box);
  const ofProject = (p: ObjectSummary) => Object.entries(p.properties).some(([k, v]) => propOf(k)?.kind === "relation" && propOf(k)?.options.type === "project" && Array.isArray(v) && v.includes(pageId));
  const tasks = pages.filter((p) => isTask(p) && !(p.properties["subtask-of"] as string[] | undefined)?.length && ofProject(p) && (agentOfTask(p) || subtasksOf(p.id, pages).some((s) => agentOfTask(s))));
  const going = tasks.filter((t) => !done(t)).length;
  return (
    <div ref={box}>
      {tasks.length > 0 && (
        <section aria-label="Work" className="mt-6 text-sm">
          <h2 className="mb-1 font-medium text-muted-foreground">Work · {going} in flight</h2>
          <WorkTable label="Tasks at work" tasks={tasks} />
        </section>
      )}
    </div>
  );
}
