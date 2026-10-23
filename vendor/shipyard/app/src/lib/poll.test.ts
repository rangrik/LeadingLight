// node --experimental-strip-types --test src/lib/poll.test.ts (pnpm test)
import assert from "node:assert/strict";
import { mock, test } from "node:test";

// A page to poll from: timers on node's mock clock, and a visibility the
// test sets.
const listeners = new Set<() => void>();
const doc = {
  hidden: false,
  addEventListener: (_: string, fn: () => void) => void listeners.add(fn),
  removeEventListener: (_: string, fn: () => void) => void listeners.delete(fn),
};
const g = globalThis as unknown as { window: unknown; document: unknown };
g.document = doc;
g.window = globalThis;
const setHidden = (h: boolean) => {
  doc.hidden = h;
  listeners.forEach((f) => f());
};

const { poll } = await import("./poll.ts");

// Lets the poller's awaits settle between ticks.
const settle = () => new Promise((r) => setImmediate(r));
async function advance(ms: number, step = 100) {
  for (let t = 0; t < ms; t += step) {
    mock.timers.tick(step);
    await settle();
  }
}

test.afterEach(() => {
  mock.timers.reset();
  doc.hidden = false;
});

test("nothing new backs off to max; something new goes back to every", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const at: number[] = [];
  let changed = false;
  const p = poll(() => (at.push(Date.now()), changed), { every: 1000, max: 8000 });
  await settle();
  await advance(2000 + 4000 + 8000 + 8000);
  const gaps = at.slice(1).map((t, i) => t - at[i]);
  assert.deepEqual(gaps, [2000, 4000, 8000, 8000]);
  changed = true;
  at.length = 0;
  await advance(8000 + 1000 + 1000);
  assert.deepEqual(at.slice(1).map((t, i) => t - at[i]), [1000, 1000]);
  p.stop();
  mock.timers.reset();
});

test("hidden, it stops; shown again, it looks at once", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let n = 0;
  const p = poll(() => void n++, { every: 1000 });
  await settle();
  assert.equal(n, 1);
  setHidden(true);
  await advance(60_000, 1000);
  assert.equal(n, 1, "no looks while hidden");
  setHidden(false);
  await settle();
  assert.equal(n, 2, "a look on coming back");
  await advance(1000);
  assert.equal(n, 3);
  p.stop();
  await advance(5000, 1000);
  assert.equal(n, 3, "none after stop");
  mock.timers.reset();
});

test("hidden can keep a slow look", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let n = 0;
  const p = poll(() => void n++, { every: 1000, hidden: 30_000 });
  await settle();
  setHidden(true);
  await advance(1000);
  const before = n;
  await advance(60_000, 1000);
  assert.ok(n - before <= 2 && n - before >= 1, `a look every 30s while hidden (${n - before})`);
  setHidden(false);
  p.stop();
  mock.timers.reset();
});

test("kick looks now and starts the backing off again from every", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let n = 0;
  const p = poll(() => (n++, false), { every: 1000, max: 16_000 });
  await settle();
  await advance(1000 + 2000 + 4000);
  const was = n;
  p.kick();
  await settle();
  assert.equal(n, was + 1);
  await advance(1900);
  assert.equal(n, was + 1, "nothing new: twice every");
  await advance(100);
  assert.equal(n, was + 2, "not the 16s it had reached");
  p.stop();
  mock.timers.reset();
});
