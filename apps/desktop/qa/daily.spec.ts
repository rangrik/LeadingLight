import { expect, test } from "@playwright/test";

// Seam: a day not yet written in opens as a draft, stored by its first save (storeDraft in
// lib/space.ts). Catches browsing days leaving empty notes behind, and a draft's first edit lost.
test("Browsing days stores nothing; the first edit stores the day", async ({ page }) => {
  await page.goto("/");
  const title = page.getByRole("textbox", { name: "Title" });
  const days: string[] = [];
  await page.getByRole("button", { name: "Today", exact: true }).click();
  for (let i = 0; i < 3; i++) {
    if (i) await page.getByRole("button", { name: "Previous day" }).click();
    await expect(title).not.toHaveValue(days.at(-1) ?? "");
    days.push(await title.inputValue());
  }
  await page.getByRole("textbox", { name: "Page body" }).click();
  await page.keyboard.type("kept");
  await page.getByRole("button", { name: "Next day" }).click();
  await expect(title).toHaveValue(days[1]);
  await page.reload();
  await page.getByRole("navigation", { name: "Types" }).getByRole("button", { name: "Daily notes" }).click();
  await expect(page.getByRole("link", { name: days[2] })).toBeVisible();
  await expect(page.getByRole("link", { name: days[0] })).toHaveCount(0);
  await expect(page.getByRole("link", { name: days[1] })).toHaveCount(0);
  await page.getByRole("link", { name: days[2] }).click();
  await expect(page.getByRole("textbox", { name: "Page body" })).toHaveText("kept");
});
