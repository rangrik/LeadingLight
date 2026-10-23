// node --experimental-strip-types --test src/lib/file-match.test.ts (pnpm test)
import assert from "node:assert/strict";
import { test } from "node:test";

import { dirName, fileName, fuzzy, rank } from "./file-match.ts";

const files = [
  "apps/web/app/api/webhooks/payments/route.ts",
  "apps/web/lib/payments/webhook.test.ts",
  "apps/web/lib/payments/webhook.ts",
  "packages/web-hooks/index.ts",
  "README.md",
];

test("letters in the file's own name win", () => {
  assert.equal(rank("paywh", files)[0].path, "apps/web/lib/payments/webhook.ts");
  assert.equal(rank("webhook", files)[0].path, "apps/web/lib/payments/webhook.ts");
  assert.equal(rank("readme", files)[0].path, "README.md");
});

test("every letter must be there, in order", () => {
  assert.equal(fuzzy("zz", "apps/web/lib/payments/webhook.ts"), undefined);
  assert.equal(fuzzy("kooh", "webhook.ts"), undefined);
  assert.deepEqual(rank("", files).length, files.length);
});

test("hits mark the letters matched, in the name where they can be", () => {
  const m = fuzzy("wh", "apps/web/lib/payments/webhook.ts")!;
  const name = "apps/web/lib/payments/webhook.ts".lastIndexOf("/") + 1;
  assert.ok(m.hits.every((h) => h >= name), `hits ${m.hits}`);
});

test("a lift raises the agent's files and recent ones", () => {
  const lifted = rank("webhook", files, (p) => (p.endsWith("test.ts") ? 6 : 0));
  assert.equal(lifted[0].path, "apps/web/lib/payments/webhook.test.ts");
});

test("names and folders", () => {
  assert.equal(fileName("a/b/c.ts"), "c.ts");
  assert.equal(dirName("a/b/c.ts"), "a/b");
  assert.equal(dirName("c.ts"), "");
});
