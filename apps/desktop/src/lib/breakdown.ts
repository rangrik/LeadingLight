import type { TaskState } from "./work-watch";

// The rules for subtasks and the Work table (DECISIONS.md 22, 43), plain so they can be tested.

// A subtask waiting only for a press: not done, no agent, not an agent's own step, and done with
// everything it waits on.
export const isReady = (s: { done: boolean; agent: boolean; step: boolean; after: boolean[] }) => !s.done && !s.agent && !s.step && s.after.every(Boolean);

// A task's state from its own agent's and its started subtasks'; none with neither.
export function rollUp(own: TaskState | undefined, subs: TaskState[]): TaskState | undefined {
  const all = own ? [own, ...subs] : subs;
  if (!all.length) return undefined;
  if (all.includes("input")) return "input";
  if (all.includes("working") || subs.includes("starting")) return "working";
  if ((!own || own === "review") && subs.every((s) => s === "review" || s === "done")) return "review";
  return own && own !== "review" ? own : "idle";
}

// What wants the person first, then work going on, then the rest, newest first; then not started,
// oldest first, so a plan reads in its order; done last.
export type RowState = TaskState | "new";
const RANK: Record<RowState, number> = { input: 0, review: 1, working: 2, starting: 2, idle: 3, stopped: 3, new: 4, done: 5 };
export const byUrgency = (a: { state: RowState; at: number }, b: { state: RowState; at: number }) => RANK[a.state] - RANK[b.state] || (a.state === "new" ? a.at - b.at : b.at - a.at);
