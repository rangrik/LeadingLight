import { expect, test } from "@playwright/test";

// Scenarios from features/usage.feature and features/cli-updates.feature, on the browser build's
// stand-ins. The seams: each tool's own answer shaped into limits and pace, and an update check
// through the toast to the update and the version read again.

test("The usage card shows each limit with its pace", async ({ page }) => {
  await page.goto("/");
  const button = page.getByRole("button", { name: "Usage" });
  await expect(button).toContainText(/Claude\s*39%/);
  await expect(button).toContainText(/Codex\s*4%/);
  await button.click();
  const claude = page.getByRole("region", { name: "Claude" });
  await expect(claude).toContainText("Max");
  await expect(claude).toContainText(/5h\s*14% used/);
  await expect(claude).toContainText("Resets in 59m");
  await expect(claude).toContainText("66% in reserve");
  await expect(claude).toContainText(/Fable\s*29% used/);
  await expect(page.getByRole("region", { name: "Codex" })).toContainText(/Weekly\s*4% used/);
});

test("A newer Codex: the toast, Update all, and the tool read again", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Codex update available")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Update all" }).click();
  await expect(page.getByText("Codex updated")).toBeVisible();
  await page.keyboard.press("Meta+,");
  await page.getByTestId("settings-nav-ai").click();
  await expect(page.getByTestId("settings-ai")).toContainText("Current 0.163.0");
  await page.reload();
  await page.waitForTimeout(11_000);
  await expect(page.getByText("Codex update available")).toBeHidden();
});
