import assert from "node:assert/strict";
import { test } from "node:test";
import { go, pageIn, readLayout, step, tab } from "./tabs.ts";

// Seam: a tab's history. Catches back or forward going the wrong way or past an end, and the
// pages ahead surviving a page opened from the middle (a browser drops them).
test("back, forward, and a page opened from the middle drops the pages ahead", () => {
  const t = go(go(tab("garden"), "sam"), "soil");
  const back = step(t, -1);
  assert.equal(pageIn(back), "sam");
  assert.equal(step(step(back, -1), -1).at, 0);
  assert.equal(step(t, 1), t);
  assert.deepEqual(go(back, "garden").pages, ["garden", "sam", "garden"]);
  assert.deepEqual(go(tab(""), "sam").pages, ["sam"]);
});

// Seam: the layout kept across a reload. Catches a page deleted since, or damaged storage,
// crashing the launch instead of opening as "No page open".
test("a kept layout with a missing page opens it as a new tab; damage gives null", () => {
  const leaf = (id: string, pages: string[]) => ({ kind: "leaf", id, tabs: [{ id: `${id}1`, pages, at: pages.length - 1 }], active: `${id}1` });
  const kept = readLayout({ root: { kind: "split", id: "s", dir: "row", ratio: 0.5, a: leaf("a", ["gone"]), b: leaf("b", ["sam", "gone"]) }, focus: "x" }, (p) => p !== "gone");
  assert.equal(kept?.root.kind === "split" && kept.root.a.kind === "leaf" && kept.root.a.page, "");
  assert.equal(kept?.root.kind === "split" && kept.root.b.kind === "leaf" && kept.root.b.page, "sam");
  assert.equal(kept?.focus, "a");
  assert.equal(readLayout({ root: { kind: "leaf", id: "a", tabs: [] } }, () => true), null);
  assert.equal(readLayout(null, () => true), null);
});
