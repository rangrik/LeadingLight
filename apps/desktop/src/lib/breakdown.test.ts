import assert from "node:assert/strict";
import { test } from "node:test";
import { byUrgency, isReady, rollUp } from "./breakdown.ts";

// Seam: what "Start the ready ones" starts, the parent's rolled-up state, and the Work table's
// order. Catches a subtask started before what it waits on is done, an agent's own step offered a
// Start, and a parent reading Ready for review while a subtask still works or asks.
test("ready subtasks, the roll-up and the order", () => {
  const sub = { done: false, agent: false, step: false, after: [] as boolean[] };
  assert.equal(isReady(sub), true);
  assert.equal(isReady({ ...sub, after: [true, false] }), false);
  assert.equal(isReady({ ...sub, after: [true, true] }), true);
  assert.equal(isReady({ ...sub, agent: true }), false);
  assert.equal(isReady({ ...sub, done: true }), false);
  assert.equal(isReady({ ...sub, step: true }), false);

  assert.equal(rollUp(undefined, []), undefined);
  assert.equal(rollUp(undefined, ["review", "working", "input"]), "input");
  assert.equal(rollUp("review", ["review", "starting"]), "working");
  assert.equal(rollUp(undefined, ["review", "done"]), "review");
  assert.equal(rollUp("review", []), "review");
  assert.equal(rollUp("idle", ["review"]), "idle");
  assert.equal(rollUp("review", ["idle"]), "idle");
  assert.equal(rollUp("stopped", []), "stopped");

  const rows = [
    { id: "new later", state: "new", at: 9 },
    { id: "new first", state: "new", at: 2 },
    { id: "done", state: "done", at: 9 },
    { id: "idle", state: "idle", at: 9 },
    { id: "working", state: "working", at: 1 },
    { id: "review old", state: "review", at: 1 },
    { id: "review new", state: "review", at: 5 },
    { id: "input", state: "input", at: 0 },
  ] as const;
  assert.deepEqual([...rows].sort(byUrgency).map((r) => r.id), ["input", "review new", "review old", "working", "idle", "new first", "new later", "done"]);
});
