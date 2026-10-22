import type { BerthPluginContext, Project, Session } from "@berth/plugin";
import { useSyncExternalStore } from "react";

import * as gh from "./gh";

// Issues and issue threads, fetched with gh on each project's box and kept
// for the session, so coming back to the screen is instant. Lists older than
// two minutes are fetched again when the screen shows them.

export type Load<T> =
  | { status: "loading"; prev?: T }
  | { status: "ok"; value: T; at: number }
  | { status: "problem"; problem: gh.Problem; at: number };

const lists = new Map<string, Load<gh.IssueList>>();
const details = new Map<string, Load<gh.IssueDetail>>();
let version = 0;
let refreshes = 0;
const listeners = new Set<() => void>();

function changed() {
  version++;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

// useIssuesStore re-renders when anything here changes.
export const useIssuesStore = () => useSyncExternalStore(subscribe, () => version);

export const listOf = (project: string) => lists.get(project);
export const detailOf = (repo: string, n: number) => details.get(`${repo.toLowerCase()}#${n}`);

// The palette's "Refresh issues" asks the screen to fetch everything again.
export function askRefresh() {
  refreshes++;
  changed();
}
export const refreshCount = () => refreshes;

export const isGitHubProject = (p: Project) => !!p.slug && (p.remote ? gh.isGitHub(p.remote) : true);

// runnerOf is where gh runs for a project: its default box when that is
// online, otherwise any member that is.
export function runnerOf(p: Project) {
  const m = p.members.find((x) => x.box === p.defaultBox && x.online) ?? p.members.find((x) => x.online);
  return m && { box: m.box, location: m.location.name, member: m };
}

const FRESH = 2 * 60_000;

export async function loadList(berth: BerthPluginContext, p: Project, force = false) {
  const cur = lists.get(p.id);
  if (cur?.status === "loading") return;
  if (!force && cur && Date.now() - cur.at < FRESH) return;
  const prev = cur?.status === "ok" ? cur.value : undefined;
  const run = runnerOf(p);
  if (!p.slug) return;
  if (!run) {
    lists.set(p.id, { status: "problem", problem: { kind: "offline" }, at: Date.now() });
    return changed();
  }
  lists.set(p.id, { status: "loading", prev });
  changed();
  try {
    const res = await berth.orchestrate.exec(run.box, run.location, gh.listCommand(p.slug), "90s");
    const parsed = gh.parse<gh.IssueList>(res.exit_code, res.output, p.slug);
    if ("problem" in parsed) lists.set(p.id, { status: "problem", problem: parsed.problem, at: Date.now() });
    else if (!parsed.ok.enabled) lists.set(p.id, { status: "problem", problem: { kind: "disabled", repo: parsed.ok.repo || p.slug }, at: Date.now() });
    else lists.set(p.id, { status: "ok", value: parsed.ok, at: Date.now() });
  } catch (err) {
    lists.set(p.id, { status: "problem", problem: { kind: "error", message: err instanceof Error ? err.message : String(err) }, at: Date.now() });
  }
  changed();
}

export async function loadDetail(berth: BerthPluginContext, p: Project, n: number, force = false): Promise<gh.IssueDetail | undefined> {
  const key = `${p.slug!.toLowerCase()}#${n}`;
  const cur = details.get(key);
  if (cur?.status === "ok" && !force) return cur.value;
  if (cur?.status === "loading") return waitFor(key);
  const run = runnerOf(p);
  if (!run) {
    details.set(key, { status: "problem", problem: { kind: "offline" }, at: Date.now() });
    changed();
    return undefined;
  }
  details.set(key, { status: "loading", prev: cur?.status === "ok" ? cur.value : undefined });
  changed();
  try {
    const res = await berth.orchestrate.exec(run.box, run.location, gh.detailCommand(p.slug!, n), "60s");
    const parsed = gh.parse<gh.IssueDetail>(res.exit_code, res.output, p.slug);
    details.set(key, "problem" in parsed ? { status: "problem", problem: parsed.problem, at: Date.now() } : { status: "ok", value: parsed.ok, at: Date.now() });
  } catch (err) {
    details.set(key, { status: "problem", problem: { kind: "error", message: err instanceof Error ? err.message : String(err) }, at: Date.now() });
  }
  changed();
  const done = details.get(key);
  return done?.status === "ok" ? done.value : undefined;
}

// waitFor resolves once a thread another caller is fetching arrives.
function waitFor(key: string): Promise<gh.IssueDetail | undefined> {
  return new Promise((resolve) => {
    const stop = subscribe(() => {
      const d = details.get(key);
      if (d?.status === "loading") return;
      stop();
      resolve(d?.status === "ok" ? d.value : undefined);
    });
  });
}

// postComment comments on an issue as whoever gh is logged in as on the
// project's box, then fetches the thread again.
export async function postComment(berth: BerthPluginContext, p: Project, n: number, body: string) {
  const run = runnerOf(p);
  if (!run) throw new Error(`None of ${p.name}'s boxes is online.`);
  const res = await berth.orchestrate.exec(run.box, run.location, gh.commentCommand(p.slug!, n, body), "60s");
  if (res.exit_code !== 0) {
    const problem = gh.readProblem(res.exit_code, res.output, p.slug);
    throw new Error(problem.kind === "error" ? problem.message : describeProblem(problem, run.box).title);
  }
  await loadDetail(berth, p, n, true);
  const list = lists.get(p.id);
  if (list?.status === "ok") {
    lists.set(p.id, { ...list, at: Date.now(), value: { ...list.value, issues: list.value.issues.map((i) => (i.number === n ? { ...i, comments: i.comments + 1, updatedAt: new Date().toISOString() } : i)) } });
    changed();
  }
}

export function describeProblem(p: gh.Problem, box = "the box"): { title: string; body: string; icon: string } {
  switch (p.kind) {
    case "no-gh":
      return { icon: "TerminalSquare", title: `gh isn't installed on ${box}`, body: "Issues come from GitHub's CLI on the box. Install gh there, then refresh." };
    case "no-auth":
      return { icon: "KeyRound", title: `gh isn't logged in on ${box}`, body: "Run gh auth login on the box, then refresh." };
    case "not-github":
      return { icon: "GitBranch", title: "Not a GitHub repository", body: "This project's origin isn't on GitHub, so it has no issues to show here." };
    case "disabled":
      return { icon: "CircleSlash", title: `Issues are turned off for ${p.repo}`, body: "The repository doesn't use GitHub issues. Turn them on in its settings to see them here." };
    case "offline":
      return { icon: "CloudOff", title: "No box with this project is online", body: "Issues are read with gh on a box that has the repository. Reconnect one to see them." };
    default:
      return { icon: "TriangleAlert", title: "gh couldn't list the issues", body: p.message };
  }
}

// An agent that works, or worked, on an issue: a worktree made for it
// (issue-<n>-…), and the agent running there, if one is.
export interface Run {
  box: string;
  location: string;
  worktree: string;
  path: string;
  branch?: string;
  session?: Session;
}

const RANK: Record<string, number> = { waiting: 0, running: 1, finished: 2, idle: 3 };
const rank = (r: Run) => (r.session ? (RANK[r.session.agent_state ?? ""] ?? 4) : 5);

// runsByIssue finds every issue worktree in the projects, keyed
// "owner/name#n", the liveliest first.
export function runsByIssue(projects: Project[], sessions: Record<string, Session[] | undefined>): Map<string, Run[]> {
  const out = new Map<string, Run[]>();
  for (const p of projects) {
    if (!p.slug) continue;
    for (const m of p.members) {
      for (const wt of m.location.worktrees ?? []) {
        if (wt.main) continue;
        const n = gh.issueNumberOf(wt.branch) ?? gh.issueNumberOf(wt.name);
        if (!n) continue;
        const loc = `${m.location.name}/${wt.name}`;
        const session = (sessions[m.box] ?? [])
          .filter((s) => s.agent && !s.exited && (s.location === loc || s.dir === wt.path))
          .sort((a, b) => b.created.localeCompare(a.created))[0];
        const key = `${p.slug.toLowerCase()}#${n}`;
        out.set(key, [...(out.get(key) ?? []), { box: m.box, location: m.location.name, worktree: wt.name, path: wt.path, branch: wt.branch, session }]);
      }
    }
  }
  for (const runs of out.values()) runs.sort((a, b) => rank(a) - rank(b));
  return out;
}
