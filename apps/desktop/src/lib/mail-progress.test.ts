import assert from "node:assert/strict";
import { test } from "node:test";
import { freshState } from "./mail-rules.ts";
import { mergeProgress, progressOf } from "./mail-progress.ts";

// An offline decision and undo must survive another device changing different mail.
test("rebase local choices without resurrecting the other device’s cleared mail", () => {
  const base = progressOf(freshState(Date.now()));
  base.start = 1;
  base.kept = { a: "yesterday", b: "yesterday" };
  const local = structuredClone(base), remote = structuredClone(base);
  delete local.kept.a;
  delete remote.kept.b;
  local.today.handled.c = "later";
  remote.today.handled.d = "done";
  local.today.clearedKeys = { e: true, shared: true };
  remote.today.clearedKeys = { f: true, shared: true };
  local.today.cleared = remote.today.cleared = 2;
  const merged = mergeProgress(base, local, remote);
  assert.deepEqual(merged.kept, {});
  assert.deepEqual(merged.today.handled, { c: "later", d: "done" });
  assert.equal(merged.today.cleared, 3);
  assert.deepEqual(mergeProgress(base, local, merged), merged);
});
