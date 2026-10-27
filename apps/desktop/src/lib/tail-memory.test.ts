import assert from "node:assert/strict";
import { test } from "node:test";
import { dated, type Entry, isQuiet, quietLine, record } from "./tail-memory.ts";

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
