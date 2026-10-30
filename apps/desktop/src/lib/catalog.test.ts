import assert from "node:assert/strict";
import { test } from "node:test";
import { carry, type PropDef, type TypeDef } from "./catalog.ts";

// Seam: a page changing type. Catches a value left under a row the new type doesn't show (an
// idea's Project once it is a task) and one moved onto a same-named property with other options.
test("a value moves to the new type's property of the same shape, and only there", () => {
  const rel = (id: string, reverse: string): PropDef => ({ id, name: "Project", kind: "relation", options: { type: "project", reverse }, createdAt: 0 });
  const sel = (id: string, choice: string): PropDef => ({ id, name: "Status", kind: "select", options: { choices: [{ id: choice, name: choice, color: "gray" }] }, createdAt: 0 });
  const props = [rel("idea-project", "Ideas"), rel("task-project", "Tasks"), sel("book-status", "read"), sel("project-status", "done")];
  const type = (...ids: string[]): TypeDef => ({ id: "t", name: "T", plural: "Ts", props: ids, card: [], linkView: "line", createdAt: 0 });
  assert.deepEqual(carry({ "idea-project": ["p1"], tags: [] }, type("task-project", "tags"), props), { tags: [], "task-project": ["p1"] });
  assert.deepEqual(carry({ "idea-project": ["p1"], "task-project": ["p2"] }, type("task-project"), props), { "idea-project": ["p1"], "task-project": ["p2"] });
  assert.deepEqual(carry({ "book-status": "read" }, type("project-status"), props), { "book-status": "read" });
});
