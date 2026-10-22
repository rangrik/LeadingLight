import type { Commit } from "@/lib/worktrees";

// Lays out a commit graph the way `git log --graph` does: commits come
// newest first in topological order, and each one takes a lane. A lane
// waits for a sha: the commit that has it continues the lane, its first
// parent takes the lane over, and further parents (merges) get lanes of
// their own. Lanes keep their positions, so lines stay straight.

export const MAX_LANES = 6;

export interface Edge {
  // Lanes at the top and bottom of the row; from === to is straight.
  from: number;
  to: number;
  // Where it starts and ends: the row's top, its dot, or its bottom.
  start: "top" | "mid";
  end: "mid" | "bottom";
  color: number;
}

// Where a commit stands between the worktree's branch and its base: only
// on the branch (ahead), only on the base (behind: the branch lacks it), or
// on both.
export type Side = "ahead" | "behind" | "shared";

export interface GraphRow {
  commit: Commit;
  lane: number;
  color: number;
  merge: boolean;
  side: Side;
  edges: Edge[];
}

export interface Graph {
  rows: GraphRow[];
  lanes: number;
  // The newest commit both the worktree and its base have: where it
  // branched off, or last synced.
  mergeBase?: string;
  head?: string;
  // How many of the loaded commits are ahead and behind.
  ahead: number;
  behind: number;
}

const clamp = (n: number) => Math.min(n, MAX_LANES - 1);

export function layout(commits: Commit[]): Graph {
  const lanes: (string | null)[] = [];
  // Each lane's colour, picked when it opens, so a branch keeps its colour.
  const colors: number[] = [];
  let next = 2; // 0: the worktree's branch, 1: the base; then a palette
  const open = (sha: string, color?: number): number => {
    let i = lanes.indexOf(null);
    if (i < 0) i = lanes.push(null) - 1;
    lanes[i] = sha;
    colors[i] = color ?? next++;
    return i;
  };

  const head = headOf(commits);
  const fromHead = reachable(commits, head);
  const mergeBase = commits.find((c) => c.on_base !== false && fromHead.has(c.sha))?.sha;

  const rows: GraphRow[] = [];
  let width = 0;
  for (const c of commits) {
    const before = [...lanes];
    let lane = lanes.indexOf(c.sha);
    // A lane opened for HEAD is the branch's; one for a base commit, the base's.
    if (lane < 0) lane = open(c.sha, c.sha === head || fromHead.has(c.sha) ? (c.on_base === false ? 0 : 1) : 1);
    const edges: Edge[] = [];

    // Lanes already waiting above: carry on, or end here if they wait for c.
    before.forEach((sha, k) => {
      if (sha === null) return;
      if (sha === c.sha) edges.push({ from: clamp(k), to: clamp(lane), start: "top", end: "mid", color: colors[k] });
    });
    // The branch's line becomes the base's where it meets it: below the
    // merge base, HEAD's history is the base's own.
    if (colors[lane] === 0 && c.on_base !== false) colors[lane] = 1;
    const color = colors[lane];
    for (let k = 0; k < lanes.length; k++) if (k !== lane && lanes[k] === c.sha) lanes[k] = null;

    const parents = c.parents ?? [];
    if (parents.length === 0) lanes[lane] = null;
    else {
      // The first parent takes this lane over, unless a lane already waits for it.
      const waiting = lanes.findIndex((s, k) => k !== lane && s === parents[0]);
      if (waiting >= 0) {
        // Still this branch's line until it meets the other one.
        edges.push({ from: clamp(lane), to: clamp(waiting), start: "mid", end: "bottom", color });
        lanes[lane] = null;
      } else {
        lanes[lane] = parents[0];
        edges.push({ from: clamp(lane), to: clamp(lane), start: "mid", end: "bottom", color });
      }
      for (const p of parents.slice(1)) {
        let t = lanes.indexOf(p);
        if (t < 0) t = open(p);
        edges.push({ from: clamp(lane), to: clamp(t), start: "mid", end: "bottom", color: colors[t] });
      }
    }

    // Everything else passes straight through.
    lanes.forEach((sha, k) => {
      if (sha !== null && before[k] === sha && sha !== c.sha && k !== lane) edges.push({ from: clamp(k), to: clamp(k), start: "top", end: "bottom", color: colors[k] });
    });

    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    width = Math.max(width, lane + 1, lanes.length, ...before.map((s, k) => (s ? k + 1 : 0)));
    const side: Side = c.on_base === false ? "ahead" : head && !fromHead.has(c.sha) ? "behind" : "shared";
    rows.push({ commit: c, lane: clamp(lane), color, merge: parents.length > 1, side, edges });
  }
  const count = (s: Side) => rows.filter((r) => r.side === s).length;
  // A worktree with no commits of its own sits on the merge base: HEAD says it.
  return { rows, lanes: Math.min(Math.max(width, 1), MAX_LANES), mergeBase: mergeBase === head ? undefined : mergeBase, head, ahead: count("ahead"), behind: count("behind") };
}

// branchOnly keeps the commits HEAD has, dropping the base's newer ones, so
// a branch far behind its base starts with its own work.
export function branchOnly(commits: Commit[]): Commit[] {
  const head = headOf(commits);
  if (!head) return commits;
  const keep = reachable(commits, head);
  return commits.filter((c) => keep.has(c.sha));
}

// headOf finds the worktree's HEAD: "HEAD" or "HEAD -> branch" in the
// decoration (origin/HEAD is not it), else its newest commit of its own.
function headOf(commits: Commit[]): string | undefined {
  const isHead = (c: Commit) => (c.refs ?? "").split(",").some((r) => /^HEAD( -> |$)/.test(r.trim()));
  return commits.find(isHead)?.sha ?? commits.find((c) => c.on_base === false)?.sha;
}

// reachable walks first and other parents from sha, within what is loaded.
function reachable(commits: Commit[], sha?: string): Set<string> {
  const byId = new Map(commits.map((c) => [c.sha, c]));
  const seen = new Set<string>();
  const stack = sha ? [sha] : [];
  while (stack.length) {
    const s = stack.pop()!;
    if (seen.has(s)) continue;
    seen.add(s);
    for (const p of byId.get(s)?.parents ?? []) if (byId.has(p)) stack.push(p);
  }
  return seen;
}
