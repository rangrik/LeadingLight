// node --experimental-strip-types --test src/lib/wheel.test.ts (pnpm test)
import assert from "node:assert/strict";
import { test } from "node:test";

import { endsFrame, WheelBatcher, type WheelClock, type WheelOptions, wheelPixels, wheelReport } from "./wheel.ts";

// A clock the test moves by hand: frames run when frame() is called,
// timers when the time passes them.
function fakeClock() {
  let now = 0;
  let frames: (() => void)[] = [];
  let timers: { at: number; fn: () => void }[] = [];
  const clock: WheelClock = {
    now: () => now,
    frame(fn) {
      frames.push(fn);
      return () => (frames = frames.filter((f) => f !== fn));
    },
    later(fn, ms) {
      const t = { at: now + ms, fn };
      timers.push(t);
      return () => (timers = timers.filter((x) => x !== t));
    },
  };
  return {
    clock,
    // Runs the frames waiting now.
    frame() {
      const run = frames;
      frames = [];
      for (const f of run) f();
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        now = due.at;
        timers = timers.filter((t) => t !== due);
        due.fn();
      }
      now = end;
    },
    pending: () => frames.length + timers.length,
  };
}

const UP = wheelReport(true, 10, 5);
const DOWN = wheelReport(false, 10, 5);
const REDRAW = "x".repeat(3000) + "\x1b[?2026l";

function setup(options: Partial<WheelOptions> = {}) {
  const c = fakeClock();
  const sent: string[] = [];
  const b = new WheelBatcher((d) => sent.push(d), c.clock, { window: 1, ...options });
  return { c, sent, b };
}

const count = (s: string, report: string) => s.split(report).length - 1;

test("a lone notch goes at once; a trackpad's stream, one batch a frame", () => {
  const { c, sent, b } = setup({ window: 2 });
  for (let i = 0; i < 10; i++) b.wheel(-20, 10, 5);
  assert.deepEqual(sent, [UP]);
  c.frame();
  assert.deepEqual(sent, [UP, UP.repeat(4)]);
});

test("a notch a frame after the last batch goes at once too", () => {
  const { c, sent, b } = setup({ window: 2 });
  b.wheel(40, 10, 5);
  c.advance(16);
  b.wheel(40, 10, 5);
  assert.deepEqual(sent, [DOWN, DOWN]);
});

test("one report per 40px; the rest is kept for later", () => {
  const { c, sent, b } = setup();
  b.wheel(39, 10, 5);
  c.frame();
  assert.deepEqual(sent, []);
  b.wheel(1, 10, 5);
  c.frame();
  assert.deepEqual(sent, [DOWN]);
});

test("lines and pages are turned into pixels", () => {
  assert.equal(wheelPixels({ deltaY: 3, deltaMode: 1 }, 800), 48);
  assert.equal(wheelPixels({ deltaY: -1, deltaMode: 2 }, 800), -800);
  assert.equal(wheelPixels({ deltaY: 12.5, deltaMode: 0 }, 800), 12.5);
});

test("the next batch waits for the last one's redraw", () => {
  const { c, sent, b } = setup();
  b.wheel(-80, 10, 5);
  c.frame();
  assert.equal(sent.length, 1);
  b.wheel(-120, 10, 5);
  c.frame();
  c.frame();
  assert.equal(sent.length, 1, "nothing more while the redraw is on its way");
  c.advance(30);
  b.output(REDRAW);
  c.frame();
  assert.deepEqual(sent, [UP.repeat(2), UP.repeat(3)], "what piled up goes in one batch");
});

test("a cursor blink is not a redraw", () => {
  const { c, sent, b } = setup();
  b.wheel(40, 10, 5);
  c.frame();
  b.wheel(40, 10, 5);
  b.output("\x1b[?2026h\x1b[?25l\x1b[?25h\x1b[?2026l");
  c.frame();
  assert.equal(sent.length, 1);
});

test("a redraw that arrives in pieces counts once its last piece is in", () => {
  const { c, sent, b } = setup();
  b.wheel(40, 10, 5);
  c.frame();
  b.wheel(40, 10, 5);
  b.output(new TextEncoder().encode("\x1b[?2026h" + "y".repeat(2000)));
  c.frame();
  assert.equal(sent.length, 1);
  b.output(new TextEncoder().encode("z".repeat(500) + "\x1b[?2026l"));
  c.frame();
  assert.equal(sent.length, 2);
});

test("without a synchronized update, output going quiet ends the redraw", () => {
  const { c, sent, b } = setup({ quiet: 16 });
  b.wheel(40, 10, 5);
  c.frame();
  b.wheel(40, 10, 5);
  c.frame();
  c.advance(20);
  b.output("w".repeat(3000));
  c.advance(10);
  c.frame();
  assert.equal(sent.length, 1, "still arriving");
  c.advance(10);
  c.frame();
  assert.equal(sent.length, 2);
});

test("output that never goes quiet holds the next batch only so long", () => {
  const { c, sent, b } = setup({ quiet: 16, busy: 150 });
  b.wheel(40, 10, 5);
  c.frame();
  b.wheel(40, 10, 5);
  for (let t = 0; t < 140; t += 10) {
    b.output("s".repeat(600));
    c.advance(10);
    c.frame();
  }
  assert.equal(sent.length, 1);
  b.output("s".repeat(600));
  c.advance(20);
  c.frame();
  assert.equal(sent.length, 2);
});

test("no redraw at all (the top of the view) lets the next batch go after the timeout", () => {
  const { c, sent, b } = setup({ timeout: 200 });
  b.wheel(-40, 10, 5);
  c.frame();
  b.wheel(-40, 10, 5);
  c.frame();
  c.advance(199);
  c.frame();
  assert.equal(sent.length, 1);
  c.advance(1);
  c.frame();
  assert.equal(sent.length, 2);
});

test("two batches may be in flight, not three", () => {
  const { c, sent, b } = setup({ window: 2 });
  b.wheel(40, 10, 5);
  c.frame();
  b.wheel(40, 10, 5);
  c.frame();
  b.wheel(40, 10, 5);
  c.frame();
  assert.equal(sent.length, 2);
  b.output(REDRAW);
  c.frame();
  assert.equal(sent.length, 3);
});

test("output going quiet lands every batch in flight", () => {
  const { c, sent, b } = setup({ window: 2, quiet: 16 });
  b.wheel(40, 10, 5);
  c.advance(20);
  b.wheel(40, 10, 5);
  b.wheel(40, 10, 5);
  c.frame();
  assert.equal(sent.length, 2);
  b.output("w".repeat(6000));
  c.advance(20);
  c.frame();
  assert.equal(sent.length, 3);
  b.wheel(40, 10, 5);
  c.frame();
  assert.equal(sent.length, 4, "the window is free again, not waiting on the timeout");
});

test("a batch holds at most maxBatch reports, and the rest follows", () => {
  const { c, sent, b } = setup({ maxBatch: 4, maxOwed: 100 });
  b.wheel(400, 10, 5);
  c.frame();
  assert.deepEqual(sent, [DOWN.repeat(4)]);
  b.output(REDRAW);
  c.frame();
  b.output(REDRAW);
  c.frame();
  assert.deepEqual(sent, [DOWN.repeat(4), DOWN.repeat(4), DOWN.repeat(2)]);
});

test("what a stalled box is owed is capped", () => {
  const { c, sent, b } = setup({ maxBatch: 4, maxOwed: 6, timeout: 1000 });
  b.wheel(-40 * 4, 10, 5);
  c.frame();
  for (let i = 0; i < 50; i++) b.wheel(-40, 10, 5);
  c.advance(1000);
  c.frame();
  c.advance(1000);
  c.frame();
  c.advance(1000);
  c.frame();
  const total = sent.reduce((n, s) => n + count(s, UP), 0);
  assert.equal(total, 4 + 6);
});

test("turning back drops what was owed the other way", () => {
  const { c, sent, b } = setup();
  b.wheel(-40, 10, 5);
  c.frame();
  b.wheel(-200, 10, 5);
  b.wheel(80, 10, 5);
  b.output(REDRAW);
  c.frame();
  assert.deepEqual(sent, [UP, DOWN.repeat(2)]);
});

test("reports carry the cell under the pointer", () => {
  const { c, sent, b } = setup();
  b.wheel(40, 3, 7);
  c.frame();
  assert.deepEqual(sent, ["\x1b[<65;3;7M"]);
});

test("nothing is sent after dispose", () => {
  const { c, sent, b } = setup();
  b.wheel(40, 10, 5);
  b.wheel(40, 10, 5);
  b.dispose();
  b.output(REDRAW);
  c.frame();
  b.wheel(40, 10, 5);
  c.frame();
  assert.deepEqual(sent, [DOWN]);
  assert.equal(c.pending(), 0);
});

test("endsFrame reads text and bytes", () => {
  assert.ok(endsFrame("abc\x1b[?2026l"));
  assert.ok(!endsFrame("abc\x1b[?2026h"));
  assert.ok(endsFrame(new TextEncoder().encode("abc\x1b[?2026l")));
  assert.ok(!endsFrame(new TextEncoder().encode("l")));
});
