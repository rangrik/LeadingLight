import { expect, test } from "@playwright/test";

// Seam: Resume reads the space and the Feed (features/sidebar-resume.feature). Catches the "needs
// you" row lost when the Feed's items change, a page in two rows, or the group in an empty space.
test("Resume hides in an empty space", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("No pages yet")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Resume" })).toHaveCount(0);
});

test("Resume leads back to work in the demo space", async ({ page }) => {
  await page.goto("/?demo");
  await page.waitForEvent("load", { timeout: 20_000 }); // the seed reloads once the space is full
  const rows = page.getByRole("navigation", { name: "Resume" }).getByRole("button");
  await expect(rows).toHaveCount(3, { timeout: 20_000 });
  await expect(rows.nth(0)).toContainText("LeadingLight");
  await expect(rows.nth(1)).toContainText("Write the pricing page copyLeadingLight · Asks a question");
  await expect(rows.nth(2)).toContainText("Read chapter 3 of Thinking in Systems");
  await rows.nth(1).click();
  await expect(rows.nth(1)).toHaveAttribute("aria-current", "page");
});
