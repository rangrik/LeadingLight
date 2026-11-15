import { expect, test } from "@playwright/test";

// Seam: one update state drives both the toast and Settings › About. Catches a click that
// installs nothing, and a failed install that leaves no way to the update.
test("The toast offers an update and installs it with one click", async ({ page }) => {
  await page.clock.install();
  await page.goto("/?update=0.9.0&clis=current");
  await expect(page.getByRole("button", { name: "New page" }).first()).toBeVisible();
  await page.clock.fastForward(31_000);
  await expect(page.getByText("LeadingLight 0.9.0 is ready")).toBeVisible();
  await page.getByRole("button", { name: "Update and restart" }).click();
  await expect(page.getByText("Updating to LeadingLight 0.9.0…")).toBeVisible();
  await expect(page.getByText("Updating to LeadingLight 0.9.0…")).toBeHidden();
  await page.keyboard.press("Meta+,");
  await page.getByTestId("settings-nav-about").click();
  await expect(page.getByTestId("settings-about").getByText("Up to date")).toBeVisible();
});

test("A failed install says why and still offers the update", async ({ page }) => {
  await page.goto("/?update=fail&clis=current");
  await page.keyboard.press("Meta+,");
  await page.getByTestId("settings-nav-about").click();
  const about = page.getByTestId("settings-about");
  await about.getByRole("button", { name: "Check for updates" }).click();
  await expect(about.getByText("0.9.0 is ready")).toBeVisible();
  await about.getByRole("button", { name: "Update and restart" }).click();
  await expect(page.getByText("Couldn't update LeadingLight")).toBeVisible();
  await expect(page.getByText("The download was interrupted.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download" })).toBeVisible();
  await expect(about.getByText("Couldn't update to 0.9.0")).toBeVisible();
  await about.getByRole("button", { name: "Update and restart" }).click();
  await expect(page.getByText("Updating to LeadingLight 0.9.0…")).toBeVisible();
  await expect(page.getByText("Updating to LeadingLight 0.9.0…")).toBeHidden();
  await expect(page.getByText("Couldn't update LeadingLight")).toHaveCount(1);
});
