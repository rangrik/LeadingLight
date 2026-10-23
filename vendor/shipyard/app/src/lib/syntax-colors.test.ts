// node --experimental-strip-types --test src/lib/syntax-colors.test.ts (pnpm test)
import assert from "node:assert/strict";
import { test } from "node:test";

import { builtinThemes } from "../themes/builtin.ts";
import { syntaxThemes } from "../themes/apply.ts";
import { contrast, over } from "../themes/color.ts";
import { readableStyles, readableTokens, type ShikiTheme, styleFor, syntaxColors } from "./syntax-colors.ts";

const theme: ShikiTheme = {
  fg: "#eeeeee",
  settings: [
    { settings: { foreground: "#eeeeee" } },
    { scope: "keyword", settings: { foreground: "#ff0000" } },
    { scope: ["keyword.control.import", "storage.type"], settings: { foreground: "#00ff00" } },
    { scope: "comment", settings: { foreground: "#888888", fontStyle: "italic" } },
    { scope: "string, constant.other.symbol", settings: { foreground: "#ffff00" } },
    { scope: "meta.embedded string", settings: { foreground: "#123456" } },
  ],
};

test("the most specific rule wins", () => {
  assert.equal(styleFor(theme, "keyword.control.import.ts")?.color, "#00ff00");
  assert.equal(styleFor(theme, "keyword.control.flow.ts")?.color, "#ff0000");
  assert.equal(styleFor(theme, "keywords")?.color, undefined);
});

test("rules in a context the editor can't see are left out", () => {
  assert.equal(styleFor(theme, "string.quoted")?.color, "#ffff00");
});

test("roles fall back through their scopes, then to plain text", () => {
  const s = syntaxColors(theme);
  assert.equal(s.module.color, "#00ff00");
  assert.equal(s.control.color, "#ff0000");
  assert.equal(s.comment.color, "#888888");
  assert.equal(s.comment.italic, true);
  assert.equal(s.tag.color, "#eeeeee");
});

// Every built-in theme, with the Shiki theme its diffs use: the text reads,
// every role has a colour that stands off the background (light themes'
// own palettes keep some colours soft, as their diffs show them), and
// keywords, strings and comments are told apart.
test("every built-in theme's code colours resolve and read", async () => {
  const { resolveTheme } = (await import("@pierre/diffs")) as { resolveTheme: (n: string) => Promise<ShikiTheme> };
  assert.equal(builtinThemes.length, 23);
  for (const t of builtinThemes) {
    const pair = syntaxThemes(t);
    const shiki = await resolveTheme(t.appearance === "dark" ? pair.dark : pair.light);
    const s = syntaxColors(shiki);
    const bg = t.colors.background;
    assert.ok(contrast(over(s.text.color!, bg), bg) >= 4, `${t.id} text`);
    for (const role of ["keyword", "string", "comment", "function", "type", "number", "property", "tag"]) {
      const c = s[role].color;
      assert.ok(c, `${t.id} ${role}`);
      assert.ok(contrast(over(c!, bg), bg) >= 2, `${t.id} ${role} ${c} on ${bg}: ${contrast(over(c!, bg), bg).toFixed(2)}`);
    }
    const distinct = new Set([s.keyword.color, s.string.color, s.comment.color].map((c) => c!.toLowerCase().slice(0, 7)));
    assert.equal(distinct.size, 3, `${t.id}: keyword ${s.keyword.color}, string ${s.string.color}, comment ${s.comment.color}`);
  }
});

// The colours code is drawn in read on the theme's background, 4.5:1 (WCAG
// AA): each is the Shiki theme's own, a shade darker or lighter where it
// falls short, and one that reads already is left alone.
test("every built-in theme's code colours read at 4.5:1 once made readable", async () => {
  const { resolveTheme } = (await import("@pierre/diffs")) as { resolveTheme: (n: string) => Promise<ShikiTheme> };
  for (const t of builtinThemes) {
    const pair = syntaxThemes(t);
    const shiki = await resolveTheme(t.appearance === "dark" ? pair.dark : pair.light);
    const raw = syntaxColors(shiki);
    const bg = t.colors.background;
    const s = readableStyles(raw, bg);
    for (const [role, st] of Object.entries(s)) {
      if (!st.color) continue;
      const c = contrast(over(st.color, bg), bg);
      assert.ok(c >= 4.5 - 1e-9, `${t.id} ${role} ${st.color} on ${bg}: ${c.toFixed(2)}`);
      if (contrast(over(raw[role].color!, bg), bg) >= 4.5) assert.equal(st.color, raw[role].color, `${t.id} ${role} kept`);
    }
  }
  const html = '<span style="--diffs-token-dark:#636363;--diffs-token-light:#636363">(</span>';
  assert.ok(contrast(readableTokens(html, "#1d1e22").match(/#[0-9a-f]{6}/i)![0], "#1d1e22") >= 4.5);
});
