import assert from "node:assert/strict";
import { test } from "node:test";
import { stopStarting } from "./stop-starting.ts";

// The first stop may arrive before the backend has registered the starting turn.
test("waits for startup and stops a late registration before confirming", async () => {
  let registered = false, calls = 0, release!: () => void;
  const starting = new Promise<void>((resolve) => { release = resolve; });
  const stopped = stopStarting(async () => { calls++; registered = false; }, starting);
  await Promise.resolve();
  assert.equal(calls, 1);
  registered = true;
  release();
  await stopped;
  assert.equal(calls, 2);
  assert.equal(registered, false);
});
