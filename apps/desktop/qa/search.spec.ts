import { expect, type Page, test } from "@playwright/test";

const nav = (page: Page) => page.getByRole("navigation", { name: "Recent" });
const card = (page: Page, title: string) => page.getByRole("region", { name: title, exact: true });

async function create(page: Page, title: string) {
  const count = await nav(page).getByRole("listitem").count();
  await nav(page).getByRole("button", { name: "New page" }).click();
  await expect(nav(page).getByRole("listitem")).toHaveCount(count + 1);
  await page.getByRole("textbox", { name: "Title" }).fill(title);
}

// Seam: ⌘K from inside the editor, through the window's key table, to the panes. Catches the key
// not reaching the switcher, Esc losing the cursor, and Enter's Shift lost on its way to the row.
test("⌘K opens a page by name; Esc gives the cursor back", async ({ page }) => {
  await page.goto("/");
  await create(page, "Pricing notes");
  await create(page, "Stocks and flows");
  await card(page, "Stocks and flows").getByRole("textbox", { name: "Page body" }).click();
  await page.keyboard.type("bathtub");
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("pri");
  await expect(page.getByRole("option").first()).toContainText("Pricing notes");
  await page.keyboard.press("Escape");
  await page.keyboard.type("!");
  await expect(card(page, "Stocks and flows").getByRole("textbox", { name: "Page body" })).toHaveText("bathtub!");
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("pri");
  await page.keyboard.press("Shift+Enter");
  await expect(card(page, "Pricing notes")).toBeVisible();
  await expect(card(page, "Stocks and flows")).toBeVisible();
});

// Seam: the New page row, through templates, to the pane. Catches the typed title lost.
test("a name no page has makes that page", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("Garden plan");
  await page.getByRole("option", { name: "New page “Garden plan”" }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Garden plan");
});
