import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { allClear, changes, firstPage, flags, overflow, parseVdiff, pct, schemeOf, schemes, shotKey, sortedPages, thumbShot, vdiffGist, worstShot } from "./vdiff.ts";

// Real runs of berthd shots compare (mock-vdiff/): v1 has a sideways
// scroll and a failing page, v2 fixed both, and the all clear.
const read = (n: string) => parseVdiff(readFileSync(new URL(`./mock-vdiff/${n}.json`, import.meta.url), "utf8"))!;
const v1 = read("46ab3c4e1b-v1");
const v2 = read("46ab3c4e1b-v2");
const clear = read("39fdf22244-v1");

test("a manifest parses, and anything else doesn't", () => {
  assert.ok(v1 && v2 && clear);
  assert.equal(parseVdiff("{}"), undefined);
  assert.equal(parseVdiff('{"$schema":"berth.chart/v1","pages":[{}]}'), undefined);
  assert.equal(parseVdiff("not json"), undefined);
});

test("pages are ordered errors, sideways scrolls, changes, new pages, unchanged; the tab opens on a change", () => {
  const order = sortedPages(v1).map((p) => p.path);
  assert.deepEqual(order.slice(0, 2), ["/account", "/search"]);
  assert.equal(order.at(-1) === "/about" || order.at(-1) === "/login", true);
  assert.equal(order.indexOf("/deals") > order.indexOf("/"), true);
  const first = firstPage(sortedPages(v1));
  assert.equal(first.path, "/search");
  assert.equal(worstShot(first).size, 375);
  assert.equal(overflow(worstShot(first)), 125);
});

test("changes step errors first, then the sideways scroll's regions, then by size; new pages once, last", () => {
  const cs = changes(v1);
  assert.equal(cs[0].kind, "error");
  assert.equal(cs[0].page.path, "/account");
  assert.equal(cs[1].kind, "region");
  assert.equal(cs[1].shot.size, 375);
  assert.equal(cs[1].page.path, "/search");
  assert.equal(cs.filter((c) => c.kind === "new").length, 1);
  assert.equal(cs.at(-1)!.kind, "new");
  assert.equal(cs.filter((c) => c.kind === "error").length, 1);
});

test("flags, the gist and the all clear", () => {
  const f = flags(v1);
  assert.deepEqual(f.sideways, [{ path: "/search", size: 375, px: 125 }]);
  assert.deepEqual(f.fails, ["/account"]);
  assert.deepEqual(f.fresh, ["/deals"]);
  assert.equal(f.same, 2);
  assert.equal(vdiffGist(v1).tone, "bad");
  assert.equal(vdiffGist(v2).tone, "plain");
  assert.equal(vdiffGist(v2).text, "2 of 6 pages changed · most: /search at 768 (48%)");
  assert.equal(allClear(clear), true);
  assert.deepEqual(vdiffGist(clear), { text: "No visual changes · 6 pages × 3 sizes", tone: "good" });
  assert.equal(thumbShot(v2)?.shot.size, 768);
  assert.equal(thumbShot(clear), undefined);
});

test("percentages read as a person says them", () => {
  assert.deepEqual([pct(48.13), pct(5.07), pct(0.264), pct(0)], ["48%", "5.1%", "0.26%", "0%"]);
});

test("both colour schemes: each shot says its own, light when it doesn't", () => {
  const both = { ...v2, settings: { ...v2.settings, color_scheme: "both", color_schemes: ["light", "dark"] as ("light" | "dark")[] } };
  assert.deepEqual(schemes(both), ["light", "dark"]);
  assert.deepEqual(schemes(v2), ["light"]);
  const s = v2.pages[0].shots[0];
  assert.equal(schemeOf(s), "light");
  assert.equal(shotKey({ ...s, scheme: "dark" }), `${s.size} dark`);
  assert.equal(shotKey(s), `${s.size}`);
});
