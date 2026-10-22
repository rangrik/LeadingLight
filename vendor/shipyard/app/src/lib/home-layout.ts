// Home's widget grid, as data: which widgets are on Home, in what order and
// at what size. Pure functions, so the grid, the keyboard and the tests all
// share one model (views/home/widgets draws it).
//
// The grid has four columns in a wide window, two in a narrower one and one
// in a narrow one; rows are a fixed height. Order is reading order and the
// grid packs densely (CSS grid-auto-flow: row dense, which pack() mirrors),
// so moving or removing a widget never leaves a hole for long.

export type WidgetSize = "s" | "m" | "t" | "l" | "w";

// Each size in grid cells: columns by rows.
export const SIZES: Record<WidgetSize, { c: number; r: number; label: string }> = {
  s: { c: 1, r: 1, label: "Small" },
  m: { c: 2, r: 1, label: "Medium" },
  t: { c: 1, r: 2, label: "Tall" },
  l: { c: 2, r: 2, label: "Large" },
  w: { c: 4, r: 1, label: "Wide" },
};

// The order sizes are offered in: smallest first.
export const SIZE_ORDER: WidgetSize[] = ["s", "m", "t", "l", "w"];

export const isSize = (v: unknown): v is WidgetSize => typeof v === "string" && v in SIZES;

export interface Placed {
  // A built-in's id ("needs-you"), or a plugin's as "<plugin>/<id>".
  id: string;
  size: WidgetSize;
}

// What prefs keep (Prefs.home). version counts changes of shape; an older
// one is moved up by readLayout.
export interface HomeLayout {
  version: number;
  items: Placed[];
}

export const LAYOUT_VERSION = 1;

// What a new person's Home starts with: their agents first, then their
// code, then their boxes. Widgets from a plugin that is off are kept but not
// drawn, so this can name them.
export const DEFAULT_ITEMS: readonly Placed[] = [
  { id: "needs-you", size: "m" },
  { id: "working", size: "m" },
  { id: "finished", size: "m" },
  { id: "pull-request/prs", size: "l" },
  { id: "git", size: "m" },
  { id: "boxes", size: "s" },
  { id: "services", size: "s" },
  { id: "areas", size: "m" },
  { id: "pull-request/ci", size: "m" },
  { id: "notes/note", size: "m" },
];

export const defaultLayout = (): HomeLayout => ({ version: LAYOUT_VERSION, items: DEFAULT_ITEMS.map((p) => ({ ...p })) });

// readLayout makes sense of what prefs hold: nothing (a new person) is the
// default; a bare list (before versions) is taken as version 1; entries that
// aren't widgets, or repeat one, are dropped.
export function readLayout(saved: unknown): HomeLayout {
  if (saved == null) return defaultLayout();
  const raw = Array.isArray(saved) ? saved : typeof saved === "object" && Array.isArray((saved as HomeLayout).items) ? (saved as HomeLayout).items : undefined;
  if (!raw) return defaultLayout();
  const seen = new Set<string>();
  const items: Placed[] = [];
  for (const p of raw as unknown[]) {
    if (!p || typeof p !== "object") continue;
    const { id, size } = p as Partial<Placed>;
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    seen.add(id);
    items.push({ id, size: isSize(size) ? size : "m" });
  }
  return { version: LAYOUT_VERSION, items };
}

// fitSize is size if the widget takes it, else the nearest size it does
// (a plugin may drop a size between versions), else its first.
export function fitSize(allowed: readonly WidgetSize[], size: WidgetSize): WidgetSize {
  if (!allowed.length || allowed.includes(size)) return size;
  return snapSize(allowed, SIZES[size].c, SIZES[size].r, allowed[0]);
}

// snapSize is the allowed size nearest c columns by r rows, as a corner
// dragged across the grid asks for. Ties keep current.
export function snapSize(allowed: readonly WidgetSize[], c: number, r: number, current: WidgetSize): WidgetSize {
  const dist = (s: WidgetSize) => Math.abs(SIZES[s].c - c) + Math.abs(SIZES[s].r - r);
  let best = allowed.includes(current) ? current : allowed[0];
  for (const s of allowed) if (dist(s) < dist(best)) best = s;
  return best;
}

// stepSize is the next allowed size up (dir 1) or down (-1) by area, then
// width, for the keyboard. At either end it stays.
export function stepSize(allowed: readonly WidgetSize[], current: WidgetSize, dir: 1 | -1): WidgetSize {
  const area = (s: WidgetSize) => SIZES[s].c * SIZES[s].r * 10 + SIZES[s].c;
  const sorted = [...allowed].sort((a, b) => area(a) - area(b));
  const i = sorted.indexOf(current);
  if (i < 0) return sorted[0] ?? current;
  return sorted[Math.max(0, Math.min(sorted.length - 1, i + dir))];
}

export const add = (items: readonly Placed[], id: string, size: WidgetSize): Placed[] => (items.some((p) => p.id === id) ? [...items] : [...items, { id, size }]);

export const remove = (items: readonly Placed[], id: string): Placed[] => items.filter((p) => p.id !== id);

export const resize = (items: readonly Placed[], id: string, size: WidgetSize): Placed[] => items.map((p) => (p.id === id ? { ...p, size } : p));

// moveTo puts id at index (clamped), the others keeping their order.
export function moveTo(items: readonly Placed[], id: string, index: number): Placed[] {
  const from = items.findIndex((p) => p.id === id);
  if (from < 0) return [...items];
  const next = [...items];
  const [it] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, index)), 0, it);
  return next;
}

// move puts from where to is, as dropping one widget on another does: the
// rest shift toward the gap it left.
export function move(items: readonly Placed[], from: string, to: string): Placed[] {
  const b = items.findIndex((p) => p.id === to);
  if (b < 0 || from === to) return [...items];
  return moveTo(items, from, b);
}

// columnsFor is how many columns a grid this wide (in CSS pixels) has.
// The views' container queries use the same breakpoints.
export const WIDE = 800;
export const NARROW = 480;
export const columnsFor = (width: number): 1 | 2 | 4 => (width >= WIDE ? 4 : width >= NARROW ? 2 : 1);

// spanOf is a size's cells in a grid of cols columns: never wider than the
// grid. One column keeps a widget's height.
export function spanOf(size: WidgetSize, cols: number): { c: number; r: number } {
  const s = SIZES[size];
  return { c: Math.min(s.c, cols), r: s.r };
}

export interface Cell {
  id: string;
  col: number;
  row: number;
  c: number;
  r: number;
}

// pack places items the way the grid draws them (row dense): each at the
// first spot, top to bottom then left to right, where it fits.
export function pack(items: readonly Placed[], cols: number): Cell[] {
  const taken: boolean[][] = [];
  const free = (row: number, col: number, c: number, r: number) => {
    if (col + c > cols) return false;
    for (let y = row; y < row + r; y++) for (let x = col; x < col + c; x++) if (taken[y]?.[x]) return false;
    return true;
  };
  const out: Cell[] = [];
  for (const p of items) {
    const { c, r } = spanOf(p.size, cols);
    let placed = false;
    for (let row = 0; !placed; row++) {
      for (let col = 0; col + c <= cols; col++) {
        if (!free(row, col, c, r)) continue;
        for (let y = row; y < row + r; y++) {
          taken[y] ??= [];
          for (let x = col; x < col + c; x++) taken[y][x] = true;
        }
        out.push({ id: p.id, col, row, c, r });
        placed = true;
        break;
      }
    }
  }
  return out;
}

// rowsOf is how many grid rows the packed items take.
export const rowsOf = (cells: readonly Cell[]) => cells.reduce((n, x) => Math.max(n, x.row + x.r), 0);

// neighbour is the widget the keyboard moves id toward: left and right are
// the one before and after it in order; up and down the one drawn above or
// below it (overlapping its columns, nearest first), as packed in cols.
export function neighbour(items: readonly Placed[], id: string, dir: "left" | "right" | "up" | "down", cols: number): string | undefined {
  const i = items.findIndex((p) => p.id === id);
  if (i < 0) return undefined;
  if (dir === "left") return items[i - 1]?.id;
  if (dir === "right") return items[i + 1]?.id;
  const cells = pack(items, cols);
  const me = cells.find((x) => x.id === id)!;
  const overlaps = (x: Cell) => x.col < me.col + me.c && me.col < x.col + x.c;
  const cands = cells.filter((x) => x.id !== id && overlaps(x) && (dir === "up" ? x.row + x.r <= me.row : x.row >= me.row + me.r));
  cands.sort((a, b) => (dir === "up" ? b.row - a.row : a.row - b.row) || Math.abs(a.col - me.col) - Math.abs(b.col - me.col));
  return cands[0]?.id;
}

// moveToward moves id one step in a direction: into the place of the
// widget there, as the keyboard does in Customize.
export function moveToward(items: readonly Placed[], id: string, dir: "left" | "right" | "up" | "down", cols: number): Placed[] {
  const to = neighbour(items, id, dir, cols);
  return to ? move(items, id, to) : [...items];
}
