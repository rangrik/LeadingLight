// node --experimental-strip-types --test src/lib/home-layout.test.ts (pnpm test)
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  add,
  columnsFor,
  DEFAULT_ITEMS,
  defaultLayout,
  fitSize,
  LAYOUT_VERSION,
  move,
  moveTo,
  moveToward,
  neighbour,
  pack,
  type Placed,
  readLayout,
  remove,
  resize,
  rowsOf,
  snapSize,
  spanOf,
  stepSize,
} from "./home-layout.ts";

const ids = (items: Placed[]) => items.map((p) => p.id).join(",");
const L = (...spec: string[]): Placed[] => spec.map((s) => ({ id: s.split(":")[0], size: (s.split(":")[1] ?? "s") as Placed["size"] }));

test("a new person gets the default layout, versioned", () => {
  const l = readLayout(undefined);
  assert.equal(l.version, LAYOUT_VERSION);
  assert.deepEqual(l.items, [...DEFAULT_ITEMS]);
  // A copy: changing it never changes the default.
  l.items[0].size = "w";
  assert.equal(defaultLayout().items[0].size, DEFAULT_ITEMS[0].size);
});

test("the default starts with what needs you and packs without holes in four columns", () => {
  assert.equal(DEFAULT_ITEMS[0].id, "needs-you");
  const cells = pack(DEFAULT_ITEMS, 4);
  const area = cells.reduce((n, x) => n + x.c * x.r, 0);
  assert.equal(area, rowsOf(cells) * 4);
});

test("readLayout takes an older bare list, drops junk and repeats, and keeps unknown ids", () => {
  const l = readLayout([{ id: "a", size: "l" }, { id: "a", size: "s" }, { id: "", size: "s" }, null, { id: "linear/assigned", size: "zz" }, "x"]);
  assert.equal(l.version, LAYOUT_VERSION);
  assert.deepEqual(l.items, [
    { id: "a", size: "l" },
    { id: "linear/assigned", size: "m" },
  ]);
  assert.deepEqual(readLayout({ version: 1, items: [] }).items, []);
  assert.deepEqual(readLayout({ nonsense: true }).items, [...DEFAULT_ITEMS]);
});

test("add appends once; remove and resize touch only their widget", () => {
  const items = L("a", "b");
  assert.equal(ids(add(items, "c", "m")), "a,b,c");
  assert.equal(ids(add(items, "a", "m")), "a,b");
  assert.equal(ids(remove(items, "a")), "b");
  assert.deepEqual(resize(items, "b", "l"), [
    { id: "a", size: "s" },
    { id: "b", size: "l" },
  ]);
  // Never in place.
  assert.equal(ids(items), "a,b");
});

test("move drops a widget in another's place, either way", () => {
  const items = L("a", "b", "c", "d");
  assert.equal(ids(move(items, "a", "c")), "b,c,a,d");
  assert.equal(ids(move(items, "d", "b")), "a,d,b,c");
  assert.equal(ids(move(items, "a", "a")), "a,b,c,d");
  assert.equal(ids(move(items, "a", "zz")), "a,b,c,d");
  assert.equal(ids(moveTo(items, "b", 99)), "a,c,d,b");
  assert.equal(ids(moveTo(items, "c", -3)), "c,a,b,d");
});

test("sizes snap to what a widget allows", () => {
  assert.equal(snapSize(["s", "m", "l"], 2, 2, "s"), "l");
  assert.equal(snapSize(["s", "m", "l"], 4, 1, "s"), "m");
  assert.equal(snapSize(["s", "m"], 1, 1, "m"), "s");
  assert.equal(fitSize(["m", "l"], "w"), "m");
  assert.equal(fitSize(["m", "l"], "l"), "l");
  assert.equal(stepSize(["s", "m", "l", "w"], "l", 1), "w");
  assert.equal(stepSize(["s", "m", "l"], "m", 1), "l");
  assert.equal(stepSize(["s", "m", "l"], "s", -1), "s");
  assert.equal(stepSize(["s", "m", "t", "l"], "m", -1), "t");
});

test("columns drop to two and one in narrower windows, and spans with them", () => {
  assert.equal(columnsFor(1200), 4);
  assert.equal(columnsFor(800), 4);
  assert.equal(columnsFor(799), 2);
  assert.equal(columnsFor(480), 2);
  assert.equal(columnsFor(479), 1);
  assert.deepEqual(spanOf("w", 2), { c: 2, r: 1 });
  assert.deepEqual(spanOf("l", 1), { c: 1, r: 2 });
});

test("pack fills holes densely, as the grid draws it", () => {
  const cells = pack(L("a:m", "b:l", "c:s", "d:s", "e:s"), 4);
  const at = Object.fromEntries(cells.map((x) => [x.id, [x.col, x.row]]));
  assert.deepEqual(at, { a: [0, 0], b: [2, 0], c: [0, 1], d: [1, 1], e: [0, 2] });
  // A wide widget in two columns takes the whole row.
  assert.deepEqual(
    pack(L("a:w", "b:s"), 2).map((x) => [x.col, x.row, x.c]),
    [
      [0, 0, 2],
      [0, 1, 1],
    ],
  );
});

test("the keyboard moves a widget left, right, up and down", () => {
  // a b . .     four columns: a m, b m
  // c d e f
  const items = L("a:m", "b:m", "c:s", "d:s", "e:s", "f:s");
  assert.equal(neighbour(items, "e", "up", 4), "b");
  assert.equal(neighbour(items, "a", "down", 4), "c");
  assert.equal(neighbour(items, "a", "up", 4), undefined);
  assert.equal(neighbour(items, "a", "left", 4), undefined);
  assert.equal(ids(moveToward(items, "c", "left", 4)), "a,c,b,d,e,f");
  assert.equal(ids(moveToward(items, "f", "right", 4)), "a,b,c,d,e,f");
  assert.equal(ids(moveToward(items, "e", "up", 4)), "a,e,b,c,d,f");
  // In one column, up and down are the order.
  assert.equal(neighbour(items, "c", "up", 1), "b");
  assert.equal(neighbour(items, "c", "down", 1), "d");
});
