import { create } from "zustand";

import type { Client, Location, Session } from "@/lib/api";
import { agentOf, worktreeOf } from "@/lib/derive";
import { projectOf } from "@/lib/projects";
import type { Leaf, PaneNode } from "@/lib/layout";
import { useStore } from "@/lib/store";
import { openComposer } from "@/lib/composer";
import { currentSpace } from "@/lib/workspaces";

// Saved prompts: text you send agents again and again, with {{variables}}
// filled in when you send it. The library is one document on this laptop
// (/v1/app/prompts), so it is the same in every window and survives
// reinstalling the app. Until someone saves it, the starters below stand in.

export interface PromptVariable {
  name: string;
  label?: string;
  default?: string;
  multiline?: boolean;
}

export interface SavedPrompt {
  id: string;
  title: string;
  body: string;
  tags: string[];
  // A project's id (as the sidebar groups them) to offer it only there;
  // unset is everywhere.
  project?: string;
  // Labels and defaults for the {{variables}} the body uses.
  variables?: PromptVariable[];
  updated?: string;
  uses?: number;
  last_used?: string;
}

interface PromptsDoc {
  version: 1;
  prompts: SavedPrompt[];
  [extra: string]: unknown;
}

// Variables every prompt can use, filled from the session it goes to.
export const BUILTINS: { name: string; label: string }[] = [
  { name: "worktree.name", label: "The worktree's name" },
  { name: "worktree.path", label: "The worktree's path on the box" },
  { name: "branch", label: "The worktree's branch" },
  { name: "base", label: "The branch new worktrees start from (main)" },
  { name: "project", label: "The project (owner/name, or the location)" },
  { name: "location", label: "The location on the box" },
  { name: "box", label: "The box" },
  { name: "agent", label: "The agent (claude, codex…)" },
];
const BUILTIN_NAMES = new Set(BUILTINS.map((b) => b.name));
export const isBuiltin = (name: string) => BUILTIN_NAMES.has(name);

export const STARTERS: SavedPrompt[] = [
  {
    id: "starter-review",
    title: "Review the diff",
    tags: ["review"],
    body: "Review the changes on {{branch}} against {{base}} (git diff {{base}}...HEAD, plus anything uncommitted).\n\nList bugs first, most severe first, each with file:line and why it is wrong. Then risky spots worth a second look, then nits. Don't edit any files.",
  },
  {
    id: "starter-tests",
    title: "Write the missing tests",
    tags: ["tests"],
    body: "Look at what changed on {{branch}} compared to {{base}} and write the tests that are missing for it: the behaviour, the edge cases and the failure paths, in the style of the tests already in this repo.\n\nRun them and make sure they pass. Don't change the code under test; if a test finds a real bug, tell me before fixing it.",
  },
  {
    id: "starter-rebase",
    title: "Rebase onto main and fix conflicts",
    tags: ["git"],
    body: "Fetch, then rebase {{branch}} onto the latest {{base}}. Resolve conflicts keeping the intent of both sides; where that's unclear, stop and ask me.\n\nThen run {{check}} and fix whatever the rebase broke.",
    variables: [{ name: "check", label: "Check to run after", default: "the tests" }],
  },
  {
    id: "starter-pr",
    title: "Write the PR description",
    tags: ["git", "writing"],
    body: "Write a pull request description for {{branch}} against {{base}}: a one-line title, what changed and why, how to test it, and what a reviewer should look at closely.\n\nRead the diff and the commits; don't guess. Reply with the markdown only and don't edit files.",
  },
  {
    id: "starter-dead-code",
    title: "Remove dead code you introduced",
    tags: ["cleanup"],
    body: "Find code added or changed on {{branch}} that nothing uses any more: unused functions, exports, variables, imports, flags and files, leftover debug logging, commented-out code.\n\nRemove it without changing behaviour, then run the build and the tests.",
  },
  {
    id: "starter-errors",
    title: "Tighten error handling",
    tags: ["cleanup"],
    body: "Go through the files changed on {{branch}} and tighten their error handling: no swallowed errors or empty catches, errors carry enough context to act on, messages people see say what to do next, and a failure never leaves things half done.\n\nKeep the changes small and in the code's existing style. Run the tests.",
  },
  {
    id: "starter-status",
    title: "Where are you?",
    tags: ["status"],
    body: "Pause and tell me where you are, in a few lines: what's done, what's left, anything you're unsure about, and what you need from me. Don't make changes.",
  },
  {
    id: "starter-fix-check",
    title: "Make the check pass",
    tags: ["tests"],
    body: "Run {{check}} and fix what fails. Fix the cause rather than the test; if a test is wrong, explain why before changing it. Repeat until it passes, then summarise what you changed.",
    variables: [{ name: "check", label: "Check", default: "the test suite" }],
  },
];

// The {{name}} tokens in a body, in order, once each.
const TOKEN = /\{\{\s*([a-zA-Z_][\w.-]*)\s*\}\}/g;

export function variablesIn(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(TOKEN)) seen.add(m[1]);
  return [...seen];
}

// The variables a person fills in: every token that is not built in, with
// the prompt's labels and defaults.
export function askedVariables(p: Pick<SavedPrompt, "body" | "variables">): PromptVariable[] {
  return variablesIn(p.body)
    .filter((n) => !isBuiltin(n))
    .map((name) => ({ name, ...p.variables?.find((v) => v.name === name) }));
}

export const variableLabel = (v: PromptVariable) => v.label || v.name.replace(/[._-]+/g, " ").replace(/^./, (c) => c.toUpperCase());

export interface Segment {
  text: string;
  // The variable this text filled, or the token left as it was (missing).
  variable?: string;
  missing?: boolean;
}

// segments is the body with its tokens filled, as pieces, so a preview can
// mark what was filled and what still is not.
export function segments(body: string, values: Record<string, string | undefined>): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN)) {
    if (m.index > last) out.push({ text: body.slice(last, m.index) });
    const v = values[m[1]];
    out.push(v ? { text: v, variable: m[1] } : { text: m[0], variable: m[1], missing: true });
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push({ text: body.slice(last) });
  return out;
}

export const fill = (body: string, values: Record<string, string | undefined>) =>
  segments(body, values)
    .map((s) => (s.missing ? "" : s.text))
    .join("");

// What the built-ins are for one session, from where it runs.
export function builtinValues(box: string, session: Session, locations?: Location[]): Record<string, string> {
  const where = worktreeOf(locations, session);
  const v: Record<string, string> = { box };
  const agent = agentOf(session);
  if (agent) v.agent = agent;
  if (where) {
    v["worktree.name"] = where.worktree.name;
    v["worktree.path"] = where.worktree.path;
    v.location = where.location.name;
    const project = projectOf(box, where.location.name);
    v.project = project?.slug || project?.name || where.location.slug || where.location.name;
    v.base = where.location.default_branch || "main";
    if (where.worktree.branch) v.branch = where.worktree.branch;
  } else {
    v["worktree.path"] = session.dir;
    if (session.location) v.location = session.location.split("/")[0];
    v.base = "main";
  }
  return v;
}

export function sessionValues(box: string, sessionName: string): Record<string, string> {
  const d = useStore.getState().boxes[box];
  const s = d?.sessions?.find((x) => x.name === sessionName);
  return s ? builtinValues(box, s, d?.locations) : { box };
}

// The project (its id, as the sidebar groups them) a session works in, for
// prompts scoped to a project.
export function sessionProject(box: string, sessionName: string): string | undefined {
  const d = useStore.getState().boxes[box];
  const s = d?.sessions?.find((x) => x.name === sessionName);
  const where = s && worktreeOf(d?.locations, s);
  return where ? projectOf(box, where.location.name)?.id : undefined;
}

// Prompts for a place: everywhere ones, and those scoped to its project
// first. Most used, then most recent, lead.
export function promptsFor(prompts: SavedPrompt[], project?: string): SavedPrompt[] {
  const rank = (p: SavedPrompt) => (p.project && p.project === project ? 0 : 1);
  return prompts
    .filter((p) => !p.project || p.project === project)
    .slice()
    .sort((a, b) => rank(a) - rank(b) || (b.last_used ?? "").localeCompare(a.last_used ?? "") || a.title.localeCompare(b.title));
}

export function matches(p: SavedPrompt, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${p.title} ${p.tags.join(" ")} ${p.body}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export const newPromptId = () => `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const api = {
  async get(c: Client): Promise<PromptsDoc | null> {
    return c.laptop<PromptsDoc | null>("GET", "/v1/app/prompts");
  },
  async put(c: Client, doc: PromptsDoc) {
    await c.laptop("PUT", "/v1/app/prompts", doc);
  },
};

interface PromptsState {
  prompts: SavedPrompt[];
  // False until the document has been read once.
  loaded: boolean;
  // Whether the laptop holds a library yet; until then these are starters.
  saved: boolean;
  error?: string;
  load(): Promise<void>;
  save(prompts: SavedPrompt[]): Promise<void>;
  upsert(p: SavedPrompt): Promise<void>;
  remove(id: string): Promise<void>;
  // used notes a send, so the picker can put what you use first.
  used(ids: string[]): void;
}

export const usePrompts = create<PromptsState>()((set, get) => ({
  prompts: STARTERS,
  loaded: false,
  saved: false,
  async load() {
    const c = useStore.getState().client;
    if (!c) return;
    try {
      const doc = await api.get(c);
      set({ prompts: doc?.prompts ?? STARTERS, saved: !!doc, loaded: true, error: undefined });
    } catch (err) {
      set({ loaded: true, error: err instanceof Error ? err.message : String(err) });
    }
  },
  async save(prompts) {
    const c = useStore.getState().client;
    const before = get().prompts;
    set({ prompts, saved: true });
    if (!c) return;
    try {
      // Re-read first so fields another window or version added survive.
      const doc = await api.get(c).catch(() => null);
      await api.put(c, { ...doc, version: 1, prompts });
    } catch (err) {
      set({ prompts: before });
      throw err;
    }
  },
  async upsert(p) {
    const list = get().prompts;
    const next = { ...p, updated: new Date().toISOString() };
    await get().save(list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? next : x)) : [next, ...list]);
  },
  async remove(id) {
    await get().save(get().prompts.filter((p) => p.id !== id));
  },
  used(ids) {
    const now = new Date().toISOString();
    const next = get().prompts.map((p) => (ids.includes(p.id) ? { ...p, uses: (p.uses ?? 0) + 1, last_used: now } : p));
    void get()
      .save(next)
      .catch(() => {});
  },
}));

// Where the prompt dialogs are. The picker sends one prompt to one session,
// or hands the filled text back (insert); broadcast sends to many.
export interface PickerDraft {
  box?: string;
  session?: string;
  promptId?: string;
  // Instead of sending, give the filled text to whoever asked.
  onInsert?(text: string): void;
}

export interface Target {
  box: string;
  session: string;
}

export interface BroadcastDraft {
  targets?: Target[];
  promptId?: string;
  text?: string;
}

interface PromptUi {
  picker?: PickerDraft;
}

export const usePromptUi = create<PromptUi>()(() => ({}));

export function openPromptPicker(d: PickerDraft = {}) {
  useStore.getState().setPaletteOpen(false);
  usePromptUi.setState({ picker: d });
}
export const closePromptPicker = () => usePromptUi.setState({ picker: undefined });

// openBroadcast opens the composer on "Running agents": one prompt, filled
// in for each agent picked, sent one after another.
export function openBroadcast(d: BroadcastDraft = {}) {
  useStore.getState().setPaletteOpen(false);
  usePromptUi.setState({ picker: undefined });
  const body = d.promptId ? usePrompts.getState().prompts.find((p) => p.id === d.promptId)?.body : undefined;
  openComposer({ mode: "send", targets: d.targets, promptId: d.promptId, text: d.text ?? body });
}

// The session in the focused pane of the worktree in front, if it is one.
export function focusedSession(): Target | undefined {
  const ws = currentSpace();
  const tab = ws?.tabs.find((t) => t.id === ws.active) ?? ws?.tabs[0];
  if (!tab) return undefined;
  const find = (n: PaneNode): Leaf | undefined => (n.kind === "leaf" ? (n.id === tab.focus ? n : undefined) : (find(n.a) ?? find(n.b)));
  const c = find(tab.root)?.content;
  return c?.kind === "terminal" ? { box: c.box, session: c.session } : undefined;
}
