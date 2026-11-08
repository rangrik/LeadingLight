import { expect, test } from "@playwright/test";

// Seam: Your words' own editor saves takeaways through the page, and ⌥⌘R's choice is stored on it.
test("Reading layout keeps its takeaways and its on/off across a reload", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("A source");
  await page.keyboard.press("Meta+Alt+r");
  const words = page.getByRole("complementary", { name: "Your words" });
  await words.getByRole("textbox", { name: "Takeaways" }).click();
  await page.keyboard.type("Structure makes behaviour");
  await page.waitForTimeout(700);
  await page.reload();
  await expect(words.getByRole("textbox", { name: "Takeaways" })).toHaveText("Structure makes behaviour");
  await page.getByRole("textbox", { name: "Title" }).click();
  await page.keyboard.press("Meta+Alt+r");
  await expect(words).toHaveCount(0);
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("A source");
  await expect(words).toHaveCount(0);
});
