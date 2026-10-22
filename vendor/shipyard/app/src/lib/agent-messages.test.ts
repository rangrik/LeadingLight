// node --experimental-strip-types --test src/lib/agent-messages.test.ts (pnpm test)
import assert from "node:assert/strict";
import { test } from "node:test";

import type { TranscriptItem } from "@/lib/transcript";
import { foldPings, needsYou, overScreen, senderColor, teammatesOf, type PingItem, withoutReminders } from "./agent-messages.ts";

const ping = (id: string, status: string, at?: number): PingItem => ({ kind: "ping", id, msg: { from: { id: "b", name: "Background command", kind: "harness" }, status, summary: id, at } });
const text = (id: string): TranscriptItem => ({ kind: "text", id, text: id });

test("successes next to each other fold; a failure always shows on its own", () => {
  const rows: TranscriptItem[] = [ping("a", "done", 1000), ping("b", "done", 2000), ping("c", "done", 3000), ping("x", "failed", 3500), ping("d", "done", 4000), text("t"), ping("e", "done", 5000)];
  const out = foldPings<TranscriptItem | { kind: "group"; ids: string[] }>(rows, (r) => (r.kind === "ping" ? r : undefined), (run) => ({ kind: "group", ids: run.map((p) => p.id) }));
  assert.deepEqual(
    out.map((r) => (r.kind === "group" ? r.ids.join("+") : r.id)),
    ["a+b+c", "x", "d", "t", "e"],
  );
});

test("successes far apart don't fold", () => {
  const out = foldPings<TranscriptItem | { kind: "group" }>([ping("a", "done", 0), ping("b", "done", 10 * 60_000)], (r) => (r.kind === "ping" ? r : undefined), () => ({ kind: "group" }));
  assert.equal(out.length, 2);
});

test("only an unanswered question from a teammate or another session needs you", () => {
  const q = { from: { id: "x", name: "x", kind: "teammate" as const }, intent: "question" as const };
  assert.equal(needsYou(q), true);
  assert.equal(needsYou({ ...q, answered: true }), false);
  assert.equal(needsYou({ ...q, from: { ...q.from, kind: "session" } }), true);
  assert.equal(needsYou({ ...q, from: { ...q.from, kind: "helper" } }), false);
  assert.equal(needsYou({ ...q, intent: "update" }), false);
});

test("senders keep their colours: the lead orange, a teammate its own, helpers by crew order", () => {
  assert.equal(senderColor({ id: "l", name: "Lead", kind: "lead" }), "orange");
  assert.equal(senderColor({ id: "s", name: "schema-review", kind: "teammate", color: "blue" }), "sky");
  const h = (i: number) => senderColor({ id: `h${i}`, name: `Helper ${i}`, kind: "helper" }, i);
  assert.deepEqual([0, 1, 2, 3].map(h), ["violet", "pink", "lime", "rose"]);
});

test("teammates are listed once each, with their latest message", () => {
  const items: TranscriptItem[] = [
    { kind: "agent-message", id: "1", msg: { from: { id: "export-job", name: "export-job", kind: "teammate", color: "green" }, intent: "update", summary: "Reads mapped" } },
    { kind: "agent-message", id: "2", msg: { from: { id: "lead", name: "Lead", kind: "lead" }, intent: "instruction", body: "Hold" } },
    { kind: "agent-message", id: "3", msg: { from: { id: "export-job", name: "export-job", kind: "teammate", color: "green" }, intent: "question", body: "Switch now?" } },
  ];
  const t = teammatesOf(items);
  assert.equal(t.length, 1);
  assert.deepEqual([t[0].name, t[0].last, t[0].lastId, t[0].open, t[0].count], ["export-job", "Switch now?", "3", true, 2]);
});

test("a report longer than about a screen is over it", () => {
  assert.equal(overScreen("short"), false);
  assert.equal(overScreen(Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n")), true);
});

test("reminders an older box left in a prompt don't show", () => {
  assert.equal(withoutReminders("Fix it\n\n<system-reminder>\nUse the task tools.\n</system-reminder>"), "Fix it");
  assert.equal(withoutReminders("<system-reminder>x</system-reminder>"), "");
  assert.equal(withoutReminders("plain"), "plain");
});
