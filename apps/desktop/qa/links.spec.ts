import { expect, type Page, test } from "@playwright/test";

const nav = (page: Page) => page.getByRole("navigation", { name: "Pages" });
const body = (page: Page) => page.getByRole("textbox", { name: "Page body" });

async function create(page: Page, title: string) {
  const count = await nav(page).getByRole("listitem").count();
  await nav(page).getByRole("button", { name: "New page" }).click();
  await expect(nav(page).getByRole("listitem")).toHaveCount(count + 1);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("");
  await page.getByRole("textbox", { name: "Title" }).fill(title);
}

// Seam: link nodes in a stored body. Catches a page with links opening read-only (its nodes
// unknown to the editor) or its links lost, after a reload.
test("A page with links reopens editable with its links", async ({ page }) => {
  await page.goto("/");
  await create(page, "Dune");
  await create(page, "Notes");
  await body(page).click();
  await page.keyboard.type("Reading @dun");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("@dun");
  await page.keyboard.press("Enter");
  await expect(body(page).locator(".node-pageLink")).toHaveCount(1);
  await page.waitForTimeout(700);
  await page.reload();
  await nav(page).getByRole("button", { name: "Notes", exact: true }).click();
  await expect(body(page)).toHaveAttribute("contenteditable", "true");
  await expect(body(page).locator(".node-mention")).toContainText("Dune");
  await expect(body(page).locator(".node-pageLink")).toContainText("Dune");
});
