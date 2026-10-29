import assert from "node:assert/strict";
import { test } from "node:test";
import { dated, edited, type Entry, isOut, isQuiet, LEDGER, quietLine, record, seenOn, TODAY, upgraded } from "./tail-memory.ts";

// The seam: when tail goes quiet. Three ignores in one place must quiet a kind there and nowhere
// else; a nod lifts it; once its sentence is deleted, it takes three more.
test("three ignores quiet a kind in one place; a nod or a deleted sentence lifts it", () => {
  const link = { kind: "mention", type: "meeting" };
  const add = (entries: Entry[], e: Partial<Entry>, at: number) => record(entries, { ...link, took: false, ...e, at });
  const two = add(add([], {}, 1).entries, {}, 2);
  assert.equal(two.change, undefined);
  const three = add(two.entries, {}, 3);
  assert.equal(three.change, "quiet");
  assert.equal(add(two.entries, { type: "page" }, 3).change, undefined);
  assert.equal(add(three.entries, { took: true }, 4).change, "lift");
  const after = add(add(three.entries, {}, 4).entries, {}, 5);
  assert.equal(after.change, undefined);
  assert.equal(add(after.entries, {}, 6).change, "quiet");
  assert.equal(add(two.entries, {}, 31 * 86_400_000).change, undefined);
  // Quiet is the page's sentence: deleted or edited, the kind is back.
  assert.ok(isQuiet([dated("2026-10-26", quietLine("mention", "Meeting"))], "mention", "Meeting"));
  assert.ok(!isQuiet([], "mention", "Meeting"));
  assert.ok(!isQuiet(["2026-10-26 · Links on Meeting pages are fine."], "mention", "Meeting"));
});

// The seam: the ledger an older build left. Its entries must go, once; what Today's rows keep stays.
test("a new ledger version clears the old entries", () => {
  const old = { entries: [{ kind: "task", type: "daily", took: false, at: 1 }], shown: { a: { day: "d", state: "s" } } };
  const now = upgraded(old);
  assert.deepEqual(now, { ...old, v: LEDGER, entries: [] });
  assert.equal(upgraded({ ...now, entries: old.entries }).entries.length, 1);
});

// The seam: writing on a page with a suggestion. An Enter or words elsewhere must keep it; its own
// words changed must drop it uncounted; leaving keeps it (a no once seen 30 s) and drops the row uncounted.
test("an edit elsewhere never drops or ignores a suggestion; leaving the page after 30 s seen is a no", () => {
  const offer = { where: "p", block: 1, text: "Call Sam", seen: 0 };
  const row = { where: "p" };
  const done = { where: "p", block: 0, text: "Sam", done: {} };
  const lines = [offer, row, done, { where: TODAY }];
  assert.deepEqual(edited(lines, "p", ["Beans", "Call Sam", "", "more"], 40_000), { gone: [row], ignored: [row], moved: [] });
  assert.deepEqual(edited([offer], "p", ["", "Beans", "Call Sam"]).moved, [[offer, 2]]);
  assert.deepEqual(edited([offer], "p", ["Beans", "Call Sam about"], 40_000), { gone: [offer], ignored: [], moved: [] });
  assert.deepEqual(edited(lines, "p", undefined, 30_000), { gone: [row], ignored: [offer], moved: [] });
  assert.deepEqual(edited([offer, { ...offer, ignored: true }, { ...offer, seen: undefined }], "p", undefined, 29_000).ignored, []);
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
