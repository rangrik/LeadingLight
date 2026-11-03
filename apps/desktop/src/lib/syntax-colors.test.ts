import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveTheme } from "@pierre/diffs";
import { builtinThemes } from "../../../../packages/themes/src/builtin.ts";
import { syntaxThemes } from "../../../../vendor/shipyard/app/src/themes/apply.ts";
import { contrast, over } from "../../../../vendor/shipyard/app/src/themes/color.ts";
import { readableStyles, syntaxColors, type ShikiTheme } from "./syntax-colors.ts";

// Seam: resolved diff themes carry TextMate rules inside textmate.
test("file colors use each resolved theme's rules", async () => {
  for (const theme of builtinThemes) {
    const pair = syntaxThemes(theme);
    const resolved = await resolveTheme(theme.appearance === "dark" ? pair.dark : pair.light) as ShikiTheme;
    const colors = readableStyles(syntaxColors(resolved), theme.colors.background);
    assert.equal(new Set([colors.keyword.color, colors.string.color, colors.comment.color]).size, 3, theme.id);
    for (const color of [colors.keyword.color, colors.string.color, colors.comment.color]) {
      assert.ok(color && contrast(over(color, theme.colors.background), theme.colors.background) >= 4.5 - 1e-9, theme.id);
    }
  }
});
