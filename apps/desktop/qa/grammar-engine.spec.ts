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
async function ready(page: Page, scope?: { from: number; to: number }) {
  await expect.poll(() => page.evaluate((scope) => {
    const w = window as any;
    const result = w.__grammar.collectGrammarIssues(w.__editor, scope);
    return result.pending ? "pending" : result.error ?? "ready";
  }, scope), { timeout: 15000 }).toBe("ready");
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

// Seam: quiet counts must not check outside a passage, and corrections must stay inside it.
test("Passage review skips outside paragraphs and partly selected words", async ({ page }) => {
  await start(page);
  const ranges = await page.evaluate(() => {
    const editor = (window as any).__editor;
    editor.commands.setContent("<p>I definately agree.</p><p>I recieved a apple.</p><p>I accomodate guests.</p>");
    const blocks: { from: number; to: number; text: string }[] = [];
    editor.state.doc.forEach((block: any, pos: number) => blocks.push({ from: pos + 1, to: pos + 1 + block.content.size, text: block.textContent }));
    return { blocks, scope: { from: blocks[1].from, to: blocks[2].from } };
  });
  await expect(page.getByRole("button", { name: "Counts", exact: true })).toContainText("10 words");
  await ready(page, ranges.scope);
  const result = await page.evaluate(async ({ blocks, scope, path }) => {
    const w = window as any;
    const grammar = await import(path.replace("grammar-review.ts", "grammar.ts"));
    const outsideUncached = [blocks[0], blocks[2]].map(block => grammar.mistakesIn(block.text) === undefined);
    const word = { from: blocks[1].from + 2, to: blocks[1].from + 10 };
    return {
      outsideUncached,
      all: w.__grammar.collectGrammarIssues(w.__editor, scope).issues.map((i: any) => i.original),
      word: w.__grammar.collectGrammarIssues(w.__editor, word).issues.map((i: any) => i.original),
      partial: w.__grammar.collectGrammarIssues(w.__editor, { from: word.from + 1, to: word.to }).issues,
      empty: w.__grammar.collectGrammarIssues(w.__editor, { from: word.from, to: word.from }),
    };
  }, { ...ranges, path: modulePath });
  expect(result.outsideUncached).toEqual([true, true]);
  expect(result.all).toContain("recieved");
  expect(result.all).toContain("a");
  expect(result.word).toEqual(["recieved"]);
  expect(result.partial).toEqual([]);
  expect(result.empty).toEqual({ issues: [], pending: false, error: null });
});

// Seam: mapping keeps correction insertions but excludes neighboring typing and deleted scopes.
test("Passage mapping includes its correction and never widens after deletion", async ({ page }) => {
  await start(page);
  await page.evaluate(() => (window as any).__editor.commands.setContent("<p>I ate a apple.</p>"));
  await ready(page, { from: 7, to: 8 });
  const result = await page.evaluate(() => {
    const w = window as any, editor = w.__editor, api = w.__grammar;
    let scope = { from: 7, to: 8 };
    const before = scope;
    const track = ({ transaction }: any) => { scope = api.mapGrammarRange(scope, transaction); };
    editor.on("transaction", track);
    const issue = api.collectGrammarIssues(editor, scope).issues.find((i: any) => i.original === "a");
    const applied = api.applyGrammarIssue(editor, issue, "an");
    const corrected = { scope, text: editor.state.doc.textBetween(scope.from, scope.to) };
    editor.commands.undo();
    scope = before;
    const undone = editor.state.doc.textBetween(scope.from, scope.to);
    editor.view.dispatch(editor.state.tr.insertText("left ", scope.from));
    editor.view.dispatch(editor.state.tr.insertText(" right", scope.to));
    const boundaries = editor.state.doc.textBetween(scope.from, scope.to);
    editor.view.dispatch(editor.state.tr.delete(scope.from, scope.to).insertText("outside", scope.from));
    const deleted = scope;
    const empty = api.collectGrammarIssues(editor, scope);
    editor.view.dispatch(editor.state.tr.insertText("more", scope.from));
    const stillEmpty = scope;
    editor.off("transaction", track);
    return { applied, corrected, undone, boundaries, deleted, empty, stillEmpty };
  });
  expect(result.applied).toBe(true);
  expect(result.corrected).toEqual({ scope: { from: 7, to: 9 }, text: "an" });
  expect(result.undone).toBe("a");
  expect(result.boundaries).toBe("a");
  expect(result.deleted.from).toBe(result.deleted.to);
  expect(result.empty).toEqual({ issues: [], pending: false, error: null });
  expect(result.stillEmpty.from).toBe(result.stillEmpty.to);
});
