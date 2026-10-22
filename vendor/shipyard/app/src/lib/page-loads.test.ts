// node --experimental-strip-types --test src/lib/page-loads.test.ts (pnpm test)
import assert from "node:assert/strict";
import { test } from "node:test";

import { initialPageLoads, LOOP_GAP_MS, type PageEvent, type PageLoads, pageEvent, reloadLoop, settle, UNCONFIRMED_MS } from "./page-loads.ts";

const page = "http://web.cal.cal.localhost:1377/auth/login";
const run = (events: PageEvent[], from: PageLoads = initialPageLoads) => events.reduce(pageEvent, from);

test("a page load spins from its start to its finish", () => {
  let s = run([{ kind: "user", at: 0 }]);
  assert.equal(s.loading, true);
  s = run([{ kind: "started", url: page, at: 1 }, { kind: "committed", url: page, at: 300 }], s);
  assert.equal(s.loading, true);
  s = pageEvent(s, { kind: "finished", url: page, at: 900 });
  assert.equal(s.loading, false);
});

test("an iframe added after the page finished does not spin forever", () => {
  // WebKit asks the navigation policy for frames too, and a frame's load
  // never commits or finishes the page.
  let s = run([{ kind: "committed", url: page, at: 0 }, { kind: "finished", url: page, at: 500 }, { kind: "started", url: "https://widget.example/frame", at: 2000 }]);
  assert.equal(s.loading, true);
  assert.equal(settle(s, 2000 + UNCONFIRMED_MS - 1).loading, true);
  s = settle(s, 2000 + UNCONFIRMED_MS);
  assert.equal(s.loading, false);
});

test("a link followed in the page keeps spinning once the page commits", () => {
  let s = run([{ kind: "committed", url: page, at: 0 }, { kind: "finished", url: page, at: 500 }, { kind: "started", url: page + "/next", at: 1000 }, { kind: "committed", url: page + "/next", at: 1500 }]);
  s = settle(s, 1000 + UNCONFIRMED_MS * 2);
  assert.equal(s.loading, true);
});

test("one reload by the page is not a loop (Next.js 16.3 dev after a redirect, in WebKit)", () => {
  const s = run([
    { kind: "user", at: 0 },
    { kind: "committed", url: page, at: 1200 },
    { kind: "committed", url: page, at: 2700 },
    { kind: "finished", url: page, at: 9000 },
  ]);
  assert.equal(reloadLoop(s), undefined);
});

test("a page that keeps reloading itself is noticed", () => {
  const loads: PageEvent[] = [0, 5000, 10_000, 15_000].map((at) => ({ kind: "committed", url: page, at }));
  assert.equal(reloadLoop(run(loads.slice(0, 3))), undefined);
  assert.deepEqual(reloadLoop(run(loads)), { url: page, count: 4 });
  // A hash is the same page.
  assert.deepEqual(reloadLoop(run([...loads.slice(0, 3), { kind: "committed", url: page + "#top", at: 15_000 }])), { url: page, count: 4 });
});

test("loads you asked for, other pages, and slow repeats are not a loop", () => {
  const at = (n: number) => n * 5000;
  const c = (n: number, url = page): PageEvent => ({ kind: "committed", url, at: at(n) });
  // Reload pressed in between.
  assert.equal(reloadLoop(run([c(0), c(1), { kind: "user", at: at(2) }, c(2), c(3)])), undefined);
  // Another address in between.
  assert.equal(reloadLoop(run([c(0), c(1), c(2, page + "/other"), c(3)])), undefined);
  // Saving a file now and then, far apart.
  assert.equal(reloadLoop(run([0, 1, 2, 3].map((n) => ({ kind: "committed", url: page, at: n * (LOOP_GAP_MS + 1) }) as PageEvent))), undefined);
});

test("Back in a single-page app never finishes, and does not spin forever", () => {
  let s = run([{ kind: "committed", url: page, at: 0 }, { kind: "finished", url: page, at: 500 }, { kind: "step", at: 1000 }]);
  assert.equal(s.loading, true);
  s = settle(s, 1000 + UNCONFIRMED_MS);
  assert.equal(s.loading, false);
  assert.equal(s.streak, undefined);
});

test("the notice goes once the page stops reloading itself", () => {
  const loads: PageEvent[] = [0, 5000, 10_000, 15_000].map((at) => ({ kind: "committed", url: page, at }));
  const s = run([...loads, { kind: "finished", url: page, at: 18_000 }]);
  assert.ok(reloadLoop(settle(s, 15_000 + LOOP_GAP_MS)));
  assert.equal(reloadLoop(settle(s, 15_000 + LOOP_GAP_MS + 1)), undefined);
  // Still loading: still looping, as far as anyone can tell.
  assert.ok(reloadLoop(settle(run(loads), 60_000)));
});
