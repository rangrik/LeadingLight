import type { Evidence } from "~/lib/evidence";
import type { ObjectSummary } from "~/lib/objects";
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
export type ReportMeta = { by: string; conversation?: string; session: string; turn?: string; to: string; at: number; command: string; sources?: Source[]; evidence?: Evidence[]; corrects?: string; ready?: boolean };

export const runOf = (p?: ObjectSummary) => p?.properties.run as Run | undefined;
// The pages a page's relation properties hold.
export const relationsOf = (p: ObjectSummary) =>
  Object.entries(p.properties).flatMap(([k, v]) => (propOf(k)?.kind === "relation" ? (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : []) : []));
export const reportOf = (p?: ObjectSummary) => p?.properties.report as ReportMeta | undefined;
export const isReport = (id: string) => !!reportOf(pageOf(id));

// The reports beside a page, oldest first.
export const reportsOn = (pageId: string, pages = space.get().pages) => pages.filter((p) => p.properties.parent === pageId && reportOf(p)).sort((a, b) => a.createdAt - b.createdAt);

export type Caller = { session: string; conversation?: string; location?: string; agent?: string; by?: string };

// The Agent page of a caller: by its conversation, or by its session until an assignment has
// recorded the conversation.
export const agentOf = (c: Caller) =>
  space.get().pages.find((p) => runOf(p) && ((c.conversation && runOf(p)!.conversation === c.conversation) || (!runOf(p)!.conversation && runOf(p)!.session === c.session)));

// The Agent page of a caller, made the first time it is needed. Writes come one at a time
// (lib/project-runtime/bridge.ts), so it is made once.
export async function agentFor(c: Caller): Promise<ObjectSummary> {
  const found = agentOf(c);
  if (found) return found;
  const run: Run = { conversation: c.conversation ?? "", session: c.session, location: c.location ?? "", agent: c.agent ?? "claude", ...(c.by && { by: c.by }) };
  const name = run.agent === "codex" ? "Codex" : "Claude";
  return summarize(await createPage({ typeId: AGENT, title: name, properties: { run, "agent-profile": name } }));
}
