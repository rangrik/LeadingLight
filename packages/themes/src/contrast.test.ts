import assert from "node:assert/strict";
import { test } from "node:test";
import { checks, failures } from "./contrast.ts";
import { builtinThemes } from "./builtin.ts";

// The seam: our palettes against Shipyard's contrast bar (4.5:1 text, 3:1 rings and
// state dots, states apart). What it catches: an edit that leaves text unreadable in
// one theme, or two themes with one id. LL_THEME_REPORT=1 prints every check.
const report = !!process.env.LL_THEME_REPORT;

for (const theme of builtinThemes) {
  test(`${theme.name} is readable`, () => {
    if (report) for (const c of checks(theme)) console.log(`${theme.id}\t${c.what}\t${c.value.toFixed(2)}\t(min ${c.min})`);
    const bad = failures(theme).map((c) => `${c.what}: ${c.value.toFixed(2)}, wants ${c.min}`);
    assert.deepEqual(bad, []);
  });
}

test("theme ids are unique", () => {
  const ids = builtinThemes.map((t) => t.id);
  assert.deepEqual(ids, [...new Set(ids)]);
});
