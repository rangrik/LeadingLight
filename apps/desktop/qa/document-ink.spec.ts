import { expect, test, type Locator, type Page } from "@playwright/test";
import type { EditorDoc } from "@leadinglight/editor/editor";
import type { ObjectStore } from "../src/lib/store";

const body = (page: Page) => page.getByRole("textbox", { name: "Page body", exact: true });
const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const phrase = "the target phrase that extends to another line";
const sentence = `Remember ${phrase} as you read.`;
const inkPaths = (root: Locator) => root.locator(".ll-ink-overlay [data-ink-stroke]");
const stored = (page: Page, id: string) => page.evaluate(async (id) => (await import("/src/lib/" + "objects.ts")).objects.get(id), id);
const live = (page: Page, id: string) => page.evaluate(async (id) => (await import("/src/lib/" + "live.ts")).liveEditor(id)!.getJSON(), id);
const save = async (page: Page) => {
  await page.keyboard.press("Meta+s");
  await page.evaluate(async () => { await (await import("/src/lib/" + "saving.ts")).flushAll(); });
};

async function create(page: Page, content: EditorDoc[] = [paragraph(sentence), paragraph("The second paragraph stays below."), paragraph("Last paragraph.")]) {
  await page.goto("/?ipad");
  await page.getByRole("button", { name: "New page", exact: true }).first().click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Document ink QA");
  await page.getByRole("textbox", { name: "Title", exact: true }).press("Enter");
  const id = (await page.locator("[data-pane-page]:visible").getAttribute("data-pane-page"))!;
  await page.evaluate(async ({ id, content }) => {
    const { editPage } = await import("/src/lib/" + "live.ts");
    await editPage(id, { typeId: "book", content: () => ({ type: "doc", content }), properties: (p: Record<string, unknown>) => ({ ...p, description: "Original reading metadata", custom: { retained: true } }) });
    await (await import("/src/lib/" + "saving.ts")).flushAll();
  }, { id, content });
  await expect(body(page)).toBeVisible();
  return id;
}

async function textBox(root: Locator, text: string) {
  return root.evaluate((el, text) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let all = "", node: Node | null;
    while ((node = walker.nextNode())) { nodes.push(node as Text); all += node.textContent; }
    const start = all.indexOf(text);
    if (start < 0) throw new Error(`Missing phrase: ${text}`);
    const range = document.createRange();
    let offset = 0;
    for (const n of nodes) {
      const end = offset + n.length;
      if (start >= offset && start < end) range.setStart(n, start - offset);
      if (start + text.length > offset && start + text.length <= end) { range.setEnd(n, start + text.length - offset); break; }
      offset = end;
    }
    const r = range.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, text);
}

async function circle(page: Page, root: Locator, text = phrase) {
  await root.scrollIntoViewIfNeeded();
  const r = await textBox(root, text);
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  for (let i = 0; i <= 32; i++) {
    const angle = i * Math.PI / 16;
    await page.mouse.move(cx + (r.width / 2 + 5) * Math.cos(angle), cy + (r.height / 2 + 5) * Math.sin(angle));
    if (!i) await page.mouse.down();
  }
  await page.mouse.up();
  await expect.poll(async () => (await inkPaths(body(page)).last().boundingBox())?.width ?? 0).toBeGreaterThan(r.width * 0.8);
  expect((await inkPaths(body(page)).last().boundingBox())!.height).toBeGreaterThan(r.height * 0.8);
}

async function tool(page: Page, name: string, role: "menuitemradio" | "menuitemcheckbox" | "menuitem" = "menuitemradio") {
  await page.getByRole("button", { name: "Writing tools", exact: true }).click();
  await page.getByRole(role, { name, exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
}

async function blockMenu(page: Page, block: Locator, action: string) {
  await block.hover();
  await page.getByRole("button", { name: "Drag to move", exact: true }).click();
  await page.getByRole("menu", { name: "Block", exact: true }).getByRole("menuitem", { name: new RegExp(`^${action}`) }).click();
}

async function history(page: Page, item = "Page history") {
  await page.getByRole("button", { name: "Page actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "History and authorship", exact: true }).hover();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
  return page.getByRole("dialog", { name: "Page history", exact: true });
}

// Seam: a drawing mode is view state, never a conversion or a rewrite of an existing page.
test("enabling handwriting keeps a Book, its metadata and sidenote unchanged", async ({ page }) => {
  const id = await create(page);
  await body(page).locator("p").first().click();
  await page.keyboard.press("Meta+Shift+m");
  const note = page.getByRole("textbox", { name: "Sidenote 1", exact: true });
  await note.fill("The original thought remains.");
  await note.press("Meta+Enter");
  await save(page);
  const before = await stored(page, id);
  await page.getByRole("button", { name: "Write on this page", exact: true }).click();
  await expect(page.getByRole("button", { name: "Finish writing", exact: true })).toBeVisible();
  await expect(body(page)).toContainText(sentence);
  await expect(body(page).locator(".ll-annotated-block, .ll-handwriting")).toHaveCount(0);
  await page.getByRole("button", { name: "Finish writing", exact: true }).click();
  await expect(body(page)).not.toBeFocused();
  await save(page);
  expect(await stored(page, id)).toEqual(before);
  await page.reload();
  await expect(note).toHaveText("The original thought remains.");
  await expect(page.getByRole("textbox", { name: "Description", exact: true })).toHaveValue("Original reading metadata");
});

// Seam: text marks must follow edits before their words and stop overlaying changed or reflowed words.
test("a circle follows unchanged words and keeps original context when text changes", async ({ page }, testInfo) => {
  const id = await create(page);
  await page.getByRole("button", { name: "Write on this page", exact: true }).click();
  await circle(page, body(page).locator("p").first());
  const block = body(page).locator(".ll-annotated-block");
  await expect(inkPaths(block)).toHaveCount(1);
  await expect(inkPaths(block)).toBeInViewport();
  await page.getByRole("button", { name: "Finish writing", exact: true }).click();
  const before = (await inkPaths(block).boundingBox())!;
  await block.locator("p").first().click({ position: { x: 2, y: 10 } });
  await page.keyboard.press("Meta+ArrowLeft");
  await page.keyboard.type("New: ");
  await expect(block).toContainText(`New: ${sentence}`);
  await expect(block.locator(".ll-ink-review")).toHaveCount(0);
  expect((await inkPaths(block).boundingBox())!.x).toBeGreaterThan(before.x + 10);
  const words = await textBox(block.locator("p").first(), "target");
  await page.mouse.dblclick(words.x + words.width / 2, words.y + words.height / 2);
  await page.keyboard.type("changed");
  await expect(block.locator("p").first()).toHaveText(`New: ${sentence.replace("target", "changed")}`);
  await expect(block.locator(".ll-ink-review")).toBeVisible();
  await expect(block.locator(".ll-ink-review")).toContainText("target phrase");
  expect((await block.locator(".ll-ink-original").boundingBox())!.height).toBeGreaterThan(10);
  await page.screenshot({ path: testInfo.outputPath("changed-text-original-ink.png") });
  await page.keyboard.press("Meta+z");
  await expect(block.locator("p").first()).toContainText(phrase);
  await expect(block.locator(".ll-ink-review")).toHaveCount(0);
  await page.setViewportSize({ width: 500, height: 1000 });
  await expect(block.locator(".ll-ink-review")).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(block.locator(".ll-ink-review")).toHaveCount(0);
  await save(page);
  const expected = (await live(page, id)).content;
  await page.reload();
  await expect(inkPaths(body(page))).toHaveCount(1);
  expect((await stored(page, id))!.content!.content).toEqual(expected);
});

// Seam: drag, duplicate and delete operate on the complete annotated block, with independent undo.
test("moving and copying a drawn block carries its ink and editing a copy leaves the original", async ({ page }) => {
  await create(page, [paragraph("First block."), paragraph(sentence), paragraph("Last block.")]);
  await page.getByRole("button", { name: "Write on this page", exact: true }).click();
  await circle(page, body(page).locator("p").nth(1));
  await page.getByRole("button", { name: "Finish writing", exact: true }).click();
  const block = body(page).locator(".ll-annotated-block");
  await block.locator("p").hover();
  const handle = (await page.getByRole("button", { name: "Drag to move" }).boundingBox())!;
  const first = (await body(page).locator("p").first().boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(handle.x + 200, handle.y + ((first.y + 2 - handle.y) * i) / 10);
  await page.mouse.up();
  await expect(body(page).locator(":scope > :first-child .ll-annotated-block")).toHaveCount(1);
  await expect(inkPaths(block)).toBeInViewport();
  await blockMenu(page, block.locator("p"), "Duplicate");
  await expect(block).toHaveCount(2);
  await page.getByRole("button", { name: "Write on this page", exact: true }).click();
  await tool(page, "Eraser");
  const copyPath = (await inkPaths(block.nth(1)).boundingBox())!;
  await page.mouse.click(copyPath.x + copyPath.width - 2, copyPath.y + copyPath.height / 2);
  await expect(inkPaths(block.first())).toHaveCount(1);
  await expect(inkPaths(block.nth(1))).toHaveCount(0);
  await page.getByRole("button", { name: "Finish writing", exact: true }).click();
  await blockMenu(page, block.first().locator("p"), "Delete");
  await expect(inkPaths(body(page))).toHaveCount(0);
  await page.keyboard.press("Meta+z");
  await expect(inkPaths(body(page))).toHaveCount(1);
  await page.reload();
  await expect(inkPaths(body(page))).toHaveCount(1);
});

// Seam: a handwriting block reserves document space, grows at its bottom and returns to real text.
test("handwriting between paragraphs grows and continues typing in the same page", async ({ page }, testInfo) => {
  const id = await create(page, [paragraph("Before handwriting."), paragraph("After handwriting.")]);
  await body(page).locator("p").first().click();
  await page.getByRole("button", { name: "Write on this page", exact: true }).click();
  await tool(page, "Write below selected block", "menuitem");
  const paper = body(page).locator(".ll-handwriting");
  await expect(paper).toBeVisible();
  const before = (await paper.locator("[data-ink-space]").boundingBox())!;
  const afterY = (await body(page).locator("p").filter({ hasText: "After handwriting." }).boundingBox())!.y;
  await page.mouse.move(before.x + 50, before.y + before.height - 30);
  await page.mouse.down();
  await page.mouse.move(before.x + 170, before.y + before.height - 15, { steps: 12 });
  await page.mouse.up();
  await expect(inkPaths(paper)).toHaveCount(1);
  expect((await paper.locator("[data-ink-space]").boundingBox())!.height).toBeGreaterThan(before.height);
  expect((await body(page).locator("p").filter({ hasText: "After handwriting." }).boundingBox())!.y).toBeGreaterThan(afterY);
  await paper.getByRole("button", { name: "Continue typing", exact: true }).click();
  await expect(page.getByRole("button", { name: "Write on this page", exact: true })).toBeVisible();
  await page.keyboard.type("Typed between the drawing and the next paragraph.");
  await expect(body(page).locator(":scope > p")).toHaveText(["Before handwriting.", "Typed between the drawing and the next paragraph.", "After handwriting."]);
  await save(page);
  const doc = (await stored(page, id))!.content!;
  expect(doc.content!.map((node: EditorDoc) => node.type)).toContain("handwriting");
  await page.reload();
  await expect(inkPaths(body(page))).toHaveCount(1);
  await expect(body(page)).toContainText("After handwriting.");
  await body(page).locator(":scope > p").last().scrollIntoViewIfNeeded();
  await expect(inkPaths(body(page))).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("typed-ink-typed.png") });
});

// Seam: a failed document save must retain complete strokes for retry and readonly history rendering.
test("failed ink save retries without loss and history paints its saved version", async ({ page }, testInfo) => {
  const id = await create(page);
  await page.evaluate(async (id) => {
    const { objects } = await import("/src/lib/" + "objects.ts");
    const update = objects.update;
    (window as any).__allowInkSave = false;
    objects.update = async (...args: Parameters<ObjectStore["update"]>) => {
      if (args[0] === id && !(window as any).__allowInkSave) throw new Error("Ink save test: disk unavailable");
      return update(...args);
    };
  }, id);
  await page.getByRole("button", { name: "Write on this page", exact: true }).click();
  await circle(page, body(page).locator("p").first());
  await page.getByRole("button", { name: "Finish writing", exact: true }).click();
  await page.keyboard.press("Meta+s");
  await expect(page.getByText("Couldn't save your changes", { exact: true })).toBeVisible();
  await expect(inkPaths(body(page))).toBeInViewport();
  await page.evaluate(() => { (window as any).__allowInkSave = true; });
  await save(page);
  const before = (await stored(page, id))!.content;
  const dialog = await history(page);
  const preview = dialog.getByRole("textbox", { name: "Version preview", exact: true });
  await expect(inkPaths(preview)).toHaveCount(1);
  await expect(inkPaths(preview)).toBeInViewport();
  expect((await inkPaths(preview).boundingBox())!.height).toBeGreaterThan(5);
  const ink = (await inkPaths(preview).boundingBox())!;
  await page.mouse.click(ink.x + ink.width / 2, ink.y + ink.height / 2);
  await page.keyboard.type("Must not edit history");
  expect((await stored(page, id))!.content).toEqual(before);
  await page.screenshot({ path: testInfo.outputPath("history-inline-ink.png") });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await expect(inkPaths(body(page))).toHaveCount(1);
  expect((await stored(page, id))!.properties.custom).toEqual({ retained: true });
});

// Seam: image annotations follow the image's dimensions rather than the page or a stale screen box.
test("image ink scales with its block and keeps the source when the image is replaced", async ({ page }, testInfo) => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="180"><rect width="600" height="180" fill="white"/><rect x="150" y="45" width="300" height="90" fill="gray"/></svg>';
  await create(page, [paragraph("An annotated illustration."), { type: "image", attrs: { src: `data:image/svg+xml;base64,${Buffer.from(source).toString("base64")}`, name: "Original illustration.svg", mime: "image/svg+xml", size: source.length, width: "full" } }, paragraph("The original caption.")]);
  const image = body(page).locator('[data-media="image"] img');
  await expect(image).toBeVisible();
  await image.scrollIntoViewIfNeeded();
  const original = (await image.boundingBox())!;
  await page.getByRole("button", { name: "Write on this page", exact: true }).click();
  await page.mouse.move(original.x + original.width * 0.25, original.y + original.height / 2);
  await page.mouse.down();
  await page.mouse.move(original.x + original.width * 0.75, original.y + original.height / 2, { steps: 16 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Finish writing", exact: true }).click();
  const block = body(page).locator(".ll-annotated-block");
  await expect(inkPaths(block)).toHaveCount(1);
  const first = (await inkPaths(block).boundingBox())!;
  await image.click();
  await page.getByRole("button", { name: "Small", exact: true }).click();
  await expect.poll(async () => (await image.boundingBox())!.width).toBeLessThan(original.width - 20);
  await expect.poll(async () => (await inkPaths(block).boundingBox())!.width).toBeLessThan(first.width - 10);
  const smaller = (await image.boundingBox())!, second = (await inkPaths(block).boundingBox())!;
  expect(Math.abs(second.width / smaller.width - first.width / original.width)).toBeLessThan(0.04);
  await expect(block.locator(".ll-ink-review")).toHaveCount(0);
  const picker = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await (await picker).setFiles({ name: "Replacement.svg", mimeType: "image/svg+xml", buffer: Buffer.from(source.replace("gray", "black")) });
  await expect(block.locator(".ll-ink-review")).toBeVisible();
  await expect(block.locator(".ll-ink-original image")).toHaveCount(1);
  expect(await block.locator(".ll-ink-original image").getAttribute("href")).toContain(Buffer.from(source).toString("base64"));
  await page.screenshot({ path: testInfo.outputPath("replaced-image-original-ink.png") });
});

// Seam: clipboard HTML must carry ink data and anchor marks, not merely a screenshot or plain words.
test("copy and paste round-trips a drawn block through the editor clipboard handlers", async ({ page }) => {
  await create(page);
  await page.getByRole("button", { name: "Write on this page", exact: true }).click();
  await circle(page, body(page).locator("p").first());
  await page.getByRole("button", { name: "Finish writing", exact: true }).click();
  await body(page).locator(".ll-annotated-block p").hover();
  await page.getByRole("button", { name: "Drag to move", exact: true }).click();
  await page.keyboard.press("Escape");
  const html = await body(page).evaluate((el) => {
    const data = new DataTransfer();
    el.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }));
    return data.getData("text/html");
  });
  expect(html).toContain("data-ink");
  expect(html).toContain("data-ink-anchor");
  await body(page).locator("p").last().click();
  await page.keyboard.press("Meta+ArrowRight");
  await page.keyboard.press("Enter");
  await body(page).evaluate((el, html) => {
    const data = new DataTransfer(); data.setData("text/html", html);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, html);
  await expect(body(page).locator(".ll-annotated-block")).toHaveCount(2);
  await expect(inkPaths(body(page))).toHaveCount(2);
  await page.reload();
  await expect(inkPaths(body(page))).toHaveCount(2);
});

// Seam: autosave keeps a held stroke live; an explicit flush includes that stroke before returning.
test("autosave does not cut off a held stroke and explicit flush persists it", async ({ page }) => {
  const id = await create(page);
  await page.getByRole("button", { name: "Write on this page", exact: true }).click();
  await circle(page, body(page).locator("p").first());
  const line = (await body(page).locator("p").nth(1).boundingBox())!;
  await page.mouse.move(line.x + 20, line.y + 10);
  await page.mouse.down();
  await page.mouse.move(line.x + 100, line.y + 15, { steps: 8 });
  await page.waitForTimeout(650);
  await expect(page.locator(".ll-ink-live path")).toBeInViewport();
  expect((await page.locator(".ll-ink-live path").boundingBox())!.width).toBeGreaterThan(70);
  expect((await stored(page, id))!.content.content.filter((node: EditorDoc) => node.type === "annotatedBlock")).toHaveLength(1);
  expect(await page.evaluate(async (id) => {
    const { dirtyLive, restoreLive } = await import("/src/lib/" + "live.ts");
    const { objects } = await import("/src/lib/" + "objects.ts");
    const dirty = dirtyLive(id), saved = (await objects.get(id))!;
    restoreLive({ ...saved, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Remote replacement" }] }] } });
    return dirty;
  }, id)).toBe(true);
  await expect(body(page)).toContainText("The second paragraph stays below.");
  await page.mouse.move(line.x + 220, line.y + 20, { steps: 12 });
  await page.evaluate(async () => { await (await import("/src/lib/" + "saving.ts")).flushAll(); });
  expect((await stored(page, id))!.content.content.filter((node: EditorDoc) => node.type === "annotatedBlock")).toHaveLength(2);
  await page.mouse.up();
  await expect(inkPaths(body(page))).toHaveCount(2);
  expect((await inkPaths(body(page)).last().boundingBox())!.width).toBeGreaterThan(190);
  await page.reload();
  await expect(inkPaths(body(page))).toHaveCount(2);
  await expect(inkPaths(body(page)).last()).toBeInViewport();
});

// Seam: a live replacement from a newer app must preserve its raw content without writing a stripped view.
test("unknown content arriving in an open editor becomes readonly without rewriting stored notes", async ({ page }) => {
  const id = await create(page);
  await body(page).locator("p").first().click();
  await page.keyboard.press("Meta+ArrowRight");
  await page.keyboard.type(" An ordinary edit.");
  await save(page);
  const before = await stored(page, id);
  const raw = { type: "doc", content: [paragraph("Known words stay visible."), { type: "futureInk", attrs: { version: 9, untouched: { points: [[1, 2], [3, 4]] } } }] };
  const immediate = await page.evaluate(async ({ id, raw }) => {
    const editor = (await import("/src/lib/" + "live.ts")).liveEditor(id)!;
    editor.setContent(raw);
    return { doc: editor.getJSON(), editable: document.querySelector('[role="textbox"][aria-label="Page body"]')?.getAttribute("contenteditable") };
  }, { id, raw });
  expect(immediate).toEqual({ doc: raw, editable: "false" });
  await expect(page.getByRole("alert")).toContainText("This page has blocks this version can't show");
  await expect(body(page)).toHaveText("Known words stay visible.");
  await body(page).click();
  await page.keyboard.type("Must not overwrite future content");
  await save(page);
  expect(await live(page, id)).toEqual(raw);
  expect(await stored(page, id)).toEqual(before);
  await page.evaluate(async ({ id, doc }) => { (await import("/src/lib/" + "live.ts")).liveEditor(id)!.setContent(doc); }, { id, doc: before!.content });
  await expect(body(page)).toHaveAttribute("contenteditable", "true");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

// Seam: the first ink wrapper must not change heading margins or shift the document around the stroke.
test("first drawing on a later heading preserves its layout and the following paragraph", async ({ page }) => {
  await create(page, [paragraph("An introduction."), { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "A marked heading" }] }, paragraph("The paragraph below stays put.")]);
  const heading = body(page).locator("h2"), following = body(page).locator("p").last();
  const before = await textBox(heading, "A marked heading"), below = (await following.boundingBox())!.y;
  await page.getByRole("button", { name: "Write on this page", exact: true }).click();
  await circle(page, heading, "marked");
  await page.getByRole("button", { name: "Finish writing", exact: true }).click();
  const after = await textBox(heading, "A marked heading");
  for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(after[key] - before[key])).toBeLessThanOrEqual(1);
  expect(Math.abs((await following.boundingBox())!.y - below)).toBeLessThanOrEqual(1);
  await expect(inkPaths(body(page))).toBeInViewport();
});

// Seam: an annotated list's block menu acts on the whole list and carries its drawing into an independent copy.
test("duplicating an annotated list keeps both complete lists and independent ink", async ({ page }) => {
  await create(page, [{ type: "bulletList", content: [{ type: "listItem", content: [paragraph(sentence)] }, { type: "listItem", content: [paragraph("The second list item stays with the first.")] }] }, paragraph("After the list."), { type: "bulletList", content: [{ type: "listItem", content: [paragraph("Plain first item.")] }, { type: "listItem", content: [paragraph("Plain second item.")] }] }]);
  await page.getByRole("button", { name: "Write on this page", exact: true }).click();
  await circle(page, body(page).locator("li p").first());
  await page.getByRole("button", { name: "Finish writing", exact: true }).click();
  const blocks = body(page).locator(".ll-annotated-block");
  await blocks.locator("li p").first().hover();
  await page.getByRole("button", { name: "Drag to move", exact: true }).click();
  await expect(body(page).locator(".node-annotatedBlock.ll-selected ul li")).toHaveCount(2);
  await page.getByRole("menu", { name: "Block", exact: true }).getByRole("menuitem", { name: /^Duplicate/ }).click();
  await expect(blocks).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    await expect(blocks.nth(i).locator("li p")).toHaveText([sentence, "The second list item stays with the first."]);
    await expect(inkPaths(blocks.nth(i))).toBeInViewport();
  }
  await page.getByRole("button", { name: "Write on this page", exact: true }).click();
  await tool(page, "Eraser");
  const stroke = (await inkPaths(blocks.nth(1)).boundingBox())!;
  await page.mouse.click(stroke.x + stroke.width - 2, stroke.y + stroke.height / 2);
  await expect(inkPaths(blocks.nth(1))).toHaveCount(0);
  await expect(inkPaths(blocks.first())).toBeInViewport();
  await page.getByRole("button", { name: "Finish writing", exact: true }).click();
  const plain = body(page).locator(":scope > ul");
  await blockMenu(page, plain.locator("li p").first(), "Duplicate");
  await expect(plain.locator("li p")).toHaveText(["Plain first item.", "Plain first item.", "Plain second item."]);
});
