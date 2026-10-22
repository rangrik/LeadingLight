// node --experimental-strip-types --test src/lib/art/chart-spec.test.ts (pnpm test)
import assert from "node:assert/strict";
import { test } from "node:test";

import { type BerthChart, fmt, legend, parseChart, plan, timeAxis, X_LABEL } from "./chart-spec.ts";

const spec = (c: Partial<BerthChart>): BerthChart => ({ $schema: "berth.chart/v1", type: "bar", ...c }) as BerthChart;

test("only a berth.chart/v1 spec of a known type parses", () => {
  assert.ok(parseChart(JSON.stringify(spec({ type: "gauge", value: 1 }))));
  assert.equal(parseChart(`{"$schema":"berth.chart/v2","type":"bar"}`), undefined);
  assert.equal(parseChart(`{"$schema":"berth.chart/v1","type":"scatter"}`), undefined);
  assert.equal(parseChart("{nope"), undefined);
});

test("a bar chart is a BarChart with a Bar per series, in named colours", () => {
  const p = plan(spec({ x: "endpoint", y: [{ key: "before", label: "Before", color: "muted" }, "after"], stacked: true, orientation: "horizontal", data: [{ endpoint: "/search", before: 1240, after: 410 }] }));
  assert.equal(p.type, "bar");
  if (p.type !== "bar") return;
  assert.equal(p.x, "endpoint");
  assert.deepEqual(p.series, [
    { key: "before", label: "Before", color: "var(--chart-muted)" },
    // An unnamed series takes the palette by its place: the second is --chart-2.
    { key: "after", label: "after", color: "var(--chart-2)" },
  ]);
  assert.ok(p.stacked && p.horizontal);
});

test("a line over dates keeps them; over labels, it is labelled", () => {
  const dated = plan(spec({ type: "line", x: "day", y: ["p95"], data: [{ day: "2026-10-01", p95: 1250 }, { day: "2026-10-02", p95: 1190 }] }));
  assert.equal(dated.type, "line");
  if (dated.type !== "line") return;
  assert.ok(dated.dates);
  assert.equal((dated.data[1].date as Date).toISOString().slice(0, 10), "2026-10-02");
  assert.equal(dated.data[0][X_LABEL], undefined);

  const { data, dates } = timeAxis([{ build: "v1", s: 1 }, { build: "v2", s: 2 }, { build: "v3", s: 3 }], "build");
  assert.equal(dates, false);
  assert.deepEqual(data.map((r) => r[X_LABEL]), ["v1", "v2", "v3"]);
  // One day apart, in order, so bklit's time scale spaces them evenly.
  const t = data.map((r) => (r.date as Date).getTime());
  assert.equal(t[1] - t[0], 86_400_000);
  assert.equal(t[2] - t[1], 86_400_000);
});

test("funnel, pie and ring read label and value, or the keys x and z name", () => {
  const f = plan(spec({ type: "funnel", units: "", data: [{ label: "Visited", value: 48200 }, { label: "Bought", value: 1900 }] }));
  assert.equal(f.type, "funnel");
  if (f.type === "funnel") assert.deepEqual(f.stages[0], { label: "Visited", value: 48200, displayValue: "48.2k" });
  const p = plan(spec({ type: "pie", x: "channel", z: "visits", data: [{ channel: "Search", visits: 30 }, { channel: "Ads", visits: 10 }] }));
  assert.equal(p.type, "pie");
  if (p.type === "pie") {
    assert.equal(p.total, 40);
    assert.deepEqual(p.slices.map((s) => [s.label, s.value, s.color]), [["Search", 30, "var(--chart-1)"], ["Ads", 10, "var(--chart-2)"]]);
  }
  const r = plan(spec({ type: "ring", data: [{ label: "Cache", value: 3 }, { label: "API", value: 1 }] }));
  assert.equal(r.type, "ring");
  // Each ring is its share of the whole.
  if (r.type === "ring") assert.deepEqual(r.rings.map((x) => x.maxValue), [4, 4]);
  assert.deepEqual(legend(spec({ type: "ring", data: [{ label: "Cache", value: 3 }] })), [{ label: "Cache", color: "var(--chart-1)" }]);
});

test("a sankey's names become bklit's node indices", () => {
  const p = plan(spec({
    type: "sankey",
    nodes: [{ name: "Edge" }, { name: "API" }, { name: "Timeout", color: "bad" }],
    links: [{ source: "Edge", target: "API", value: 10 }, { source: "API", target: "Timeout", value: 2 }, { source: "API", target: "Nowhere", value: 1 }],
  }));
  assert.equal(p.type, "sankey");
  if (p.type !== "sankey") return;
  assert.deepEqual(p.links, [{ source: 0, target: 1, value: 10 }, { source: 1, target: 2, value: 2 }]);
  assert.equal(p.nodes[2].color, "var(--chart-bad)");
});

test("a gauge is a percentage of its max, coloured by which way is better", () => {
  const g = plan(spec({ type: "gauge", value: 820, max: 1000, better: "higher", label: "Hit rate" }));
  assert.equal(g.type, "gauge");
  if (g.type !== "gauge") return;
  assert.equal(g.percent, 82);
  assert.equal(g.color, "var(--chart-good)");
  const low = plan(spec({ type: "gauge", value: 90, better: "lower" }));
  if (low.type === "gauge") assert.equal(low.color, "var(--chart-bad)");
  const over = plan(spec({ type: "gauge", value: 140 }));
  if (over.type === "gauge") assert.equal(over.percent, 100);
});

test("a heatmap is a matrix with log-scaled levels and gaps kept", () => {
  const p = plan(spec({
    type: "heatmap", x: "hour", row: "endpoint", z: "p95",
    data: [
      { endpoint: "/search", hour: "08", p95: 1000 },
      { endpoint: "/search", hour: "09", p95: 10 },
      { endpoint: "/cart", hour: "08", p95: 100 },
    ],
  }));
  assert.equal(p.type, "heatmap");
  if (p.type !== "heatmap") return;
  assert.deepEqual(p.cols, ["08", "09"]);
  assert.deepEqual(p.rows, ["/search", "/cart"]);
  assert.deepEqual(p.cells, [[1000, 10], [100, null]]);
  // 10 → 0, 100 → the middle, 1000 → the top; the missing cell is -1.
  assert.deepEqual(p.levels, [[4, 0], [2, -1]]);
});

test("values read as a person reads them", () => {
  assert.equal(fmt(1240), "1,240");
  assert.equal(fmt(410, "ms"), "410 ms");
  assert.equal(fmt(48200), "48.2k");
  assert.equal(fmt(82, "%"), "82%");
  assert.equal(fmt(1.5, "s"), "1.5 s");
  assert.equal(fmt(12.5, "$"), "$12.5");
});
