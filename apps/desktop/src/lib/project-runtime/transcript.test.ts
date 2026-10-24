import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyWindow, merge } from "./transcript.ts";

// The seam: a chat reading the runtime again after a drop or a restart shows each item once.
test("changed items replace theirs, and a fresh read keeps what came before it", () => {
  const user = { kind: "user", id: "a", off: 10, text: "hi" };
  const tools = { kind: "tools", id: "b", off: 20, items: [{ verb: "Read", target: "x" }] };
  let w = merge(emptyWindow, { items: [user, tools], next: 2, gen: "1" });
  w = merge(w, { items: [{ ...tools, done: true }, { kind: "text", id: "c", off: 30, text: "ok" }], next: 3, gen: "1" });
  assert.deepEqual(w.items.map((i) => [i.id, i.done ?? false]), [["a", false], ["b", true], ["c", false]]);
  w = merge(w, { items: [{ ...tools, done: true }, { kind: "text", id: "c", off: 30, text: "ok" }], next: 3, gen: "2", reset: true, start: 20 });
  assert.deepEqual(w.items.map((i) => i.id), ["a", "b", "c"]);
  assert.equal(w.gen, "2");
  // Nothing new since: the runtime says so with null.
  assert.equal(merge(w, { items: null, next: 3, gen: "2" }).items.length, 3);
});
