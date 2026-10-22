// node --experimental-strip-types --test src/themes/contrast.test.ts (pnpm check:themes)
// Every built-in theme meets the contrast and the state colours contrast.ts
// asks of it. BERTH_THEME_REPORT=1 prints each check's value.
import assert from "node:assert/strict";
import { test } from "node:test";

import { builtinThemes } from "./builtin.ts";
import { checks, failures } from "./contrast.ts";

const report = !!process.env.BERTH_THEME_REPORT;

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
