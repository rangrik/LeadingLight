import type { EditorDoc } from "@leadinglight/editor/editor";
import { agentOfTask, isTask, taskOfDocument } from "~/lib/assign";
import { pageLabel } from "~/lib/labels";
import { editPage } from "~/lib/live";
import { localPrefs } from "~/lib/local-prefs";
import { flushAll } from "~/lib/saving";
import { docText, type ObjectSummary, objects } from "~/lib/objects";
import type { Conversation, Session } from "~/lib/project-runtime/chat";
import { ask } from "~/lib/project-runtime/transport";
import { createPage, pageOf, space } from "~/lib/space";
import { summarize } from "~/lib/store";
import { reportOf, runOf } from "~/lib/work";

// Feedback (features/feedback.feature, DECISIONS.md 24): sidenotes chosen on a task's pages, sent as
// one batch to the agent given the task. What is chosen is kept on this Mac per task until it is
// sent. Sending freezes the batch as a Feedback page, then delivers it once to that agent's own
// conversation, keyed by the batch's command id, so a retry after a lost answer is the same message.
// It never goes to another agent, and notes not chosen stay private.

export const FEEDBACK = "feedback";
export type Point = { id: string; note: string; page: string; text: string; quote: string; excerpt: string; evidence?: { name: string; sha: string; block: number }[] };
export type Batch = { command: string; task: string; agent: string; conversation: string; points: Point[]; comment?: string; state: "sending" | "sent" | "failed"; error?: string; at: number; sentAt?: number; response?: string };
export const batchOf = (p?: ObjectSummary) => p?.properties.batch as Batch | undefined;

type Draft = { picks: { page: string; note: string }[]; comment: string };
export const drafts = localPrefs<Record<string, Draft>>("ll.feedback", {});
export const draftOf = (task: string): Draft => drafts.get()[task] ?? { picks: [], comment: "" };
const setDraft = (task: string, d: Draft) => drafts.set({ [task]: d });

// The task feedback on a page belongs to, and its agent: the task itself, the task a report is
// about, or the task a page was assigned through.
export function recipientFor(pageId: string): { task: string; agent: string } | undefined {
  const p = pageOf(pageId);
  if (!p) return;
  const about = reportOf(p)?.to;
  const task = isTask(p) ? p : about && isTask(pageOf(about)) ? pageOf(about) : taskOfDocument(about ?? pageId);
  const agent = agentOfTask(task);
  return task && agent ? { task: task.id, agent: agent.id } : undefined;
}

// Notes the agent was given, as they were sent; the rest stay private.
export const sentPoints = (pages = space.get().pages) => new Map(pages.flatMap((p) => (batchOf(p)?.state === "sent" ? batchOf(p)!.points.map((x) => [x.note, x] as const) : [])));
// Each note in a batch, and how far that batch got.
const LABEL = { sent: "Sent", sending: "Sending…", failed: "Not sent" };
export const noteStates = (pages = space.get().pages) => new Map(pages.flatMap((p) => (batchOf(p)?.points ?? []).map((x) => [x.note, LABEL[batchOf(p)!.state]] as const)));

export function pick(task: string, page: string, note: string, on: boolean) {
  const d = draftOf(task);
  const picks = d.picks.filter((x) => x.note !== note);
  setDraft(task, { ...d, picks: on ? [...picks, { page, note }] : picks });
}
export const setComment = (task: string, comment: string) => setDraft(task, { ...draftOf(task), comment });

// A note's text and the words it is written against, as they are now.
async function pointOf(page: string, note: string, n: number): Promise<Point | null> {
  const p = pageOf(page);
  const thoughts = typeof p?.properties.thoughts === "string" ? await objects.get(p.properties.thoughts) : null;
  const thought = (thoughts?.content?.content ?? []).find((t) => t.type === "thought" && t.attrs?.id === note);
  const doc = (await objects.get(page))?.content ?? null;
  if (!thought || !doc) return null;
  // The block holding the noted words is the excerpt.
  const holding = (doc.content ?? []).find((b) => JSON.stringify(b).includes(`"id":"${note}"`));
  const report = reportOf(p);
  return {
    id: `p${n}`,
    note,
    page,
    text: docText({ type: "doc", content: thought.content }),
    quote: String(thought.attrs?.quote ?? ""),
    excerpt: docText(holding ? { type: "doc", content: [holding] } : null).slice(0, 600),
    ...(report?.evidence?.length && { evidence: report.evidence.map((e) => ({ name: e.name, sha: e.sha, block: e.block })) }),
  };
}

// The batch as the person and agents read it: each point's words, then the note.
function bodyOf(points: Point[], comment?: string): EditorDoc {
  const para = (text: string) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
  return {
    type: "doc",
    content: [
      ...points.flatMap((x) => [
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: `Point ${x.id.slice(1)}` }] },
        { type: "blockquote", content: [para(x.quote)] },
        { type: "paragraph", content: [{ type: "text", text: "On " }, { type: "mention", attrs: { id: x.page, tag: false } }] },
        para(x.text),
      ]),
      ...(comment ? [{ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Overall" }] }, para(comment)] : []),
    ],
  };
}

const title = (id: string) => pageLabel(pageOf(id)?.title ?? "");

// What the agent is told: the batch, and how to answer it.
function message(f: ObjectSummary, b: Batch) {
  return [
    `Feedback from the person on “${title(b.task)}” (ll:${b.task}): ${b.points.length} ${b.points.length === 1 ? "point" : "points"}, batch ${f.id} (read it with read ll:${f.id}).`,
    ...b.points.map((x) => `Point ${x.id}, on “${x.quote}” in “${title(x.page)}” (ll:${x.page}): ${x.text}`),
    b.comment && `Overall: ${b.comment}`,
    `Answer it with ONE publish to the task: batch "${f.id}", and answers with one entry for every point ({point: "p1", markdown}, or {point, unanswered: why}), with sources for what each answer rests on. Publish anew; don't repeat the old report.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// Delivers a frozen batch to its agent once; again only with the same key.
export async function deliver(feedbackId: string): Promise<void> {
  const f = pageOf(feedbackId);
  const b = batchOf(f);
  if (!f || !b) return;
  const set = (patch: Partial<Batch>) => editPage(feedbackId, { properties: (p) => ({ ...p, batch: { ...(p.batch as Batch), ...patch } }) });
  await set({ state: "sending", error: undefined });
  try {
    const conv = (await ask<Conversation[]>("GET", "/v1/conversations?limit=200")).find((c) => c.id === b.conversation);
    if (!conv) throw new Error("The agent's conversation isn't in the runtime any more, so it can't be told.");
    const session = conv.live && conv.session ? conv.session : (await ask<Session>("POST", `/v1/conversations/${conv.id}/resume`, {})).name;
    await ask("POST", `/v1/sessions/${session}/send`, { text: message(f, b), when: "idle", idem_key: b.command });
    await set({ state: "sent", sentAt: Date.now() });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    await set({ state: "failed", error: /failed to fetch|load failed|network/i.test(why) ? "LeadingLight couldn't reach the project runtime" : why });
  }
}

// Freezes the task's chosen notes and comment as one batch, clears the draft, and sends it.
export async function send(task: string): Promise<string> {
  const agent = agentOfTask(pageOf(task));
  const run = runOf(agent);
  if (!agent || !run?.conversation) throw new Error("This task has no agent to send feedback to.");
  // Notes and marks typed a moment ago are saved first, so the batch has them.
  await flushAll();
  const d = draftOf(task);
  const points = (await Promise.all(d.picks.map((x, i) => pointOf(x.page, x.note, i + 1)))).filter((x): x is Point => !!x);
  if (!points.length) throw new Error("None of the chosen notes is there any more.");
  const batch: Batch = { command: crypto.randomUUID(), task, agent: agent.id, conversation: run.conversation, points, ...(d.comment.trim() && { comment: d.comment.trim() }), state: "sending", at: Date.now() };
  const f = summarize(await createPage({ typeId: FEEDBACK, title: `Feedback on ${title(task)}`, content: bodyOf(points, batch.comment), properties: { parent: task, role: "feedback", "feedback-to": [agent.id], batch } }));
  setDraft(task, { picks: [], comment: "" });
  await deliver(f.id);
  return f.id;
}
