import type { Location, Worktree } from "@/lib/api";

// Worktree display names kept on this laptop alone, for a box whose berthd
// is older than worktree titles (it doesn't list "worktree.titles"). They
// are laid over its worktrees as they arrive (lib/store), so the rest of
// the app reads wt.title either way; once the box is updated they move to
// it (lib/worktree-names).
//
// No value imports from "@/": pnpm test runs this file in plain node.

const KEY = "berth.worktreeTitles";

// By box, then worktree path.
type Saved = Record<string, Record<string, string>>;

// Storage can be missing or throw (private windows, plain node); names are
// then kept for this run only.
function load(): Saved {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Saved;
  } catch {
    return {};
  }
}
function save(v: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // Kept in memory.
  }
}

let saved: Saved = load();

export function localTitle(box: string, path: string): string | undefined {
  return saved[box]?.[path] || undefined;
}

export function localTitles(box: string): Record<string, string> {
  return { ...saved[box] };
}

// setLocalTitle keeps a display name for a worktree on this laptop; ""
// forgets it.
export function setLocalTitle(box: string, path: string, title: string) {
  const forBox = { ...saved[box] };
  if (title) forBox[path] = title;
  else delete forBox[path];
  saved = { ...saved, [box]: forBox };
  if (!Object.keys(forBox).length) delete saved[box];
  save(saved);
}

// withLocalTitles lays this laptop's names over a box's worktrees that the
// box itself has not named. A worktree the box names keeps the box's.
export function withLocalTitles(box: string, locations: Location[] | null | undefined): Location[] {
  const mine = saved[box];
  if (!locations || !mine) return locations ?? [];
  const named = (wt: Worktree): Worktree => (wt.title || !mine[wt.path] ? wt : { ...wt, title: mine[wt.path] });
  return locations.map((loc) => (loc.worktrees?.some((w) => mine[w.path]) ? { ...loc, worktrees: loc.worktrees.map(named) } : loc));
}
