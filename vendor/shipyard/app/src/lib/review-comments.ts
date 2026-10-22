import { create } from "zustand";

import { boxApi } from "@/lib/api";
import { load, save } from "@/lib/storage";
import { useStore } from "@/lib/store";

// Review comments: notes on lines of an agent's diff, kept on this laptop
// per worktree until they are sent to its agent or dismissed. Sending
// collects them into one short prompt (file:line and the note, never the
// code around it: the agent can read the file) and holds it on the box
// until the agent is idle. Everything here is bounded.

export interface LineComment {
  id: string;
  file: string;
  // The line in the new file, or, on a removed line, in the old one.
  line: number;
  side: "new" | "old";
  text: string;
  at: number;
  // When it was sent to the agent.
  sent?: number;
}

const KEY = "berth.review.comments";
const PER_WORKTREE = 40;
const WORKTREES = 40;
export const COMMENT_LIMIT = 500;
export const PROMPT_LIMIT = 2048;
// Sent comments stay visible (as sent) for a day.
const SENT_KEPT = 24 * 3600_000;

interface CommentsState {
  // By worktree: "<box>|<path>", as the review inbox keys its items.
  byKey: Record<string, LineComment[]>;
  // A file Review should open on its next visit, from "Open in Review".
  focus?: { key: string; file: string };
}

function prune(byKey: Record<string, LineComment[]>, now = Date.now()) {
  const out: Record<string, LineComment[]> = {};
  for (const [k, list] of Object.entries(byKey)) {
    const kept = list.filter((c) => !c.sent || now - c.sent < SENT_KEPT).slice(-PER_WORKTREE);
    if (kept.length) out[k] = kept;
  }
  const keys = Object.keys(out);
  if (keys.length > WORKTREES) {
    const newest = (k: string) => Math.max(...out[k].map((c) => c.sent ?? c.at));
    for (const k of keys.sort((a, b) => newest(a) - newest(b)).slice(0, keys.length - WORKTREES)) delete out[k];
  }
  return out;
}

export const useComments = create<CommentsState>()(() => ({ byKey: prune(load<Record<string, LineComment[]>>(KEY, {})) }));

function set(key: string, fn: (list: LineComment[]) => LineComment[]) {
  const byKey = prune({ ...useComments.getState().byKey, [key]: fn(useComments.getState().byKey[key] ?? []) });
  useComments.setState({ byKey });
  save(KEY, byKey);
}

export function addComment(key: string, c: Omit<LineComment, "id" | "at">) {
  const text = c.text.trim().slice(0, COMMENT_LIMIT);
  if (!text) return;
  set(key, (list) => [...list, { ...c, text, id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: Date.now() }]);
}

export const removeComment = (key: string, id: string) => set(key, (list) => list.filter((c) => c.id !== id));

// dismiss forgets the unsent comments, or, with sent, the sent ones.
export const dismissComments = (key: string, sent: boolean) => set(key, (list) => list.filter((c) => (sent ? !c.sent : !!c.sent)));

export const pending = (list: LineComment[] | undefined) => (list ?? []).filter((c) => !c.sent);

const where = (c: LineComment) => (c.side === "old" ? `${c.file} (removed line ${c.line})` : `${c.file}:${c.line}`);

// commentsPrompt is what the agent gets: one line per comment, oldest
// first, in at most PROMPT_LIMIT characters. included is how many fit.
export function commentsPrompt(list: LineComment[]): { text: string; included: LineComment[] } {
  const head = "Review comments on your changes. Please address each one:";
  const sorted = [...list].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const included: LineComment[] = [];
  let text = head;
  for (const c of sorted) {
    const line = `\n- ${where(c)}: ${c.text.replace(/\s+/g, " ").trim()}`;
    if (text.length + line.length > PROMPT_LIMIT) break;
    text += line;
    included.push(c);
  }
  return { text, included };
}

// sendComments sends a worktree's unsent comments to its agent, held on the
// box until the agent is idle. It says how many went.
export async function sendComments(box: string, session: string, key: string): Promise<{ sent: number; left: number; queued: boolean }> {
  const client = useStore.getState().client;
  if (!client) throw new Error("Not connected");
  const todo = pending(useComments.getState().byKey[key]);
  const { text, included } = commentsPrompt(todo);
  if (!included.length) return { sent: 0, left: todo.length, queued: false };
  const r = await boxApi.send(client, box, session, text, true, { when: "idle" });
  const ids = new Set(included.map((c) => c.id));
  const now = Date.now();
  set(key, (list) => list.map((c) => (ids.has(c.id) ? { ...c, sent: now } : c)));
  return { sent: included.length, left: todo.length - included.length, queued: !!r.queued };
}
