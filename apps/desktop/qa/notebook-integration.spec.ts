import { expect, test, type Page } from "@playwright/test";
import type { ObjectStore } from "../src/lib/store";

async function document(page: Page, phone = false) {
  await page.goto(phone ? "/?iphone" : "/?ipad");
  if (phone) await page.getByRole("navigation", { name: "Phone navigation" }).getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByRole("button", { name: "New page", exact: true }).first().click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Reading source");
  await page.getByRole("textbox", { name: "Title", exact: true }).press("Enter");
  await page.getByRole("textbox", { name: "Page body" }).fill("Keep every original paragraph.");
  return page.locator("[data-pane-page]:visible").getAttribute("data-pane-page") as Promise<string>;
}
const stored = (page: Page, id: string) => page.evaluate(async (id) => (await import("/src/lib/" + "objects.ts")).objects.get(id), id);
const choose = async (page: Page, label: string, notebook = false) => {
  await page.getByRole("button", { name: notebook ? "Notebook options" : "Page actions", exact: true }).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
};

// Seam: starting handwriting must never mutate or conceal its source, including pending edits.
for (const width of [390, 820, 1280]) test(`linked notebook keeps document and metadata at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const id = await document(page, width === 390);
  await page.evaluate(async (id) => {
    const { editPage } = await import("/src/lib/" + "live.ts");
    await editPage(id, { properties: (p: Record<string, unknown>) => ({ ...p, description: "A description to preserve", custom: "untouched" }) });
  }, id);
  await page.getByRole("textbox", { name: "Page body" }).press("End");
  await page.keyboard.type(" Including the last unsaved sentence.");
  await choose(page, "New linked notebook");
  await expect(page.locator("[data-paper-surface]")).toBeVisible();
  const notebook = await page.locator("[data-pane-page]:visible").getAttribute("data-pane-page");
  expect(notebook).not.toBe(id);
  const source = await stored(page, id);
  expect(source.properties.paper).toBeUndefined();
  expect(JSON.stringify(source.content)).toContain("Including the last unsaved sentence.");
  expect(source.properties.custom).toBe("untouched");
  expect(source.typeId).toBe("page");
  const header = page.locator("[data-pane-page]:visible > header");
  const tools = page.getByRole("toolbar", { name: "Paper tools" });
  expect(await header.getByRole("toolbar", { name: "Paper tools" }).count()).toBe(1);
  const edge = await header.boundingBox();
  for (const button of await tools.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(edge!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(edge!.x + edge!.width + 1);
  }
  if (width === 390) await choose(page, "Notebook details", true);
  else await page.getByRole("button", { name: "Notebook details", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Notebook details" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Type", exact: true })).toHaveCount(0);
  await expect(page.getByText("Notes on", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Renamed notebook");
  await page.keyboard.press("Escape");
  await choose(page, "Back to Reading source", true);
  await expect(page.getByRole("textbox", { name: "Page body" })).toContainText("Including the last unsaved sentence.");
  await expect(page.getByRole("textbox", { name: "Description", exact: true })).toHaveValue("A description to preserve");
  await choose(page, "Open linked notebook");
  expect(await page.locator("[data-pane-page]:visible").getAttribute("data-pane-page")).toBe(notebook);
  await expect(page.locator(".ll-paper-heading h1")).toHaveText("Renamed notebook");
  await page.screenshot({ path: `qa/report/notebook-${width}.png` });
});

// Seam: old mixed storage must display both bodies without migrating or rewriting either.
test("legacy mixed page shows its document before handwriting without changing stored data", async ({ page }) => {
  const id = await document(page);
  await page.evaluate(async (id) => {
    const { editPage } = await import("/src/lib/" + "live.ts");
    const { blankPaper } = await import("/src/lib/" + "paper.ts");
    await editPage(id, { properties: (p: Record<string, unknown>) => ({ ...p, description: "Original metadata", paper: { ...blankPaper(), items: [{ id: "ink-text", kind: "text", x: 112, y: 180, width: 560, height: 72, text: "Original positioned text" }] } }) });
  }, id);
  const before = await stored(page, id);
  await page.reload();
  const body = page.getByRole("textbox", { name: "Page body" });
  await expect(body).toBeVisible();
  await expect(body).toContainText("Keep every original paragraph.");
  await expect(page.getByRole("textbox", { name: "Description", exact: true })).toHaveValue("Original metadata");
  await expect(page.getByRole("textbox", { name: "Paper text", exact: true })).toHaveValue("Original positioned text");
  expect((await body.boundingBox())!.y).toBeLessThan((await page.locator("[data-paper-surface]").boundingBox())!.y);
  await page.keyboard.press("Meta+s");
  const after = await stored(page, id);
  expect(after.properties).toEqual(before.properties);
  expect(after.content).toEqual(before.content);
  await page.screenshot({ path: "qa/report/notebook-legacy-visible.png" });
});

// Seam: type changes outside the picker must fail before live properties or stored data change.
test("type guard protects notebooks through live and direct writes, and templates cannot convert documents", async ({ page }) => {
  const id = await document(page);
  await choose(page, "New linked notebook");
  await expect(page.locator("[data-paper-surface]")).toBeVisible();
  const results = await page.evaluate(async (id) => {
    const { notebookFor } = await import("/src/lib/" + "notebooks.ts");
    const { editPage } = await import("/src/lib/" + "live.ts");
    const { objects } = await import("/src/lib/" + "objects.ts");
    const { pageInit } = await import("/src/lib/" + "templates.ts");
    const book = notebookFor(id)!;
    const before = await objects.get(book.id);
    const failures = [];
    for (const work of [() => editPage(book.id, { typeId: "book", properties: () => ({ lost: true }) }), () => objects.update(book.id, { typeId: "page" }), () => editPage(id, { typeId: "notebook" })]) {
      try { await work(); failures.push(false); } catch { failures.push(true); }
    }
    const template = await objects.create({ title: "Old template", properties: { templateOf: "page", paper: before.properties.paper, description: "Keep this" } });
    const init = await pageInit("page", {}, template.id);
    return { failures, before, after: await objects.get(book.id), init };
  }, id);
  expect(results.failures).toEqual([true, true, true]);
  expect(results.after).toEqual(results.before);
  expect(results.init.properties.paper).toBeUndefined();
  expect(results.init.properties.description).toBe("Keep this");
});

// Seam: failure or concurrent clicks must leave the source intact and produce at most one notebook.
test("failed creation retries without modifying the document or duplicating notebooks", async ({ page }) => {
  const id = await document(page);
  await page.evaluate(async () => {
    const { objects } = await import("/src/lib/" + "objects.ts");
    const create = objects.create;
    objects.create = async (...[init, context]: Parameters<ObjectStore["create"]>) => {
      if (init?.typeId !== "notebook") return create(init, context);
      objects.create = create;
      throw new Error("Disk unavailable");
    };
  });
  await choose(page, "New linked notebook");
  await expect(page.getByText("Couldn't create notebook", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Page body" })).toContainText("Keep every original paragraph.");
  const ids = await page.evaluate(async (id) => {
    const { linkedNotebook } = await import("/src/lib/" + "notebooks.ts");
    return Promise.all([linkedNotebook(id), linkedNotebook(id)]);
  }, id);
  expect(ids[0]).toBe(ids[1]);
  expect((await stored(page, id)).properties.paper).toBeUndefined();
  await choose(page, "Open linked notebook");
  await page.evaluate(async (id) => { await (await import("/src/lib/" + "space.ts")).removePage(id); }, id);
  await expect(page.locator("[data-paper-surface]")).toBeVisible();
  await page.getByRole("button", { name: "Notebook options", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Back to Reading source", exact: true })).toHaveCount(0);
});

// Seam: moving history into a submenu must keep its sheet alive when the menu closes.
test("page history remains usable from the consolidated header", async ({ page }) => {
  await document(page);
  await page.keyboard.press("Meta+s");
  await page.getByRole("button", { name: "Page actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "History and authorship", exact: true }).hover();
  await page.getByRole("menuitem", { name: "Page history", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Page history");
});

// Seam: moving metadata into an unmounted sheet must retain sizing and avoid pasting into a hidden body.
test("reopened notebook metadata wraps and title paste cannot create document blocks", async ({ page }) => {
  await document(page);
  await choose(page, "New linked notebook");
  await page.getByRole("button", { name: "Notebook details", exact: true }).click();
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await title.fill("A long notebook title that wraps across several lines in the details sheet and must remain completely readable");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Notebook details", exact: true }).click();
  await expect.poll(() => title.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  await title.focus();
  await title.press("Meta+a");
  await title.evaluate((el) => {
    const data = new DataTransfer(); data.setData("text/plain", "Notebook title\nA second line");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(title).toHaveValue("Notebook title A second line");
  await title.press("Enter");
  await expect(page.getByRole("textbox", { name: "Page body", includeHidden: true })).toBeHidden();
  await expect(page.locator(".ll-paper-heading h1")).toHaveText("Notebook title A second line");
});

// Seam: linking an empty page must still leave a working source after restart.
test("linking an unwritten document keeps its source after reload", async ({ page }) => {
  await page.goto("/?ipad");
  await page.getByRole("button", { name: "New page", exact: true }).first().click();
  const source = await page.locator("[data-pane-page]:visible").getAttribute("data-pane-page");
  await choose(page, "New linked notebook");
  await expect(page.locator("[data-paper-surface]")).toBeVisible();
  await page.reload();
  await expect(page.locator("[data-paper-surface]")).toBeVisible();
  await choose(page, "Back to source page", true);
  await expect(page.getByRole("textbox", { name: "Page body" })).toBeVisible();
  expect((await stored(page, source!)).properties.paper).toBeUndefined();
});

// Seam: inspecting and copying history must neither edit paper nor replace the source's usual notebook.
test("notebook history previews paper and a copy cannot take over its source link", async ({ page }) => {
  await document(page);
  await choose(page, "New linked notebook");
  await expect(page.locator("[data-paper-surface]")).toBeVisible();
  const original = await page.locator("[data-pane-page]:visible").getAttribute("data-pane-page");
  await page.getByRole("button", { name: "Text box", exact: true }).click();
  await page.locator("[data-paper-surface]").click({ position: { x: 130, y: 130 } });
  await page.keyboard.type("A notebook version worth keeping");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Notebook options", exact: true }).click();
  await page.getByRole("menuitem", { name: "History and authorship", exact: true }).hover();
  await page.getByRole("menuitem", { name: "Page history", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".ll-paper-text")).toHaveText("A notebook version worth keeping");
  await expect(dialog.locator(".ll-paper-text")).toBeVisible();
  expect(await dialog.locator(".ll-paper-viewport").evaluate((el) => el.clientHeight)).toBeGreaterThan(200);
  await expect(dialog.locator(".ll-paper-text")).toBeInViewport();
  await dialog.getByRole("button", { name: "Keep a copy", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await page.locator("[data-pane-page]:visible").getAttribute("data-pane-page")).not.toBe(original);
  await choose(page, "Back to Reading source", true);
  await choose(page, "Open linked notebook");
  await expect(page.locator("[data-pane-page]:visible")).toHaveAttribute("data-pane-page", original!);
});

// Seam: future or damaged paper must stay opaque instead of silently becoming an editable document.
test("unsupported paper keeps its data and offers history without document capture", async ({ page }) => {
  await document(page);
  const id = await page.evaluate(async () => {
    const { createPage } = await import("/src/lib/" + "space.ts");
    const made = await createPage({ typeId: "notebook", title: "Future notebook", properties: { paper: { version: 2, items: [{ text: "Keep future content" }] }, custom: "Keep metadata" } });
    (await import("/src/lib/" + "panes.ts")).openPage(made.id);
    return made.id;
  });
  const before = await stored(page, id);
  await expect(page.getByRole("alert")).toContainText("Notebook unavailable");
  await expect(page.getByRole("textbox", { name: "Page body", includeHidden: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Quick record", exact: true })).toBeDisabled();
  await page.keyboard.press("Meta+Shift+r");
  await page.getByRole("button", { name: "Notebook options", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "History and authorship", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await stored(page, id)).toEqual(before);
});
