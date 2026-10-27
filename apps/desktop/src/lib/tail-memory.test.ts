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

// The seam: writing on a page with a chip. An Enter or words elsewhere must keep it; its own words
// changed must drop it uncounted; only leaving the page is a no. A done line keeps its Undo.
test("an edit elsewhere never drops or ignores a chip; leaving the page does", () => {
  const chip = { where: "p", block: 1, text: "Call Sam" };
  const row = { where: "p" };
  const done = { where: "p", block: 0, text: "Sam", done: {} };
  const lines = [chip, row, done, { where: TODAY }];
  assert.deepEqual(edited(lines, "p", ["Beans", "Call Sam", "", "more"]), { gone: [row], ignored: [row], moved: [] });
  assert.deepEqual(edited([chip], "p", ["", "Beans", "Call Sam"]).moved, [[chip, 2]]);
  assert.deepEqual(edited([chip], "p", ["Beans", "Call Sam about"]), { gone: [chip], ignored: [], moved: [] });
  assert.deepEqual(edited(lines, "p"), { gone: [chip, row, done], ignored: [chip, row], moved: [] });
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
