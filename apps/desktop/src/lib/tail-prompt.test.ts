import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDigest, parseAnswer } from "./tail-prompt.ts";

// The seam: what leaves the app in a beat. A sidenote, a type Reads on leaves out, or a candidate
// about one must never be sent; a body goes once per thread.
test("a beat sends summaries and changed bodies, never what tail may not read", async () => {
  const page = (id: string, typeId: string, title: string, properties: Record<string, unknown> = {}) => ({ id, typeId, title, properties, createdAt: 1, updatedAt: 10 });
  const bodies: Record<string, string> = { A: "Beans along the south fence", T: "Is gravel really needed?", S: "Sam swears by March compost" };
  const input = {
    trigger: "beat" as const,
    now: 20,
    pages: [page("A", "page", "Garden plan"), page("T", "page", "Thoughts", { role: "thoughts", parent: "A" }), page("S", "person", "Sam")],
    readsOn: (t: string) => t !== "person",
    typeName: (t: string) => t,
    since: 5,
    seen: {},
    text: async (id: string) => bodies[id],
    candidates: [{ id: "left:A", kind: "left", pages: ["A"] }, { id: "left:S", kind: "left", pages: ["S"], facts: { last: "Sam swears by" } }],
  };
  const first = await buildDigest(input);
  assert.match(first.message, /Garden plan.*Beans along the south fence/);
  assert.doesNotMatch(first.message, /gravel|Thoughts|Sam/);
  assert.equal(JSON.parse(first.message).candidates.length, 1);
  const again = await buildDigest({ ...input, seen: first.seen });
  assert.match(again.message, /Garden plan/);
  assert.doesNotMatch(again.message, /Beans/);
});

// The seam: the model's answer. Words that aren't JSON, an unknown id or a wrong slot must be
// silence for that line, never a crash or a line built on a bad slot.
test("a wrong answer is silence; a right one keeps its slots", () => {
  const candidates = [{ id: "ideas:G", kind: "ideas", pages: ["I"], guess: { project: "G" } }, { id: "day:K", kind: "day", pages: ["K"], guess: { day: "Friday" } }];
  const o = { refs: { c1: "ideas:G", c2: "day:K", p1: "G", p2: "H", p3: "I" }, candidates, max: 3, isProject: (id: string) => id === "G" || id === "H" };
  assert.deepEqual(parseAnswer("Here are a few things worth a look.", o), []);
  assert.deepEqual(parseAnswer('{"show":"c1"}', o), []);
  assert.deepEqual(parseAnswer('```json\n{"show":[{"id":"c9"},{"id":"c1","project":"p2"},{"id":"c2","day":"someday"}]}\n```', o), [{ id: "ideas:G", slots: { project: "H" } }]);
  assert.deepEqual(parseAnswer('{"show":[{"id":"c1","project":"p3"},{"id":"c2"}]}', o), [{ id: "day:K", slots: { day: "Friday" } }]);
});
