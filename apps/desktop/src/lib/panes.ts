// Pages side by side. From Shipyard (MIT, Copyright (c) 2026 Sean Brydon), app/src/lib/layout.ts.
// Changes: a leaf holds tabs of pages, each with its history (lib/tabs.ts); worktrees, swap and
// neighbours dropped; a small store holds the tree instead of zustand.
import { createStore } from "./state";
import { go, type Leaf, newId, type PaneNode, pageIn, prune, readLayout, step, type Tab, tab } from "./tabs.ts";

export { pageIn, type Leaf, type PaneNode, type Tab } from "./tabs.ts";
export type Rect = { x: number; y: number; w: number; h: number };
export type Side = "left" | "right" | "top" | "bottom";
export type Divider = { id: string; dir: "row" | "col"; area: Rect; at: number };

// A pane with these tabs, active in front. The Feed crumb stays only while its page does.
const withTabs = (l: Leaf, tabs: Tab[], active = l.active): Leaf => {
  const page = pageIn(tabs.find((t) => t.id === active)!);
  return { kind: "leaf", id: l.id, page, tabs, active, ...(l.back && page === l.page && { back: l.back }) };
};
const holding = (t: Tab, id = newId()): Leaf => ({ kind: "leaf", id, page: pageIn(t), tabs: [t], active: t.id });
export const leaf = (page: string): Leaf => holding(tab(page));
const insert = <T>(list: T[], at: number, item: T) => [...list.slice(0, at), item, ...list.slice(at)];
export const frontTab = (l: Leaf) => l.tabs.find((t) => t.id === l.active)!;

export function leaves(node: PaneNode): Leaf[] {
  return node.kind === "leaf" ? [node] : [...leaves(node.a), ...leaves(node.b)];
}

function mapLeaf(node: PaneNode, id: string, fn: (l: Leaf) => PaneNode): PaneNode {
  if (node.kind === "leaf") return node.id === id ? fn(node) : node;
  return { ...node, a: mapLeaf(node.a, id, fn), b: mapLeaf(node.b, id, fn) };
}

// Drops a leaf; its sibling takes the parent's place. Undefined when it was the only one.
function remove(node: PaneNode, id: string): PaneNode | undefined {
  if (node.kind === "leaf") return node.id === id ? undefined : node;
  const a = remove(node.a, id);
  const b = remove(node.b, id);
  if (!a) return b;
  if (!b) return a;
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

function sibling(node: PaneNode, id: string): PaneNode | undefined {
  if (node.kind === "leaf") return undefined;
  if (node.a.id === id) return node.b;
  if (node.b.id === id) return node.a;
  return sibling(node.a, id) ?? sibling(node.b, id);
}

function setRatio(node: PaneNode, id: string, ratio: number): PaneNode {
  if (node.kind === "leaf") return node;
  if (node.id === id) return { ...node, ratio: Math.min(0.9, Math.max(0.1, ratio)) };
  return { ...node, a: setRatio(node.a, id, ratio), b: setRatio(node.b, id, ratio) };
}

// A pane without one of its tabs, the next one coming to the front as in a browser. Undefined for its last.
function without(l: Leaf, t: Tab): Leaf | undefined {
  const at = l.tabs.indexOf(t);
  const tabs = l.tabs.filter((x) => x !== t);
  return tabs.length ? withTabs(l, tabs, t.id === l.active ? tabs[Math.min(at, tabs.length - 1)].id : l.active) : undefined;
}
// The tree with a tab taken out; a pane left with none closes.
const takeOut = (root: PaneNode, l: Leaf, t: Tab) => {
  const rest = without(l, t);
  return rest ? mapLeaf(root, l.id, () => rest) : remove(root, l.id);
};

// Places every leaf and divider inside rect, in fractions of the pane area.
export function layout(
  node: PaneNode,
  rect: Rect = { x: 0, y: 0, w: 1, h: 1 },
  out = { leaves: [] as { leaf: Leaf; rect: Rect }[], dividers: [] as Divider[] },
) {
  if (node.kind === "leaf") {
    out.leaves.push({ leaf: node, rect });
    return out;
  }
  if (node.dir === "row") {
    const w = rect.w * node.ratio;
    layout(node.a, { ...rect, w }, out);
    layout(node.b, { ...rect, x: rect.x + w, w: rect.w - w }, out);
    out.dividers.push({ id: node.id, dir: "row", area: rect, at: rect.x + w });
  } else {
    const h = rect.h * node.ratio;
    layout(node.a, { ...rect, h }, out);
    layout(node.b, { ...rect, y: rect.y + h, h: rect.h - h }, out);
    out.dividers.push({ id: node.id, dir: "col", area: rect, at: rect.y + h });
  }
  return out;
}

// Halves the leaf with id and puts sub on one side of it. Leaves keep their ids, so nothing remounts.
export function place(node: PaneNode, id: string, side: Side, sub: PaneNode): PaneNode {
  const dir = side === "left" || side === "right" ? "row" : "col";
  const first = side === "left" || side === "top";
  return mapLeaf(node, id, (l) => ({ kind: "split", id: newId(), dir, ratio: 0.5, a: first ? sub : l, b: first ? l : sub }));
}

// Takes a leaf out of where it is (its sibling closes the gap) and places it beside target.
export function movePane(node: PaneNode, id: string, target: string, side: Side): PaneNode {
  const moving = leaves(node).find((l) => l.id === id);
  if (!moving || id === target) return node;
  const rest = remove(node, id);
  return rest ? place(rest, target, side, moving) : node;
}

// The rectangle the leaves with ids fill together: where a drop will land.
export function bounds(node: PaneNode, ids: string[]): Rect | undefined {
  const rects = layout(node).leaves.filter((l) => ids.includes(l.leaf.id)).map((l) => l.rect);
  if (!rects.length) return undefined;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
}

// The edge of a pane nearest a point (u, v from 0 to 1 across and down it).
export function sideAt(u: number, v: number): Side {
  const d = { left: u, right: 1 - u, top: v, bottom: 1 - v };
  return (Object.keys(d) as Side[]).reduce((a, b) => (d[b] < d[a] ? b : a));
}

// The open pages and the one that has the keyboard.
export const panes = createStore<{ root: PaneNode | null; focus: string }>({ root: null, focus: "" });

// The tab holding a page, in front or not, or the tab with id: a page is open in one place at most.
export function holder(page: string, id?: string, root = panes.get().root) {
  for (const l of root ? leaves(root) : []) {
    const t = l.tabs.find((x) => (id ? x.id === id : !!page && pageIn(x) === page));
    if (t) return { leaf: l, tab: t };
  }
}

const paneOf = (id: string) => {
  const { root } = panes.get();
  return root ? (leaves(root).find((l) => l.id === id) ?? leaves(root)[0]) : undefined;
};
export const focusedPage = () => paneOf(panes.get().focus)?.page;

const setLeaf = (id: string, fn: (l: Leaf) => Leaf, focus = panes.get().focus) => {
  const { root } = panes.get();
  if (root) panes.set({ root: mapLeaf(root, id, fn), focus });
};

// Brings a tab to the front of its pane, and the pane to the keyboard.
export const showTab = (pane: string, id: string) => setLeaf(pane, (l) => withTabs(l, l.tabs, id), pane);

export function showOnly(page: string | null) {
  const l = page ? leaf(page) : null;
  panes.set({ root: l, focus: l?.id ?? "" });
}

// Focuses a page where it is open, else shows it in the focused pane's front tab.
export function openPage(page: string) {
  const open = holder(page);
  const here = paneOf(panes.get().focus);
  if (open) showTab(open.leaf.id, open.tab.id);
  else if (here) showIn(here.id, page);
  else showOnly(page);
}

// ⌘-click: a new tab beside the front one, or the page where it is open.
export function openTab(page: string) {
  const open = holder(page);
  const here = paneOf(panes.get().focus);
  if (open) return showTab(open.leaf.id, open.tab.id);
  if (!here) return showOnly(page);
  const t = tab(page);
  setLeaf(here.id, (l) => withTabs(l, insert(l.tabs, l.tabs.indexOf(frontTab(l)) + 1, t), t.id), here.id);
}

// Where a click opens a page: Shift beside, ⌘ in a new tab, else in the tab in front.
export const openFrom = (page: string, e: { shiftKey: boolean; metaKey: boolean }) =>
  e.shiftKey ? openBeside(page) : e.metaKey ? openTab(page) : openPage(page);

// ⌘T and "+": a new empty tab at the end of the pane.
export function newTab(pane = panes.get().focus) {
  const t = tab("");
  setLeaf(pane, (l) => withTabs(l, [...l.tabs, t], t.id), pane);
}

// Closed tabs, newest last, each with its history and where it was, for ⇧⌘T.
const closed: { tab: Tab; pane: string; at: number }[] = [];

// ⌘W: the front tab, or the tab with id; its pane goes with its last tab, and the last pane leaves "No page open".
export function closeTab(pane = panes.get().focus, id?: string) {
  const { root } = panes.get();
  const l = root && leaves(root).find((x) => x.id === pane);
  const t = l && (id ? l.tabs.find((x) => x.id === id) : frontTab(l));
  if (!root || !l || !t) return;
  closed.push({ tab: t, pane, at: l.tabs.indexOf(t) });
  const rest = without(l, t);
  if (rest) setLeaf(pane, () => rest);
  else if (root.kind === "split") closePane(pane);
  else showOnly(null);
}

// ⇧⌘T: the last closed tab, back where it was and in front; in the focused pane if its own has closed.
export function reopenTab() {
  const last = closed.pop();
  if (!last) return;
  const open = holder(pageIn(last.tab));
  if (open) return showTab(open.leaf.id, open.tab.id);
  const { root, focus } = panes.get();
  const l = root && (leaves(root).find((x) => x.id === last.pane) ?? paneOf(focus));
  if (!l) return panes.set({ root: holding(last.tab, last.pane), focus: last.pane });
  setLeaf(l.id, (x) => withTabs(x, insert(x.tabs, last.at, last.tab), last.tab.id), l.id);
}

// ⌃Tab and ⌃⇧Tab: the next or previous tab of the focused pane, round the ends.
export function cycleTab(by: number) {
  const l = paneOf(panes.get().focus);
  if (!l || l.tabs.length < 2) return;
  const at = l.tabs.indexOf(frontTab(l)) + by;
  showTab(l.id, l.tabs[(at + l.tabs.length) % l.tabs.length].id);
}

// ⌘[ and ⌘]: back or forward in a pane's front tab. A page open in another tab is shown there instead.
export function travel(by: number, pane = panes.get().focus) {
  const l = paneOf(pane);
  if (!l) return;
  const t = frontTab(l);
  const next = step(t, by);
  const open = next !== t && holder(pageIn(next));
  if (open) showTab(open.leaf.id, open.tab.id);
  else if (next !== t) setLeaf(l.id, (x) => withTabs(x, x.tabs.map((y) => (y === t ? next : y))), l.id);
}

// A tab dropped in a pane's tab row before index: reordered in its own pane, else moved there and in front.
export function moveTab(id: string, pane: string, index: number) {
  const { root } = panes.get();
  const from = holder("", id);
  if (!root || !from) return;
  const { leaf: l, tab: t } = from;
  if (l.id === pane) return setLeaf(pane, () => withTabs(l, insert(l.tabs.filter((x) => x !== t), index > l.tabs.indexOf(t) ? index - 1 : index, t)));
  const rest = takeOut(root, l, t);
  if (rest) panes.set({ root: mapLeaf(rest, pane, (x) => withTabs(x, insert(x.tabs, index, t), t.id)), focus: pane });
}

// The tree after a page, or the tab with id, lands beside target, and the pane it lands in. A pane
// holding only that tab moves whole and keeps its id; a tab keeps its own, so nothing remounts.
export function dropped(root: PaneNode, page: string, target: string, side: Side, id?: string) {
  const from = holder(page, id, root);
  if (from && from.leaf.tabs.length === 1) return { root: movePane(root, from.leaf.id, target, side), pane: from.leaf.id };
  const l = from ? holding(from.tab) : leaf(page);
  return { root: place(from ? takeOut(root, from.leaf, from.tab)! : root, target, side, l), pane: l.id };
}

// Puts a page (or one tab) beside a pane: moved there if it is open, else opened there.
export function placePage(page: string, target: string, side: Side, id?: string) {
  const { root } = panes.get();
  if (!root) return;
  const d = dropped(root, page, target, side, id);
  panes.set({ root: d.root, focus: d.pane });
}

export function closePane(id: string) {
  const { root, focus } = panes.get();
  const rest = root && remove(root, id);
  if (!root || !rest) return;
  const next = focus === id ? leaves(sibling(root, id) ?? rest)[0].id : focus;
  panes.set({ root: rest, focus: next });
}

// Shows another page in a given pane's front tab.
export function showIn(id: string, page: string, back?: string) {
  setLeaf(id, (l) => ({ ...withTabs(l, l.tabs.map((t) => (t.id === l.active ? go(t, page) : t))), ...(back && { back }) }));
}

// A deleted page leaves every tab's history; a tab it leaves empty closes, and a pane left with none.
export function dropPage(page: string, next: string | null) {
  const { root, focus } = panes.get();
  let rest: PaneNode | undefined = root ?? undefined;
  for (const l of root ? leaves(root) : []) {
    if (!rest || !l.tabs.some((t) => t.pages.includes(page))) continue;
    const tabs = l.tabs.map((t) => prune(t, (p) => p !== page)).filter((t, i) => pageIn(t) || !pageIn(l.tabs[i]));
    const front = tabs.find((t) => t.id === l.active) ?? tabs[Math.min(l.tabs.indexOf(frontTab(l)), tabs.length - 1)];
    rest = front ? mapLeaf(rest, l.id, () => withTabs(l, tabs, front.id)) : remove(rest, l.id);
  }
  if (rest === (root ?? undefined)) return;
  if (!rest) return showOnly(next);
  const ids = leaves(rest).map((l) => l.id);
  panes.set({ root: rest, focus: ids.includes(focus) ? focus : ids[0] });
}

export function focusPane(id: string) {
  if (panes.get().focus !== id) panes.set({ ...panes.get(), focus: id });
}

export function resizePanes(split: string, ratio: number) {
  const { root, focus } = panes.get();
  if (root) panes.set({ root: setRatio(root, split, ratio), focus });
}

// Shift-click: show a page next to the focused one, or focus it where it is already open.
export function openBeside(page: string) {
  const open = holder(page);
  const here = paneOf(panes.get().focus);
  if (open) showTab(open.leaf.id, open.tab.id);
  else if (here) placePage(page, here.id, "right");
  else showOnly(page);
}

// Opens the panes kept from last time (localStorage, as other layout state is), then keeps every
// change. False when nothing was kept, so the caller opens a page as before.
export function restorePanes(exists: (page: string) => boolean) {
  const KEY = "ll.panes";
  let kept: ReturnType<typeof readLayout> = null;
  try {
    kept = readLayout(JSON.parse(localStorage.getItem(KEY) ?? "null"), exists);
  } catch {
    // Damaged: opened as before.
  }
  if (kept) panes.set(kept);
  panes.subscribe(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(panes.get()));
    } catch {
      // Remembering is a convenience; losing it is fine.
    }
  });
  return !!kept;
}
