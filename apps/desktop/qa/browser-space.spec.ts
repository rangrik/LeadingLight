import { expect, type Page, test } from "@playwright/test";

// The browser space under the QA flag, with the stand-in engine (lib/native-browser.ts): pages are
// placeholders, so these check the space's own logic, not WebKit's.
const tabs = (page: Page) => page.getByRole("list", { name: "Tabs" }).getByRole("button", { name: /^(?!More for |Close )/ });
const bar = (page: Page) => page.getByRole("combobox", { name: "Search or enter address" });

async function open(page: Page) {
  await page.addInitScript(() => localStorage.setItem("ll.browser.standin", "1"));
  // No runtime: no agents, and Saved stays under the space's own key.
  await page.route("**/__runtime/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
}
async function visit(page: Page, input: string) {
  await page.locator('[data-slot="sidebar-content"]').getByRole("button", { name: "New tab", exact: true }).click();
  await bar(page).fill(input);
  await page.keyboard.press("Enter");
  await expect(bar(page)).toBeHidden();
}

// Seam: the command bar against the open tabs. Catches Return on an open tab's title opening a
// second copy of it instead of showing the one already open.
test("The command bar switches to an open tab rather than opening a copy", async ({ page }) => {
  await open(page);
  await visit(page, "en.wikipedia.org/wiki/Safari");
  await visit(page, "example.com");
  await expect(tabs(page)).toHaveCount(2);
  await visit(page, "safar");
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).first()).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("browser-pill")).toContainText("en.wikipedia.org/wiki/Safari");
});

// Seam: the space's tabs in storage against a new launch. Catches tabs, their order or the tab in
// view lost or shuffled when the app starts again, a button needed to bring them back, or a
// restored tab's page left unshown (blank) the first time it is opened.
test("Tabs and their order come back after a reload", async ({ page }) => {
  await open(page);
  for (const site of ["one.example", "two.example", "three.example"]) await visit(page, site);
  await tabs(page).nth(1).click();
  // Previous releases saved one web: page and kept its selected website separately.
  await page.evaluate(() => {
    const layout = JSON.parse(localStorage.getItem("ll.panes")!);
    layout.root.tabs.find((t: { id: string }) => t.id === layout.root.active).pages = ["web:"];
    localStorage.setItem("ll.panes", JSON.stringify(layout));
  });
  await page.reload();
  await expect(tabs(page)).toHaveText([/one\.example$/, /two\.example$/, /three\.example$/]);
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-current", "page");
  const shown = page.getByTestId("standin-page");
  await expect(shown).toContainText("https://two.example/");
  await expect(shown).toHaveAttribute("data-live", "true");
  await tabs(page).nth(2).click();
  await expect(shown).toContainText("https://three.example/");
  await expect(shown).toHaveAttribute("data-live", "true");
});

// Seam: the address rules against the command bar. Catches a javascript: address loading, or
// changing the tab in view, instead of being refused.
test("A refused address leaves the tab as it was", async ({ page }) => {
  await open(page);
  await visit(page, "example.com");
  await page.keyboard.press("ControlOrMeta+l");
  await bar(page).fill("javascript:alert(1)");
  await expect(page.getByRole("option", { name: /Use an http or https address/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(tabs(page)).toHaveCount(1);
  await expect(page.getByTestId("browser-pill")).toContainText("example.com");
});

// Seam: ⌘L's prefilled address against the open-tab rows. Catches Return choosing this same tab
// (doing nothing) instead of loading what was typed in it.
test("⌘L then Return loads the address in this tab", async ({ page }) => {
  await open(page);
  await visit(page, "example.com/one");
  await page.keyboard.press("ControlOrMeta+l");
  await bar(page).fill("example.com/two");
  await page.keyboard.press("Enter");
  await expect(tabs(page)).toHaveCount(1);
  await expect(page.getByTestId("browser-pill")).toContainText("example.com/two");
});
