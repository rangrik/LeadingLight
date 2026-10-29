import { useSyncExternalStore } from "react";
import type { Seen } from "~/lib/ask-prompt";
import type { Quote } from "~/lib/ask";

// Each page's threads with Claude, kept on this Mac between launches. A stream that lands after
// the person switched pages still goes to the thread that asked, so they live outside React.

export type Status = "running" | "done" | "failed" | "declined" | "stopped";
export type Item =
  | { kind: "user"; text: string; quote?: string; files?: string[] }
  | { kind: "text"; text: string; id?: string; phase?: "commentary" | "partial_answer" | "final_answer" }
  | { kind: "thinking"; text: string; start: number; end?: number }
  | { kind: "tool"; id: string; name: string; input: Record<string, unknown>; status: Status; output?: string }
  | { kind: "end"; ms: number; how: "done" | "stopped" | "failed"; error?: string; plan?: boolean };

export function turnContent(items: Item[]) {
  const body = items.filter((i) => i.kind !== "user" && i.kind !== "end").filter((i) => i.kind !== "text" || i.text.trim());
  const last = body.reduce((at, i, k) => i.kind === "text" ? at : k, -1);
  const answer = body.filter((i, k): i is Extract<Item, { kind: "text" }> => i.kind === "text" && (i.phase ? i.phase !== "commentary" : k > last));
  const answers = new Set<Item>(answer);
  return { answer, work: body.filter((i) => !answers.has(i)) };
}

// A change waiting for the person, while its turn waits on it.
export type Approval = { requestId: string | number; tool: string; input: Record<string, unknown>; toolUseId: string };

export type Thread = {
  id: string;
  title: string;
  items: Item[];
  updated: number;
  sessionId?: string;
  // What the session has been sent (lib/ask-prompt.ts), and tools allowed for the whole thread.
  seen: Seen;
  // GPT's own session in the thread (a Codex thread), kept beside Claude's.
  codexId?: string;
  codexSeen?: Seen;
  allowed: string[];
  executionTarget?: string;
  remoteRun?: { id: string; target: string; started: number };
  stopping?: boolean;
  // Not kept: the turn running, its start, a change waiting, the words Replace acts on, a note.
  busy?: string;
  started?: number;
  approval?: Approval;
  quote?: Quote | null;
  note?: string;
};
type PageThreads = { list: Thread[]; current: string; pending: Quote | null };

const KEEP = 20;
const OUTPUT = 4000;
const key = (pageId: string) => `ll.threads.${pageId}`;
const blank = (): Thread => ({ id: crypto.randomUUID(), title: "", items: [], updated: Date.now(), seen: {}, allowed: [] });

const pages = new Map<string, PageThreads>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

function load(pageId: string): PageThreads {
  let got = pages.get(pageId);
  if (got) return got;
  let list: Thread[] = [];
  try {
    list = JSON.parse(localStorage.getItem(key(pageId)) ?? "[]") as Thread[];
    if (list.some((t) => t.remoteRun)) {
      list = list.map((t) => t.remoteRun ? {
        ...t, remoteRun: undefined, busy: undefined, stopping: undefined, approval: undefined,
        sessionId: undefined, codexId: undefined, seen: {}, codexSeen: {}, allowed: [],
        items: [...t.items.map((i): Item => i.kind === 'tool' && i.status === 'running' ? { ...i, status: 'stopped' } : i.kind === 'thinking' && !i.end ? { ...i, end: Date.now() } : i),
          { kind: 'end', how: 'failed', ms: 0, error: 'Connection interrupted when this browser reloaded. The Mac stops this turn when its connection lease expires. Nothing was resent.' }],
      } : t);
      localStorage.setItem(key(pageId), JSON.stringify(list));
    }
  } catch {
    // A broken record starts the page afresh.
  }
  const first = list[0] ?? blank();
  got = { list: list.length ? list : [first], current: first.id, pending: null };
  pages.set(pageId, got);
  return got;
}

// Threads that have something in them, newest first, with long tool output cut.
function save(pageId: string) {
  const list = load(pageId)
    .list.filter((t) => t.items.length)
    .sort((a, b) => b.updated - a.updated)
    .slice(0, KEEP)
    .map(({ busy: _b, stopping: _stop, started: _s, approval: _a, quote: _q, note: _n, ...t }) => ({
      ...t,
      items: t.items.map((i) => (i.kind === "tool" && i.output && i.output.length > OUTPUT ? { ...i, output: `${i.output.slice(0, OUTPUT)}…` } : i)),
    }));
  try {
    localStorage.setItem(key(pageId), JSON.stringify(list));
  } catch {
    // Full storage: the threads stay for this run.
  }
}

// Kept at once when asked, else within a second, so a reload mid-turn keeps the steps so far.
const soon = new Map<string, number>();
export function patchThread(pageId: string, threadId: string, f: (t: Thread) => Thread, keep = false) {
  const p = load(pageId);
  pages.set(pageId, { ...p, list: p.list.map((t) => (t.id === threadId ? f(t) : t)) });
  if (keep) save(pageId);
  else if (!soon.has(pageId)) soon.set(pageId, window.setTimeout(() => (soon.delete(pageId), save(pageId)), 1000));
  changed();
}

export const threadOf = (pageId: string, threadId: string) => load(pageId).list.find((t) => t.id === threadId);

export function setPending(pageId: string, pending: Quote | null) {
  pages.set(pageId, { ...load(pageId), pending });
  changed();
}

// An empty thread is reused rather than piling up.
export function newThread(pageId: string) {
  const p = load(pageId);
  const empty = p.list.find((t) => !t.items.length);
  const t = empty ?? blank();
  pages.set(pageId, { ...p, list: empty ? p.list : [t, ...p.list], current: t.id });
  changed();
}

export function pickThread(pageId: string, id: string) {
  pages.set(pageId, { ...load(pageId), current: id });
  changed();
}

export function usePageThreads(pageId: string | undefined) {
  const p = useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => (pageId ? load(pageId) : undefined),
  );
  return p && { ...p, thread: p.list.find((t) => t.id === p.current) ?? p.list[0] };
}
