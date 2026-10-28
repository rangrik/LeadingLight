import assert from "node:assert/strict";
import { test } from "node:test";
import { browserAddress, emptyBrowserData, readBrowserData, rememberVisit } from "./browser-data.ts";

// The address boundary must never navigate executable URLs or persist credentials.
test("addresses distinguish local sites, public sites, searches and unsafe schemes", () => {
  assert.equal(browserAddress("localhost:1420/path?q=1"), "http://localhost:1420/path?q=1");
  assert.equal(browserAddress("[::1]:3000"), "http://[::1]:3000/");
  assert.equal(browserAddress("example.com/path"), "https://example.com/path");
  assert.equal(browserAddress("two search words"), "https://duckduckgo.com/?q=two%20search%20words");
  for (const input of ["javascript:alert(1)", "data:text/html,hello", "file:///tmp/test", "https://a:b@example.com", "https://", "https://example.com\n/path"]) assert.throws(() => browserAddress(input), input);
});

// Restore must survive corrupt storage and never restore an agent's isolated tab.
test("restore filters unsafe and malformed data and keeps only personal tabs", () => {
  assert.deepEqual(readBrowserData("{"), emptyBrowserData());
  const entry = { url: "https://example.com/", title: "Example", time: 1 };
  const data = readBrowserData(JSON.stringify({ tabs: [{ ...entry, name: "agent-1" }, { ...entry, name: "user-one" }, { ...entry, name: "user-one" }], bookmarks: [{ ...entry, url: "javascript:alert(1)" }, entry], history: "invalid" }));
  assert.deepEqual(data.tabs, [{ ...entry, name: "user-one" }]);
  assert.deepEqual(data.bookmarks, [entry]);
  assert.deepEqual(data.history, []);
  const visited = rememberVisit(data, "user-one", "https://example.com/two", "Two");
  assert.equal(visited.tabs.length, 1);
  assert.equal(visited.history[0].title, "Two");
  assert.equal(rememberVisit(visited, "user-one", "https://example.com/two", "Two"), visited);
  let full = emptyBrowserData();
  for (let i = 0; i < 24; i++) full = rememberVisit(full, `user-${i}`, `https://example.com/${i}`, String(i));
  assert.equal(readBrowserData(JSON.stringify(full)).tabs.length, 24);
});
