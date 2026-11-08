import { agentOfTask, isTask } from "~/lib/assign";
import { rollUp } from "~/lib/breakdown";
import { onRuntimeEvent } from "~/lib/project-runtime/live";
import { ask } from "~/lib/project-runtime/transport";
import type { Session } from "~/lib/project-runtime/chat";
import { createStore } from "~/lib/state";
import type { ObjectSummary } from "~/lib/objects";
import { pageOf, space } from "~/lib/space";
import { reportOf, reportsOn, runOf, subtasksOf, workersOf } from "~/lib/work";

// Every agent's session as the runtime has it now, for the work shown on tasks and in the Feed,
// whichever pages are open. Read again when the runtime says an agent or a session changed.

export const sessions = createStore<Map<string, Session>>(new Map());
// Agents waiting to hear back from work they started (the runtime's watches): still at it.
let awaiting = new Set<string>();

let started = false;
let timer = 0;
const read = () => {
  window.clearTimeout(timer);
  timer = window.setTimeout(async () => {
    const [list, watches] = await Promise.all([ask<Session[]>("GET", "/v1/sessions").catch(() => null), ask<{ parent: string }[]>("GET", "/v1/notify").catch(() => null)]);
    if (watches) awaiting = new Set(watches.map((w) => w.parent));
    if (list) sessions.set(new Map(list.map((s) => [s.name, s])));
  }, 250);
};

// Followed once any page has an agent at work.
export function watchWork() {
  if (started || !space.get().pages.some((p) => runOf(p))) return;
  started = true;
  read();
  onRuntimeEvent((e) => (e.type === "runtime.connected" || e.type.startsWith("agent.") || e.type.startsWith("session.") || e.type === "request.changed") && read());
}

// How an assigned task is going (features/task-work.feature): from the runtime's sessions for its
// agent and the agent's workers, and its reports; with subtasks, theirs too. Done is the person's alone.
export type TaskState = "done" | "input" | "working" | "review" | "idle" | "stopped" | "starting";
export const STATE_LABEL: Record<TaskState, string> = { done: "Done", input: "Needs your input", working: "Working", review: "Ready for review", idle: "Idle", stopped: "Stopped", starting: "Starting…" };

// Its own agent's state and its started subtasks', rolled up (DECISIONS.md, 22).
export function stateOf(task: ObjectSummary, agent: ObjectSummary | undefined, live: Map<string, Session>, pending = 0): TaskState {
  if (task.properties.done === true) return "done";
  const subs = subtasksOf(task.id).flatMap((s) => {
    const a = agentOfTask(s);
    return a ? [agentState(s, a, live)] : [];
  });
  return rollUp(agent && agentState(task, agent, live, pending), subs) ?? "idle";
}

// How the agent given the task is going, its subtasks aside.
export function agentState(task: ObjectSummary, agent: ObjectSummary, live: Map<string, Session>, pending = 0): TaskState {
  if (task.properties.done === true) return "done";
  const run = runOf(agent);
  if (!run?.conversation) return "starting";
  const team = [agent, ...workersOf(agent.id)].map((a) => live.get(runOf(a)?.session ?? ""));
  if (pending > 0 || team.some((s) => s?.agent_state === "waiting" && !s.exited)) return "input";
  if (team.some((s) => s?.agent_state === "running" && !s.exited) || awaiting.has(run.session)) return "working";
  // Its own last report, not a worker's, says whether it is ready.
  if (reportOf(reportsOn(task.id).filter((r) => reportOf(r)?.by === agent.id).at(-1))?.ready) return "review";
  const own = live.get(run.session);
  // Just started: the runtime's list may not have it yet.
  if (!own) return Date.now() - agent.createdAt < 60_000 ? "starting" : "stopped";
  return own.exited ? "stopped" : "idle";
}

// A page's state for the dot on its tab and sidebar row; none without an agent, its own or a subtask's.
export function taskState(pageId: string): TaskState | undefined {
  const page = pageOf(pageId);
  if (!page || !isTask(page)) return;
  const agent = agentOfTask(page);
  return agent || subtasksOf(page.id).some((s) => agentOfTask(s)) ? stateOf(page, agent, sessions.get()) : undefined;
}
