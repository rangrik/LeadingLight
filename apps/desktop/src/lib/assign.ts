import { type Access, isClaude } from "~/lib/ai-prefs";
import type { Agent as Profile } from "~/lib/agents";
import { pageLabel } from "~/lib/labels";
import { editPage } from "~/lib/live";
import { type ObjectSummary, objects } from "~/lib/objects";
import { docMarkdown } from "~/lib/page-markdown";
import { accessOf, type Conversation, listChats, modeFor, send, sync } from "~/lib/project-runtime/chat";
import { folders } from "~/lib/project-runtime/folders";
import { ask, call } from "~/lib/project-runtime/transport";
import { createPage, pageOf, propOf, space, typeOf } from "~/lib/space";
import { summarize } from "~/lib/store";
import { AGENT, agentFor, relationsOf, type Run, runOf } from "~/lib/work";
import { watchWork } from "~/lib/work-watch";

// Giving a task to an agent (features/assign.feature, DECISIONS.md 21). One Agent page and one
// runtime conversation per assignment, its session named after the Agent page, so a second click,
// a reload or a restart finds the work already started rather than starting it again.

export type Assignment = { agent: string; at: number; note?: string };
export const assignmentOf = (p?: ObjectSummary) => p?.properties.assignment as Assignment | undefined;
// A task is any page whose type has Done (DECISIONS.md, 17), a space's own task types included.
export const isTask = (p?: ObjectSummary) => !!p && typeOf(p.typeId).props.includes("done");
// The task a document was assigned through.
export const taskOfDocument = (docId: string) => space.get().pages.find((p) => p.properties.brief === docId && isTask(p));

const linked = (id: string) => !!folders.get().get(id) && !folders.get().get(id)!.missing;

// A page's project: itself when it has a folder, else a page it relates to or one linking to it.
export async function projectFor(pageId: string): Promise<string | undefined> {
  const p = pageOf(pageId);
  if (!p) return;
  if (linked(pageId)) return pageId;
  const brief = typeof p.properties.brief === "string" ? p.properties.brief : undefined;
  const near = [...relationsOf(p), ...(brief ? [brief] : [])];
  const found = near.find(linked);
  if (found) return found;
  for (const id of near) if (pageOf(id) && relationsOf(pageOf(id)!).some(linked)) return relationsOf(pageOf(id)!).find(linked);
  return (await objects.containing(pageId)).find((o) => linked(o.id))?.id;
}

const sessionFor = (agentId: string) => `task-${agentId.replace(/[^a-z0-9]/gi, "").slice(0, 12)}`;
const title = (id: string) => pageLabel(pageOf(id)?.title ?? "");

// What the agent is told: the task, its brief as written now, and how to work in LeadingLight.
async function brief(task: ObjectSummary, run: Run & { note?: string; profile?: string }): Promise<string> {
  const md = async (id: string) => docMarkdown((await objects.get(id))?.content, (x) => `[${title(x)}](ll:${x})`);
  const doc = typeof task.properties.brief === "string" ? task.properties.brief : undefined;
  const project = await projectFor(task.id);
  return [
    `You were given a task in LeadingLight: “${title(task.id)}” (ll:${task.id})${project ? `, in the project “${title(project)}” (ll:${project})` : ""}.`,
    (await md(task.id)).trim() && `The task's brief:\n\n${(await md(task.id)).trim()}`,
    doc && `It asks for what this page says, “${title(doc)}” (ll:${doc}):\n\n${(await md(doc)).trim()}`,
    run.note && `The person adds: ${run.note}`,
    run.profile,
    "Work in this folder. Read more of the project with LeadingLight's read and search tools. Keep your current step and a checklist of concrete steps up to date with the status tool; split the work into subtasks with the task tool if that helps. Before asking the person something with your question tool, say what it is about with the context tool. When the work is ready for review, publish a report to the task with publish (ready: true): what you did, and evidence that shows it. Only the person marks the task done.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// Starts an assignment's agent once. Asked again (a reload, a restart, a second click), it finds the
// conversation already there by its session's name and only records it. One start at a time.
const starting = new Map<string, Promise<void>>();
export function start(agentId: string): Promise<void> {
  const going = starting.get(agentId) ?? startOnce(agentId).finally(() => starting.delete(agentId));
  starting.set(agentId, going);
  return going;
}

async function startOnce(agentId: string): Promise<void> {
  const agent = pageOf(agentId);
  const run = runOf(agent) as (Run & { model: string; effort: string; mode: string; note?: string; profile?: string }) | undefined;
  const task = agent && pageOf((agent.properties["agent-task"] as string[] | undefined)?.[0] ?? "");
  if (!agent || !run || run.conversation || !task) return;
  // The one that ran, should two have its name (two windows starting it at once).
  const find = async () => {
    const named = (await listChats(run.location)).filter((c) => c.session === run.session);
    return named.find((c) => c.live) ?? named.find((c) => c.updated) ?? named[0];
  };
  let conv = await find();
  if (!conv) {
    const r = await call<{ error?: string }>("POST", "/v1/sessions", { name: run.session, location: run.location, agent: run.agent, driver: run.agent, mode: run.mode, model: run.model, effort: run.effort, title: title(task.id), prompt: await brief(task, run) });
    // 409: a start already under way, by another click or before a restart.
    if (r.status >= 400 && r.status !== 409) throw new Error(r.body?.error ?? `The runtime answered ${r.status}`);
    conv = await find();
  }
  if (conv) await editPage(agentId, { properties: (p) => ({ ...p, run: { ...(p.run as object), conversation: conv.id } }) });
  watchWork();
}

const NAME = { claude: "Claude", codex: "Codex" };

// The task a document is assigned through, made once and linked to it and its project.
async function taskFor(doc: ObjectSummary, project: string): Promise<ObjectSummary> {
  const found = taskOfDocument(doc.id);
  if (found) return found;
  const type = space.get().types.find((t) => t.id === "task") ?? space.get().types.find((t) => t.props.includes("done"));
  if (!type) throw new Error("This space has no task type: make one with a Done property first.");
  const projectProp = type.props.find((id) => propOf(id)?.kind === "relation" && propOf(id)?.options.type === pageOf(project)?.typeId);
  return summarize(
    await createPage({
      typeId: type.id,
      title: doc.title,
      properties: { brief: doc.id, ...(projectProp && { [projectProp]: [project] }) },
      content: { type: "doc", content: [{ type: "pageLink", attrs: { id: doc.id } }] },
    }),
  );
}

const busy = new Set<string>();

// Assigns a task, or a document through a task of its own, to a new agent.
export async function assign(pageId: string, o: { model: string; effort: string; access: Access; profile?: Profile; note?: string }): Promise<string> {
  if (busy.has(pageId)) throw new Error("It is being assigned already.");
  busy.add(pageId);
  try {
    const page = pageOf(pageId);
    if (!page) throw new Error("That page is gone.");
    const project = await projectFor(pageId);
    if (!project) throw new Error("This page isn't part of a project with a linked folder. Set its project, or link a folder to it, first.");
    const task = isTask(page) ? page : await taskFor(page, project);
    const had = assignmentOf(pageOf(task.id));
    if (had && pageOf(had.agent)) return (await start(had.agent), had.agent);
    const kind = isClaude(o.model) ? "claude" : "codex";
    const id = crypto.randomUUID();
    const run = { conversation: "", session: sessionFor(id), location: folders.get().get(project)!.folder.location, agent: kind, model: o.model, effort: o.effort, mode: modeFor({ access: o.access, plan: false }, kind), ...(o.note && { note: o.note }), ...(o.profile && { profile: o.profile.prompt }) };
    const profile = o.profile ? `${o.profile.name} (${NAME[kind]}, ${o.model})` : `${NAME[kind]}, ${o.model}`;
    // The Agent page and the task's link to it are kept before the agent starts.
    await createPage({ id, typeId: AGENT, title: `${o.profile?.name ?? NAME[kind]}: ${title(task.id)}`, properties: { run, "agent-task": [task.id], "agent-profile": profile } });
    await editPage(task.id, { properties: (p) => ({ ...p, assignment: { agent: id, at: Date.now(), ...(o.note && { note: o.note }) } }) });
    await start(id);
    return id;
  } finally {
    busy.delete(pageId);
  }
}

// Workers an agent started, each kept as an Agent page under it, so they stay listed after the
// runtime forgets them. Looked for at most every 10 s per agent.
const looked = new Map<string, number>();
export async function syncWorkers(agentId: string): Promise<void> {
  const agent = pageOf(agentId);
  const run = runOf(agent);
  if (!run?.conversation || Date.now() - (looked.get(agentId) ?? 0) < 10_000) return;
  looked.set(agentId, Date.now());
  // Wherever they work: a worker may be started in another worktree.
  const theirs = (await ask<Conversation[]>("GET", "/v1/conversations?limit=200")).filter((c) => c.by === run.session);
  for (const c of theirs) {
    if (space.get().pages.some((p) => runOf(p)?.conversation === c.id)) continue;
    await agentFor({ session: c.session ?? "", conversation: c.id, location: c.location, agent: c.agent, by: run.session });
  }
}

// Stops the agent's turn; its workers carry on until told.
export const stopAgent = (agentId: string) => call("POST", `/v1/sessions/${runOf(pageOf(agentId))?.session}/interrupt`);

// Asks a stopped or idle agent to carry on, resuming its conversation when its session has ended.
export async function carryOn(agentId: string): Promise<void> {
  const run = runOf(pageOf(agentId));
  const conv = run && (await listChats(run.location.split("/")[0])).find((c) => c.id === run.conversation);
  if (!run || !conv) throw new Error("Its conversation isn't in the runtime any more.");
  await sync(conv.id, conv);
  const kind = conv.agent === "codex" ? "codex" : "claude";
  await send(conv.id, run.location, "Carry on with the task.", { model: conv.model ?? "", effort: conv.effort ?? "", ...accessOf(conv.mode, kind) });
}
