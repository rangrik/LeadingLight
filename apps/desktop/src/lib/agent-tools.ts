import { type EditorDoc, htmlDoc } from "@leadinglight/editor/editor";
import { markdownHtml } from "@/lib/markdown-html";
import { type Graph, scopeOf } from "~/lib/agent-scope";
import type { PropDef } from "~/lib/catalog";
import { pageLabel } from "~/lib/labels";
import { parseHref, roleOf } from "~/lib/linked";
import { liveContent } from "~/lib/live";
import { docText, type LLObject, type ObjectSummary, objects } from "~/lib/objects";
import { docMarkdown } from "~/lib/page-markdown";
import { folders } from "~/lib/project-runtime/folders";
import { ask } from "~/lib/project-runtime/transport";
import { evidenceBlocks, type KeptFile, keepEvidence } from "~/lib/evidence";
import { sentNotes } from "~/lib/feedback";
import { createPage, pageOf, propOf, space, typeOf } from "~/lib/space";
import { agentFor, agentOf, type Ask, relationsOf, REPORT, reportOf, type ReportMeta, type Source, type Target, taskOfAgent, type Work, workersOf } from "~/lib/work";
import { editPage } from "~/lib/live";

// LeadingLight's tools for a project's agents (features/project-context.feature, DECISIONS.md 19),
// answered here when the runtime passes a call on. Who calls comes from the runtime, never from
// the agent: its session's folder names the project, its conversation the agent.

export type Caller = { session: string; conversation?: string; location?: string; dir?: string; agent?: string; by?: string; turn?: string };
export type AgentCall = { id: string; tool: string; args: Record<string, unknown> | null; caller: Caller; files?: KeptFile[] };
type Args = Record<string, unknown>;

// Said to the agent as it is.
export class Refusal extends Error {}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : []);
export const ref = (id: string) => `ll:${id}`;
export const titleOf = (id: string) => {
  const p = pageOf(id);
  return roleOf(p ?? ({ properties: {} } as ObjectSummary)) === "thoughts" ? "Thoughts" : pageLabel(p?.title ?? "");
};
const named = (id: string) => ({ ref: ref(id), title: titleOf(id), type: typeOf(pageOf(id)?.typeId ?? "page").name });

export const projectOf = (c: Caller) => {
  const loc = c.location?.split("/")[0];
  return [...folders.get().values()].find((f) => f.folder.location === loc)?.folder;
};

export const bodyOf = async (id: string): Promise<EditorDoc | null> => liveContent(id) ?? (await objects.get(id))?.content ?? null;

// Pages a body links to: mentions, page links, ll: links and an essay's references.
function linksIn(doc: EditorDoc | null, out = new Set<string>()): Set<string> {
  if (!doc) return out;
  if ((doc.type === "mention" || doc.type === "pageLink") && typeof doc.attrs?.id === "string") out.add(doc.attrs.id);
  for (const href of [str(doc.attrs?.href), ...(doc.marks ?? []).map((m) => str(m.attrs?.href))]) {
    const to = parseHref(href)?.page;
    if (to) out.add(to);
  }
  for (const c of doc.content ?? []) linksIn(c, out);
  return out;
}

const graph: Graph = {
  out: async (id) => [...linksIn(await bodyOf(id)), ...relationsOf(pageOf(id) ?? ({ properties: {} } as ObjectSummary))],
  back: (id) => space.get().pages.filter((p) => p.properties.parent === id || relationsOf(p).includes(id)).map((p) => p.id),
  mentions: async (id) => (await objects.containing(id)).map((o) => o.id),
  hub: (id) => ["tag", "daily"].includes(pageOf(id)?.typeId ?? ""),
  exists: (id) => !!pageOf(id) && !pageOf(id)?.properties.templateOf,
};

// A few seconds' worth: an agent reading page after page doesn't walk the links each time.
const scopes = new Map<string, { at: number; pages: Promise<Set<string>> }>();
export function scope(project: string): Promise<Set<string>> {
  const s = scopes.get(project);
  if (s && Date.now() - s.at < 5000) return s.pages;
  const pages = scopeOf(project, graph);
  scopes.set(project, { at: Date.now(), pages });
  return pages;
}


// A page id from an id, an ll: link, or a title within the project.
async function pageIn(c: Caller, given: unknown): Promise<{ id: string; project: string }> {
  const project = projectOf(c)?.pageId;
  if (!project) throw new Refusal("This chat's folder isn't linked to a page in LeadingLight any more.");
  const raw = str(given).trim();
  const inScope = await scope(project);
  const id = parseHref(raw)?.page ?? (pageOf(raw) ? raw : [...inScope].find((p) => pageOf(p)?.title.trim().toLowerCase() === raw.toLowerCase()));
  if (!id || !pageOf(id)) throw new Refusal(`No page ${raw ? `"${raw}"` : "was named"}; it may have been deleted. search finds pages by their words.`);
  // Not even its title is told.
  if (!inScope.has(id)) throw new Refusal(`That page isn't part of “${titleOf(project)}”, so it can't be read.`);
  return { id, project };
}

// The Markdown of a body's top-level blocks from a cursor, up to about 12,000 characters.
function part(doc: EditorDoc | null, from: number) {
  const blocks = doc?.content ?? [];
  const md = (n: EditorDoc) => docMarkdown({ type: "doc", content: [n] }, (id) => `[${titleOf(id)}](${ref(id)})`);
  const out: string[] = [];
  let size = 0;
  let at = from;
  for (; at < blocks.length && (size < 12000 || !out.length); at++) {
    const text = md(blocks[at]);
    size += text.length;
    if (text) out.push(text);
  }
  return { text: out.join("\n\n"), ...(at < blocks.length && { cursor: String(at), part: `blocks ${from + 1}–${at} of ${blocks.length}` }) };
}

// Files on a page, each with an id read can be asked for: media blocks, then file properties.
type Attachment = { id: string; name: string; kind: string; size?: number; mime?: string; url: string };
function attachmentsOf(p: ObjectSummary, doc: EditorDoc | null): Attachment[] {
  const out: Attachment[] = [];
  const walk = (n: EditorDoc) => {
    if (["image", "video", "audio", "file"].includes(n.type ?? "") && n.attrs?.src) out.push({ id: `b${out.length + 1}`, name: str(n.attrs.name) || n.type!, kind: n.type!, size: n.attrs.size, mime: n.attrs.mime, url: n.attrs.src });
    (n.content ?? []).forEach(walk);
  };
  if (doc) walk(doc);
  for (const [k, v] of Object.entries(p.properties)) {
    const f = v as { url?: string; name?: string; size?: number; mime?: string };
    if (propOf(k)?.kind === "file" && f?.url) out.push({ id: `p:${k}`, name: f.name ?? "file", kind: "file", size: f.size, mime: f.mime, url: f.url });
  }
  return out;
}

function valueOf(def: PropDef, v: unknown): unknown {
  if (def.kind === "relation") return ids(v).filter((id) => pageOf(id)).map((id) => ({ ref: ref(id), title: titleOf(id) }));
  if (def.kind === "select") return ids(v).map((id) => def.options.choices?.find((c) => c.id === id)?.name ?? id);
  if (def.kind === "file") return (v as { name?: string })?.name;
  return v;
}

async function read(c: Caller, a: Args) {
  const { id, project } = await pageIn(c, a.page);
  const p = pageOf(id)!;
  const inScope = await scope(project);
  let doc = await bodyOf(id);
  let withheld = 0;
  // A Thoughts page holds the person's own notes: only those sent as feedback are read.
  if (roleOf(p) === "thoughts") {
    // Only notes sent as feedback (features/feedback.feature); every other one is private.
    const shared = sentNotes();
    const kept = (doc?.content ?? []).filter((n) => n.type === "thought" && shared.has(n.attrs?.id));
    withheld = (doc?.content ?? []).filter((n) => n.type === "thought").length - kept.length;
    doc = { type: "doc", content: kept };
  }
  const from = Math.max(0, Number(str(a.cursor)) || 0);
  const first = from === 0;
  const linked = graph.back(id).filter((x) => x !== id);
  const mentioning = first ? (await graph.mentions(id)).filter((x) => x !== id && !linked.includes(x)) : [];
  const near = [...new Set([...linked, ...mentioning])].filter((x) => graph.exists(x));
  return {
    ...named(id),
    ...(first && {
      ...(typeof p.properties.description === "string" && { description: p.properties.description }),
      properties: Object.entries(p.properties).flatMap(([k, v]) => {
        const def = propOf(k);
        return def && def.kind !== "created" && def.kind !== "updated" ? [{ id: k, name: def.name, kind: def.kind, value: valueOf(def, v) }] : [];
      }),
      created: new Date(p.createdAt).toISOString(),
      updated: new Date(p.updatedAt).toISOString(),
    }),
    ...part(doc, from),
    ...(withheld > 0 && { private_notes: `${withheld} of the person's notes here are private and not shown.` }),
    ...(first && {
      links: [...(await graph.out(id))].filter((x, i, all) => graph.exists(x) && all.indexOf(x) === i).map((x) => ({ ...named(x), ...(!inScope.has(x) && { outside: true }) })),
      linked_from: near.filter((x) => inScope.has(x)).map(named),
      ...(near.some((x) => !inScope.has(x)) && { linked_from_outside: near.filter((x) => !inScope.has(x)).length }),
      attachments: attachmentsOf(p, doc).map(({ url: _, ...rest }) => rest),
    }),
  };
}

async function search(c: Caller, a: Args) {
  const project = projectOf(c)?.pageId;
  if (!project) throw new Refusal("This chat's folder isn't linked to a page in LeadingLight any more.");
  const q = str(a.query).trim().toLowerCase();
  if (!q) throw new Refusal("Give some words to look for.");
  const inScope = await scope(project);
  const found = new Map<string, string>();
  for (const id of inScope) if (titleOf(id).toLowerCase().includes(q)) found.set(id, "");
  for (const o of await objects.containing(q)) {
    // Thoughts pages hold private notes; their words are never searched.
    if (!inScope.has(o.id) || roleOf(o) === "thoughts") continue;
    const line = docText(liveContent(o.id) ?? o.content).split("\n").find((l) => l.toLowerCase().includes(q));
    if (line !== undefined || found.has(o.id)) found.set(o.id, line ?? "");
  }
  const from = Math.max(0, Number(str(a.cursor)) || 0);
  const rows = [...found].slice(from, from + 20).map(([id, line]) => ({ ...named(id), ...(line && { line: line.slice(0, 200) }) }));
  return { found: rows, ...(found.size > from + 20 && { cursor: String(from + 20) }) };
}

const base64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

// A copy the agent can open, kept with its chat (outside the folder), as Project 1's attachments are.
async function attachment(c: Caller, a: Args) {
  const { id } = await pageIn(c, a.page);
  const file = attachmentsOf(pageOf(id)!, await bodyOf(id)).find((f) => f.id === str(a.attachment));
  if (!file) throw new Refusal(`“${titleOf(id)}” has no attachment "${str(a.attachment)}"; read lists them.`);
  const bytes = new Uint8Array(await (await fetch(file.url)).arrayBuffer());
  const { path } = await ask<{ path: string }>("POST", `/v1/sessions/${c.session}/attachments`, { name: file.name, data: base64(bytes) });
  return { path, name: file.name, size: bytes.length, ...(file.mime && { mime: file.mime }) };
}

async function project(c: Caller) {
  const folder = projectOf(c);
  if (!folder) throw new Refusal("This chat's folder isn't linked to a page in LeadingLight any more.");
  const you = agentOf(c);
  const task = ids(you?.properties["agent-task"]).find((id) => pageOf(id));
  return {
    project: named(folder.pageId),
    folder: folder.path,
    ...(you && { you: named(you.id) }),
    ...(task && { task: { ...named(task), brief: part(await bodyOf(task), 0).text, done: pageOf(task)!.properties.done === true } }),
    how: "read and search cover the project's pages; the folder's files are yours to read as usual. publish adds a report beside your task, or the page you name.",
  };
}

const plain = (s: string) => s.replace(/\s+/g, " ").trim();

// Where a report goes: the page named, else the agent's task, else the project.
async function destination(c: Caller, to: unknown, agent: ObjectSummary): Promise<string> {
  if (str(to)) return (await pageIn(c, to)).id;
  const task = ids(agent.properties["agent-task"]).find((id) => pageOf(id));
  return task ?? projectOf(c)!.pageId;
}

// Each source is a page of the project holding the words it quotes; the line around them is kept.
async function sourcesOf(c: Caller, given: unknown): Promise<Source[]> {
  const out: Source[] = [];
  const wrong: string[] = [];
  for (const [i, s] of (Array.isArray(given) ? given : []).entries()) {
    const { page, quote } = (s ?? {}) as Args;
    try {
      const { id } = await pageIn(c, page);
      const q = plain(str(quote));
      const lines = roleOf(pageOf(id)!) === "thoughts" ? [] : docText(await bodyOf(id)).split("\n").map(plain);
      const line = q ? lines.find((l) => l.includes(q)) : "";
      if (line === undefined) wrong.push(`Source ${i + 1}: “${q.slice(0, 80)}” isn't in “${titleOf(id)}”; quote its words exactly, or leave the quote out.`);
      else out.push({ page: id, ...(q && { quote: q, excerpt: line.slice(0, 400) }) });
    } catch (e) {
      wrong.push(`Source ${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (wrong.length) throw new Refusal(`Nothing was published. ${wrong.join(" ")}`);
  return out;
}

const published = (r: ObjectSummary | LLObject) => {
  const { to, evidence } = reportOf(r)!;
  return {
    report: ref(r.id),
    to: ref(to),
    ...(evidence?.length && { evidence: evidence.map((e) => ({ name: e.name, ref: `${ref(r.id)}#b${e.block}`, version: e.sha.slice(0, 12) })) }),
    note: `It shows after “${titleOf(to)}”'s own words in LeadingLight. Its blocks are ${ref(r.id)}#b1, #b2 and so on. Reports don't change: to correct one, publish another to it.`,
  };
};

// A new report, kept before it is answered; the same call again finds the first.
async function publish(c: Caller, a: Args, call: AgentCall) {
  const done = space.get().pages.find((p) => reportOf(p)?.command === call.id);
  if (done) return published(done);
  const md = str(a.markdown).trim();
  if (!md) throw new Refusal("Nothing was published: give the report's text as markdown.");
  if (!projectOf(c)) throw new Refusal("This chat's folder isn't linked to a page in LeadingLight any more.");
  const agent = await agentFor(c);
  let to = await destination(c, a.to, agent);
  // A report about a report corrects it: it goes beside the first, never into it.
  const corrects = reportOf(pageOf(to)) ? to : undefined;
  if (corrects) to = reportOf(pageOf(corrects))!.to;
  const sources = await sourcesOf(c, a.sources);
  // The files it shows, kept in LeadingLight as the runtime copied them, after its words.
  const words = htmlDoc(markdownHtml(md).html);
  const evidence = await keepEvidence(call.files ?? [], a.evidence, (words.content?.length ?? 0) + 1);
  const content = { ...words, content: [...(words.content ?? []), ...evidenceBlocks(evidence)] };
  // Only the agent given the task says it is ready for review; a worker's report is read as any other.
  const ready = a.ready === true && !ids(agent.properties["agent-parent"]).length;
  const meta: ReportMeta = { by: agent.id, conversation: c.conversation, session: c.session, turn: c.turn, to, at: Date.now(), command: call.id, sources, ...(evidence.length && { evidence: evidence.map(({ url, ...e }) => (url?.startsWith("data:") ? e : { ...e, url })) }), ...(corrects && { corrects }), ...(ready && { ready }) };
  const report = await createPage({ typeId: REPORT, title: str(a.title).trim() || "Report", content, properties: { parent: to, role: "report", "report-by": [agent.id], report: meta } });
  return { ...published(report), ...(a.ready === true && !ready && { ready: "Not set: only the agent given the task says it is ready; tell it instead." }) };
}

// Subtasks of the agent's task: made by it, ticked by it. Its main task, and any task it didn't
// make, only the person ticks (DECISIONS.md, 22).
async function task(c: Caller, a: Args, call: AgentCall) {
  const agent = await agentFor(c);
  const main = taskOfAgent(agent);
  const action = str(a.action);
  if (action === "create") {
    const made = space.get().pages.find((p) => p.properties.command === call.id);
    if (made) return { subtask: ref(made.id), title: made.title };
    if (!main || !pageOf(main)) throw new Refusal("You have no task to add subtasks to: subtasks belong to a task you were given.");
    const title = str(a.title).trim();
    if (!title) throw new Refusal("Give the subtask a title.");
    const parent = pageOf(main)!;
    // Its project, as its task has it.
    const projectProp = typeOf(parent.typeId).props.find((id) => propOf(id)?.kind === "relation" && ids(parent.properties[id]).some((x) => folders.get().has(x)));
    const brief = str(a.brief).trim();
    const made2 = await createPage({
      typeId: parent.typeId,
      title,
      properties: { "subtask-of": [main], madeBy: agent.id, command: call.id, ...(projectProp && { [projectProp]: parent.properties[projectProp] }) },
      ...(brief && { content: htmlDoc(markdownHtml(brief).html) }),
    });
    return { subtask: ref(made2.id), title };
  }
  if (action !== "done" && action !== "undo") throw new Refusal("action is create, done or undo.");
  const { id } = await pageIn(c, a.id);
  const sub = pageOf(id)!;
  // Made by its own team: the agent, the one that started it, or their workers.
  const lead = ids(agent.properties["agent-parent"])[0] ?? agent.id;
  const mine = [lead, ...workersOf(lead).map((w) => w.id)].includes(str(sub.properties.madeBy));
  if (!mine) throw new Refusal(`Only the person marks “${titleOf(id)}” done${id === main ? ": it is the task you were given. Publish a report with ready: true when it is ready for review" : ""}.`);
  await editPage(id, { properties: (p) => ({ ...p, done: action === "done" }) });
  return { subtask: ref(id), done: action === "done" };
}

// What the agent is doing now and its steps, shown live on its task; each call replaces the last.
async function status(c: Caller, a: Args) {
  const agent = await agentFor(c);
  const list = (Array.isArray(a.checklist) ? a.checklist : []) as Args[];
  const work: Work = {
    ...(str(a.activity).trim() && { activity: str(a.activity).trim().slice(0, 200) }),
    ...(Array.isArray(a.checklist) && { checklist: list.filter((x) => str(x?.text).trim()).slice(0, 50).map((x) => ({ text: str(x.text).trim().slice(0, 200), ...(x.done === true && { done: true }) })) }),
    at: Date.now(),
  };
  await editPage(agent.id, { properties: (p) => ({ ...p, work }) });
  return { shown: "on your task, in place of what you said before" };
}

// What a question the agent is about to ask concerns, checked like a report's sources, kept on its
// Agent page for the Feed to show beside the question (features/feed.feature).
async function context(c: Caller, a: Args) {
  const question = plain(str(a.question));
  if (!question) throw new Refusal("Give the question exactly as you will ask it.");
  const about: Target[] = [];
  const wrong: string[] = [];
  for (const [i, x] of (Array.isArray(a.about) ? a.about : []).entries()) {
    const t = (x ?? {}) as Args;
    try {
      const href = parseHref(str(t.evidence));
      if (href) {
        const { id } = await pageIn(c, href.page);
        const block = Number(href.anchor?.replace(/^b/, "")) || undefined;
        about.push({ page: id, ...(block && { block }), ...(typeof t.at === "number" && { at: t.at }) });
      } else {
        const [s] = await sourcesOf(c, [{ page: t.page, quote: t.quote }]);
        about.push({ page: s.page, ...(s.quote && { quote: s.quote, excerpt: s.excerpt }) });
      }
    } catch (e) {
      wrong.push(`About ${i + 1}: ${e instanceof Error ? e.message.replace(/^Nothing was published\. Source 1: /, "") : String(e)}`);
    }
  }
  if (wrong.length) throw new Refusal(`Not kept. ${wrong.join(" ")}`);
  if (!about.length) throw new Refusal("Say what the question is about: a page with the words it concerns, or a report's evidence.");
  const agent = await agentFor(c);
  const asks = [...((agent.properties.asks as Ask[] | undefined) ?? []), { question, about, at: Date.now() }].slice(-20);
  await editPage(agent.id, { properties: (p) => ({ ...p, asks }) });
  return { kept: "It shows beside your question in LeadingLight. Now ask it with your question tool, in the same words." };
}

const TOOLS: Record<string, (c: Caller, a: Args, call: AgentCall) => Promise<unknown>> = { project, read, search, attachment, publish, task, status, context };
const WRITES = new Set(["publish", "task", "status", "context"]);

export async function runAgentTool(call: AgentCall): Promise<unknown> {
  const tool = TOOLS[call.tool];
  if (!tool) throw new Refusal(`LeadingLight has no tool called ${call.tool}.`);
  // A write can add pages to the project: the next read looks again.
  if (WRITES.has(call.tool)) scopes.clear();
  return tool(call.caller, call.args ?? {}, call);
}
