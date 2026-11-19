import { expect, type Page, test } from "@playwright/test";

// Seam: the footer's controls are icons only, so their names and tooltips are all that say what they are,
// and the one-row toolbar must hold at the sidebar's narrowest and widest.
const footer = (page: Page) => page.locator('[data-slot="sidebar-footer"]');
const tip = (page: Page) => page.locator('[data-slot="tooltip-popup"]');
const controls = (page: Page) => [
  page.getByRole("radio", { name: "Notes", exact: true }),
  page.getByRole("radio", { name: "Browser", exact: true }),
  page.getByRole("button", { name: "Remote work", exact: true }),
  page.getByRole("button", { name: /^Account and sync/ }),
  page.getByRole("button", { name: "Settings", exact: true }),
];

for (const scheme of ["light", "dark"] as const) for (const width of [200, 400]) test(`two lines at ${width} px, ${scheme}`, async ({ page }) => {
  await page.emulateMedia({ colorScheme: scheme });
  await page.addInitScript((w) => localStorage.setItem("ll.sidebar.width", String(w)), width);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Usage" })).toContainText(/Claude\s*39%/);
  const box = (await footer(page).boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(88);
  const tops = await Promise.all(controls(page).map(async (c) => (await c.boundingBox())!.y + (await c.boundingBox())!.height / 2));
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1);
  await page.screenshot({ path: `qa/report/sidebar-footer-${width}-${scheme}.png`, clip: { x: 0, y: box.y - 120, width: width + 16, height: box.height + 128 } });
});

test("each icon says what it is and opens its place", async ({ page }) => {
  await page.goto("/");
  // The launch toast sits beside the sidebar, never over the footer.
  const toast = page.getByText("Codex update available");
  await expect(toast).toBeVisible({ timeout: 15_000 });
  expect((await toast.boundingBox())!.x).toBeGreaterThan((await footer(page).boundingBox())!.x + 240);
  const names = ["Notes · ⌥⌘B", "Browser · ⌥⌘B", "Remote work", "Account and sync", "Settings · ⌘,"];
  for (const [i, control] of controls(page).entries()) {
    await control.hover();
    await expect(tip(page)).toHaveText(names[i]);
  }
  await controls(page)[1].click();
  await expect(page.getByText("Browser", { exact: true }).first()).toBeVisible();
  await page.keyboard.press("Alt+Meta+b");
  await expect(controls(page)[0]).toBeChecked();
  await controls(page)[4].click();
  await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible();
  await page.keyboard.press("Escape");
  await controls(page)[3].click();
  await expect(page.getByTestId("settings-account")).toBeVisible();
  await page.keyboard.press("Escape");
  await controls(page)[2].click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Remote work" })).toBeVisible();
  // Focus returns to the icon and opens its tooltip over the usage line; the line must still take the click.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Usage" }).click({ timeout: 3000 });
  await expect(page.getByRole("region", { name: "Claude" })).toBeVisible();
});

test("iPad keeps Remote work, Account and Settings, without mode or usage", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto("/?ipad");
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Sidebar mode" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Usage" })).toHaveCount(0);
  await page.screenshot({ path: "qa/report/sidebar-footer-ipad.png", clip: { x: 0, y: 620, width: 300, height: 200 } });
});
