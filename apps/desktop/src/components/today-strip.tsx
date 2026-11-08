import { History } from "lucide-react";
import { Fragment, useEffect, useMemo } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { toastManager } from "@leadinglight/ui/components/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { cn } from "@leadinglight/ui/lib/utils";
import { useDayRows } from "~/components/daily-bar";
import { useFeed } from "~/components/feed";
import { RowIcon } from "~/components/page-icon";
import { visit } from "~/components/property-value";
import { Row } from "~/components/work-panel";
import { tasksAtWork } from "~/components/work-table";
import { accept, agentOfTask } from "~/lib/assign";
import { showBar } from "~/lib/bar";
import { shiftDay, today } from "~/lib/daily";
import { feedFocus, feedItems } from "~/lib/feed";
import { fromIso } from "~/lib/format";
import { pageLabel } from "~/lib/labels";
import { localPrefs } from "~/lib/local-prefs";
import { iconFor, pageOf, space } from "~/lib/space";
import { reportOf, reportsOn, subtasksOf } from "~/lib/work";
import { sessions, stateOf, type TaskState, watchWork } from "~/lib/work-watch";

// Today's strip (features/today-strip.feature): each project in motion, most urgent first, its
// counts in words and the one press it wants; then where the person was yesterday.

const KINDS = [["input", "needs you"], ["review", "ready"], ["working", "working"], ["idle", "idle"]] as const;
type Kind = (typeof KINDS)[number][0];
const kindOf = (s: TaskState): Kind => (s === "starting" ? "working" : s === "stopped" || s === "done" ? "idle" : s);
const rank = (k: Kind) => KINDS.findIndex(([x]) => x === k);
const fail = (e: Error) => toastManager.add({ type: "error", title: "That didn't go", description: e.message });

function useProjects() {
  const { pages } = space.use();
  const live = sessions.use();
  const feed = useFeed();
  useEffect(() => watchWork(), []);
  // Every project's asks, whatever the Feed is filtered to.
  const asks = useMemo(() => feedItems().filter((i) => i.kind === "question" || i.kind === "approval"), [feed]);
  return pages
    .filter((p) => p.typeId === "project")
    .flatMap((project) => {
      const tasks = tasksAtWork(project.id, pages)
        .filter((t) => t.properties.done !== true)
        .map((task) => {
          const agent = agentOfTask(task);
          const at = Math.max(task.updatedAt, agent?.updatedAt ?? 0, reportsOn(task.id).at(-1)?.createdAt ?? 0);
          return { task, agent, kind: kindOf(stateOf(task, agent, live)), at };
        })
        .sort((a, b) => rank(a.kind) - rank(b.kind) || b.at - a.at);
      if (!tasks.length) return [];
      const counts = KINDS.flatMap(([k, word]) => {
        const n = tasks.filter((t) => t.kind === k).length;
        return n ? [`${n} ${word}`] : [];
      }).join(" · ");
      const top = tasks[0];
      // As on the Work table: Answer what is asked; Accept a ready task once its subtasks are done.
      const ask = asks.find((i) => tasks.some((t) => t.kind === "input" && (i.task === t.task.id || subtasksOf(t.task.id).some((s) => s.id === i.task))));
      const ready = tasks.find((t) => t.kind === "review" && subtasksOf(t.task.id).every((s) => s.properties.done === true));
      const report = ready?.agent ? reportsOn(ready.task.id).filter((r) => reportOf(r)?.by === ready.agent!.id).at(-1) : undefined;
      const action =
        top.kind === "input" ? (
          <Button onClick={() => (ask && feedFocus.set(ask.id), showBar("feed"))} size="xs" variant="outline">
            Answer
          </Button>
        ) : ready ? (
          <Tooltip>
            <TooltipTrigger render={<Button onClick={() => void accept(ready.task.id, report?.id).catch(fail)} size="xs" variant="outline" />}>Accept</TooltipTrigger>
            <TooltipPopup>Accept “{pageLabel(ready.task.title)}”</TooltipPopup>
          </Tooltip>
        ) : null;
      return [{ project, counts, action, rank: rank(top.kind), at: top.at }];
    })
    .sort((a, b) => a.rank - b.rank || b.at - a.at);
}

// The two pages last made or edited yesterday, as This day lists them, fixed at the day's first
// look so going back into one hides the line rather than naming the next.
const yesterday = localPrefs("ll.yesterday", { day: "", ids: [] as string[] });
function useYesterday() {
  const day = today();
  const start = fromIso(day).getTime();
  const { rows, ready } = useDayRows(shiftDay(day, -1), "", null);
  const kept = yesterday.use();
  const fresh = rows.filter((r) => r.p.updatedAt < start).slice(0, 2).map((r) => r.p.id);
  useEffect(() => void (ready && kept.day !== day && yesterday.set({ day, ids: fresh })), [ready, kept.day, day]);
  const shown = (kept.day === day ? kept.ids : fresh).flatMap((id) => pageOf(id) ?? []);
  return shown.some((p) => p.updatedAt >= start) ? [] : shown;
}

// Under Today's day bar.
export function TodayStrip() {
  const projects = useProjects();
  const was = useYesterday();
  if (!projects.length && !was.length) return null;
  const link = "inline-block truncate align-top text-foreground underline-offset-2 hover:underline";
  return (
    <section aria-label="Where things stand" className="flex flex-col gap-1">
      {projects.map(({ project, counts, action }) => (
        <Row className="flex-nowrap" data-project={project.id} key={project.id}>
          <RowIcon icon={iconFor(project)} />
          <button className="max-w-[60%] shrink-0 truncate underline-offset-2 hover:underline" onClick={(e) => visit(project.id, e)} type="button">
            {pageLabel(project.title)}
          </button>
          <span className="min-w-0 flex-1 basis-0 truncate text-muted-foreground">{counts}</span>
          {action}
        </Row>
      ))}
      {was.length > 0 && (
        <Row className="flex-nowrap text-muted-foreground" data-yesterday>
          <History className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 basis-0 truncate">
            Yesterday you were in{" "}
            {was.map((p, i) => (
              <Fragment key={p.id}>
                {i > 0 && " and "}
                <button className={cn(link, was.length > 1 ? "max-w-[38%]" : "max-w-[70%]")} onClick={(e) => visit(p.id, e)} type="button">
                  {pageLabel(p.title)}
                </button>
              </Fragment>
            ))}
          </span>
        </Row>
      )}
    </section>
  );
}
