import { expect, type Page, test } from "@playwright/test";

const nav = (page: Page) => page.getByRole("navigation", { name: "Recent" });
const body = (page: Page) => page.getByRole("textbox", { name: "Page body" });

async function create(page: Page, title: string) {
  const count = await nav(page).getByRole("listitem").count();
  await nav(page).getByRole("button", { name: "New page" }).click();
  await expect(nav(page).getByRole("listitem")).toHaveCount(count + 1);
  await page.getByRole("textbox", { name: "Title" }).fill(title);
}

// Seam: the panel reads the open editor, and Link writes through it (DECISIONS.md, 9). Catches a
// list that waits for a save, and a link the open pane then saves its own copy over.
test("Connections follows the editor and links through it", async ({ page }) => {
  await page.goto("/");
  await create(page, "Dune");
  await create(page, "Notes");
  await body(page).click();
  await page.keyboard.type("Reading Dune again.");
  await page.keyboard.press("Meta+Alt+KeyL");
  const panel = page.getByRole("complementary", { name: "Connections" });
  const unlinked = panel.getByRole("region", { name: "Not linked yet" });
  await unlinked.getByRole("button", { name: "Link" }).click();
  await expect(body(page).locator(".node-mention")).toContainText("Dune");
  await expect(panel.getByRole("region", { name: "Links from this page" })).toContainText("Dune");
  await expect(unlinked).toHaveCount(0);
  await page.waitForTimeout(700);
  await page.reload();
  await expect(body(page).locator(".node-mention")).toContainText("Dune");
});
