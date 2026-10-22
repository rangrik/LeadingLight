import { expect, type Page, test } from "@playwright/test";

const open = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name, exact: true }).click();
const body = (page: Page) => page.getByRole("textbox", { name: "Page body" });

// Seam: saves wait 500 ms, and the page can go away inside that wait.
// Catches the last edit being lost on reload, tab close or window close.
test("Reloading right after typing keeps the edit", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("last words");
  await page.reload();
  await open(page, "Untitled");
  await expect(body(page)).toContainText("last words");
});

// Seam: the store boundary with pages saved by the first build (localStorage, BlockNote blocks).
// Catches those pages vanishing or opening empty.
test("Pages from the first build open with their content", async ({ page }) => {
  const text = (t: string, styles = {}) => [{ type: "text", text: t, styles }];
  const content = [
    { type: "heading", props: { level: 2 }, content: text("Plans") },
    { type: "paragraph", content: text("bold", { bold: true }) },
    { type: "checkListItem", props: { checked: true }, content: text("done") },
  ];
  const old = [{ id: "old", typeId: "page", title: "Old notes", content, properties: {}, createdAt: 1, updatedAt: 1 }];
  await page.addInitScript((v) => localStorage.setItem("leadinglight.objects", v), JSON.stringify(old));
  await page.goto("/");
  await open(page, "Old notes");
  await expect(body(page).locator("h2")).toHaveText("Plans");
  await expect(body(page).locator("strong")).toHaveText("bold");
  await expect(body(page).locator('li[data-checked="true"] p')).toHaveText("done");
  await expect(body(page)).toHaveAttribute("contenteditable", "true");
});

// Seam: stored content the schema can't read. Catches such a page opening empty and editable,
// so the first edit (typing or the handle's "Add block") overwrites what was stored.
test("A page with unknown blocks opens read-only", async ({ page }) => {
  const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "kept" }] }, { type: "futureBlock" }] };
  const old = [{ id: "new", typeId: "page", title: "From later", content, properties: {}, createdAt: 1, updatedAt: 1 }];
  await page.addInitScript((v) => localStorage.setItem("leadinglight.objects", v), JSON.stringify(old));
  await page.goto("/");
  await open(page, "From later");
  await expect(page.getByRole("alert")).toContainText("can't show");
  await expect(body(page)).toHaveAttribute("contenteditable", "false");
  await expect(body(page)).toHaveText("kept");
  await body(page).hover();
  await expect(page.getByRole("button", { name: "Add block" })).toHaveCount(0);
});
