import { expect, test } from "@playwright/test";

// One quick pass through the main path. The full scenarios live in features/.
test("create a page, write, and reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("No pages yet")).toBeVisible();

  const sidebar = page.getByRole("navigation", { name: "Recent" });
  await sidebar.getByRole("button", { name: "New page" }).click();

  const title = page.getByRole("textbox", { name: "Title" });
  await expect(title).toBeFocused();
  await title.fill("Smoke");
  await title.press("Enter");

  const body = page.getByRole("textbox", { name: "Page body" });
  await expect(body).toBeFocused();
  await page.keyboard.type("# Heading");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Some text");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await expect(page.getByRole("listbox", { name: "Insert block" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(body.locator("h1")).toHaveText("Heading");
  await expect(sidebar.getByRole("button", { name: "Smoke" })).toBeVisible();

  await page.waitForTimeout(800);
  await page.reload();
  await expect(sidebar.getByRole("button", { name: "Smoke" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Page body" }).locator("h1")).toHaveText("Heading");
  await page.screenshot({ path: "qa/report/smoke.png" });
});
