import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPrompt } from "./ask-prompt.ts";

// The seam a person hit: on a resumed session only the question reaches Claude, so a
// mentioned note or an edited note must ride in the question, and only when new.
test("context rides in the question only when the thread hasn't seen it", () => {
  const note = { id: "n", title: "Cells", text: "The cell." };
  const first = buildPrompt({ seen: {}, note, pages: [], agent: null, quote: "cell", question: "What is it?" });
  assert.match(first.prompt, /The note, "Cells":\n-----\nThe cell\.\n-----\n\n> cell\n\nWhat is it\?$/);

  const same = buildPrompt({ seen: first.seen, note, pages: [], agent: null, quote: null, question: "Shorter" });
  assert.equal(same.prompt, "Shorter");

  const more = buildPrompt({
    seen: same.seen,
    note: { ...note, text: "The cell wall." },
    pages: [{ id: "g", title: "Glossary", text: "Wall: a layer." }],
    agent: "Be strict.",
    quote: null,
    question: "And now?",
  });
  assert.match(more.prompt, /as it is now:\n-----\nThe cell wall\./);
  assert.match(more.prompt, /Another note, "Glossary":\n-----\nWall: a layer\./);
  assert.match(more.prompt, /follow these instructions:\nBe strict\./);
  assert.equal(buildPrompt({ ...{ seen: more.seen, note: { ...note, text: "The cell wall." }, pages: [{ id: "g", title: "Glossary", text: "Wall: a layer." }], agent: "Be strict." }, quote: null, question: "Again" }).prompt, "Again");
});
