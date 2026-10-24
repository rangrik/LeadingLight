// Pages side by side. From Shipyard (MIT, Copyright (c) 2026 Sean Brydon), app/src/lib/layout.ts.
// Changes: a leaf shows a page; worktrees, swap, neighbours and moves between tabs dropped;
// a small store holds the tree instead of zustand.
import { createStore } from "./state";

// back: the view it was opened from in its place (the Feed, in a narrow window), which its crumb opens.
export type Leaf = { kind: "leaf"; id: string; page: string; back?: string };
export type PaneNode = Leaf | { kind: "split"; id: string; dir: "row" | "col"; ratio: number; a: PaneNode; b: PaneNode };
export type Rect = { x: number; y: number; w: number; h: number };
export type Side = "left" | "right" | "top" | "bottom";
export type Divider = { id: string; dir: "row" | "col"; area: Rect; at: number };

const newId = () => Math.random().toString(36).slice(2, 10);
export const leaf = (page: string): Leaf => ({ kind: "leaf", id: newId(), page });

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

const openLeaf = (page: string) => {
  const { root } = panes.get();
  return root ? leaves(root).find((l) => l.page === page) : undefined;
};

export const focusedPage = () => {
  const { root, focus } = panes.get();
  return root ? leaves(root).find((l) => l.id === focus)?.page : undefined;
};

export function showOnly(page: string | null) {
  const l = page ? leaf(page) : null;
  panes.set({ root: l, focus: l?.id ?? "" });
}

// Focuses a page where it is open, else shows it in the focused pane.
export function openPage(page: string) {
  const { root, focus } = panes.get();
  const open = openLeaf(page);
  if (open) panes.set({ root, focus: open.id });
  else if (root) panes.set({ root: mapLeaf(root, focus, (l) => ({ kind: "leaf", id: l.id, page })), focus });
  else showOnly(page);
}

// Puts a page beside a pane: moved there if it is open, else opened there.
export function placePage(page: string, target: string, side: Side) {
  const { root } = panes.get();
  if (!root) return;
  const open = openLeaf(page);
  const moving = open ?? leaf(page);
  panes.set({ root: open ? movePane(root, open.id, target, side) : place(root, target, side, moving), focus: moving.id });
}

export function closePane(id: string) {
  const { root, focus } = panes.get();
  const rest = root && remove(root, id);
  if (!root || !rest) return;
  const next = focus === id ? leaves(sibling(root, id) ?? rest)[0].id : focus;
  panes.set({ root: rest, focus: next });
}

// Shows another page in a given pane.
export function showIn(id: string, page: string, back?: string) {
  const { root, focus } = panes.get();
  if (root) panes.set({ root: mapLeaf(root, id, (l) => ({ kind: "leaf", id: l.id, page, ...(back && { back }) })), focus });
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
  const { root, focus } = panes.get();
  const open = openLeaf(page);
  if (open) panes.set({ root, focus: open.id });
  else if (root) placePage(page, focus, "right");
  else showOnly(page);
}
