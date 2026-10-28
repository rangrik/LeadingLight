import { expect, test } from "@playwright/test";

test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] }, permissions: ["microphone"] });

// Seam: new audio must notify the inbox after its one-time scan has finished.
test("saving another recording returns the same reviewed page to the inbox", async ({ page }) => {
  const inbox = page.getByRole("complementary", { name: "Captures", exact: true });
  const row = inbox.getByRole("row").filter({ has: page.getByRole("button", { name: "Recorded thought", exact: true }) });
  const toggle = page.getByRole("navigation", { name: "Bar" }).getByRole("button", { name: "Captures", exact: true });
  const openInbox = async () => (await toggle.getAttribute("aria-pressed")) !== "true" && (await toggle.click());
  await page.goto("/");
  await openInbox();
  await expect(inbox.getByText("Nothing waiting here")).toBeVisible();
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Recorded thought");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  for (let take = 0; take < 2; take++) {
    await page.keyboard.type("/voice");
    await page.getByRole("option", { name: "Voice recording" }).click();
    await page.getByRole("button", { name: "Record", exact: true }).click();
    await expect(page.getByText(/Recording ·/)).toBeVisible();
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Stop and transcribe" }).click();
    await expect(page.locator('[data-media="voice"] audio')).toHaveCount(take + 1);
    await expect(page.getByRole("alert").last()).toContainText("Your audio is saved");
    await openInbox();
    // The panel stays on the tab it showed, as it stays open beside the page.
    await inbox.getByRole("tab", { name: "To review", exact: true }).click();
    await expect(row).toHaveCount(1);
    if (take === 0) {
      await row.getByRole("button", { name: "Mark reviewed" }).click();
      await inbox.getByRole("tab", { name: "Reviewed", exact: true }).click();
      await row.getByRole("button", { name: "Recorded thought", exact: true }).click();
      await page.getByRole("textbox", { name: "Page body" }).locator("p").last().click();
      await page.keyboard.press("Meta+End");
    }
  }
  await page.reload();
  await openInbox();
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "Recorded thought", exact: true }).click();
  await expect(page.locator('[data-media="voice"] audio')).toHaveCount(2);
});
