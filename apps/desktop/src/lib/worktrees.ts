import type { Session } from "~/lib/project-runtime/chat";
import { onRuntimeEvent } from "~/lib/project-runtime/live";
import { ask, call } from "~/lib/project-runtime/transport";
import { createStore } from "~/lib/state";

// A project folder's worktrees as the runtime has them (features/work-view.feature): git's own
// list, so ones made by other tools are there too, each with who is in it now.

type Status = { name: string; path: string; branch?: string; main?: boolean; changed: number; untracked: number; ahead: number };
type Live = Session & { dir?: string };
export type Worktree = Status & { who: string; state?: "input" | "working" | "idle"; removable: boolean };
export const worktrees = createStore<Record<string, { rows: Worktree[]; error?: string }>>({});

const NAME: Record<string, string> = { claude: "Claude", codex: "Codex" };
export const atWork = (w?: Worktree) => w?.state === "input" || w?.state === "working";

export function rowsOf(list: Status[], sessions: Live[]): Worktree[] {
  return list.map((wt) => {
    const inside = sessions.filter((s) => !s.exited && s.dir === wt.path);
    const state = inside.some((s) => s.agent_state === "waiting") ? "input" : inside.some((s) => s.agent_state === "running") ? "working" : inside.length ? "idle" : undefined;
    const who = inside.length > 1 ? `${inside.length} agents` : inside.length ? (NAME[inside[0].agent ?? ""] ?? "An agent") : "";
    // The runtime removes by name: never the checkout, nor one of two it names alike.
    return { ...wt, who, state, removable: !wt.main && list.filter((w) => w.name === wt.name).length === 1 };
  });
}

export async function loadWorktrees(location: string): Promise<void> {
  const set = (v: { rows: Worktree[]; error?: string }) => worktrees.set({ ...worktrees.get(), [location]: v });
  try {
    const [list, sessions] = await Promise.all([ask<Status[] | null>("GET", `/v1/worktrees?location=${encodeURIComponent(location)}`), ask<Live[] | null>("GET", "/v1/sessions")]);
    set({ rows: rowsOf(list ?? [], sessions ?? []) });
  } catch (e) {
    set({ rows: [], error: e instanceof Error ? e.message : String(e) });
  }
}

// Read now, and again when the runtime says a worktree or an agent changed.
export function followWorktrees(location: string): () => void {
  let timer = 0;
  const read = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void loadWorktrees(location), 150);
  };
  read();
  const stop = onRuntimeEvent((e) => (e.type === "runtime.connected" || /^(worktree|session|agent)\./.test(e.type)) && read());
  return () => (window.clearTimeout(timer), stop());
}

// The runtime keeps uncommitted work unless forced, and says so in git's words.
export async function removeWorktree(location: string, name: string, force: boolean): Promise<"removed" | "uncommitted"> {
  const r = await call<{ error?: string }>("DELETE", `/v1/locations/${location}/worktrees/${encodeURIComponent(name)}${force ? "?force=1" : ""}`);
  if (r.status >= 400 && !force && /modified or untracked|--force/.test(r.body?.error ?? "")) return "uncommitted";
  if (r.status >= 400) throw new Error(r.body?.error ?? `The runtime answered ${r.status}`);
  await loadWorktrees(location);
  return "removed";
}
