// node --experimental-strip-types --test src/lib/term-output.test.ts (pnpm test)
import assert from "node:assert/strict";
import { test } from "node:test";

import { type Chunk, OutputGate } from "./term-output.ts";

// A clock the test moves by hand.
function fakeClock() {
  let id = 0;
  const due = new Map<number, () => void>();
  return {
    set: (fn: () => void) => (due.set(++id, fn), id),
    clear: (n: number) => void due.delete(n),
    fire() {
      const fns = [...due.values()];
      due.clear();
      fns.forEach((f) => f());
    },
    get pending() {
      return due.size;
    },
  };
}

const text = (c: Chunk) => (typeof c === "string" ? c : new TextDecoder().decode(c));

test("shown, output goes straight through", () => {
  const got: Chunk[] = [];
  const gate = new OutputGate((d) => got.push(d), fakeClock());
  gate.write("a");
  gate.write("b");
  assert.deepEqual(got, ["a", "b"]);
});

test("hidden, output waits and goes in one piece, in order", () => {
  const got: Chunk[] = [];
  const clock = fakeClock();
  const gate = new OutputGate((d) => got.push(d), clock);
  gate.setOpen(false);
  gate.write("one ");
  gate.write(new TextEncoder().encode("två "));
  gate.write("three");
  assert.equal(got.length, 0);
  assert.equal(clock.pending, 1, "one timer for the batch");
  clock.fire();
  assert.equal(got.length, 1);
  assert.equal(text(got[0]), "one två three");
});

test("showing again hands over what waits before anything new", () => {
  const got: string[] = [];
  const clock = fakeClock();
  const gate = new OutputGate((d) => got.push(text(d)), clock);
  gate.setOpen(false);
  gate.write("old ");
  gate.write("lines ");
  gate.setOpen(true);
  gate.write("new");
  assert.deepEqual(got, ["old lines ", "new"]);
  assert.equal(clock.pending, 0, "no timer left behind");
});

test("a lot of hidden output goes in at once rather than piling up", () => {
  const got: Chunk[] = [];
  const gate = new OutputGate((d) => got.push(d), fakeClock(), 1000, 10);
  gate.setOpen(false);
  gate.write("12345");
  assert.equal(got.length, 0);
  gate.write("67890");
  assert.equal(got.length, 1);
  assert.equal(gate.pending, 0);
});

test("a reset drops what waits: the screen and history are cleared anyway", () => {
  const got: Chunk[] = [];
  const clock = fakeClock();
  const gate = new OutputGate((d) => got.push(d), clock);
  gate.setOpen(false);
  gate.write("stale");
  gate.reset();
  assert.equal(clock.pending, 0);
  gate.setOpen(true);
  assert.deepEqual(got, []);
});

test("UTF-8 split across packets joins whole", () => {
  const got: Chunk[] = [];
  const clock = fakeClock();
  const gate = new OutputGate((d) => got.push(d), clock);
  const bytes = new TextEncoder().encode("✻ done");
  gate.setOpen(false);
  gate.write(bytes.slice(0, 2));
  gate.write(bytes.slice(2));
  clock.fire();
  assert.equal(text(got[0]), "✻ done");
});

test("an infinite wait hands over only on showing, or once a lot waits", () => {
  const got: Chunk[] = [];
  const clock = fakeClock();
  const gate = new OutputGate((d) => got.push(d), clock, Infinity, 10);
  gate.setOpen(false);
  gate.write("12345");
  assert.equal(clock.pending, 0, "no timer");
  gate.setOpen(true);
  assert.deepEqual(got.map(text), ["12345"]);
  gate.setOpen(false);
  gate.write("1234567890");
  assert.equal(got.length, 2, "over the limit: now");
});
