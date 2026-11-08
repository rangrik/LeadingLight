import assert from "node:assert/strict";
import { test } from "node:test";
import { rank } from "./match.ts";

// Seam: quick open's order. Catches a scattered match outranking a title's start or its initials,
// and a long title winning on letters found mid-word ("fl" in "default").
test("whole name, its start, a word's start, initials, then letters in order", () => {
  const [whole, start, word, letters] = ["pri", "Pricing notes", "Write the pricing page copy", "Project review"].map((n) => rank("pri", n)!);
  assert.ok(whole < start && start < word && word < letters && letters < 4);
  assert.ok(rank("fl", "Feedback loops")! < rank("fl", "Fix the tab row overflow")!);
  assert.equal(rank("fl", "Should show word counts by default"), undefined);
  assert.equal(rank("sonke", "Sönke Ahrens"), 1);
  assert.equal(rank("  ", "Pricing notes"), undefined);
});
