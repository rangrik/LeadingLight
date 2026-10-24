import { assignmentOf } from "~/lib/assign";
import { liveEditor, whenLive } from "~/lib/live";
import { localPrefs } from "~/lib/local-prefs";
import { focusPane, leaves, openBeside, panes, showIn } from "~/lib/panes";
import { chatOf, type Conversation, watch } from "~/lib/project-runtime/chat";
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
  kind: "question" | "approval" | "review" | "notice";
  reason: string;
  agent?: string;
  task?: string;
  project?: string;
  at: number;
  targets: Target[];
  // The chat it is answered in (the conversation's id) and the request.
  request?: { key: string; request: RuntimeRequest };
  note?: string;
};

export const feedPrefs = localPrefs("ll.feed", { open: false, project: "all", dismissed: [] as string[] });

// An assigned agent is "Claude: its task"; the Feed names its task apart, so just "Claude".
const name = (id?: string) => ((id && pageOf(id)?.title.trim()) || "An agent").split(": ")[0];
const projectOf = (location?: string) => [...folders.get().values()].find((f) => f.folder.location === location?.split("/")[0])?.folder.pageId;
const words = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

const WANTS: Record<string, string> = { Bash: "run a command", Edit: "change a file", Write: "write a file", ExitPlanMode: "start on its plan" };

// Every agent's conversation, followed as an open chat is (lib/project-runtime/chat.ts) without
// reading its reply as it is written, so its requests are known with no chat open.
const followed = new Map<string, () => void>();
export async function followAgents(): Promise<void> {
  const want = space.get().pages.flatMap((p) => (runOf(p)?.conversation ? [runOf(p)!.conversation] : [])).filter((c) => !followed.has(c));
  if (!want.length) return;
  const convs = await ask<Conversation[]>("GET", "/v1/conversations?limit=200").catch(() => null);
  for (const id of want) {
    const conv = convs?.find((c) => c.id === id);
    if (conv && !followed.has(id)) followed.set(id, watch(id, conv, { reply: false }));
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
  for (const task of pages.filter((p) => assignmentOf(p))) {
    const agent = pageOf(assignmentOf(task)!.agent);
    if (!agent) continue;
    const state = stateOf(task, agent, live);
    const base = { agent: agent.id, task: task.id, project: projectOf(runOf(agent)?.location) };
    if (state === "review") {
      const report = reportsOn(task.id, pages).filter((r) => reportOf(r)?.by === agent.id).at(-1)!;
      items.push({ ...base, id: `review:${report.id}`, kind: "review", reason: `“${name(task.id)}” is ready for review`, at: report.createdAt, targets: [{ page: report.id }] });
    } else if (state === "stopped") {
      items.push({ ...base, id: `stopped:${agent.id}:${runOf(agent)!.session}`, kind: "notice", reason: `${name(agent.id)} stopped before “${name(task.id)}” was ready`, at: task.updatedAt, targets: [{ page: task.id }] });
    }
  }
  const { dismissed } = feedPrefs.get();
  return items.filter((i) => (i.kind !== "review" && i.kind !== "notice") || !dismissed.includes(i.id)).sort((a, b) => b.at - a.at);
}

// Shows a target beside the Feed, keeping the page being read where it is: in the pane the Feed
// last opened, else a new one beside. In a narrow window the Feed's own pane goes there instead.
let contextPane: string | null = null;
export function showTarget(t: Target, feedPane?: string) {
  const { root } = panes.get();
  const open = root && leaves(root).find((l) => l.page === t.page);
  if (open) focusPane(open.id);
  else if (feedPane) showIn(feedPane, t.page, FEED_VIEW);
  else if (root && contextPane && leaves(root).some((l) => l.id === contextPane)) (showIn(contextPane, t.page), focusPane(contextPane));
  else {
    openBeside(t.page);
    contextPane = panes.get().focus;
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
