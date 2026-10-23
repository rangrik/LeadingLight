// node --experimental-strip-types --test src/lib/file-marks.test.ts (pnpm test)
import assert from "node:assert/strict";
import { test } from "node:test";

import { agentMarks, changes, conflictLines, lineMap, patchText } from "./file-marks.ts";

test("changes marks added, modified and removed lines", () => {
  const c = changes("a\nb\nc\nd\n", "a\nB\nc\nx\ny\n");
  assert.deepEqual([...c.lines], [[2, "modified"], [4, "modified"], [5, "added"]]);
  assert.equal(c.added, 3);
  assert.equal(c.removed, 2);
  assert.deepEqual(c.hunks, [{ from: 2, to: 2 }, { from: 4, to: 5 }]);
  const d = changes("a\nb\nc\n", "a\nc\n");
  assert.deepEqual([...d.lines], []);
  assert.deepEqual([...d.deleted], [1]);
  assert.equal(d.removed, 1);
});

test("a new file is all added", () => {
  const c = changes(undefined, "x\ny\n");
  assert.equal(c.added, 2);
  assert.deepEqual(c.hunks, [{ from: 1, to: 3 }]);
});

test("agentMarks keeps your own edits apart from the agent's", () => {
  const before = "one\ntwo\nthree\n";
  const agent = "one\nTWO\nthree\nfour\n"; // the agent's version on disk
  const text = "one\nTWO\nthree!\nfour\n"; // and yours on top, unsaved
  const m = agentMarks(before, agent, agent, text);
  assert.equal(m.lines.get(2), "modified");
  assert.equal(m.lines.get(3), "own");
  assert.equal(m.lines.get(4), "added");
  assert.equal(m.added, 2);
  assert.equal(m.removed, 1);
  assert.deepEqual(m.hunks, [{ from: 2, to: 2 }, { from: 4, to: 4 }]);
  // Saved: yours is unmarked, the agent's lines still are, where they moved.
  const saved = "zero\none\nTWO\nthree!\nfour\n";
  const s = agentMarks(before, agent, saved, saved);
  assert.deepEqual([...s.lines].sort(), [[3, "modified"], [5, "added"]]);
  // Not touched this turn: only yours.
  const o = agentMarks(undefined, agent, agent, text);
  assert.deepEqual([...o.lines], [[3, "own"]]);
  assert.deepEqual(o.hunks, []);
  // Made this turn: all of it.
  assert.equal(agentMarks(null, "a\nb\n", "a\nb\n", "a\nb\n").lines.get(1), "added");
});

test("conflictLines are where the agent's new version differs, not your edits", () => {
  const base = "a\nb\nc\nd\n";
  const mine = "a\nb!\nc\nd\n";
  const theirs = "a\nb\nc\nD\n";
  assert.deepEqual(conflictLines(base, mine, theirs), [4]);
});

test("patchText replaces only what differs", () => {
  assert.equal(patchText("abc", "abc"), undefined);
  assert.deepEqual(patchText("hello world", "hello brave world"), { from: 6, to: 6, insert: "brave " });
  assert.deepEqual(patchText("aXc", "aYc"), { from: 1, to: 2, insert: "Y" });
});

test("lineMap pairs the lines two texts share", () => {
  assert.deepEqual([...lineMap("a\nb\nc", "x\na\nc")], [[1, 2], [3, 3]]);
});
