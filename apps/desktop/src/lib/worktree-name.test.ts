import assert from "node:assert/strict";
import { test } from "node:test";
import { worktreeName } from "./worktree-name.ts";

// Seam: the name the runtime makes a worktree and branch from. Catches a name git or berthd
// refuses (accents, symbols, too long), filler words kept, and a second task taking the first's.
test("a worktree's name from a task's title", () => {
  const none = new Set<string>();
  assert.equal(worktreeName("Write the summary", none), "write-summary");
  assert.equal(worktreeName("Fix the 2 broken links on the pricing page, please!!", none), "fix-broken-links-pricing-page");
  assert.equal(worktreeName("Ümlauts & émojis 🎉", none), "umlauts-emojis");
  assert.equal(worktreeName("Art direction for the hero", none), "direction-hero");
  assert.match(worktreeName("The 🎉 of it", none), /^task-[a-z]{4}$/);
  assert.equal(worktreeName("Write the summary", new Set(["write-summary", "write-summary-2"])), "write-summary-3");
  const long = "Internationalisation accessibility improvements everywhere";
  assert.equal(worktreeName(long, none), "internationalisation");
  assert.ok(worktreeName("x".repeat(40), new Set(["x".repeat(30)])).length <= 30);
});
