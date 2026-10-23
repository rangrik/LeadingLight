// node --experimental-strip-types --test src/lib/terminal.test.ts (pnpm test)
import assert from "node:assert/strict";
import { test } from "node:test";

import { fallbackDetails } from "./terminal.ts";

// A fallback to xterm.js is copied as details someone can send: the error,
// its stack, and the page's origin (tauri://localhost in a release build).
test("a ghostty-web failure's details say what failed and where", () => {
  (globalThis as { location?: unknown }).location = { origin: "tauri://localhost" };
  const err = new TypeError("WebAssembly.compile(): refused by Content Security Policy");
  const text = fallbackDetails(err);
  assert.match(text, /^ghostty-web failed to start: TypeError: WebAssembly\.compile\(\): refused/);
  assert.match(text, /origin: tauri:\/\/localhost/);
  assert.match(text, /user agent: /);
  assert.ok(text.includes(err.stack!.split("\n")[1]!.trim()), "the stack is there");
  assert.match(fallbackDetails("plain words"), /Error: plain words/);
});
