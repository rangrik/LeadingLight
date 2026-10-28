import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
const modulePath = `/@fs${resolve("../../packages/editor/src/grammar-review.ts")}`;
async function load(page: Page) {
  await page.evaluate(async (path) => {
    (window as any).__grammar = await import(path);
  }, modulePath);
}
async function start(page: Page, inline = false) {
  if (inline) await page.addInitScript(() => localStorage.setItem("ll.writing", JSON.stringify({ grammar: true, grammarMode: "inline" })));
  await page.goto("/");
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await load(page);
}
async function ready(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const w = window as any;
    const result = w.__grammar.collectGrammarIssues(w.__editor);
    return result.pending ? "pending" : result.error ?? "ready";
  }), { timeout: 15000 }).toBe("ready");
}

// Seam: WASM ranges and replacements must match rich text, including emoji and undo.
test("Grammar corrections keep emoji offsets, formatting, and undo boundaries", async ({ page }) => {
  await start(page);
  await page.evaluate(() => (window as any).__editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: [
    { type: "text", text: "🙂 I " }, { type: "text", text: "recieved", marks: [{ type: "bold" }] }, { type: "text", text: " the letter." },
  ] }] }));
  await ready(page);
  const r = await page.evaluate(() => {
    const w = window as any, original = w.__editor.getJSON();
    const issue = w.__grammar.collectGrammarIssues(w.__editor).issues.find((i: any) => i.original === "recieved");
    const applied = w.__grammar.applyGrammarIssue(w.__editor, issue, "received"), changed = w.__editor.getJSON();
    w.__editor.commands.undo();
    return { original, applied, changed, undone: w.__editor.getJSON(), from: issue.from };
  });
  expect(r.from).toBe(6);
  expect(r.applied).toBe(true);
  expect(r.changed.content[0].content[1]).toEqual({ type: "text", text: "received", marks: [{ type: "bold" }] });
  expect(r.undone).toEqual(r.original);
});

// Seam: stale actions cannot edit new content, and keeping one occurrence cannot suppress another.
test("Grammar rejects stale suggestions and keeps only the chosen occurrence", async ({ page }) => {
  await start(page, true);
  await page.evaluate(() => {
    const w = window as any, editor = w.__editor;
    editor.commands.setContent("<p>She have a plan.</p>");
    editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, editor.state.doc.firstChild));
  });
  await ready(page);
  const r = await page.evaluate(() => {
    const w = window as any;
    const issues = w.__grammar.collectGrammarIssues(w.__editor).issues.filter((i: any) => i.rule === "PronounVerbAgreement");
    const kept = w.__grammar.keepGrammarIssue(w.__editor, issues[0]);
    const underlineCount = w.__editor.view.dom.querySelectorAll(".ll-grammar").length;
    const left = w.__grammar.collectGrammarIssues(w.__editor).issues.filter((i: any) => i.rule === "PronounVerbAgreement");
    w.__editor.commands.insertContentAt(1, "Now ");
    const before = w.__editor.getJSON(), applied = w.__grammar.applyGrammarIssue(w.__editor, left[0], "has");
    return { kept, underlineCount, left: left.length, applied, before, after: w.__editor.getJSON() };
  });
  expect(r.kept).toBe(true); expect(r.underlineCount).toBe(1); expect(r.left).toBe(1); expect(r.applied).toBe(false); expect(r.after).toEqual(r.before);
});

// Seam: dictionary changes invalidate cached checks and persist independently of note content.
test("Personal words clear suggestions and remain after reload", async ({ page }) => {
  await start(page);
  const seed = () => page.evaluate(() => (window as any).__editor.commands.setContent("<p>I use Splindlefroop daily.</p>"));
  const flagged = () => page.evaluate(() => (window as any).__grammar.collectGrammarIssues((window as any).__editor).issues.some((i: any) => i.original === "Splindlefroop"));
  await seed(); await ready(page); expect(await flagged()).toBe(true);
  await page.evaluate(() => (window as any).__grammar.addGrammarWord("Splindlefroop"));
  await ready(page); expect(await flagged()).toBe(false);
  await page.reload(); await page.getByRole("textbox", { name: "Page body" }).waitFor(); await load(page);
  expect(await page.evaluate(() => (window as any).__grammar.grammarWords())).toContain("Splindlefroop");
  await seed(); await ready(page); expect(await flagged()).toBe(false);
  await page.evaluate(() => (window as any).__grammar.removeGrammarWord("Splindlefroop"));
  await ready(page); expect(await flagged()).toBe(true);
});

// Seam: code and cited source words are not the writer's prose.
test("Grammar review skips code and cited words", async ({ page }) => {
  await start(page);
  await page.evaluate(() => (window as any).__editor.commands.setContent({ type: "doc", content: [
    { type: "codeBlock", content: [{ type: "text", text: "recieved" }] },
    { type: "paragraph", content: [{ type: "text", text: "recieved", marks: [{ type: "code" }] }] },
    { type: "paragraph", content: [{ type: "text", text: "recieved", marks: [{ type: "cited", attrs: { id: "source" } }] }] },
    { type: "paragraph", content: [{ type: "text", text: "I recieved the letter." }] },
  ] }));
  await ready(page);
  expect(await page.evaluate(() => (window as any).__grammar.collectGrammarIssues((window as any).__editor).issues.filter((i: any) => i.original === "recieved"))).toHaveLength(1);
});
