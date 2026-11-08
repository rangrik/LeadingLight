import { type Access, aiPrefs, isClaude } from "~/lib/ai-prefs";
import { type Agent as Profile, listAgents } from "~/lib/agents";
import { isReady } from "~/lib/breakdown";
import { effortFor } from "~/lib/codex";
import { pageLabel } from "~/lib/labels";
import { editPage } from "~/lib/live";
import { flushAll } from "~/lib/saving";
import { type ObjectSummary, objects } from "~/lib/objects";
import { docMarkdown } from "~/lib/page-markdown";
import { accessOf, type Conversation, listChats, modeFor, send, sync } from "~/lib/project-runtime/chat";
import { folders } from "~/lib/project-runtime/folders";
import { ask, call } from "~/lib/project-runtime/transport";
import { createPage, pageOf, propOf, retype, space, typeOf } from "~/lib/space";
import { ensureTag } from "~/lib/capture";
import { action } from "~/lib/history-types";
import { AGENT, agentFor, relationsOf, type Run, runOf, subtasksOf } from "~/lib/work";
import { watchWork } from "~/lib/work-watch";
import { worktreeName } from "~/lib/worktree-name";

// Giving a task to an agent (features/assign.feature, DECISIONS.md 21). One Agent page and one
// runtime conversation per assignment, its session named after the Agent page, so a second click,
// a reload or a restart finds the work already started rather than starting it again.

// The person's choices are kept so the task's subtasks can start with them (DECISIONS.md, 43).
export type Assignment = { agent: string; at: number; note?: string; model?: string; effort?: string; access?: Access; profile?: string; worktree?: boolean };
export const assignmentOf = (p?: ObjectSummary) => p?.properties.assignment as Assignment | undefined;
// The agent a task was given: by the task's own link, or, should the app have quit before that link
// was saved, by the Agent page made for it (it is made first, linked to the task).
export function agentOfTask(p?: ObjectSummary): ObjectSummary | undefined {
  const linked = pageOf(assignmentOf(p)?.agent ?? "");
  if (linked || !p) return linked;
  return space.get().pages.find((a) => a.typeId === AGENT && (a.properties["agent-task"] as string[] | undefined)?.[0] === p.id && !(a.properties["agent-parent"] as string[] | undefined)?.length);
}
// A task is any page whose type has Done (DECISIONS.md, 17), a space's own task types included.
export const isTask = (p?: ObjectSummary) => !!p && typeOf(p.typeId).props.includes("done");
// What a page can become when assigned: the space's own task types, not the app's.
export const taskTypes = () => space.get().types.filter((t) => t.props.includes("done") && t.made !== "app");
export const NO_TASK_TYPE = "This space has no type with Done, so this page can't become a task. Make one first.";

const linked = (id: string) => !!folders.get().get(id) && !folders.get().get(id)!.missing;
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const projectProp = (props: string[]) => props.find((id) => propOf(id)?.kind === "relation" && propOf(id)?.options.type === "project");

// A task line made inside a page (DECISIONS.md, 43): inside a task it is a subtask, and it takes the
// project of the page it was made in. A page with neither gives nothing; nothing is guessed.
export function madeInside(hereId: string | undefined, typeId: string): Record<string, unknown> {
  const here = pageOf(hereId ?? "");
  const to = projectProp(typeOf(typeId).props);
  if (!here || !typeOf(typeId).props.includes("done")) return {};
  const from = Object.keys(here.properties).find((k) => projectProp([k]) && ids(here.properties[k]).length);
  return { ...(isTask(here) && { "subtask-of": [here.id] }), ...(to && from && { [to]: ids(here.properties[from]) }) };
}

// A page's project: itself when it has a folder, else a page it relates to or one linking to it.
export async function projectFor(pageId: string): Promise<string | undefined> {
  const p = pageOf(pageId);
  if (!p) return;
  if (linked(pageId)) return pageId;
  const near = relationsOf(p);
  const found = near.find(linked);
  if (found) return found;
  for (const id of near) if (pageOf(id) && relationsOf(pageOf(id)!).some(linked)) return relationsOf(pageOf(id)!).find(linked);
  return (await objects.containing(pageId)).find((o) => linked(o.id))?.id;
}

const sessionFor = (agentId: string) => `task-${agentId.replace(/[^a-z0-9]/gi, "").slice(0, 12)}`;
const title = (id: string) => pageLabel(pageOf(id)?.title ?? "");

const WORK = "Work in this folder. Read more of the project with LeadingLight's read and search tools. Keep your current step and a checklist of concrete steps up to date with the status tool; split the work into subtasks with the task tool if that helps. Before asking the person something with your question tool, say what it is about with the context tool. When the work is ready for review, publish a report to the task with publish (ready: true): what you did, and evidence that shows it. Only the person marks the task done.";
const PLAN = "Plan first, and don't do the work. Read the task and the project with LeadingLight's read and search tools and the folder's files. Then break the work into subtasks with the task tool, each with a title, a brief that stands on its own (another agent works it from that brief and this task's words alone), and after: the subtasks it waits on. Keep them few, and parallel where you can. Then publish a short report to the task with publish (ready: true) saying what the plan is, and stop. Never start the subtasks and never do the work yourself: the person starts them.";

// What the agent is told: the task, its brief as written now (and its parent's, for a subtask), and how to work in LeadingLight.
async function brief(task: ObjectSummary, run: Run & { note?: string; profile?: string; plan?: boolean }): Promise<string> {
  const md = async (id: string) => docMarkdown((await objects.get(id))?.content, (x) => `[${title(x)}](ll:${x})`).trim();
  const project = await projectFor(task.id);
  const parent = ids(task.properties["subtask-of"]).find((id) => pageOf(id));
  const [own, whole] = await Promise.all([md(task.id), parent ? md(parent) : ""]);
  const tree = run.location.split("/")[1];
  return [
    title(task.id),
    `You were given this task in LeadingLight (ll:${task.id})${project ? `, in the project “${title(project)}” (ll:${project})` : ""}.`,
    own && `The task's brief:\n\n${own}`,
    parent && `This is part of “${title(parent)}” (ll:${parent})${whole ? `:\n\n${whole}` : "."}`,
    run.note && `The person adds: ${run.note}`,
    tree && `You work in the worktree ${tree} of the project, on the branch ll/${tree}. Stay on it: never switch branches or check out another.`,
    run.profile,
    run.plan ? PLAN : WORK,
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
  const run = runOf(agent) as (Run & { model: string; effort: string; mode: string; note?: string; profile?: string; plan?: boolean }) | undefined;
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

// A page with no Done becomes the task itself (DECISIONS.md, 21): its Project moves to the task
// type's own, so the project lists it once, and a tag says where it came from.
async function becomeTask(page: ObjectSummary, typeId: string | undefined, project: string) {
  const type = taskTypes().find((t) => t.id === typeId) ?? taskTypes().find((t) => t.id === "task") ?? taskTypes()[0];
  if (!type) throw new Error(NO_TASK_TYPE);
  const from = typeOf(page.typeId);
  const projectOf = (props: string[]) => props.find((id) => propOf(id)?.kind === "relation" && propOf(id)?.options.type === pageOf(project)?.typeId);
  // A task type with no Project of its own leaves the old one, so the page stays in its project.
  const prop = projectOf(type.props), old = prop && projectOf(from.props);
  const tag = await ensureTag(`From ${from.name.toLowerCase()}`);
  await retype(page.id, type.id, ({ [old || ""]: was, ...rest }) => ({
    ...rest,
    ...(prop && { [prop]: Array.isArray(was) && was.length ? was : [project] }),
    tags: [...new Set([...((rest.tags as string[] | undefined) ?? []), tag])],
  }), action(`Changed type to ${type.name}`));
}

// A worktree of the project's own for the task (DECISIONS.md, 42); a name the runtime has goes to the next number.
async function worktreeFor(location: string, task: string): Promise<string> {
  const all = await ask<{ name: string; worktrees?: { name: string }[] }[]>("GET", "/v1/locations");
  const taken = new Set((all.find((l) => l.name === location)?.worktrees ?? []).map((w) => w.name));
  for (let tries = 1; ; tries++) {
    const name = worktreeName(task, taken);
    const r = await call<{ name?: string; error?: string }>("POST", `/v1/locations/${location}/worktrees`, { name, branch: `ll/${name}` });
    if (r.status < 400) return `${location}/${r.body?.name ?? name}`;
    // git says "already exists" (or "already checked out"); berthd passes it on as a 400.
    if (tries === 5 || (r.status !== 409 && !/already/i.test(r.body?.error ?? ""))) throw new Error(r.body?.error ?? `The runtime answered ${r.status}`);
    taken.add(name);
  }
}

const busy = new Set<string>();

// Assigns a page to a new agent, making it the task first if it isn't one.
type Choices = { model: string; effort: string; access: Access; profile?: Profile; note?: string; type?: string; worktree?: boolean; plan?: boolean };
export async function assign(pageId: string, o: Choices): Promise<string> {
  if (busy.has(pageId)) throw new Error("It is being assigned already.");
  busy.add(pageId);
  try {
    const page = pageOf(pageId);
    if (!page) throw new Error("That page is gone.");
    const project = await projectFor(pageId);
    if (!project) throw new Error("This page isn't part of a project with a linked folder. Set its project, or link a folder to it, first.");
    if (project === pageId && !isTask(page)) throw new Error("This is the project itself. Assign one of its tasks or pages instead.");
    if (!isTask(page)) await becomeTask(page, o.type, project);
    const task = pageOf(pageId)!;
    const had = agentOfTask(task);
    if (had) return (await start(had.id), had.id);
    const kind = isClaude(o.model) ? "claude" : "codex";
    const id = crypto.randomUUID();
    const { folder, repo } = folders.get().get(project)!;
    const location = o.worktree && repo ? await worktreeFor(folder.location, title(task.id)) : folder.location;
    const run = { conversation: "", session: sessionFor(id), location, agent: kind, model: o.model, effort: o.effort, mode: modeFor({ access: o.access, plan: false }, kind), ...(o.note && { note: o.note }), ...(o.profile && { profile: o.profile.prompt }), ...(o.plan && { plan: true }) };
    const profile = o.profile ? `${o.profile.name} (${NAME[kind]}, ${o.model})` : `${NAME[kind]}, ${o.model}`;
    // The Agent page and the task's link to it are kept before the agent starts.
    await createPage({ id, typeId: AGENT, title: `${o.profile?.name ?? NAME[kind]}: ${title(task.id)}`, properties: { run, "agent-task": [task.id], "agent-profile": profile } });
    const assignment: Assignment = { agent: id, at: Date.now(), model: o.model, effort: o.effort, access: o.access, ...(o.note && { note: o.note }), ...(o.profile && { profile: o.profile.id }), ...(o.worktree && { worktree: true }) };
    await editPage(task.id, { properties: (p) => ({ ...p, assignment }) });
    // Saved now, not after the editor's pause: a quit in between must not lose the link.
    await flushAll();
    await start(id);
    return id;
  } finally {
    busy.delete(pageId);
  }
}

// An agent's own step: a subtask an agent made while working, not while asked to plan first.
const isStep = (sub: ObjectSummary) => typeof sub.properties.madeBy === "string" && !(runOf(pageOf(sub.properties.madeBy)) as { plan?: boolean } | undefined)?.plan;
const isDone = (id: string) => !pageOf(id) || pageOf(id)!.properties.done === true;
export const afterOf = (p: ObjectSummary) => ids(p.properties.after).filter((id) => pageOf(id));
export const readySubtasks = (parentId: string, pages = space.get().pages) =>
  subtasksOf(parentId, pages).filter((s) => isReady({ done: s.properties.done === true, agent: !!agentOfTask(s), step: isStep(s), after: afterOf(s).map(isDone) }));

// Starts every ready subtask (or just one) with the parent's choices, the note left out; never
// by itself (DECISIONS.md, 43). One assigned meanwhile is left as it is.
export async function startReady(parentId: string, only?: string): Promise<void> {
  const a = assignmentOf(pageOf(parentId));
  const prefs = aiPrefs();
  const model = a?.model ?? prefs.model;
  const profile = a?.profile ? (await listAgents()).find((p) => p.id === a.profile) : undefined;
  const choices = { model, effort: a?.effort ?? effortFor(model, prefs.effort), access: a?.access ?? prefs.access, profile, worktree: !!a?.worktree };
  const subs = readySubtasks(parentId).filter((s) => !only || s.id === only);
  const done = await Promise.allSettled(subs.map((s) => (busy.has(s.id) ? Promise.resolve("") : assign(s.id, choices))));
  const failed = done.find((r) => r.status === "rejected");
  if (failed) throw failed.reason;
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

// The person accepts the task: Done, with the report it was accepted on. Only this, from the
// person's own press, marks an assigned task done (DECISIONS.md, 26); work that comes later shows
// as new, and never undoes it.
export type Accepted = { at: number; report?: string };
export const acceptedOf = (p?: ObjectSummary) => p?.properties.accepted as Accepted | undefined;
export const accept = (task: string, report?: string) =>
  editPage(task, { properties: (p) => ({ ...p, done: true, accepted: { at: Date.now(), ...(report && { report }) } }) });
