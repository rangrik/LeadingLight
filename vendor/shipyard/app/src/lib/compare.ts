// The Compare tab: two worktrees' work in mirrored lanes, side by side, for
// "which attempt wins". It is a tab like any other (it lives among its
// first worktree's tabs, in its group), whose two panes belong to one
// worktree each (leaf.wt, as in a tab that mixes worktrees), so the
// breadcrumb, Run, ⌘T and the palette follow whichever side has the focus.
//
// A lane is what both sides show: their agents' chats, their diffs, their
// dev servers' pages, their agents' terminals, or their artifacts' boards. Chat and Terminal are one
// pane per side (the agent's), seen as its conversation or its terminal.
// The panes of a lane not showing are parked, still mounted, so coming back
// to it reloads nothing. These are the pure parts; lib/compare-actions.ts
// applies them to the store. No imports but layout: pnpm test runs this.

import { type Leaf, leaf, leaves, newId, type PaneContent, type PaneNode, paneWorktree } from "./layout.ts";

export const LANES = ["chat", "diff", "preview", "terminal", "artifacts"] as const;
export type Lane = (typeof LANES)[number];
export const isLane = (l: unknown): l is Lane => typeof l === "string" && (LANES as readonly string[]).includes(l);
export const LANE_LABEL: Record<Lane, string> = { chat: "Chat", diff: "Diff", preview: "Preview", terminal: "Terminal", artifacts: "Artifacts" };

// The panes a lane needs: Chat and Terminal share each side's agent pane.
// Artifacts: each side's board (components/art).
export type Kind = "agent" | "diff" | "preview" | "artifacts";
export const kindOf = (l: Lane): Kind => (l === "chat" || l === "terminal" ? "agent" : l);

export interface Compare {
  // The worktrees (workspace keys), left and right.
  a: string;
  b: string;
  lane: Lane;
  // Keep the two sides together: the same page on both dev servers, the
  // same file in both diffs, the same turn in both chats.
  sync: boolean;
  // Each kind's two panes, left then right, once its lane has shown.
  panes?: Partial<Record<Kind, [string, string]>>;
  // The panes of the lanes not showing.
  parked?: Leaf[];
  // The path (with its query) both previews were last sent to.
  path?: string;
}

export interface CompareTab {
  id: string;
  root: PaneNode;
  focus: string;
  compare?: Compare;
}

// What a new pane of a lane shows for one side (a worktree's key).
export type Make = (kind: Kind, side: string) => PaneContent;

// withView shows an agent's pane as the lane asks: its conversation in
// Chat, its terminal in Terminal. Other panes are as they are.
export function withView(c: PaneContent, lane: Lane): PaneContent {
  if (c.kind !== "terminal" || kindOf(lane) !== "agent") return c;
  const view = lane === "chat" ? "conversation" : "terminal";
  return c.view === view ? c : { ...c, view };
}

const sideLeaf = (owner: string, side: string, content: PaneContent): Leaf => leaf(content, side !== owner ? side : undefined);

const pair = (a: Leaf, b: Leaf, id = newId(), ratio = 0.5): PaneNode => ({ kind: "split", id, dir: "row", ratio, a, b });

// sides is a Compare tab's two panes, left then right: its root is always
// one row split of two panes. Undefined for any other tab.
export function sides(t: Pick<CompareTab, "root" | "compare">): [Leaf, Leaf] | undefined {
  const r = t.root;
  if (!t.compare || r.kind !== "split" || r.a.kind !== "leaf" || r.b.kind !== "leaf") return undefined;
  return [r.a, r.b];
}

// newCompare is a Compare tab of a (left) and b (right), held by workspace
// owner, showing lane, with its focus on the left.
export function newCompare(owner: string, a: string, b: string, lane: Lane, make: Make, sync = true): CompareTab & { compare: Compare } {
  const k = kindOf(lane);
  const l = sideLeaf(owner, a, withView(make(k, a), lane));
  const r = sideLeaf(owner, b, withView(make(k, b), lane));
  return { id: newId(), root: pair(l, r), focus: l.id, compare: { a, b, lane, sync, panes: { [k]: [l.id, r.id] }, parked: [] } };
}

// focusedSide is 0 when the left pane has the focus, else 1.
export const focusedSide = (t: CompareTab): 0 | 1 => (sides(t)?.[1].id === t.focus ? 1 : 0);

// setLane shows another lane. The panes showing are parked, and the lane's
// own come back from the park, or are made the first time (and again if
// one went missing). The same side keeps the focus.
export function setLane<T extends CompareTab>(t: T, owner: string, lane: Lane, make: Make): T {
  const c = t.compare;
  const now = sides(t);
  if (!c || !now || c.lane === lane) return t;
  const from = kindOf(c.lane);
  const to = kindOf(lane);
  const side = focusedSide(t);
  const ratio = t.root.kind === "split" ? t.root.ratio : 0.5;
  if (from === to) {
    const [l, r] = now.map((x) => ({ ...x, content: withView(x.content, lane) }));
    return { ...t, root: pair(l, r, t.root.id, ratio), compare: { ...c, lane } };
  }
  let parked = [...(c.parked ?? []).filter((p) => p.id !== now[0].id && p.id !== now[1].id), ...now];
  const ids = c.panes?.[to];
  let l = ids && parked.find((p) => p.id === ids[0]);
  let r = ids && parked.find((p) => p.id === ids[1]);
  if (!l || !r) {
    // One of the pair is gone (or it never was): both anew, so the two
    // stay a pair.
    parked = parked.filter((p) => !ids?.includes(p.id));
    l = sideLeaf(owner, c.a, make(to, c.a));
    r = sideLeaf(owner, c.b, make(to, c.b));
  } else parked = parked.filter((p) => p !== l && p !== r);
  l = { ...l, content: withView(l.content, lane) };
  r = { ...r, content: withView(r.content, lane) };
  const panes = { ...c.panes, [to]: [l.id, r.id] as [string, string] };
  return { ...t, root: pair(l, r, t.root.id, ratio), focus: side ? r.id : l.id, compare: { ...c, lane, panes, parked } };
}

// swapSides trades left and right: the panes showing, every lane's pair,
// and a and b. Nothing is remade, so nothing reloads.
export function swapSides<T extends CompareTab>(t: T): T {
  const c = t.compare;
  const now = sides(t);
  if (!c || !now || t.root.kind !== "split") return t;
  const panes: Compare["panes"] = {};
  for (const [k, v] of Object.entries(c.panes ?? {}) as [Kind, [string, string]][]) panes[k] = [v[1], v[0]];
  return { ...t, root: pair(now[1], now[0], t.root.id, 1 - t.root.ratio), compare: { ...c, a: c.b, b: c.a, panes } };
}

// laneSide is the side (0 left, 1 right) a pane of a Compare tab is on,
// when it is one of the pair showing.
export function laneSide(t: CompareTab, pane: string): 0 | 1 | undefined {
  const s = sides(t);
  return s ? (s[0].id === pane ? 0 : s[1].id === pane ? 1 : undefined) : undefined;
}

// Preview sync. A page's place on its server is its path, query and hash;
// the same place on the other side's server is that, on its origin.

export function pathOf(url: string): string | undefined {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return undefined;
  }
}

export function withPath(url: string, path: string): string | undefined {
  try {
    return new URL(path, new URL(url).origin).toString();
  } catch {
    return undefined;
  }
}

// syncPreview sends the side whose page moved to a new place there to the
// same place on the other side's server. Undefined when nothing needs to
// change: sync is off, the lane isn't Preview, both are where they were, or
// a side has no page yet. skip says a side was just sent somewhere, so its
// next move is that arriving, not the person going on.
export function syncPreview<T extends CompareTab>(t: T, skip: (side: 0 | 1) => boolean = () => false): T | undefined {
  const c = t.compare;
  const s = sides(t);
  if (!c || !s || !c.sync || c.lane !== "preview") return undefined;
  const [l, r] = s;
  if (l.content.kind !== "browser" || r.content.kind !== "browser" || !l.content.url || !r.content.url) return undefined;
  const pl = pathOf(l.content.url);
  const pr = pathOf(r.content.url);
  if (pl === undefined || pr === undefined) return undefined;
  if (pl === pr) return pl === c.path ? undefined : { ...t, compare: { ...c, path: pl } };
  // The side that left the last shared place moved; the other follows.
  const leftMoved = pl !== c.path && !skip(0);
  const rightMoved = pr !== c.path && !skip(1);
  const from: 0 | 1 | undefined = leftMoved ? 0 : rightMoved ? 1 : undefined;
  if (from === undefined) return undefined;
  const path = from === 0 ? pl : pr;
  const other = from === 0 ? r : l;
  const url = other.content.kind === "browser" ? withPath(other.content.url, path) : undefined;
  if (!url) return undefined;
  const moved = { ...other, content: { kind: "browser" as const, url } };
  const root = pair(from === 0 ? l : moved, from === 0 ? moved : r, t.root.id, t.root.kind === "split" ? t.root.ratio : 0.5);
  return { ...t, root, compare: { ...c, path } };
}

// findCompare is the Compare tab of these two worktrees, either way round,
// in any workspace.
export function findCompare<T extends CompareTab>(spaces: Record<string, { tabs: T[] }>, a: string, b: string): { key: string; tab: T } | undefined {
  for (const [key, ws] of Object.entries(spaces))
    for (const tab of ws.tabs) {
      const c = tab.compare;
      if (c && ((c.a === a && c.b === b) || (c.a === b && c.b === a))) return { key, tab };
    }
  return undefined;
}

// Re-homing: a Compare tab lives among its first worktree's tabs. When that
// worktree is archived its workspace goes, and the tab moves to the other
// side's workspace, if it has one, where it shows the side that is left
// with a notice. Each pane keeps the worktree it belongs to.

function adoptLeaf(l: Leaf, from: string, to: string): Leaf {
  const owner = paneWorktree(from, l);
  const { wt: _wt, ...rest } = l;
  return owner === to ? rest : { ...rest, wt: owner };
}

export function rehomeCompares<T extends CompareTab, S extends { tabs: T[]; active?: string }>(spaces: Record<string, S>, gone: string): Record<string, S> {
  const ws = spaces[gone];
  if (!ws) return spaces;
  const out = { ...spaces };
  for (const t of ws.tabs) {
    const c = t.compare;
    const s = sides(t);
    if (!c || !s) continue;
    const to = c.a === gone ? c.b : c.a;
    const dst = out[to];
    if (!dst || to === gone) continue;
    const moved = {
      ...t,
      root: pair(adoptLeaf(s[0], gone, to), adoptLeaf(s[1], gone, to), t.root.id, t.root.kind === "split" ? t.root.ratio : 0.5),
      compare: { ...c, parked: (c.parked ?? []).map((p) => adoptLeaf(p, gone, to)) },
    } as T;
    out[to] = { ...dst, tabs: [...dst.tabs, moved] };
  }
  return out;
}

// What a side of a Compare tab can show: its worktree, or why not.
export type SideState = "ok" | "gone" | "away";

// shownSides is which sides show: both, or with one gone or away (and the
// other not), the other alone, filling the tab.
export function shownSides(states: [SideState, SideState]): [boolean, boolean] {
  const [x, y] = states;
  if (x !== "ok" && y === "ok") return [false, true];
  if (y !== "ok" && x === "ok") return [true, false];
  return [true, true];
}

// allPanes is every pane a Compare tab holds, showing or parked.
export const allPanes = (t: CompareTab): Leaf[] => [...leaves(t.root), ...(t.compare?.parked ?? [])];
