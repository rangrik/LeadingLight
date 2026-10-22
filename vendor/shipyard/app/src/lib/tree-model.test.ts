// node --experimental-strip-types --test src/lib/tree-model.test.ts (pnpm test)
import assert from "node:assert/strict";
import { test } from "node:test";

import { allRows, byName, changedRows, defaultFilter, folderOf, type Listing, newFilePath, type Touch, type TreeRow } from "./tree-model.ts";

const touch = (path: string, more: Partial<Touch> = {}): Touch => ({ path, added: 1, removed: 0, session: "s1", agent: "claude", ...more });
const working = () => true;
const idle = () => false;
// A row as "  name/" (an open folder, indented by depth) or "  name".
const show = (rows: TreeRow[]) => rows.map((r) => `${"  ".repeat(r.depth)}${r.name}${r.kind === "dir" ? (r.open ? "/" : "/…") : ""}`);

test("names sort as a person reads them: case aside, numbers by value", () => {
  assert.deepEqual(["analytics-10", "analytics-2", "Zeta", "alpha", "v1", "V10", "v9"].sort(byName), ["alpha", "analytics-2", "analytics-10", "v1", "v9", "V10", "Zeta"]);
  // Equal but for case: a stable order all the same.
  assert.deepEqual(["readme", "README"].sort(byName), ["README", "readme"]);
});

test("Changed folds to the touched files, chains of single folders as one row", () => {
  const rows = changedRows(
    [touch("apps/web/lib/payments/webhook.ts"), touch("apps/web/lib/payments/idempotency.ts", { created: true }), touch("apps/web/lib/checkout/totals.ts"), touch("db/migrations/0008_events.sql"), touch("README.md")],
    new Set(),
    working,
  );
  assert.deepEqual(show(rows), ["apps/web/lib/", "  checkout/", "    totals.ts", "  payments/", "    idempotency.ts", "    webhook.ts", "db/migrations/", "  0008_events.sql", "README.md"]);
  assert.equal(rows[0].path, "apps/web/lib");
  assert.equal(rows[0].inside, 3);
  assert.equal(rows.find((r) => r.name === "README.md")?.touched?.path, "README.md");
});

test("a closed folder in Changed hides what is in it", () => {
  const rows = changedRows([touch("a/b/one.ts"), touch("a/c/two.ts")], new Set(["a/b"]), working);
  assert.deepEqual(show(rows), ["a/", "  b/…", "  c/", "    two.ts"]);
});

test("All lists a level at a time, open folders below, numbered folders in order", () => {
  const listings: Record<string, Listing> = {
    "": { dirs: [{ name: "pkgs", children: true }, { name: "src", children: true }, { name: "vendor", children: false }], files: ["README.md", "Makefile"] },
    pkgs: { dirs: [{ name: "v10", children: true }, { name: "v2", children: true }], files: [] },
  };
  const rows = allRows((d) => listings[d], new Set(["pkgs", "vendor"]), [], working);
  assert.deepEqual(show(rows), ["pkgs/", "  v2/…", "  v10/…", "src/…", "vendor/…", "Makefile", "README.md"]);
  // A submodule's folder has nothing to open.
  assert.equal(rows.find((r) => r.name === "vendor")?.empty, true);
});

test("an open folder still loading says so", () => {
  const rows = allRows((d) => (d === "" ? { dirs: [{ name: "src", children: true }], files: [] } : d === "src" ? { dirs: [], files: [], loading: true } : undefined), new Set(["src"]), [], working);
  assert.equal(rows[0].loading, true);
});

test("All marks touched files, dots their folders, and adds a file the listing lacks", () => {
  const listings: Record<string, Listing> = {
    "": { dirs: [{ name: "src", children: true }], files: ["gone.ts"] },
    src: { dirs: [], files: ["app.ts"] },
  };
  const touched = [touch("src/app.ts"), touch("src/new.ts", { created: true }), touch("lib/made.ts", { created: true }), touch("gone.ts", { deleted: true })];
  const rows = allRows((d) => listings[d], new Set(["src"]), touched, working);
  assert.deepEqual(show(rows), ["lib/…", "src/", "  app.ts", "  new.ts"]);
  assert.equal(rows.find((r) => r.path === "src")?.inside, 2);
  assert.equal(rows.find((r) => r.path === "src/app.ts")?.touched?.path, "src/app.ts");
});

test("the live marker needs the box's live and a working session", () => {
  const t = [touch("src/app.ts", { live: true, session: "a" }), touch("src/old.ts", { session: "a" })];
  const rows = changedRows(t, new Set(), (s) => s === "a");
  assert.equal(rows.find((r) => r.path === "src/app.ts")?.live, true);
  assert.equal(rows.find((r) => r.path === "src/old.ts")?.live, false);
  assert.equal(rows.find((r) => r.path === "src")?.liveInside, true);
  // The agent stopped: no marker, however recent the write.
  const stopped = changedRows(t, new Set(), idle);
  assert.equal(stopped.some((r) => r.live || r.liveInside), false);
  // Deleted files are never live.
  assert.equal(changedRows([touch("x.ts", { live: true, deleted: true })], new Set(), working)[0].live, false);
});

test("the filter is Changed while the agent works, until the person picks", () => {
  assert.equal(defaultFilter(undefined, true), "changed");
  assert.equal(defaultFilter(undefined, false), "all");
  assert.equal(defaultFilter("all", true), "all");
  assert.equal(defaultFilter("changed", false), "changed");
});

test("New file names a file in the folder you are on", () => {
  assert.equal(newFilePath("apps/web", "util.ts"), "apps/web/util.ts");
  assert.equal(newFilePath("apps/web", " lib/util.ts "), "apps/web/lib/util.ts");
  assert.equal(newFilePath("apps/web", "/top.ts"), "top.ts");
  assert.equal(newFilePath("", "a.ts"), "a.ts");
  assert.equal(newFilePath("src", ""), undefined);
  assert.equal(newFilePath("src", "dir/"), undefined);
  assert.equal(newFilePath("src", "../../etc/passwd"), undefined);
  assert.equal(newFilePath("src", ".git/config"), undefined);
  assert.equal(folderOf({ kind: "file", path: "src/a.ts" }), "src");
  assert.equal(folderOf({ kind: "dir", path: "src/lib" }), "src/lib");
  assert.equal(folderOf({ kind: "file", path: "a.ts" }), "");
  assert.equal(folderOf(undefined), "");
});
