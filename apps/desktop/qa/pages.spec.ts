import { expect, type Page, test } from "@playwright/test";

// Scenarios from features/pages.feature.
const sidebar = (page: Page) => page.getByRole("navigation", { name: "Recent" });
const row = (page: Page, name: string) => sidebar(page).getByRole("button", { name, exact: true });
const listItem = (page: Page, name: string) => sidebar(page).getByRole("listitem").filter({ hasText: name });
const title = (page: Page) => page.getByRole("textbox", { name: "Title" });
const body = (page: Page) => page.getByRole("textbox", { name: "Page body" });

// Same path as a user: New page, type the title, Enter, type the body.
async function createPage(page: Page, name?: string, text?: string) {
  await sidebar(page).getByRole("button", { name: "New page" }).click();
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
  await listItem(page, name).hover();
  await listItem(page, name).getByRole("button", { name: "More" }).click();
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
  await expect(sidebar(page).getByText("No pages yet")).toBeVisible();
  const main = page.getByRole("main");
  await expect(main.getByText("No page open")).toBeVisible();
  await expect(main.getByRole("button", { name: "New page" })).toBeVisible();
});

test("Creating a page from the sidebar", async ({ page }) => {
  await sidebar(page).getByRole("button", { name: "New page" }).click();
  await expect(sidebar(page).getByRole("listitem")).toHaveCount(1);
  await expect(row(page, "Untitled")).toHaveAttribute("aria-current", "page");
  await expect(title(page)).toBeFocused();
  await expect(title(page)).toHaveValue("");
  expect(await placeholders(page)).toEqual(["Type '/' for commands"]);
});

test("Creating a page from the empty state", async ({ page }) => {
  await page.getByRole("main").getByRole("button", { name: "New page" }).click();
  await expect(sidebar(page).getByRole("listitem")).toHaveCount(1);
  await expect(row(page, "Untitled")).toBeVisible();
});

test("New pages go to the top of the list", async ({ page }) => {
  await createPage(page, "First");
  await expect(row(page, "First")).toBeVisible();
  await createPage(page, "Second");
  // Each row also holds the hidden "More" label, so match by prefix.
  await expect(sidebar(page).getByRole("listitem")).toHaveText([/^Second/, /^First/]);
});

test("The title shows in the sidebar as I type", async ({ page }) => {
  await createPage(page);
  await title(page).pressSequentially("Trip to Kyoto");
  // Shorter than the 500 ms save delay, so this proves the row follows typing, not saving.
  await expect(row(page, "Trip to Kyoto")).toBeVisible({ timeout: 300 });
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
  await row(page, "A").click();
  await expect(title(page)).toHaveValue("A");
  await expect(body(page)).toContainText("alpha");
  await expect(body(page)).not.toContainText("beta");
  await row(page, "B").click();
  await expect(title(page)).toHaveValue("B");
  await expect(body(page)).toContainText("beta");
  await expect(body(page)).not.toContainText("alpha");
});

test("Content survives a reload", async ({ page }) => {
  await createPage(page, "Keep me", "still here");
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(row(page, "Keep me")).toBeVisible();
  await expect(title(page)).toHaveValue("Keep me");
  await expect(body(page)).toContainText("still here");
});

test("Edits made right before switching pages are not lost", async ({ page }) => {
  await createPage(page, "A");
  await createPage(page, "B");
  await row(page, "A").click();
  await expect(title(page)).toHaveValue("A");
  await body(page).click();
  await page.waitForTimeout(50);
  await page.keyboard.type("quick");
  await row(page, "B").click();
  await expect(title(page)).toHaveValue("B");
  await page.reload();
  await row(page, "A").click();
  await expect(title(page)).toHaveValue("A");
  await expect(body(page)).toContainText("quick");
});

test("Delete asks for confirmation and Cancel keeps the page", async ({ page }) => {
  await createPage(page, "Draft");
  await expect(row(page, "Draft")).toBeVisible();
  await chooseDelete(page, "Draft");
  const dialog = page.getByRole("alertdialog", { name: "Delete “Draft”?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, "Draft")).toBeVisible();
});

test("Confirming delete removes the page and opens the next one", async ({ page }) => {
  await createPage(page, "Old");
  await createPage(page, "New");
  await expect(row(page, "New")).toBeVisible();
  await chooseDelete(page, "New");
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(row(page, "New")).toHaveCount(0);
  await expect(row(page, "Old")).toHaveAttribute("aria-current", "page");
  await expect(title(page)).toHaveValue("Old");
});

test("Deleting the last page shows the empty state", async ({ page }) => {
  await createPage(page, "Only");
  await expect(row(page, "Only")).toBeVisible();
  await chooseDelete(page, "Only");
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(sidebar(page).getByText("No pages yet")).toBeVisible();
  await expect(page.getByRole("main").getByText("No page open")).toBeVisible();
});

test("Long titles are truncated in the sidebar, not wrapped", async ({ page }) => {
  const long = "A very long title that goes on and on and on and on";
  await createPage(page, long);
  const r = row(page, long);
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
  await expect(row(page, "Untitled")).toBeVisible();
});
