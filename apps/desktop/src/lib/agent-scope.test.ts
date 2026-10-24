import assert from "node:assert/strict";
import { test } from "node:test";
import { type Graph, scopeOf } from "./agent-scope.ts";

// The seam: what a project's agent may read. A page outside the project must stay out, through
// cycles and through a tag every page shares.
test("a project's scope follows its links, not the whole space", async () => {
  const body: Record<string, string[]> = { R: ["P"], P: ["R"] };
  // K is a task of the project R, S a subtask of K; P and the outside page D share the tag T.
  const rel: Record<string, string[]> = { K: ["R"], S: ["K"], P: ["T"], D: ["T"], X: [] };
  const g: Graph = {
    out: async (id) => [...(body[id] ?? []), ...(rel[id] ?? [])],
    back: (id) => Object.keys(rel).filter((k) => rel[k].includes(id)),
    mentions: async () => [],
    hub: (id) => id === "T",
    exists: (id) => ["R", "P", "K", "S", "T", "D", "X"].includes(id),
  };
  assert.deepEqual([...(await scopeOf("R", g))].sort(), ["K", "P", "R", "S", "T"]);
});
