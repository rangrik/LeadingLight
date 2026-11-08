import { expect, test } from "@playwright/test";

// Seam: ⌘K and the filter's keys against a hidden (inert) sidebar, every result group and lib/panes.
// Catches ⌘K landing nowhere, ↓ skipping a group, ⇧Enter not opening beside, Escape keeping the keyboard.
test("Filter the sidebar from the keyboard", async ({ page }) => {
  await page.goto("/");
  const recent = page.getByRole("navigation", { name: "Recent" });
  for (const title of ["Alpha notes", "Beta", "Alpha plan"]) {
    await recent.getByRole("button", { name: "New page" }).click();
    await page.getByRole("textbox", { name: "Title" }).fill(title);
  }
  const body = (pane: string) => page.getByRole("region", { name: pane, exact: true }).getByRole("textbox", { name: "Page body" });
  await body("Alpha plan").click();
  await page.keyboard.press("ControlOrMeta+Backslash");
  await page.keyboard.press("ControlOrMeta+k");
  const field = page.getByRole("searchbox", { name: "Filter pages" });
  await expect(field).toBeFocused();
  await field.fill("alpha");
  await expect(recent.getByRole("button", { name: /^(Alpha|Beta)/ })).toHaveText(["Alpha plan", "Alpha notes"]);
  await expect(page.getByRole("navigation", { name: "Types" }).getByRole("listitem").first()).toContainText("Pages2");
  // Pages' two sub-rows, then Recent's two.
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
  await expect(recent.getByRole("button", { name: "Alpha notes" })).toBeFocused();
  await page.keyboard.press("Shift+Enter");
  await expect(body("Alpha notes")).toBeVisible();
  await expect(body("Alpha plan")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(field).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(field).toHaveValue("");
  await expect(body("Alpha plan")).toBeFocused();
  await expect(recent.getByRole("button", { name: "Beta" })).toBeVisible();
});
