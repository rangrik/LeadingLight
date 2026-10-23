// node --experimental-strip-types --test src/lib/processes.test.ts (pnpm test)
import assert from "node:assert/strict";
import { test } from "node:test";

import { type BoxBrowser, age, busy, cpu, memory, memoryNote, summary } from "./processes.ts";

const b = (over: Partial<BoxBrowser>): BoxBrowser => ({ id: "b-1-1", engine: "Headless Chromium", owner: "session", label: "Playwright tests in acme/checkout", pid: 1, pids: [1], processes: 1, cpu_percent: 0, memory: 0, stoppable: true, ...over });

test("cpu is a share of one core", () => {
  assert.equal(cpu(480.4), "480%");
  assert.equal(cpu(0.43), "0.4%");
  assert.equal(cpu(0), "0%");
  assert.equal(cpu(undefined), "0%");
});

test("age is short", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  assert.equal(age("2026-10-08T11:59:20Z", now), "40s");
  assert.equal(age("2026-10-08T11:48:00Z", now), "12m");
  assert.equal(age("2026-10-08T09:00:00Z", now), "3h");
  assert.equal(age("2026-10-05T12:00:00Z", now), "3d");
  assert.equal(age(undefined, now), "");
});

test("memory drops a .0", () => {
  assert.equal(memory(12 * 2 ** 30), "12 GB");
  assert.equal(memory(11.8 * 2 ** 30), "11.8 GB");
  assert.equal(memory(640 * 2 ** 20), "640 MB");
});

test("summary and busy", () => {
  assert.equal(summary([]), "No browsers running");
  const list = [b({ cpu_percent: 480, memory: 2 ** 30 }), b({ owner: "agent", cpu_percent: 2, memory: 400 * 2 ** 20 })];
  assert.equal(summary(list), "2 browsers · 1.4 GB · 482% CPU");
  assert.equal(busy(list[0]), true);
  assert.equal(busy(list[1]), false);
  assert.equal(busy(b({ owner: "orphan" })), true);
});

test("a session near its ceiling says so; one without a ceiling never does", () => {
  assert.equal(memoryNote({ memory: 11.8 * 2 ** 30, memory_high: 12 * 2 ** 30, near_limit: true, cpu_s: 1 }), "using 11.8 GB, near its 12 GB limit");
  assert.equal(memoryNote({ memory: 3 * 2 ** 30, memory_high: 12 * 2 ** 30, cpu_s: 1 }), undefined);
  assert.equal(memoryNote({ memory: 3 * 2 ** 30, near_limit: true, cpu_s: 1 }), undefined);
  assert.equal(memoryNote(undefined), undefined);
});
