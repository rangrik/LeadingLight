import assert from "node:assert/strict";
import { test } from "node:test";
import { browserAddress, browserSuggestions, clearBrowserHistory, emptyBrowserData, readBrowserData, rememberVisit } from "./browser-data.ts";

// The address boundary must never navigate executable URLs or persist credentials.
test("addresses distinguish local sites, public sites, searches and unsafe schemes", () => {
  assert.equal(browserAddress("localhost:1420/path?q=1"), "http://localhost:1420/path?q=1");
  assert.equal(browserAddress("[::1]:3000"), "http://[::1]:3000/");
  assert.equal(browserAddress("example.com/path"), "https://example.com/path");
  assert.equal(browserAddress("two search words"), "https://duckduckgo.com/?q=two%20search%20words");
  for (const input of ["javascript:alert(1)", "data:text/html,hello", "file:///tmp/test", "https://a:b@example.com", "https://", "https://example.com\n/path"]) assert.throws(() => browserAddress(input), input);
});

// Selective clearing must not erase open tabs, bookmarks or visits outside its time window.
test("history clearing respects the exact time boundary and suggestions keep safe original addresses", () => {
  const now = 10 * 86400000;
  const entry = (time: number, url = "https://example.com/useful") => ({ title: "A useful page", url, time });
  const data = { ...emptyBrowserData(), history: [entry(now), entry(now - 3600000), entry(now - 3600001)], bookmarks: [entry(now)], tabs: [{ ...entry(now), name: "user-test" }] };
  const cleared = clearBrowserHistory(data, "hour", now);
  assert.deepEqual(cleared.history, [data.history[2]]);
  assert.equal(cleared.bookmarks, data.bookmarks);
  assert.equal(cleared.tabs, data.tabs);
  assert.equal(clearBrowserHistory(data, "all", now).history.length, 0);
  const history = [entry(now, "javascript:alert(1)"), entry(now), ...Array.from({ length: 10 }, (_, i) => entry(now, `https://example.com/${i}`))];
  assert.equal(browserSuggestions(history, "USEFUL").length, 8);
  assert.equal(browserSuggestions(history, "USEFUL")[0].url, "https://example.com/useful");
  assert.deepEqual(browserSuggestions(history, "  "), []);
  assert.deepEqual(browserSuggestions(history, "unknown"), []);
});

// Remounting a saved tab must not undo history removal; a real revisit must still record it.
test("restoring tab metadata preserves cleared history until navigation", () => {
  const visited = rememberVisit(emptyBrowserData(), "user-one", "https://example.com/", "Example");
  const cleared = clearBrowserHistory(visited, "all");
  assert.equal(rememberVisit(cleared, "user-one", "https://example.com/", "Example", false), cleared);
  const renamed = rememberVisit(cleared, "user-one", "https://example.com/", "New title", false);
  assert.equal(renamed.tabs[0].title, "New title");
  assert.equal(renamed.history.length, 0);
  assert.equal(rememberVisit(renamed, "user-one", "https://example.com/", "New title").history.length, 1);
  visited.history[0].time = 1;
  assert.ok(rememberVisit(visited, "user-one", "https://example.com/", "Example").history[0].time > 1);
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
  assert.equal(rememberVisit(visited, "user-one", "https://example.com/two", "Two", false), visited);
  let full = emptyBrowserData();
  for (let i = 0; i < 24; i++) full = rememberVisit(full, `user-${i}`, `https://example.com/${i}`, String(i));
  assert.equal(readBrowserData(JSON.stringify(full)).tabs.length, 24);
});
