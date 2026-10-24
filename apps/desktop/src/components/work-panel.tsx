import { Bot, Check, ChevronRight, MessagesSquare, Play, Square } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { cn } from "@leadinglight/ui/lib/utils";
import { openChat } from "~/components/assign";
import { visit } from "~/components/property-value";
import { accept, acceptedOf, agentOfTask, carryOn, isTask, start, stopAgent, syncWorkers, taskOfDocument } from "~/lib/assign";
import { openHref } from "~/lib/essay";
import { formatAgo } from "~/lib/format";
import { pageLabel } from "~/lib/labels";
import { objects, type ObjectSummary } from "~/lib/objects";
import { pageOf, space } from "~/lib/space";
import { reportOf, reportsOn, runOf, subtasksOf, workersOf, workOf } from "~/lib/work";
import { sessions, STATE_LABEL, stateOf, watchWork } from "~/lib/work-watch";

// An assigned task's work, under its title (features/task-work.feature): the widgets Activity
// (state, what the agent is doing, its workers), Checklist (its steps and subtasks) and Evidence
// (what its reports show). Routine updates change words in place; the checklist opens only on a
// click, and anything that grows above where the page is scrolled to is made up for, so the words
// being read never move.

const name = (id: string) => pageLabel(pageOf(id)?.title ?? "");
const Row = ({ children, className, ...rest }: { children: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex min-h-6 min-w-0 flex-wrap items-center gap-x-2 gap-y-1", className)} {...rest}>
    {children}
  </div>
);

// Keeps what is on screen in place when the box above it changes height, where the browser doesn't
// do so itself (WebKit has no scroll anchoring).
const anchors = typeof CSS !== "undefined" && CSS.supports("overflow-anchor", "auto");
function useAnchored(ref: React.RefObject<HTMLElement | null>) {
  const height = useRef(0);
  useLayoutEffect(() => {
    const el = ref.current;
    const scroller = el?.closest<HTMLElement>("[data-page-scroller]");
    if (!el || !scroller || anchors) return;
    height.current = el.offsetHeight;
    const ro = new ResizeObserver(() => {
      const delta = el.offsetHeight - height.current;
      height.current = el.offsetHeight;
      if (delta && el.getBoundingClientRect().bottom < scroller.getBoundingClientRect().top + 1) scroller.scrollTop += delta;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
}

export function ActivityWidget({ task, agent }: { task: ObjectSummary; agent: ObjectSummary }) {
  const live = sessions.use();
  const [failed, setFailed] = useState<string | null>(null);
  const run = runOf(agent)!;
  const state = stateOf(task, agent, live);
  const work = workOf(agent);
  const workers = workersOf(agent.id);
  const act = (fn: () => Promise<unknown>) => () => void fn().catch((e: Error) => setFailed(e.message));
  return (
    <div className="flex flex-col gap-1" data-widget="activity">
      <Row>
        <Bot className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <button className="min-w-0 truncate font-medium underline-offset-2 hover:underline" onClick={(e) => visit(agent.id, e)} type="button">
            {name(agent.id)}
          </button>
          <span className="shrink-0 text-muted-foreground" data-state={state}>
            {failed ? `Didn't go: ${failed}` : STATE_LABEL[state]}
          </span>
        </span>
        {state === "starting" && failed && (
          <Button onClick={() => (setFailed(null), act(() => start(agent.id))())} size="xs" variant="outline">
            Try again
          </Button>
        )}
        {state === "working" && (
          <Button onClick={act(() => stopAgent(agent.id))} size="xs" variant="ghost">
            <Square className="size-2.5 fill-current" />
            Stop
          </Button>
        )}
        {(state === "idle" || state === "stopped") && (
          <Button onClick={act(() => carryOn(agent.id))} size="xs" variant="ghost">
            <Play className="size-3.5" />
            Continue
          </Button>
        )}
        {run.conversation && (
          <Button onClick={() => openChat(run.location, run.conversation)} size="xs" variant="outline">
            <MessagesSquare className="size-4" />
            Chat
          </Button>
        )}
      </Row>
      {/* What it is doing, while it does; at rest the line would be stale. */}
      {work?.activity && (state === "working" || state === "input") && (
        <p className="ms-6 truncate text-muted-foreground">
          {work.activity} · {formatAgo(work.at)}
        </p>
      )}
      {workers.length > 0 && (
        <p className="ms-6 flex min-w-0 flex-wrap gap-x-3 text-muted-foreground">
          {workers.map((w) => {
            const s = live.get(runOf(w)?.session ?? "");
            const how = s?.agent_state === "running" ? "working" : s?.agent_state === "waiting" ? "waiting for you" : "finished";
            return (
              <button className="underline-offset-2 hover:underline" key={w.id} onClick={(e) => visit(w.id, e)} type="button">
                {runOf(w)?.agent === "codex" ? "Codex" : "Claude"} worker, {how}
              </button>
            );
          })}
        </p>
      )}
    </div>
  );
}

// The agent's own steps, then the subtasks made under the task; a count only from these.
export function ChecklistWidget({ task, agent }: { task: ObjectSummary; agent: ObjectSummary }) {
  const { pages } = space.use();
  const [open, setOpen] = useState(false);
  const steps = workOf(agent)?.checklist ?? [];
  const subs = subtasksOf(task.id, pages);
  const total = steps.length + subs.length;
  if (!total) return null;
  const done = steps.filter((s) => s.done).length + subs.filter((s) => s.properties.done === true).length;
  const item = (key: string, text: React.ReactNode, ticked: boolean) => (
    <li className="flex min-w-0 items-center gap-2" key={key}>
      <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-[4px] border", ticked && "border-transparent bg-foreground text-background")}>{ticked && <Check className="size-3" />}</span>
      <span className={cn("min-w-0 truncate", ticked && "text-muted-foreground line-through")}>{text}</span>
    </li>
  );
  return (
    <div className="ms-6" data-widget="checklist">
      <button aria-expanded={open} className="-ms-1 flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => setOpen(!open)} type="button">
        <ChevronRight className={cn("size-4 transition-transform duration-150", open && "rotate-90")} />
        {done} of {total} {total === 1 ? "step" : "steps"} done
      </button>
      {open && (
        <ul className="mt-1 ms-1 flex flex-col gap-1">
          {steps.map((s, i) => item(`s${i}`, s.text, !!s.done))}
          {subs.map((s) =>
            item(
              s.id,
              <button className={cn("underline-offset-2 hover:underline", s.properties.done === true && "line-through")} onClick={(e) => visit(s.id, e)} type="button">
                {pageLabel(s.title)}
              </button>,
              s.properties.done === true,
            ),
          )}
        </ul>
      )}
    </div>
  );
}

// What the task's reports show, small, each opening where it sits in its report.
export function EvidenceWidget({ task }: { task: ObjectSummary }) {
  const { pages } = space.use();
  const reports = reportsOn(task.id, pages);
  const [shown, setShown] = useState<{ href: string; src: string; kind: string; name: string }[]>([]);
  const key = reports.map((r) => r.id).join(" ");
  useEffect(() => {
    let live = true;
    void Promise.all(
      reports.map(async (r) => {
        const doc = await objects.get(r.id);
        return (doc?.content?.content ?? []).flatMap((n, i) => (["image", "video", "file"].includes(n.type ?? "") && n.attrs?.src ? [{ href: `ll:${r.id}#b${i + 1}`, src: n.attrs.src, kind: n.type!, name: n.attrs.name ?? "" }] : []));
      }),
    ).then((all) => live && setShown(all.flat().slice(-8)));
    return () => void (live = false);
  }, [key]);
  if (!shown.length) return null;
  return (
    <div className="ms-6 flex gap-2 overflow-x-auto pb-1" data-widget="evidence">
      {shown.map((e) => (
        <button aria-label={`Open ${e.name}`} className="h-12 shrink-0 overflow-hidden rounded-md border bg-muted transition-opacity duration-150 hover:opacity-80" key={e.href} onClick={() => openHref(e.href)} type="button">
          {e.kind === "image" ? <img alt="" className="h-full w-auto" src={e.src} /> : <span className="flex h-full items-center px-2 text-muted-foreground text-xs">{e.name}</span>}
        </button>
      ))}
    </div>
  );
}

// Ready for review: the report to read, and Accept; once accepted, when, and anything published since.
export function ReviewWidget({ task, agent }: { task: ObjectSummary; agent: ObjectSummary }) {
  const { pages } = space.use();
  const live = sessions.use();
  const state = stateOf(task, agent, live);
  const own = reportsOn(task.id, pages).filter((r) => reportOf(r)?.by === agent.id);
  const accepted = acceptedOf(task);
  const since = accepted ? reportsOn(task.id, pages).filter((r) => r.createdAt > accepted.at) : [];
  const last = own.at(-1);
  // Ready, or reported and at rest: the person can accept whenever satisfied.
  if ((state === "review" || state === "idle" || state === "stopped") && last)
    return (
      <Row className="ms-6" data-widget="review">
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {state === "review" ? "Read " : "Its latest report is "}
          <button className="text-foreground underline-offset-2 hover:underline" onClick={(e) => visit(last.id, e)} type="button">
            {pageLabel(last.title)}
          </button>
          {state === "review" ? ", then accept it or send feedback." : ". Accept it when you're satisfied."}
        </span>
        <Button onClick={() => void accept(task.id, last.id)} size="xs">
          <Check className="size-3.5" />
          Accept
        </Button>
      </Row>
    );
  if (state === "done")
    return (
      <div className="ms-6 text-muted-foreground" data-widget="review">
        {accepted ? `Accepted ${formatAgo(accepted.at)}` : "Done"}
        {since.length > 0 && (
          <>
            {" · "}
            {/* Late work is shown as new; it never undoes the acceptance. */}
            <button className="text-foreground underline-offset-2 hover:underline" onClick={(e) => visit(since.at(-1)!.id, e)} type="button">
              {since.length === 1 ? "a report" : `${since.length} reports`} since
            </button>
          </>
        )}
      </div>
    );
  return null;
}

// Under the title of an assigned task; on a page assigned through a task, that task.
export function WorkPanel({ pageId }: { pageId: string }) {
  const { pages } = space.use();
  const box = useRef<HTMLDivElement>(null);
  useAnchored(box);
  const page = pages.find((p) => p.id === pageId);
  const viaTask = page && !isTask(page) ? taskOfDocument(pageId) : undefined;
  const agent = agentOfTask(page);
  const run = runOf(agent);
  const live = sessions.use();
  useEffect(() => {
    if (!agent || !run) return;
    watchWork();
    // Not started (a reload or a restart while it started): started now, once.
    if (!run.conversation) void start(agent.id).catch(console.error);
    else void syncWorkers(agent.id).catch(console.error);
  }, [agent?.id, run?.conversation, live]);
  return (
    <div className="text-sm" ref={box}>
      {viaTask && (
        <p className="mt-2 flex items-center gap-2 text-muted-foreground" data-testid="work-row">
          <Bot className="size-4 shrink-0" />
          Assigned as the task
          <button className="font-medium text-foreground underline-offset-2 hover:underline" onClick={(e) => visit(viaTask.id, e)} type="button">
            {pageLabel(viaTask.title)}
          </button>
        </p>
      )}
      {page && agent && run && (
        <div className="mt-3 flex flex-col gap-1.5 rounded-lg border px-3 py-2.5" data-testid="work-row">
          <ActivityWidget agent={agent} task={page} />
          <ReviewWidget agent={agent} task={page} />
          <ChecklistWidget agent={agent} task={page} />
          <EvidenceWidget task={page} />
        </div>
      )}
    </div>
  );
}
