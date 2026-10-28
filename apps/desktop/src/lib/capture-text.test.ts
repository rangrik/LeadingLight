import assert from "node:assert/strict";
import { test } from "node:test";
import { readText } from "./capture-text.ts";

// Seam: what the box's text is. Catches an address saved as an idea, words lost beside an
// address, an unsafe address slipping through as a link, and a half-typed address making a page.
test("an address, words, words with an address, and an address being typed", () => {
  assert.deepEqual(readText(" https://example.com/soil-guide "), { kind: "address", url: "https://example.com/soil-guide", words: "" });
  assert.deepEqual(readText("soil test kit"), { kind: "words", url: null, words: "soil test kit" });
  assert.deepEqual(readText("https://example.com/soil-guide good for the beds"), { kind: "words", url: "https://example.com/soil-guide", words: "good for the beds" });
  assert.deepEqual(readText("javascript:alert(1)"), { kind: "address", url: null, words: "javascript:alert(1)" });
  assert.equal(readText("see https://user:pw@example.com").url, null);
  assert.equal(readText("http").kind, "maybe");
  assert.equal(readText("https://").kind, "maybe");
  assert.equal(readText("hello").kind, "words");
});
