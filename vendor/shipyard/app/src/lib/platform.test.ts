import assert from "node:assert/strict";
import { test } from "node:test";

import { platformKeys } from "./platform.ts";

test("a Mac keeps its symbols", () => {
  assert.equal(platformKeys("⌘⇧D", true), "⌘⇧D");
});

test("Linux spells the keys out, Ctrl first", () => {
  const linux = (s: string) => platformKeys(s, false);
  assert.equal(linux("⌘K"), "Ctrl+K");
  assert.equal(linux("⌘⇧D"), "Ctrl+Shift+D");
  assert.equal(linux("⌘⌥I"), "Ctrl+Alt+I");
  assert.equal(linux("⌃⇧⇥"), "Ctrl+Shift+Tab");
  assert.equal(linux("⌘↵"), "Ctrl+Enter");
  assert.equal(linux("⌘1–9"), "Ctrl+1–9");
  assert.equal(linux("⌘⌥ ←↑→↓"), "Ctrl+Alt+←↑→↓");
  assert.equal(linux("Search (⌘K)"), "Search (Ctrl+K)");
  assert.equal(linux("Open beside the chat · ⌘-click"), "Open beside the chat · Ctrl-click");
  assert.equal(linux("⌥-click to peek"), "Alt-click to peek");
  assert.equal(linux("Or ⌘+ and ⌘− with a terminal focused; ⌘0 resets it."), "Or Ctrl++ and Ctrl+− with a terminal focused; Ctrl+0 resets it.");
  assert.equal(linux("F2"), "F2");
  assert.equal(linux("↵"), "↵");
});
