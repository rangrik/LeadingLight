import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDigest, noteIn, parseAnswer, stillTrue } from "./tail-prompt.ts";

const page = (id: string, typeId: string, title: string, properties: Record<string, unknown> = {}) => ({ id, typeId, title, properties, createdAt: 1, updatedAt: 10 });

// The seam: what leaves the app in a beat. A sidenote, a type Reads on leaves out, or a candidate
// about one must never be sent; a body goes once per thread.
test("a beat sends summaries and changed bodies, never what tail may not read", async () => {
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

// The same seam for a chip and the capture guess: no body at all. Reads on governs words, not
// names: a pause may name a Person page by its title, but never offer a line written on one.
test("a pause names every page but sends no body; a capture nothing tail may not read", async () => {
  const pages = [page("A", "page", "Garden plan"), page("S", "person", "Sam", { description: "Grows beans" })];
  const input = { now: 20, pages, readsOn: (t: string) => t !== "person", typeName: (t: string) => t, since: 0, seen: {}, text: async () => "Beans along the south fence" };
  const pause = await buildDigest({ ...input, trigger: "pause", candidates: [{ id: "mention:A", kind: "mention", pages: ["A", "S"] }, { id: "task:S", kind: "task", pages: ["S"] }] });
  const m = JSON.parse(pause.message);
  assert.deepEqual(m.candidates.map((c: { kind: string }) => c.kind), ["mention"]);
  assert.deepEqual(m.pages.find((p: { title: string }) => p.title === "Sam"), { ref: "p2", title: "Sam", type: "person" });
  assert.doesNotMatch(pause.message, /Beans/);
  const capture = await buildDigest({ ...input, trigger: "capture", candidates: [{ id: "capture", kind: "capture", pages: [], guess: { project: "S" } }] });
  assert.equal(JSON.parse(capture.message).candidates.length, 0);
});

// The seam: a beat held while Today was in front. What the records no longer find must not come
// back (the ideas filed since), and what they still find keeps the model's slots.
test("a held choice keeps only what is still found", () => {
  const ideas = { id: "ideas:G", kind: "ideas", pages: ["I", "J"], facts: { ideas: 3 } };
  const day = { id: "day:K", kind: "day", pages: ["K"], guess: { day: "Friday" } };
  const held = [ideas, day].map((found) => ({ found, slots: { day: "Monday" } }));
  assert.deepEqual(stillTrue(held, [{ ...ideas, pages: ["J"] }, day]), [{ found: day, slots: { day: "Monday" } }]);
});

// The seam: the model's answer. Words that aren't JSON, an unknown id or a wrong slot must be
// silence for that line, never a crash or a line built on a bad slot.
test("a wrong answer is silence; a right one keeps its slots", () => {
  const candidates = [{ id: "ideas:G", kind: "ideas", pages: ["I"], guess: { project: "G" } }, { id: "day:K", kind: "day", pages: ["K"], guess: { day: "Friday" } }, { id: "capture", kind: "capture", pages: [], guess: { project: "" } }];
  const o = { refs: { c1: "ideas:G", c2: "day:K", c3: "capture", p1: "G", p2: "H", p3: "I" }, candidates, max: 3, isProject: (id: string) => id === "G" || id === "H" };
  assert.deepEqual(parseAnswer("Here are a few things worth a look.", o), []);
  assert.deepEqual(parseAnswer('{"show":"c1"}', o), []);
  assert.deepEqual(parseAnswer('```json\n{"show":[{"id":"c9"},{"id":"c1","project":"p2"},{"id":"c2","day":"someday"}]}\n```', o), [{ id: "ideas:G", slots: { project: "H" } }]);
  assert.deepEqual(parseAnswer('{"show":[{"id":"c1","project":"p3"},{"id":"c2"}]}', o), [{ id: "day:K", slots: { day: "Friday" } }]);
  // A slot left empty is the model's to fill; left empty, there is no line.
  assert.deepEqual(parseAnswer('{"show":[{"id":"c3"}]}', o), []);
  assert.deepEqual(parseAnswer('{"show":[{"id":"c3","project":"p2"}]}', o), [{ id: "capture", slots: { project: "H" } }]);
});

// The seam: what the model may write on the page about the person. Anything but one plain
// sentence of at most twelve words must be dropped, never written.
test("a note is one plain sentence, else none", () => {
  assert.equal(noteIn('{"show":[],"note":"Most ideas go to Garden."}'), "Most ideas go to Garden.");
  for (const note of ["Ideas go to Garden. Tasks wait.", "**Ideas** go to Garden.", "Ideas go to Garden!", "one two three four five six seven eight nine ten eleven twelve thirteen.", "Ideas\ngo.", 3])
    assert.equal(noteIn(JSON.stringify({ show: [], note })), undefined, String(note));
});
