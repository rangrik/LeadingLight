import { expect, type Page, test } from "@playwright/test";

const open = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name, exact: true }).click();
const body = (page: Page) => page.getByRole("textbox", { name: "Page body" });

// Seam: saves wait 500 ms, and the page can go away inside that wait.
// Catches the last edit being lost on reload, tab close or window close.
test("Reloading right after typing keeps the edit", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).click();
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

// Seam: a page's properties are saved back as one map. Catches a property this version
// doesn't know (from a later build) being dropped when the page saves.
test("Saving a page keeps properties this version doesn't know", async ({ page }) => {
  const properties = { icon: { kind: "emoji", emoji: "✈️" }, later: { kept: true } };
  const old = [{ id: "p", typeId: "page", title: "Trip", content: null, properties, createdAt: 1, updatedAt: 1 }];
  await page.addInitScript((v) => localStorage.getItem("seeded") || localStorage.setItem("leadinglight.objects", v), JSON.stringify(old));
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("seeded", "1"));
  await expect(page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "Trip" })).toContainText("✈️");
  await page.getByRole("textbox", { name: "Title" }).hover();
  await page.getByRole("button", { name: "Add description" }).click();
  await page.keyboard.type("Ten days");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Description" })).toHaveValue("Ten days");
  const stored = await page.evaluate(
    () =>
      new Promise((done) => {
        indexedDB.open("leadinglight").onsuccess = (e) => {
          const db = (e.target as IDBOpenDBRequest).result;
          db.transaction("objects").objectStore("objects").get("p").onsuccess = (r) =>
            done((r.target as IDBRequest).result.properties);
        };
      }),
  );
  expect(stored).toMatchObject({ later: { kept: true }, description: "Ten days" });
});

// Seam: spaces saved when a property could be named "Description". Catches its text being lost,
// or a second Description row left beside the line under the title.
test("An old Description property joins the line under the title", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Types" }).getByRole("button", { name: "Books" })).toBeVisible();
  await page.evaluate(
    () =>
      new Promise((done) => {
        indexedDB.open("leadinglight").onsuccess = (e) => {
          const t = (e.target as IDBOpenDBRequest).result.transaction(["props", "objects"], "readwrite");
          t.objectStore("props").put({ id: "p_d", name: "Description", kind: "text", options: {}, createdAt: 1 });
          t.objectStore("objects").put({ id: "d", typeId: "page", title: "Dune", content: null, properties: { p_d: "A desert planet" }, createdAt: 1, updatedAt: 1 });
          t.oncomplete = done;
        };
      }),
  );
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Description" })).toHaveValue("A desert planet");
  await expect(page.getByRole("button", { name: "Description", exact: true })).toHaveCount(0);
});

// Seam: the browser store's upgrade from version 1, which had pages only. Catches existing
// pages vanishing, or the starter types missing, after the upgrade.
test("Pages stored before types existed survive the upgrade", async ({ page }) => {
  // Any page of the same origin that isn't the app, so the app can't upgrade the store first.
  await page.goto("/src-tauri/icons/32x32.png");
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        const req = indexedDB.open("leadinglight", 1);
        req.onupgradeneeded = () => {
          const obj = { id: "v1", typeId: "page", title: "From v1", content: null, properties: {}, createdAt: 1, updatedAt: 1 };
          req.result.createObjectStore("objects", { keyPath: "id" }).put(obj);
        };
        req.onsuccess = () => {
          req.result.close();
          done();
        };
      }),
  );
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "From v1" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Types" }).getByRole("button", { name: "Books" })).toBeVisible();
});
