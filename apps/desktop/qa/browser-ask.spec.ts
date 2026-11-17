import { expect, test } from "@playwright/test";

// Seam: an agent's page action against the person's answer (lib/turn.ts → lib/page-tools.ts),
// with the stand-in agent and engine. Catches a click reaching the page before the person allows
// it, or after "Not now".
test("A click waits for the person, and Not now leaves the page alone", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ll.browser.standin", "1"));
  await page.route("**/__runtime/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.getByRole("radio", { name: "Browser", exact: true }).click(); await page.getByRole("button", { name: "New tab", exact: true }).click();
  await page.keyboard.press("ControlOrMeta+t");
  await page.getByRole("combobox", { name: "Search or enter address" }).fill("fernhill.app/pricing");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("combobox", { name: "Search or enter address" })).toBeHidden();
  await page.getByTestId("browser-space").getByRole("button", { name: "Ask", exact: true }).click();
  // The stand-in page counts what it was made to do.
  const clicks = async () => Number(await page.getByTestId("standin-page").getAttribute("data-done"));
  const ask = async () => {
    await page.getByRole("textbox", { name: "Question" }).click();
    await page.keyboard.type("Press Annual");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("group", { name: "Approval" })).toContainText("Let Claude click on fernhill.app?", { timeout: 15_000 });
  };
  await ask();
  expect(await clicks()).toBe(0);
  // The card is beside the page, not over it: the page stays live, so its outline shows.
  await expect(page.getByTestId("standin-page")).toHaveAttribute("data-live", "true");
  await expect(page.getByTestId("page-picture")).toHaveCount(0);
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByRole("group", { name: "Approval" })).toBeHidden();
  expect(await clicks()).toBe(0);
  await expect(page.getByTestId("browser-pill")).not.toContainText("Claude is");
  await ask();
  await page.getByRole("button", { name: "Allow once" }).click();
  await expect.poll(clicks).toBe(1);
  await expect(page.getByTestId("standin-page")).toHaveAttribute("data-live", "true");
});

// Seam: what the app draws over the page against the page's live view (browser-space.tsx,
// useCovered). Catches the page's picture left in place of the live page once nothing covers it.
test("The live page comes back after the command bar covers it", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ll.browser.standin", "1"));
  await page.route("**/__runtime/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.getByRole("radio", { name: "Browser", exact: true }).click(); await page.getByRole("button", { name: "New tab", exact: true }).click();
  const bar = page.getByRole("combobox", { name: "Search or enter address" });
  await bar.fill("example.com");
  await page.keyboard.press("Enter");
  await expect(bar).toBeHidden();
  const live = page.getByTestId("standin-page");
  await expect(live).toHaveAttribute("data-live", "true");
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press("ControlOrMeta+l");
    await expect(live).toHaveAttribute("data-live", "false");
    await page.keyboard.press("Escape");
    await expect(live).toHaveAttribute("data-live", "true");
    await expect(page.getByTestId("page-picture")).toHaveCount(0);
  }
});
