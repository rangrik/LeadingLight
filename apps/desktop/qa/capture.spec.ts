import { expect, type Page, test } from "@playwright/test";

const body = (page: Page) => page.getByRole("textbox", { name: "Page body" });
const box = (page: Page) => page.getByRole("dialog", { name: "New idea" });
const notes = (page: Page) => box(page).getByRole("textbox", { name: "Notes" });
const pane = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

// Seam: the box's drafts through lib/capture.ts into the space and the panes, and its body is the
// block editor. Catches an idea written into Today's body or missing from "Created this day", a
// lost project or tag, Escape closing the box under an open menu, and ⇧⌘↩ replacing the page in view.
test("A captured idea keeps its project, shows in Today and opens beside", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New idea" }).click();
  const title = box(page).getByRole("textbox", { name: "Idea" });
  const picker = box(page).getByRole("button", { name: "Project" });
  await expect(title).toBeFocused();
  await picker.click();
  await page.getByRole("textbox", { name: "Find or create a project" }).fill("House");
  await page.getByRole("button", { name: "Create project “House”" }).click();
  await expect(picker).toHaveText("House");
  await expect(title).toBeFocused();
  await title.pressSequentially("Walk the long way");
  await title.press("Enter");
  await expect(notes(page)).toBeFocused();
  await page.keyboard.type("/");
  const menu = page.getByRole("listbox", { name: "Insert block" });
  await expect(menu).toBeVisible();
  expect(await menu.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return document.elementFromPoint(r.left + 8, r.top + 8)?.closest("[role=listbox]") === el;
  })).toBe(true);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(box(page)).toBeVisible();
  await page.keyboard.press("Backspace");
  await page.keyboard.type("- Along the river");
  await expect(notes(page).locator("ul li")).toHaveText("Along the river");
  await expect(box(page).getByText("Saved")).toHaveAttribute("aria-hidden", "false");
  await page.screenshot({ path: "qa/report/capture-box.png" });
  await page.keyboard.press("Escape");
  await expect(box(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(body(page)).toHaveAttribute("contenteditable", "true");
  await expect(body(page)).toHaveText("");
  await expect(page.getByRole("region", { name: "Created this day" })).toContainText("Walk the long way");

  // ⌘↩ saves and gives the keyboard back; ⇧⌘↩ opens the idea beside, Today staying in view.
  await body(page).click();
  await page.getByRole("button", { name: "New idea" }).click();
  await box(page).getByRole("textbox", { name: "Idea" }).pressSequentially("Second");
  await page.keyboard.press("Meta+Enter");
  await expect(box(page)).toHaveCount(0);
  await expect(body(page)).toBeFocused();
  await page.getByRole("button", { name: "New idea" }).click();
  await box(page).getByRole("textbox", { name: "Idea" }).pressSequentially("Third");
  await page.keyboard.press("Shift+Meta+Enter");
  await expect(pane(page, "Third").getByRole("textbox", { name: "Page body" })).toBeFocused();
  await expect(page.getByRole("region", { name: "Created this day" })).toContainText("Second");
  await expect(body(page).first()).toHaveText("");

  await page.waitForTimeout(800);
  await page.reload();
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "Walk the long way" }).click();
  const idea = pane(page, "Walk the long way");
  await expect(idea.getByRole("textbox", { name: "Page body" }).locator("ul li")).toHaveText("Along the river");
  await expect(idea.getByRole("button", { name: "House" })).toBeVisible();
  await expect(idea.getByText("in-the-middle", { exact: true })).toBeVisible();
});
