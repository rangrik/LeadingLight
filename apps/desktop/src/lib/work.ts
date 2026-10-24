import type { Evidence } from "~/lib/evidence";
import type { ObjectSummary } from "~/lib/objects";
import { editPage } from "~/lib/live";
import { createPage, pageOf, propOf, space } from "~/lib/space";
import { summarize } from "~/lib/store";

// What a project's agents leave in LeadingLight (DECISIONS.md, 20). An Agent page is one agent at
// work, bound to a runtime conversation; a Report is what it published beside a page. Both are
// pages of system types found by their ids, so renaming a type changes nothing here.

export const AGENT = "agent";
export const REPORT = "report";

// The runtime's names for the agent: never shown, never typed.
export type Run = { conversation: string; session: string; location: string; agent: string; by?: string };
// What a report rests on: a page and the words it quotes, kept as they were then.
export type Source = { page: string; quote?: string; excerpt?: string };
// What something is about, to open beside it: a page and its words, or a report's block (its
// evidence) and, for a video, the second.
export type Target = { page: string; quote?: string; excerpt?: string; block?: number; at?: number };
// A question an agent said it would ask, and what it is about (the context tool).
export type Ask = { question: string; about: Target[]; at: number };
// A response's answer to one point of a batch, from its block; missing when the agent gave none.
export type Answer = { point: string; block: number; unanswered?: string; missing?: boolean };
export type ReportMeta = { by: string; conversation?: string; session: string; turn?: string; to: string; at: number; command: string; sources?: Source[]; evidence?: Evidence[]; batch?: string; answers?: Answer[]; corrects?: string; ready?: boolean };

export const runOf = (p?: ObjectSummary) => p?.properties.run as Run | undefined;
// What an agent says it is doing, and its steps: its to change, in place (the status tool).
export type Work = { activity?: string; checklist?: { text: string; done?: boolean }[]; at: number };
export const workOf = (p?: ObjectSummary) => p?.properties.work as Work | undefined;
const first = (v: unknown) => (Array.isArray(v) ? (v[0] as string | undefined) : undefined);
export const taskOfAgent = (p?: ObjectSummary) => first(p?.properties["agent-task"]);
export const workersOf = (agentId: string, pages = space.get().pages) => pages.filter((p) => first(p.properties["agent-parent"]) === agentId);
export const subtasksOf = (taskId: string, pages = space.get().pages) => pages.filter((p) => first(p.properties["subtask-of"]) === taskId).sort((a, b) => a.createdAt - b.createdAt);
// The pages a page's relation properties hold.
export const relationsOf = (p: ObjectSummary) =>
  Object.entries(p.properties).flatMap(([k, v]) => (propOf(k)?.kind === "relation" ? (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : []) : []));
export const reportOf = (p?: ObjectSummary) => p?.properties.report as ReportMeta | undefined;
export const isReport = (id: string) => !!reportOf(pageOf(id));

// The reports beside a page, oldest first.
export const reportsOn = (pageId: string, pages = space.get().pages) => pages.filter((p) => p.properties.parent === pageId && reportOf(p)).sort((a, b) => a.createdAt - b.createdAt);

export type Caller = { session: string; conversation?: string; location?: string; agent?: string; by?: string; title?: string };

// The Agent page of a caller: by its conversation, or by its session until an assignment has
// recorded the conversation.
export const agentOf = (c: Caller) => {
  const agents = space.get().pages.filter((p) => runOf(p));
  return agents.find((p) => c.conversation && runOf(p)!.conversation === c.conversation) ?? agents.find((p) => runOf(p)!.session === c.session);
};

// The Agent page of a caller, made the first time it is needed. Writes come one at a time
// (lib/project-runtime/bridge.ts), so it is made once.
export async function agentFor(c: Caller): Promise<ObjectSummary> {
  const found = agentOf(c);
  // The runtime's word on which conversation a session runs is the one kept.
  if (found && c.conversation && runOf(found)!.conversation !== c.conversation) await editPage(found.id, { properties: (p) => ({ ...p, run: { ...(p.run as Run), conversation: c.conversation } }) });
  if (found) return found;
  const run: Run = { conversation: c.conversation ?? "", session: c.session, location: c.location ?? "", agent: c.agent ?? "claude", ...(c.by && { by: c.by }) };
  const name = run.agent === "codex" ? "Codex" : "Claude";
  // A worker hangs off the agent that started it, on that agent's task.
  const lead = c.by ? agentOf({ session: c.by }) ?? space.get().pages.find((p) => runOf(p)?.session === c.by) : undefined;
  const task = taskOfAgent(lead);
  return summarize(
    await createPage({
      typeId: AGENT,
      title: lead ? `${name}, working for ${lead.title}` : c.title ? `${name}: ${c.title.replace(/…$/, "").slice(0, 60)}` : name,
      properties: { run, "agent-profile": name, ...(lead && { "agent-parent": [lead.id] }), ...(task && { "agent-task": [task] }) },
    }),
  );
}
