import assert from "node:assert/strict";
import { test } from "node:test";
import { docMarkdown, plainWords } from "./page-markdown.ts";

// The seam an edit crosses: Claude copies words from the Markdown it read, and the editor finds
// plain words, one line per block. Any line of the Markdown, its marks taken off, must match.
test("Markdown read from a page maps back to the page's words", () => {
  const t = (text: string, marks?: string[]) => ({ type: "text", text, marks: marks?.map((type) => ({ type })) });
  const p = (...content: object[]) => ({ type: "paragraph", content });
  const doc = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [t("Cells")] },
      p(t("The "), t("mitochondria", ["bold"]), t(" is the "), t("powerhouse", ["italic"]), t(".")),
      { type: "bulletList", content: [{ type: "listItem", content: [p(t("Wall"))] }, { type: "listItem", content: [p(t("Membrane"), t(" first", ["code"]))] }] },
      { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [p(t("Read it"))] }] },
      { type: "blockquote", content: [p(t("Life is "), { ...t("cells"), marks: [{ type: "link", attrs: { href: "https://x.org" } }] })] },
    ],
  };
  const md = docMarkdown(doc);
  assert.equal(md, "## Cells\n\nThe **mitochondria** is the *powerhouse*.\n\n- Wall\n- Membrane` first`\n\n- [x] Read it\n\n> Life is [cells](https://x.org)");
  assert.equal(plainWords(md), "Cells\nThe mitochondria is the powerhouse.\nWall\nMembrane first\nRead it\nLife is cells");
});
