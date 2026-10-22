// node --experimental-strip-types --test src/lib/draft-text.test.ts (pnpm test)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { caretAfter, type Draft, type DraftRead, mergeDraft, rowKeyOf, settledBy, wasSettled, withDraft, wordsOf } from "./draft-text.ts";
import type { TranscriptItem } from "./transcript.ts";

// fixtures/draft-reads-*.json are what the box's draft reader (internal/box
// draft.go) made of every frame of Claude Code's screen as it answered a
// synthetic prompt, captured every 250ms; the .final.md files are the
// replies its transcript got.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const reads = (name: string): DraftRead[] => JSON.parse(fixture(`draft-reads-${name}.json`));

let n = 0;
const id = () => `d${++n}`;

function play(seq: DraftRead[]): Draft[] {
  const out: Draft[] = [];
  let d: Draft | undefined;
  for (const r of seq) {
    d = mergeDraft(d, r, id);
    if (d) out.push(d);
  }
  return out;
}

test("a reply taller than the screen keeps its start as it scrolls away", () => {
  const drafts = play(reads("lighthouses"));
  const last = drafts[drafts.length - 1];
  // One reply throughout: one id, so one row.
  assert.equal(new Set(drafts.map((d) => d.id)).size, 1);
  assert.equal(last.clipped, false);
  assert.ok(last.text.startsWith("# How Lighthouses Work\n\nLighthouses are one of humanity"));
  assert.ok(last.text.endsWith("protect maritime travelers during fog and storms."));
  // Word for word the reply, but for the code block's language.
  assert.equal(wordsOf(last.text), wordsOf(fixture("lighthouses.final.md").replace("```python", "```")));
});

test("a reply first seen already off the top shows its end, and keeps what it saw", () => {
  const seq = reads("tidechart");
  // The first read was the last turn's reply, still on screen; then a tool.
  assert.equal(seq[1].text, "");
  const drafts = play(seq.slice(2));
  const last = drafts[drafts.length - 1];
  assert.equal(new Set(drafts.map((d) => d.id)).size, 1);
  assert.equal(last.clipped, true);
  const final = wordsOf(fixture("tidechart.final.md").replace("```javascript", "```"));
  assert.ok(final.includes(wordsOf(last.text)), "only the reply's words, in order");
  // It holds more than the last screen did: what scrolled off stays.
  assert.ok(last.text.length > seq[seq.length - 1].text.length);
  assert.ok(last.text.startsWith(seq[2].text.split("\n")[0]));
});

test("a new reply is a new draft", () => {
  const a = mergeDraft(undefined, { text: "First, the plan for the release." }, id)!;
  const grown = mergeDraft(a, { text: "First, the plan for the release. Then the checks." }, id)!;
  assert.equal(grown.id, a.id);
  const other = mergeDraft(grown, { text: "All green: the branch is ready." }, id)!;
  assert.notEqual(other.id, a.id);
  assert.equal(mergeDraft(other, { text: "  " }, id), undefined);
});

test("a clipped read with nowhere to meet is its end alone", () => {
  const a = mergeDraft(undefined, { text: "Tide pools are small windows into the ocean." }, id)!;
  const b = mergeDraft(a, { text: "Sculpins are small mottled fish that dart between rocks.", clipped: true }, id)!;
  assert.equal(b.id, a.id);
  assert.equal(b.clipped, true);
  assert.equal(b.text, "Sculpins are small mottled fish that dart between rocks.");
});

test("one paragraph taller than the screen joins where its lines meet", () => {
  const a = mergeDraft(undefined, { text: "Tides change gradually, not in a straight line. The water moves slowly just after a high" }, id)!;
  const b = mergeDraft(a, { text: "The water moves slowly just after a high or low, then speeds up through the middle.", clipped: true }, id)!;
  assert.equal(b.text, "Tides change gradually, not in a straight line. The water moves slowly just after a high or low, then speeds up through the middle.");
  assert.equal(b.clipped, false);
});

const items = (...texts: string[]): TranscriptItem[] => [{ kind: "user", id: "u1", text: "Write it up" }, ...texts.map((text, i) => ({ kind: "text" as const, id: `t${i}`, text }))];

test("the transcript's message settles a draft drawn differently", () => {
  const final = "## Reading a Tide Chart\n\nA tide chart looks *intimidating* at first, but it boils down to `H` and `L`.\n\n| Station | Height |\n|---|---|\n| Bell Rock | 115 |";
  assert.equal(settledBy("## Reading a Tide Chart\n\nA tide chart looks intimidating at first, but it", items(final))?.id, "t0");
  // A clipped draft starts mid-way.
  assert.equal(settledBy("| Station | Height |\n|---|---|\n| Bell", items(final))?.id, "t0");
  assert.equal(settledBy("Something else entirely, said later on.", items(final)), undefined);
  // Too few words to tell.
  assert.equal(settledBy("Ok", items("Ok then")), undefined);
});

test("the message takes the draft's row, and the draft never shows again", () => {
  const draft: Draft = { id: "draft:x1", text: "Done. A repeated webhook now finds the order by its", clipped: false };
  const before = withDraft(items("I'll trace the webhook."), draft);
  assert.equal(before.drafting, true);
  const shown = before.items[before.items.length - 1];
  assert.deepEqual(shown, { kind: "text", id: "draft:x1", text: draft.text, live: true, clipped: false });

  const final = "Done. A repeated webhook now finds the order by its **idempotency key** and returns it.";
  const after = withDraft(items("I'll trace the webhook.", final), draft);
  assert.equal(after.drafting, false);
  assert.equal(after.items.length, 3);
  assert.equal(rowKeyOf("t1"), "draft:x1");
  assert.equal(rowKeyOf("t0"), "t0");
  assert.ok(wasSettled("draft:x1"));
  // The screen still shows those words into the next turn: no draft.
  assert.equal(withDraft([{ kind: "user", id: "u2", text: "Thanks" }], draft).drafting, false);
});

test("the caret follows the last words, wherever they are", () => {
  const c = "<i></i>";
  assert.equal(caretAfter("<p>One</p>\n<p>Two</p>\n", c), "<p>One</p>\n<p>Two<i></i></p>\n");
  assert.equal(caretAfter("<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n", c), "<ul>\n<li>a</li>\n<li>b<i></i></li>\n</ul>\n");
  assert.equal(caretAfter('<div class="cv-pre"><pre><code>x = 1\n</code></pre></div>', c), '<div class="cv-pre"><pre><code>x = 1<i></i>\n</code></pre></div>');
  assert.equal(caretAfter("<table><tr><td>115</td></tr></table>", c), "<table><tr><td>115<i></i></td></tr></table>");
});

test("after the transcript took a draft, a reply first seen cut off is a new draft", () => {
  const a = mergeDraft(undefined, { text: "Judge v2 agrees with people on 91% of the samples." }, id)!;
  withDraft(items("Judge v2 agrees with people on 91% of the samples, up from 84%."), a);
  assert.ok(wasSettled(a.id));
  const b = mergeDraft(a, { text: "the rest were refusals the old rubric always marked down.", clipped: true }, id)!;
  assert.notEqual(b.id, a.id);
  assert.equal(withDraft(items("Judge v2 agrees with people on 91% of the samples, up from 84%."), b).drafting, true);
});
