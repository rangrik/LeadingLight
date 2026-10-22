import type { AgentMessage, MessageSender, TranscriptItem } from "@/lib/transcript";

// Messages that reach an agent from someone other than the person: another
// agent (a helper's hand-back, a teammate, another session, the lead) or
// Claude Code itself (a background task's ping). The box reads them out of
// the agent's record (internal/transcript/peer.go); this is what the chat
// needs to draw them: colours per sender, which ones wait on the person,
// pings folded together, and the teammates the Crew strip lists.

export type MessageItem = Extract<TranscriptItem, { kind: "agent-message" }>;
export type PingItem = Extract<TranscriptItem, { kind: "ping" }>;

export const SENDER_WORD: Record<MessageSender["kind"], string> = { helper: "Helper", teammate: "Teammate", session: "Session", lead: "Lead", harness: "Claude Code" };

// A teammate's own colour, as Claude Code's agent teams name it, in the
// app's palette.
const TEAM: Record<string, string> = { blue: "sky", green: "teal", yellow: "amber", purple: "violet", orange: "orange", pink: "pink", red: "rose", cyan: "cyan" };
// Helpers take these in the order they started, so two never share one and
// none takes a teammate's (sky, teal, amber) or the lead's (orange).
const HELPERS = ["violet", "pink", "lime", "rose"];
const TEAMMATES = ["sky", "teal", "amber"];

const hash = (s: string) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
};

// senderColor is a sender's colour, the same wherever it shows: the lead's
// orange, a teammate's own, a helper's by its place in the crew (or its
// name, when it isn't in it).
export function senderColor(from: MessageSender, crewIndex = -1): string {
  switch (from.kind) {
    case "lead":
      return "orange";
    case "harness":
      return "slate";
    case "session":
      return "cyan";
    case "teammate":
      return (from.color && TEAM[from.color]) || TEAMMATES[hash(from.id) % TEAMMATES.length];
    default:
      return HELPERS[(crewIndex >= 0 ? crewIndex : hash(from.name)) % HELPERS.length];
  }
}

// needsYou: a teammate's or another session's question that nobody has
// answered yet. It is addressed to the agent, but the person may want to
// answer it themselves.
export function needsYou(m: AgentMessage): boolean {
  return m.intent === "question" && !m.answered && (m.from.kind === "teammate" || m.from.kind === "session");
}

export const lineCount = (s: string) => s.split("\n").filter((l) => l.trim()).length;

// overScreen: a report longer than about one screen reads in part in the
// chat and whole in its helper's tab (or a sheet).
export const overScreen = (body: string) => lineCount(body) > 40 || body.length > 5000;

// Pings that finished close together fold into one line ("✓ 3 finished"):
// next to each other in the chat and no more than FOLD_GAP apart. A
// failure or a stop always shows on its own.
export const FOLD_GAP = 5 * 60_000;

export function foldsWith(a: AgentMessage, b: AgentMessage): boolean {
  if (a.status !== "done" || b.status !== "done") return false;
  return a.at === undefined || b.at === undefined || Math.abs(b.at - a.at) <= FOLD_GAP;
}

// foldPings groups runs of two or more pings that fold together, keeping
// every other row as it is.
export function foldPings<B>(rows: B[], ping: (b: B) => PingItem | undefined, group: (run: PingItem[]) => B): B[] {
  const out: B[] = [];
  let run: { rows: B[]; pings: PingItem[] } = { rows: [], pings: [] };
  const flush = () => {
    if (run.pings.length > 1) out.push(group(run.pings));
    else out.push(...run.rows);
    run = { rows: [], pings: [] };
  };
  for (const r of rows) {
    const p = ping(r);
    const last = run.pings[run.pings.length - 1];
    if (p && p.msg.status === "done" && (!last || foldsWith(last.msg, p.msg))) {
      run.rows.push(r);
      run.pings.push(p);
      continue;
    }
    flush();
    if (p && p.msg.status === "done") {
      run.rows.push(r);
      run.pings.push(p);
    } else out.push(r);
  }
  flush();
  return out;
}

// A teammate the Crew strip lists: one that has written to the agent in
// this conversation.
export interface Teammate {
  id: string;
  name: string;
  color?: string;
  // Its latest message: what it said, and whether it waits on an answer.
  last: string;
  lastId: string;
  lastAt?: number;
  open: boolean;
  count: number;
}

export function teammatesOf(items: TranscriptItem[] | undefined): Teammate[] {
  const by = new Map<string, Teammate>();
  for (const it of items ?? []) {
    if ((it.kind !== "agent-message" && it.kind !== "ping") || it.msg.from.kind !== "teammate") continue;
    const m = it.msg;
    const t = by.get(m.from.id) ?? { id: m.from.id, name: m.from.name, color: m.from.color, last: "", lastId: it.id, open: false, count: 0 };
    t.count++;
    if (it.kind === "agent-message") {
      t.last = m.summary || firstLine(m.body ?? "");
      t.lastId = it.id;
      t.lastAt = m.at;
      t.open = needsYou(m);
    } else if (!t.last) t.last = m.summary ?? "";
    by.set(m.from.id, t);
  }
  return [...by.values()];
}

const firstLine = (s: string) => s.split("\n").find((l) => l.trim())?.trim() ?? "";

// The words search finds a message by.
export function messageText(m: AgentMessage): string {
  return [m.from.name, m.title, m.summary, m.body].filter(Boolean).join("\n");
}

// withoutReminders is a prompt without the <system-reminder> blocks Claude
// Code appends to it: the box takes them out (peer.go), and an older box
// that doesn't still never shows them as the person's words.
export const withoutReminders = (s: string) => (s.includes("<system-reminder>") ? s.replace(/\s*<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, "\n").trim() : s);
