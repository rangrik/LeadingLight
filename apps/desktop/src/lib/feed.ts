import { acceptedOf, agentOfTask, isTask } from "~/lib/assign";
import { batchOf } from "~/lib/feedback";
import { liveEditor, whenLive } from "~/lib/live";
import { localPrefs } from "~/lib/local-prefs";
import { focusPane, leaves, openBeside, panes, showIn } from "~/lib/panes";
import { chatOf, type Conversation, watch } from "~/lib/project-runtime/chat";
import { said } from "~/lib/project-runtime/transcript";
import { folders } from "~/lib/project-runtime/folders";
import type { RuntimeRequest } from "~/lib/project-runtime/requests";
import { ask } from "~/lib/project-runtime/transport";
import { FEED_VIEW, pageOf, space } from "~/lib/space";
import { type Ask, reportOf, reportsOn, runOf, type Target, taskOfAgent } from "~/lib/work";
import { sessions, stateOf } from "~/lib/work-watch";

// The Feed (features/feed.feature): what needs the person from every project's agents, whichever
// pages are open. Questions and approvals are the runtime's requests, answered through the same
// receipts as the chat's cards; then work ready for review and notices. Each item names its agent,
// task and project, and what it is about, to open beside it. Routine work never shows here.

export type FeedItem = {
  // One per actionable thing, the same after any reconnect.
  id: string;
  kind: "question" | "approval" | "review" | "answer" | "notice";
  reason: string;
  agent?: string;
  task?: string;
  project?: string;
  at: number;
  targets: Target[];
  // The chat it is answered in (the conversation's id) and the request; or, for an agent that
  // stopped to ask in its own words, the chat a reply goes to.
  request?: { key: string; request: RuntimeRequest };
  reply?: { key: string; location: string };
  note?: string;
};

export const feedPrefs = localPrefs("ll.feed", { open: false, project: "all", dismissed: [] as string[] });
// Opened from the keyboard: its first item takes the focus once it shows.
export const wantFocus = { now: false };

// An assigned agent is "Claude: its task"; the Feed names its task apart, so just "Claude".
const name = (id?: string) => ((id && pageOf(id)?.title.trim()) || "An agent").split(": ")[0];
const projectOf = (location?: string) => [...folders.get().values()].find((f) => f.folder.location === location?.split("/")[0])?.folder.pageId;
const words = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

const WANTS: Record<string, string> = { Bash: "run a command", Edit: "change a file", Write: "write a file", ExitPlanMode: "start on its plan" };

// Every agent's conversation, followed as an open chat is (lib/project-runtime/chat.ts) without
// reading its reply as it is written, so its requests are known with no chat open.
const followed = new Map<string, () => void>();
// Conversations the runtime didn't have when last asked, asked about again only after a minute.
const missing = new Map<string, number>();
export async function followAgents(): Promise<void> {
  const want = space
    .get()
    .pages.flatMap((p) => (runOf(p)?.conversation ? [runOf(p)!.conversation] : []))
    .filter((c) => !followed.has(c) && Date.now() - (missing.get(c) ?? 0) > 60_000);
  if (!want.length) return;
  const convs = await ask<Conversation[]>("GET", "/v1/conversations?limit=200").catch(() => null);
  for (const id of want) {
    const conv = convs?.find((c) => c.id === id);
    if (conv && !followed.has(id)) followed.set(id, watch(id, conv, { reply: false }));
    else if (!conv) missing.set(id, Date.now());
  }
}

export function feedItems(): FeedItem[] {
  const { pages } = space.get();
  const live = sessions.get();
  const items: FeedItem[] = [];
  for (const agent of pages.filter((p) => runOf(p)?.conversation)) {
    const run = runOf(agent)!;
    const task = taskOfAgent(agent);
    const base = { agent: agent.id, task, project: projectOf(run.location) };
    for (const r of chatOf(run.conversation).get().requests) {
      if (r.state !== "pending" && r.state !== "recorded") continue;
      const question = r.questions?.[0]?.question ?? "";
      // What the agent said the question is about (its context tool), matched by its words.
      const asked = ((agent.properties.asks as Ask[] | undefined) ?? []).filter((a) => question && (words(question).startsWith(words(a.question).slice(0, 60)) || words(a.question).startsWith(words(question).slice(0, 60)))).at(-1);
      const kind = r.kind === "question" ? "question" : "approval";
      items.push({
        ...base,
        id: `req:${run.conversation}:${r.id}`,
        kind,
        reason: kind === "question" ? `${name(agent.id)} asks: ${question}` : r.kind === "plan" ? `${name(agent.id)} has a plan ready to start` : `${name(agent.id)} wants to ${WANTS[r.tool ?? ""] ?? `use ${r.tool}`}`,
        at: r.opened,
        targets: asked?.about ?? (task ? [{ page: task }] : []),
        request: { key: run.conversation, request: r },
        ...(kind === "question" && !asked && { note: "It didn't say what this is about; its task is beside it." }),
      });
    }
  }
  // Tasks ready for review, by their agent's last report; and agents that stopped short.
  for (const task of pages.filter((p) => isTask(p))) {
    const agent = agentOfTask(task);
    if (!agent) continue;
    const state = stateOf(task, agent, live);
    const base = { agent: agent.id, task: task.id, project: projectOf(runOf(agent)?.location) };
    // Stopped to ask in its own words (Codex outside Plan mode has no question tool): its last words,
    // with what it said they are about, until it works again.
    const run = runOf(agent);
    const last = state === "idle" && run ? lastWords(run.conversation, Date.parse(live.get(run.session)?.state_since ?? "") || task.updatedAt) : undefined;
    if (last) {
      const asked = ((agent.properties.asks as Ask[] | undefined) ?? []).filter((a) => words(last.text).includes(words(a.question).slice(0, 60))).at(-1);
      items.push({ ...base, id: `said:${run!.conversation}:${last.id}`, kind: "question", reason: `${name(agent.id)} ${last.text.includes("?") ? "asks" : "says"}: ${last.text.length > 220 ? `${last.text.slice(0, 220)}…` : last.text}`, at: last.at, targets: asked?.about ?? [{ page: task.id }], reply: { key: run!.conversation, location: run!.location } });
    }
    if (state === "review") {
      const report = reportsOn(task.id, pages).filter((r) => reportOf(r)?.by === agent.id).at(-1)!;
      const answers = reportOf(report)?.batch ? `${name(agent.id)} answered your feedback; ` : "";
      items.push({ ...base, id: `review:${report.id}`, kind: "review", reason: `${answers}“${name(task.id)}” is ready for review`, at: report.createdAt, targets: [{ page: report.id }] });
    } else if (state === "done" && acceptedOf(task)) {
      // Published after it was accepted: told, never undoing it.
      const late = reportsOn(task.id, pages).filter((r) => r.createdAt > acceptedOf(task)!.at).at(-1);
      if (late) items.push({ ...base, id: `late:${late.id}`, kind: "notice", reason: `${name(agent.id)} published after you accepted “${name(task.id)}”`, at: late.createdAt, targets: [{ page: late.id }] });
    } else if (state === "stopped") {
      items.push({ ...base, id: `stopped:${agent.id}:${runOf(agent)!.session}`, kind: "notice", reason: `${name(agent.id)} stopped before “${name(task.id)}” was ready`, at: task.updatedAt, targets: [{ page: task.id }] });
    }
  }
  // An answer to feedback, unless it is the review item already.
  for (const f of pages.filter((p) => batchOf(p)?.response)) {
    const b = batchOf(f)!;
    const report = pageOf(b.response!);
    if (!report || items.some((i) => i.id === `review:${report.id}`)) continue;
    const answered = reportOf(report)?.answers ?? [];
    const all = answered.every((x) => !x.missing);
    items.push({ agent: b.agent, task: b.task, project: projectOf(runOf(pageOf(b.agent))?.location), id: `answer:${report.id}`, kind: "answer", reason: all ? `${name(b.agent)} answered your feedback on “${name(b.task)}”` : `${name(b.agent)} answered ${answered.filter((x) => !x.missing).length} of ${answered.length} points of your feedback on “${name(b.task)}”`, at: report.createdAt, targets: [{ page: report.id }] });
  }
  const { dismissed } = feedPrefs.get();
  const waits = (i: FeedItem) => (i.kind === "question" || i.kind === "approval" ? 1 : 0);
  return items.filter((i) => waits(i) || !dismissed.includes(i.id)).sort((a, b) => waits(b) - waits(a) || b.at - a.at);
}

// What an agent said after the person's last message, when it ended its turn there.
function lastWords(conversation: string, at: number) {
  const items = chatOf(conversation).get().window.items;
  const from = items.map((i) => said(i) !== null).lastIndexOf(true);
  const text = items.slice(from + 1).filter((i) => i.kind === "text" && i.text?.trim()).at(-1);
  return text ? { id: text.id, text: text.text!.trim().replace(/\s+/g, " "), at } : undefined;
}

// Shows a target beside the Feed, keeping the page being read where it is: in the pane the Feed
// last opened, else a new one beside. In a narrow window the Feed's own pane goes there instead.
let contextPane: { leaf: string; page: string } | null = null;
export function showTarget(t: Target, feedPane?: string) {
  const { root } = panes.get();
  const open = root && leaves(root).find((l) => l.page === t.page);
  if (open) focusPane(open.id);
  else if (feedPane) showIn(feedPane, t.page, FEED_VIEW);
  else if (root && contextPane && leaves(root).some((l) => l.id === contextPane!.leaf && l.page === contextPane!.page)) {
    showIn(contextPane.leaf, t.page);
    focusPane(contextPane.leaf);
    contextPane = { ...contextPane, page: t.page };
  } else {
    openBeside(t.page);
    contextPane = { leaf: panes.get().focus, page: t.page };
  }
  // Once the page has laid out its words.
  whenLive(t.page, (page) => requestAnimationFrame(() => requestAnimationFrame(() => reveal(t, page.reveal))));
}

// Scrolls to what the target is about: a report's block (its video at the second), or the words.
function reveal(t: Target, byAnchor: (anchor: string) => void) {
  if (t.block) {
    byAnchor(`b${t.block}`);
    if (t.at !== undefined)
      for (const v of document.querySelectorAll<HTMLVideoElement>(`[data-pane-page="${t.page}"] .ll-editor > :nth-child(${t.block}) video`)) v.currentTime = t.at;
    return;
  }
  const ed = liveEditor(t.page);
  const hit = t.quote ? ed?.find(t.quote, 0) : null;
  const range = hit && ed?.domRange(hit.from, hit.to);
  if (!range) return;
  range.startContainer.parentElement?.scrollIntoView({ block: "center" });
  // A highlight that never enters the page (CSS Custom Highlight API), gone after a moment.
  const css = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS;
  const Highlight = (globalThis as { Highlight?: new (r: Range) => unknown }).Highlight;
  if (css?.highlights && Highlight) {
    css.highlights.set("ll-target", new Highlight(range));
    window.setTimeout(() => css.highlights?.delete("ll-target"), 2400);
  }
}
