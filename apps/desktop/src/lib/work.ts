import type { ObjectSummary } from "~/lib/objects";
import { createPage, pageOf, space } from "~/lib/space";
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
export type ReportMeta = { by: string; conversation?: string; session: string; turn?: string; to: string; at: number; command: string; sources?: Source[]; corrects?: string; ready?: boolean };

export const runOf = (p?: ObjectSummary) => p?.properties.run as Run | undefined;
export const reportOf = (p?: ObjectSummary) => p?.properties.report as ReportMeta | undefined;
export const isReport = (id: string) => !!reportOf(pageOf(id));

// The reports beside a page, oldest first.
export const reportsOn = (pageId: string, pages = space.get().pages) => pages.filter((p) => p.properties.parent === pageId && reportOf(p)).sort((a, b) => a.createdAt - b.createdAt);

export type Caller = { session: string; conversation?: string; location?: string; agent?: string; by?: string };

// The Agent page of a conversation, made the first time it is needed. Writes come one at a time
// (lib/project-runtime/bridge.ts), so it is made once.
export async function agentFor(c: Caller): Promise<ObjectSummary> {
  const key = c.conversation || c.session;
  const found = space.get().pages.find((p) => p.typeId === AGENT && (runOf(p)?.conversation || runOf(p)?.session) === key);
  if (found) return found;
  const run: Run = { conversation: c.conversation ?? "", session: c.session, location: c.location ?? "", agent: c.agent ?? "claude", ...(c.by && { by: c.by }) };
  const name = run.agent === "codex" ? "Codex" : "Claude";
  return summarize(await createPage({ typeId: AGENT, title: name, properties: { run, "agent-profile": name } }));
}
