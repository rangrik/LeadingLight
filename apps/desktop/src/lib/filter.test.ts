import assert from "node:assert/strict";
import { test } from "node:test";
import { textSearch } from "./filter.ts";
import type { ObjectSummary } from "./store.ts";

// The cache's key: a page is read again only once it has been saved since.
test("text search reads a page once per save", async () => {
  const bodies: Record<string, string> = { a: "a long delay", b: "no match here" };
  const read: string[] = [];
  const search = textSearch(async (id) => (read.push(id), bodies[id]));
  const page = (id: string, updatedAt: number) => ({ id, title: id, typeId: "page", properties: {}, createdAt: 0, updatedAt }) as ObjectSummary;
  assert.deepEqual((await search(["delay"], [page("a", 1), page("b", 1)])).map((f) => f.page.id), ["a"]);
  await search(["match"], [page("a", 1), page("b", 1)]);
  assert.deepEqual(read, ["a", "b"]);
  bodies.b = "now a delay too";
  const found = await search(["delay"], [page("a", 1), page("b", 2)]);
  assert.deepEqual(read, ["a", "b", "b"]);
  assert.deepEqual(found.map((f) => f.line), ["now a delay too", "a long delay"]);
});
