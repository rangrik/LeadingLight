import { findPage } from "./navigation";
import { expect, type Page, test } from "@playwright/test";

// Scenarios from features/pages.feature.
const row = findPage;
const listItem = async (page: Page, name: string) => (await findPage(page, name)).locator("..");
const title = (page: Page) => page.getByRole("textbox", { name: "Title" });
const body = (page: Page) => page.getByRole("textbox", { name: "Page body" });

// Same path as a user: New page, type the title, Enter, type the body.
async function createPage(page: Page, name?: string, text?: string) {
  await page.getByRole("button", { name: "New page", exact: true }).first().click();
  await expect(title(page)).toBeFocused();
  if (name) await title(page).fill(name);
  if (text) {
    await title(page).press("Enter");
    await expect(body(page)).toBeFocused();
    await page.waitForTimeout(50);
    await page.keyboard.type(text);
  }
}

// Delete goes through the row's "Page actions" menu, as in sidebar-08.
async function chooseDelete(page: Page, name: string) {
  await (await listItem(page, name)).hover();
  await (await listItem(page, name)).getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
}

// The placeholder is CSS text on the empty block, so read the pseudo-element.
const placeholders = (page: Page) =>
  body(page).evaluate((el) =>
    [...el.children]
      .map((c) => getComputedStyle(c, "::before").content)
      .filter((c) => c !== "none" && c !== "normal")
      .map((c) => c.replace(/^"|"$/g, "")),
  );

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("First run shows an empty state", async ({ page }) => {
  await expect(page.getByText("Pin pages from Library to keep them here.")).toBeVisible();
  const main = page.getByRole("main");
  await expect(main.getByText("No page open")).toBeVisible();
  await expect(main.getByRole("button", { name: "New page" })).toBeVisible();
});

test("Creating a page from the sidebar", async ({ page }) => {
  await page.getByRole("button", { name: "New page", exact: true }).first().click();
  await expect(title(page)).toBeFocused();
  await expect(title(page)).toHaveValue("");
  expect(await placeholders(page)).toEqual(["Type '/' for commands"]);
  await expect((await row(page, "Untitled"))).toHaveAttribute("aria-current", "page");
});

test("Creating a page from the empty state", async ({ page }) => {
  await page.getByRole("main").getByRole("button", { name: "New page" }).click();
  await expect((await row(page, "Untitled"))).toBeVisible();
});

test("Library lists all pages alphabetically", async ({ page }) => {
  await createPage(page, "First");
  await expect((await row(page, "First"))).toBeVisible();
  await createPage(page, "Second");
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Library", exact: true }).getByRole("listitem")).toHaveText([/^First/, /^Second/]);
});

test("The title shows in the sidebar as I type", async ({ page }) => {
  await createPage(page);
  await title(page).pressSequentially("Trip to Kyoto");
  // Shorter than the 500 ms save delay, so this proves the row follows typing, not saving.
  await expect((await row(page, "Trip to Kyoto"))).toBeVisible({ timeout: 300 });
});

test("Enter in the title moves the cursor to the body", async ({ page }) => {
  await createPage(page);
  await title(page).pressSequentially("Notes");
  await title(page).press("Enter");
  await expect(body(page)).toBeFocused();
  await expect(title(page)).toHaveValue("Notes");
  const box = (await title(page).boundingBox())!;
  expect(box.height).toBeLessThan(60);
});

test("Switching pages shows each page's own content", async ({ page }) => {
  await createPage(page, "A", "alpha");
  await createPage(page, "B", "beta");
  await (await row(page, "A")).click();
  await expect(title(page)).toHaveValue("A");
  await expect(body(page)).toContainText("alpha");
  await expect(body(page)).not.toContainText("beta");
  await (await row(page, "B")).click();
  await expect(title(page)).toHaveValue("B");
  await expect(body(page)).toContainText("beta");
  await expect(body(page)).not.toContainText("alpha");
});

test("Content survives a reload", async ({ page }) => {
  await createPage(page, "Keep me", "still here");
  await page.waitForTimeout(1000);
  await page.reload();
  await expect((await row(page, "Keep me"))).toBeVisible();
  await expect(title(page)).toHaveValue("Keep me");
  await expect(body(page)).toContainText("still here");
});

test("Edits made right before switching pages are not lost", async ({ page }) => {
  await createPage(page, "A");
  await createPage(page, "B");
  await (await row(page, "A")).click();
  await expect(title(page)).toHaveValue("A");
  await body(page).click();
  await page.waitForTimeout(50);
  await page.keyboard.type("quick");
  await (await row(page, "B")).click();
  await expect(title(page)).toHaveValue("B");
  await page.reload();
  await (await row(page, "A")).click();
  await expect(title(page)).toHaveValue("A");
  await expect(body(page)).toContainText("quick");
});

test("Delete asks for confirmation and Cancel keeps the page", async ({ page }) => {
  await createPage(page, "Draft");
  await expect((await row(page, "Draft"))).toBeVisible();
  await chooseDelete(page, "Draft");
  const dialog = page.getByRole("alertdialog", { name: "Delete “Draft”?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect((await row(page, "Draft"))).toBeVisible();
});

// Guards the dialog's first focus: Base UI would focus Cancel, so Enter kept the page.
test("Enter confirms the delete and Escape keeps the page", async ({ page }) => {
  await createPage(page, "Draft");
  await chooseDelete(page, "Draft");
  const dialog = page.getByRole("alertdialog", { name: "Delete “Draft”?" });
  await expect(dialog.getByRole("button", { name: "Delete" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect((await row(page, "Draft"))).toBeVisible();
  await chooseDelete(page, "Draft");
  await page.keyboard.press("Enter");
  await expect((await row(page, "Draft"))).toHaveCount(0);
});

test("Confirming delete removes the page and opens the next one", async ({ page }) => {
  await createPage(page, "Old");
  await createPage(page, "New");
  await expect((await row(page, "New"))).toBeVisible();
  await chooseDelete(page, "New");
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect((await row(page, "New"))).toHaveCount(0);
  await expect((await row(page, "Old"))).toHaveAttribute("aria-current", "page");
  await expect(title(page)).toHaveValue("Old");
});

test("Deleting the last page shows the empty state", async ({ page }) => {
  await createPage(page, "Only");
  await expect((await row(page, "Only"))).toBeVisible();
  await chooseDelete(page, "Only");
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await page.getByRole("textbox", { name: "Search notes" }).fill("");
  await expect(page.getByText("Pin pages from Library to keep them here.")).toBeVisible();
  await expect(page.getByRole("main").getByText("No page open")).toBeVisible();
});

test("Long titles are truncated in the sidebar, not wrapped", async ({ page }) => {
  const long = "A very long title that goes on and on and on and on";
  await createPage(page, long);
  const r = (await row(page, long));
  await expect(r).toBeVisible();
  const box = (await r.boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(32);
  const clipped = await r.locator("span").evaluate((el) => ({
    overflows: el.scrollWidth > el.clientWidth,
    ellipsis: getComputedStyle(el).textOverflow === "ellipsis",
  }));
  expect(clipped).toEqual({ overflows: true, ellipsis: true });
  const titleBox = (await title(page).boundingBox())!;
  expect(titleBox.height).toBeGreaterThan(60);
});

test("A title of only spaces counts as untitled", async ({ page }) => {
  await createPage(page);
  await title(page).pressSequentially("   ");
  await expect((await row(page, "Untitled"))).toBeVisible();
});
