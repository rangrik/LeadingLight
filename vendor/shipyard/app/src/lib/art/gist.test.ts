// node --experimental-strip-types --test src/lib/art/gist.test.ts (pnpm test)
import assert from "node:assert/strict";
import { test } from "node:test";

import { gist } from "./gist.ts";

const chart = (c: object) => JSON.stringify({ $schema: "berth.chart/v1", ...c });

test("a before/after bar chart leads with its biggest change, judged", () => {
  const body = chart({
    type: "bar", x: "endpoint", units: "ms", better: "lower",
    y: [{ key: "before", color: "muted" }, "after"],
    data: [
      { endpoint: "/search", before: 1240, after: 410 },
      { endpoint: "/cart", before: 180, after: 176 },
    ],
  });
  assert.deepEqual(gist("chart", "chart", body), { text: "/search 1,240 → 410 ms (−67%)", tone: "good" });
  // Higher is better: the same drop is bad.
  assert.equal(gist("chart", "chart", body.replace('"lower"', '"higher"'))?.tone, "bad");
});

test("a trend says where it is now and how far it moved", () => {
  const body = chart({ type: "line", x: "day", units: "ms", better: "lower", y: [{ key: "s", label: "/search" }], data: [{ day: "Sep 24", s: 1180 }, { day: "Oct 7", s: 410 }] });
  assert.deepEqual(gist("chart", "chart", body), { text: "/search 410 ms now, −65% since Sep 24", tone: "good" });
  assert.equal(gist("chart", "chart", body.replace('"Sep 24"', '"2026-09-24"'))?.text, "/search 410 ms now, −65% since Sep 24");
});

test("gauge, funnel, ring, sankey and heatmap headlines", () => {
  assert.deepEqual(gist("chart", "chart", chart({ type: "gauge", value: 82, max: 100, units: "%", label: "Hit rate", better: "higher" })), { text: "Hit rate: 82%", tone: "good" });
  assert.equal(gist("chart", "chart", chart({ type: "funnel", data: [{ label: "visits", value: 48200 }, { label: "orders", value: 1900 }] }))?.text, "48.2k visits → 1,900 orders (3.9%)");
  assert.equal(gist("chart", "chart", chart({ type: "ring", data: [{ label: "Cache", value: 3 }, { label: "API", value: 1 }] }))?.text, "Cache 75% of 4");
  assert.deepEqual(
    gist("chart", "chart", chart({
      type: "sankey",
      nodes: [{ name: "Edge" }, { name: "API" }, { name: "OK", color: "good" }, { name: "Timeout", color: "bad" }],
      links: [{ source: "Edge", target: "API", value: 48200 }, { source: "API", target: "OK", value: 47760 }, { source: "API", target: "Timeout", value: 440 }],
    })),
    { text: "48.2k in · 440 timeout (0.9%)", tone: "bad" },
  );
  assert.deepEqual(
    gist("chart", "chart", chart({ type: "heatmap", x: "hour", row: "endpoint", z: "p95", units: "ms", better: "lower", data: [{ endpoint: "/cart", hour: "08", p95: 150 }, { endpoint: "/search", hour: "18", p95: 1420 }] })),
    { text: "Worst: /search at 18:00, 1,420 ms", tone: "bad" },
  );
});

test("a table with a status column counts failures", () => {
  const csv = 'suite,test,status,duration_ms\nsearch,"ranks, in-stock first",fail,58\nsearch,typos,pass,61\nindex,restart,skip,0\nrecs,region,FAILED,95\n';
  assert.deepEqual(gist("table", "csv", csv), { text: "2 failed of 4 · 1 skipped", tone: "bad" });
  assert.deepEqual(gist("table", "csv", "a,status\n1,pass\n2,ok\n"), { text: "All 2 passed", tone: "good" });
  assert.deepEqual(gist("table", "json", '[{"sku":"acme-kettle","stock":3},{"sku":"acme-mug","stock":0}]'), { text: "2 rows · 2 columns" });
  assert.deepEqual(gist("table", "tsv", "a\tb\n1\t2"), { text: "1 row · 2 columns" });
});

test("diagrams, notes and pages", () => {
  assert.equal(gist("diagram", "mermaid", "graph LR\n  web[acme web] --> api[Search API]\n  api --> idx[(Index)]\n  api -. fallback .-> pg[(Postgres)]")?.text, "4 parts, 3 connections");
  assert.deepEqual(gist("notes", "markdown", "# Plan\n1. Add the index\n2. Backfill\n3. Switch reads\n\nOK to go ahead?"), { text: "3 steps · waits for your approval", tone: "plain" });
  assert.equal(gist("notes", "markdown", "# Findings\nThe cache is cold.")?.text, "Findings");
  assert.equal(gist("page", "html", '<meta name="berth:summary" content="84% reindexed &middot; 1 slow shard"><title>x</title>')?.text, "84% reindexed · 1 slow shard");
  assert.equal(gist("page", "html", "<title>Reindex</title>")?.text, "Reindex");
});
