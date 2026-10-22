import { createContext } from "react";
import { create } from "zustand";

import { portUrl } from "@/lib/browser-url";
import { findCompare, kindOf, type Kind, type Lane, newCompare, setLane, sides, swapSides, syncPreview, withPath, withView } from "@/lib/compare";
import type { PaneContent } from "@/lib/layout";
import { useStore } from "@/lib/store";
import { activateTab, leadAgent, refFor, showWorktree, splitKey, useWorkspaces, type Workspace, type WsTab } from "@/lib/workspaces";
import { useRegistry } from "@/plugins/registry";

// The Compare tab (lib/compare.ts) in the store: opening one, its lanes,
// swapping its sides, sync, and closing it, which only takes the tab away:
// its panes are views of the two worktrees, so no agent stops with it.

// previewUrl is a worktree's dev server: its lowest port's page, at path.
export function previewUrl(key: string, path?: string): string {
  const ref = refFor(key);
  if (!ref) return "";
  const st = useStore.getState();
  const services = st.boxes[ref.box]?.services ?? [];
  const port = services
    .filter((s) => s.path === ref.path)
    .map((s) => s.port)
    .sort((a, b) => a - b)[0];
  const url = port ? portUrl(port, { ref, services, urlPort: st.status?.proxy.url_port }) : undefined;
  return (url && path ? withPath(url, path) : url) ?? "";
}

const hasDiff = () => useRegistry.getState().worktreePanels.some((p) => p.plugin === "diff" && p.item.id === "diff");

// makeFor is what a new pane of a lane shows for a side: its agent (the
// one that needs you first), its Diff panel, its dev server's page.
function makeFor(path?: string) {
  return (kind: Kind, side: string): PaneContent => {
    if (kind === "agent") {
      const s = leadAgent(side);
      return s ? { kind: "terminal", box: splitKey(side).box, session: s } : { kind: "empty", label: "Agent" };
    }
    if (kind === "artifacts") return { kind: "artifact", title: "Artifacts" };
    if (kind === "diff") return hasDiff() ? { kind: "panel", plugin: "diff", panel: "diff", title: "Diff" } : { kind: "empty", label: "Diff" };
    return { kind: "browser", url: previewUrl(side, path) };
  };
}

// defaultLane is where a new Compare tab opens: the chats when both sides
// run an agent, else the diffs.
export function defaultLane(a: string, b: string): Lane {
  return leadAgent(a) && leadAgent(b) ? "chat" : hasDiff() ? "diff" : "preview";
}

function setTab(key: string, id: string, fn: (t: WsTab) => WsTab) {
  useWorkspaces.setState((s) => {
    const ws = s.spaces[key];
    if (!ws || !ws.tabs.some((t) => t.id === id)) return s;
    return { spaces: { ...s.spaces, [key]: { ...ws, tabs: ws.tabs.map((t) => (t.id === id ? fn(t) : t)) } } };
  });
}

// openCompare shows a and b side by side in a Compare tab: the one already
// open for the two (either way round), or a new one among a's tabs, its
// group brought to the front. False when a is not known.
export function openCompare(a: string, b: string, lane?: Lane): boolean {
  if (a === b) return false;
  const found = findCompare(useWorkspaces.getState().spaces, a, b);
  if (found) {
    if (!showWorktree(found.key)) return false;
    activateTab(found.key, found.tab.id);
    if (lane) setCompareLane(found.key, found.tab.id, lane);
    return true;
  }
  if (!showWorktree(a)) return false;
  const tab = newCompare(a, a, b, lane ?? defaultLane(a, b), makeFor());
  useWorkspaces.setState((s) => {
    const ws = s.spaces[a];
    return ws ? { spaces: { ...s.spaces, [a]: { ...ws, tabs: [...ws.tabs, tab], active: tab.id } } } : s;
  });
  useStore.getState().setView({ kind: "workspace" });
  return true;
}

export function setCompareLane(key: string, id: string, lane: Lane) {
  setTab(key, id, (t) => setLane(t, key, lane, makeFor(t.compare?.path)));
}

export function swapCompare(key: string, id: string) {
  setTab(key, id, swapSides);
}

export function setCompareSync(key: string, id: string, sync: boolean) {
  setTab(key, id, (t) => (t.compare ? { ...t, compare: { ...t.compare, sync } } : t));
}

// closeCompare takes a Compare tab away. Nothing it showed stops.
export function closeCompare(key: string, id: string) {
  useWorkspaces.setState((s) => {
    const ws = s.spaces[key];
    if (!ws) return s;
    const i = ws.tabs.findIndex((t) => t.id === id);
    if (i < 0) return s;
    const tabs = ws.tabs.filter((t) => t.id !== id);
    return { spaces: { ...s.spaces, [key]: { ...ws, tabs, active: ws.active === id ? tabs[Math.min(i, tabs.length - 1)]?.id : ws.active } } };
  });
}

// compareShowing is the Compare tab showing, with its workspace.
export function compareShowing(): { key: string; tab: WsTab } | undefined {
  const s = useWorkspaces.getState();
  const ws = s.current ? s.spaces[s.current] : undefined;
  const tab = ws?.tabs.find((t) => t.id === ws.active);
  return s.current && tab?.compare && useStore.getState().view.kind === "workspace" ? { key: s.current, tab } : undefined;
}

// Keeping Compare tabs right as things change: an agent pane started from
// an empty side shows as its lane asks, an empty side takes up an agent
// that starts in its worktree, and with sync, a page that moved on one side
// sends the other to the same place.

// When a side was last sent somewhere: its next move is that arriving.
const sentAt = new Map<string, number>();
const SETTLE_MS = 1500;

function tidy(t: WsTab): WsTab {
  const c = t.compare;
  const s = sides(t);
  if (!c || !s) return t;
  let next = t;
  const fixed = s.map((l, i) => {
    let content = withView(l.content, c.lane);
    if (content.kind === "empty" && content.label === "Agent" && kindOf(c.lane) === "agent") {
      const side = i === 0 ? c.a : c.b;
      const session = leadAgent(side);
      if (session) content = withView({ kind: "terminal", box: splitKey(side).box, session }, c.lane);
    }
    return content === l.content ? l : { ...l, content };
  });
  if (fixed[0] !== s[0] || fixed[1] !== s[1]) next = { ...t, root: { ...(t.root as Extract<WsTab["root"], { kind: "split" }>), a: fixed[0], b: fixed[1] } };
  const synced = syncPreview(next, (side) => Date.now() - (sentAt.get(`${t.id}:${side}`) ?? 0) < SETTLE_MS);
  if (synced) {
    const before = sides(next);
    const after = sides(synced);
    for (const i of [0, 1] as const) if (before && after && before[i].content !== after[i].content) sentAt.set(`${t.id}:${i}`, Date.now());
    next = synced;
  }
  return next;
}

function tidyAll() {
  const s = useWorkspaces.getState();
  let changed = false;
  const spaces: Record<string, Workspace> = { ...s.spaces };
  for (const key of s.mounted) {
    const ws = s.spaces[key];
    if (!ws?.tabs.some((t) => t.compare)) continue;
    const tabs = ws.tabs.map((t) => (t.compare ? tidy(t) : t));
    if (tabs.some((t, i) => t !== ws.tabs[i])) {
      spaces[key] = { ...ws, tabs };
      changed = true;
    }
  }
  if (changed) useWorkspaces.setState({ spaces });
}

useWorkspaces.subscribe((s, prev) => {
  if (s.spaces !== prev.spaces) tidyAll();
});
useStore.subscribe((s, prev) => {
  if (s.boxes !== prev.boxes) tidyAll();
});

// Load times of the pages in Compare tabs' previews, by pane: when the one
// loading began, and how long the last took.
export const useLoadTimes = create<Record<string, { since?: number; ms?: number }>>()(() => ({}));

export function pageLoading(pane: string, loading: boolean) {
  useLoadTimes.setState((s) => {
    const was = s[pane];
    if (loading) return was?.since ? s : { [pane]: { ...was, since: performance.now() } };
    if (!was?.since) return s;
    return { [pane]: { ms: Math.round(performance.now() - was.since) } };
  });
}

// Sync between a Compare tab's two diffs and two chats: the place one side
// was scrolled to, for the other to follow. n counts, so the same place can
// be sent twice.
export interface Place {
  from: string;
  at: string | number;
  n: number;
}

export const useCompareSync = create<{ file: Record<string, Place>; turn: Record<string, Place> }>()(() => ({ file: {}, turn: {} }));

export function sendPlace(what: "file" | "turn", tab: string, from: string, at: string | number) {
  useCompareSync.setState((s) => ({ [what]: { ...s[what], [tab]: { from, at, n: (s[what][tab]?.n ?? 0) + 1 } } }));
}

// CompareSide is a pane's place in a Compare tab, for what inside it syncs.
export interface CompareSide {
  tab: string;
  pane: string;
  side: 0 | 1;
  sync: boolean;
}

export const CompareSideContext = createContext<CompareSide | undefined>(undefined);
