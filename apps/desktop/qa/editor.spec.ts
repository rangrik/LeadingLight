import { expect, test } from "@playwright/test";

// Seam: our block-selection keymap runs before TipTap's suggestion plugin.
// Catches Escape in the slash menu selecting the block, so the next Backspace deletes it.
test("Escape in the slash menu, then Backspace, only edits text", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("keep me");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/qu");
  await expect(page.getByRole("listbox", { name: "Insert block" })).toBeVisible();
  await page.keyboard.press("Escape");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Backspace");
  const body = page.getByRole("textbox", { name: "Page body" });
  await expect(body.locator("p").first()).toHaveText("keep me");
});
