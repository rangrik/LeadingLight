import assert from "node:assert/strict";
import { test } from "node:test";
import { linkUnderHeading } from "./doc-links.ts";

// Seam: the stored body of a daily note. Catches a second "Ideas" heading, or a bullet landing
// at the end when the heading was moved.
const text = (t: string) => ({ type: "text", text: t });
const heading = (t: string) => ({ type: "heading", attrs: { level: 3 }, content: [text(t)] });
const para = (t: string) => ({ type: "paragraph", content: [text(t)] });

test("the first idea adds the heading and list at the end; the next joins the list", () => {
  const one = linkUnderHeading(null, "Ideas", [text("a")]);
  assert.deepEqual(one.content?.map((n) => n.type), ["heading", "bulletList"]);
  const two = linkUnderHeading(one, "Ideas", [text("b")]);
  assert.equal(two.content?.filter((n) => n.type === "heading").length, 1);
  assert.equal(two.content?.[1].content?.length, 2);
});

test("a moved heading keeps its list; its bullets never go to the end", () => {
  const doc = { type: "doc", content: [heading("ideas"), para("Plans")] };
  const out = linkUnderHeading(doc, "Ideas", [text("c")]);
  assert.deepEqual(out.content?.map((n) => n.type), ["heading", "bulletList", "paragraph"]);
});
