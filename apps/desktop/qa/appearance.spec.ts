import { expect, type Page, test } from "@playwright/test";

// Scenarios from features/appearance.feature: Shipyard's themes and Settings
// (vendor/shipyard) wired into the app. The seam guarded: our shortcuts hook,
// the alias and CSS wiring, and the theme applying over our COSS tokens.
const pages = (page: Page) => page.getByRole("navigation", { name: "Pages" });
const settingsNav = (page: Page) => page.getByRole("navigation", { name: "Settings sections" });
const themeCard = (page: Page, id: string) => page.locator(`[data-testid="theme-option"][data-theme-id="${id}"]`);
const rootVar = (page: Page, name: string) => page.evaluate((n) => document.documentElement.style.getPropertyValue(n), name);

async function openAppearance(page: Page) {
  await page.keyboard.press("Meta+,");
  await expect(settingsNav(page)).toBeVisible();
  await page.getByTestId("settings-nav-appearance").click();
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(pages(page)).toBeVisible();
});

test("Settings opens with Meta+, and closes with Escape", async ({ page }) => {
  await page.keyboard.press("Meta+,");
  await expect(settingsNav(page)).toBeVisible();
  await expect(settingsNav(page).getByRole("button", { name: "Back to app" })).toBeVisible();
  // The pages underneath are covered and inert, not unmounted (their edits are kept).
  await expect(page.locator("[inert]").getByRole("navigation", { name: "Pages" })).toBeAttached();
  // Settings wears the app's shell: the same sidebar header, and ⌘\ folds it once, not twice.
  await expect(page.locator(".ll-settings").getByText("LeadingLight", { exact: true })).toBeVisible();
  await page.keyboard.press("Meta+\\");
  expect(await page.evaluate(() => localStorage.getItem("ll.sidebar.open"))).toBe("false");
  await page.keyboard.press("Meta+\\");
  expect(await page.evaluate(() => localStorage.getItem("ll.sidebar.open"))).toBe("true");
  await page.keyboard.press("Escape");
  await expect(settingsNav(page)).toBeHidden();
  await expect(page.locator("[inert]")).toHaveCount(0);
  await expect(pages(page)).toBeVisible();
});

// The seam: Settings lies over the page shell, which stays mounted and inert.
// What it catches: a remount showing stale content, then saving it over the
// page (QA, 2026-10-22), and keys reaching the page while Settings is open.
test("Settings never touches the page's edits", async ({ page }) => {
  await pages(page).getByRole("button", { name: "New page" }).click();
  const title = page.getByRole("textbox", { name: "Title" });
  await expect(title).toBeFocused();
  await title.fill("Kept");
  await title.press("Enter");
  const body = page.getByRole("textbox", { name: "Page body" });
  await expect(body).toBeFocused();
  await page.keyboard.type("first words");
  await page.keyboard.press("Meta+,");
  await expect(settingsNav(page)).toBeVisible();
  await expect(body).not.toBeFocused();
  await page.keyboard.type("lost");
  await page.keyboard.press("Escape");
  await expect(settingsNav(page)).toBeHidden();
  await expect(body).toHaveText("first words");
  // Focus comes back to the editor, where it was.
  await expect(body).toBeFocused();
  await page.keyboard.type(" more");
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Page body" })).toHaveText("first words more");
});

test("Meta+N inside Settings makes a page and goes to it", async ({ page }) => {
  await page.keyboard.press("Meta+,");
  await expect(settingsNav(page)).toBeVisible();
  await page.keyboard.press("Meta+N");
  await expect(settingsNav(page)).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Title" })).toBeFocused();
  await expect(pages(page).getByRole("button", { name: "Untitled", exact: true })).toHaveAttribute("aria-current", "page");
});

test("Picking a theme colours the whole app and survives a reload", async ({ page }) => {
  await openAppearance(page);
  await themeCard(page, "dracula").click();
  await expect(themeCard(page, "dracula")).toHaveAttribute("aria-pressed", "true");
  expect(await rootVar(page, "--background")).toBe("#282a36");
  // Code block tokens follow the theme's palette (lib/use-code-colors.ts).
  expect(await rootVar(page, "--code-keyword")).toMatch(/^#[0-9a-f]{6}$/);
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(40, 42, 54)");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.screenshot({ path: "qa/report/appearance-dracula.png" });
  await page.reload();
  await expect(pages(page)).toBeVisible();
  expect(await rootVar(page, "--background")).toBe("#282a36");
});

test("Light, Dark and Match system", async ({ page }) => {
  await openAppearance(page);
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByRole("button", { name: "Match system", exact: true }).click();
  await expect(page.getByText(/by day,/)).toBeVisible();
});

test("Themes can be searched", async ({ page }) => {
  await openAppearance(page);
  await page.getByRole("searchbox", { name: "Find a theme" }).fill("nord");
  await expect(page.getByTestId("theme-option")).toHaveCount(1);
  await expect(themeCard(page, "nord")).toBeVisible();
});

test("Text size steps the interface and Meta+0 resets it", async ({ page }) => {
  await openAppearance(page);
  await page.getByRole("button", { name: "Large", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.style.fontSize)).not.toBe("");
  await page.keyboard.press("Meta+0");
  expect(await page.evaluate(() => document.documentElement.style.fontSize)).toBe("");
});

test("Meta+/ opens the Keyboard shortcuts sheet with our table", async ({ page }) => {
  await page.keyboard.press("Meta+/");
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("New page")).toBeVisible();
  await expect(sheet.getByText("Settings", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});
