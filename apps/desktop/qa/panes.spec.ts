import { expect, type Page, test } from "@playwright/test";

const nav = (page: Page) => page.getByRole("navigation", { name: "Recent" });
const body = (page: Page, pane: string) =>
  page.getByRole("region", { name: pane, exact: true }).getByRole("textbox", { name: "Page body" });

async function create(page: Page, title: string) {
  const count = await nav(page).getByRole("listitem").count();
  await nav(page).getByRole("button", { name: "New page" }).click();
  await expect(nav(page).getByRole("listitem")).toHaveCount(count + 1);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("");
  await page.getByRole("textbox", { name: "Title" }).fill(title);
}

// Seam: two editors open at once, each with its own save queue.
// Catches an edit saved into the other page, or lost when the app reloads.
test("Two pages side by side each keep their own edits", async ({ page }) => {
  await page.goto("/");
  await create(page, "Left");
  await create(page, "Right");
  const row = (await nav(page).getByRole("button", { name: "Left", exact: true }).boundingBox())!;
  const area = (await page.locator("[data-pane-area]").boundingBox())!;
  await page.mouse.move(row.x + 20, row.y + row.height / 2);
  await page.mouse.down();
  await page.mouse.move(area.x + 10, area.y + area.height / 2, { steps: 10 });
  await page.mouse.up();
  await body(page, "Left").click();
  await page.keyboard.type("west");
  await body(page, "Right").click();
  await page.keyboard.type("east");
  await page.reload();
  // Both come back side by side (features/tabs.feature keeps the layout).
  await expect(body(page, "Left")).toHaveText("west");
  await expect(body(page, "Right")).toHaveText("east");
});

// Seam: the sidebar row's click, with Shift, against the panes. Catches Shift-click replacing the
// page in view instead of opening beside it, as Shift on a link does, and a card without its menu.
test("Shift-clicking a sidebar row opens the page beside", async ({ page }) => {
  await page.goto("/");
  await create(page, "Left");
  await create(page, "Right");
  await nav(page).getByRole("button", { name: "Left", exact: true }).click({ modifiers: ["Shift"] });
  await expect(page.getByRole("region", { name: "Left", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Right", exact: true })).toBeVisible();
  // Each page's card has its own Writing menu, not only one of them.
  await expect(page.getByRole("button", { name: "Writing" })).toHaveCount(2);
});
