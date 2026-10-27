import assert from "node:assert/strict";
import { test } from "node:test";
import { dated, edited, type Entry, isOut, isQuiet, quietLine, record, seenOn, TODAY } from "./tail-memory.ts";

// The seam: when tail goes quiet. Two ignores in one place must quiet a kind there and nowhere
// else; a nod lifts it; once its sentence is deleted, one more ignore must not quiet it again.
test("two ignores quiet a kind in one place; a nod or a deleted sentence lifts it", () => {
  const link = { kind: "mention", type: "meeting" };
  const add = (entries: Entry[], e: Partial<Entry>, at: number) => record(entries, { ...link, took: false, ...e, at });
  const one = add([], {}, 1);
  assert.equal(one.change, undefined);
  const two = add(one.entries, {}, 2);
  assert.equal(two.change, "quiet");
  assert.equal(add(one.entries, { type: "page" }, 2).change, undefined);
  assert.equal(add(two.entries, { took: true }, 3).change, "lift");
  const after = add(two.entries, {}, 3);
  assert.equal(after.change, undefined);
  assert.equal(add(after.entries, {}, 4).change, "quiet");
  assert.equal(add(two.entries, {}, 31 * 86_400_000).change, undefined);
  // Quiet is the page's sentence: deleted or edited, the kind is back.
  assert.ok(isQuiet([dated("2026-10-26", quietLine("mention", "Meeting"))], "mention", "Meeting"));
  assert.ok(!isQuiet([], "mention", "Meeting"));
  assert.ok(!isQuiet(["2026-10-26 · Links on Meeting pages are fine."], "mention", "Meeting"));
});

// The seam: typing after a nod, or on Today. A done line must keep its Undo, and Today's rows must
// stay, neither counted as ignored.
test("an edit never lets a done line or a Today row go", () => {
  const lines = [{ where: "p", block: 2, done: {} }, { where: "p", block: 2 }, { where: "p", block: 3 }, { where: "q" }];
  assert.deepEqual(edited(lines, "p", 2), { gone: [lines[1], lines[2]], ignored: [lines[2]] });
  assert.deepEqual(edited([{ where: TODAY }], TODAY), { gone: [], ignored: [] });
});

// The seam: a Today row shown day after day. Seen on a second day unchanged, it must stay out
// while its sentence stands; changed pages or a deleted sentence bring it back.
test("a row seen on two days stays out until its pages change", () => {
  const one = seenOn(undefined, "2026-10-25", "a", "Garden plan");
  assert.equal(seenOn(one, "2026-10-25", "a", "Garden plan").said, undefined);
  const two = seenOn(one, "2026-10-26", "a", "Garden plan");
  assert.equal(two.said, "Not asking again about Garden plan for now.");
  const page = [dated("2026-10-26", two.said ?? "")];
  assert.ok(isOut(two, "a", page));
  assert.ok(!isOut(two, "b", page) && !isOut(two, "a", []));
  assert.equal(seenOn(two, "2026-10-27", "b", "Garden plan").said, undefined);
});
