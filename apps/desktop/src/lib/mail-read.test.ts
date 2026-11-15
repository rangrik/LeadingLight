import { test } from "node:test";
import assert from "node:assert/strict";
import { readAnswer } from "./mail-read.ts";

const now = new Date(2026, 10, 14, 15, 2).getTime();
const ids = new Map([["m1", "meera"], ["r1", "amazon"]]);
const good = { id: "m1", verdict: "quick", headline: "Meera wants to move Thursday's review to 4 pm", happened: "She has a clash.", stands: "She holds 4 pm.", part: "Say yes.", due: "today", upset: false, replies: [{ label: "4 pm works", text: "Hi Meera,\n\n4 pm works.\n\nPranav" }], task: { title: "Not for a quick answer", ack: "x" } };
const answer = (mails: object[], rest: object[] = []) => JSON.stringify({ mails, rest });

// Seam: mail is written by strangers; nothing it makes the model say may become a verdict,
// a draft over the limit, or markup on screen.
test("the reader's answer is checked strictly", () => {
  const read = readAnswer(`Here you go: ${answer([good], [{ id: "r1", group: "Receipts", needs: true }])}`, ids, now)!;
  assert.deepEqual(read.meera.lines, { verdict: "quick", headline: good.headline, happened: good.happened, stands: good.stands, part: good.part, due: "2026-11-14", upset: false, replies: good.replies });
  assert.deepEqual([read.amazon.group, read.amazon.needs], ["Receipts", true]);
  for (const bad of ["not json", "[]", answer([{ ...good, id: "m9" }]), answer([{ ...good, id: "r1" }]), answer([{ ...good, verdict: "urgent" }]), answer([{ ...good, headline: "x".repeat(91) }]), answer([{ ...good, happened: "<img src=x onerror=alert(1)>" }]), answer([{ ...good, stands: 42 }])])
    assert.equal(readAnswer(bad, ids, now)?.meera, undefined, bad);
  const drafts = (replies: object[]) => readAnswer(answer([{ ...good, replies }]), ids, now)!.meera.lines!.replies;
  assert.deepEqual(drafts([{ label: "Long", text: "word ".repeat(60) }, { label: "Far too long a label here", text: "ok" }, { label: "Link", text: "See https://evil.test" }, { label: "Tag", text: "<b>hi</b>" }, { label: "Ok", text: "Fine." }, { label: "More", text: "Also fine." }, { label: "Third", text: "Dropped." }]), [{ label: "Ok", text: "Fine." }, { label: "More", text: "Also fine." }]);
  const upset = readAnswer(answer([{ ...good, upset: true, tone: "Meera is upset." }]), ids, now)!.meera.lines!;
  assert.deepEqual([upset.upset, upset.tone], [false, undefined]);
  assert.equal(readAnswer(answer([{ ...good, verdict: "none", part: "Reply now!" }]), ids, now)!.meera.lines!.part, "Nothing.");
  assert.equal(readAnswer(answer([], [{ id: "r1", group: "Spam" }]), ids, now)?.amazon, undefined);
});
