import assert from "node:assert/strict";
import { test } from "node:test";

import type { Location } from "@berth/plugin";

import { localTitle, setLocalTitle, withLocalTitles } from "./local-titles.ts";

const locs = (): Location[] => [
  {
    name: "shop",
    path: "/w/shop",
    repo: true,
    scripts: {},
    worktrees: [
      { name: "shop", path: "/w/shop", main: true },
      { name: "ci-flake", path: "/w/shop-ci-flake" },
      { name: "named", path: "/w/shop-named", title: "The box's own" },
    ],
  },
];

test("a name kept on this laptop is laid over a box's worktree that has none", () => {
  setLocalTitle("gpu", "/w/shop-ci-flake", "Ledger move");
  setLocalTitle("gpu", "/w/shop-named", "Mine");
  assert.equal(localTitle("gpu", "/w/shop-ci-flake"), "Ledger move");
  const out = withLocalTitles("gpu", locs());
  assert.equal(out[0].worktrees![1].title, "Ledger move");
  // The box's own name wins.
  assert.equal(out[0].worktrees![2].title, "The box's own");
  // Another box, or a list that isn't there, is left alone.
  assert.equal(withLocalTitles("devl", locs())[0].worktrees![1].title, undefined);
  assert.deepEqual(withLocalTitles("gpu", null), []);
});

test("an empty name forgets it", () => {
  setLocalTitle("gpu", "/w/shop-ci-flake", "Ledger move");
  setLocalTitle("gpu", "/w/shop-ci-flake", "");
  setLocalTitle("gpu", "/w/shop-named", "");
  assert.equal(localTitle("gpu", "/w/shop-ci-flake"), undefined);
  assert.equal(withLocalTitles("gpu", locs())[0].worktrees![1].title, undefined);
});
